import { randomBytes, createHash } from "node:crypto";
import { Router } from "express";
import { verifyMessage } from "viem";
import type { Address, Hex } from "viem";
import prisma from "../lib/prisma.js";

const router = Router();

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function isValidWalletAddress(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^0x[a-fA-F0-9]{40}$/.test(value)
  );
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Create the exact message the wallet must sign.
 *
 * IMPORTANT:
 * The backend stores this complete message in AuthChallenge.
 * During verification we verify this exact message rather than trusting
 * a message supplied by the client.
 */
function buildAuthMessage(
  walletAddress: string,
  nonce: string,
  issuedAt: Date,
  expiresAt: Date
): string {
  return [
    "Vectra Authentication",
    "",
    "Sign this message to authenticate your wallet.",
    "",
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
    "",
    "This signature does not authorize any blockchain transaction.",
  ].join("\n");
}

/**
 * POST /auth/nonce
 *
 * Step 1 of authentication:
 * Wallet address -> challenge message
 */
router.post("/nonce", async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!isValidWalletAddress(walletAddress)) {
      return res.status(400).json({
        error: "Invalid wallet address",
      });
    }

    const normalizedAddress = normalizeAddress(walletAddress);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);

    const nonce = randomBytes(32).toString("hex");

    const message = buildAuthMessage(
      normalizedAddress,
      nonce,
      now,
      expiresAt
    );

    // Remove expired challenges for this wallet.
    await prisma.authChallenge.deleteMany({
      where: {
        walletAddress: normalizedAddress,
        expiresAt: {
          lt: now,
        },
      },
    });

    await prisma.authChallenge.create({
      data: {
        walletAddress: normalizedAddress,
        nonce,
        message,
        expiresAt,
      },
    });

    return res.status(200).json({
      walletAddress: normalizedAddress,
      nonce,
      message,
      expiresAt,
    });
  } catch (error) {
    console.error("Failed to create authentication challenge:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

/**
 * POST /auth/verify
 *
 * Step 2 of authentication:
 * nonce + wallet signature -> authenticated session
 */
router.post("/verify", async (req, res) => {
  try {
    const { nonce, signature } = req.body;

    if (
      typeof nonce !== "string" ||
      nonce.length === 0
    ) {
      return res.status(400).json({
        error: "Invalid nonce",
      });
    }

    if (
      typeof signature !== "string" ||
      !/^0x[0-9a-fA-F]+$/.test(signature)
    ) {
      return res.status(400).json({
        error: "Invalid signature",
      });
    }

    const challenge = await prisma.authChallenge.findUnique({
      where: {
        nonce,
      },
    });

    if (!challenge) {
      return res.status(401).json({
        error: "Authentication challenge not found or already used",
      });
    }

    const now = new Date();

    if (challenge.expiresAt.getTime() < now.getTime()) {
      await prisma.authChallenge.delete({
        where: {
          id: challenge.id,
        },
      });

      return res.status(401).json({
        error: "Authentication challenge expired",
      });
    }

    let validSignature = false;

    try {
      validSignature = await verifyMessage({
        address: challenge.walletAddress as Address,
        message: challenge.message,
        signature: signature as Hex,
      });
    } catch (error) {
      console.error("Signature verification failed:", error);

      validSignature = false;
    }

    if (!validSignature) {
      return res.status(401).json({
        error: "Invalid wallet signature",
      });
    }

    // Challenge is one-time use.
    await prisma.authChallenge.delete({
      where: {
        id: challenge.id,
      },
    });

    // Create/update the authenticated user.
    const user = await prisma.user.upsert({
      where: {
        walletAddress: challenge.walletAddress,
      },
      update: {
        lastSeenAt: now,
      },
      create: {
        walletAddress: challenge.walletAddress,
      },
    });

    // Remove expired sessions belonging to this user.
    await prisma.authSession.deleteMany({
      where: {
        userId: user.id,
        expiresAt: {
          lt: now,
        },
      },
    });

    const sessionToken = randomBytes(32).toString("hex");
    const tokenHash = hashToken(sessionToken);
    const sessionExpiresAt = new Date(
      now.getTime() + SESSION_TTL_MS
    );

    await prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: sessionExpiresAt,
      },
    });

    return res.status(200).json({
      authenticated: true,
      sessionToken,
      expiresAt: sessionExpiresAt,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
      },
    });
  } catch (error) {
    console.error("Failed to verify authentication:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (
      typeof authorization !== "string" ||
      !authorization.startsWith("Bearer ")
    ) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authorization.slice("Bearer ".length).trim();

    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const tokenHash = hashToken(token);

    await prisma.authSession.deleteMany({
      where: { tokenHash },
    });

    return res.status(200).json({
      authenticated: false,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Failed to logout:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;