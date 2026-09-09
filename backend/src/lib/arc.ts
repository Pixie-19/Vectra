import { createPublicClient, http } from "viem";
import type { PublicClient } from "viem";

/**
 * Arc Testnet chain configuration
 */
const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: {
    decimals: 18,
    name: "Ethereum",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
    },
    public: {
      http: ["https://rpc.testnet.arc.network"],
    },
  },
} as const;

/**
 * Public client for reading Arc Testnet state.
 *
 * Used for independent verification of settlement transactions.
 */
export const arcClient: PublicClient = createPublicClient({
  chain: arcTestnet,
  transport: http("https://rpc.testnet.arc.network"),
});

/**
 * Deployed VectraTreasury contract address on Arc Testnet.
 */
export const VECTRA_TREASURY_ADDRESS =
  "0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea";
