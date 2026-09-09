# Vectra

**Intent-Based Group Treasury & USDC Settlement on Arc**

Vectra transforms shared expenses into executable settlement intents, enabling groups to compute optimized USDC transfers and execute them on-chain via Arc. Rather than manually performing multiple individual transfers, Vectra calculates net obligations and authorizes a single, multi-party settlement using EIP-712 typed signatures.

Built for the **Best DeFi/Onchain Finance Application** bounty, Vectra demonstrates programmable money flows using Arc as the settlement layer and USDC as the native treasury asset.

---

## 🏆 Hackathon Bounty

**Best DeFi/Onchain Finance Application**

Vectra targets this bounty by providing a complete intent-based treasury settlement system that uses Arc and USDC to enable:

- **Programmable settlement intents** with EIP-712 authorization
- **Multi-party USDC transfers** executed atomically on-chain
- **Nonce-based replay protection** and deadline-based expiration
- **Backend verification** of on-chain settlement transactions
- **Stablecoin-native treasury infrastructure** for group financial coordination

This is not a traditional expense tracker that stops at showing balances—Vectra translates financial obligations into authorized, verifiable on-chain settlement.

---

## The Problem

Conventional group expense applications have a fundamental limitation:

1. ✅ They track who paid for what
2. ✅ They calculate who owes whom
3. ❌ **Actual settlement remains entirely manual**

Users must:
- Manually initiate individual transfers
- Track whether transfers were completed
- Handle multiple fragmented payments
- Lack programmable authorization for group treasury operations
- Have no verifiable on-chain settlement record

The result: **financial obligations are computed off-chain but never executed on-chain as a coordinated settlement.**

---

## The Solution

Vectra separates expense tracking from settlement execution, then reconnects them through an **intent-based settlement flow**:

### Complete Flow

1. **Connect Wallet** — Wallet address is user identity
2. **Authenticate** — Sign a challenge message, receive session token
3. **Create/Join Group** — Groups are registered on-chain with a coordinator
4. **Record Expenses** — Track who paid and who participated
5. **Compute Settlement** — Backend calculates net obligations
6. **Create Settlement Intent** — Build structured intent with nonce, deadline, transfers
7. **Authorize with EIP-712** — Coordinator signs typed settlement data
8. **Execute on Arc** — Smart contract validates signature, executes USDC transfers
9. **Verify Transaction** — Backend independently verifies Arc transaction/events
10. **Mark Expenses Settled** — Exact expense snapshot marked as completed

**Key Distinction:**
- **Off-chain:** Application state, expense tracking, obligation calculation
- **On-chain:** Financial settlement, USDC transfers, verifiable execution

---

## Why "Intent-Based"?

Vectra uses settlement intents to separate **what** should happen from **how** it executes:

### Settlement Intent Structure

```solidity
struct SettlementIntent {
    bytes32 groupId;      // Which group
    uint256 nonce;        // Replay protection
    uint256 deadline;     // Expiration
    address[] from;       // Senders
    address[] to;         // Recipients
    uint256[] amounts;    // USDC amounts
}
```

The coordinator authorizes the intent using **EIP-712 typed signatures**. The smart contract:
- Validates the signature
- Checks nonce (prevents replay)
- Checks deadline (prevents stale execution)
- Executes all USDC transfers atomically
- Increments nonce
- Emits settlement events

This is more powerful than calling `transfer()` for each expense because:
- ✅ Single authorization for multi-party settlement
- ✅ Atomic execution (all transfers succeed or none do)
- ✅ Nonce-based ordering and replay protection
- ✅ Time-bounded validity
- ✅ Verifiable on-chain record

---

## Core Features

### Group Treasury

- **Group Creation** — On-chain registration via `VectraTreasury.registerGroup()`
- **Invite Codes** — Share codes for group membership
- **Coordinator Role** — Only coordinator can authorize settlements
- **Member Management** — Add members, track participation
- **Group Deactivation** — Coordinator can deactivate groups
- **Wallet-Based Identity** — No emails or passwords

### Expense Management

- **Shared Expense Recording** — Track description, amount, payer
- **Member Validation** — Only group members can record expenses
- **Creator Authorization** — Only expense creator can delete their expenses
- **Settlement State Tracking** — Expenses marked as settled or unsettled
- **Expense History** — Full audit trail per group

### Intent-Based Settlement

- **Net Obligation Calculation** — Backend computes optimized transfers
- **Settlement Intent Construction** — Structured multi-party transfer data
- **EIP-712 Authorization** — Coordinator signs typed settlement intent
- **Nonce Protection** — Per-group nonce prevents replay attacks
- **Deadline Enforcement** — Time-bounded settlement validity
- **Atomic Multi-Transfer** — All USDC transfers execute together
- **Settlement Events** — On-chain event log for verification

### Arc + USDC

- **Arc Testnet Deployment** — Contract at `0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea`
- **USDC Settlement Asset** — Stablecoin-native treasury operations
- **On-Chain Execution** — All settlement transfers happen on Arc
- **Transaction Verification** — Backend verifies Arc transaction receipts
- **Event Verification** — Backend verifies `SettlementIntentExecuted` events
- **Transparent History** — All settlements visible on Arc explorer

### Security

- **Wallet Signature Authentication** — Challenge-response flow for backend auth
- **Session Token Management** — Server-side session validation
- **Membership Authorization** — Backend validates group membership from authenticated wallet
- **Coordinator Authorization** — Only coordinator can complete settlements
- **EIP-712 Signatures** — Typed data prevents signature phishing
- **Nonce Checks** — Smart contract validates settlement nonce
- **Deadline Checks** — Smart contract rejects expired intents
- **Transaction Verification** — Backend independently verifies on-chain execution
- **Event Parsing** — Backend validates emitted events match settlement data
- **Database Constraints** — Unique constraints on `(groupId, nonce)` and `transactionHash`
- **Concurrency Protection** — Conditional database updates prevent race conditions

---

## Architecture

```mermaid
flowchart TB
    User([User Wallet])
    Frontend[Next.js Frontend]
    Backend[Express Backend]
    Database[(PostgreSQL)]
    Arc[Arc RPC]
    Contract[VectraTreasury Contract]
    USDC[USDC Token]
    
    User -->|Connect Wallet| Frontend
    User -->|Sign Messages| Frontend
    
    Frontend -->|API Requests| Backend
    Frontend -->|Read Contract State| Arc
    Frontend -->|Submit Transactions| Arc
    
    Backend -->|Store State| Database
    Backend -->|Verify Transactions| Arc
    Backend -->|Validate Membership| Database
    
    Arc -->|Transaction Data| Contract
    Contract -->|Execute Transfers| USDC
    Contract -->|Emit Events| Arc
    
    Backend -->|Parse Events| Arc
    Backend -->|Update Settlement Status| Database
    
    style User fill:#e1f5ff
    style Contract fill:#ffe1e1
    style USDC fill:#e1ffe1
    style Database fill:#f5e1ff
```

### Data Flow

1. **Authentication:** User signs challenge → Backend validates → Session token issued
2. **Authorization:** Backend derives wallet from session, validates membership
3. **Expense Recording:** Frontend → Backend → PostgreSQL
4. **Settlement Creation:** Backend calculates obligations → Creates pending settlement
5. **Settlement Authorization:** Frontend → User signs EIP-712 → Submits to Arc
6. **Settlement Execution:** Arc validates → Contract executes USDC transfers
7. **Settlement Verification:** Backend reads transaction → Parses events → Marks settled

---

## Settlement Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Backend
    participant Database
    participant Wallet
    participant Arc
    participant VectraTreasury
    
    User->>Frontend: Create Settlement
    Frontend->>Backend: POST /groups/{id}/settlements
    Backend->>Database: Create PENDING settlement
    Backend->>Arc: Read current nonce
    Backend-->>Frontend: Settlement intent data
    
    Frontend->>User: Show settlement intent
    User->>Wallet: Approve EIP-712 signature
    Wallet-->>User: Signature
    User->>Frontend: Submit signature
    
    Frontend->>Arc: Submit executeSettlementIntent()
    Arc->>VectraTreasury: Validate signature, nonce, deadline
    VectraTreasury->>VectraTreasury: Check nonce == current
    VectraTreasury->>VectraTreasury: Execute USDC transfers
    VectraTreasury->>VectraTreasury: Increment nonce
    VectraTreasury->>Arc: Emit SettlementIntentExecuted
    Arc-->>Frontend: Transaction hash
    
    Frontend->>Backend: PATCH /settlements/{id} (txHash)
    Backend->>Arc: Get transaction receipt
    Backend->>Arc: Parse SettlementIntentExecuted event
    Backend->>Backend: Validate groupId, nonce, signer
    Backend->>Database: Mark settlement COMPLETED
    Backend->>Database: Mark expenses as settled
    Backend-->>Frontend: Settlement confirmed
    Frontend-->>User: Settlement complete ✓
```

### Why Expenses Added During Settlement Don't Corrupt State

Vectra uses **settlement snapshots**:

1. Settlement created at time T₀ includes expenses E₁, E₂, E₃
2. New expense E₄ added at T₁ while settlement pending
3. Settlement completes at T₂ → **Only E₁, E₂, E₃ marked settled**
4. E₄ remains unsettled, included in next settlement

The settlement nonce + transaction hash ensures exact correlation between on-chain execution and database state.

---

## Smart Contract

### VectraTreasury

**Deployed on Arc Testnet:** `0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea`

**Explorer:** [View on Arcscan](https://testnet.arcscan.app/address/0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea)

The VectraTreasury contract provides intent-based settlement infrastructure for group treasuries.

### Key Functions

**`registerGroup(bytes32 groupId)`**
- Registers a group on-chain
- Sets `msg.sender` as coordinator
- Initializes nonce to 0
- Emits `GroupRegistered` event

**`executeSettlementIntent(SettlementIntent calldata intent, bytes calldata signature)`**
- Validates EIP-712 signature
- Checks coordinator signature matches registered coordinator
- Validates nonce matches current on-chain nonce
- Checks deadline has not expired
- Executes all USDC transfers atomically via `safeTransferFrom`
- Increments group nonce
- Emits `SettlementIntentExecuted` and `SettlementExecuted` events

### Security Features

- **EIP-712 Typed Signatures** — Prevents signature phishing
- **Nonce-Based Ordering** — `nonces[groupId]` prevents replay
- **Deadline Enforcement** — Expired intents rejected
- **Coordinator Validation** — Only registered coordinator can sign
- **Atomic Execution** — All transfers succeed or transaction reverts
- **SafeERC20** — Protects against non-standard token implementations

### Source Code

Full Solidity implementation: [`contracts/VectraTreasury.sol`](./contracts/VectraTreasury.sol)

---

## EIP-712 Settlement Intent

Vectra uses **EIP-712 typed data signatures** to authorize settlements.

### Type Structure

```solidity
// EIP-712 Domain
name: "Vectra"
version: "1"
chainId: 5042002 (Arc Testnet)
verifyingContract: 0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea

// Settlement Intent Type
Settlement(
  bytes32 groupId,
  uint256 nonce,
  uint256 deadline,
  bytes32 transfersHash
)

// Transfer Type (for hashing)
Transfer(
  address from,
  address to,
  uint256 amount
)
```

### Transfer Hashing

The contract hashes the transfer array to prevent manipulation:

```solidity
transfersHash = keccak256(
  keccak256(Transfer(from[0], to[0], amounts[0])),
  keccak256(Transfer(from[1], to[1], amounts[1])),
  ...
)
```

This ensures:
- Transfer order is enforced
- Individual transfers cannot be modified
- The signature commits to the exact transfer set

### Why EIP-712?

- **Human-Readable** — Wallets display structured settlement data
- **Phishing Resistance** — Cannot be used for arbitrary transactions
- **Type Safety** — Prevents signature reuse across contracts
- **Domain Separation** — Signature only valid for VectraTreasury on Arc

---

## Backend Architecture

### Tech Stack

- **Runtime:** Node.js with TypeScript
- **Framework:** Express
- **Database:** PostgreSQL with Prisma ORM
- **Blockchain:** Viem for Arc interaction
- **Authentication:** Wallet signature challenge-response

### Key Components

**`src/index.ts`**
- Express server setup
- CORS configuration (environment-based origin allowlist)
- Route registration
- Health check endpoint

**`src/routes/auth.ts`**
- `POST /auth/challenge` — Generate authentication challenge
- `POST /auth/verify` — Verify signature, create session
- `POST /auth/logout` — Invalidate session

**`src/routes/groups.ts`**
- `POST /groups` — Create group
- `GET /groups` — List user's groups
- `POST /groups/:id/settlements` — Create pending settlement
- `PATCH /groups/:id/settlements/:sid` — Complete settlement (verify on-chain)

**`src/routes/users.ts`**
- User management endpoints

**`src/middleware/auth.ts`**
- `requireAuth` — Validates session token, extracts authenticated wallet
- Authorization checks derive wallet from server session (not client input)

**`src/lib/prisma.ts`**
- PostgreSQL connection pool
- Prisma Client configuration

**`src/lib/arc.ts`**
- Arc Testnet public client
- VectraTreasury contract address
- Transaction verification logic

**`src/lib/contract.ts`**
- VectraTreasury ABI
- Event type definitions

### Authorization Model

**Authentication Flow:**
1. Frontend requests challenge for wallet address
2. Backend creates random nonce, stores in database
3. User signs message with wallet
4. Backend verifies signature, creates session token
5. Session token used for subsequent API requests

**Authorization Flow:**
1. Request includes session token in `Authorization: Bearer <token>` header
2. `requireAuth` middleware validates token against database
3. Authenticated wallet address attached to request
4. Endpoint logic validates membership/coordinator status
5. Database operations use authenticated wallet (not client-supplied values)

**Why This Is Secure:**
- Backend session token cannot be forged (cryptographically random)
- Wallet address derived from validated session (not trusted from client)
- Membership checks use authenticated identity
- Signature verification prevents impersonation

---

## Data Model

```mermaid
erDiagram
    User ||--o{ Membership : "has"
    User ||--o{ Group : "coordinates"
    User ||--o{ Expense : "creates"
    User ||--o{ AuthSession : "has"
    Group ||--o{ Membership : "has"
    Group ||--o{ Expense : "contains"
    Group ||--o{ Settlement : "has"
    Group ||--o{ Invite : "has"
    
    User {
        string id PK
        string walletAddress UK
        datetime createdAt
        datetime lastSeenAt
    }
    
    Group {
        string id PK
        string blockchainGroupId UK
        string name
        string coordinatorAddress FK
        string inviteCode UK
        enum status
        datetime createdAt
    }
    
    Membership {
        string id PK
        string groupId FK
        string walletAddress FK
        enum role
        datetime joinedAt
    }
    
    Expense {
        string id PK
        string groupId FK
        string description
        decimal amount
        string paidBy
        string createdBy FK
        boolean settled
        datetime createdAt
    }
    
    Settlement {
        string id PK
        string groupId FK
        bigint nonce UK
        decimal totalAmount
        enum status
        string initiatedBy
        string transactionHash UK
        datetime createdAt
        datetime completedAt
    }
    
    Invite {
        string id PK
        string groupId FK
        string code UK
        string createdBy FK
        datetime expiresAt
        int maxUses
        int uses
        boolean active
    }
    
    AuthSession {
        string id PK
        string userId FK
        string tokenHash UK
        datetime expiresAt
        datetime createdAt
    }
```

### Key Constraints

**Unique Constraints:**
- `Settlement.groupId + Settlement.nonce` — Prevents duplicate settlements for same nonce
- `Settlement.transactionHash` — Prevents transaction hash reuse
- `Group.blockchainGroupId` — One group per on-chain groupId
- `Group.inviteCode` — Unique invite codes
- `User.walletAddress` — One user per wallet

**Why These Matter:**
- `(groupId, nonce)` uniqueness prevents concurrent settlement races
- `transactionHash` uniqueness prevents double-claiming same on-chain execution
- Database-level enforcement provides concurrency safety

---

## Security Model

### Authentication

**Challenge-Response Flow:**
1. Client requests challenge for wallet address
2. Backend generates random nonce, stores with expiration (5 minutes)
3. Client signs message: `Sign this message to authenticate with Vectra. Nonce: {nonce}`
4. Backend verifies signature using `viem.verifyMessage()`
5. Backend creates session with cryptographically random token
6. Client stores session token, includes in subsequent requests

**Session Management:**
- Sessions expire after 7 days
- Tokens stored as SHA-256 hashes in database
- Logout invalidates session immediately

### Authorization

**Wallet-Based Identity:**
- All authorization derived from authenticated wallet address
- Backend session contains verified wallet (not client-supplied)
- Membership checks query database with authenticated wallet
- No trusted client input for authorization decisions

**Coordinator Authorization:**
- Settlement completion requires coordinator signature
- Backend validates `group.coordinatorAddress == authenticatedWallet`
- EIP-712 signature validates on-chain execution

**Member Authorization:**
- Expense recording requires group membership
- Expense deletion requires creator match (`expense.createdBy == authenticatedWallet`)

### Settlement Security

**Replay Protection:**
- Per-group nonce stored on-chain
- Smart contract checks `nonces[groupId] == intent.nonce`
- Nonce incremented after successful execution
- Old settlement intents become invalid

**Expiration:**
- Settlement intents include deadline timestamp
- Smart contract rejects `block.timestamp > intent.deadline`
- Prevents execution of stale settlements

**On-Chain Verification:**
When settlement marked complete, backend:
1. Fetches transaction receipt from Arc
2. Validates transaction succeeded (status == 1)
3. Validates destination contract == VectraTreasury
4. Parses logs for `SettlementIntentExecuted` event
5. Validates event `groupId` matches database
6. Validates event `signer` matches group coordinator
7. Validates event `nonce` matches database settlement

This prevents:
- Frontend lying about settlement execution
- Transaction hash from different contract
- Transaction hash from wrong group
- Transaction hash from wrong nonce

**Database Integrity:**

**Concurrency Protection:**
- Settlement completion uses conditional `updateMany`:
  ```typescript
  updateMany({
    where: { id: settlementId, status: { not: "COMPLETED" } },
    data: { status: "COMPLETED", ... }
  })
  ```
- Only one concurrent request can transition to COMPLETED
- Others see 0 rows updated, return idempotent response

**Unique Constraints:**
- `(groupId, nonce)` prevents duplicate settlement creation
- `transactionHash` prevents transaction reuse
- Prisma P2002 errors handled gracefully with HTTP 409 Conflict

### What We Don't Claim

- ❌ "Production-grade security" — This is a hackathon demo
- ❌ "Fully audited" — No professional security audit conducted
- ❌ "Tamper-proof" — Depends on Arc network security assumptions
- ❌ Rate limiting — Not implemented
- ❌ DDoS protection — Basic infrastructure only
- ❌ Input sanitization — Basic validation only

---

## Why Arc + USDC?

### Arc as Settlement Layer

**Arc provides:**
- Fast transaction confirmation for settlement execution
- EVM compatibility for Solidity smart contracts
- Public testnet for development and demonstration
- Transaction explorer for settlement verification
- USDC support for stablecoin settlements

**Why Arc matters to Vectra:**
- Settlement execution requires reliable transaction finality
- Group treasuries benefit from low-latency settlement
- EIP-712 and contract verification require EVM compatibility
- Testnet USDC enables realistic treasury simulations

### USDC as Treasury Asset

**Why USDC:**
- **Stable Value** — Group expenses denominated in stable dollars, not volatile assets
- **Standard Denomination** — All settlements use consistent unit of account
- **Composable** — ERC-20 standard enables contract-based transfers
- **Familiar** — Users understand dollar-denominated expenses
- **Predictable** — No price volatility between expense recording and settlement

**Stablecoin-Native Treasury:**
Traditional expense apps track fiat but settle via bank transfers or payment apps. Vectra's treasury is **natively USDC**:
- Expenses recorded in USDC
- Obligations calculated in USDC
- Settlements executed in USDC
- History stored in USDC

This enables:
- Programmable settlement intents
- Atomic multi-party transfers
- Verifiable on-chain execution
- Transparent settlement history
- Composability with DeFi infrastructure

### Programmable Money Flows

Vectra demonstrates **programmable financial infrastructure** beyond simple transfers:

**Settlement Intents:**
- Declare desired financial outcome
- Separate "what" from "how"
- Authorize with cryptographic signature
- Execute atomically on-chain

**Multi-Party Coordination:**
- Single intent, multiple transfers
- Atomic execution (all or nothing)
- Nonce-based ordering
- Time-bounded validity

**Verifiable Execution:**
- On-chain transaction record
- Emitted settlement events
- Backend verification of blockchain state
- Database correlation with exact expense snapshot

This is fundamentally different from:
- ❌ Manual venmo/paypal transfers (not programmable, not atomic, not verifiable)
- ❌ Traditional banking (not on-chain, not composable, slow settlement)
- ❌ Simple ERC-20 transfers (no intent abstraction, no multi-party coordination)

---

## Production Deployment

### Current Deployment

**Frontend:** [https://vectra-sage.vercel.app](https://vectra-sage.vercel.app) (Vercel)

**Backend:** [https://vectra-endh.onrender.com](https://vectra-endh.onrender.com) (Render)

**Health Check:** [https://vectra-endh.onrender.com/health](https://vectra-endh.onrender.com/health)

**Smart Contract:** `0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea` (Arc Testnet)

**Blockchain:** Arc Testnet (Chain ID: 5042002)

### Infrastructure

| Component | Platform | Purpose |
|-----------|----------|---------|
| Frontend | Vercel | Next.js static/SSR hosting |
| Backend | Render | Express API server |
| Database | Render PostgreSQL | Application state |
| Blockchain | Arc Testnet | Settlement execution |

### Environment Variables

**Frontend (Vercel):**

| Variable | Purpose | Example |
|----------|---------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API endpoint | `https://vectra-endh.onrender.com` |

**Backend (Render):**

| Variable | Purpose | Secret? |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection string | ✅ Yes |
| `FRONTEND_URL` | Allowed CORS origin | No |
| `PORT` | HTTP port (auto-assigned by Render) | No |

**⚠️ Security Warning:**
- Never commit `.env` files with real secrets
- Never expose `DATABASE_URL` publicly
- Never commit private keys
- Use platform-specific secret management

---

## Local Development

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+
- Git
- Web3 wallet (MetaMask, Rainbow, etc.)
- Arc Testnet USDC (from faucet)

### Setup

**1. Clone Repository**

```bash
git clone https://github.com/yourusername/vectra.git
cd vectra
```

**2. Install Dependencies**

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

**3. Configure Backend Environment**

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/vectra"
FRONTEND_URL="http://localhost:3000"
```

**4. Setup Database**

```bash
cd backend

# Run Prisma migrations
npx prisma migrate dev

# Generate Prisma Client
npx prisma generate
```

**5. Configure Frontend Environment**

```bash
cd ../frontend
cp .env.local.example .env.local
```

Edit `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_URL="http://localhost:4000"
```

**6. Start Backend**

```bash
cd backend
npm run dev

# Backend running at http://localhost:4000
```

**7. Start Frontend**

```bash
cd frontend
npm run dev

# Frontend running at http://localhost:3000
```

**8. Access Application**

Open [http://localhost:3000](http://localhost:3000)

### Available Commands

**Backend:**

```bash
npm run dev          # Start development server with hot reload
npm run build        # Compile TypeScript to JavaScript
npm start            # Run compiled production build
npm run typecheck    # Type check without emitting files
npx prisma studio    # Open Prisma database GUI
npx prisma migrate dev  # Create and apply migration
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
forge build          # Compile Solidity contracts
forge test           # Run contract tests
forge script         # Run deployment scripts
```

---

## Demo Walkthrough

### User Flow

1. **Connect Wallet**
   - Click "Connect Wallet"
   - Approve connection in wallet
   - Wallet address displayed

2. **Authenticate**
   - System generates authentication challenge
   - Sign message in wallet
   - Session token issued

3. **Create Group**
   - Enter group name
   - Sign `registerGroup()` transaction
   - Group registered on-chain
   - Invite code generated

4. **Add Members**
   - Share invite code with members
   - Members join via code
   - Coordinator approves (if required)

5. **Record Expenses**
   - Enter expense description
   - Enter amount in USDC
   - Select payer
   - Submit to backend

6. **View Net Obligations**
   - Backend calculates net balances
   - Display who owes whom
   - Show optimized transfer set

7. **Create Settlement**
   - Click "Create Settlement"
   - Backend generates settlement intent
   - Frontend displays intent details

8. **Sign Settlement Intent**
   - Review intent data (groupId, nonce, deadline, transfers)
   - Sign EIP-712 typed data
   - Wallet shows structured settlement

9. **Execute Settlement**
   - Submit `executeSettlementIntent()` transaction
   - Approve USDC transfers in wallet
   - Transaction broadcast to Arc

10. **Verify Execution**
    - Backend fetches transaction receipt
    - Backend parses `SettlementIntentExecuted` event
    - Backend validates groupId, nonce, signer
    - Settlement marked COMPLETED

11. **View Settlement History**
    - See completed settlements
    - View Arc transaction links
    - See expenses marked as settled

### Demo Video

<!-- 🎥 Demo video placeholder -->

**Suggested Demo Structure (2-3 minutes):**

- **0:00-0:20** — Problem: Manual group expense settlement
- **0:20-0:45** — Solution: Intent-based on-chain settlement
- **0:45-1:00** — Create group, register on Arc
- **1:00-1:20** — Record expenses, view obligations
- **1:20-1:40** — Create settlement intent
- **1:40-2:00** — Sign EIP-712, execute on Arc
- **2:00-2:20** — Backend verification, view on Arcscan
- **2:20-2:40** — Architecture and security highlights
- **2:40-3:00** — Conclusion and future roadmap

---

## Screenshots

<!-- Add screenshots when available -->

**Suggested Screenshots:**

1. **Dashboard** — Group list, wallet connection
2. **Expense Management** — Record and view expenses
3. **Settlement Intent** — Structured intent display
4. **Wallet Signing** — EIP-712 signature request
5. **Arc Transaction** — Arcscan transaction view
6. **Settlement History** — Completed settlements with links

---

## Why This Is More Than an Expense Splitter

### The Core Primitive

Vectra's underlying primitive is **programmable stablecoin settlement for group obligations**.

The current implementation focuses on shared expenses, but the settlement infrastructure enables broader financial coordination:

### Potential Applications (Future Work)

**DAO Treasury Settlement**
- DAO votes on payment obligations
- Coordinator signs settlement intent
- Multi-beneficiary payouts executed atomically

**Team/Business Expense Settlement**
- Corporate expenses tracked off-chain
- Monthly settlement intent generated
- Accounting verifies on-chain execution

**Shared Procurement**
- Group orders from supplier
- Settlement splits cost across participants
- Single on-chain payment to supplier

**Recurring Treasury Obligations**
- Scheduled settlement intents
- Time-based coordinator signatures
- Automated treasury operations

**Multi-Party Workflows**
- Complex dependency graphs
- Conditional settlement execution
- Composable treasury primitives

### Why Arc + USDC Enables This

Traditional payment infrastructure:
- ❌ Requires trusted intermediaries
- ❌ Slow settlement finality
- ❌ Limited programmability
- ❌ No atomic multi-party coordination
- ❌ Opaque execution

Arc + USDC + Settlement Intents:
- ✅ Trustless execution
- ✅ Fast settlement finality
- ✅ Programmable with EIP-712
- ✅ Atomic multi-party execution
- ✅ Transparent on-chain history

---

## Roadmap

### ✅ Implemented (Current)

- Wallet signature authentication
- Group creation and membership management
- Expense recording and tracking
- Settlement intent construction
- EIP-712 typed signatures
- Arc Testnet deployment
- VectraTreasury smart contract
- On-chain settlement execution
- Backend transaction verification
- Settlement event parsing
- Database concurrency protection
- CORS production configuration

### 🚀 Future Enhancements

**Arc Mainnet Deployment**
- Deploy VectraTreasury to Arc Mainnet
- Mainnet USDC integration
- Production settlement infrastructure

**Advanced Settlement Logic**
- Recursive debt simplification
- Multi-currency support
- Partial settlement flows
- Settlement intent batching

**Treasury Automation**
- Scheduled settlements
- Recurring payment intents
- Automated obligation calculation
- Smart settlement triggers

**Enhanced Authorization**
- Multi-sig coordinator support
- Threshold signatures
- Timelocked settlements
- Emergency pause mechanisms

**Additional Infrastructure**
- Rate limiting and DDoS protection
- Advanced input sanitization
- Comprehensive test coverage
- Professional security audit
- On-chain gas optimization

---

## Tech Stack

### Frontend

| Technology | Purpose |
|------------|---------|
| Next.js 16 | React framework with App Router |
| React 19 | UI component library |
| TypeScript | Type-safe development |
| Tailwind CSS 4 | Utility-first styling |
| Wagmi 3 | React hooks for Ethereum |
| Viem 2 | TypeScript Ethereum library |
| TanStack Query | Server state management |

### Backend

| Technology | Purpose |
|------------|---------|
| Node.js | JavaScript runtime |
| Express 5 | HTTP server framework |
| TypeScript | Type-safe development |
| Prisma | Database ORM and migrations |
| PostgreSQL | Relational database |
| Viem | Arc blockchain interaction |
| CORS | Cross-origin resource sharing |

### Smart Contracts

| Technology | Purpose |
|------------|---------|
| Solidity 0.8.24 | Smart contract language |
| Foundry | Contract development toolkit |
| OpenZeppelin | Audited contract libraries (EIP712, SafeERC20, ECDSA) |

### Blockchain

| Technology | Purpose |
|------------|---------|
| Arc Testnet | Settlement execution layer |
| USDC | Treasury settlement asset |
| EIP-712 | Typed signature standard |

### Infrastructure

| Service | Purpose |
|---------|---------|
| Vercel | Frontend hosting |
| Render | Backend and database hosting |
| Git/GitHub | Version control |

---

## Repository Structure

```
vectra/
├── backend/                 # Express backend
│   ├── prisma/
│   │   ├── migrations/      # Database migrations
│   │   └── schema.prisma    # Database schema
│   └── src/
│       ├── index.ts         # Express server
│       ├── lib/
│       │   ├── prisma.ts    # Database client
│       │   ├── arc.ts       # Arc client & contract address
│       │   └── contract.ts  # VectraTreasury ABI
│       ├── middleware/
│       │   └── auth.ts      # Authentication middleware
│       └── routes/
│           ├── auth.ts      # Auth endpoints
│           ├── groups.ts    # Group/settlement endpoints
│           └── users.ts     # User endpoints
│
├── frontend/                # Next.js frontend
│   ├── app/
│   │   ├── layout.tsx       # Root layout
│   │   ├── page.tsx         # Main application UI
│   │   ├── providers.tsx    # Wagmi/React Query providers
│   │   └── globals.css      # Global styles
│   ├── config/
│   │   ├── wagmi.ts         # Wagmi/chain configuration
│   │   └── contract.ts      # Contract ABI and address
│   └── lib/
│       └── api.ts           # Backend API client
│
├── contracts/               # Solidity smart contracts
│   └── VectraTreasury.sol   # Settlement intent contract
│
├── script/                  # Foundry deployment scripts
├── test/                    # Foundry contract tests
└── README.md                # This file
```

---

## Judging Criteria

### ✅ Functional MVP

Vectra provides a complete end-to-end system:
- **Frontend:** Next.js application with wallet connection, authentication, group management, expense tracking, and settlement execution
- **Backend:** Express API with PostgreSQL database, session management, and Arc transaction verification
- **Smart Contract:** VectraTreasury deployed on Arc Testnet with settlement intent execution
- **Integration:** All components working together for complete settlement flow

### ✅ Architecture

See [Architecture](#architecture) diagram showing:
- User/wallet interaction layer
- Frontend application
- Backend API with database persistence
- Arc blockchain integration
- VectraTreasury smart contract
- USDC token integration

### ✅ Demo Video

<!-- Video link placeholder -->

### ✅ Arc + USDC Integration

**Arc:**
- VectraTreasury deployed at `0x1e82280fA9148F0d16Ac800eAE958502f07D44Ea`
- All settlements execute on Arc Testnet
- Backend verifies transactions via Arc RPC
- Transaction history visible on Arcscan

**USDC:**
- Settlement asset for all group treasury operations
- ERC-20 transfers executed via smart contract
- SafeERC20 for secure token handling
- Stablecoin-native expense denominations

### ✅ Programmable Money Flows

**Settlement Intents:**
- EIP-712 typed signatures for authorization
- Nonce-based replay protection
- Deadline-based expiration
- Multi-party atomic execution
- Verifiable on-chain settlement

**Stablecoin Infrastructure:**
- USDC as native treasury asset
- Intent-based settlement abstraction
- Atomic multi-transfer execution
- Backend-verified on-chain execution
- Transparent settlement history

**Why This Qualifies:**
Vectra demonstrates programmable financial infrastructure beyond simple token transfers. The settlement intent system provides:
- Declarative financial outcomes
- Cryptographic authorization
- Atomic multi-party coordination
- Verifiable execution
- Composable treasury primitives

This is foundational infrastructure for on-chain financial coordination using stablecoins.

---

## License

MIT License - See LICENSE file for details

---

## Contributors

Built for ETHGlobal / Arc + Circle bounty program

---

## Contact

- GitHub: [github.com/yourusername/vectra](https://github.com/yourusername/vectra)
- Demo: [vectra-sage.vercel.app](https://vectra-sage.vercel.app)

---

**Vectra: Intent-Based Group Treasury & USDC Settlement on Arc** 🚀
