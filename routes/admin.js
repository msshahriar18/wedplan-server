import { Router } from "express";
import { bookings, services, sessions, transactions, users } from "../db.js";
import { verifyAdmin, verifyToken } from "../middlewares/auth.js";
import { ApiError, asyncHandler } from "../middlewares/error.js";
import { isPremiumExpr, lookupVendor } from "../utils/lookups.js";
import { CATEGORIES, cleanString, escapeRegex, toObjectId } from "../utils/validate.js";
import { FREE_SERVICE_LIMIT, countActiveServices } from "./services.js";

const router = Router();

router.use("/admin", verifyToken, verifyAdmin);

const userProjection = {
  name: 1,
  email: 1,
  image: 1,
  role: 1,
  isBlocked: 1,
  businessName: 1,
  phone: 1,
  subscriptionPlan: 1,
  subscriptionExpiresAt: 1,
  createdAt: 1,
};

// ---------- users ----------

router.get(
  "/admin/users",
  asyncHandler(async (req, res) => {
    const search = cleanString(req.query.search);
    const query = {};
    if (["customer", "vendor", "admin"].includes(req.query.role)) query.role = req.query.role;
    if (req.query.status === "blocked") query.isBlocked = true;
    if (req.query.status === "active") query.isBlocked = { $ne: true };
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      query.$or = [{ name: regex }, { email: regex }];
    }

    const result = await users
      .aggregate([
        { $match: query },
        { $sort: { createdAt: -1 } },
        { $project: userProjection },
        { $addFields: { isPremium: isPremiumExpr("$$ROOT") } },
      ])
      .toArray();
    res.send(result);
  })
);

router.get(
  "/admin/users/:id",
  asyncHandler(async (req, res) => {
    const _id = toObjectId(req.params.id, "user id");
    const user = await users.findOne({ _id }, { projection: userProjection });
    if (!user) throw new ApiError(404, "User not found");

    const [serviceCount, vendorBookings, customerBookings, payments] = await Promise.all([
      services.countDocuments({ vendorId: _id }),
      bookings.countDocuments({ vendorId: _id }),
      bookings.countDocuments({ customerId: _id }),
      transactions.countDocuments({ vendorId: _id }),
    ]);

    res.send({
      ...user,
      stats: { serviceCount, vendorBookings, customerBookings, payments },
    });
  })
);

router.patch(
  "/admin/users/:id/block",
  asyncHandler(async (req, res) => {
    const _id = toObjectId(req.params.id, "user id");
    if (typeof req.body.isBlocked !== "boolean") {
      throw new ApiError(400, "isBlocked must be true or false");
    }
    if (_id.equals(req.user._id)) throw new ApiError(400, "You cannot block your own account");

    const target = await users.findOne({ _id }, { projection: { role: 1 } });
    if (!target) throw new ApiError(404, "User not found");
    if (target.role === "admin") throw new ApiError(403, "Admin accounts cannot be blocked");

    const result = await users.findOneAndUpdate(
      { _id },
      { $set: { isBlocked: req.body.isBlocked, updatedAt: new Date() } },
      { returnDocument: "after", projection: userProjection }
    );

    // kick the user out everywhere right away
    if (req.body.isBlocked) {
      await sessions.deleteMany({ userId: { $in: [_id, _id.toString()] } });
    }
    res.send(result);
  })
);

// ---------- services ----------

router.get(
  "/admin/services",
  asyncHandler(async (req, res) => {
    const search = cleanString(req.query.search);
    const match = {};
    if (["pending", "approved", "rejected"].includes(req.query.status)) match.status = req.query.status;
    if (CATEGORIES.includes(req.query.category)) match.category = req.query.category;

    const afterLookup = {};
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      afterLookup.$or = [
        { serviceName: regex },
        { location: regex },
        { "vendor.name": regex },
        { "vendor.businessName": regex },
        { "vendor.email": regex },
      ];
    }

    const result = await services
      .aggregate([
        { $match: match },
        ...lookupVendor,
        { $match: afterLookup },
        // pending first so they're easy to review
        { $addFields: { pendingFirst: { $cond: [{ $eq: ["$status", "pending"] }, 0, 1] } } },
        { $sort: { pendingFirst: 1, createdAt: -1 } },
        { $project: { pendingFirst: 0 } },
      ])
      .toArray();
    res.send(result);
  })
);

router.patch(
  "/admin/services/:id/status",
  asyncHandler(async (req, res) => {
    const _id = toObjectId(req.params.id, "service id");
    const { status } = req.body;
    if (!["pending", "approved", "rejected"].includes(status)) {
      throw new ApiError(400, "Status must be pending, approved or rejected");
    }

    const service = await services.findOne({ _id });
    if (!service) throw new ApiError(404, "Service not found");

    // moving a rejected service back would bring it into the active count again
    if (service.status === "rejected" && status !== "rejected" && service.isAvailable) {
      const vendor = await users.findOne({ _id: service.vendorId });
      const isPremium =
        vendor?.subscriptionPlan === "premium" &&
        (!vendor.subscriptionExpiresAt || new Date(vendor.subscriptionExpiresAt) > new Date());
      if (!isPremium && (await countActiveServices(service.vendorId)) >= FREE_SERVICE_LIMIT) {
        throw new ApiError(409, "This vendor already has the maximum active services on the free plan");
      }
    }

    const result = await services.findOneAndUpdate(
      { _id },
      { $set: { status, reviewedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (status === "rejected") {
      await bookings.updateMany(
        { serviceId: _id, status: "pending" },
        { $set: { status: "rejected", updatedAt: new Date() } }
      );
    }
    res.send(result);
  })
);

router.delete(
  "/admin/services/:id",
  asyncHandler(async (req, res) => {
    const _id = toObjectId(req.params.id, "service id");
    const result = await services.deleteOne({ _id });
    if (!result.deletedCount) throw new ApiError(404, "Service not found");

    await bookings.updateMany(
      { serviceId: _id, status: "pending" },
      { $set: { status: "cancelled", updatedAt: new Date() } }
    );
    res.send({ deleted: true });
  })
);

// ---------- transactions (read only on purpose) ----------

router.get(
  "/admin/transactions",
  asyncHandler(async (req, res) => {
    const match = {};
    if (["paid", "failed", "cancelled", "refunded"].includes(req.query.status)) {
      match.status = req.query.status;
    }
    const result = await transactions
      .aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        ...lookupVendor,
        { $project: { "vendor.isBlocked": 0, "vendor.phone": 0 } },
      ])
      .toArray();
    res.send(result);
  })
);

export default router;
