import "dotenv/config";
import express from "express";
import cors from "cors";
import prisma from "./lib/prisma.js";
import usersRouter from "./routes/users.js";
import groupsRouter from "./routes/groups.js";
import authRouter from "./routes/auth.js";
import { requireAuth, type AuthenticatedRequest } from "./middleware/auth.js";

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());
app.use("/auth", authRouter);
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

app.get("/auth/me", requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;

  return res.json({
    authenticated: true,
    user: authReq.user,
  });
});

app.listen(PORT, () => {
  console.log(`Vectra backend running on http://localhost:${PORT}`);
});