import type { Hex, LocalAccount } from "viem";

import {
  VECTRA_EIP712_DOMAIN,
  VECTRA_EIP712_TYPES,
  hashTransfers,
} from "./eip712.js";

import type { SettlementIntent } from "./intent.js";

export type SettlementSigningContext = {
  chainId: number;
  verifyingContract: Hex;
};

export async function signSettlementIntent(
  account: LocalAccount,
  intent: SettlementIntent,
  context: SettlementSigningContext,
): Promise<Hex> {
  return account.signTypedData({
    domain: {
      ...VECTRA_EIP712_DOMAIN,
      chainId: context.chainId,
      verifyingContract: context.verifyingContract,
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
}