import express from "express";
import cors from "cors";
import "dotenv/config";
import { connectDB } from "./db.js";
import { errorHandler, notFound } from "./middlewares/error.js";

const app = express();
const port = process.env.PORT || 5000;

const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((url) => url.trim());

app.use(cors({ origin: allowedOrigins, credentials: true }));

// make sure mongo is connected before any route runs
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.send("WedPlan server is running");
});

app.use(notFound);
app.use(errorHandler);

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`WedPlan server listening on port ${port}`);
  });
}

export default app;
