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
  useSignMessage,
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

import { apiFetch, setSessionToken, getSessionToken } from "../lib/api";

type Settlement = {
  from: string;
  to: string;
  amount: number;
};

type Expense = {
  id: string;
  groupId: string;
  description: string;
  amount: string;
  paidBy: string;
  createdBy: string;
  settled: boolean;
  createdAt: string;
};

type ActiveSettlementSnapshot = {
  settlementId: string;
  groupId: string;
  nonce: string;
  totalAmount: string;
  expenseIds: string[];
};

type Member = {
  name: string;
  address: string;
  role?: "COORDINATOR" | "MEMBER";
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

type BackendGroup = {
  id: string;
  blockchainGroupId: string;
  name: string;
  coordinatorAddress: string;
  inviteCode: string;
  status: "ACTIVE" | "DEACTIVATED";
  memberships: {
    walletAddress: string;
    role: "COORDINATOR" | "MEMBER";
  }[];
};

/*
 * Group identifiers, memberships, expenses, and settlements
 * are now authoritative from PostgreSQL backend.
 */

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
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "owner",
        type: "address",
      },
      {
        name: "spender",
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
    useState<Member[]>([]);

  /*
   * Join group state.
   */
  const [joinCode, setJoinCode] =
    useState("");

  const [isJoiningGroup, setIsJoiningGroup] =
    useState(false);

  const [joinGroupError, setJoinGroupError] =
    useState<string | null>(null);

  const [joinGroupSuccess, setJoinGroupSuccess] =
    useState<string | null>(null);

  /*
   * Invite code copy feedback.
   */
  const [copiedInviteCode, setCopiedInviteCode] =
    useState(false);

  /*
   * Group deactivation state.
   */
  const [isDeactivatingGroup, setIsDeactivatingGroup] =
    useState(false);

  const [deactivateError, setDeactivateError] =
    useState<string | null>(null);

  const [deactivateSuccess, setDeactivateSuccess] =
    useState<string | null>(null);

  const [groupName, setGroupName] =
    useState("");

  const [activeGroupName, setActiveGroupName] =
    useState("");

  const [activeGroupId, setActiveGroupId] =
    useState<`0x${string}` | null>(
      null
    );

  const [expenseDescription, setExpenseDescription] =
    useState("");

  const [expenseAmount, setExpenseAmount] =
    useState("");

  const [expensePaidBy, setExpensePaidBy] =
    useState("");

  const [expenses, setExpenses] =
    useState<Expense[]>([]);

  const [isExpensesLoading, setIsExpensesLoading] =
    useState(false);

  const [expensesError, setExpensesError] =
    useState<string | null>(null);

  const [isAddingExpense, setIsAddingExpense] =
    useState(false);

  const [isDeletingExpenseId, setIsDeletingExpenseId] =
    useState<string | null>(null);

  const [activeSettlementSnapshot, setActiveSettlementSnapshot] =
    useState<ActiveSettlementSnapshot | null>(null);

  const [settlementExecutionError, setSettlementExecutionError] =
    useState<string | null>(null);

  const [settlementSignature, setSettlementSignature] =
    useState<`0x${string}` | null>(null);

  const [settlementDeadline, setSettlementDeadline] =
    useState<bigint | null>(null);

  const [confirmedApprovals, setConfirmedApprovals] =
    useState<Record<string, string>>({});

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
   * Backend group list.
   *
   * Fetched from PostgreSQL via the backend API.
   * Only groups where the connected wallet is a
   * member are returned.
   */
  const [backendGroups, setBackendGroups] =
    useState<BackendGroup[]>([]);

  const [isBackendGroupsLoading, setIsBackendGroupsLoading] =
    useState(false);

  const [backendGroupsError, setBackendGroupsError] =
    useState<string | null>(null);

  /*
   * Pending group creation metadata.
   *
   * Stored between the blockchain registerGroup call
   * and the on-chain confirmation, so the useEffect
   * callback knows what to POST to the backend.
   */
  const [pendingGroupCreation, setPendingGroupCreation] =
    useState<{
      name: string;
      blockchainGroupId: `0x${string}`;
      inviteCode: string;
    } | null>(null);

  const [isCreatingGroupBackend, setIsCreatingGroupBackend] =
    useState(false);

  const [createGroupError, setCreateGroupError] =
    useState<string | null>(null);

  /*
   * Backend authentication state.
   */
  const [isAuthenticating, setIsAuthenticating] =
    useState(false);

  const [isAuthenticated, setIsAuthenticated] =
    useState(false);

  const [authError, setAuthError] =
    useState<string | null>(null);

  /*
   * Vectra client mount initialization.
   * State is authoritative from PostgreSQL backend.
   */
  useEffect(() => {
    setMounted(true);
    setStorageLoaded(true);
    setGroupDataLoaded(true);
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
    signMessageAsync,
  } = useSignMessage();

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
   * Authenticate with backend after wallet connection.
   *
   * This effect handles the wallet-signature authentication flow:
   * 1. Request nonce from backend
   * 2. Sign authentication message with wallet
   * 3. Verify signature and receive session token
   * 4. Store token in memory for API requests
   */
  useEffect(() => {
    let cancelled = false;

    const authenticate = async () => {
      if (!address || !signMessageAsync) {
        setIsAuthenticated(false);
        setIsAuthenticating(false);
        return;
      }

      // Skip if already authenticated
      if (isAuthenticated && getSessionToken()) {
        return;
      }

      setIsAuthenticating(true);
      setAuthError(null);

      try {
        // Step 1: Request authentication challenge
        const challenge = await apiFetch<{
          walletAddress: string;
          nonce: string;
          message: string;
          expiresAt: string;
        }>("/auth/nonce", {
          method: "POST",
          body: JSON.stringify({
            walletAddress: address,
          }),
        });

        if (cancelled) return;

        // Step 2: Sign the exact message from backend
        const signature = await signMessageAsync({
          message: challenge.message,
        });

        if (cancelled) return;

        // Step 3: Verify signature and get session token
        const result = await apiFetch<{
          authenticated: boolean;
          sessionToken: string;
          expiresAt: string;
          user: {
            id: string;
            walletAddress: string;
          };
        }>("/auth/verify", {
          method: "POST",
          body: JSON.stringify({
            nonce: challenge.nonce,
            signature,
          }),
        });

        if (cancelled) return;

        if (result.authenticated) {
          setSessionToken(result.sessionToken);
          setIsAuthenticated(true);
        } else {
          throw new Error("Authentication failed");
        }
      } catch (error) {
        console.error("Backend authentication failed:", error);

        if (!cancelled) {
          setAuthError(
            error instanceof Error
              ? error.message
              : "Failed to authenticate with backend"
          );
          setIsAuthenticated(false);
          setSessionToken(null);
        }
      } finally {
        if (!cancelled) {
          setIsAuthenticating(false);
        }
      }
    };

    authenticate();

    return () => {
      cancelled = true;
    };
  }, [address, signMessageAsync, isAuthenticated]);

  /*
   * Clear authentication when wallet address changes or disconnects.
   *
   * This ensures each wallet has its own session and prevents
   * reusing a previous wallet's authentication.
   */
  useEffect(() => {
    // When address changes, clear the previous session
    setIsAuthenticated(false);
    setAuthError(null);
    setSessionToken(null);
  }, [address]);

  /*
   * Handle backend session expiry signalled by apiFetch on HTTP 401.
   *
   * Setting isAuthenticated to false lets the existing authentication
   * effect re-run and obtain a fresh session automatically.
   */
  useEffect(() => {
    const handleAuthExpired = () => {
      setIsAuthenticated(false);
      setAuthError("Your session expired. Re-authenticating...");
    };
    window.addEventListener("vectra:auth-expired", handleAuthExpired);
    return () => {
      window.removeEventListener("vectra:auth-expired", handleAuthExpired);
    };
  }, []);

  /*
   * Fetch the connected wallet's groups from the
   * backend whenever the wallet address changes.
   */
  useEffect(() => {
    let cancelled = false;

    const fetchGroups = async () => {
      if (!address || !isAuthenticated) {
        setIsBackendGroupsLoading(false);
        return;
      }

      setIsBackendGroupsLoading(true);
      setBackendGroupsError(null);

      try {
        const data = await apiFetch<{
          groups: BackendGroup[];
        }>("/groups");

        if (!cancelled) {
          setBackendGroups(
            data.groups
          );
        }
      } catch (error) {
        console.error(
          "Failed to fetch groups from backend:",
          error
        );

        if (!cancelled) {
          setBackendGroupsError(
            error instanceof Error
              ? error.message
              : "Failed to load groups"
          );
        }
      } finally {
        if (!cancelled) {
          setIsBackendGroupsLoading(
            false
          );
        }
      }
    };

    fetchGroups();

    return () => {
      cancelled = true;
    };
  }, [address, isAuthenticated]);

  /*
   * Validate activeGroupId against backendGroups.
   *
   * When backendGroups finishes loading, ensure the
   * active group is one the connected wallet has
   * access to. If an active settlement is in progress,
   * prioritize keeping the active group locked to that
   * settlement's group if the connected wallet belongs to it.
   *
   * NOTE: An intermediate wallet switch must NEVER wipe
   * active settlement state (signature, snapshot, approvals).
   * Legitimate cleanup is handled by explicit group switching,
   * disconnect, or settlement completion/failure.
   */
  useEffect(() => {
    if (isBackendGroupsLoading || !address) {
      return;
    }

    if (backendGroups.length === 0) {
      setActiveGroupId(null);
      setActiveGroupName("");
      setMembers([]);
      setExpenses([]);
      return;
    }

    // If an active settlement is in progress, lock to its group if the wallet is a member
    if (activeSettlementSnapshot) {
      const snapshotGroup = backendGroups.find(
        (group) => group.id === activeSettlementSnapshot.groupId
      );
      if (snapshotGroup) {
        if (
          !activeGroupId ||
          activeGroupId.toLowerCase() !==
            snapshotGroup.blockchainGroupId.toLowerCase()
        ) {
          setActiveGroupId(
            snapshotGroup.blockchainGroupId as `0x${string}`
          );
          setActiveGroupName(snapshotGroup.name);
        }
        return;
      }
    }

    const currentIsValid =
      activeGroupId &&
      backendGroups.some(
        (group) =>
          group.blockchainGroupId.toLowerCase() ===
          activeGroupId.toLowerCase()
      );

    if (!currentIsValid) {
      const firstGroup =
        backendGroups[0];

      setActiveGroupId(
        firstGroup.blockchainGroupId as `0x${string}`
      );

      setActiveGroupName(
        firstGroup.name
      );
    }
  }, [backendGroups, isBackendGroupsLoading, address, activeGroupId, activeSettlementSnapshot]);

  /*
   * Load active group memberships from the backend.
   *
   * Backend memberships are authoritative for
   * group members, roles, and count.
   */
  const loadActiveGroupMembers = async (
    backendId: string
  ) => {
    if (!address) {
      return;
    }

    try {
      const data = await apiFetch<{
        group: {
          id: string;
          blockchainGroupId: string;
          name: string;
          coordinatorAddress: string;
          inviteCode: string;
          status: string;
          memberships: {
            id: string;
            groupId: string;
            walletAddress: string;
            role: "COORDINATOR" | "MEMBER";
          }[];
        };
      }>(
        `/groups/${backendId}`
      );

      if (data?.group?.memberships) {
        setMembers(
          data.group.memberships.map(
            (m) => ({
              name:
                m.role === "COORDINATOR"
                  ? "Coordinator"
                  : "Member",
              address: m.walletAddress,
              role: m.role,
            })
          )
        );
      }
    } catch (error) {
      console.error(
        "Failed to load group memberships:",
        error
      );
    }
  };

  /*
   * Load active group expenses from the backend.
   *
   * Backend PostgreSQL is authoritative for expenses
   * and settled states.
   */
  const loadGroupExpenses = async (
    backendId: string
  ) => {
    if (!address || !isAuthenticated) {
      return;
    }

    setIsExpensesLoading(true);
    setExpensesError(null);

    try {
      const data = await apiFetch<{
        expenses: Expense[];
      }>(
        `/groups/${backendId}/expenses`
      );

      if (data?.expenses) {
        setExpenses(data.expenses);
      }
    } catch (error) {
      console.error(
        "Failed to load group expenses:",
        error
      );
      setExpensesError(
        error instanceof Error
          ? error.message
          : "Failed to load expenses"
      );
    } finally {
      setIsExpensesLoading(false);
    }
  };

  /*
   * Sync active group memberships and expenses whenever
   * activeGroupId, backendGroups, or address changes.
   */
  useEffect(() => {
    if (!activeGroupId || !address || !isAuthenticated || isBackendGroupsLoading) {
      return;
    }

    const activeGroup = backendGroups.find(
      (group) =>
        group.blockchainGroupId.toLowerCase() ===
        activeGroupId.toLowerCase()
    );

    if (!activeGroup) {
      return;
    }

    if (
      activeGroup.memberships &&
      activeGroup.memberships.length > 0
    ) {
      setMembers(
        activeGroup.memberships.map((m) => ({
          name:
            m.role === "COORDINATOR"
              ? "Coordinator"
              : "Member",
          address: m.walletAddress,
          role: m.role,
        }))
      );
    }

    loadActiveGroupMembers(activeGroup.id);
    loadGroupExpenses(activeGroup.id);
  }, [activeGroupId, backendGroups, address, isAuthenticated]);

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
    signTypedDataAsync,
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
    reset: resetCreateGroup,
  } = useWriteContract();

  const {
    writeContract: approveUSDC,
    writeContractAsync: approveUSDCAsync,
    data: approveTxHash,
    isPending: isApprovingUSDC,
    reset: resetApproveUSDC,
  } = useWriteContract();

  const {
    isSuccess: isApproveConfirmed,
  } = useWaitForTransactionReceipt({
    hash: approveTxHash,
  });

  const {
    writeContract: executeSettlement,
    writeContractAsync: executeSettlementAsync,
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
    data: settlementReceipt,
    isLoading:
      isSettlementConfirming,
    isSuccess:
      isSettlementConfirmed,
    isError:
      isSettlementReceiptError,
  } =
    useWaitForTransactionReceipt(
      {
        hash: settlementTxHash,
      }
    );

  /*
   * Update settlement record to SUBMITTED when transaction hash is available.
   */
  useEffect(() => {
    if (!settlementTxHash || !activeSettlementSnapshot || !address) {
      return;
    }

    const markSubmitted = async () => {
      try {
        await apiFetch(
          `/groups/${activeSettlementSnapshot.groupId}/settlements/${activeSettlementSnapshot.settlementId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              status: "SUBMITTED",
              transactionHash: settlementTxHash,
            }),
          }
        );
      } catch (err) {
        console.error("Failed to update settlement to SUBMITTED:", err);
      }
    };

    markSubmitted();
  }, [settlementTxHash, activeSettlementSnapshot, address]);

  /*
   * When settlement confirms on Arc, mark participating expenseIds
   * as settled in PostgreSQL and refresh expenses.
   */
  useEffect(() => {
    if (!isSettlementConfirmed) {
      return;
    }

    if (!activeSettlementSnapshot || !address) {
      return;
    }

    const completeSettlement = async () => {
      const snapshot = activeSettlementSnapshot;
      try {
        if (settlementReceipt && settlementReceipt.status === "reverted") {
          console.error("Settlement transaction reverted on Arc");
          setSettlementExecutionError("Settlement transaction reverted on Arc.");
          await apiFetch(
            `/groups/${snapshot.groupId}/settlements/${snapshot.settlementId}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                status: "FAILED",
              }),
            }
          );
        } else {
          await apiFetch(
            `/groups/${snapshot.groupId}/settlements/${snapshot.settlementId}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                status: "COMPLETED",
                transactionHash: settlementTxHash,
                expenseIds: snapshot.expenseIds,
              }),
            }
          );

          await loadGroupExpenses(snapshot.groupId);
        }
      } catch (err) {
        console.error("Failed to complete settlement in backend:", err);
      } finally {
        setActiveSettlementSnapshot(null);
        setSettlementSignature(null);
        setSettlementDeadline(null);
        setConfirmedApprovals({});
        resetApproveUSDC();
        resetSettlement();
      }
    };

    completeSettlement();
  }, [
    isSettlementConfirmed,
    settlementReceipt,
    activeSettlementSnapshot,
    address,
    settlementTxHash,
  ]);

  /*
   * If on-chain transaction receipt fails, mark settlement as FAILED.
   */
  useEffect(() => {
    if (!isSettlementReceiptError) {
      return;
    }

    if (!activeSettlementSnapshot || !address) {
      return;
    }

    const failSettlement = async () => {
      const snapshot = activeSettlementSnapshot;
      try {
        setSettlementExecutionError("Settlement transaction failed on Arc.");
        await apiFetch(
          `/groups/${snapshot.groupId}/settlements/${snapshot.settlementId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              status: "FAILED",
            }),
          }
        );
      } catch (err) {
        console.error("Failed to mark settlement as FAILED:", err);
      } finally {
        setActiveSettlementSnapshot(null);
        setSettlementSignature(null);
        setSettlementDeadline(null);
        setConfirmedApprovals({});
        resetSettlement();
      }
    };

    failSettlement();
  }, [isSettlementReceiptError, activeSettlementSnapshot, address]);

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
    args: [activeGroupId ?? ("0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`)],
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
    args: [activeGroupId ?? ("0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`)],
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

  /*
   * Current wallet USDC allowance for Vectra Treasury.
   */
  const {
    data: usdcAllowance,
    refetch: refetchAllowance,
  } = useReadContract({
    address:
      "0x3600000000000000000000000000000000000000",
    abi: usdcAbi,
    functionName:
      "allowance",
    args: address
      ? [address, VECTRA_TREASURY_ADDRESS]
      : undefined,
    chainId: arcTestnet.id,
  });

  useEffect(() => {
    if (isApproveConfirmed) {
      refetchAllowance();
      if (approveTxHash && address) {
        setConfirmedApprovals((prev) => ({
          ...prev,
          [address.toLowerCase()]: approveTxHash,
        }));
      }
    }
  }, [isApproveConfirmed, approveTxHash, address, refetchAllowance]);

  const isArcNetwork =
    chainId === arcTestnet.id;

  const activeBackendGroup =
    backendGroups.find(
      (group) =>
        group.blockchainGroupId.toLowerCase() ===
        activeGroupId?.toLowerCase()
    );

  const isCoordinator =
    Boolean(address) &&
    ((Boolean(coordinator) &&
      coordinator?.toLowerCase() ===
        address?.toLowerCase()) ||
      (Boolean(activeBackendGroup?.coordinatorAddress) &&
        activeBackendGroup?.coordinatorAddress.toLowerCase() ===
          address?.toLowerCase()));

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
   * Calculates settlements based strictly on unsettled expenses.
   */
  const calculateSettlements =
    (): Settlement[] => {
      const unsettledExpenses =
        expenses.filter((expense) => !expense.settled);

      if (unsettledExpenses.length === 0) {
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

      for (const expense of unsettledExpenses) {
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
          const coordinatorAddr = `0x${topics[2]?.slice(-40)}`;

          allActivity.push({
            type: "registration",
            txHash: log.transaction_hash,
            blockNumber: BigInt(log.block_number),
            coordinator: coordinatorAddr as `0x${string}`,
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
    async () => {
      // Attempt to logout from backend if authenticated
      if (isAuthenticated && getSessionToken()) {
        try {
          await apiFetch("/auth/logout", {
            method: "POST",
          });
        } catch (error) {
          // Log but don't block disconnect on logout failure
          console.error("Logout failed:", error);
        }
      }

      // Clear authentication state
      setSessionToken(null);
      setIsAuthenticated(false);
      setIsAuthenticating(false);
      setAuthError(null);

      disconnect();

      /*
       * Clear active group so the next wallet
       * never inherits a stale group.
       */
      setActiveGroupId(null);
      setActiveGroupName("");
      setBackendGroups([]);

      setMembers([]);
      setExpenses([]);
      setActiveSettlementSnapshot(null);

      setEnsName(null);
      setIsEnsLoading(false);

      setSettlementSignature(
        null
      );
      setSettlementDeadline(
        null
      );
      setConfirmedApprovals({});
      resetApproveUSDC();
      resetSettlement();

      setEnsInput("");
      setResolvedENSAddress(
        null
      );
      setEnsError(null);
      setIsResolvingENS(false);

      setActivity([]);
      setActivityError(null);

      resetCreateGroup();
      setPendingGroupCreation(null);
      setCreateGroupError(null);

      setJoinCode("");
      setJoinGroupError(null);
      setJoinGroupSuccess(null);
      setCopiedInviteCode(false);
      setDeactivateError(null);
      setDeactivateSuccess(null);
    };



  /*
   * Generate a human-readable invite code.
   *
   * Format: VXR-XXXXX (uppercase alphanumeric).
   */
  const generateInviteCode = (): string => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "VXR-";

    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    return code;
  };

  const handleCreateGroup = () => {
    if (
      !address ||
      !isConnected ||
      !isArcNetwork
    ) {
      return;
    }

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

    const inviteCode =
      generateInviteCode();

    /*
     * Store pending creation metadata so the
     * on-chain confirmation useEffect can POST
     * to the backend.
     */
    setPendingGroupCreation({
      name: trimmedGroupName,
      blockchainGroupId: generatedGroupId,
      inviteCode,
    });

    setCreateGroupError(null);

    /*
     * Reset previous creation state so
     * useWaitForTransactionReceipt starts
     * fresh for this new transaction.
     */
    resetCreateGroup();

    /*
     * Register the group on Arc.
     *
     * The backend POST happens only after
     * the on-chain transaction confirms.
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

  /*
   * After on-chain group registration confirms,
   * create the group in the backend and refresh
   * the group list.
   */
  useEffect(() => {
    if (
      !isGroupCreatedOnChain ||
      !pendingGroupCreation ||
      !address
    ) {
      return;
    }

    const registerBackend =
      async () => {
        setIsCreatingGroupBackend(true);
        setCreateGroupError(null);

        try {
          const res = await apiFetch<{
            group: BackendGroup;
          }>("/groups", {
            method: "POST",
            body: JSON.stringify({
              name:
                pendingGroupCreation.name,
              blockchainGroupId:
                pendingGroupCreation.blockchainGroupId,
              inviteCode:
                pendingGroupCreation.inviteCode,
            }),
          });

          /*
           * Refresh the group list so the new
           * group appears in "Your Groups".
           */
          try {
            const data =
              await apiFetch<{
                groups: BackendGroup[];
              }>(
                "/groups"
              );

            setBackendGroups(
              data.groups
            );
          } catch (refreshError) {
            console.error(
              "Failed to refresh groups:",
              refreshError
            );
          }

          /*
           * Switch the UI to the newly
           * created group.
           */
          setActiveGroupName(
            pendingGroupCreation.name
          );

          setActiveGroupId(
            pendingGroupCreation.blockchainGroupId
          );

          if (
            res?.group?.memberships &&
            res.group.memberships.length > 0
          ) {
            setMembers(
              res.group.memberships.map((m) => ({
                name: "Coordinator",
                address: m.walletAddress,
                role: m.role,
              }))
            );
          } else {
            setMembers([
              {
                name: "Coordinator",
                address,
                role: "COORDINATOR",
              },
            ]);
          }

          setExpenses([]);
          setActiveSettlementSnapshot(null);
          setSettlementSignature(null);
          setSettlementDeadline(null);

          setGroupName("");
        } catch (error) {
          console.error(
            "Failed to create group in backend:",
            error
          );

          setCreateGroupError(
            error instanceof Error
              ? error.message
              : "Failed to save group to backend"
          );
        } finally {
          setIsCreatingGroupBackend(
            false
          );

          setPendingGroupCreation(
            null
          );
        }
      };

    registerBackend();
  }, [isGroupCreatedOnChain]);

  const handleSwitchGroup = (
  groupId: `0x${string}`,
  name: string
) => {
  /*
   * Only allow switching to groups the
   * connected wallet is a member of.
   */
  const isAuthorized =
    backendGroups.some(
      (group) =>
        group.blockchainGroupId.toLowerCase() ===
        groupId.toLowerCase()
    );

  if (!isAuthorized) {
    console.error(
      "Unauthorized group switch:",
      groupId
    );
    return;
  }

  const normalizedGroupId =
    groupId.toLowerCase();

  try {
    const targetGroup = backendGroups.find(
      (group) =>
        group.blockchainGroupId.toLowerCase() ===
        normalizedGroupId
    );

    setActiveGroupId(groupId);
    setActiveGroupName(name);

    if (
      targetGroup?.memberships &&
      targetGroup.memberships.length > 0
    ) {
      setMembers(
        targetGroup.memberships.map((m) => ({
          name:
            m.role === "COORDINATOR"
              ? "Coordinator"
              : "Member",
          address: m.walletAddress,
          role: m.role,
        }))
      );
      loadActiveGroupMembers(targetGroup.id);
    } else {
      setMembers([]);
    }

    if (targetGroup) {
      loadGroupExpenses(targetGroup.id);
    } else {
      setExpenses([]);
    }

    /*
     * A new group switch means any previous
     * signing/execution state must be cleared.
     */
    setSettlementSignature(null);
    setSettlementDeadline(null);
    setActiveSettlementSnapshot(null);
    setConfirmedApprovals({});
  } catch (error) {
    console.error(
      "Failed to switch group:",
      error
    );
  }
};

  /*
   * Join an existing group via invite code.
   *
   * Calls POST /groups/join with inviteCode and walletAddress.
   */
  const handleJoinGroup = async () => {
    if (!address || !isConnected) {
      return;
    }

    const cleanCode = joinCode.trim().toUpperCase();
    if (!cleanCode) {
      setJoinGroupError("Please enter an invite code.");
      return;
    }

    setIsJoiningGroup(true);
    setJoinGroupError(null);
    setJoinGroupSuccess(null);

    try {
      const res = await apiFetch<{
        message: string;
        group: {
          id: string;
          blockchainGroupId: string;
          name: string;
          coordinatorAddress: string;
          status: string;
        };
        membership: {
          id: string;
          groupId: string;
          walletAddress: string;
          role: "COORDINATOR" | "MEMBER";
        };
      }>("/groups/join", {
        method: "POST",
        body: JSON.stringify({
          inviteCode: cleanCode,
          code: cleanCode,
        }),
      });

      /*
       * 1. Refresh backendGroups
       */
      const groupsData = await apiFetch<{
        groups: BackendGroup[];
      }>("/groups");
      setBackendGroups(groupsData.groups);

      /*
       * 2. Find newly joined group
       */
      const joinedGroup = groupsData.groups.find(
        (g) =>
          g.id === res.group.id ||
          g.blockchainGroupId.toLowerCase() ===
            res.group.blockchainGroupId.toLowerCase()
      );

      /*
       * 3. Make it the active group
       */
      const targetGroupId = (joinedGroup?.blockchainGroupId ??
        res.group.blockchainGroupId) as `0x${string}`;
      const targetGroupName =
        joinedGroup?.name ?? res.group.name;

      setActiveGroupId(targetGroupId);
      setActiveGroupName(targetGroupName);

      /*
       * 4. Load backend memberships
       */
      if (joinedGroup?.memberships) {
        setMembers(
          joinedGroup.memberships.map((m) => ({
            name:
              m.role === "COORDINATOR"
                ? "Coordinator"
                : "Member",
            address: m.walletAddress,
            role: m.role,
          }))
        );
      }
      await loadActiveGroupMembers(res.group.id);

      /*
       * 5. Show success message
       */
      setJoinGroupSuccess(
        `Successfully joined "${res.group.name}"!`
      );

      /*
       * 6. Clear join input
       */
      setJoinCode("");
    } catch (err) {
      console.error("Failed to join group:", err);
      setJoinGroupError(
        err instanceof Error
          ? err.message
          : "Failed to join group"
      );
    } finally {
      setIsJoiningGroup(false);
    }
  };

  /*
   * Logically deactivate group (coordinator-only).
   *
   * Calls PATCH /groups/:groupId/deactivate.
   * Does not modify blockchain or physically delete records.
   */
  const handleDeactivateGroup = async () => {
    if (!address || !isConnected || !activeGroupId) {
      return;
    }

    const activeGroup = backendGroups.find(
      (g) =>
        g.blockchainGroupId.toLowerCase() ===
        activeGroupId.toLowerCase()
    );

    if (!activeGroup) {
      return;
    }

    const confirmed = window.confirm(
      "Deactivate this group? Members will no longer see it in their active groups. Existing history will be preserved."
    );

    if (!confirmed) {
      return;
    }

    setIsDeactivatingGroup(true);
    setDeactivateError(null);
    setDeactivateSuccess(null);

    try {
      await apiFetch<{
        message: string;
        group: BackendGroup;
      }>(`/groups/${activeGroup.id}/deactivate`, {
        method: "PATCH",
      });

      /*
       * 1. Refresh backend groups
       */
      const data = await apiFetch<{
        groups: BackendGroup[];
      }>("/groups");

      setBackendGroups(data.groups);

      /*
       * 2. Auto-select next group or clear
       */
      if (data.groups.length > 0) {
        const nextGroup = data.groups[0];
        setActiveGroupId(
          nextGroup.blockchainGroupId as `0x${string}`
        );
        setActiveGroupName(nextGroup.name);
        setMembers(
          nextGroup.memberships.map((m) => ({
            name:
              m.role === "COORDINATOR"
                ? "Coordinator"
                : "Member",
            address: m.walletAddress,
            role: m.role,
          }))
        );
      } else {
        setActiveGroupId(null);
        setActiveGroupName("");
        setMembers([]);
        setExpenses([]);
        setActiveSettlementSnapshot(null);
        setSettlementSignature(null);
        setSettlementDeadline(null);
      }

      setDeactivateSuccess(
        "Group deactivated successfully."
      );
    } catch (err) {
      console.error("Failed to deactivate group:", err);
      setDeactivateError(
        err instanceof Error
          ? err.message
          : "Failed to deactivate group"
      );
    } finally {
      setIsDeactivatingGroup(false);
    }
  };

  const handleAddExpense = async () => {
    if (!activeGroupId || !address) {
      return;
    }

    const activeBackendGroup = backendGroups.find(
      (group) =>
        group.blockchainGroupId.toLowerCase() ===
        activeGroupId.toLowerCase()
    );

    if (!activeBackendGroup) {
      return;
    }

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

    setIsAddingExpense(true);
    setExpensesError(null);

    try {
      const data = await apiFetch<{
        expense: Expense;
      }>(`/groups/${activeBackendGroup.id}/expenses`, {
        method: "POST",
        body: JSON.stringify({
          description: expenseDescription.trim(),
          amount: amount.toFixed(2),
          paidBy: expensePaidBy,
        }),
      });

      if (data?.expense) {
        setExpenses((current) => [data.expense, ...current]);
        setExpenseDescription("");
        setExpenseAmount("");
        setExpensePaidBy("");
        setSettlementSignature(null);
        setSettlementDeadline(null);
        setActiveSettlementSnapshot(null);
      }
    } catch (err) {
      console.error("Failed to add expense:", err);
      setExpensesError(
        err instanceof Error ? err.message : "Failed to add expense"
      );
    } finally {
      setIsAddingExpense(false);
    }
  };

  const handleDeleteExpense = async (expense: Expense) => {
    if (!activeGroupId || !address) {
      return;
    }

    const activeBackendGroup = backendGroups.find(
      (group) =>
        group.blockchainGroupId.toLowerCase() ===
        activeGroupId.toLowerCase()
    );

    if (!activeBackendGroup) {
      return;
    }

    if (expense.settled) {
      window.alert("Cannot delete an already settled expense.");
      return;
    }

    if (
      !window.confirm(
        `Delete expense "${expense.description}"?`
      )
    ) {
      return;
    }

    setIsDeletingExpenseId(expense.id);
    setExpensesError(null);

    try {
      await apiFetch(
        `/groups/${activeBackendGroup.id}/expenses/${expense.id}`,
        {
          method: "DELETE",
        }
      );

      setExpenses((current) =>
        current.filter((item) => item.id !== expense.id)
      );

      setSettlementSignature(null);
      setSettlementDeadline(null);
      setActiveSettlementSnapshot(null);
    } catch (err) {
      console.error("Failed to delete expense:", err);
      window.alert(
        err instanceof Error ? err.message : "Failed to delete expense"
      );
    } finally {
      setIsDeletingExpenseId(null);
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

      setActiveSettlementSnapshot(
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
    async () => {
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

      try {
        const hash = await approveUSDCAsync({
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

        if (hash) {
          setConfirmedApprovals((prev) => ({
            ...prev,
            [address.toLowerCase()]: hash,
          }));
        }
      } catch (err) {
        console.error("USDC approval failed or was rejected:", err);
      }
    };

  const handleSignSettlement =
    async () => {
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

      const participatingExpenses = expenses.filter((e) => !e.settled);
      const participatingExpenseIds = participatingExpenses.map((e) => e.id);
      const totalAmount = settlements
        .reduce((sum, s) => sum + s.amount, 0)
        .toFixed(6);

      const targetGroup =
        activeBackendGroup ??
        backendGroups.find(
          (group) =>
            group.blockchainGroupId.toLowerCase() ===
            activeGroupId?.toLowerCase()
        );

      if (targetGroup) {
        let createdSettlementId = "";
        try {
          const createRes = await apiFetch<{
            settlement: { id: string; nonce: string; status: string };
          }>(`/groups/${targetGroup.id}/settlements`, {
            method: "POST",
            body: JSON.stringify({
              nonce: nonce.toString(),
              totalAmount,
            }),
          });
          createdSettlementId = createRes.settlement.id;
        } catch (err) {
          console.error("Failed to initialize backend settlement on sign:", err);
        }

        setActiveSettlementSnapshot({
          settlementId: createdSettlementId,
          groupId: targetGroup.id,
          nonce: nonce.toString(),
          totalAmount,
          expenseIds: participatingExpenseIds,
        });
      }

      try {
        const signature = await signTypedDataAsync({
          domain:
            EIP712_DOMAIN,
          types:
            SETTLEMENT_TYPES,
          primaryType:
            "Settlement",
          message: {
            groupId:
              activeGroupId!,
            nonce,
            deadline,
            transfersHash,
          },
        });

        if (signature) {
          setSettlementSignature(signature);
        }
      } catch (signErr) {
        console.error("Failed to sign settlement intent:", signErr);
      }
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
    async () => {
      if (
        !address ||
        !isConnected ||
        !isArcNetwork
      ) {
        return;
      }

      const activeBackendGroup = backendGroups.find(
        (group) =>
          group.blockchainGroupId.toLowerCase() ===
          activeGroupId?.toLowerCase()
      );

      if (!activeBackendGroup) {
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

      const participatingExpenseIds =
        activeSettlementSnapshot?.expenseIds &&
        activeSettlementSnapshot.expenseIds.length > 0
          ? activeSettlementSnapshot.expenseIds
          : expenses.filter((e) => !e.settled).map((e) => e.id);

      if (participatingExpenseIds.length === 0) {
        return;
      }

      const totalAmount = settlements
        .reduce((sum, s) => sum + s.amount, 0)
        .toFixed(6);

      setSettlementExecutionError(null);

      let createdSettlementId = activeSettlementSnapshot?.settlementId;

      if (!createdSettlementId) {
        try {
          const createRes = await apiFetch<{
            settlement: { id: string; nonce: string; status: string };
          }>(`/groups/${activeBackendGroup.id}/settlements`, {
            method: "POST",
            body: JSON.stringify({
              nonce: groupNonce.toString(),
              totalAmount,
            }),
          });
          createdSettlementId = createRes.settlement.id;
        } catch (err) {
          console.error("Failed to initialize backend settlement record:", err);
          setSettlementExecutionError(
            err instanceof Error ? err.message : "Failed to initialize settlement"
          );
          return;
        }
      }

      const snapshot: ActiveSettlementSnapshot = {
        settlementId: createdSettlementId,
        groupId: activeBackendGroup.id,
        nonce: groupNonce.toString(),
        totalAmount,
        expenseIds: participatingExpenseIds,
      };

      setActiveSettlementSnapshot(snapshot);

      const intent = {
        groupId:
          activeGroupId!,

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

      try {
        const hash = await executeSettlementAsync({
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

        if (hash) {
          await apiFetch(
            `/groups/${snapshot.groupId}/settlements/${snapshot.settlementId}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                status: "SUBMITTED",
                transactionHash: hash,
              }),
            }
          ).catch((e) => console.error("Failed to patch SUBMITTED settlement:", e));
        }
      } catch (execErr) {
        console.error("Settlement transaction submission failed or was rejected:", execErr);
        setSettlementExecutionError(
          execErr instanceof Error ? execErr.message : "Settlement execution failed"
        );
        await apiFetch(
          `/groups/${snapshot.groupId}/settlements/${snapshot.settlementId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              status: "FAILED",
            }),
          }
        ).catch((e) => console.error("Failed to patch FAILED settlement:", e));
        setActiveSettlementSnapshot(null);
        resetSettlement();
      }
    };

  const currentWalletOutgoing = settlements
    .filter((s) => s.from.toLowerCase() === address?.toLowerCase())
    .reduce((total, s) => total + s.amount, 0);

  const requiredAllowanceUSDC = BigInt(
    Math.round(currentWalletOutgoing * 1_000_000)
  );

  const isConnectedWalletApproved = Boolean(
    address &&
      (confirmedApprovals[address.toLowerCase()] ||
        (typeof usdcAllowance === "bigint" &&
          requiredAllowanceUSDC > BigInt(0) &&
          usdcAllowance >= requiredAllowanceUSDC))
  );

  const currentApprovalTx = address
    ? confirmedApprovals[address.toLowerCase()] || approveTxHash
    : undefined;

  const debtors = settlements.filter((s) => s.amount > 0);
  const debtorAddresses = Array.from(
    new Set(debtors.map((s) => s.from.toLowerCase()))
  );

  const allRequiredApprovalsConfirmed =
    debtorAddresses.length === 0 ||
    debtorAddresses.every((debtor) => {
      if (confirmedApprovals[debtor]) return true;
      if (
        address &&
        debtor === address.toLowerCase() &&
        typeof usdcAllowance === "bigint"
      ) {
        const debtorTotal = settlements
          .filter((s) => s.from.toLowerCase() === debtor)
          .reduce((sum, s) => sum + s.amount, 0);
        return usdcAllowance >= BigInt(Math.round(debtorTotal * 1_000_000));
      }
      return false;
    });

  const isSignedIntentValid = Boolean(
    settlementSignature &&
      settlementDeadline &&
      Number(settlementDeadline) * 1000 > Date.now()
  );

  const showStep3 = Boolean(
    (isSignedIntentValid &&
      activeSettlementSnapshot &&
      allRequiredApprovalsConfirmed) ||
      settlementTxHash
  );

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

                {isAuthenticating && (
                  <div className="text-xs text-slate-400">
                    Authenticating...
                  </div>
                )}

                {authError && (
                  <div className="text-xs text-red-400">
                    {authError}
                  </div>
                )}

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
        {isBackendGroupsLoading
          ? "Loading groups..."
          : backendGroupsError
            ? backendGroupsError
            : "Switch between your Vectra groups."}
      </p>
    </div>

    <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-300">
      {backendGroups.length}{" "}
      {backendGroups.length === 1
        ? "Group"
        : "Groups"}
    </div>
  </div>

  <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
    {backendGroups.map(
      (group) => {
        const isActive =
          group.blockchainGroupId.toLowerCase() ===
          (activeGroupId ?? "").toLowerCase();

        return (
          <button
            key={group.id}
            type="button"
            onClick={() =>
              handleSwitchGroup(
                group.blockchainGroupId as `0x${string}`,
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
              {group.blockchainGroupId}
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
                  {activeGroupName || "No active group"}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-400">
                  {formatAddress(
                    activeGroupId ?? undefined
                  )}
                </div>

                {isCoordinator && activeGroupId && (
                  <button
                    type="button"
                    onClick={handleDeactivateGroup}
                    disabled={isDeactivatingGroup}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {isDeactivatingGroup
                      ? "Deactivating..."
                      : "Delete Group"}
                  </button>
                )}
              </div>
            </div>

            {deactivateError && (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                {deactivateError}
              </div>
            )}

            {deactivateSuccess && (
              <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-300">
                {deactivateSuccess}
              </div>
            )}

            {/* Invite code for active group */}
            {activeBackendGroup && activeBackendGroup.inviteCode && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Invite code
                  </div>
                  <div className="mt-1 font-mono text-base font-bold tracking-wider text-cyan-300">
                    {activeBackendGroup.inviteCode}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      activeBackendGroup.inviteCode
                    );
                    setCopiedInviteCode(true);
                    setTimeout(
                      () => setCopiedInviteCode(false),
                      2000
                    );
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
                >
                  {copiedInviteCode
                    ? "Copied ✓"
                    : "Copy"}
                </button>
              </div>
            )}

            <div className="mt-6 space-y-4">
              {/* Create Group */}
              <div>
                <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                  Create Group
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
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
                      isCreatingGroupBackend ||
                      isCreatingGroupConfirming ||
                      !isConnected ||
                      !isArcNetwork ||
                      !groupName.trim()
                    }
                    className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isCreatingGroup
                      ? "Registering..."
                      : isCreatingGroupConfirming
                        ? "Confirming..."
                        : isCreatingGroupBackend
                          ? "Saving..."
                          : "Create Group"}
                  </button>
                </div>

                {createGroupError && (
                  <div className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                    {createGroupError}
                  </div>
                )}
              </div>

              {/* Join Group */}
              <div>
                <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                  Join Group
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <input
                    value={joinCode}
                    onChange={(event) => {
                      setJoinCode(
                        event.target.value.toUpperCase()
                      );
                      setJoinGroupError(null);
                      setJoinGroupSuccess(null);
                    }}
                    placeholder="VXR-XXXXX"
                    className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm uppercase tracking-wider outline-none focus:border-cyan-400"
                  />

                  <button
                    onClick={handleJoinGroup}
                    disabled={
                      isJoiningGroup ||
                      !isConnected ||
                      !joinCode.trim()
                    }
                    className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isJoiningGroup
                      ? "Joining..."
                      : "Join Group"}
                  </button>
                </div>

                {joinGroupError && (
                  <div className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                    {joinGroupError}
                  </div>
                )}

                {joinGroupSuccess && (
                  <div className="mt-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-300">
                    {joinGroupSuccess}
                  </div>
                )}
              </div>
            </div>

            {(isCreatingGroup || isCreatingGroupConfirming || isCreatingGroupBackend) && (
              <div className="mt-4 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
                {isCreatingGroup
                  ? "Submitting transaction..."
                  : isCreatingGroupConfirming
                    ? "Confirming on Arc..."
                    : "Saving to backend..."}
              </div>
            )}

            {isGroupCreatedOnChain && !isCreatingGroupBackend && !createGroupError && !isCreatingGroup && (
              <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-emerald-300">
                    Group created ✓
                  </span>

                  {createGroupTxHash && (
                    <a
                      href={`https://testnet.arcscan.app/tx/${createGroupTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-cyan-400 hover:text-cyan-300"
                    >
                      View transaction on Arcscan ↗
                    </a>
                  )}
                </div>
              </div>
            )}

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl bg-slate-950 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Coordinator
                </div>

                <div className="mt-2 font-mono text-sm">
                  {isCoordinatorLoading
                    ? "Loading..."
                    : formatIdentity(
                        activeBackendGroup?.coordinatorAddress ?? coordinator
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

                <div className="mt-2 text-2xl font-bold">
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
              disabled={isAddingExpense}
              className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
            >
              {isAddingExpense ? "Adding..." : "Add Expense"}
            </button>
          </div>

          {expensesError && (
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-400">
              {expensesError}
            </div>
          )}

          {isExpensesLoading ? (
            <div className="mt-6 p-8 text-center text-sm text-slate-500">
              Loading group expenses from backend...
            </div>
          ) : expenses.length > 0 ? (
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

                    <th className="pb-3">
                      Status
                    </th>

                    <th className="pb-3 text-right">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {expenses.map(
                    (
                      expense
                    ) => (
                      <tr
                        key={expense.id}
                        className="border-b border-slate-800/70"
                      >
                        <td className="py-4">
                          {
                            expense.description
                          }
                        </td>

                        <td className="py-4">
                          {
                            Number(expense.amount).toFixed(2)
                          }{" "}
                          USDC
                        </td>

                        <td className="py-4 text-slate-400">
                          {formatIdentity(
                            expense.paidBy
                          )}
                        </td>

                        <td className="py-4">
                          {expense.settled ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              Settled
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                              Unsettled
                            </span>
                          )}
                        </td>

                        <td className="py-4 text-right">
                          {expense.settled ? (
                            <span className="text-xs text-slate-600">
                              Locked
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={isDeletingExpenseId === expense.id}
                              onClick={() =>
                                handleDeleteExpense(
                                  expense
                                )
                              }
                              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                            >
                              {isDeletingExpenseId === expense.id
                                ? "Deleting..."
                                : "Delete"}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
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

          {expenses.length > 0 &&
          expenses.every((expense) => expense.settled) ? (
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
                      !isArcNetwork ||
                      isSignedIntentValid
                    }
                    className="rounded-lg bg-white px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isSigningSettlement
                      ? "Signing..."
                      : isSignedIntentValid
                        ? "Settlement Intent Signed ✓"
                        : "Sign Settlement Intent"}
                  </button>
                </div>

                {!isCoordinator &&
                  isConnected &&
                  isArcNetwork &&
                  !isSignedIntentValid && (
                    <div className="mt-4 text-xs text-amber-400">
                      Only the group coordinator can
                      sign the settlement intent.
                    </div>
                  )}

                {isSignedIntentValid && settlementSignature && (
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

                    {!allRequiredApprovalsConfirmed && (
                      <div className="mt-3 text-xs text-amber-400">
                        Debtor members must approve USDC before the settlement can be executed.
                      </div>
                    )}
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
                          !isArcNetwork ||
                          isConnectedWalletApproved
                        }
                        className="rounded-lg bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isApprovingUSDC
                          ? "Approving USDC..."
                          : isConnectedWalletApproved
                            ? "USDC Approved ✓"
                            : "Approve USDC for Settlement"}
                      </button>
                    </div>

                    {currentApprovalTx && (
                      <div className="mt-4 break-all text-xs text-slate-500">
                        Approval transaction:

                        <div className="mt-1 text-cyan-400">
                          {
                            currentApprovalTx
                          }
                        </div>
                      </div>
                    )}
                  </div>
                )}

              {/* Step 3: Execute */}
              {showStep3 && (
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

                  {settlementExecutionError && (
                    <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                      {settlementExecutionError}
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
          ) : activity.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
              No on-chain activity found for this group.
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {activity.map(
                (
                  item,
                  index
                ) => {
                  if (item.type === "registration") {
                    return (
                      <div
                        key={`${item.txHash}-${index}`}
                        className="rounded-xl bg-slate-950 p-4"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-emerald-300">
                                Group created
                              </span>
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                                System
                              </span>
                            </div>

                            <div className="mt-1 text-sm text-slate-400">
                              Coordinator:{" "}
                              <span className="font-mono text-slate-300">
                                {formatIdentity(
                                  item.coordinator
                                )}
                              </span>
                            </div>
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
                              View transaction on Arcscan ↗
                            </a>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={`${item.txHash}-${index}`}
                      className="rounded-xl bg-slate-950 p-4"
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="font-semibold text-cyan-300">
                            Settlement
                          </div>

                          {item.amount !==
                            undefined && (
                            <div className="mt-1 text-lg font-bold text-white">
                              {formatUnits(
                                item.amount,
                                6
                              )}{" "}
                              USDC
                            </div>
                          )}

                          <div className="mt-1 text-sm text-slate-400">
                            {formatIdentity(
                              item.from
                            )}{" "}
                            →{" "}
                            {formatIdentity(
                              item.to
                            )}
                          </div>
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
                            View transaction on Arcscan ↗
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                }
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

                    setActiveSettlementSnapshot(
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
                Authoritative backend memberships for this group.
              </p>
            </div>

            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-300">
              {members.length} {members.length === 1 ? "Member" : "Members"}
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
                  member.role === "COORDINATOR" ||
                  coordinator?.toLowerCase() ===
                    member.address.toLowerCase() ||
                  activeBackendGroup?.coordinatorAddress.toLowerCase() ===
                    member.address.toLowerCase();

                return (
                  <div
                    key={
                      member.address
                    }
                    className="rounded-xl bg-slate-950 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-mono text-sm font-semibold text-white">
                        {formatAddress(
                          member.address
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {memberIsCoordinator ? (
                          <div className="rounded-full bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-300">
                            Coordinator
                          </div>
                        ) : (
                          <div className="rounded-full bg-slate-800 px-2 py-1 text-xs font-semibold text-slate-400">
                            Member
                          </div>
                        )}

                        {memberENS && (
                          <div className="rounded-full bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-300">
                            {memberENS}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 break-all font-mono text-xs text-slate-500">
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