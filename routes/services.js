import { Router } from "express";
import { bookings, services } from "../db.js";
import { verifyToken, verifyVendor } from "../middlewares/auth.js";
import { ApiError, asyncHandler } from "../middlewares/error.js";
import { lookupVendor } from "../utils/lookups.js";
import { CATEGORIES, cleanString, escapeRegex, toObjectId, validateService } from "../utils/validate.js";

const router = Router();

export const FREE_SERVICE_LIMIT = 3;

// a service counts as "active" while it is available and not rejected
export const countActiveServices = (vendorId) =>
  services.countDocuments({ vendorId, isAvailable: true, status: { $ne: "rejected" } });

export const assertCanActivate = async (vendor) => {
  if (vendor.subscriptionPlan === "premium") return;
  const activeCount = await countActiveServices(vendor._id);
  if (activeCount >= FREE_SERVICE_LIMIT) {
    throw new ApiError(
      403,
      `Free plan allows only ${FREE_SERVICE_LIMIT} active services. Upgrade to Premium for unlimited services.`
    );
  }
};

const publicMatch = { status: "approved", isAvailable: true };

const SORTS = {
  price_asc: { price: 1, _id: 1 },
  price_desc: { price: -1, _id: 1 },
  newest: { createdAt: -1, _id: 1 },
};

// public listing with search, filters, sort and pagination
router.get(
  "/services",
  asyncHandler(async (req, res) => {
    const search = cleanString(req.query.search);
    const category = cleanString(req.query.category);
    const location = cleanString(req.query.location);
    const minPrice = Number(req.query.minPrice);
    const maxPrice = Number(req.query.maxPrice);
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 9, 1), 30);
    const sort = SORTS[req.query.sort] || { "vendor.isPremium": -1, createdAt: -1, _id: 1 };

    const match = { ...publicMatch };
    if (category && CATEGORIES.includes(category)) match.category = category;
    if (location) match.location = { $regex: escapeRegex(location), $options: "i" };
    if (Number.isFinite(minPrice) || Number.isFinite(maxPrice)) {
      match.price = {};
      if (Number.isFinite(minPrice)) match.price.$gte = minPrice;
      if (Number.isFinite(maxPrice) && maxPrice > 0) match.price.$lte = maxPrice;
    }

    const afterLookup = { "vendor.isBlocked": { $ne: true } };
    if (search) {
      // every word should match somewhere: name, description, category, location or vendor
      const words = search.split(/\s+/).filter(Boolean).slice(0, 6);
      afterLookup.$and = words.map((word) => {
        const regex = { $regex: escapeRegex(word), $options: "i" };
        return {
          $or: [
            { serviceName: regex },
            { description: regex },
            { category: regex },
            { location: regex },
            { "vendor.businessName": regex },
            { "vendor.name": regex },
          ],
        };
      });
    }

    const [result] = await services
      .aggregate([
        { $match: match },
        ...lookupVendor,
        { $match: afterLookup },
        {
          $facet: {
            items: [
              { $sort: sort },
              { $skip: (page - 1) * limit },
              { $limit: limit },
              { $project: { "vendor.email": 0, "vendor.phone": 0, "vendor.isBlocked": 0 } },
            ],
            total: [{ $count: "count" }],
          },
        },
      ])
      .toArray();

    const total = result.total[0]?.count || 0;
    res.send({ services: result.items, total, page, totalPages: Math.ceil(total / limit) });
  })
);

router.get(
  "/services/featured",
  asyncHandler(async (req, res) => {
    const result = await services
      .aggregate([
        { $match: publicMatch },
        ...lookupVendor,
        { $match: { "vendor.isBlocked": { $ne: true } } },
        { $sort: { "vendor.isPremium": -1, createdAt: -1 } },
        { $limit: 6 },
        { $project: { "vendor.email": 0, "vendor.phone": 0, "vendor.isBlocked": 0 } },
      ])
      .toArray();
    res.send(result);
  })
);

router.get(
  "/services/categories",
  asyncHandler(async (req, res) => {
    const counts = await services
      .aggregate([{ $match: publicMatch }, { $group: { _id: "$category", count: { $sum: 1 } } }])
      .toArray();
    res.send(
      CATEGORIES.map((name) => ({ name, count: counts.find((c) => c._id === name)?.count || 0 }))
    );
  })
);

router.get(
  "/services/:id",
  asyncHandler(async (req, res) => {
    const _id = toObjectId(req.params.id, "service id");
    const [service] = await services
      .aggregate([
        { $match: { _id, ...publicMatch } },
        ...lookupVendor,
        { $match: { "vendor.isBlocked": { $ne: true } } },
        { $project: { "vendor.isBlocked": 0 } },
      ])
      .toArray();

    if (!service) throw new ApiError(404, "Service not found or not available right now");
    res.send(service);
  })
);

// ---------- vendor routes ----------

router.get(
  "/vendor/services",
  verifyToken,
  verifyVendor,
  asyncHandler(async (req, res) => {
    const result = await services.find({ vendorId: req.user._id }).sort({ createdAt: -1 }).toArray();
    res.send(result);
  })
);

router.get(
  "/vendor/services/:id",
  verifyToken,
  verifyVendor,
  asyncHandler(async (req, res) => {
    const _id = toObjectId(req.params.id, "service id");
    const service = await services.findOne({ _id, vendorId: req.user._id });
    if (!service) throw new ApiError(404, "Service not found");
    res.send(service);
  })
);

router.post(
  "/services",
  verifyToken,
  verifyVendor,
  asyncHandler(async (req, res) => {
    const data = validateService(req.body);
    await assertCanActivate(req.user);

    const now = new Date();
    const service = {
      ...data,
      vendorId: req.user._id,
      status: "pending",
      isAvailable: true,
      createdAt: now,
      updatedAt: now,
    };
    const result = await services.insertOne(service);
    res.status(201).send({ ...service, _id: result.insertedId });
  })
);

router.patch(
  "/services/:id",
  verifyToken,
  verifyVendor,
  asyncHandler(async (req, res) => {
    const _id = toObjectId(req.params.id, "service id");
    const data = validateService(req.body);

    const existing = await services.findOne({ _id, vendorId: req.user._id });
    if (!existing) throw new ApiError(404, "Service not found");

    // edited content needs a fresh review by admin
    const result = await services.findOneAndUpdate(
      { _id, vendorId: req.user._id },
      { $set: { ...data, status: "pending", updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    res.send(result);
  })
);

router.patch(
  "/services/:id/availability",
  verifyToken,
  verifyVendor,
  asyncHandler(async (req, res) => {
    const _id = toObjectId(req.params.id, "service id");
    if (typeof req.body.isAvailable !== "boolean") {
      throw new ApiError(400, "isAvailable must be true or false");
    }

    const existing = await services.findOne({ _id, vendorId: req.user._id });
    if (!existing) throw new ApiError(404, "Service not found");

    if (req.body.isAvailable && !existing.isAvailable && existing.status !== "rejected") {
      await assertCanActivate(req.user);
    }

    const result = await services.findOneAndUpdate(
      { _id, vendorId: req.user._id },
      { $set: { isAvailable: req.body.isAvailable, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    res.send(result);
  })
);

router.delete(
  "/services/:id",
  verifyToken,
  verifyVendor,
  asyncHandler(async (req, res) => {
    const _id = toObjectId(req.params.id, "service id");
    const result = await services.deleteOne({ _id, vendorId: req.user._id });
    if (!result.deletedCount) throw new ApiError(404, "Service not found");

    await bookings.updateMany(
      { serviceId: _id, status: "pending" },
      { $set: { status: "cancelled", updatedAt: new Date() } }
    );
    res.send({ deleted: true });
  })
);

export default router;
