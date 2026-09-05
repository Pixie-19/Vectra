import { describe, expect, it } from "vitest";
import {
  hashTypedData,
  keccak256,
  toHex,
  verifyTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  hashSettlementIntent,
  VECTRA_EIP712_DOMAIN,
  VECTRA_EIP712_TYPES,
} from "../src/domain/eip712.js";
import { signSettlementIntent } from "../src/domain/signing.js";
import type { SettlementIntent } from "../src/domain/intent.js";

describe("Vectra EIP-712 signing", () => {
  it("creates a signature that recovers the coordinator", async () => {
    const privateKey =
      "0x00000000000000000000000000000000000000000000000000000000000a11ce";

    const account = privateKeyToAccount(privateKey);

    const intent: SettlementIntent = {
      groupId:
        "0x" +
        "11".repeat(32),
      nonce: 0n,
      deadline: 1_800_000_000n,
      transfers: [
        {
          from: "0x0000000000000000000000000000000000000002",
          to: "0x0000000000000000000000000000000000000001",
          amount: 5_000n,
        },
        {
          from: "0x0000000000000000000000000000000000000003",
          to: "0x0000000000000000000000000000000000000001",
          amount: 4_000n,
        },
      ],
    };

    const verifyingContract =
      "0x0000000000000000000000000000000000000100" as `0x${string}`;

    const chainId = 1;

    const signature = await signSettlementIntent(
      account,
      intent,
      {
        chainId,
        verifyingContract,
      },
    );

    const valid = await verifyTypedData({
      address: account.address,
      domain: {
        ...VECTRA_EIP712_DOMAIN,
        chainId,
        verifyingContract,
      },
      types: VECTRA_EIP712_TYPES,
      primaryType: "Settlement",
      message: {
        groupId: intent.groupId as `0x${string}`,
        nonce: intent.nonce,
        deadline: intent.deadline,
        transfersHash: await import("../src/domain/eip712.js").then(
          ({ hashTransfers }) => hashTransfers(intent.transfers),
        ),
      },
      signature,
    });

    expect(valid).toBe(true);
  });

  it("matches the Solidity EIP-712 digest", () => {
    const groupId = keccak256(toHex("group-1"));

    const chainId = 31337;

    const verifyingContract =
      "0x2e234DAe75C793f67A35089C9d99245E1C58470b" as `0x${string}`;

    const transfersHash =
      "0x193bb24f477a17c16af0bbc31f33c30d7de8e1e94f89ad388ea3d3f4f8d2f0d9" as `0x${string}`;

    const intent: SettlementIntent = {
      groupId,
      nonce: 0n,
      deadline: 1_800_000_000n,
      transfers: [
        {
          from: "0x0000000000000000000000000000000000000002",
          to: "0x0000000000000000000000000000000000000001",
          amount: 5_000n,
        },
        {
          from: "0x0000000000000000000000000000000000000003",
          to: "0x0000000000000000000000000000000000000001",
          amount: 4_000n,
        },
      ],
    };

    const structHash = hashSettlementIntent(intent);

    const digest = hashTypedData({
      domain: {
        ...VECTRA_EIP712_DOMAIN,
        chainId,
        verifyingContract,
      },
      types: VECTRA_EIP712_TYPES,
      primaryType: "Settlement",
      message: {
        groupId,
        nonce: intent.nonce,
        deadline: intent.deadline,
        transfersHash,
      },
    });

    expect(digest).toBe(
        "0xa283665c25f28ca54c9f769f468b7b50746cf6b17714f71a650365bdacac69f5",
    );
  });
});