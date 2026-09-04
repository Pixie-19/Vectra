import type { Address } from "./group.js";

export type SettlementTransfer = {
  from: Address;
  to: Address;
  amount: bigint;
};

export function calculateSettlements(
  balances: Map<Address, bigint>,
): SettlementTransfer[] {
  const debtors: { address: Address; amount: bigint }[] = [];
  const creditors: { address: Address; amount: bigint }[] = [];

  for (const [address, balance] of balances) {
    if (balance < 0n) {
      debtors.push({
        address,
        amount: -balance,
      });
    } else if (balance > 0n) {
      creditors.push({
        address,
        amount: balance,
      });
    }
  }

  // Make the result deterministic.
  debtors.sort((a, b) => a.address.localeCompare(b.address));
  creditors.sort((a, b) => a.address.localeCompare(b.address));

  const settlements: SettlementTransfer[] = [];

  let debtorIndex = 0;
  let creditorIndex = 0;

  while (
    debtorIndex < debtors.length &&
    creditorIndex < creditors.length
  ) {
    const debtor = debtors[debtorIndex]!;
    const creditor = creditors[creditorIndex]!;

    const amount =
      debtor.amount < creditor.amount
        ? debtor.amount
        : creditor.amount;

    settlements.push({
      from: debtor.address,
      to: creditor.address,
      amount,
    });

    debtor.amount -= amount;
    creditor.amount -= amount;

    if (debtor.amount === 0n) {
      debtorIndex++;
    }

    if (creditor.amount === 0n) {
      creditorIndex++;
    }
  }

  return settlements;
}