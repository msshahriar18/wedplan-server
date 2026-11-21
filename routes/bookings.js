import { Router } from "express";
import { bookings, services, users } from "../db.js";
import { verifyCustomer, verifyToken, verifyVendor } from "../middlewares/auth.js";
import { ApiError, asyncHandler } from "../middlewares/error.js";
import { lookupCustomer, lookupService, lookupVendor } from "../utils/lookups.js";
import { cleanString, toObjectId } from "../utils/validate.js";

const router = Router();

const ACTIVE_STATUSES = ["pending", "accepted"];

// "2026-12-24" -> Date at UTC midnight, so the same day always compares equal
const parseEventDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, "Please select a valid event date");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "Please select a valid event date");

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (date <= today) throw new ApiError(400, "Event date must be in the future");
  return date;
};

router.post(
  "/bookings",
  verifyToken,
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const serviceId = toObjectId(req.body.serviceId, "service id");
    const eventDate = parseEventDate(req.body.eventDate);
    const eventLocation = cleanString(req.body.eventLocation);
    const message = cleanString(req.body.message).slice(0, 1000);

    if (eventLocation.length < 3) throw new ApiError(400, "Event location is required");

    const service = await services.findOne({ _id: serviceId, status: "approved", isAvailable: true });
    if (!service) throw new ApiError(404, "This service is not available for booking");

    if (service.vendorId.equals(req.user._id)) {
      throw new ApiError(403, "You cannot book your own service");
    }

    const vendor = await users.findOne({ _id: service.vendorId }, { projection: { isBlocked: 1 } });
    if (!vendor || vendor.isBlocked) throw new ApiError(404, "This service is not available for booking");

    const duplicate = await bookings.findOne({
      serviceId,
      eventDate,
      customerId: req.user._id,
      status: { $in: ACTIVE_STATUSES },
    });
    if (duplicate) {
      throw new ApiError(409, "You already have an active request for this service on that date");
    }

    const alreadyBooked = await bookings.findOne({ serviceId, eventDate, status: "accepted" });
    if (alreadyBooked) throw new ApiError(409, "This vendor is already booked on that date");

    const now = new Date();
    const booking = {
      serviceId,
      vendorId: service.vendorId,
      customerId: req.user._id,
      eventDate,
      eventLocation,
      message,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    const result = await bookings.insertOne(booking);
    res.status(201).send({ ...booking, _id: result.insertedId });
  })
);

router.get(
  "/bookings/my",
  verifyToken,
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const match = { customerId: req.user._id };
    if (["pending", "accepted", "rejected", "cancelled"].includes(req.query.status)) {
      match.status = req.query.status;
    }
    const result = await bookings
      .aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        ...lookupService,
        ...lookupVendor,
        { $project: { "vendor.isBlocked": 0, "vendor.subscriptionExpiresAt": 0 } },
      ])
      .toArray();
    res.send(result);
  })
);

router.patch(
  "/bookings/:id/cancel",
  verifyToken,
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const _id = toObjectId(req.params.id, "booking id");

    const booking = await bookings.findOne({ _id, customerId: req.user._id });
    if (!booking) throw new ApiError(404, "Booking not found");
    if (booking.status !== "pending") {
      throw new ApiError(409, `This booking is already ${booking.status} and cannot be cancelled`);
    }

    // status is part of the filter so two parallel requests can't both win
    const result = await bookings.findOneAndUpdate(
      { _id, customerId: req.user._id, status: "pending" },
      { $set: { status: "cancelled", updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!result) throw new ApiError(409, "Booking status changed, please refresh");
    res.send(result);
  })
);

// ---------- vendor side ----------

router.get(
  "/vendor/bookings",
  verifyToken,
  verifyVendor,
  asyncHandler(async (req, res) => {
    const match = { vendorId: req.user._id };
    if (["pending", "accepted", "rejected", "cancelled"].includes(req.query.status)) {
      match.status = req.query.status;
    }
    const result = await bookings
      .aggregate([{ $match: match }, { $sort: { createdAt: -1 } }, ...lookupService, ...lookupCustomer])
      .toArray();
    res.send(result);
  })
);

router.patch(
  "/vendor/bookings/:id",
  verifyToken,
  verifyVendor,
  asyncHandler(async (req, res) => {
    const _id = toObjectId(req.params.id, "booking id");
    const { status } = req.body;
    if (!["accepted", "rejected"].includes(status)) {
      throw new ApiError(400, "Status must be accepted or rejected");
    }

    const booking = await bookings.findOne({ _id, vendorId: req.user._id });
    if (!booking) throw new ApiError(404, "Booking request not found");
    if (booking.status !== "pending") {
      throw new ApiError(409, `This request is already ${booking.status}`);
    }

    if (status === "accepted") {
      const clash = await bookings.findOne({
        serviceId: booking.serviceId,
        eventDate: booking.eventDate,
        status: "accepted",
      });
      if (clash) throw new ApiError(409, "You already accepted another booking for this date");
    }

    const result = await bookings.findOneAndUpdate(
      { _id, vendorId: req.user._id, status: "pending" },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!result) throw new ApiError(409, "Booking status changed, please refresh");
    res.send(result);
  })
);

export default router;
