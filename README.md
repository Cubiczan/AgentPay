# AgentPay-x402

**Micropayment Marketplace for AI Agents on Casper Network — with an LLM-driven Treasury Agent that pays for its own services.**

AgentPay-x402 implements the [x402 protocol](https://github.com/anish-agni/x402) — an HTTP-level micropayment standard where services respond with `402 Payment Required`, agents submit Ed25519-signed payment proofs on-chain, and data is delivered on `200 OK`.

Built on **Casper Network** with full on-chain integration: real Wasm smart contracts, Ed25519 keypairs, deploy hash verification, and on-chain balance reads. **New for the Finals round:** a Treasury Agent that uses an LLM (GLM-4.6) to autonomously decide which services each agent should call, then executes the x402 payment flow on their behalf — no human in the loop.

<!-- product-screenshots:start -->
## Product screenshots

x402 marketplace interface with service registration, agent services, and the integration example.

![AgentPay product interface](public/agentpay-marketplace.png)

Existing UI capture stored in this repository; displayed values may be demo or sample data.
<!-- product-screenshots:end -->

## What's new in the Finals round

The Qualification-round submission was a payment API for AI agents. For the Finals, we added the agent layer:

| Capability | Status |
|---|---|
| Real Ed25519-signed Casper testnet deploys | Live (native transfer + escrow lock) |
| On-chain balance reads via Casper RPC | Live |
| Rust → Wasm contracts compiled | Built (`contracts/target/wasm/*.wasm`) |
| Treasury Agent — LLM-driven autonomous decision engine | New |
| Treasury Agent UI tab — config, live decisions, deploy-hash links | New |
| Dry-run mode — preview LLM decisions without spending CSPR | New |
| Live mode — Treasury Agent executes real on-chain payments | New |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Treasury Agent (new)                          │
│                                                                     │
│  For each on-chain agent:                                           │
│   1. Refresh live balance from Casper RPC                           │
│   2. If balance < 2× reserve, skip (in LIVE mode)                   │
│   3. Ask LLM (glm-4.6) — "should this agent call a service?"        │
│   4. If yes, build + sign Ed25519 transfer deploy on agent's behalf │
│   5. Submit to Casper testnet, verify on-chain (x402 step 4)        │
│   6. Log decision + deploy hash to DB, surface in UI                │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
   AI Agent                          AgentPay-x402                         Service Provider
      │                                    │                                       │
      │  1. POST /api/services/{id}/call  │                                       │
      │ ──────────────────────────────────>│                                       │
      │                                    │  2. 402 Payment Required              │
      │ <──────────────────────────────────│  (price, payment address)             │
      │                                    │                                       │
      │  3. Submit signed deploy            │                                       │
      │  (Ed25519 + casper-client)         │                                       │
      │ ──────────────────────────────────>│                                       │
      │                                    │  4. Verify deploy on-chain            │
      │                                    │  (escrow contract)                    │
      │                                    │                                       │
      │  5. 200 OK + response data          │                                       │
      │ <──────────────────────────────────│                                       │
      │                                    │                                       │
      │                                    │  6. Release payment to provider       │
      │                                    │ ─────────────────────────────────────>│
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui, Recharts |
| API | 19 Next.js App Router endpoints (4 new for Treasury Agent) |
| Database | Prisma ORM + SQLite (6 models — 2 new for Treasury Agent) |
| Blockchain | Casper Network (testnet) |
| Smart Contracts | Rust → Wasm via `casper-contract` + `casper-types` |
| Cryptography | Ed25519 keypairs, real `casper-client` deploys |
| Protocol | x402 (HTTP 402 Payment Required) |
| LLM | GLM-4.6 via `z-ai-web-dev-sdk` (pluggable: glm-4.5, glm-4.5-air, glm-4.5v) |

## Smart Contracts (Rust/Wasm)

- **Escrow Contract** (`contracts/escrow/src/lib.rs`, 237 LOC) — `lock_payment`, `release_payment`, `refund_payment`, `get_payment`, `get_payment_count`
- **Service Registry Contract** (`contracts/service-registry/src/lib.rs`, 173 LOC) — on-chain service catalog

Compile with:
```bash
cd contracts
rustup toolchain install nightly
rustup target add wasm32-unknown-unknown --toolchain nightly
RUSTFLAGS="-C link-arg=--import-undefined -C link-arg=--no-entry" \
  cargo +nightly build --release --target wasm32-unknown-unknown
mkdir -p target/wasm
cp target/wasm32-unknown-unknown/release/escrow.wasm target/wasm/escrow.wasm
cp target/wasm32-unknown-unknown/release/service_registry.wasm target/wasm/service_registry.wasm
```

Deploy with:
```bash
node scripts/deploy-contracts.mjs
```
(Requires a funded deployer key — see `.deploy-key.json` after first run, fund it at https://testnet.cspr.live/faucet)

## Data Models

6 Prisma models: **Service**, **Agent**, **Payment**, **Review**, **TreasuryConfig** (new), **TreasuryDecision** (new)

```prisma
Service           — name, category, endpoint, pricePerCall, provider, status, ratings
Agent             — name, role, balance, Ed25519 keys, onChainBalance, isOnChain
Payment           — agentId, serviceId, amount, txHash, deployHash, deployStatus, onChain
Review            — serviceId, agentId, rating, comment
TreasuryConfig    — singleton: enabled, dryRun, llmModel, minBalanceCSPR, maxSpendPerCycleCSPR, allowedCategories
TreasuryDecision  — agentId, decision, reasoning, serviceId?, paymentId?, deployHash?, status, llmResponse, cycleId
```

## API Endpoints

### Services
- `GET    /api/services` — list all services
- `POST   /api/services` — register a new service
- `GET    /api/services/[id]` — get service details
- `PUT    /api/services/[id]` — update service
- `DELETE /api/services/[id]` — remove service
- `POST   /api/services/[id]/call` — **x402 payment flow** (402 → signed deploy → 200)

### Agents
- `GET /api/agents` — list all agents
- `POST /api/agents` — create agent (generates Ed25519 keypair)
- `GET /api/agents/[id]` — agent details + on-chain balance
- `POST /api/agents/[id]/fund` — generate on-chain keys, request faucet, or refresh balance

### Casper On-Chain
- `GET /api/casper/balance` — read on-chain CSPR balance
- `GET /api/casper/chain-info` — testnet chain metadata
- `GET /api/casper/deploy-status` — verify deploy hash on-chain
- `POST /api/casper/faucet` — request testnet CSPR from faucet
- `POST /api/casper/transfer` — submit CSPR transfer deploy
- `POST /api/casper/contract-call` — invoke a deployed contract entry point

### Treasury Agent (new)
- `GET  /api/treasury/status` — 24h stats (decisions made, executed, dry-run, CSPR spent)
- `GET  /api/treasury/config` — fetch the TreasuryConfig singleton
- `PUT  /api/treasury/config` — update enabled / dryRun / llmModel / minBalanceCSPR / etc.
- `GET  /api/treasury/decisions` — list recent decisions (filterable by cycleId, agentId)
- `POST /api/treasury/run` — trigger a decision cycle (one LLM call per on-chain agent)

### Other
- `GET    /api/payments` — payment history
- `GET    /api/payments/[id]` — payment details
- `POST   /api/reviews` — submit service review
- `GET    /api/stats` — marketplace analytics
- `POST   /api/demo/seed` — seed demo data

## Dashboard

Single-page app with **5 tabs**:

- **Marketplace** — browse and call services, x402 payment flow
- **Agent Dashboard** — manage agents, balances, on-chain status
- **Treasury Agent** *(new)* — stats, config, recent decisions with deploy-hash links to testnet.cspr.live
- **Developer Portal** — register and configure services
- **Payment Explorer** — payment history, deploy tracking, verification

## The Treasury Agent in detail

The Treasury Agent is what makes AgentPay an **autonomous agent system**, not just a payment API. On each cycle:

1. **Fetch agents.** In LIVE mode, only agents with on-chain Ed25519 keys are considered. In dry-run mode, all active agents are considered (so you can preview decisions without funding).
2. **Refresh balances.** Each agent's on-chain CSPR balance is queried via Casper RPC `query_global_state` → `Account.main_purse`.
3. **Apply hard rules.** In LIVE mode, agents below `2 × minBalanceCSPR` are skipped without consulting the LLM — this protects against draining small balances.
4. **Apply cycle spend cap.** If `totalSpentCSPR ≥ maxSpendPerCycleCSPR`, the agent is deferred to the next cycle.
5. **Ask the LLM.** A structured prompt is sent to GLM-4.6 with the agent's role, balance, and the candidate service catalog. The LLM is told to prefer cheap, high-rated, role-matching services. The response is parsed as JSON: `{ should_call, service_id?, reason, confidence }`.
6. **Execute (or dry-run).** If `should_call=true` and `dryRun=false`, the agent's private key is loaded from the DB, an Ed25519-signed transfer deploy is built and submitted to Casper testnet, the deploy is verified on-chain via `verifyPaymentBeforeDelivery`, and a `Payment` row is persisted with the deploy hash.
7. **Log everything.** A `TreasuryDecision` row is created for every agent on every cycle — including the LLM's raw JSON response — so the entire reasoning trail is auditable.

### Decision philosophy encoded in the LLM prompt

- Prefer CHEAP services that match the agent's stated role
- Prefer HIGH-RATED services on ties
- If the agent's balance is below 2× the minimum reserve, decline to spend
- If no service clearly matches the agent's role, return `should_call=false`
- Be decisive: a 1-2 sentence reason is enough

### Demo flow

1. Run `bun dev` and open http://localhost:3000
2. The dashboard auto-seeds 8 services, 4 agents, 20 payments, 8 reviews
3. Go to the **Treasury Agent** tab — default config is `enabled=true, dryRun=false, llmModel=glm-4.6, minBalanceCSPR=0.5, maxSpendPerCycleCSPR=2.0`
4. Click **Switch to DRY-RUN** to preview LLM decisions without spending
5. Click **Run decision cycle now** — within ~6 seconds, 4 decisions appear (one per agent) with full LLM reasoning
6. To go LIVE: in the Agent Dashboard tab, click "Generate on-chain keys" for an agent, fund it at https://testnet.cspr.live/faucet, then back on Treasury Agent click **Switch to LIVE mode** and **Run decision cycle now** — the resulting decisions include real deploy hashes you can click through to testnet.cspr.live

## Getting Started

### Prerequisites

- Node.js 18+ / Bun
- Rust nightly + `wasm32-unknown-unknown` target (only needed if you want to recompile the contracts)

### Install & Run

```bash
git clone https://github.com/icohangar-ops/AgentPay.git
cd AgentPay

# Install dependencies
bun install

# Set up database + generate Prisma client
bunx prisma db push
bunx prisma generate

# Start dev server
bun dev
```

Open http://localhost:3000. The dashboard auto-seeds demo data on first load.

### Environment Variables

```env
DATABASE_URL=file:./db/agentpay.db
# Optional: set after running scripts/deploy-contracts.mjs
NEXT_PUBLIC_ESCROW_CONTRACT_HASH=
NEXT_PUBLIC_SERVICE_REGISTRY_CONTRACT_HASH=
```

The app works in simulation mode by default and uses real on-chain calls when agent keys are present.

### Compiling & deploying the smart contracts (optional, for full on-chain mode)

```bash
cd contracts
rustup toolchain install nightly
rustup target add wasm32-unknown-unknown --toolchain nightly
RUSTFLAGS="-C link-arg=--import-undefined -C link-arg=--no-entry" \
  cargo +nightly build --release --target wasm32-unknown-unknown
mkdir -p target/wasm
cp target/wasm32-unknown-unknown/release/escrow.wasm target/wasm/escrow.wasm
cp target/wasm32-unknown-unknown/release/service_registry.wasm target/wasm/service_registry.wasm
cd ..
node scripts/deploy-contracts.mjs
```

The deploy script will:
1. Generate an Ed25519 keypair (saved to `.deploy-key.json`)
2. Attempt the testnet faucet (web-only — usually fails, fund the key manually at https://testnet.cspr.live/faucet)
3. Once funded, re-run with `DEPLOY_KEY_HEX=<hex> DEPLOY_PUB_KEY_HEX=<0xhex> node scripts/deploy-contracts.mjs`
4. Deploy both contracts and save results to `.deploy-results.json`
5. Update `.env` with the returned contract hashes

## MAPS Integration

<p align="center">
  <img src="https://img.shields.io/badge/Built%20with-MAPS%20%7C%20Multi-Agent%20Pipeline%20Skills-blue" alt="MAPS" />
</p>

AgentPay's AI agent marketplace is structured using the [MAPS framework](https://mojoaistudio.com/maps/) (Multi-Agent Pipeline Skills) for agent system development and service orchestration.

### APS Layer (Per-Agent Pipeline) — Phase Mapping

| MAPS Phase | AgentPay Component |
|------------|-------------------|
| **A0 Alignment** | x402 protocol alignment — HTTP 402 payment standard for agent-to-service interaction |
| **A1 Define** | Agent brief — role, capabilities, Ed25519 keypair, payment flow |
| **A2 Design** | Agent identity model — on-chain balance, service catalog, payment tracking |
| **A3 Build** | Next.js App Router endpoints, Casper smart contracts (Escrow + Service Registry), Treasury Agent lib |
| **A4 Equip** | Ed25519 signing capability, casper-client deploy tool, CSPR wallet integration, LLM via z-ai-web-dev-sdk |
| **A5 Evaluate** | Service review system, payment verification, on-chain deploy status checks, Treasury decision audit log |
| **A6 Deploy** | Casper testnet deployment, Odra smart contract compilation, Treasury Agent live cycles |
| **A7 Observe** | Payment Explorer + Treasury Agent tab — tx tracking, deploy verification, decision history |
| **A8 Improve** | Service rating feedback loop, LLM-tunable decision philosophy, per-cycle spend caps |

### Key MAPS Concepts Applied

| Concept | AgentPay Implementation |
|---------|------------------------|
| **Agent Roster (M2)** | Agent registry with Ed25519 keypairs, on-chain identities, balance tracking |
| **Capability Map (A4)** | x402 payment protocol, Casper deploy signing, service invocation tools, LLM-driven decisioning |
| **Evaluation (A5)** | On-chain deploy verification, service reviews, payment status tracking, Treasury decision audit |
| **Observation (A7)** | Payment Explorer + Treasury Agent dashboard, deploy status monitoring, on-chain balance reads |

---

## License

MIT
