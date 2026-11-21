import { Router } from "express";
import { bookings, services, transactions, users } from "../db.js";
import { verifyAdmin, verifyCustomer, verifyToken, verifyVendor } from "../middlewares/auth.js";
import { asyncHandler } from "../middlewares/error.js";
import { FREE_SERVICE_LIMIT, countActiveServices } from "./services.js";

const router = Router();

const countByStatus = async (collection, match) => {
  const rows = await collection
    .aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }])
    .toArray();
  return rows.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});
};

router.get(
  "/stats/customer",
  verifyToken,
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const byStatus = await countByStatus(bookings, { customerId: req.user._id });
    const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
    const recent = await bookings
      .aggregate([
        { $match: { customerId: req.user._id } },
        { $sort: { createdAt: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "services",
            localField: "serviceId",
            foreignField: "_id",
            as: "service",
            pipeline: [{ $project: { serviceName: 1, images: 1, category: 1 } }],
          },
        },
        { $unwind: { path: "$service", preserveNullAndEmptyArrays: true } },
      ])
      .toArray();

    res.send({
      total,
      pending: byStatus.pending || 0,
      accepted: byStatus.accepted || 0,
      rejected: byStatus.rejected || 0,
      cancelled: byStatus.cancelled || 0,
      recent,
    });
  })
);

router.get(
  "/stats/vendor",
  verifyToken,
  verifyVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user._id;
    const [serviceStatus, activeServices, bookingStatus] = await Promise.all([
      countByStatus(services, { vendorId }),
      countActiveServices(vendorId),
      countByStatus(bookings, { vendorId }),
    ]);

    res.send({
      totalServices: Object.values(serviceStatus).reduce((sum, n) => sum + n, 0),
      activeServices,
      approvedServices: serviceStatus.approved || 0,
      pendingServices: serviceStatus.pending || 0,
      pendingBookings: bookingStatus.pending || 0,
      acceptedBookings: bookingStatus.accepted || 0,
      totalBookings: Object.values(bookingStatus).reduce((sum, n) => sum + n, 0),
      plan: req.user.subscriptionPlan,
      subscriptionExpiresAt: req.user.subscriptionExpiresAt || null,
      freeLimit: FREE_SERVICE_LIMIT,
    });
  })
);

router.get(
  "/stats/admin",
  verifyToken,
  verifyAdmin,
  asyncHandler(async (req, res) => {
    const [roles, serviceStatus, txStats, bookingTotal] = await Promise.all([
      users.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]).toArray(),
      countByStatus(services, {}),
      transactions
        .aggregate([
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              revenue: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0] } },
            },
          },
        ])
        .toArray(),
      bookings.countDocuments(),
    ]);

    const roleCount = roles.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});
    res.send({
      totalUsers: Object.values(roleCount).reduce((sum, n) => sum + n, 0),
      totalVendors: roleCount.vendor || 0,
      totalCustomers: roleCount.customer || 0,
      totalServices: Object.values(serviceStatus).reduce((sum, n) => sum + n, 0),
      pendingServices: serviceStatus.pending || 0,
      approvedServices: serviceStatus.approved || 0,
      totalTransactions: txStats[0]?.count || 0,
      totalRevenue: txStats[0]?.revenue || 0,
      totalBookings: bookingTotal,
    });
  })
);

export default router;
