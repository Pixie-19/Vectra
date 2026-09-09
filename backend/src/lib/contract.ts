/**
 * Minimal VectraTreasury ABI for settlement verification.
 *
 * Contains only the events needed to verify on-chain settlement execution.
 */
export const vectraTreasuryAbi = [
  {
    name: "SettlementIntentExecuted",
    type: "event",
    anonymous: false,
    inputs: [
      {
        indexed: true,
        name: "groupId",
        type: "bytes32",
      },
      {
        indexed: true,
        name: "signer",
        type: "address",
      },
      {
        indexed: false,
        name: "nonce",
        type: "uint256",
      },
    ],
  },
  {
    name: "SettlementExecuted",
    type: "event",
    anonymous: false,
    inputs: [
      {
        indexed: true,
        name: "groupId",
        type: "bytes32",
      },
      {
        indexed: true,
        name: "from",
        type: "address",
      },
      {
        indexed: true,
        name: "to",
        type: "address",
      },
      {
        indexed: false,
        name: "amount",
        type: "uint256",
      },
    ],
  },
] as const;
