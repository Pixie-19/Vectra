import type { Address } from "./group.js";

export type Expense = {
  id: string;
  groupId: string;
  payer: Address;
  amount: bigint;
  participants: Address[];
};

export function createExpense(
  id: string,
  groupId: string,
  payer: Address,
  amount: bigint,
  participants: Address[],
): Expense {
  if (id.trim() === "") {
    throw new Error("Expense ID cannot be empty");
  }

  if (groupId.trim() === "") {
    throw new Error("Expense group ID cannot be empty");
  }

  if (amount <= 0n) {
    throw new Error("Expense amount must be greater than zero");
  }

  if (participants.length === 0) {
    throw new Error("Expense must have at least one participant");
  }

  const uniqueParticipants = new Set(participants);

  if (uniqueParticipants.size !== participants.length) {
    throw new Error("Expense participants must be unique");
  }

  if (!uniqueParticipants.has(payer)) {
    throw new Error("Payer must be a participant");
  }

  return {
    id,
    groupId,
    payer,
    amount,
    participants: [...participants],
  };
}