import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();
const port = process.env.PORT || 5000;

const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((url) => url.trim());

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("WedPlan server is running");
});

app.listen(port, () => {
  console.log(`WedPlan server listening on port ${port}`);
});
