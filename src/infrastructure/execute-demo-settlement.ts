import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  VECTRA_EIP712_DOMAIN,
  VECTRA_EIP712_TYPES,
  hashTransfers,
} from "../domain/eip712.js";
import type { SettlementIntent } from "../domain/intent.js";
import { arcTestnet, ARC_TESTNET_USDC } from "./arc.js";

const TREASURY =
  "0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea" as `0x${string}`;

const DEBTOR =
  "0x343ea172022c4f671a6355475872e352c96459Dc" as `0x${string}`;

const COORDINATOR =
  "0x1CcFa4DAcd8Babe1EB5b21577bB95eBc7b9398d3" as `0x${string}`;

const GROUP_ID: Hex = keccak256(
  toBytes("vectra-demo-group"),
);

const TREASURY_ABI = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "groupId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "executeSettlementIntent",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "groupId", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "from", type: "address[]" },
          { name: "to", type: "address[]" },
          { name: "amounts", type: "uint256[]" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

async function main() {
  const rpcUrl = process.env.ARC_RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;

  if (!rpcUrl) {
    throw new Error("ARC_RPC_URL is not set");
  }

  if (!privateKey) {
    throw new Error("PRIVATE_KEY is not set");
  }

  const account = privateKeyToAccount(
    privateKey as `0x${string}`,
  );

  if (account.address.toLowerCase() !== COORDINATOR.toLowerCase()) {
    throw new Error(
      `PRIVATE_KEY address ${account.address} does not match coordinator ${COORDINATOR}`,
    );
  }

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(rpcUrl),
  });

  const nonce = await publicClient.readContract({
    address: TREASURY,
    abi: TREASURY_ABI,
    functionName: "nonces",
    args: [GROUP_ID],
  });

  const block = await publicClient.getBlock();

  const intent: SettlementIntent = {
    groupId: GROUP_ID,
    nonce,
    deadline: block.timestamp + 3600n,
    transfers: [
      {
        from: DEBTOR,
        to: COORDINATOR,
        amount: 1_000_000n,
      },
    ],
  };

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      ...VECTRA_EIP712_DOMAIN,
      chainId: arcTestnet.id,
      verifyingContract: TREASURY,
    },
    types: VECTRA_EIP712_TYPES,
    primaryType: "Settlement",
    message: {
      groupId: intent.groupId as Hex,
      nonce: intent.nonce,
      deadline: intent.deadline,
      transfersHash: hashTransfers(intent.transfers),
    },
  });

  console.log("Coordinator:", account.address);
  console.log("Group ID:", GROUP_ID);
  console.log("Nonce:", nonce.toString());
  console.log("Transfer:", `${DEBTOR} -> ${COORDINATOR}`);
  console.log("Amount: 1 USDC");
  console.log("Signature created.");

  const txHash = await walletClient.writeContract({
    address: TREASURY,
    abi: TREASURY_ABI,
    functionName: "executeSettlementIntent",
    args: [
      {
        groupId: intent.groupId as Hex,
        nonce: intent.nonce,
        deadline: intent.deadline,
        from: intent.transfers.map((t) => t.from),
        to: intent.transfers.map((t) => t.to),
        amounts: intent.transfers.map((t) => t.amount),
      },
      signature,
    ],
  });

  console.log("Transaction:", txHash);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  console.log("Status:", receipt.status);
  console.log("Block:", receipt.blockNumber.toString());
  console.log("Gas used:", receipt.gasUsed.toString());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
