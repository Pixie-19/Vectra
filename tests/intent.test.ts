import { describe, expect, it } from "vitest";
import { createSettlementIntent } from "../src/domain/intent.js";
import type { Address } from "../src/domain/group.js";
import type { SettlementTransfer } from "../src/domain/settlement.js";

const alice = "0x1111111111111111111111111111111111111111" as Address;
const bob = "0x2222222222222222222222222222222222222222" as Address;

const transfer: SettlementTransfer = {
  from: bob,
  to: alice,
  amount: 5000n,
};

describe("createSettlementIntent", () => {
  it("creates a valid settlement intent", () => {
    const intent = createSettlementIntent(
      "group-1",
      0n,
      1757034000n,
      [transfer],
    );

    expect(intent).toEqual({
      groupId: "group-1",
      nonce: 0n,
      deadline: 1757034000n,
      transfers: [transfer],
    });
  });

  it("allows nonce zero", () => {
    const intent = createSettlementIntent(
      "group-1",
      0n,
      1757034000n,
      [transfer],
    );

    expect(intent.nonce).toBe(0n);
  });

  it("rejects an empty group ID", () => {
    expect(() =>
      createSettlementIntent(
        "",
        0n,
        1757034000n,
        [transfer],
      ),
    ).toThrow("Settlement intent group ID cannot be empty");
  });

  it("rejects a negative nonce", () => {
    expect(() =>
      createSettlementIntent(
        "group-1",
        -1n,
        1757034000n,
        [transfer],
      ),
    ).toThrow("Settlement intent nonce cannot be negative");
  });

  it("rejects a non-positive deadline", () => {
    expect(() =>
      createSettlementIntent(
        "group-1",
        0n,
        0n,
        [transfer],
      ),
    ).toThrow("Settlement intent deadline must be positive");
  });

  it("rejects an empty transfer list", () => {
    expect(() =>
      createSettlementIntent(
        "group-1",
        0n,
        1757034000n,
        [],
      ),
    ).toThrow("Settlement intent must contain at least one transfer");
  });

  it("rejects zero-value transfers", () => {
    expect(() =>
      createSettlementIntent(
        "group-1",
        0n,
        1757034000n,
        [
          {
            from: bob,
            to: alice,
            amount: 0n,
          },
        ],
      ),
    ).toThrow("Settlement transfer amount must be greater than zero");
  });

  it("rejects self-directed transfers", () => {
    expect(() =>
      createSettlementIntent(
        "group-1",
        0n,
        1757034000n,
        [
          {
            from: alice,
            to: alice,
            amount: 1000n,
          },
        ],
      ),
    ).toThrow("Settlement transfer cannot be self-directed");
  });
});