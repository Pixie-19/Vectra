import { describe, expect, it } from "vitest";
import { createGroup, type Address } from "../src/domain/group.js";
import { createExpense } from "../src/domain/expense.js";

const alice = "0x1111111111111111111111111111111111111111" as Address;
const bob = "0x2222222222222222222222222222222222222222" as Address;
const charlie = "0x3333333333333333333333333333333333333333" as Address;

describe("Group", () => {
  it("creates a valid group with 2 members", () => {
    const group = createGroup(
      "group-1",
      "Goa Trip",
      alice,
      [alice, bob],
    );

    expect(group.members).toHaveLength(2);
    expect(group.creator).toBe(alice);
  });

  it("supports groups with more than 2 members", () => {
    const group = createGroup(
      "group-2",
      "Goa Trip",
      alice,
      [alice, bob, charlie],
    );

    expect(group.members).toHaveLength(3);
  });

  it("rejects a group with fewer than 2 members", () => {
    expect(() =>
      createGroup(
        "group-3",
        "Invalid Group",
        alice,
        [alice],
      ),
    ).toThrow("A group must have at least 2 members");
  });

  it("rejects a creator who is not a member", () => {
    expect(() =>
      createGroup(
        "group-4",
        "Invalid Group",
        alice,
        [bob, charlie],
      ),
    ).toThrow("Creator must be a group member");
  });
});

describe("Expense", () => {
  it("creates a valid expense", () => {
    const expense = createExpense(
      "expense-1",
      "group-1",
      alice,
      100_000_000n,
      [alice, bob],
    );

    expect(expense.amount).toBe(100_000_000n);
    expect(expense.payer).toBe(alice);
    expect(expense.participants).toHaveLength(2);
  });

  it("rejects an expense with zero amount", () => {
    expect(() =>
      createExpense(
        "expense-2",
        "group-1",
        alice,
        0n,
        [alice, bob],
      ),
    ).toThrow("Expense amount must be greater than zero");
  });

  it("rejects an expense with no participants", () => {
    expect(() =>
      createExpense(
        "expense-3",
        "group-1",
        alice,
        100_000_000n,
        [],
      ),
    ).toThrow("Expense must have at least one participant");
  });

  it("rejects an expense when payer is not a participant", () => {
    expect(() =>
      createExpense(
        "expense-4",
        "group-1",
        alice,
        100_000_000n,
        [bob, charlie],
      ),
    ).toThrow("Payer must be a participant");
  });
});

it("rejects duplicate group members", () => {
  expect(() =>
    createGroup(
      "group-duplicate",
      "Duplicate Group",
      alice,
      [alice, bob, bob],
    ),
  ).toThrow("Group members must be unique");
});

it("rejects duplicate expense participants", () => {
  expect(() =>
    createExpense(
      "expense-duplicate",
      "group-1",
      alice,
      1000n,
      [alice, bob, bob],
    ),
  ).toThrow("Expense participants must be unique");
});

it("rejects an empty group name", () => {
  expect(() =>
    createGroup(
      "group-empty",
      "",
      alice,
      [alice, bob],
    ),
  ).toThrow("Group name cannot be empty");
});