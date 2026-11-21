import { Router } from "express";
import { bookings, services, users } from "../db.js";
import { verifyToken } from "../middlewares/auth.js";
import { ApiError, asyncHandler } from "../middlewares/error.js";
import { cleanString, isUrl } from "../utils/validate.js";

const router = Router();

const publicProfile = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  image: user.image || null,
  role: user.role,
  businessName: user.businessName || "",
  phone: user.phone || "",
  bio: user.bio || "",
  subscriptionPlan: user.subscriptionPlan,
  subscriptionExpiresAt: user.subscriptionExpiresAt || null,
  roleSelected: user.roleSelected !== false,
  createdAt: user.createdAt,
});

router.get(
  "/users/me",
  verifyToken,
  asyncHandler(async (req, res) => {
    res.send(publicProfile(req.user));
  })
);

// only these fields can be changed by the user, role/plan/isBlocked are ignored
router.patch(
  "/users/me",
  verifyToken,
  asyncHandler(async (req, res) => {
    const update = {};
    const { name, image, phone, bio, businessName } = req.body;

    if (name !== undefined) {
      const value = cleanString(name);
      if (value.length < 2 || value.length > 60) {
        throw new ApiError(400, "Name must be between 2 and 60 characters");
      }
      update.name = value;
    }
    if (image !== undefined) {
      if (image && !isUrl(image)) throw new ApiError(400, "Invalid image url");
      update.image = image || null;
    }
    if (phone !== undefined) {
      const value = cleanString(phone);
      if (value && !/^[+\d][\d\s-]{6,18}$/.test(value)) {
        throw new ApiError(400, "Please enter a valid phone number");
      }
      update.phone = value;
    }
    if (bio !== undefined) update.bio = cleanString(bio).slice(0, 300);
    if (businessName !== undefined && req.user.role === "vendor") {
      const value = cleanString(businessName);
      if (value.length < 2) throw new ApiError(400, "Business name is required for vendors");
      update.businessName = value.slice(0, 80);
    }

    if (Object.keys(update).length === 0) throw new ApiError(400, "Nothing to update");

    const result = await users.findOneAndUpdate(
      { _id: req.user._id },
      { $set: { ...update, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    res.send(publicProfile(result));
  })
);

// google sign ups land here once to pick customer or vendor
router.patch(
  "/users/me/role",
  verifyToken,
  asyncHandler(async (req, res) => {
    const { role } = req.body;
    const businessName = cleanString(req.body.businessName);

    if (!["customer", "vendor"].includes(role)) throw new ApiError(400, "Choose customer or vendor");
    if (req.user.role === "admin") throw new ApiError(403, "Admin role cannot be changed");
    if (req.user.roleSelected !== false) {
      throw new ApiError(409, "Your account role is already set");
    }
    if (role === "vendor" && businessName.length < 2) {
      throw new ApiError(400, "Business name is required for vendors");
    }

    // extra safety: never switch role once the account has activity
    const [serviceCount, bookingCount] = await Promise.all([
      services.countDocuments({ vendorId: req.user._id }),
      bookings.countDocuments({ customerId: req.user._id }),
    ]);
    if (serviceCount || bookingCount) throw new ApiError(409, "Your account role is already set");

    const set = { role, roleSelected: true, updatedAt: new Date() };
    if (role === "vendor") set.businessName = businessName.slice(0, 80);

    const result = await users.findOneAndUpdate(
      { _id: req.user._id, roleSelected: false },
      { $set: set },
      { returnDocument: "after" }
    );
    if (!result) throw new ApiError(409, "Your account role is already set");
    res.send(publicProfile(result));
  })
);

export default router;
