import { Router } from "express";
import { parseEventLogs, isAddress, isHash, type Hex } from "viem";
import prisma from "../lib/prisma.js";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { arcClient, VECTRA_TREASURY_ADDRESS } from "../lib/arc.js";
import { vectraTreasuryAbi } from "../lib/contract.js";

const router = Router();

router.post("/", requireAuth, async (req, res) => {
  try {
    const { name, blockchainGroupId, inviteCode } = req.body;
    const authReq = req as AuthenticatedRequest;

    const walletAddress = authReq.user.walletAddress;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof blockchainGroupId !== "string" ||
      !/^0x[a-fA-F0-9]{64}$/.test(blockchainGroupId) ||
      typeof inviteCode !== "string" ||
      !inviteCode.trim()
    ) {
      return res.status(400).json({
        error: "Invalid group data",
      });
    }

    const normalizedWalletAddress = walletAddress.toLowerCase();
    const normalizedBlockchainGroupId = blockchainGroupId.toLowerCase();

    const user = await prisma.user.upsert({
      where: {
        walletAddress: normalizedWalletAddress,
      },
      update: {
        lastSeenAt: new Date(),
      },
      create: {
        walletAddress: normalizedWalletAddress,
      },
    });

    const existingGroup = await prisma.group.findFirst({
      where: {
        OR: [
          {
            blockchainGroupId: normalizedBlockchainGroupId,
          },
          {
            inviteCode: inviteCode.trim().toUpperCase(),
          },
        ],
      },
    });

    if (existingGroup) {
      return res.status(409).json({
        error: "Group or invite code already exists",
      });
    }

    const group = await prisma.group.create({
      data: {
        name: name.trim(),
        blockchainGroupId: normalizedBlockchainGroupId,
        coordinatorAddress: user.walletAddress,
        inviteCode: inviteCode.trim(),
        memberships: {
          create: {
            walletAddress: user.walletAddress,
            role: "COORDINATOR",
          },
        },
      },
      include: {
        memberships: true,
      },
    });

    return res.status(201).json({
      group,
    });
  } catch (error) {
    console.error("Failed to create group:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;

    const walletAddress = authReq.user.walletAddress;

    const groups = await prisma.group.findMany({
      where: {
        status: "ACTIVE",
        memberships: {
          some: {
            walletAddress,
          },
        },
      },
      include: {
        memberships: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      groups,
    });
  } catch (error) {
    console.error("Failed to fetch groups:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.post("/join", requireAuth, async (req, res) => {
  try {
    const { inviteCode } = req.body;
    const authReq = req as AuthenticatedRequest;

    const walletAddress = authReq.user.walletAddress;

    if (typeof inviteCode !== "string" || !inviteCode.trim()) {
      return res.status(400).json({
        error: "Invalid join data",
      });
    }

    const normalizedWalletAddress = walletAddress.toLowerCase();
    const normalizedInviteCode = inviteCode.trim().toUpperCase();

    const user = await prisma.user.upsert({
      where: {
        walletAddress: normalizedWalletAddress,
      },
      update: {
        lastSeenAt: new Date(),
      },
      create: {
        walletAddress: normalizedWalletAddress,
      },
    });

    const group = await prisma.group.findUnique({
      where: {
        inviteCode: normalizedInviteCode,
      },
      include: {
        memberships: true,
      },
    });

    if (!group) {
      return res.status(404).json({
        error: "Invalid invite code",
      });
    }

    if (group.status !== "ACTIVE") {
      return res.status(400).json({
        error: "This group is no longer active",
      });
    }

    const existingMembership = group.memberships.find(
      (membership) =>
        membership.walletAddress.toLowerCase() ===
        normalizedWalletAddress
    );

    if (existingMembership) {
      return res.status(409).json({
        error: "You are already a member of this group",
      });
    }

    const membership = await prisma.membership.create({
      data: {
        groupId: group.id,
        walletAddress: user.walletAddress,
        role: "MEMBER",
      },
    });

    return res.status(201).json({
      message: "Successfully joined group",
      group: {
        id: group.id,
        blockchainGroupId: group.blockchainGroupId,
        name: group.name,
        coordinatorAddress: group.coordinatorAddress,
        status: group.status,
      },
      membership,
    });
  } catch (error) {
    console.error("Failed to join group:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.patch(
  "/:groupId/deactivate",
  requireAuth,
  async (req, res) => {
    try {
    const { groupId } = req.params;
    const authReq = req as AuthenticatedRequest;

    const walletAddress = authReq.user.walletAddress;

    if (typeof groupId !== "string" || !groupId.trim()) {
    return res.status(400).json({
      error: "Invalid deactivation data",
    });
  }

    const normalizedWalletAddress = walletAddress.toLowerCase();

    const group = await prisma.group.findUnique({
      where: {
        id: groupId,
      },
    });

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    if (
      group.coordinatorAddress.toLowerCase() !==
      normalizedWalletAddress
    ) {
      return res.status(403).json({
        error: "Only the group coordinator can deactivate the group",
      });
    }

    if (group.status === "DEACTIVATED") {
      return res.status(400).json({
        error: "Group is already deactivated",
      });
    }

    const updatedGroup = await prisma.group.update({
      where: {
        id: group.id,
      },
      data: {
        status: "DEACTIVATED",
      },
    });

    return res.status(200).json({
      message: "Group deactivated successfully",
      group: updatedGroup,
    });
  } catch (error) {
    console.error("Failed to deactivate group:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.get("/:groupId", requireAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const authReq = req as AuthenticatedRequest;

    const walletAddress = authReq.user.walletAddress;

    if (typeof groupId !== "string" || !groupId.trim()) {
    return res.status(400).json({
      error: "Invalid group request",
    });
  }

    const normalizedWalletAddress = walletAddress.toLowerCase();

    const group = await prisma.group.findUnique({
      where: {
        id: groupId,
      },
      include: {
        memberships: {
          orderBy: {
            joinedAt: "asc",
          },
        },
      },
    });

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    const isMember = group.memberships.some(
      (membership) =>
        membership.walletAddress.toLowerCase() ===
        normalizedWalletAddress
    );

    if (!isMember) {
      return res.status(403).json({
        error: "You are not a member of this group",
      });
    }

    return res.status(200).json({
      group: {
        id: group.id,
        blockchainGroupId: group.blockchainGroupId,
        name: group.name,
        coordinatorAddress: group.coordinatorAddress,
        inviteCode: group.inviteCode,
        status: group.status,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        memberships: group.memberships,
      },
    });
  } catch (error) {
    console.error("Failed to fetch group details:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.post(
  "/:groupId/expenses",
  requireAuth,
  async (req, res) => {
      try {
    const { groupId } = req.params;
      const { description, amount, paidBy } = req.body;

      const authReq = req as AuthenticatedRequest;
      const walletAddress = authReq.user.walletAddress;

    if (
      typeof groupId !== "string" ||
      !groupId.trim() ||
      typeof description !== "string" ||
      !description.trim() ||
      typeof amount !== "string" ||
      typeof paidBy !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(paidBy)
    ) {
      return res.status(400).json({
        error: "Invalid expense data",
      });
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        error: "Amount must be greater than zero",
      });
    }

    const normalizedWalletAddress = walletAddress.toLowerCase();
    const normalizedPaidBy = paidBy.toLowerCase();

    const group = await prisma.group.findUnique({
      where: {
        id: groupId,
      },
      include: {
        memberships: true,
      },
    });

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    if (group.status !== "ACTIVE") {
      return res.status(400).json({
        error: "Cannot add expenses to a deactivated group",
      });
    }

    const creatorMembership = group.memberships.find(
      (membership) =>
        membership.walletAddress.toLowerCase() ===
        normalizedWalletAddress
    );

    if (!creatorMembership) {
      return res.status(403).json({
        error: "You are not a member of this group",
      });
    }

    const payerMembership = group.memberships.find(
      (membership) =>
        membership.walletAddress.toLowerCase() ===
        normalizedPaidBy
    );

    if (!payerMembership) {
      return res.status(400).json({
        error: "paidBy wallet is not a member of this group",
      });
    }

    const expense = await prisma.expense.create({
      data: {
        groupId: group.id,
        description: description.trim(),
        amount,
        paidBy: normalizedPaidBy,
        createdBy: normalizedWalletAddress,
      },
    });

    return res.status(201).json({
      expense,
    });
  } catch (error) {
    console.error("Failed to create expense:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.get(
  "/:groupId/expenses",
  requireAuth,
  async (req, res) => {
    try {
    const { groupId } = req.params;
    const authReq = req as AuthenticatedRequest;
    const walletAddress = authReq.user.walletAddress;

    if (typeof groupId !== "string" || !groupId.trim()) {
      return res.status(400).json({
        error: "Invalid expense request",
      });
    }

    const normalizedWalletAddress = walletAddress.toLowerCase();

    const group = await prisma.group.findUnique({
      where: {
        id: groupId,
      },
      include: {
        memberships: true,
      },
    });

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    const isMember = group.memberships.some(
      (membership) =>
        membership.walletAddress.toLowerCase() ===
        normalizedWalletAddress
    );

    if (!isMember) {
      return res.status(403).json({
        error: "You are not a member of this group",
      });
    }

    const expenses = await prisma.expense.findMany({
      where: {
        groupId: group.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      expenses,
    });
  } catch (error) {
    console.error("Failed to fetch expenses:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.delete(
  "/:groupId/expenses/:expenseId",
  requireAuth,
  async (req, res) => {
    try {
    const { groupId, expenseId } = req.params;

    const authReq = req as AuthenticatedRequest;
    const walletAddress = authReq.user.walletAddress;

    if (
      typeof groupId !== "string" ||
      !groupId.trim() ||
      typeof expenseId !== "string" ||
      !expenseId.trim()
    ) {
      return res.status(400).json({
        error: "Invalid delete expense request",
      });
    }

    const normalizedWalletAddress = walletAddress.toLowerCase();

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { memberships: true },
    });

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    const isMember = group.memberships.some(
      (m) => m.walletAddress.toLowerCase() === normalizedWalletAddress
    );

    if (!isMember) {
      return res.status(403).json({
        error: "You are not a member of this group",
      });
    }

    const expense = await prisma.expense.findFirst({
      where: {
        id: expenseId,
        groupId: group.id,
      },
    });

    if (!expense) {
      return res.status(404).json({
        error: "Expense not found",
      });
    }

    if (expense.settled) {
      return res.status(400).json({
        error: "Cannot delete an already settled expense",
      });
    }

    if (
      expense.createdBy.toLowerCase() !==
      normalizedWalletAddress
    ) {
      return res.status(403).json({
        error: "You can only delete expenses you created",
      });
    }

    await prisma.expense.delete({
      where: { id: expense.id },
    });

    return res.status(200).json({
      message: "Expense deleted successfully",
      id: expense.id,
    });
  } catch (error) {
    console.error("Failed to delete expense:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.post(
  "/:groupId/settlements",
  requireAuth,
  async (req, res) => {  try {
    const { groupId } = req.params;
    const { nonce, totalAmount } = req.body;

    const authReq = req as AuthenticatedRequest;
    const walletAddress = authReq.user.walletAddress;

    if (
      typeof groupId !== "string" ||
      !groupId.trim() ||
      (typeof nonce !== "string" &&
        typeof nonce !== "number" &&
        typeof nonce !== "bigint") ||
      (typeof totalAmount !== "string" && typeof totalAmount !== "number")
    ) {
      return res.status(400).json({
        error: "Invalid settlement request data",
      });
    }

    const normalizedWalletAddress = walletAddress.toLowerCase();
    const parsedNonce = BigInt(nonce.toString());
    const numTotal = Number(totalAmount);

    if (!Number.isFinite(numTotal) || numTotal <= 0) {
      return res.status(400).json({
        error: "Invalid total amount",
      });
    }

    const group = await prisma.group.findUnique({
      where: { id: groupId },
    });

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    if (group.status !== "ACTIVE") {
      return res.status(400).json({
        error: "Group is deactivated",
      });
    }

    const isMember = await prisma.membership.findFirst({
      where: {
        groupId: group.id,
        walletAddress: normalizedWalletAddress,
      },
    });

    if (
      group.coordinatorAddress.toLowerCase() !== normalizedWalletAddress &&
      !isMember
    ) {
      return res.status(403).json({
        error: "Only group members can initiate a settlement",
      });
    }

    const existingSettlement = await prisma.settlement.findUnique({
      where: {
        groupId_nonce: {
          groupId: group.id,
          nonce: parsedNonce,
        },
      },
    });

    let settlement;

    if (existingSettlement) {
      if (existingSettlement.status === "COMPLETED") {
        return res.status(409).json({
          error: "A settlement with this nonce has already been completed",
        });
      }

      settlement = await prisma.settlement.update({
        where: { id: existingSettlement.id },
        data: {
          totalAmount: numTotal.toFixed(6),
          status: "PENDING",
          initiatedBy: normalizedWalletAddress,
          transactionHash: null,
          completedAt: null,
        },
      });
    } else {
      settlement = await prisma.settlement.create({
        data: {
          groupId: group.id,
          nonce: parsedNonce,
          totalAmount: numTotal.toFixed(6),
          status: "PENDING",
          initiatedBy: normalizedWalletAddress,
        },
      });
    }

    return res.status(201).json({
      settlement: {
        id: settlement.id,
        groupId: settlement.groupId,
        nonce: settlement.nonce.toString(),
        totalAmount: settlement.totalAmount.toString(),
        status: settlement.status,
        initiatedBy: settlement.initiatedBy,
        transactionHash: settlement.transactionHash,
        createdAt: settlement.createdAt,
        completedAt: settlement.completedAt,
      },
    });
  } catch (error) {
    console.error("Failed to create settlement record:", error);

    // Handle Prisma unique constraint violation for (groupId, nonce)
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002" &&
      "meta" in error &&
      error.meta &&
      typeof error.meta === "object" &&
      "target" in error.meta &&
      Array.isArray(error.meta.target) &&
      (error.meta.target.includes("groupId") ||
        error.meta.target.includes("nonce") ||
        error.meta.target.toString().includes("groupId_nonce"))
    ) {
      return res.status(409).json({
        error:
          "A settlement with this nonce already exists for this group. The nonce may have been consumed by another request.",
      });
    }

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

/**
 * Verify that a transaction hash represents a successful settlement
 * execution on the VectraTreasury contract on Arc Testnet.
 *
 * This function independently verifies blockchain state to prevent
 * fraudulent settlement completion claims from the frontend.
 *
 * @param transactionHash - The transaction hash to verify
 * @param group - The PostgreSQL group record
 * @param settlement - The PostgreSQL settlement record
 * @returns An object with success boolean and optional error message
 */
async function verifySettlementTransaction(
  transactionHash: string,
  group: { blockchainGroupId: string; coordinatorAddress: string },
  settlement: { nonce: bigint }
): Promise<{ success: true } | { success: false; error: string; statusCode: number }> {
  // 1. Validate transaction hash format
  if (!isHash(transactionHash)) {
    return {
      success: false,
      error: "Invalid transaction hash format",
      statusCode: 400,
    };
  }

  let receipt;

  try {
    // 2. Fetch transaction receipt from Arc Testnet
    receipt = await arcClient.getTransactionReceipt({
      hash: transactionHash as Hex,
    });
  } catch (error) {
    // RPC failure (network error, Arc node down, etc.)
    console.error("Failed to fetch transaction receipt from Arc:", error);
    return {
      success: false,
      error: "Unable to verify transaction on Arc. Please try again later.",
      statusCode: 503,
    };
  }

  // 3. Check if transaction exists and is confirmed
  if (!receipt) {
    return {
      success: false,
      error: "Transaction not found on Arc. It may still be pending or the hash is invalid.",
      statusCode: 400,
    };
  }

  // 4. Verify transaction succeeded
  if (receipt.status !== "success") {
    return {
      success: false,
      error: "Transaction reverted on Arc. Settlement cannot be completed.",
      statusCode: 400,
    };
  }

  // 5. Verify transaction targeted VectraTreasury contract
  if (
    !receipt.to ||
    receipt.to.toLowerCase() !== VECTRA_TREASURY_ADDRESS.toLowerCase()
  ) {
    return {
      success: false,
      error: "Transaction does not target VectraTreasury contract.",
      statusCode: 400,
    };
  }

  // 6. Parse SettlementIntentExecuted event from logs
  let settlementEvents;

  try {
    settlementEvents = parseEventLogs({
      abi: vectraTreasuryAbi,
      logs: receipt.logs,
      eventName: "SettlementIntentExecuted",
    });
  } catch (error) {
    console.error("Failed to parse settlement events:", error);
    return {
      success: false,
      error: "Failed to parse transaction logs",
      statusCode: 400,
    };
  }

  // 7. Verify event was emitted
  if (settlementEvents.length === 0) {
    return {
      success: false,
      error:
        "Settlement event not found. Transaction may have called a different function.",
      statusCode: 400,
    };
  }

  // Use the first matching event
  const event = settlementEvents[0];
  const { groupId: eventGroupId, signer: eventSigner, nonce: eventNonce } = event.args;

  // 8. Verify groupId matches
  if (
    !eventGroupId ||
    eventGroupId.toLowerCase() !== group.blockchainGroupId.toLowerCase()
  ) {
    return {
      success: false,
      error: "Transaction belongs to a different group.",
      statusCode: 400,
    };
  }

  // 9. Verify signer is the coordinator
  if (
    !eventSigner ||
    eventSigner.toLowerCase() !== group.coordinatorAddress.toLowerCase()
  ) {
    return {
      success: false,
      error: "Transaction was not signed by the group coordinator.",
      statusCode: 400,
    };
  }

  // 10. Verify nonce matches
  if (eventNonce === undefined || BigInt(eventNonce) !== settlement.nonce) {
    return {
      success: false,
      error: "Transaction nonce does not match settlement record.",
      statusCode: 400,
    };
  }

  // All verifications passed
  return { success: true };
}

router.patch(
  "/:groupId/settlements/:settlementId",
  requireAuth,
  async (req, res) => {  try {
    const { groupId, settlementId } = req.params;
const { status, transactionHash, expenseIds } = req.body;

const authReq = req as AuthenticatedRequest;
const walletAddress = authReq.user.walletAddress;

    if (
      typeof groupId !== "string" ||
      !groupId.trim() ||
      typeof settlementId !== "string" ||
      !settlementId.trim() ||
      !["SUBMITTED", "COMPLETED", "FAILED"].includes(status)
    ) {
      return res.status(400).json({
        error: "Invalid settlement update data",
      });
    }

    const normalizedWalletAddress = walletAddress.toLowerCase();

    const group = await prisma.group.findUnique({
      where: { id: groupId },
    });

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    if (
      group.coordinatorAddress.toLowerCase() !==
      normalizedWalletAddress
    ) {
      return res.status(403).json({
        error: "Only the group coordinator can update settlements",
      });
    }

    const settlement = await prisma.settlement.findFirst({
      where: {
        id: settlementId,
        groupId: group.id,
      },
    });

    if (!settlement) {
      return res.status(404).json({
        error: "Settlement not found",
      });
    }

    let updatedSettlement;

    if (status === "SUBMITTED") {
      updatedSettlement = await prisma.settlement.update({
        where: { id: settlement.id },
        data: {
          status: "SUBMITTED",
          transactionHash:
            typeof transactionHash === "string"
              ? transactionHash
              : settlement.transactionHash,
        },
      });
    } else if (status === "COMPLETED") {
      // Verify transactionHash is provided
      if (typeof transactionHash !== "string" || !transactionHash.trim()) {
        return res.status(400).json({
          error: "Transaction hash is required for COMPLETED status",
        });
      }

      // Check if settlement is already COMPLETED (idempotency check)
      if (settlement.status === "COMPLETED") {
        // Settlement already completed - return current state (idempotent)
        return res.status(200).json({
          message: "Settlement already completed",
          settlement: {
            id: settlement.id,
            groupId: settlement.groupId,
            nonce: settlement.nonce.toString(),
            totalAmount: settlement.totalAmount.toString(),
            status: settlement.status,
            initiatedBy: settlement.initiatedBy,
            transactionHash: settlement.transactionHash,
            createdAt: settlement.createdAt,
            completedAt: settlement.completedAt,
          },
        });
      }

      // Check for transaction hash reuse
      const existingUse = await prisma.settlement.findFirst({
        where: {
          transactionHash,
          id: { not: settlement.id },
        },
      });

      if (existingUse) {
        return res.status(409).json({
          error: "Transaction hash already used for another settlement",
        });
      }

      // Perform on-chain verification
      const verificationResult = await verifySettlementTransaction(
        transactionHash,
        {
          blockchainGroupId: group.blockchainGroupId,
          coordinatorAddress: group.coordinatorAddress,
        },
        {
          nonce: settlement.nonce,
        }
      );

      if (!verificationResult.success) {
        return res.status(verificationResult.statusCode).json({
          error: verificationResult.error,
        });
      }

      // Validation passed - proceed with expense validation
      const validExpenseIds = Array.isArray(expenseIds)
        ? expenseIds.filter(
            (id: unknown): id is string =>
              typeof id === "string" && Boolean(id.trim())
          )
        : [];

      if (validExpenseIds.length > 0) {
        const expensesToSettle = await prisma.expense.findMany({
          where: {
            id: { in: validExpenseIds },
            groupId: group.id,
            settled: false,
          },
        });

        if (expensesToSettle.length !== validExpenseIds.length) {
          return res.status(400).json({
            error:
              "Some expenses are invalid, already settled, or don't belong to this group",
          });
        }
      }

      // Perform atomic conditional update within transaction
      // Only updates if settlement is NOT already COMPLETED
      let completedRecord;

      try {
        const result = await prisma.$transaction(async (tx) => {
          // Attempt conditional update - only succeeds if status is not already COMPLETED
          const updateCount = await tx.settlement.updateMany({
            where: {
              id: settlement.id,
              status: { not: "COMPLETED" }, // Conditional: only update if NOT completed
            },
            data: {
              status: "COMPLETED",
              transactionHash,
              completedAt: new Date(),
            },
          });

          // Check if update succeeded (updateCount.count > 0)
          if (updateCount.count === 0) {
            // Settlement was already completed by another request
            // Fetch current state and return it
            const current = await tx.settlement.findUnique({
              where: { id: settlement.id },
            });

            return { alreadyCompleted: true, settlement: current };
          }

          // Update succeeded - mark expenses as settled
          if (validExpenseIds.length > 0) {
            await tx.expense.updateMany({
              where: {
                id: { in: validExpenseIds },
                groupId: group.id,
              },
              data: {
                settled: true,
              },
            });
          }

          // Fetch the updated settlement record
          const updated = await tx.settlement.findUnique({
            where: { id: settlement.id },
          });

          return { alreadyCompleted: false, settlement: updated };
        });

        if (result.alreadyCompleted) {
          // Another request completed it first - return idempotent response
          return res.status(200).json({
            message: "Settlement already completed",
            settlement: {
              id: result.settlement!.id,
              groupId: result.settlement!.groupId,
              nonce: result.settlement!.nonce.toString(),
              totalAmount: result.settlement!.totalAmount.toString(),
              status: result.settlement!.status,
              initiatedBy: result.settlement!.initiatedBy,
              transactionHash: result.settlement!.transactionHash,
              createdAt: result.settlement!.createdAt,
              completedAt: result.settlement!.completedAt,
            },
          });
        }

        completedRecord = result.settlement;
      } catch (txError) {
        console.error("Transaction failed during settlement completion:", txError);
        throw txError;
      }

      updatedSettlement = completedRecord;
    } else if (status === "FAILED") {
      updatedSettlement = await prisma.settlement.update({
        where: { id: settlement.id },
        data: {
          status: "FAILED",
        },
      });
    }

    return res.status(200).json({
      message: `Settlement updated to ${status}`,
      settlement: {
        id: updatedSettlement!.id,
        groupId: updatedSettlement!.groupId,
        nonce: updatedSettlement!.nonce.toString(),
        totalAmount: updatedSettlement!.totalAmount.toString(),
        status: updatedSettlement!.status,
        initiatedBy: updatedSettlement!.initiatedBy,
        transactionHash: updatedSettlement!.transactionHash,
        createdAt: updatedSettlement!.createdAt,
        completedAt: updatedSettlement!.completedAt,
      },
    });
  } catch (error) {
    console.error("Failed to update settlement:", error);

    // Handle Prisma unique constraint violation for transactionHash
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002" &&
      "meta" in error &&
      error.meta &&
      typeof error.meta === "object" &&
      "target" in error.meta &&
      Array.isArray(error.meta.target) &&
      error.meta.target.includes("transactionHash")
    ) {
      return res.status(409).json({
        error:
          "Transaction hash is already associated with another settlement",
      });
    }

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

export default router;