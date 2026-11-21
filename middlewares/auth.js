import { jwtVerify } from "jose";
import { ObjectId } from "mongodb";
import { users } from "../db.js";

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).send({ message: "Unauthorized: token missing" });
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] }));
  } catch (err) {
    const message =
      err.code === "ERR_JWT_EXPIRED" ? "Unauthorized: token expired" : "Unauthorized: invalid token";
    return res.status(401).send({ message });
  }

  if (!payload.sub || !ObjectId.isValid(payload.sub)) {
    return res.status(401).send({ message: "Unauthorized: invalid token" });
  }

  // never trust the role inside the token, always read the latest user from db
  const user = await users.findOne({ _id: new ObjectId(payload.sub) });
  if (!user) {
    return res.status(401).send({ message: "Unauthorized: user not found" });
  }
  if (user.isBlocked) {
    return res.status(403).send({ message: "Your account has been blocked by admin" });
  }

  const premiumExpired =
    user.subscriptionPlan === "premium" &&
    user.subscriptionExpiresAt &&
    new Date(user.subscriptionExpiresAt) < new Date();

  req.user = {
    ...user,
    id: user._id.toString(),
    subscriptionPlan: premiumExpired ? "free" : user.subscriptionPlan || "free",
  };
  next();
};

// use after verifyToken, e.g. verifyRole("admin")
export const verifyRole =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).send({ message: "Forbidden: you don't have access to this resource" });
    }
    next();
  };

export const verifyAdmin = verifyRole("admin");
export const verifyVendor = verifyRole("vendor");
export const verifyCustomer = verifyRole("customer");
