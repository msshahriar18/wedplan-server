import { ObjectId } from "mongodb";
import { ApiError } from "../middlewares/error.js";

export const CATEGORIES = [
  "Photography & Videography",
  "Wedding Venues",
  "Decoration & Florist",
  "Catering Services",
  "Makeup & Styling",
  "Wedding Fashion",
];

export const toObjectId = (id, label = "id") => {
  if (!ObjectId.isValid(id)) throw new ApiError(400, `Invalid ${label}`);
  return new ObjectId(id);
};

export const cleanString = (value) => (typeof value === "string" ? value.trim() : "");

export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const isUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

// returns a clean service object or throws 400 with the first problem found
export const validateService = (body) => {
  const serviceName = cleanString(body.serviceName);
  const category = cleanString(body.category);
  const description = cleanString(body.description);
  const location = cleanString(body.location);
  const price = Number(body.price);
  const images = Array.isArray(body.images) ? body.images.filter(isUrl) : [];

  if (serviceName.length < 3 || serviceName.length > 100) {
    throw new ApiError(400, "Service name must be between 3 and 100 characters");
  }
  if (!CATEGORIES.includes(category)) throw new ApiError(400, "Please choose a valid category");
  if (description.length < 20) {
    throw new ApiError(400, "Description should be at least 20 characters");
  }
  if (!Number.isFinite(price) || price <= 0) throw new ApiError(400, "Price must be a positive number");
  if (!location) throw new ApiError(400, "Location is required");
  if (images.length === 0) throw new ApiError(400, "Upload at least one service image");
  if (images.length > 6) throw new ApiError(400, "You can upload up to 6 images");

  return { serviceName, category, description, price, location, images };
};
