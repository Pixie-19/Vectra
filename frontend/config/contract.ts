export const VECTRA_TREASURY_ADDRESS =
  "0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea" as const;

export const vectraTreasuryAbi = [
  {
    name: "coordinators",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "",
        type: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "address",
      },
    ],
  },

  {
    name: "nonces",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "",
        type: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
      },
    ],
  },

  {
    name: "usdc",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
      },
    ],
  },

  {
    name: "registerGroup",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "groupId",
        type: "bytes32",
      },
    ],
    outputs: [],
  },

  {
    name: "executeSettlementIntent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          {
            name: "groupId",
            type: "bytes32",
          },
          {
            name: "nonce",
            type: "uint256",
          },
          {
            name: "deadline",
            type: "uint256",
          },
          {
            name: "from",
            type: "address[]",
          },
          {
            name: "to",
            type: "address[]",
          },
          {
            name: "amounts",
            type: "uint256[]",
          },
        ],
      },
      {
        name: "signature",
        type: "bytes",
      },
    ],
    outputs: [],
  },

  {
    name: "transferOut",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "groupId",
        type: "bytes32",
      },
      {
        name: "recipient",
        type: "address",
      },
      {
        name: "amount",
        type: "uint256",
      },
    ],
    outputs: [],
  },
] as const;