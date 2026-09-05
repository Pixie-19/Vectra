import {
  type Address,
  type Hex,
  concat,
  encodeAbiParameters,
  keccak256,
  toHex,
} from "viem";

import type { SettlementIntent } from "./intent.js";

export const VECTRA_EIP712_DOMAIN = {
  name: "Vectra",
  version: "1",
} as const;

export const VECTRA_TRANSFER_TYPEHASH = keccak256(
  toHex("Transfer(address from,address to,uint256 amount)"),
);

export const VECTRA_SETTLEMENT_TYPEHASH = keccak256(
  toHex(
    "Settlement(bytes32 groupId,uint256 nonce,uint256 deadline,bytes32 transfersHash)",
  ),
);

export const VECTRA_EIP712_TYPES = {
  Settlement: [
    { name: "groupId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "transfersHash", type: "bytes32" },
  ],
} as const;

export function hashTransfers(
  transfers: SettlementIntent["transfers"],
): Hex {
  const transferHashes = transfers.map((transfer) =>
    keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "address" },
          { type: "address" },
          { type: "uint256" },
        ],
        [
          VECTRA_TRANSFER_TYPEHASH,
          transfer.from as Address,
          transfer.to as Address,
          transfer.amount,
        ],
      ),
    ),
  );

  return keccak256(concat(transferHashes));
}

export function hashSettlementIntent(
  intent: SettlementIntent,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        VECTRA_SETTLEMENT_TYPEHASH,
        intent.groupId as Hex,
        intent.nonce,
        intent.deadline,
        hashTransfers(intent.transfers),
      ],
    ),
  );
}