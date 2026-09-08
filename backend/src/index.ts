import "dotenv/config";
import express from "express";
import cors from "cors";
import prisma from "./lib/prisma.js";
import usersRouter from "./routes/users.js";
import groupsRouter from "./routes/groups.js";

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());
app.use("/users", usersRouter);
app.use("/groups", groupsRouter);

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "ok",
      service: "vectra-backend",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(500).json({
      status: "error",
      service: "vectra-backend",
      database: "disconnected",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Vectra backend running on http://localhost:${PORT}`);
});