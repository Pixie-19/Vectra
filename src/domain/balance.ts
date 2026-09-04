import type { Address } from "./group.js";
import type { Expense } from "./expense.js";

export function calculateBalances(
  members: Address[],
  expenses: Expense[],
): Map<Address, bigint> {
  const memberSet = new Set(members);

  const balances = new Map<Address, bigint>();

  for (const member of members) {
    balances.set(member, 0n);
  }

  for (const expense of expenses) {
    if (!memberSet.has(expense.payer)) {
      throw new Error("Expense payer must be a group member");
    }

    for (const participant of expense.participants) {
      if (!memberSet.has(participant)) {
        throw new Error("Expense participant must be a group member");
      }
    }

    const participantCount = BigInt(expense.participants.length);

    const baseShare = expense.amount / participantCount;
    const remainder = expense.amount % participantCount;

    balances.set(
      expense.payer,
      balances.get(expense.payer)! + expense.amount,
    );

    for (const participant of expense.participants) {
      let share = baseShare;

      // Any indivisible remainder goes to the payer.
      if (participant === expense.payer) {
        share += remainder;
      }

      balances.set(
        participant,
        balances.get(participant)! - share,
      );
    }
  }

  return balances;
}