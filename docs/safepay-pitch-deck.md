---
marp: true
theme: default
title: "SafePay — Freelance Escrow on MST Blockchain"
author: "Ronit Shrimankar"
---

# SafePay

## Trustless freelance escrow on MST Blockchain

**MST Blockchain Buildathon 2.0 — Round 2 MVP**

Team: Ronit Shrimankar (solo)
Project: freelance escrow — clients lock payment on-chain, funds release per approved milestone

> DRAFT — not submitted. Testnet contract address and transaction hashes below are real, verified on-chain values (28 Oct 2026); remaining TBDs (demo link, repo, video, Mainnet) are filled only with real values when they exist.

---

# The problem

Freelance work runs on trust — and trust breaks both ways:

- **Clients** fear paying upfront and getting nothing (or low-quality work)
- **Freelancers** fear delivering work and never getting paid
- Platforms and middlemen take a cut, yet still can't *enforce* payment

The result: delayed payments, disputes with no neutral arbiter, and freelancers — especially remote ones — carrying all the risk.

---

# The solution: SafePay

A freelance escrow where **the blockchain itself holds the money**:

1. The client creates an escrow with fixed milestones and locks the full amount on-chain
2. The freelancer delivers milestone by milestone
3. The client approves each milestone — only then do funds move
4. Unreleased funds return to the client after the deadline

No middleman holds the money. No one can move funds without the rules being followed.

---

# Demo flow (every step is a real on-chain transaction)

1. **Create** — client sets freelancer, milestone amounts, deadline
2. **Fund** — client locks exactly the milestone total into the contract
3. **Approve** — client approves a delivered milestone (approval alone moves no funds)
4. **Release** — the approved milestone's payment goes to the freelancer
5. **Refund** — after the deadline, unreleased funds return to the client

Each step is verifiable on the MST explorer — no simulated transactions.

---

# Architecture

```
  SafePay app (static web app)
    │  ethers v6 + injected wallet (BridgeKey-compatible, EIP-1193)
    ▼
  SafePayEscrow smart contract  (Solidity 0.8.24, OpenZeppelin ReentrancyGuard)
    │
    ▼
  MST Blockchain — Testnet now, Mainnet next
    Testnet: chain 91562037 · tMSTC · testnet.mstscan.com
    Mainnet: chain 4646 · MSTC · mstscan.com
```

- Native currency only (tMSTC / MSTC) — no extra token needed
- Milestones are fixed at escrow creation — terms can't be quietly changed later
- Toolchain: Hardhat 2.29 + Toolbox 5, ethers v6

---

# Why the MST integration is genuinely on-chain

SafePay is not a web app with a token bolted on — **custody of the money IS the contract**:

- Funds sit in the escrow contract, not in a database or a company account
- Every state change (create, fund, approve, release, refund) is a transaction with a verifiable hash
- The contract enforces the rules: exact funding amount, client-only funding/approval/refund, no double release, no refund before the deadline
- Anyone can read escrow state on-chain (`getEscrow`, `getMilestone`) and audit events (`EscrowCreated`, `EscrowFunded`, `MilestoneApproved`, `MilestoneReleased`, `EscrowRefunded`)
- ReentrancyGuard protects all fund-moving functions

---

# Contract functions — `SafePayEscrow.sol`

| Function | Who | What it does |
| --- | --- | --- |
| `createEscrow(freelancer, amounts[], deadline)` | anyone (becomes client) | Creates the escrow; milestones fixed at creation |
| `fund(escrowId)` — payable | client only | Locks exactly the milestone total; rejects wrong amounts and double funding |
| `approveMilestone(escrowId, index)` | client only | Approves a milestone; moves no funds by itself |
| `releaseMilestone(escrowId, index)` | anyone | Pays an approved milestone to the freelancer; rejects unapproved or already-released milestones |
| `refund(escrowId)` | client only, after deadline | Returns all still-unreleased funds to the client |
| `getEscrow(id)` / `getMilestone(id, index)` | anyone | Read escrow and milestone state |

---

# Business potential — startup-convertible

The organizer's Round 2 framing is a business/startup-convertible build. SafePay fits it directly:

- **Escrow-as-a-service for freelance platforms** — plug milestone escrow into any marketplace instead of each platform building custody itself
- **Remote and cross-border freelance work** — payment enforcement that doesn't depend on local courts or payment rails
- **Milestone-based project payments** — agencies, contractors, and gig work beyond freelancing

Future work (not built yet): platform fees, multi-freelancer escrows, mediation for disputed milestones. The MVP proves the core — on-chain custody and release — first.

---

# Status and proof

**Proven locally (Phase 1, recorded in the project README):**

- Contract compiles cleanly (Solidity 0.8.24)
- 6/6 Hardhat tests passing: create (+ bad-input reverts), fund rules, approve + release (exact payment, no double-spend), refund rules, full end-to-end flow
- Local-node end-to-end run passed (local network only — **not** testnet proof)

**Testnet deployment — DONE and verified on-chain (28 Oct 2026, MST Testnet, chain ID 91562037):**

- Testnet contract address: **0xd330F3F7cD35FA2512592dCC0aD75381aF3798F5** — https://testnet.mstscan.com/address/0xd330F3F7cD35FA2512592dCC0aD75381aF3798F5
- Deploy tx: **0x7843d0788f8781eda9cf665ad361382c0b42cca29d484ed6a6d3b14313e6d5a6** (block 6634177)
- createEscrow(0): **0xcb04b4620a87c271a81cdecd35c41d3669e0a948aa8fcfa3e7110d474bf02c97** (block 6634184)
- fund(0) — 1.0 tMSTC: **0x8cc61e2a097946d60ebff2d3bb78d0353dfc3b9dfe6ed56bea16882ff54796f6** (block 6634185)
- approveMilestone(0,0): **0xd989e5a12c6b273b20bc3dd26f0d06c67baac4df765591d7b5ca62388f799614** (block 6634186)
- releaseMilestone(0,0) — 0.6 tMSTC paid: **0xed56b2e2a5ca61db25d9e6ebca393d4e20578fb89b436dfd309272a4e2b08fd3** (block 6634187)
- approveMilestone(0,1): **0xb4b8265d3600f7dbc9ef1ac8dcfa1256f853ad51cd82296b68d8336d60b23aeb** (block 6634188)
- releaseMilestone(0,1) — 0.4 tMSTC paid: **0x02265040e5958643db3ab81070701297b2f209f22fafef8b1601eb8344840af7** (block 6634189)
- createEscrow(1) — refund path: **0x52513072e3a27a06f9fe7c916098df10e4978087b1c37276bfa91b5e8322fdfe** (block 6634190)
- fund(1) — 0.5 tMSTC: **0x9a04c4d9f47bc1babdc93d2ee33799a161fd0fdde6a7cfaedf38752503abacac** (block 6634191)
- refund(1) — 0.5 tMSTC returned: **0xd64105d11df29d1d0de8c68e550ffe72e30920803412d7a388ed445f471cdb9d** (block 6634192)
- All 10 receipts confirmed successful (status 0x1) via the official Testnet RPC; contract bytecode verified on-chain. Explorer page fetch timed out and was not retried — verify visually at the links above.
- Live demo link: **TBD**
- Public GitHub repository: **TBD**
- Demo video (2–3 min): **TBD**
- Mainnet deployment details: **TBD** (organizer-provided funds)

Round 2 submission deadline: **30 Oct 2026, 12:00 PM IST** · Demo Day: **1 Nov 2026, MST office Pune**
