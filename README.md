# Vectra — Intent-Based Group Treasury & USDC Settlement on Arc

**Transform shared expenses into cryptographically authorized, on-chain USDC settlements.**

[**Live Demo**](https://vectra-sage.vercel.app) • [**GitHub**](https://github.com/Pixie-19/Vectra) • [**Backend**](https://vectra-endh.onrender.com) • [**Contract on Arcscan**](https://testnet.arcscan.app/address/0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea)

**Network:** Arc Testnet (Chain ID: 5042002)  
**Contract:** `0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea`  
**USDC:** `0x3600000000000000000000000000000000000000`

---

## The Problem

Traditional group expense apps calculate who owes whom, but leave settlement entirely manual:

- **Fragmented Reconciliation** — Users must manually coordinate individual payments across Venmo, PayPal, Zelle, or bank transfers
- **No Authorization Layer** — No cryptographic proof that participants agreed to specific settlement terms
- **Weak Auditability** — No verifiable on-chain record of who paid whom and when
- **Settlement Friction** — Multiple separate transfers required instead of coordinated execution

**Core Issue:** Financial obligations are computed off-chain but never executed on-chain as an authorized, coordinated settlement.

---

## The Vectra Solution

Vectra separates expense tracking from settlement execution, then reconnects them through **intent-based settlement authorization**:

```
Shared Expenses
       ↓
Net Balance Calculation
       ↓
Settlement Intent Created
       ↓
EIP-712 Coordinator Authorization
       ↓
On-Chain Signature Verification
       ↓
Atomic USDC Transfers
       ↓
Settlement Verified & Recorded
```

**Key Innovation:** Instead of manually coordinating payments, the group coordinator signs a single settlement intent that authorizes all required USDC transfers. The smart contract validates the signature and executes transfers atomically.

---

## Why Intent-Based Settlement?

Traditional model:
```
User manually initiates Transfer → Recipient receives payment
```

Vectra model:
```
Group State → Settlement Intent → Cryptographic Authorization → On-Chain Execution
```

### What This Enables

**Settlement Intent** = A structured representation of the desired settlement outcome (who pays whom, how much) that can be:

1. **Computed Off-Chain** — Backend calculates optimized net balances without on-chain gas costs
2. **Authorized Cryptographically** — Coordinator signs EIP-712 typed data, creating human-readable proof of authorization
3. **Verified On-Chain** — Smart contract validates signature, nonce, deadline, and coordinator identity
4. **Executed Atomically** — All USDC transfers happen together or the transaction reverts
5. **Bound to State** — Settlement nonce ensures authorization applies to specific expense snapshot

This abstraction separates **what should happen** (settlement intent) from **how it executes** (blockchain transaction), enabling off-chain coordination with on-chain enforcement.

---

## How Vectra Works

### Complete User Flow

1. **Connect Wallet** — User connects Web3 wallet (MetaMask, Rainbow, etc.)
2. **Authenticate** — User signs authentication challenge, backend issues session token
3. **Create Group** — Coordinator creates group, submits `registerGroup()` transaction to Arc
4. **Invite Members** — Share group invite code, members join via code
5. **Record Expenses** — Members add expenses (description, amount, payer)
6. **View Net Balances** — Frontend displays who owes whom after debt optimization
7. **Create Settlement** — Backend generates settlement intent with current nonce from chain
8. **Sign EIP-712 Intent** — Coordinator reviews structured settlement data, signs with wallet
9. **Execute On-Chain** — Frontend submits `executeSettlementIntent()` with signature
10. **Verify Settlement** — Backend fetches transaction receipt, validates events, marks expenses settled

---

## Architecture

```mermaid
flowchart TB
    User([Wallet])
    Frontend[Next.js Frontend]
    Backend[Express API]
    DB[(PostgreSQL)]
    Arc[Arc Testnet RPC]
    Contract[VectraTreasury]
    USDC[USDC Token]
    
    User -->|1. Connect & Sign Messages| Frontend
    Frontend -->|2. API Requests + Session Token| Backend
    Frontend -->|3. Read Chain State| Arc
    Frontend -->|4. Submit Transactions| Arc
    
    Backend -->|5. Store Application State| DB
    Backend -->|6. Verify Transactions| Arc
    Backend -->|7. Read Nonces & Events| Arc
    
    Arc -->|8. Execute Contract Calls| Contract
    Contract -->|9. Validate Signatures| Contract
    Contract -->|10. Execute Transfers| USDC
    Contract -->|11. Emit Events| Arc
    
    Backend -->|12. Parse Settlement Events| Arc
    Backend -->|13. Update Expense Status| DB
    
    style User fill:#e1f5ff
    style Contract fill:#ffe1e1
    style USDC fill:#e1ffe1
    style DB fill:#f5e1ff
```

### Architecture Layers

**Application Layer (Off-Chain)**
- Frontend: Next.js 16 + React 19 + wagmi + viem
- Backend: Express 5 + TypeScript
- Database: PostgreSQL + Prisma ORM
- Functions: Expense tracking, balance calculation, member management, settlement intent construction

**Authorization Layer (Off-Chain → On-Chain)**
- EIP-712 typed data signatures
- Challenge-response wallet authentication
- Session token management
- Coordinator signature verification

**Execution Layer (On-Chain)**
- VectraTreasury smart contract on Arc Testnet
- Signature verification via EIP-712 domain separation
- Nonce-based replay protection
- Atomic USDC transfers via SafeERC20

**Verification Layer (On-Chain → Off-Chain)**
- Backend reads transaction receipts from Arc
- Parses `SettlementIntentExecuted` events
- Validates groupId, coordinator, nonce
- Updates expense settlement status in PostgreSQL

---

## Settlement Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Backend
    participant DB
    participant Wallet
    participant Arc
    participant Contract
    
    User->>Frontend: Create Settlement
    Frontend->>Backend: POST /groups/{id}/settlements
    Backend->>Arc: Read current nonce for group
    Backend->>DB: Create PENDING settlement record
    Backend->>Backend: Calculate net balances from expenses
    Backend-->>Frontend: Return settlement intent data
    
    Frontend->>User: Display intent (groupId, nonce, deadline, transfers)
    User->>Wallet: Sign EIP-712 typed data
    Wallet-->>User: Return signature
    
    User->>Frontend: Submit signature
    Frontend->>Arc: executeSettlementIntent(intent, signature)
    
    Arc->>Contract: Validate signature via ECDSA recovery
    Contract->>Contract: Check signer == coordinator
    Contract->>Contract: Check nonce == on-chain nonce
    Contract->>Contract: Check deadline > block.timestamp
    Contract->>Contract: Execute USDC safeTransferFrom for each transfer
    Contract->>Contract: Increment nonce
    Contract->>Arc: Emit SettlementIntentExecuted event
    Arc-->>Frontend: Return transaction hash
    
    Frontend->>Backend: PATCH /settlements/{id} (status=COMPLETED, txHash)
    Backend->>Arc: Get transaction receipt
    Backend->>Arc: Parse SettlementIntentExecuted event
    Backend->>Backend: Validate event.groupId == database.groupId
    Backend->>Backend: Validate event.signer == coordinator
    Backend->>Backend: Validate event.nonce == settlement.nonce
    Backend->>DB: Mark settlement COMPLETED
    Backend->>DB: Mark associated expenses as settled
    Backend-->>Frontend: Confirm settlement verified
    Frontend-->>User: Settlement complete ✓
```

---

## Settlement Snapshots: Preventing State Corruption

### The Problem

Consider this scenario:

1. Alice, Bob, and Charlie record expenses totaling $100
2. Backend calculates settlement: Bob owes Alice $30, Charlie owes Alice $20
3. Coordinator signs settlement intent with nonce 5
4. **Before transaction executes:** David adds a new $50 expense
5. Settlement executes on-chain with old nonce 5
6. **Which expenses should be marked as settled?**

If the system naively marks *all* expenses as settled, David's $50 expense gets incorrectly settled even though it wasn't part of the authorized settlement.

### The Solution: Snapshot Binding

Vectra uses **nonce-based settlement snapshots** to bind authorization to specific expense states:

1. **Settlement Creation:** Backend creates settlement record with nonce N and stores **which specific expense IDs** should be settled
2. **Concurrent Expenses:** New expenses added while settlement pending do *not* get added to the snapshot
3. **On-Chain Execution:** Contract validates nonce N, executes transfers, increments nonce to N+1
4. **Backend Verification:** Backend verifies transaction, marks **only the exact expenses in the snapshot** as settled
5. **Next Settlement:** Uses nonce N+1, includes new expenses

**Result:** Settlement authorization is cryptographically bound to a specific expense snapshot. Expenses added during settlement execution remain unsettled and are included in the next settlement cycle.

---

## EIP-712 Authorization

Vectra uses **EIP-712 typed structured data** for settlement authorization.

### Why EIP-712?

EIP-712 provides structured, human-readable signing that wallets can display meaningfully:

**Without EIP-712** (raw hex signature):
```
Sign this message: 0x8f3d2a1b4c... [unreadable hex blob]
```

**With EIP-712** (structured display):
```
Vectra Settlement Intent

Group ID: 0xabc123...
Nonce: 5
Deadline: 2026-01-15T10:30:00Z

Transfers:
  Bob → Alice: 30.00 USDC
  Charlie → Alice: 20.00 USDC
```

### EIP-712 Domain Separation

```solidity
EIP712("Vectra", "1")
```

Domain parameters:
- **name:** "Vectra"
- **version:** "1"
- **chainId:** 5042002 (Arc Testnet)
- **verifyingContract:** 0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea

This ensures signatures are only valid for:
- Vectra contract specifically
- Version 1 of the protocol
- Arc Testnet (not mainnet or other networks)
- The deployed VectraTreasury contract address

### Settlement Intent Type Structure

```solidity
struct SettlementIntent {
    bytes32 groupId;      // Identifies the group
    uint256 nonce;        // Current settlement nonce (replay protection)
    uint256 deadline;     // Unix timestamp (intent expiration)
    address[] from;       // USDC senders
    address[] to;         // USDC recipients
    uint256[] amounts;    // Transfer amounts (USDC units)
}
```

The contract hashes the transfer arrays to prevent manipulation:

```solidity
bytes32 transfersHash = keccak256(abi.encodePacked([
    keccak256(abi.encode(TRANSFER_TYPEHASH, from[0], to[0], amounts[0])),
    keccak256(abi.encode(TRANSFER_TYPEHASH, from[1], to[1], amounts[1])),
    ...
]))
```

### What EIP-712 Does (and Doesn't) Do

**What EIP-712 provides:**
- ✅ Structured, human-readable authorization in wallet UI
- ✅ Domain separation (signature only valid for specific contract/chain)
- ✅ Type safety (signature commits to exact data structure)
- ✅ Prevents signature reuse across different applications

**What EIP-712 does NOT guarantee:**
- ❌ Does not automatically prevent phishing (user must still verify data)
- ❌ Does not validate the *correctness* of settlement terms (only that coordinator authorized them)
- ❌ Does not protect against malicious coordinators
- ❌ Does not guarantee settlement fairness (application logic responsibility)

**In Vectra's architecture:** EIP-712 provides cryptographic proof that the coordinator authorized the specific settlement intent, enabling the smart contract to validate authorization before executing transfers.

---

## Smart Contract: VectraTreasury

**Deployed Address:** `0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea`  
**Network:** Arc Testnet (Chain ID: 5042002)  
**Explorer:** [View on Arcscan](https://testnet.arcscan.app/address/0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea)  
**Solidity Version:** 0.8.24  
**Source:** [`contracts/VectraTreasury.sol`](./contracts/VectraTreasury.sol)

### Core Functions

#### `registerGroup(bytes32 groupId)`

Registers a group on-chain.

- Sets `msg.sender` as coordinator
- Initializes nonce to 0
- Emits `GroupRegistered(groupId, coordinator)` event

**Access:** Anyone can register a new group

#### `executeSettlementIntent(SettlementIntent calldata intent, bytes calldata signature)`

Executes a settlement intent after cryptographic verification.

**Validation Steps:**

1. **Deadline Check:** `require(block.timestamp <= intent.deadline)`
2. **Array Length Validation:** `require(from.length == to.length == amounts.length)`
3. **Coordinator Validation:** Recover signer from signature, verify `signer == coordinators[groupId]`
4. **Nonce Validation:** `require(nonces[groupId] == intent.nonce)`
5. **Transfer Execution:** Execute each USDC transfer via `safeTransferFrom`
6. **Nonce Increment:** `nonces[groupId]++`
7. **Event Emission:** Emit `SettlementIntentExecuted` and `SettlementExecuted` events

**Atomic Execution:** If any transfer fails, entire transaction reverts.

**Access:** Anyone can submit a valid signed intent (signature proves authorization)

### State Variables

```solidity
IERC20 public immutable usdc;                    // USDC token address
mapping(bytes32 => address) public coordinators; // groupId → coordinator
mapping(bytes32 => uint256) public nonces;       // groupId → current nonce
```

### Events

**GroupRegistered**
```solidity
event GroupRegistered(bytes32 indexed groupId, address indexed coordinator);
```

**SettlementIntentExecuted** (used for backend verification)
```solidity
event SettlementIntentExecuted(
    bytes32 indexed groupId,
    address indexed signer,
    uint256 nonce
);
```

**SettlementExecuted** (emitted for each transfer)
```solidity
event SettlementExecuted(
    bytes32 indexed groupId,
    address indexed from,
    address indexed to,
    uint256 amount
);
```

### Security Features

- **EIP-712 Signature Verification:** Uses OpenZeppelin's ECDSA library for signature recovery
- **Nonce-Based Replay Protection:** Each settlement increments nonce, preventing reuse
- **Deadline Enforcement:** Expired settlements automatically rejected
- **Coordinator-Only Authorization:** Only registered coordinator can sign valid intents
- **SafeERC20:** Handles USDC transfers safely, protects against non-standard token behavior
- **Atomic Multi-Transfer:** All transfers succeed together or transaction reverts

---

## Security Model

Vectra's security operates across multiple layers:

### 1. Authentication (Off-Chain)

**Challenge-Response Flow:**

1. User requests authentication nonce for their wallet address
2. Backend generates random 32-byte nonce, creates structured message:
   ```
   Vectra Authentication
   
   Sign this message to authenticate your wallet.
   
   Wallet: 0xabc123...
   Nonce: 0xdef456...
   Issued At: 2026-01-15T10:00:00Z
   Expiration Time: 2026-01-15T10:05:00Z
   
   This signature does not authorize any blockchain transaction.
   ```
3. User signs message with wallet
4. Backend verifies signature using `viem.verifyMessage()`
5. Backend creates session token (SHA-256 hash stored in PostgreSQL)
6. Frontend includes session token in `Authorization: Bearer <token>` header

**Properties:**
- Nonce is one-time use (deleted after verification)
- Sessions expire after 24 hours
- Wallet address cannot be spoofed (signature proves ownership)
- Session token is cryptographically random (32 bytes)

### 2. Authorization (Off-Chain)

**Membership Validation:**
- Backend session ties wallet address to user ID
- All expense/settlement operations check group membership
- Coordinator-only operations verify `group.coordinatorAddress == session.walletAddress`

**Expense Deletion:**
- Only expense creator can delete
- Cannot delete settled expenses

### 3. Settlement Authorization (Off-Chain → On-Chain)

**EIP-712 Coordinator Signature:**
- Only coordinator can sign valid settlement intents
- Signature commits to exact settlement terms (groupId, nonce, deadline, transfers)
- Smart contract validates signature on-chain via ECDSA recovery

### 4. On-Chain Enforcement

**Smart Contract Validation:**
- Coordinator signature verification via EIP-712 domain separation
- Nonce validation prevents replay attacks
- Deadline validation prevents stale settlement execution
- USDC allowance checks before transfers
- Atomic execution (all transfers succeed or transaction reverts)

### 5. Settlement Verification (On-Chain → Off-Chain)

**Backend Verification Process:**

When frontend reports settlement completion, backend independently verifies:

1. **Transaction Exists:** Fetch receipt from Arc RPC
2. **Transaction Succeeded:** `receipt.status === "success"`
3. **Correct Contract:** `receipt.to === VECTRA_TREASURY_ADDRESS`
4. **Event Parsing:** Parse `SettlementIntentExecuted` from logs
5. **Group Validation:** `event.groupId === database.group.blockchainGroupId`
6. **Coordinator Validation:** `event.signer === database.group.coordinatorAddress`
7. **Nonce Validation:** `event.nonce === database.settlement.nonce`

Only after all verifications pass does backend mark settlement as COMPLETED.

**Why This Matters:** Prevents frontend from lying about settlement execution. Backend verifies blockchain state directly.

### 6. Concurrency Protection

**Database Constraints:**
- `(groupId, nonce)` unique constraint prevents duplicate settlements
- `transactionHash` unique constraint prevents transaction reuse
- Conditional update prevents race conditions:
  ```typescript
  updateMany({
    where: { id: settlementId, status: { not: "COMPLETED" } },
    data: { status: "COMPLETED", ... }
  })
  ```

### Limitations

**What Vectra Does NOT Claim:**

- ❌ **Production-Ready Security:** This is a hackathon/testnet prototype
- ❌ **Smart Contract Audit:** No professional security audit conducted
- ❌ **Rate Limiting:** No rate limiting or DDoS protection implemented
- ❌ **Full Input Sanitization:** Basic validation only
- ❌ **Fairness Guarantees:** System does not validate settlement fairness, only coordinator authorization

**Trust Assumptions:**

- Users trust the group coordinator to create fair settlements
- Users trust Arc Testnet infrastructure (RPC, block production)
- Users trust USDC token implementation
- Users trust backend to calculate balances correctly
- Users must verify settlement terms in wallet before signing

---

## Why Arc + USDC?

### Arc Testnet

**Arc provides:**
- EVM-compatible execution environment for Solidity smart contracts
- JSON-RPC interface for reading chain state and submitting transactions
- Block explorer for settlement transaction verification
- Test USDC for development and demonstration

**Why Arc for Vectra:**
- Settlement execution requires reliable transaction confirmation
- EIP-712 and contract verification require full EVM compatibility
- Public testnet enables open demonstration
- Explorer provides transparent settlement history

### USDC as Settlement Asset

**Why stablecoin settlement:**

Traditional expense apps track expenses in dollars but settle via:
- Venmo/PayPal (custodial, off-chain, requires account linking)
- Bank transfers (slow, high friction, complex routing)
- Cash (physical, no record)

**USDC provides:**
- **Stable Value:** Expenses denominated in familiar dollar terms without crypto volatility
- **Programmable:** ERC-20 interface enables smart contract transfers
- **On-Chain:** Verifiable settlement record on blockchain
- **Composable:** Works with existing DeFi infrastructure
- **Predictable:** No price fluctuation between expense recording and settlement

**Stablecoin-Native Treasury:**

Vectra's treasury is **natively USDC**:
- Expenses recorded in USDC
- Balances calculated in USDC
- Settlements executed in USDC
- History stored in USDC

This creates a unified financial layer where:
- Users authorize specific USDC amounts
- Contracts execute exact USDC transfers
- Blockchain records immutable USDC settlement history

---

## Core Features

### Group Management

- ✅ **Group Creation:** On-chain registration via `VectraTreasury.registerGroup()`
- ✅ **Coordinator Role:** First member becomes coordinator with settlement authorization
- ✅ **Invite Codes:** Generate and share invite codes for group membership
- ✅ **Join Groups:** Members join via invite code, added to group roster
- ✅ **Group Deactivation:** Coordinator can deactivate groups

### Expense Tracking

- ✅ **Add Expenses:** Record description, amount, payer
- ✅ **Member Validation:** Only group members can add expenses
- ✅ **Expense History:** View all group expenses with timestamps
- ✅ **Delete Expenses:** Creator can delete their own unsettled expenses
- ✅ **Settlement Status:** Track which expenses have been settled

### Settlement Execution

- ✅ **Net Balance Calculation:** Backend computes who owes whom
- ✅ **Settlement Intent Creation:** Generate structured settlement with current nonce
- ✅ **EIP-712 Signing:** Coordinator signs typed settlement data
- ✅ **On-Chain Execution:** Submit signed intent to VectraTreasury contract
- ✅ **Nonce Protection:** Per-group nonces prevent replay attacks
- ✅ **Deadline Enforcement:** Time-bounded settlement validity
- ✅ **Atomic Transfers:** All USDC transfers execute together or revert
- ✅ **Event Verification:** Backend verifies settlement events from chain
- ✅ **Expense Marking:** Settled expenses marked in database

### Authentication & Authorization

- ✅ **Wallet-Based Identity:** No email/password, wallet is identity
- ✅ **Challenge-Response Auth:** Sign message to prove wallet ownership
- ✅ **Session Management:** 24-hour sessions with secure token storage
- ✅ **Membership Validation:** Backend enforces group membership for operations
- ✅ **Coordinator Validation:** Only coordinator can authorize settlements

### Activity History

- ✅ **On-Chain Activity:** View settlement transactions on Arc explorer
- ✅ **Transaction Links:** Direct links to Arcscan for each settlement
- ✅ **Settlement Status:** Track PENDING/SUBMITTED/COMPLETED settlements

---

## Data Model

### Core Entities

**User**
- Wallet address (unique, serves as identity)
- Session tokens
- Group memberships

**Group**
- Blockchain group ID (bytes32, unique)
- Coordinator address
- Invite code (unique)
- Status (ACTIVE/DEACTIVATED)
- Members

**Membership**
- Links user to group
- Role: COORDINATOR or MEMBER
- Join timestamp

**Expense**
- Group reference
- Description, amount, payer
- Creator
- Settlement status (boolean)
- Timestamp

**Settlement**
- Group reference
- Nonce (unique per group)
- Total amount
- Status (PENDING/SUBMITTED/COMPLETED/FAILED)
- Initiator
- Transaction hash (unique when set)
- Creation and completion timestamps

**AuthChallenge**
- One-time nonce for wallet authentication
- Structured message to sign
- 5-minute expiration

**AuthSession**
- User reference
- Token hash (SHA-256)
- 24-hour expiration

### Key Database Constraints

```
Settlement: UNIQUE(groupId, nonce)       // Prevents duplicate nonce usage
Settlement: UNIQUE(transactionHash)      // Prevents transaction reuse
Group: UNIQUE(blockchainGroupId)         // One group per chain groupId
Group: UNIQUE(inviteCode)                // One invite code per group
User: UNIQUE(walletAddress)              // One user per wallet
AuthChallenge: UNIQUE(nonce)             // One-time authentication nonces
```

These constraints provide database-level concurrency safety and prevent common attack vectors.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16.3.4, React 19, TypeScript |
| **Web3 Frontend** | wagmi 3.7, viem 2.56, TanStack Query 5.102 |
| **Styling** | Tailwind CSS 4 |
| **Backend** | Node.js 18+, Express 5, TypeScript 7 |
| **Database** | PostgreSQL, Prisma ORM 7.10 |
| **Blockchain** | Arc Testnet (Chain ID: 5042002) |
| **Smart Contracts** | Solidity 0.8.24, Foundry |
| **USDC Contract** | ERC-20 at `0x3600000000000000000000000000000000000000` |
| **Frontend Deployment** | Vercel |
| **Backend Deployment** | Render |
| **Database Hosting** | Render PostgreSQL |

---

## Repository Structure

```
Vectra/
├── contracts/              # Solidity smart contracts
│   └── VectraTreasury.sol  # Settlement intent execution contract
├── backend/                # Express API server
│   ├── src/
│   │   ├── index.ts        # Server entry point
│   │   ├── routes/
│   │   │   ├── auth.ts     # Authentication endpoints
│   │   │   ├── groups.ts   # Group & settlement endpoints
│   │   │   └── users.ts    # User endpoints
│   │   ├── middleware/
│   │   │   └── auth.ts     # Session validation middleware
│   │   └── lib/
│   │       ├── prisma.ts   # Database client
│   │       ├── arc.ts      # Arc Testnet client
│   │       └── contract.ts # VectraTreasury ABI
│   └── prisma/
│       └── schema.prisma   # Database schema
├── frontend/               # Next.js application
│   ├── app/
│   │   ├── page.tsx        # Main application UI
│   │   ├── layout.tsx      # Root layout
│   │   ├── globals.css     # Global styles
│   │   └── providers.tsx   # wagmi/TanStack providers
│   ├── config/
│   │   ├── wagmi.ts        # Arc Testnet chain config
│   │   └── contract.ts     # Contract address & ABI
│   └── lib/
│       └── api.ts          # Backend API client
├── script/                 # Foundry deployment scripts
├── test/                   # Foundry contract tests
├── foundry.toml            # Foundry configuration
├── LICENSE                 # MIT License
└── README.md               # This file
```

---

## Local Development

### Prerequisites

- **Node.js:** 18+ with npm
- **PostgreSQL:** 14+
- **Foundry:** Latest (for contracts)
- **Web3 Wallet:** MetaMask, Rainbow, or similar
- **Arc Testnet USDC:** Obtain from faucet

### Setup Instructions

#### 1. Clone Repository

```bash
git clone https://github.com/Pixie-19/Vectra.git
cd Vectra
```

#### 2. Backend Setup

```bash
cd backend
npm install

# Create environment file
cp .env.example .env
```

Edit `backend/.env`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/vectra"
FRONTEND_URL="http://localhost:3000"
PORT=4000
```

**Run database migrations:**

```bash
npx prisma migrate dev
npx prisma generate
```

#### 3. Frontend Setup

```bash
cd ../frontend
npm install

# Create environment file
cp .env.local.example .env.local
```

Edit `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL="http://localhost:4000"
```

#### 4. Start Development Servers

**Backend (Terminal 1):**
```bash
cd backend
npm run dev
```

Backend running at `http://localhost:4000`

**Frontend (Terminal 2):**
```bash
cd frontend
npm run dev
```

Frontend running at `http://localhost:3000`

#### 5. Access Application

Open [http://localhost:3000](http://localhost:3000) in your browser

Ensure your wallet is connected to Arc Testnet with test USDC.

### Available Commands

**Backend:**

```bash
npm run dev          # Start development server (tsx watch)
npm run build        # Compile TypeScript to JavaScript
npm start            # Run compiled production build
npm run typecheck    # Type check without emitting files
npx prisma studio    # Open Prisma database GUI
npx prisma migrate dev  # Create and apply migration
npx prisma generate  # Generate Prisma Client
```

**Frontend:**

```bash
npm run dev          # Start Next.js development server
npm run build        # Build for production
npm start            # Start production server
npm run lint         # Run ESLint
```

**Smart Contracts (Foundry):**

```bash
forge build          # Compile contracts
forge test           # Run contract tests
forge script         # Run deployment scripts
```

---

## Production Deployment

### Live Infrastructure

**Frontend:** [https://vectra-sage.vercel.app](https://vectra-sage.vercel.app)  
**Backend:** [https://vectra-endh.onrender.com](https://vectra-endh.onrender.com)  
**Health Check:** [https://vectra-endh.onrender.com/health](https://vectra-endh.onrender.com/health)

**Smart Contract:**
- **Address:** `0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea`
- **Network:** Arc Testnet (Chain ID: 5042002)
- **Explorer:** [View on Arcscan](https://testnet.arcscan.app/address/0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea)

**USDC Token:**
- **Address:** `0x3600000000000000000000000000000000000000`
- **Type:** ERC-20 test token on Arc Testnet

### Infrastructure

| Component | Platform | Environment Variables |
|-----------|----------|----------------------|
| Frontend | Vercel | `NEXT_PUBLIC_API_URL` |
| Backend | Render Web Service | `DATABASE_URL`, `FRONTEND_URL`, `PORT` |
| Database | Render PostgreSQL | Managed connection string |
| Blockchain | Arc Testnet | RPC: `https://rpc.testnet.arc.network` |

---

## Demo Walkthrough

### Complete User Journey

**1. Initial Setup**
- Navigate to [https://vectra-sage.vercel.app](https://vectra-sage.vercel.app)
- Connect wallet (ensure Arc Testnet is selected)
- Sign authentication challenge message
- Session token issued, user authenticated

**2. Create Group**
- Click "Create Group"
- Enter group name (e.g., "SF Trip Expenses")
- Submit `registerGroup()` transaction to Arc
- Wait for transaction confirmation
- Group registered on-chain with you as coordinator

**3. Invite Members**
- Copy generated invite code (e.g., "VXR-ABCD1234")
- Share code with group members via messaging app
- Members connect wallets, paste code, join group

**4. Record Expenses**
- Click "Add Expense"
- Enter description: "Hotel booking"
- Enter amount: "300" (USDC)
- Select payer: Your wallet or member's wallet
- Submit to backend, expense recorded

**5. View Net Balances**
- After multiple expenses recorded, view balance summary
- System displays: "Alice owes Bob 50 USDC, Charlie owes Bob 30 USDC"

**6. Create Settlement**
- Coordinator clicks "Create Settlement"
- Backend calculates net obligations
- Backend reads current nonce from chain
- Settlement intent displayed with details:
  - Group ID
  - Nonce
  - Deadline (30 minutes from now)
  - Transfer list

**7. Sign Settlement Intent**
- Wallet prompts EIP-712 signature request
- Review structured settlement data:
  ```
  Vectra Settlement Intent
  
  Group: 0xabc...
  Nonce: 3
  Deadline: 2026-01-15T11:00:00Z
  
  Transfers:
    Alice → Bob: 50 USDC
    Charlie → Bob: 30 USDC
  ```
- Sign with wallet

**8. Execute Settlement**
- Frontend submits `executeSettlementIntent()` to Arc
- Wallet prompts USDC approval (if needed)
- Wallet prompts transaction confirmation
- Transaction broadcast to Arc Testnet
- Transaction hash returned

**9. Settlement Verification**
- Backend fetches transaction receipt from Arc RPC
- Backend parses `SettlementIntentExecuted` event
- Backend validates:
  - Group ID matches
  - Signer matches coordinator
  - Nonce matches settlement record
- Backend marks settlement COMPLETED
- Backend marks expenses as settled

**10. View Settlement History**
- View completed settlements in Activity History
- Click transaction hash to view on Arcscan
- See USDC transfers executed on-chain
- See settlement events emitted

---

## Example: Simple Settlement

### Scenario

Three friends share expenses for a weekend trip:

**Expenses:**
1. Alice pays hotel: $300
2. Bob pays dinner: $120
3. Alice pays breakfast: $30
4. Charlie pays gas: $90

**Total expenses:** $540  
**Per-person share:** $180

### Net Balance Calculation

| Person | Paid | Owes | Balance |
|--------|------|------|---------|
| Alice | $330 | $180 | **+$150** |
| Bob | $120 | $180 | **-$60** |
| Charlie | $90 | $180 | **-$90** |

### Optimized Settlement

Without Vectra (manual):
- Bob pays Alice $60 via Venmo
- Charlie pays Alice $90 via Venmo
- Total: 2 separate transfers, 2 separate payment apps

With Vectra (intent-based):
1. Coordinator signs single settlement intent:
   ```
   Transfer 1: Bob → Alice, 60 USDC
   Transfer 2: Charlie → Alice, 90 USDC
   ```
2. Smart contract validates signature
3. Both USDC transfers execute atomically
4. Settlement recorded on-chain
5. Expenses marked settled

**Result:** Cryptographically authorized, atomically executed, verifiable on blockchain.

---

## What Makes Vectra Interesting

Beyond surface-level expense tracking, Vectra demonstrates several technical concepts relevant to Web3 infrastructure:

### 1. Intent-Based Financial Workflows

Vectra abstracts settlement execution into declarative intents:

- **Traditional:** User manually initiates each transfer
- **Vectra:** User declares desired settlement outcome, system executes

This separation enables:
- Off-chain computation (cheaper than on-chain)
- Batch optimization (multiple transfers in single transaction)
- Cryptographic authorization (EIP-712 proof of approval)
- Verifiable execution (on-chain settlement record)

### 2. Off-Chain Coordination + On-Chain Enforcement

Hybrid architecture:

**Off-Chain (cheap, flexible):**
- Expense tracking
- Balance calculation
- Member management
- Settlement intent construction

**On-Chain (expensive, secure):**
- Signature verification
- USDC transfers
- Replay protection
- Event emission

This hybrid model uses blockchain for what it's good at (enforcement, settlement, verification) without putting everything on-chain.

### 3. Settlement State Binding

Nonce mechanism binds cryptographic authorization to specific application state:

- Settlement nonce N applies to expenses E1, E2, E3
- New expense E4 added → settlement nonce N still only applies to E1, E2, E3
- Next settlement uses nonce N+1, includes E4

This prevents:
- Stale settlement execution
- Settlement/expense correlation bugs
- Unauthorized expense inclusion

### 4. Programmable Stablecoin Settlement

USDC provides native programmability:

- Smart contract can execute transfers based on signature verification
- Settlement terms encoded in transaction calldata
- Transparent on-chain record of who paid whom
- Composable with broader DeFi infrastructure

Traditional payment systems (Venmo, PayPal, bank transfers) cannot be programmed this way.

### 5. Verification Without Trust

Backend independently verifies settlement execution:

- Frontend cannot lie about settlement completion
- Backend reads blockchain state directly
- Event parsing ensures correct settlement was executed
- Database only updated after verification passes

This creates a trust-minimized backend architecture where blockchain serves as source of truth.

---

## Potential Applications

Vectra's settlement infrastructure could be adapted for:

### Current Use Cases (Demonstrated)

- **Friend Group Expenses** — Trips, dinners, shared purchases
- **Roommate Rent/Utilities** — Monthly recurring group expenses
- **Student Organizations** — Event costs, supply purchases
- **Hackathon Teams** — Travel reimbursements, prize splitting

### Future Extensions (Not Yet Implemented)

- **DAO Contributor Expenses** — Contributors submit expenses, DAO votes, treasurer signs settlement intent
- **Team Reimbursement Workflows** — Employees submit expenses, manager approves, finance signs settlement
- **Community Treasuries** — Shared community funds with multi-sig coordination
- **Recurring Settlements** — Scheduled monthly settlements for rent, utilities, subscriptions
- **Multi-Token Settlement** — Settle in ETH, DAI, or other tokens beyond USDC
- **Cross-Organization Settlement** — Settlement intents between different groups/DAOs

**Note:** These are potential future directions, not current features.

---

## Roadmap

### Currently Implemented ✅

- Group creation and management
- Member invitation via codes
- Expense recording and tracking
- Net balance calculation
- Settlement intent creation
- EIP-712 coordinator authorization
- On-chain settlement execution
- Nonce-based replay protection
- Settlement snapshot binding
- Transaction verification
- Activity history

### Future Development 🔮

**Phase 1: Enhanced Settlement**
- Recurring settlement schedules
- Multi-token support (ETH, DAI, custom tokens)
- Advanced balance optimization algorithms
- Bulk expense operations

**Phase 2: Treasury Policies**
- Spending limits and approval thresholds
- Multi-signature settlement authorization
- Automated settlement triggers
- Settlement templates

**Phase 3: Organizational Features**
- DAO governance integration
- Sub-groups and departments
- Role-based permissions
- Expense categories and budgets

**Phase 4: Network Expansion**
- Mainnet deployment after thorough security audit
- Support for additional EVM-compatible chains
- Cross-chain settlement coordination
- Integration with existing DAO tooling

---

## Limitations

### Current Status

Vectra is a **hackathon/testnet prototype** demonstrating intent-based settlement concepts. It has several important limitations:

**Network & Assets**
- ⚠️ **Arc Testnet Only** — Not deployed to mainnet, test USDC has no real value
- ⚠️ **Single Asset** — Only USDC supported, no multi-token settlement

**Security & Audits**
- ⚠️ **No Professional Audit** — Smart contract has not undergone security audit
- ⚠️ **Prototype-Grade Security** — Not hardened for production financial use
- ⚠️ **No Rate Limiting** — Backend endpoints not protected against DDoS

**Trust Assumptions**
- ⚠️ **Coordinator Trust** — Members must trust coordinator to create fair settlements
- ⚠️ **Backend Calculation** — System trusts backend balance calculation
- ⚠️ **No Dispute Resolution** — No mechanism for challenging settlements

**Scalability**
- ⚠️ **Basic Infrastructure** — Development-grade deployment, not production-hardened
- ⚠️ **No Caching** — All chain reads hit RPC directly
- ⚠️ **Simple Authorization** — No advanced permission models

**User Experience**
- ⚠️ **Web3 Wallet Required** — Users need crypto wallet and Arc Testnet setup
- ⚠️ **Gas Costs** — Settlement execution requires gas payment
- ⚠️ **USDC Requirement** — All members need USDC balance for settlement

### What Vectra Is Not

- ❌ **Production Financial System** — Do not use with real funds without thorough security review
- ❌ **Audited Smart Contract** — Contract has not been professionally audited
- ❌ **Generalized Intent Protocol** — Intent concept is specific to Vectra's settlement use case
- ❌ **Account Abstraction System** — Uses standard EOA wallets, not smart contract wallets
- ❌ **Solver Network** — Settlement calculation is centralized in backend

---

## Security Disclaimer

**⚠️ IMPORTANT: Testnet Prototype**

Vectra is a **proof-of-concept** built for hackathon demonstration. Before using:

**Verify Network:**
- ✓ Confirm wallet is connected to **Arc Testnet** (Chain ID: 5042002)
- ✓ Never use mainnet funds or real USDC

**Verify Contract:**
- ✓ Confirm contract address: `0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea`
- ✓ Verify on [Arcscan](https://testnet.arcscan.app/address/0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea)

**Verify Settlement Terms:**
- ✓ Review all settlement intent details in wallet before signing
- ✓ Confirm recipient addresses, amounts, deadline
- ✓ Verify you trust the group coordinator

**Understand Risks:**
- ✓ Smart contract has not been professionally audited
- ✓ Backend calculates balances (trust required)
- ✓ Coordinator has settlement authorization power
- ✓ No dispute resolution mechanism exists

**DO NOT:**
- ❌ Use with real funds or production USDC
- ❌ Deploy to mainnet without thorough security audit
- ❌ Trust automatically — verify all transaction details
- ❌ Assume smart contract is bug-free

For production use, Vectra would require:
- Professional smart contract audit
- Extensive security testing
- Enhanced authorization models
- Dispute resolution mechanisms
- Rate limiting and DDoS protection
- Production-grade infrastructure

---

## Contributing

Contributions are welcome! Areas for improvement:

- **Security:** Additional validation, rate limiting, comprehensive testing
- **Features:** Multi-token support, recurring settlements, advanced permissions
- **UX:** Better error handling, transaction status tracking, mobile optimization
- **Optimization:** Database query optimization, caching layer, gas optimization
- **Documentation:** API documentation, architecture diagrams, deployment guides

Please open issues for bugs or feature requests.

---

## License

MIT License - see [LICENSE](./LICENSE) file for details.

Copyright (c) 2026 Vectra Contributors

---

## Links

- **Live Demo:** [https://vectra-sage.vercel.app](https://vectra-sage.vercel.app)
- **GitHub:** [https://github.com/Pixie-19/Vectra](https://github.com/Pixie-19/Vectra)
- **Backend:** [https://vectra-endh.onrender.com](https://vectra-endh.onrender.com)
- **Contract:** [0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea](https://testnet.arcscan.app/address/0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea)
- **Arc Testnet:** [https://testnet.arcscan.app](https://testnet.arcscan.app)
- **Arc RPC:** [https://rpc.testnet.arc.network](https://rpc.testnet.arc.network)

---

**Built for hackathon demonstration of intent-based settlement on Arc Testnet.**
