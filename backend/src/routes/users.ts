import { Router } from "express";
import prisma from "../lib/prisma.js";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

const router = Router();

router.post("/", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;

    const walletAddress = authReq.user.walletAddress;

    const user = await prisma.user.upsert({
      where: {
        walletAddress,
      },
      update: {
        lastSeenAt: new Date(),
      },
      create: {
        walletAddress,
      },
    });

    return res.status(200).json({
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        createdAt: user.createdAt,
        lastSeenAt: user.lastSeenAt,
      },
    });
  } catch (error) {
    console.error("Failed to create/update user:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

export default router;