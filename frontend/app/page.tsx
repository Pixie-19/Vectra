"use client";

import { useEffect, useState } from "react";
import {
  concat,
  encodeAbiParameters,
  formatUnits,
  keccak256,
  stringToHex,
} from "viem";
import {
  useConnection,
  useConnect,
  useDisconnect,
  useReadContract,
  useSignTypedData,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import {
  VECTRA_TREASURY_ADDRESS,
  vectraTreasuryAbi,
} from "../config/contract";

import { arcTestnet } from "../config/wagmi";

type Settlement = {
  from: string;
  to: string;
  amount: number;
};

const DEMO_GROUP_ID =
  "0x79ad273f17e1a87e921c1d3c800b80208b1711b8439484f54ba2407636b297ff" as const;

const DEMO_MEMBERS = [
  {
    name: "Coordinator",
    address:
      "0x1CcFa4DAcd8Babe1EB5b21577bB95eBc7b9398d3",
  },
  {
    name: "Member",
    address:
      "0x343ea172022c4f671a6355475872e352c96459Dc",
  },
];

const SETTLEMENT_TYPES = {
  Settlement: [
    { name: "groupId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "transfersHash", type: "bytes32" },
  ],
} as const;

const EIP712_DOMAIN = {
  name: "Vectra",
  version: "1",
  chainId: arcTestnet.id,
  verifyingContract: VECTRA_TREASURY_ADDRESS,
} as const;

const usdcAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export default function Home() {
  const [mounted, setMounted] = useState(false);

  const [groupName, setGroupName] = useState("");
  const [activeGroupName, setActiveGroupName] =
    useState("Demo Group");

  const [activeGroupId, setActiveGroupId] =
    useState<`0x${string}`>(DEMO_GROUP_ID);

  const [expenseDescription, setExpenseDescription] =
    useState("");

  const [expenseAmount, setExpenseAmount] =
    useState("");

  const [expensePaidBy, setExpensePaidBy] =
    useState("");

  const [expenses, setExpenses] = useState<
    {
      description: string;
      amount: string;
      paidBy: string;
      groupId: `0x${string}`;
    }[]
  >([]);

  const [settlementSignature, setSettlementSignature] =
    useState<`0x${string}` | null>(null);

  const [settlementDeadline, setSettlementDeadline] =
    useState<bigint | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const {
    address,
    isConnected,
    chainId,
  } = useConnection();

  const {
    connect,
    connectors,
  } = useConnect();

  const {
    disconnect,
  } = useDisconnect();

  const {
    signTypedData,
    data: signedSettlement,
    isPending: isSigningSettlement,
  } = useSignTypedData();

  const {
    switchChain,
    isPending: isSwitching,
  } = useSwitchChain();

  const {
    writeContract,
    data: createGroupTxHash,
    isPending: isCreatingGroup,
  } = useWriteContract();

  const {
    writeContract: approveUSDC,
    data: approveTxHash,
    isPending: isApprovingUSDC,
  } = useWriteContract();

  const {
    writeContract: executeSettlement,
    data: settlementTxHash,
    isPending: isExecutingSettlement,
  } = useWriteContract();

  const {
    isLoading: isCreatingGroupConfirming,
    isSuccess: isGroupCreatedOnChain,
  } = useWaitForTransactionReceipt({
    hash: createGroupTxHash,
  });

  const {
    isLoading: isSettlementConfirming,
    isSuccess: isSettlementConfirmed,
  } = useWaitForTransactionReceipt({
    hash: settlementTxHash,
  });

  const {
    data: coordinator,
    isLoading: isCoordinatorLoading,
  } = useReadContract({
    address: VECTRA_TREASURY_ADDRESS,
    abi: vectraTreasuryAbi,
    functionName: "coordinators",
    args: [activeGroupId],
    chainId: arcTestnet.id,
  });

  const {
    data: groupNonce,
    isLoading: isNonceLoading,
  } = useReadContract({
    address: VECTRA_TREASURY_ADDRESS,
    abi: vectraTreasuryAbi,
    functionName: "nonces",
    args: [activeGroupId],
    chainId: arcTestnet.id,
  });

  const {
    data: usdcBalance,
    isLoading: isBalanceLoading,
  } = useReadContract({
    address:
      "0x3600000000000000000000000000000000000000",
    abi: usdcAbi,
    functionName: "balanceOf",
    args: address
      ? [address]
      : [
          "0x0000000000000000000000000000000000000000",
        ],
    chainId: arcTestnet.id,
  });

  const isArcNetwork =
    chainId === arcTestnet.id;

  const isCoordinator =
    Boolean(address) &&
    Boolean(coordinator) &&
    coordinator?.toLowerCase() ===
      address?.toLowerCase();

  /*
   * Settlement optimizer
   *
   * For the current demo:
   * Coordinator paid 30 USDC
   * Member paid 10 USDC
   *
   * Net result:
   * Member -> Coordinator = 10 USDC
   */
  const calculateSettlements = (): Settlement[] => {
    const balances = new Map<string, number>();

    for (const expense of expenses) {
      const amount = Number(expense.amount);

      if (!Number.isFinite(amount) || amount <= 0) {
        continue;
      }

      const payer = expense.paidBy.toLowerCase();

      balances.set(
        payer,
        (balances.get(payer) ?? 0) + amount
      );

      const members = DEMO_MEMBERS.map((member) =>
        member.address.toLowerCase()
      );

      for (const member of members) {
        balances.set(
          member,
          (balances.get(member) ?? 0) -
            amount / members.length
        );
      }
    }

    const debtors: {
      address: string;
      amount: number;
    }[] = [];

    const creditors: {
      address: string;
      amount: number;
    }[] = [];

    for (const [member, balance] of balances) {
      if (balance < -0.000001) {
        debtors.push({
          address: member,
          amount: Math.abs(balance),
        });
      } else if (balance > 0.000001) {
        creditors.push({
          address: member,
          amount: balance,
        });
      }
    }

    const result: Settlement[] = [];

    let debtorIndex = 0;
    let creditorIndex = 0;

    while (
      debtorIndex < debtors.length &&
      creditorIndex < creditors.length
    ) {
      const debtor = debtors[debtorIndex];
      const creditor = creditors[creditorIndex];

      const amount = Math.min(
        debtor.amount,
        creditor.amount
      );

      result.push({
        from: debtor.address,
        to: creditor.address,
        amount: Number(amount.toFixed(6)),
      });

      debtor.amount -= amount;
      creditor.amount -= amount;

      if (debtor.amount <= 0.000001) {
        debtorIndex++;
      }

      if (creditor.amount <= 0.000001) {
        creditorIndex++;
      }
    }

    return result;
  };

  const settlements = calculateSettlements();

  const calculateTransfersHash = (
    transfers: Settlement[]
  ): `0x${string}` => {
    const transferTypeHash = keccak256(
      stringToHex(
        "Transfer(address from,address to,uint256 amount)"
      )
    );

    const transferHashes = transfers.map(
      (transfer) =>
        keccak256(
          encodeAbiParameters(
            [
              { type: "bytes32" },
              { type: "address" },
              { type: "address" },
              { type: "uint256" },
            ],
            [
              transferTypeHash,
              transfer.from as `0x${string}`,
              transfer.to as `0x${string}`,
              BigInt(
                Math.round(
                  transfer.amount * 1_000_000
                )
              ),
            ]
          )
        )
    );

    return keccak256(
      concat(transferHashes)
    );
  };

  const handleConnect = () => {
    const connector = connectors[0];

    if (!connector) {
      return;
    }

    connect({ connector });
  };

  const handleCreateGroup = () => {
    if (
      !address ||
      !isConnected ||
      !isArcNetwork
    ) {
      return;
    }

    if (!groupName.trim()) {
      return;
    }

    const generatedGroupId = keccak256(
      stringToHex(
        `${groupName.trim()}-${address}-${Date.now()}`
      )
    );

    setActiveGroupName(groupName.trim());
    setActiveGroupId(generatedGroupId);

    writeContract({
      address: VECTRA_TREASURY_ADDRESS,
      abi: vectraTreasuryAbi,
      functionName: "registerGroup",
      args: [generatedGroupId],
      chainId: arcTestnet.id,
    });
  };

  const handleAddExpense = () => {
    if (!expenseDescription.trim()) {
      return;
    }

    if (!expenseAmount.trim()) {
      return;
    }

    if (!expensePaidBy) {
      return;
    }

    const amount = Number(expenseAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }

    setExpenses((current) => [
      ...current,
      {
        description:
          expenseDescription.trim(),
        amount: amount.toFixed(2),
        paidBy: expensePaidBy,
        groupId: activeGroupId,
      },
    ]);

    setExpenseDescription("");
    setExpenseAmount("");
    setExpensePaidBy("");

    /*
     * Existing signatures are no longer valid if
     * the underlying settlement changes.
     */
    setSettlementSignature(null);
    setSettlementDeadline(null);
  };

  const handleApproveSettlement = () => {
    if (
      !address ||
      !isConnected ||
      !isArcNetwork
    ) {
      return;
    }

    if (settlements.length === 0) {
      return;
    }

    const outgoingAmount = settlements
      .filter(
        (settlement) =>
          settlement.from.toLowerCase() ===
          address.toLowerCase()
      )
      .reduce(
        (total, settlement) =>
          total + settlement.amount,
        0
      );

    if (outgoingAmount <= 0) {
      return;
    }

    const amountInUSDC = BigInt(
      Math.round(
        outgoingAmount * 1_000_000
      )
    );

    approveUSDC({
      address:
        "0x3600000000000000000000000000000000000000",
      abi: usdcAbi,
      functionName: "approve",
      args: [
        VECTRA_TREASURY_ADDRESS,
        amountInUSDC,
      ],
      chainId: arcTestnet.id,
    });
  };

  const handleSignSettlement = () => {
    if (
      !address ||
      !isConnected ||
      !isArcNetwork
    ) {
      return;
    }

    if (settlements.length === 0) {
      return;
    }

    if (
      coordinator?.toLowerCase() !==
      address.toLowerCase()
    ) {
      return;
    }

    const transfersHash =
      calculateTransfersHash(
        settlements
      );

    const nonce =
      groupNonce ?? BigInt(0);

    const deadline = BigInt(
      Math.floor(Date.now() / 1000) +
        15 * 60
    );

    setSettlementDeadline(deadline);
    setSettlementSignature(null);

    signTypedData({
      domain: EIP712_DOMAIN,
      types: SETTLEMENT_TYPES,
      primaryType: "Settlement",
      message: {
        groupId: activeGroupId,
        nonce,
        deadline,
        transfersHash,
      },
    });
  };

  useEffect(() => {
    if (!signedSettlement) {
      return;
    }

    setSettlementSignature(
      signedSettlement
    );
  }, [signedSettlement]);

  const handleExecuteSettlement = () => {
    if (
      !address ||
      !isConnected ||
      !isArcNetwork
    ) {
      return;
    }

    if (settlements.length === 0) {
      return;
    }

    if (
      !settlementSignature ||
      !settlementDeadline
    ) {
      return;
    }

    if (groupNonce === undefined) {
      return;
    }

    const intent = {
      groupId: activeGroupId,

      nonce: groupNonce,

      deadline: settlementDeadline,

      from: settlements.map(
        (settlement) =>
          settlement.from as `0x${string}`
      ),

      to: settlements.map(
        (settlement) =>
          settlement.to as `0x${string}`
      ),

      amounts: settlements.map(
        (settlement) =>
          BigInt(
            Math.round(
              settlement.amount * 1_000_000
            )
          )
      ),
    };

    executeSettlement({
      address: VECTRA_TREASURY_ADDRESS,
      abi: vectraTreasuryAbi,
      functionName:
        "executeSettlementIntent",
      args: [
        intent,
        settlementSignature,
      ],
      chainId: arcTestnet.id,
    });
  };

  const formatAddress = (
    value?: string
  ) => {
    if (!value) {
      return "—";
    }

    return `${value.slice(
      0,
      6
    )}...${value.slice(-4)}`;
  };

  const formatDeadline = () => {
    if (!settlementDeadline) {
      return "—";
    }

    return new Date(
      Number(
        settlementDeadline * BigInt(1000)
      )
    ).toLocaleTimeString();
  };

  if (!mounted) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto max-w-6xl px-6 py-12">
          Loading Vectra...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* Header */}
        <header className="mb-10 flex flex-col gap-6 border-b border-slate-800 pb-8 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 text-sm font-semibold uppercase tracking-[0.25em] text-cyan-400">
              Vectra
            </div>

            <h1 className="text-4xl font-bold tracking-tight">
              Intent-Based Group Treasury
            </h1>

            <p className="mt-3 max-w-2xl text-slate-400">
              Record shared expenses, optimize the
              debt graph, and settle the minimum number
              of USDC transfers on Arc.
            </p>
          </div>

          <div>
            {!isConnected ? (
              <button
                onClick={handleConnect}
                className="rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300"
              >
                Connect Wallet
              </button>
            ) : (
              <div className="flex flex-col items-end gap-2">
                <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm">
                  {formatAddress(address)}
                </div>

                <button
                  onClick={() => disconnect()}
                  className="text-xs text-slate-500 hover:text-white"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Network warning */}
        {isConnected &&
          !isArcNetwork && (
            <section className="mb-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="font-semibold text-amber-300">
                    Wrong network
                  </h2>

                  <p className="mt-1 text-sm text-amber-200/70">
                    Vectra requires Arc Testnet.
                  </p>
                </div>

                <button
                  onClick={() =>
                    switchChain({
                      chainId: arcTestnet.id,
                    })
                  }
                  disabled={isSwitching}
                  className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
                >
                  {isSwitching
                    ? "Switching..."
                    : "Switch to Arc"}
                </button>
              </div>
            </section>
          )}

        {/* Dashboard */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Wallet */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h2 className="text-lg font-semibold">
              Wallet
            </h2>

            <div className="mt-5 space-y-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Address
                </div>

                <div className="mt-1 break-all text-sm text-slate-300">
                  {address ?? "Not connected"}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Network
                </div>

                <div className="mt-1 text-sm">
                  {isArcNetwork
                    ? "Arc Testnet ✓"
                    : chainId
                      ? `Chain ${chainId}`
                      : "—"}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  USDC Balance
                </div>

                <div className="mt-1 text-2xl font-bold">
                  {isBalanceLoading
                    ? "Loading..."
                    : usdcBalance !== undefined
                      ? `${formatUnits(
                          usdcBalance,
                          6
                        )} USDC`
                      : "—"}
                </div>
              </div>
            </div>
          </section>

          {/* Group */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 lg:col-span-2">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  Group
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  {activeGroupName}
                </p>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-400">
                {formatAddress(activeGroupId)}
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto]">
              <input
                value={groupName}
                onChange={(event) =>
                  setGroupName(event.target.value)
                }
                placeholder="New group name"
                className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-cyan-400"
              />

              <button
                onClick={handleCreateGroup}
                disabled={
                  isCreatingGroup ||
                  !isConnected ||
                  !isArcNetwork ||
                  !groupName.trim()
                }
                className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isCreatingGroup
                  ? "Registering..."
                  : "Create Group"}
              </button>
            </div>

            {createGroupTxHash && (
              <div className="mt-4 rounded-xl bg-slate-950 p-4 text-sm">
                <div className="text-slate-500">
                  Group registration
                </div>

                <div className="mt-1 break-all text-cyan-400">
                  {createGroupTxHash}
                </div>

                {isCreatingGroupConfirming && (
                  <div className="mt-2 text-amber-400">
                    Confirming...
                  </div>
                )}

                {isGroupCreatedOnChain && (
                  <div className="mt-2 text-emerald-400">
                    Group registered on Arc ✓
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl bg-slate-950 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Coordinator
                </div>

                <div className="mt-2 text-sm">
                  {isCoordinatorLoading
                    ? "Loading..."
                    : formatAddress(coordinator)}
                </div>

                {isCoordinator && (
                  <div className="mt-2 text-xs text-emerald-400">
                    You are coordinator ✓
                  </div>
                )}
              </div>

              <div className="rounded-xl bg-slate-950 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Nonce
                </div>

                <div className="mt-2 text-2xl font-bold">
                  {isNonceLoading
                    ? "..."
                    : groupNonce?.toString() ?? "—"}
                </div>
              </div>

              <div className="rounded-xl bg-slate-950 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Members
                </div>

                <div className="mt-2 text-sm text-slate-300">
                  {DEMO_MEMBERS.length}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Expenses */}
        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div>
            <h2 className="text-lg font-semibold">
              Expenses
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Add shared expenses for the active group.
            </p>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-4">
            <input
              value={expenseDescription}
              onChange={(event) =>
                setExpenseDescription(
                  event.target.value
                )
              }
              placeholder="Description"
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-cyan-400"
            />

            <input
              value={expenseAmount}
              onChange={(event) =>
                setExpenseAmount(
                  event.target.value
                )
              }
              placeholder="Amount (USDC)"
              type="number"
              min="0"
              step="0.01"
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-cyan-400"
            />

            <select
              value={expensePaidBy}
              onChange={(event) =>
                setExpensePaidBy(
                  event.target.value
                )
              }
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-cyan-400"
            >
              <option value="">
                Paid by...
              </option>

              {DEMO_MEMBERS.map((member) => (
                <option
                  key={member.address}
                  value={member.address}
                >
                  {member.name}
                </option>
              ))}
            </select>

            <button
              onClick={handleAddExpense}
              className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
            >
              Add Expense
            </button>
          </div>

          {expenses.length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="pb-3">
                      Description
                    </th>
                    <th className="pb-3">
                      Amount
                    </th>
                    <th className="pb-3">
                      Paid by
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {expenses.map(
                    (expense, index) => (
                      <tr
                        key={`${expense.description}-${index}`}
                        className="border-b border-slate-800/70"
                      >
                        <td className="py-4">
                          {expense.description}
                        </td>

                        <td className="py-4">
                          {expense.amount} USDC
                        </td>

                        <td className="py-4 text-slate-400">
                          {formatAddress(
                            expense.paidBy
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Settlement */}
        <section className="mt-6 rounded-2xl border border-cyan-500/20 bg-slate-900/70 p-6">
          <div>
            <h2 className="text-lg font-semibold">
              Optimized Settlement
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Vectra minimizes the number of transfers
              needed to settle the group.
            </p>
          </div>

          {settlements.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
              Add expenses to generate a settlement.
            </div>
          ) : (
            <>
              <div className="mt-6 space-y-3">
                {settlements.map(
                  (settlement, index) => (
                    <div
                      key={`${settlement.from}-${settlement.to}-${index}`}
                      className="flex flex-col gap-3 rounded-xl bg-slate-950 p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <div className="text-sm font-semibold">
                          {formatAddress(
                            settlement.from
                          )}{" "}
                          →{" "}
                          {formatAddress(
                            settlement.to
                          )}
                        </div>

                        <div className="mt-1 text-xs text-slate-500">
                          Settlement transfer
                        </div>
                      </div>

                      <div className="text-xl font-bold text-cyan-400">
                        {settlement.amount.toFixed(
                          2
                        )} USDC
                      </div>
                    </div>
                  )
                )}
              </div>

              {/* Coordinator signing */}
              <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="font-semibold">
                      Step 1 — Sign Settlement Intent
                    </h3>

                    <p className="mt-1 text-sm text-slate-500">
                      The group coordinator signs the
                      settlement using EIP-712.
                    </p>
                  </div>

                  <button
                    onClick={
                      handleSignSettlement
                    }
                    disabled={
                      isSigningSettlement ||
                      settlements.length === 0 ||
                      groupNonce === undefined ||
                      !isCoordinator ||
                      !isArcNetwork
                    }
                    className="rounded-lg bg-white px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isSigningSettlement
                      ? "Signing..."
                      : "Sign Settlement Intent"}
                  </button>
                </div>

                {!isCoordinator &&
                  isConnected &&
                  isArcNetwork && (
                    <div className="mt-4 text-xs text-amber-400">
                      Only the group coordinator can
                      sign the settlement intent.
                    </div>
                  )}

                {settlementSignature && (
                  <div className="mt-5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <div className="font-semibold text-emerald-400">
                      Settlement Intent Signed ✓
                    </div>

                    <div className="mt-3 break-all text-xs text-slate-500">
                      Signature:
                    </div>

                    <div className="mt-1 break-all text-xs text-slate-300">
                      {settlementSignature}
                    </div>

                    <div className="mt-3 text-xs text-slate-500">
                      Deadline:{" "}
                      <span className="text-slate-300">
                        {formatDeadline()}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Approval */}
              {address &&
                settlements.some(
                  (settlement) =>
                    settlement.from.toLowerCase() ===
                    address.toLowerCase()
                ) && (
                  <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="font-semibold">
                          Step 2 — Approve USDC
                        </h3>

                        <p className="mt-1 text-sm text-slate-500">
                          Approve Vectra Treasury to
                          transfer your outgoing
                          settlement amount.
                        </p>
                      </div>

                      <button
                        onClick={
                          handleApproveSettlement
                        }
                        disabled={
                          isApprovingUSDC ||
                          !isArcNetwork
                        }
                        className="rounded-lg bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isApprovingUSDC
                          ? "Approving USDC..."
                          : approveTxHash
                            ? "USDC Approved ✓"
                            : "Approve USDC for Settlement"}
                      </button>
                    </div>

                    {approveTxHash && (
                      <div className="mt-4 break-all text-xs text-slate-500">
                        Approval transaction:
                        <div className="mt-1 text-cyan-400">
                          {approveTxHash}
                        </div>
                      </div>
                    )}
                  </div>
                )}

              {/* Execution */}
              {settlementSignature && (
                <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="font-semibold">
                        Step 3 — Execute Settlement
                      </h3>

                      <p className="mt-1 text-sm text-slate-500">
                        Submit the signed intent to Arc
                        and execute the optimized USDC
                        transfers.
                      </p>
                    </div>

                    <button
                      onClick={
                        handleExecuteSettlement
                      }
                      disabled={
                        isExecutingSettlement ||
                        isSettlementConfirmed ||
                        !isArcNetwork
                      }
                      className="rounded-lg bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isExecutingSettlement
                        ? "Executing Settlement..."
                        : isSettlementConfirmed
                          ? "Settlement Confirmed ✓"
                          : settlementTxHash
                            ? "Settlement Submitted ✓"
                            : "Execute Settlement"}
                    </button>
                  </div>

                  {settlementTxHash && (
                    <div className="mt-4 rounded-lg bg-slate-950 p-4">
                      <div className="text-xs text-slate-500">
                        Settlement transaction
                      </div>

                      <div className="mt-1 break-all text-xs text-cyan-400">
                        {settlementTxHash}
                      </div>

                      {isSettlementConfirming && (
                        <div className="mt-3 text-xs text-amber-400">
                          Waiting for Arc confirmation...
                        </div>
                      )}

                      {isSettlementConfirmed && (
                        <div className="mt-3 text-sm font-semibold text-emerald-400">
                          Settlement confirmed on Arc ✓
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {/* Demo members */}
        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <h2 className="text-lg font-semibold">
            Demo Members
          </h2>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {DEMO_MEMBERS.map((member) => (
              <div
                key={member.address}
                className="rounded-xl bg-slate-950 p-4"
              >
                <div className="font-semibold">
                  {member.name}
                </div>

                <div className="mt-2 break-all text-xs text-slate-500">
                  {member.address}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-12 border-t border-slate-800 pt-6 text-center text-xs text-slate-600">
          Vectra • Arc Testnet • USDC • EIP-712
        </footer>
      </div>
    </main>
  );
}