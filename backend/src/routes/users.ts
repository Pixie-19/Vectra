import { Router } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (
      typeof walletAddress !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)
    ) {
      return res.status(400).json({
        error: "Invalid wallet address",
      });
    }

    const normalizedAddress = walletAddress.toLowerCase();

    const user = await prisma.user.upsert({
      where: {
        walletAddress: normalizedAddress,
      },
      update: {
        lastSeenAt: new Date(),
      },
      create: {
        walletAddress: normalizedAddress,
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