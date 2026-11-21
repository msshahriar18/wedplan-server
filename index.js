import express from "express";
import cors from "cors";
import "dotenv/config";
import { connectDB } from "./db.js";
import { errorHandler, notFound } from "./middlewares/error.js";
import servicesRouter from "./routes/services.js";
import bookingsRouter from "./routes/bookings.js";
import usersRouter from "./routes/users.js";
import adminRouter from "./routes/admin.js";
import statsRouter from "./routes/stats.js";
import paymentsRouter from "./routes/payments.js";

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

app.use(servicesRouter);
app.use(bookingsRouter);
app.use(usersRouter);
app.use(adminRouter);
app.use(statsRouter);
app.use(paymentsRouter);

app.use(notFound);
app.use(errorHandler);

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`WedPlan server listening on port ${port}`);
  });
}

export default app;
