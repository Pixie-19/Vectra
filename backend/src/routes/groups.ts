import { Router } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { name, blockchainGroupId, walletAddress, inviteCode } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof blockchainGroupId !== "string" ||
      !/^0x[a-fA-F0-9]{64}$/.test(blockchainGroupId) ||
      typeof walletAddress !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(walletAddress) ||
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

router.get("/", async (req, res) => {
  try {
    const { walletAddress } = req.query;

    if (
      typeof walletAddress !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)
    ) {
      return res.status(400).json({
        error: "Invalid wallet address",
      });
    }

    const normalizedWalletAddress = walletAddress.toLowerCase();

    const groups = await prisma.group.findMany({
      where: {
        status: "ACTIVE",
        memberships: {
          some: {
            walletAddress: normalizedWalletAddress,
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

router.post("/join", async (req, res) => {
  try {
    const { inviteCode, walletAddress } = req.body;

    if (
      typeof inviteCode !== "string" ||
      !inviteCode.trim() ||
      typeof walletAddress !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)
    ) {
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

router.patch("/:groupId/deactivate", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { walletAddress } = req.body;

    if (
      typeof groupId !== "string" ||
      !groupId.trim() ||
      typeof walletAddress !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)
    ) {
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

router.get("/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { walletAddress } = req.query;

    if (
      typeof groupId !== "string" ||
      !groupId.trim() ||
      typeof walletAddress !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)
    ) {
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

router.post("/:groupId/expenses", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { description, amount, paidBy, walletAddress } = req.body;

    if (
      typeof groupId !== "string" ||
      !groupId.trim() ||
      typeof description !== "string" ||
      !description.trim() ||
      typeof amount !== "string" ||
      typeof paidBy !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(paidBy) ||
      typeof walletAddress !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)
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

router.get("/:groupId/expenses", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { walletAddress } = req.query;

    if (
      typeof groupId !== "string" ||
      !groupId.trim() ||
      typeof walletAddress !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)
    ) {
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

router.delete("/:groupId/expenses/:expenseId", async (req, res) => {
  try {
    const { groupId, expenseId } = req.params;
    const { walletAddress } = req.body;

    if (
      typeof groupId !== "string" ||
      !groupId.trim() ||
      typeof expenseId !== "string" ||
      !expenseId.trim() ||
      typeof walletAddress !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)
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

router.post("/:groupId/settlements", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { walletAddress, nonce, totalAmount } = req.body;

    if (
      typeof groupId !== "string" ||
      !groupId.trim() ||
      typeof walletAddress !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(walletAddress) ||
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
    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.patch("/:groupId/settlements/:settlementId", async (req, res) => {
  try {
    const { groupId, settlementId } = req.params;
    const { walletAddress, status, transactionHash, expenseIds } = req.body;

    if (
      typeof groupId !== "string" ||
      !groupId.trim() ||
      typeof settlementId !== "string" ||
      !settlementId.trim() ||
      typeof walletAddress !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(walletAddress) ||
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
        error: "Only group members can update settlements",
      });
    }

    const settlement =
      (await prisma.settlement.findFirst({
        where: {
          id: settlementId,
          groupId: group.id,
        },
      })) ??
      (await prisma.settlement.findFirst({
        where: {
          groupId: group.id,
          status: { in: ["PENDING", "SUBMITTED"] },
        },
        orderBy: { createdAt: "desc" },
      }));

    if (!settlement) {
      return res.status(404).json({
        error: "Settlement record not found",
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
      const validExpenseIds = Array.isArray(expenseIds)
        ? expenseIds.filter(
            (id: unknown): id is string => typeof id === "string" && Boolean(id.trim())
          )
        : [];

      const [completedRecord] = await prisma.$transaction([
        prisma.settlement.update({
          where: { id: settlement.id },
          data: {
            status: "COMPLETED",
            transactionHash:
              typeof transactionHash === "string"
                ? transactionHash
                : settlement.transactionHash,
            completedAt: new Date(),
          },
        }),
        ...(validExpenseIds.length > 0
          ? [
              prisma.expense.updateMany({
                where: {
                  id: { in: validExpenseIds },
                  groupId: group.id,
                },
                data: {
                  settled: true,
                },
              }),
            ]
          : []),
      ]);

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
    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

export default router;