import { describe, expect, it } from "vitest";
import { calculateBalances } from "../src/domain/balance.js";
import { createExpense } from "../src/domain/expense.js";
import type { Address } from "../src/domain/group.js";

const alice = "0x1111111111111111111111111111111111111111" as Address;
const bob = "0x2222222222222222222222222222222222222222" as Address;
const charlie = "0x3333333333333333333333333333333333333333" as Address;

describe("calculateBalances", () => {
  it("calculates an equal three-way split", () => {
    const expense = createExpense(
      "expense-1",
      "group-1",
      alice,
      12000n,
      [alice, bob, charlie],
    );

    const balances = calculateBalances(
      [alice, bob, charlie],
      [expense],
    );

    expect(balances.get(alice)).toBe(8000n);
    expect(balances.get(bob)).toBe(-4000n);
    expect(balances.get(charlie)).toBe(-4000n);
  });

  it("handles a split that has a remainder", () => {
    const expense = createExpense(
      "expense-2",
      "group-1",
      alice,
      10000n,
      [alice, bob, charlie],
    );

    const balances = calculateBalances(
      [alice, bob, charlie],
      [expense],
    );

    expect(balances.get(alice)).toBe(6666n);
    expect(balances.get(bob)).toBe(-3333n);
    expect(balances.get(charlie)).toBe(-3333n);
  });

  it("handles multiple expenses", () => {
    const expenses = [
      createExpense(
        "expense-3",
        "group-1",
        alice,
        12000n,
        [alice, bob, charlie],
      ),
      createExpense(
        "expense-4",
        "group-1",
        bob,
        6000n,
        [alice, bob],
      ),
    ];

    const balances = calculateBalances(
      [alice, bob, charlie],
      expenses,
    );

    expect(balances.get(alice)).toBe(5000n);
expect(balances.get(bob)).toBe(-1000n);
expect(balances.get(charlie)).toBe(-4000n);
  });

  it("balances always sum to zero", () => {
    const expenses = [
      createExpense(
        "expense-5",
        "group-1",
        alice,
        10000n,
        [alice, bob, charlie],
      ),
      createExpense(
        "expense-6",
        "group-1",
        bob,
        7000n,
        [bob, charlie],
      ),
      createExpense(
        "expense-7",
        "group-1",
        charlie,
        5000n,
        [alice, charlie],
      ),
    ];

    const balances = calculateBalances(
      [alice, bob, charlie],
      expenses,
    );

    const total = [...balances.values()].reduce(
      (sum, balance) => sum + balance,
      0n,
    );

    expect(total).toBe(0n);
  });
});

it("rejects an expense involving a non-member", () => {
  const outsider =
    "0x4444444444444444444444444444444444444444" as Address;

  const expense = createExpense(
    "expense-outsider",
    "group-1",
    alice,
    1000n,
    [alice, outsider],
  );

  expect(() =>
    calculateBalances(
      [alice, bob, charlie],
      [expense],
    ),
  ).toThrow("Expense participant must be a group member");
});