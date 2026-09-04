import { describe, expect, it } from "vitest";
import { calculateSettlements } from "../src/domain/settlement.js";
import type { Address } from "../src/domain/group.js";

const alice = "0x1111111111111111111111111111111111111111" as Address;
const bob = "0x2222222222222222222222222222222222222222" as Address;
const charlie = "0x3333333333333333333333333333333333333333" as Address;

describe("calculateSettlements", () => {
  it("creates a settlement between one debtor and one creditor", () => {
    const balances = new Map<Address, bigint>([
      [alice, 5000n],
      [bob, -5000n],
    ]);

    const settlements = calculateSettlements(balances);

    expect(settlements).toEqual([
      {
        from: bob,
        to: alice,
        amount: 5000n,
      },
    ]);
  });

  it("settles multiple debtors against multiple creditors", () => {
    const balances = new Map<Address, bigint>([
      [alice, 5000n],
      [bob, -1000n],
      [charlie, -4000n],
    ]);

    const settlements = calculateSettlements(balances);

    expect(settlements).toEqual([
      {
        from: bob,
        to: alice,
        amount: 1000n,
      },
      {
        from: charlie,
        to: alice,
        amount: 4000n,
      },
    ]);
  });

  it("does not create transfers for zero balances", () => {
    const balances = new Map<Address, bigint>([
      [alice, 5000n],
      [bob, 0n],
      [charlie, -5000n],
    ]);

    const settlements = calculateSettlements(balances);

    expect(settlements).toEqual([
      {
        from: charlie,
        to: alice,
        amount: 5000n,
      },
    ]);
  });

  it("returns no settlements when everyone is settled", () => {
    const balances = new Map<Address, bigint>([
      [alice, 0n],
      [bob, 0n],
      [charlie, 0n],
    ]);

    expect(calculateSettlements(balances)).toEqual([]);
  });

  it("does not mutate the original balances", () => {
    const balances = new Map<Address, bigint>([
      [alice, 5000n],
      [bob, -5000n],
    ]);

    calculateSettlements(balances);

    expect(balances).toEqual(
      new Map<Address, bigint>([
        [alice, 5000n],
        [bob, -5000n],
      ]),
    );
  });
});