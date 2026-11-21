import { MongoClient } from "mongodb";
import "dotenv/config";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is missing in environment variables");
}

const client = new MongoClient(process.env.MONGODB_URI);

// reuse the same connection between serverless invocations
let connectPromise;

export const connectDB = async () => {
  if (!connectPromise) {
    connectPromise = client.connect().then(async () => {
      await createIndexes();
      console.log("Connected to MongoDB");
      return client;
    });
  }
  return connectPromise;
};

export const db = client.db(process.env.DB_NAME || "wedplandb");

// better auth collections
export const users = db.collection("user");
export const sessions = db.collection("session");
export const accounts = db.collection("account");

// business collections
export const services = db.collection("services");
export const bookings = db.collection("bookings");
export const transactions = db.collection("transactions");

const createIndexes = async () => {
  await Promise.all([
    services.createIndex({ status: 1, isAvailable: 1, category: 1 }),
    services.createIndex({ vendorId: 1 }),
    bookings.createIndex({ serviceId: 1, eventDate: 1, status: 1 }),
    bookings.createIndex({ customerId: 1 }),
    bookings.createIndex({ vendorId: 1 }),
    transactions.createIndex({ stripeSessionId: 1 }, { unique: true }),
  ]);
};
