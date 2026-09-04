import type { Address } from "./group.js";
import type { SettlementTransfer } from "./settlement.js";

export type SettlementIntent = {
  groupId: string;
  nonce: bigint;
  deadline: bigint;
  transfers: SettlementTransfer[];
};

export function createSettlementIntent(
  groupId: string,
  nonce: bigint,
  deadline: bigint,
  transfers: SettlementTransfer[],
): SettlementIntent {
  if (groupId.trim() === "") {
    throw new Error("Settlement intent group ID cannot be empty");
  }

  if (nonce < 0n) {
    throw new Error("Settlement intent nonce cannot be negative");
  }

  if (deadline <= 0n) {
    throw new Error("Settlement intent deadline must be positive");
  }

  if (transfers.length === 0) {
    throw new Error("Settlement intent must contain at least one transfer");
  }

  for (const transfer of transfers) {
    if (transfer.amount <= 0n) {
      throw new Error("Settlement transfer amount must be greater than zero");
    }

    if (transfer.from === transfer.to) {
      throw new Error("Settlement transfer cannot be self-directed");
    }
  }

  return {
    groupId,
    nonce,
    deadline,
    transfers: transfers.map((transfer) => ({
      ...transfer,
    })),
  };
}