"use client";

import { useEffect, useState } from "react";
import {
  concat,
  createPublicClient,
  encodeAbiParameters,
  formatUnits,
  http,
  keccak256,
  parseAbiItem,
  stringToHex,
  toEventSelector,
} from "viem";
import { mainnet } from "viem/chains";
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

type Expense = {
  description: string;
  amount: string;
  paidBy: string;
  groupId: `0x${string}`;
};

type Member = {
  name: string;
  address: string;
};

type ActivityItem = {
  type: "registration" | "settlement";
  txHash: `0x${string}`;
  blockNumber: bigint;
  from?: string;
  to?: string;
  amount?: bigint;
  coordinator?: string;
};

type GroupLocalData = {
  name: string;
  members: Member[];
  expenses: Expense[];
  settledExpenseBatch: string | null;
};

type GroupStorage = Record<string, GroupLocalData>;

const GROUP_STORAGE_KEY = "vectra-groups";

const loadGroupStorage = (): GroupStorage => {
  try {
    const saved = localStorage.getItem(
      GROUP_STORAGE_KEY
    );

    if (!saved) {
      return {};
    }

    const parsed = JSON.parse(saved);

    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as GroupStorage;
    }
  } catch (error) {
    console.error(
      "Failed to load group storage:",
      error
    );
  }

  return {};
};

const saveGroupStorage = (
  storage: GroupStorage
) => {
  try {
    localStorage.setItem(
      GROUP_STORAGE_KEY,
      JSON.stringify(storage)
    );
  } catch (error) {
    console.error(
      "Failed to save group storage:",
      error
    );
  }
};

const DEMO_GROUP_ID =
  "0x79ad273f17e1a87e921c1d3c800b80208b1711b8439484f54ba2407636b297ff" as const;

const INITIAL_MEMBERS: Member[] = [
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
  verifyingContract:
    VECTRA_TREASURY_ADDRESS,
} as const;

const usdcAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "account",
        type: "address",
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
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "spender",
        type: "address",
      },
      {
        name: "amount",
        type: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
      },
    ],
  },
] as const;

/*
 * ENS public client.
 *
 * ENS resolution happens on Ethereum mainnet.
 * Arc remains the settlement/payment network.
 *
 * Explicit RPC prevents Viem from using its default
 * mainnet endpoint, which may time out during ENS
 * Universal Resolver / CCIP-Read requests.
 */
const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(
    "https://ethereum-rpc.publicnode.com"
  ),
});

/*
 * Arc public client.
 *
 * Used for reading on-chain activity directly from
 * the deployed VectraTreasury contract.
 */
const arcClient = createPublicClient({
  chain: arcTestnet,
  transport: http(
    "https://rpc.testnet.arc.network"
  ),
});

const GROUP_REGISTERED_EVENT = Object.assign(
  parseAbiItem(
    "event GroupRegistered(bytes32 indexed groupId, address indexed coordinator)"
  ),
  {
    topicHash: toEventSelector(
      "event GroupRegistered(bytes32 indexed groupId, address indexed coordinator)"
    ),
  }
);

const SETTLEMENT_EXECUTED_EVENT = Object.assign(
  parseAbiItem(
    "event SettlementExecuted(bytes32 indexed groupId, address indexed from, address indexed to, uint256 amount)"
  ),
  {
    topicHash: toEventSelector(
      "event SettlementExecuted(bytes32 indexed groupId, address indexed from, address indexed to, uint256 amount)"
    ),
  }
);

export default function Home() {
  const [mounted, setMounted] =
    useState(false);

  const [storageLoaded, setStorageLoaded] =
    useState(false);
  const [groupDataLoaded, setGroupDataLoaded] =
  useState(false);

  const [members, setMembers] =
    useState<Member[]>(INITIAL_MEMBERS);

  const [groupName, setGroupName] =
    useState("");

  const [activeGroupName, setActiveGroupName] =
    useState("Demo Group");

  const [activeGroupId, setActiveGroupId] =
    useState<`0x${string}`>(
      DEMO_GROUP_ID
    );

  const [expenseDescription, setExpenseDescription] =
    useState("");

  const [expenseAmount, setExpenseAmount] =
    useState("");

  const [expensePaidBy, setExpensePaidBy] =
    useState("");

  const [expenses, setExpenses] =
    useState<Expense[]>([]);

  /*
   * Stores the exact current expense batch that has
   * already been successfully settled.
   *
   * Expenses themselves are preserved as history.
   */
  const [settledExpenseBatch, setSettledExpenseBatch] =
    useState<string | null>(null);
  const [pendingSettlementBatch, setPendingSettlementBatch] =
  useState<string | null>(null);

  const [settlementSignature, setSettlementSignature] =
    useState<`0x${string}` | null>(null);

  const [settlementDeadline, setSettlementDeadline] =
    useState<bigint | null>(null);

  /*
   * Connected wallet ENS identity.
   */
  const [ensName, setEnsName] =
    useState<string | null>(null);

  const [isEnsLoading, setIsEnsLoading] =
    useState(false);

  const [ensInput, setEnsInput] =
    useState("");

  const [resolvedENSAddress, setResolvedENSAddress] =
    useState<`0x${string}` | null>(null);

  const [isResolvingENS, setIsResolvingENS] =
    useState(false);

  const [ensError, setEnsError] =
    useState<string | null>(null);

  /*
   * ENS identities for group members.
   *
   * Key:
   * lowercase wallet address
   *
   * Value:
   * ENS name or null
   */
  const [memberEnsNames, setMemberEnsNames] =
    useState<
      Record<string, string | null>
    >({});

  /*
   * On-chain activity history.
   */
  const [activity, setActivity] =
    useState<ActivityItem[]>([]);

  const [isActivityLoading, setIsActivityLoading] =
    useState(false);

  const [activityError, setActivityError] =
    useState<string | null>(null);

  /*
   * Create a stable representation of the current
   * expense batch.
   *
   * This is used to determine whether the current
   * expenses have already been settled.
   */
  const currentExpenseBatch =
    JSON.stringify(
      expenses.map((expense) => ({
        description:
          expense.description,
        amount: expense.amount,
        paidBy:
          expense.paidBy.toLowerCase(),
        groupId: expense.groupId,
      }))
    );

  /*
   * Load locally persisted Vectra data.
   */
  useEffect(() => {
  setMounted(true);

  try {
    const savedGroupName = localStorage.getItem(
      "vectra-active-group-name"
    );

    const savedGroupId = localStorage.getItem(
      "vectra-active-group-id"
    );

    const savedExpenses = localStorage.getItem(
      "vectra-expenses"
    );

    const savedMembers = localStorage.getItem(
      "vectra-members"
    );

    const savedSettledExpenseBatch = localStorage.getItem(
      "vectra-settled-expense-batch"
    );

    /*
     * Migrate the old global storage format into
     * the new per-group storage format.
     */
    const existingGroupStorage = localStorage.getItem(
      GROUP_STORAGE_KEY
    );

    if (!existingGroupStorage) {
      const migratedStorage: GroupStorage = {
        [DEMO_GROUP_ID.toLowerCase()]: {
          name: "Demo Group",
          members: INITIAL_MEMBERS,
          expenses: [],
          settledExpenseBatch: null,
        },
      };

      if (savedMembers) {
        const parsedMembers = JSON.parse(savedMembers);

        if (
          Array.isArray(parsedMembers) &&
          parsedMembers.length > 0
        ) {
          migratedStorage[
            DEMO_GROUP_ID.toLowerCase()
          ].members = parsedMembers;
        }
      }

      if (savedExpenses) {
        const parsedExpenses = JSON.parse(savedExpenses);

        if (Array.isArray(parsedExpenses)) {
          migratedStorage[
            DEMO_GROUP_ID.toLowerCase()
          ].expenses = parsedExpenses;
        }
      }

      if (savedSettledExpenseBatch) {
        migratedStorage[
          DEMO_GROUP_ID.toLowerCase()
        ].settledExpenseBatch = savedSettledExpenseBatch;
      }

      saveGroupStorage(migratedStorage);
    }

    if (savedGroupName) {
      setActiveGroupName(savedGroupName);
    }

    if (
      savedGroupId &&
      savedGroupId.startsWith("0x")
    ) {
      const normalizedGroupId =
        savedGroupId.toLowerCase();

      setActiveGroupId(
        savedGroupId as `0x${string}`
      );

      /*
       * Load data belonging specifically to
       * the currently active group.
       */
      const groupStorage = loadGroupStorage();

      const groupData =
        groupStorage[normalizedGroupId];

      if (groupData) {
        setMembers(groupData.members);
        setExpenses(groupData.expenses);
        setSettledExpenseBatch(
          groupData.settledExpenseBatch
        );
      } else {
        /*
         * New group with no local data yet.
         */
        setMembers([]);
        setExpenses([]);
        setSettledExpenseBatch(null);
      }
    } else {
      /*
       * No active group exists yet.
       */
      setMembers([]);
      setExpenses([]);
      setSettledExpenseBatch(null);
    }
  } catch (error) {
    console.error(
      "Failed to load Vectra data:",
      error
    );
  }

  setStorageLoaded(true);
}, []);

useEffect(() => {
  if (!storageLoaded) {
    return;
  }

  setGroupDataLoaded(false);

  try {
    const storage = loadGroupStorage();

    const groupData =
      storage[activeGroupId.toLowerCase()] ??
      storage[activeGroupId];

    if (groupData) {
      setMembers(
        groupData.members.length > 0
          ? groupData.members
          : INITIAL_MEMBERS
      );

      setExpenses(
        Array.isArray(groupData.expenses)
          ? groupData.expenses
          : []
      );

      setSettledExpenseBatch(
        groupData.settledExpenseBatch
      );
    } else {
      /*
      * New group starts with a clean local state.
      * The connected wallet becomes the coordinator.
      */
      setMembers(
        address
          ? [
              {
                name: "Coordinator",
                address,
              },
            ]
          : []
      );

      setExpenses([]);
      setSettledExpenseBatch(null);
    }
  } catch (error) {
    console.error(
      "Failed to load active group data:",
      error
    );

    setMembers(INITIAL_MEMBERS);
    setExpenses([]);
    setSettledExpenseBatch(null);
  } finally {
    setGroupDataLoaded(true);
  }
}, [
  activeGroupId,
  storageLoaded,
]);

  /*
 * Persist data for the active group only.
 */
useEffect(() => {
  if (
    !storageLoaded ||
    !groupDataLoaded
  ) {
    return;
  }

  try {
    const storage =
      loadGroupStorage();

    storage[
      activeGroupId.toLowerCase()
    ] = {
      name: activeGroupName,
      members,
      expenses,
      settledExpenseBatch,
    };

    saveGroupStorage(
      storage
    );

    localStorage.setItem(
      "vectra-active-group-name",
      activeGroupName
    );

    localStorage.setItem(
      "vectra-active-group-id",
      activeGroupId
    );
  } catch (error) {
    console.error(
      "Failed to save active group data:",
      error
    );
  }
}, [
  members,
  expenses,
  settledExpenseBatch,
  activeGroupId,
  activeGroupName,
  storageLoaded,
  groupDataLoaded,
]);

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

  /*
   * Resolve the connected wallet's primary ENS name.
   */
  useEffect(() => {
    let cancelled = false;

    const resolveENS = async () => {
      if (!address) {
        setEnsName(null);
        setIsEnsLoading(false);
        return;
      }

      setIsEnsLoading(true);

      try {
        const name =
          await ensClient.getEnsName({
            address,
          });

        if (!cancelled) {
          setEnsName(name);
        }
      } catch (error) {
        console.error(
          "ENS resolution failed:",
          error
        );

        if (!cancelled) {
          setEnsName(null);
        }
      } finally {
        if (!cancelled) {
          setIsEnsLoading(false);
        }
      }
    };

    resolveENS();

    return () => {
      cancelled = true;
    };
  }, [address]);

  /*
   * Resolve ENS names for group members.
   */
  useEffect(() => {
    let cancelled = false;

    const resolveMemberENS = async () => {
      if (members.length === 0) {
        setMemberEnsNames({});
        return;
      }

      try {
        const results =
          await Promise.all(
            members.map(
              async (member) => {
                try {
                  const name =
                    await ensClient.getEnsName(
                      {
                        address:
                          member.address as `0x${string}`,
                      }
                    );

                  return [
                    member.address.toLowerCase(),
                    name,
                  ] as const;
                } catch {
                  return [
                    member.address.toLowerCase(),
                    null,
                  ] as const;
                }
              }
            )
          );

        if (!cancelled) {
          setMemberEnsNames(
            Object.fromEntries(
              results
            )
          );
        }
      } catch (error) {
        console.error(
          "Member ENS resolution failed:",
          error
        );
      }
    };

    resolveMemberENS();

    return () => {
      cancelled = true;
    };
  }, [members]);

  /*
   * Resolve an ENS name entered by the user.
   */
  const resolveENSInput = async () => {
    const name =
      ensInput.trim().toLowerCase();

    if (!name) {
      setEnsError(
        "Enter an ENS name."
      );
      setResolvedENSAddress(
        null
      );
      return;
    }

    setIsResolvingENS(true);
    setEnsError(null);
    setResolvedENSAddress(null);

    try {
      const resolvedAddress =
        await ensClient.getEnsAddress({
          name,
        });

      if (!resolvedAddress) {
        setEnsError(
          "This ENS name does not resolve to an address."
        );
        return;
      }

      setResolvedENSAddress(
        resolvedAddress
      );
    } catch (error) {
      console.error(
        "ENS input resolution failed:",
        error
      );

      setEnsError(
        "Failed to resolve ENS name. Please try again."
      );
    } finally {
      setIsResolvingENS(false);
    }
  };

  const {
    signTypedData,
    data: signedSettlement,
    isPending:
      isSigningSettlement,
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
    reset: resetApproveUSDC,
  } = useWriteContract();

  const {
    writeContract: executeSettlement,
    data: settlementTxHash,
    isPending:
      isExecutingSettlement,
    reset: resetSettlement,
  } = useWriteContract();

  const {
    isLoading:
      isCreatingGroupConfirming,
    isSuccess:
      isGroupCreatedOnChain,
  } =
    useWaitForTransactionReceipt(
      {
        hash: createGroupTxHash,
      }
    );

  const {
    isLoading:
      isSettlementConfirming,
    isSuccess:
      isSettlementConfirmed,
  } =
    useWaitForTransactionReceipt(
      {
        hash: settlementTxHash,
      }
    );

  /*
   * When settlement confirms, permanently mark the
   * current expense batch as settled in localStorage.
   *
   * We do NOT delete the expenses.
   */
  useEffect(() => {
    if (!isSettlementConfirmed) {
      return;
    }

    if (!pendingSettlementBatch) {
      return;
    }

    setSettledExpenseBatch(
      pendingSettlementBatch
    );

    setPendingSettlementBatch(null);
    setSettlementSignature(null);
    setSettlementDeadline(null);

    resetApproveUSDC();
    resetSettlement();
    setPendingSettlementBatch(null);
  }, [
    isSettlementConfirmed,
    pendingSettlementBatch,
  ]);

  /*
   * On-chain coordinator.
   */
  const {
    data: coordinator,
    isLoading:
      isCoordinatorLoading,
  } = useReadContract({
    address:
      VECTRA_TREASURY_ADDRESS,
    abi: vectraTreasuryAbi,
    functionName:
      "coordinators",
    args: [activeGroupId],
    chainId: arcTestnet.id,
  });

  /*
   * On-chain nonce.
   */
  const {
    data: groupNonce,
    isLoading: isNonceLoading,
  } = useReadContract({
    address:
      VECTRA_TREASURY_ADDRESS,
    abi: vectraTreasuryAbi,
    functionName: "nonces",
    args: [activeGroupId],
    chainId: arcTestnet.id,
  });

  /*
   * Current wallet USDC balance.
   */
  const {
    data: usdcBalance,
    isLoading:
      isBalanceLoading,
  } = useReadContract({
    address:
      "0x3600000000000000000000000000000000000000",
    abi: usdcAbi,
    functionName:
      "balanceOf",
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
   * Display an ENS name when available.
   *
   * Priority:
   * 1. Connected wallet ENS
   * 2. Group member ENS
   * 3. Shortened address
   */
  const formatIdentity = (
    value?: string
  ) => {
    if (!value) {
      return "—";
    }

    const normalized =
      value.toLowerCase();

    if (
      address &&
      normalized ===
        address.toLowerCase() &&
      ensName
    ) {
      return ensName;
    }

    const memberENS =
      memberEnsNames[
        normalized
      ];

    if (memberENS) {
      return memberENS;
    }

    return `${value.slice(
      0,
      6
    )}...${value.slice(-4)}`;
  };

  /*
   * Settlement optimizer.
   *
   * If the current expense batch has already been
   * settled, return no pending settlements.
   */
  const calculateSettlements =
    (): Settlement[] => {
      if (
        settledExpenseBatch ===
        currentExpenseBatch
      ) {
        return [];
      }

      const balances =
        new Map<
          string,
          number
        >();

      const memberAddresses =
        members.map(
          (member) =>
            member.address.toLowerCase()
        );

      for (const expense of expenses) {
        const amount =
          Number(
            expense.amount
          );

        if (
          !Number.isFinite(
            amount
          ) ||
          amount <= 0
        ) {
          continue;
        }

        const payer =
          expense.paidBy.toLowerCase();

        balances.set(
          payer,
          (balances.get(
            payer
          ) ?? 0) + amount
        );

        for (
          const memberAddr of
            memberAddresses
        ) {
          balances.set(
            memberAddr,
            (balances.get(
              memberAddr
            ) ?? 0) -
              amount /
                memberAddresses.length
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

      for (
        const [
          member,
          balance,
        ] of balances
      ) {
        if (
          balance <
          -0.000001
        ) {
          debtors.push({
            address: member,
            amount:
              Math.abs(
                balance
              ),
          });
        } else if (
          balance >
          0.000001
        ) {
          creditors.push({
            address: member,
            amount:
              balance,
          });
        }
      }

      const result: Settlement[] =
        [];

      let debtorIndex = 0;
      let creditorIndex = 0;

      while (
        debtorIndex <
          debtors.length &&
        creditorIndex <
          creditors.length
      ) {
        const debtor =
          debtors[
            debtorIndex
          ];

        const creditor =
          creditors[
            creditorIndex
          ];

        const amount =
          Math.min(
            debtor.amount,
            creditor.amount
          );

        result.push({
          from:
            debtor.address,
          to:
            creditor.address,
          amount:
            Number(
              amount.toFixed(
                6
              )
            ),
        });

        debtor.amount -=
          amount;

        creditor.amount -=
          amount;

        if (
          debtor.amount <=
          0.000001
        ) {
          debtorIndex++;
        }

        if (
          creditor.amount <=
          0.000001
        ) {
          creditorIndex++;
        }
      }

      return result;
    };

  const settlements =
    calculateSettlements();

  /*
   * Calculate the deterministic hash used by the
   * EIP-712 Settlement intent.
   */
  const calculateTransfersHash = (
    transfers: Settlement[]
  ): `0x${string}` => {
    const transferTypeHash =
      keccak256(
        stringToHex(
          "Transfer(address from,address to,uint256 amount)"
        )
      );

    const transferHashes =
      transfers.map(
        (transfer) =>
          keccak256(
            encodeAbiParameters(
              [
                {
                  type: "bytes32",
                },
                {
                  type: "address",
                },
                {
                  type: "address",
                },
                {
                  type: "uint256",
                },
              ],
              [
                transferTypeHash,
                transfer.from as `0x${string}`,
                transfer.to as `0x${string}`,
                BigInt(
                  Math.round(
                    transfer.amount *
                      1_000_000
                  )
                ),
              ]
            )
          )
      );

    return keccak256(
      concat(
        transferHashes
      )
    );
  };

  /*
   * Load activity directly from Arcscan (Blockscout) indexed logs API.
   *
   * Replaces repeated eth_getLogs RPC calls with a single indexed query.
   */
  const loadActivity = async () => {
    if (!isArcNetwork || !activeGroupId) {
      setActivity([]);
      return;
    }

    setIsActivityLoading(true);
    setActivityError(null);

    try {
      const url = `https://testnet.arcscan.app/api/v2/addresses/${VECTRA_TREASURY_ADDRESS}/logs`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Activity API returned ${response.status}`
        );
      }

      const data = await response.json();
      const allActivity: ActivityItem[] = [];

      for (const log of data.items ?? []) {
        const topics = log.topics ?? [];

        /*
         * GroupRegistered:
         * topic0 = event signature
         * topic1 = indexed groupId
         * topic2 = indexed coordinator
         */
        if (
          topics[0]?.toLowerCase() ===
            GROUP_REGISTERED_EVENT.topicHash.toLowerCase() &&
          topics[1]?.toLowerCase() ===
            activeGroupId.toLowerCase()
        ) {
          const coordinator = `0x${topics[2]?.slice(-40)}`;

          allActivity.push({
            type: "registration",
            txHash: log.transaction_hash,
            blockNumber: BigInt(log.block_number),
            coordinator: coordinator as `0x${string}`,
          });
        }

        /*
         * SettlementExecuted:
         * topic0 = event signature
         * topic1 = indexed groupId
         * topic2 = indexed from
         * topic3 = indexed to
         * data = amount
         */
        if (
          topics[0]?.toLowerCase() ===
            SETTLEMENT_EXECUTED_EVENT.topicHash.toLowerCase() &&
          topics[1]?.toLowerCase() ===
            activeGroupId.toLowerCase()
        ) {
          const from = `0x${topics[2]?.slice(-40)}`;
          const to = `0x${topics[3]?.slice(-40)}`;
          const amount =
            log.data && log.data !== "0x"
              ? BigInt(log.data)
              : BigInt(0);

          allActivity.push({
            type: "settlement",
            txHash: log.transaction_hash,
            blockNumber: BigInt(log.block_number),
            from: from as `0x${string}`,
            to: to as `0x${string}`,
            amount,
          });
        }
      }

      allActivity.sort((a, b) => {
        if (a.blockNumber === b.blockNumber) {
          return 0;
        }

        return a.blockNumber > b.blockNumber
          ? -1
          : 1;
      });

      setActivity(allActivity);
    } catch (error) {
      console.error(
        "Failed to load on-chain activity:",
        error
      );

      setActivityError(
        "Unable to load on-chain activity."
      );
    } finally {
      setIsActivityLoading(false);
    }
  };

  /*
   * Refresh activity when:
   * - app mounts
   * - user switches to Arc
   * - active group changes
   * - group registration confirms
   * - settlement confirms
   */
  useEffect(() => {
    if (
      !mounted ||
      !isArcNetwork
    ) {
      setActivity([]);
      return;
    }

    loadActivity();
  }, [
    mounted,
    isArcNetwork,
    activeGroupId,
    isGroupCreatedOnChain,
    isSettlementConfirmed,
  ]);

  const handleConnect =
    () => {
      const connector =
        connectors[0];

      if (!connector) {
        return;
      }

      connect({
        connector,
      });
    };

  const handleDisconnect =
    () => {
      disconnect();

      setEnsName(null);
      setIsEnsLoading(false);

      setSettlementSignature(
        null
      );
      setSettlementDeadline(
        null
      );
      resetApproveUSDC();
      resetSettlement();
      setPendingSettlementBatch(null);

      setEnsInput("");
      setResolvedENSAddress(
        null
      );
      setEnsError(null);
      setIsResolvingENS(false);

      setActivity([]);
      setActivityError(null);
    };

  const loadAvailableGroups = (): {
  id: `0x${string}`;
  name: string;
}[] => {
  const storage = loadGroupStorage();

  return Object.entries(storage).map(
    ([id, data]) => ({
      id: id as `0x${string}`,
      name: data.name,
    })
  );
};

  const handleCreateGroup = () => {
    if (
      !address ||
      !isConnected ||
      !isArcNetwork
    ) {
      return;
    }
  
  const loadAvailableGroups = (): {
  id: `0x${string}`;
  name: string;
}[] => {
  const storage = loadGroupStorage();

  return Object.entries(storage).map(
    ([id, data]) => ({
      id: id as `0x${string}`,
      name: data.name,
    })
  );
};

    const trimmedGroupName =
      groupName.trim();

    if (!trimmedGroupName) {
      return;
    }

    const generatedGroupId =
      keccak256(
        stringToHex(
          `${trimmedGroupName}-${address}-${Date.now()}`
        )
      );

    /*
    * Create a completely independent
    * local data bucket for the new group.
    */
    try {
      const storage =
        loadGroupStorage();

      storage[
        generatedGroupId.toLowerCase()
      ] = {
        name: trimmedGroupName,
        members: [
          {
            name: "Coordinator",
            address,
          },
        ],
        expenses: [],
        settledExpenseBatch: null,
      };

      saveGroupStorage(storage);
    } catch (error) {
      console.error(
        "Failed to initialize new group:",
        error
      );

      return;
    }

    /*
    * Switch the UI to the newly created group.
    */
    setActiveGroupName(
      trimmedGroupName
    );

    setActiveGroupId(
      generatedGroupId
    );

    setMembers([
      {
        name: "Coordinator",
        address,
      },
    ]);

    setExpenses([]);

    setSettledExpenseBatch(
      null
    );

    setSettlementSignature(
      null
    );

    setSettlementDeadline(
      null
    );

    /*
    * Register the group on Arc.
    */
    writeContract({
      address:
        VECTRA_TREASURY_ADDRESS,
      abi:
        vectraTreasuryAbi,
      functionName:
        "registerGroup",
      args: [
        generatedGroupId,
      ],
      chainId:
        arcTestnet.id,
    });
  };

  const handleSwitchGroup = (
  groupId: `0x${string}`,
  name: string
) => {
  const normalizedGroupId =
    groupId.toLowerCase();

  try {
    const storage =
      loadGroupStorage();

    const groupData =
      storage[normalizedGroupId];

    if (!groupData) {
      console.error(
        "Group data not found:",
        groupId
      );
      return;
    }

    setActiveGroupId(groupId);
    setActiveGroupName(name);

    setMembers(
      groupData.members
    );

    setExpenses(
      groupData.expenses
    );

    setSettledExpenseBatch(
      groupData.settledExpenseBatch
    );

    /*
     * A new group switch means any previous
     * signing/execution state must be cleared.
     */
    setSettlementSignature(null);
    setSettlementDeadline(null);
    setPendingSettlementBatch(null);
  } catch (error) {
    console.error(
      "Failed to switch group:",
      error
    );
  }
};

  const handleAddExpense =
    () => {
      if (
        !expenseDescription.trim()
      ) {
        return;
      }

      if (
        !expenseAmount.trim()
      ) {
        return;
      }

      if (!expensePaidBy) {
        return;
      }

      const amount =
        Number(
          expenseAmount
        );

      if (
        !Number.isFinite(
          amount
        ) ||
        amount <= 0
      ) {
        return;
      }

      setExpenses(
        (current) => [
          ...current,
          {
            description:
              expenseDescription.trim(),
            amount:
              amount.toFixed(
                2
              ),
            paidBy:
              expensePaidBy,
            groupId:
              activeGroupId,
          },
        ]
      );

      setExpenseDescription(
        ""
      );

      setExpenseAmount(
        ""
      );

      setExpensePaidBy(
        ""
      );

      setSettlementSignature(
        null
      );

      setSettlementDeadline(
        null
      );

      /*
       * A changed expense set represents a new settlement.
       */
      setSettledExpenseBatch(
        null
      );
    };

  const handleDeleteExpense =
    (
      index: number
    ) => {
      const expense =
        expenses[index];

      if (!expense) {
        return;
      }

      if (
        window.confirm(
          `Delete expense "${expense.description}"?`
        )
      ) {
        setExpenses(
          (current) =>
            current.filter(
              (_, i) =>
                i !== index
            )
        );

        setSettlementSignature(
          null
        );

        setSettlementDeadline(
          null
        );

        setSettledExpenseBatch(
          null
        );
      }
    };

  const handleDeleteMember =
    (
      member: Member
    ) => {
      if (
        coordinator?.toLowerCase() ===
        member.address.toLowerCase()
      ) {
        window.alert(
          "The group coordinator cannot be removed."
        );
        return;
      }

      const isReferencedByExpense =
        expenses.some(
          (expense) =>
            expense.paidBy.toLowerCase() ===
            member.address.toLowerCase()
        );

      if (
        isReferencedByExpense
      ) {
        window.alert(
          `Cannot delete ${member.name}. They are referenced by an existing expense. Delete the expense first.`
        );
        return;
      }

      if (
        !window.confirm(
          `Remove ${member.name} from the group?`
        )
      ) {
        return;
      }

      setMembers(
        (current) =>
          current.filter(
            (currentMember) =>
              currentMember.address.toLowerCase() !==
              member.address.toLowerCase()
          )
      );

      setMemberEnsNames(
        (current) => {
          const updated = {
            ...current,
          };

          delete updated[
            member.address.toLowerCase()
          ];

          return updated;
        }
      );

      setSettlementSignature(
        null
      );

      setSettlementDeadline(
        null
      );

      setSettledExpenseBatch(
        null
      );

      if (
        expensePaidBy.toLowerCase() ===
        member.address.toLowerCase()
      ) {
        setExpensePaidBy(
          ""
        );
      }
    };

  const handleApproveSettlement =
    () => {
      if (
        !address ||
        !isConnected ||
        !isArcNetwork
      ) {
        return;
      }

      if (
        settlements.length ===
        0
      ) {
        return;
      }

      const outgoingAmount =
        settlements
          .filter(
            (settlement) =>
              settlement.from.toLowerCase() ===
              address.toLowerCase()
          )
          .reduce(
            (
              total,
              settlement
            ) =>
              total +
              settlement.amount,
            0
          );

      if (
        outgoingAmount <=
        0
      ) {
        return;
      }

      const amountInUSDC =
        BigInt(
          Math.round(
            outgoingAmount *
              1_000_000
          )
        );

      approveUSDC({
        address:
          "0x3600000000000000000000000000000000000000",
        abi: usdcAbi,
        functionName:
          "approve",
        args: [
          VECTRA_TREASURY_ADDRESS,
          amountInUSDC,
        ],
        chainId:
          arcTestnet.id,
      });
    };

  const handleSignSettlement =
    () => {
      if (
        !address ||
        !isConnected ||
        !isArcNetwork
      ) {
        return;
      }

      if (
        settlements.length ===
        0
      ) {
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
        groupNonce ??
        BigInt(0);

      const deadline =
        BigInt(
          Math.floor(
            Date.now() /
              1000
          ) +
            15 * 60
        );

      setSettlementDeadline(
        deadline
      );

      setSettlementSignature(
        null
      );

      resetApproveUSDC();
      resetSettlement();
      setPendingSettlementBatch(null);

      signTypedData({
        domain:
          EIP712_DOMAIN,
        types:
          SETTLEMENT_TYPES,
        primaryType:
          "Settlement",
        message: {
          groupId:
            activeGroupId,
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

  const handleExecuteSettlement =
    () => {
      if (
        !address ||
        !isConnected ||
        !isArcNetwork
      ) {
        return;
      }

      if (
        settlements.length ===
        0
      ) {
        return;
      }

      if (
        !settlementSignature ||
        !settlementDeadline
      ) {
        return;
      }

      if (
        groupNonce ===
        undefined
      ) {
        return;
      }

      const intent = {
        groupId:
          activeGroupId,

        nonce:
          groupNonce,

        deadline:
          settlementDeadline,

        from:
          settlements.map(
            (settlement) =>
              settlement.from as `0x${string}`
          ),

        to:
          settlements.map(
            (settlement) =>
              settlement.to as `0x${string}`
          ),

        amounts:
          settlements.map(
            (settlement) =>
              BigInt(
                Math.round(
                  settlement.amount *
                    1_000_000
                )
              )
          ),
      };

      setPendingSettlementBatch(currentExpenseBatch);

      executeSettlement({
        address:
          VECTRA_TREASURY_ADDRESS,
        abi:
          vectraTreasuryAbi,
        functionName:
          "executeSettlementIntent",
        args: [
          intent,
          settlementSignature,
        ],
        chainId:
          arcTestnet.id,
      });
    };

  const formatAddress =
    (
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

  const formatDeadline =
    () => {
      if (!settlementDeadline) {
        return "—";
      }

      return new Date(
        Number(
          settlementDeadline *
            BigInt(1000)
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
              Record shared expenses,
              optimize the debt graph,
              and settle the minimum
              number of USDC transfers
              on Arc.
            </p>
          </div>

          <div>
            {!isConnected ? (
              <button
                onClick={
                  handleConnect
                }
                className="rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300"
              >
                Connect Wallet
              </button>
            ) : (
              <div className="flex flex-col items-end gap-2">
                <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm">
                  {ensName ? (
                    <div>
                      <div className="font-semibold text-cyan-300">
                        {ensName}
                      </div>

                      <div className="mt-1 text-xs text-slate-500">
                        {formatAddress(
                          address
                        )}
                      </div>
                    </div>
                  ) : isEnsLoading ? (
                    <div className="text-slate-400">
                      Resolving ENS...
                    </div>
                  ) : (
                    formatAddress(
                      address
                    )
                  )}
                </div>

                <button
                  onClick={
                    handleDisconnect
                  }
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
                      chainId:
                        arcTestnet.id,
                    })
                  }
                  disabled={
                    isSwitching
                  }
                  className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
                >
                  {isSwitching
                    ? "Switching..."
                    : "Switch to Arc"}
                </button>
              </div>
            </section>
          )}

        {/* Groups */}
<section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
    <div>
      <h2 className="text-lg font-semibold">
        Your Groups
      </h2>

      <p className="mt-1 text-sm text-slate-500">
        Switch between your Vectra groups.
      </p>
    </div>

    <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-300">
      {loadAvailableGroups().length}{" "}
      {loadAvailableGroups().length === 1
        ? "Group"
        : "Groups"}
    </div>
  </div>

  <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
    {loadAvailableGroups().map(
      (group) => {
        const isActive =
          group.id.toLowerCase() ===
          activeGroupId.toLowerCase();

        return (
          <button
            key={group.id}
            type="button"
            onClick={() =>
              handleSwitchGroup(
                group.id,
                group.name
              )
            }
            className={`rounded-xl border p-4 text-left transition ${
              isActive
                ? "border-cyan-400/40 bg-cyan-400/10"
                : "border-slate-800 bg-slate-950 hover:border-slate-600"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={`font-semibold ${
                  isActive
                    ? "text-cyan-300"
                    : "text-white"
                }`}
              >
                {group.name}
              </span>

              {isActive && (
                <span className="rounded-full bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-300">
                  Active
                </span>
              )}
            </div>

            <div className="mt-2 truncate text-xs text-slate-500">
              {group.id}
            </div>
          </button>
        );
      }
    )}
  </div>
</section>

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
                  Identity
                </div>

                <div className="mt-1 text-sm">
                  {ensName ? (
                    <span className="font-semibold text-cyan-300">
                      {ensName}
                    </span>
                  ) : isEnsLoading ? (
                    <span className="text-slate-500">
                      Resolving ENS...
                    </span>
                  ) : (
                    <span className="text-slate-300">
                      No ENS name
                    </span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Address
                </div>

                <div className="mt-1 break-all text-sm text-slate-300">
                  {address ??
                    "Not connected"}
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
                    : usdcBalance !==
                        undefined
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
                {formatAddress(
                  activeGroupId
                )}
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto]">
              <input
                value={
                  groupName
                }
                onChange={(
                  event
                ) =>
                  setGroupName(
                    event.target.value
                  )
                }
                placeholder="New group name"
                className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-cyan-400"
              />

              <button
                onClick={
                  handleCreateGroup
                }
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
                  {
                    createGroupTxHash
                  }
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
                    : formatIdentity(
                        coordinator
                      )}
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
                    : groupNonce?.toString() ??
                      "—"}
                </div>
              </div>

              <div className="rounded-xl bg-slate-950 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Members
                </div>

                <div className="mt-2 text-sm text-slate-300">
                  {
                    members.length
                  }
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
              value={
                expenseDescription
              }
              onChange={(
                event
              ) =>
                setExpenseDescription(
                  event.target.value
                )
              }
              placeholder="Description"
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-cyan-400"
            />

            <input
              value={
                expenseAmount
              }
              onChange={(
                event
              ) =>
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
              value={
                expensePaidBy
              }
              onChange={(
                event
              ) =>
                setExpensePaidBy(
                  event.target.value
                )
              }
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-cyan-400"
            >
              <option value="">
                Paid by...
              </option>

              {members.map(
                (member) => (
                  <option
                    key={
                      member.address
                    }
                    value={
                      member.address
                    }
                  >
                    {memberEnsNames[
                      member.address.toLowerCase()
                    ]
                      ? `${memberEnsNames[
                          member.address.toLowerCase()
                        ]} (${member.name})`
                      : member.name}
                  </option>
                )
              )}
            </select>

            <button
              onClick={
                handleAddExpense
              }
              className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
            >
              Add Expense
            </button>
          </div>

          {expenses.length >
            0 && (
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

                    <th className="pb-3 text-right">
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {expenses.map(
                    (
                      expense,
                      index
                    ) => (
                      <tr
                        key={`${expense.description}-${index}`}
                        className="border-b border-slate-800/70"
                      >
                        <td className="py-4">
                          {
                            expense.description
                          }
                        </td>

                        <td className="py-4">
                          {
                            expense.amount
                          }{" "}
                          USDC
                        </td>

                        <td className="py-4 text-slate-400">
                          {formatIdentity(
                            expense.paidBy
                          )}
                        </td>

                        <td className="py-4 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              handleDeleteExpense(
                                index
                              )
                            }
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            Delete
                          </button>
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
              Vectra minimizes the number of
              transfers needed to settle the
              group.
            </p>
          </div>

          {settledExpenseBatch ===
            currentExpenseBatch &&
          expenses.length > 0 ? (
            <div className="mt-6 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6">
              <div className="text-lg font-semibold text-emerald-400">
                Settlement Complete ✓
              </div>

              <p className="mt-2 text-sm text-slate-400">
                All current expenses have
                been settled on Arc.
              </p>

              {settlementTxHash && (
                <a
                  href={`https://testnet.arcscan.app/tx/${settlementTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-block text-xs text-cyan-400 hover:text-cyan-300"
                >
                  View settlement on Arcscan ↗
                </a>
              )}
            </div>
          ) : settlements.length ===
            0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
              Add expenses to generate a settlement.
            </div>
          ) : (
            <>
              <div className="mt-6 space-y-3">
                {settlements.map(
                  (
                    settlement,
                    index
                  ) => (
                    <div
                      key={`${settlement.from}-${settlement.to}-${index}`}
                      className="flex flex-col gap-3 rounded-xl bg-slate-950 p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <div className="text-sm font-semibold">
                          {formatIdentity(
                            settlement.from
                          )}{" "}
                          →{" "}
                          {formatIdentity(
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
                        )}{" "}
                        USDC
                      </div>
                    </div>
                  )
                )}
              </div>

              {/* Step 1: Sign */}
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
                      settlements.length ===
                        0 ||
                      groupNonce ===
                        undefined ||
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
                      {
                        settlementSignature
                      }
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

              {/* Step 2: Approval */}
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
                          {
                            approveTxHash
                          }
                        </div>
                      </div>
                    )}
                  </div>
                )}

              {/* Step 3: Execute */}
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
                        {
                          settlementTxHash
                        }
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

        {/* Activity History */}
        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                Activity History
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                On-chain activity for this group,
                read directly from Arc.
              </p>
            </div>

            <button
              type="button"
              onClick={
                loadActivity
              }
              disabled={
                isActivityLoading ||
                !isArcNetwork
              }
              className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-xs font-semibold text-slate-300 hover:border-cyan-400 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isActivityLoading
                ? "Refreshing..."
                : "Refresh Activity"}
            </button>
          </div>

          {activityError && (
            <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
              {activityError}
            </div>
          )}

          {isActivityLoading ? (
            <div className="mt-6 rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
              Loading on-chain activity...
            </div>
          ) : activity.length ===
            0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
              No on-chain activity found for this group.
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {activity.map(
                (
                  item,
                  index
                ) => (
                  <div
                    key={`${item.txHash}-${index}`}
                    className="rounded-xl bg-slate-950 p-4"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        {item.type ===
                        "registration" ? (
                          <>
                            <div className="font-semibold text-emerald-300">
                              Group Registered
                            </div>

                            <div className="mt-1 text-sm text-slate-400">
                              Coordinator:{" "}
                              <span className="text-slate-300">
                                {formatIdentity(
                                  item.coordinator
                                )}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-semibold text-cyan-300">
                              Settlement Executed
                            </div>

                            <div className="mt-1 text-sm text-slate-400">
                              {formatIdentity(
                                item.from
                              )}{" "}
                              →{" "}
                              {formatIdentity(
                                item.to
                              )}
                            </div>

                            {item.amount !==
                              undefined && (
                              <div className="mt-1 text-sm font-semibold text-slate-300">
                                {formatUnits(
                                  item.amount,
                                  6
                                )}{" "}
                                USDC
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      <div className="text-left md:text-right">
                        <div className="text-xs text-slate-500">
                          Block{" "}
                          {item.blockNumber.toString()}
                        </div>

                        <a
                          href={`https://testnet.arcscan.app/tx/${item.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-xs text-cyan-400 hover:text-cyan-300"
                        >
                          View on Arcscan ↗
                        </a>
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </section>

        {/* Add member by ENS */}
        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div>
            <h2 className="text-lg font-semibold">
              Add member by ENS
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Enter an ENS name and resolve it to a wallet address.
            </p>
          </div>

          <div className="mt-4 flex gap-2">
            <input
              value={
                ensInput
              }
              onChange={(
                e
              ) => {
                setEnsInput(
                  e.target.value
                );

                setEnsError(
                  null
                );

                setResolvedENSAddress(
                  null
                );
              }}
              placeholder="vitalik.eth"
              className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm outline-none"
            />

            <button
              type="button"
              onClick={
                resolveENSInput
              }
              disabled={
                isResolvingENS
              }
              className="rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {isResolvingENS
                ? "Resolving..."
                : "Resolve"}
            </button>
          </div>

          {ensError && (
            <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">
              {ensError}
            </div>
          )}

          {resolvedENSAddress && (
            <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-500">
                ENS Identity
              </div>

              <div className="mt-1 font-semibold text-cyan-300">
                {ensInput
                  .trim()
                  .toLowerCase()}
              </div>

              <div className="mt-4 text-xs uppercase tracking-wider text-slate-500">
                Resolved Address
              </div>

              <div className="mt-1 break-all font-mono text-sm text-slate-300">
                {
                  resolvedENSAddress
                }
              </div>

              {members.some(
                (member) =>
                  member.address.toLowerCase() ===
                  resolvedENSAddress.toLowerCase()
              ) ? (
                <div className="mt-4 text-sm text-amber-400">
                  This address is already a member.
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMembers(
                      (current) => [
                        ...current,
                        {
                          name: ensInput
                            .trim()
                            .toLowerCase(),
                          address:
                            resolvedENSAddress,
                        },
                      ]
                    );

                    setEnsInput(
                      ""
                    );

                    setResolvedENSAddress(
                      null
                    );

                    setEnsError(
                      null
                    );

                    setSettlementSignature(
                      null
                    );

                    setSettlementDeadline(
                      null
                    );

                    setSettledExpenseBatch(
                      null
                    );
                  }}
                  className="mt-4 w-full rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                >
                  Add Member
                </button>
              )}
            </div>
          )}
        </div>

        {/* Members */}
        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                Group Members
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                ENS provides the human-readable identity layer.
              </p>
            </div>

            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-300">
              ENS Identity
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {members.map(
              (member) => {
                const memberENS =
                  memberEnsNames[
                    member.address.toLowerCase()
                  ];

                const memberIsCoordinator =
                  coordinator?.toLowerCase() ===
                  member.address.toLowerCase();

                return (
                  <div
                    key={
                      member.address
                    }
                    className="rounded-xl bg-slate-950 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">
                        {
                          member.name
                        }
                      </div>

                      <div className="flex items-center gap-2">
                        {memberIsCoordinator && (
                          <div className="rounded-full bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-300">
                            Coordinator
                          </div>
                        )}

                        {memberENS && (
                          <div className="rounded-full bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-300">
                            ENS
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 text-sm font-semibold text-cyan-300">
                      {memberENS ??
                        "No ENS name"}
                    </div>

                    <div className="mt-2 break-all text-xs text-slate-500">
                      {
                        member.address
                      }
                    </div>

                    {!memberIsCoordinator && (
                      <button
                        type="button"
                        onClick={() =>
                          handleDeleteMember(
                            member
                          )
                        }
                        className="mt-3 text-xs text-red-400 hover:text-red-300"
                      >
                        Remove member
                      </button>
                    )}
                  </div>
                );
              }
            )}
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-12 border-t border-slate-800 pt-6 text-center text-xs text-slate-600">
          Vectra • Arc Testnet • USDC • EIP-712 • ENSv2
        </footer>
      </div>
    </main>
  );
}