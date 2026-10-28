---
marp: true
theme: default
title: "SafePay — Freelance Escrow on MST Blockchain"
author: "Ronit Shrimankar"
---

# SafePay

## Trustless freelance escrow on MST Blockchain

**MST Blockchain Buildathon 2.0 — Round 2 MVP**

Team: FORTEC — Ronit Shrimankar (solo builder)
Project: freelance escrow — clients lock payment on-chain, funds release per approved milestone

> DRAFT — not submitted. Testnet contract address and transaction hashes below are real, verified on-chain values (28 Oct 2026); remaining TBDs (video, Mainnet) are filled only with real values when they exist.

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
2. The freelancer delivers milestone by milestone, recorded on-chain with proof
3. The client approves each milestone — only then do funds move
4. If delivered work is never approved, the freelancer claims it after the deadline — a ghosting client cannot refund it away
5. Unreleased, unapproved, undelivered funds return to the client after the deadline

No middleman holds the money. No one can move funds without the rules being followed.

---

# Demo flow (every step is a real on-chain transaction)

1. **Create** — client sets freelancer, milestone amounts, deadline
2. **Fund** — client locks exactly the milestone total into the contract
3. **Deliver** — freelancer records delivery on-chain with proof
4. **Approve** — client approves a delivered milestone (approval alone moves no funds)
5. **Release** — the approved milestone's payment goes to the freelancer
6. **Claim** — after the deadline, delivered-but-unapproved work is claimable by the freelancer
7. **Refund** — after the deadline, only unapproved, undelivered funds return to the client

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
- Every state change (create, fund, approve, deliver, release, claim, refund) is a transaction with a verifiable hash
- The contract enforces the rules: exact funding amount, client-only funding/approval/refund, no double release, no refund before the deadline, approved/delivered funds locked against refunds
- Anyone can read escrow state on-chain (`getEscrow`, `getMilestone`) and audit events (`EscrowCreated`, `EscrowFunded`, `MilestoneApproved`, `MilestoneDelivered`, `MilestoneReleased`, `EscrowRefunded`)
- ReentrancyGuard protects all fund-moving functions

---

# Contract functions — `SafePayEscrow.sol`

| Function | Who | What it does |
| --- | --- | --- |
| `createEscrow(freelancer, amounts[], deadline)` | anyone (becomes client) | Creates the escrow; milestones fixed at creation |
| `fund(escrowId)` — payable | client only | Locks exactly the milestone total; rejects wrong amounts and double funding |
| `approveMilestone(escrowId, index)` | client only | Approves a milestone; moves no funds by itself |
| `releaseMilestone(escrowId, index)` | anyone | Pays an approved milestone to the freelancer; rejects unapproved or already-released milestones |
| `refund(escrowId)` | client only, after deadline | Returns only unapproved, undelivered funds; approved/delivered funds are locked |
| `submitDelivery(escrowId, index, proof)` | freelancer only, before deadline | Records delivery on-chain with a proof link; moves no funds by itself |
| `claimDelivered(escrowId, index)` | freelancer only, after deadline | Pays delivered-but-unapproved work; the anti-ghosting path |
| `getEscrow(id)` / `getMilestone(id, index)` | anyone | Read escrow and milestone state |

---

# Business potential — startup-convertible

The organizer's Round 2 framing is a business/startup-convertible build. SafePay fits it directly:

- **Escrow-as-a-service for freelance platforms** — plug milestone escrow into any marketplace instead of each platform building custody itself
- **Remote and cross-border freelance work** — payment enforcement that doesn't depend on local courts or payment rails
- **Milestone-based project payments** — agencies, contractors, and gig work beyond freelancing

Future work (not built yet): platform fees, multi-freelancer escrows, third-party arbitration. Delivery proof and deadline-claim are already built. The MVP proves the core — on-chain custody and release — first.

---

# Status and proof

**Proven locally (Phase 1, recorded in the project README):**

- Contract compiles cleanly (Solidity 0.8.24)
- 11/11 Hardhat tests passing: v1 flows plus v2 delivery rules, deadline-claim, and refund-lock (partial + full)
- Local-node end-to-end run passed (local network only — **not** testnet proof)

**Testnet deployment — DONE and verified on-chain (28 Oct 2026, MST Testnet, chain ID 91562037):**

- Testnet contract address: **0x40854b8c2436504FFB30Ac89298Da24eC434a905** — https://testnet.mstscan.com/address/0x40854b8c2436504FFB30Ac89298Da24eC434a905
- Deploy tx (v2): **0x6e52a3661e5a044893ce16153c6005458f9b5ea15f953d3fb78e6ead8a185fde** (block 6636444)
- Escrow 0 — approve/release flow, 1.0 tMSTC released: create **0xf858ba38563de2bb63557444afb0fbad89673e0af621fba969e474e5f950cc3c**, fund **0x9fa2ecc82171bb83f24c762faed7da34dc908d07759eb11fa468f42415bc82ef**, approve **0x6c66730ff8a957e7deb2d7bbf2037aab767ee140289cec5f31cbd9c0d62ebddb**, release **0x0ad76f8200adebc9706dbfe5e1acefbc1af6bf75a15f41aa2831ada0ce903a91**, approve **0x0092e15702275a5f3739695f7d95e89cf7d791820f49b01269b01fbe8e6317b5**, release **0x5e95af131e29c98b2585e476d96f9740a220b8e94caa57a67f23f8de5db9aef4**
- Escrow 1 — refund path, 0.5 tMSTC returned: create **0x063ada4f597a54965720657f850a8aabc8db4da80483006e05ee9b243fe3a65a**, fund **0x233281aec91bd9506944af7089cadb7b1948ef263b5dbb741ade340d73754b1c**, refund **0xc136c1b9fdfc75eae0f4da53ac3d715c8f073c663e09f9bf273190305ed94fa2**
- Escrow 2 — delivery + deadline-claim, 0.5 tMSTC claimed with no approval: create **0x20d7b3786e2b735ee0bb5370d457147019d6cf0ffe7327883187e93d61828322**, fund **0x634636255f5a43de502152500be599bdd31e38bf0d8b2fc5207c7b64bc795e61**, deliver **0x26fbc6190634d8a187c78bf891857ee40a21ef1a0bd119a77f9fc55c0fc47352**, claim **0x79687f07a2c5d330aa1a63d4baddb8c9971aa78911895a226688b7d1b22ce7a7**
- Escrow 3 — refund-lock, 0.6 released + 0.6 refunded + 0.4 claimed (delivered funds NOT swept): create **0xc5693a6e957d67e7e220a336eee2d6d29d5e2bc1b07dcf735bd3b4e838d073f1**, fund **0xb5783109d7d65ff422a0adf9006e032003237f5df6137d99cca808a7b9f942ca**, deliver **0xa2d2d116d5276b2b07bf5b5884251e2b5d7ca0b3bc1cc297bd9968f2acd91a5a**, approve **0x7c8155647ea58295dde6279a8b5cef32cd5145a5501915c3beb4a4ef65f7110d**, release **0x40d585b97fb26a9ebd4fa54e3f4492496d19eb55871bbb4a28c43c3538c2a2fb**, refund **0x043afd53052c8475c176090d8499d56f1981b6537623ed8d4f98f33cd5d23962**, claim **0x1b6de3266d7b0cd1beb9e32fb4b811d5e990cce515f87598e606e5206eb0796f**
- All 22 receipts confirmed successful (status 0x1) via the official Testnet RPC; contract bytecode verified on-chain; final states re-read on-chain. Explorer page fetch timed out and was not retried — verify visually at the links above.
- Live demo link: **https://eres0045.github.io/safepay/app/**
- Public GitHub repository: **https://github.com/eres0045/safepay**
- Demo video (2–3 min): **TBD**
- Mainnet deployment details: **TBD** (organizer-provided funds)

Round 2 submission deadline: **30 Oct 2026, 12:00 PM IST** · Demo Day: **1 Nov 2026, MST office Pune**
