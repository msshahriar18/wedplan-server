// reusable aggregation stages for joining user info

export const isPremiumExpr = (field) => ({
  $and: [
    { $eq: [`${field}.subscriptionPlan`, "premium"] },
    {
      $or: [
        { $not: [`${field}.subscriptionExpiresAt`] },
        { $gt: [`${field}.subscriptionExpiresAt`, "$$NOW"] },
      ],
    },
  ],
});

export const lookupVendor = [
  {
    $lookup: {
      from: "user",
      localField: "vendorId",
      foreignField: "_id",
      as: "vendor",
      pipeline: [
        {
          $project: {
            name: 1,
            email: 1,
            image: 1,
            businessName: 1,
            phone: 1,
            isBlocked: 1,
            subscriptionPlan: 1,
            subscriptionExpiresAt: 1,
          },
        },
      ],
    },
  },
  { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
  { $addFields: { "vendor.isPremium": isPremiumExpr("$vendor") } },
];

export const lookupCustomer = [
  {
    $lookup: {
      from: "user",
      localField: "customerId",
      foreignField: "_id",
      as: "customer",
      pipeline: [{ $project: { name: 1, email: 1, image: 1, phone: 1 } }],
    },
  },
  { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
];

export const lookupService = [
  {
    $lookup: {
      from: "services",
      localField: "serviceId",
      foreignField: "_id",
      as: "service",
      pipeline: [{ $project: { serviceName: 1, category: 1, images: 1, price: 1, location: 1 } }],
    },
  },
  { $unwind: { path: "$service", preserveNullAndEmptyArrays: true } },
];
