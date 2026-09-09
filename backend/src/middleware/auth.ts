import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import prisma from "../lib/prisma.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type AuthenticatedRequest = Request & {
  user: {
    id: string;
    walletAddress: string;
  };
};

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authorization = req.headers.authorization;

    if (
      typeof authorization !== "string" ||
      !authorization.startsWith("Bearer ")
    ) {
      return res.status(401).json({
        error: "Authentication required",
      });
    }

    const token = authorization.slice("Bearer ".length).trim();

    if (!token) {
      return res.status(401).json({
        error: "Authentication required",
      });
    }

    const tokenHash = hashToken(token);

    const session = await prisma.authSession.findUnique({
      where: {
        tokenHash,
      },
      include: {
        user: true,
      },
    });

    if (!session) {
      return res.status(401).json({
        error: "Invalid session",
      });
    }

    const now = new Date();

    if (session.expiresAt.getTime() <= now.getTime()) {
      await prisma.authSession.delete({
        where: {
          id: session.id,
        },
      });

      return res.status(401).json({
        error: "Session expired",
      });
    }

    (req as AuthenticatedRequest).user = {
      id: session.user.id,
      walletAddress: session.user.walletAddress,
    };

    return next();
  } catch (error) {
    console.error("Authentication middleware failed:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
}