# SafePay — Project Documentation (DRAFT)

> **Draft only — not submitted.** Testnet values in the submission table
> are real, verified on-chain values (28 Oct 2026). Remaining **TBD**s
> (demo link, repo, video, Mainnet) must be filled in only with real,
> verified values when they exist. Nothing in this document
> is published, submitted, or deployed.

## Description

SafePay is a freelance escrow built on MST Blockchain. A client locks payment
on-chain for a freelancer across fixed milestones. Funds release per milestone
only after the client approves it. Unreleased funds return to the client after
the deadline. The blockchain itself holds the money — no middleman, no
simulated transactions.

Built for MST Blockchain Buildathon 2.0, Round 2 (MVP Build Sprint).
Team: Ronit Shrimankar (solo).

## Problem statement

Freelance work runs on trust, and trust breaks both ways: clients fear paying
upfront and receiving nothing, freelancers fear delivering work and never
getting paid. Platforms and middlemen take a cut yet still cannot enforce
payment. The result is delayed payments, disputes with no neutral arbiter,
and freelancers — especially remote ones — carrying all the risk.

## Solution

SafePay makes the escrow itself a smart contract on MST Blockchain:

1. The client creates an escrow naming the freelancer, the per-milestone
   amounts, and a deadline. Milestones are fixed at creation.
2. The client funds the escrow with exactly the milestone total.
3. The freelancer delivers work milestone by milestone.
4. The client approves each delivered milestone; approval alone moves no funds.
5. An approved milestone's payment is released to the freelancer.
6. After the deadline, any still-unreleased funds are refundable to the client.

## Key features

- **On-chain custody** — funds sit in the escrow contract, not in a database
  or a company account.
- **Milestone-gated release** — no milestone is paid before the client
  approves it.
- **Exact-funding rule** — funding must equal the milestone total exactly;
  wrong amounts and double funding are rejected by the contract.
- **Deadline refund** — unreleased funds return to the client after the
  deadline; released funds stay paid.
- **No double-spend** — approved/released state is tracked per milestone;
  re-approval and re-release are rejected.
- **Auditable** — every state change emits an event and is verifiable on
  the MST explorer; anyone can read escrow state on-chain.
- **Reentrancy protection** — all fund-moving functions use OpenZeppelin's
  `ReentrancyGuard`.
- **Native currency only** — tMSTC on Testnet, MSTC on Mainnet; no extra
  token required.

## Tech stack

| Layer | Technology |
| --- | --- |
| Smart contract | Solidity 0.8.24, OpenZeppelin Contracts 5 (ReentrancyGuard) |
| Development / testing | Hardhat 2.29 + Hardhat Toolbox 5, ethers v6 |
| Frontend | Static web app (`app/index.html`), ethers v6 via CDN, injected-wallet (EIP-1193) calls — compatible with BridgeKey, the officially recommended MST wallet |
| Networks | MST Testnet (chain ID 91562037) and MST Mainnet (chain ID 4646) |
| Explorer | testnet.mstscan.com (Testnet), mstscan.com (Mainnet) |

## MST integration details

- MST Blockchain is EVM-compatible and answers standard Ethereum JSON-RPC,
  so the escrow is a standard Solidity contract — no custom chain work.
- The integration is integral, not bolted on: custody, release rules, and
  refunds are all enforced by the contract. A simple wallet connection or a
  single isolated transaction would not satisfy this — SafePay's core
  functionality *is* the on-chain escrow.
- The app connects an injected wallet (BridgeKey-compatible), switches to
  (or adds) MST Testnet, and sends real transactions for create, fund,
  approve, release, and refund, linking each transaction to the explorer.
- Testnet deployment is pending the faucet claim (the faucet claim flow
  could not be verified by text fetch; claiming is a live-browser or manual
  step). Mainnet deployment uses organizer-provided funds and is pending.

## Contract reference — `contracts/SafePayEscrow.sol`

### State-changing functions

| Function | Caller | Behavior and guards |
| --- | --- | --- |
| `createEscrow(address freelancer, uint256[] amounts, uint256 deadline)` | anyone (becomes the client) | Creates an escrow; milestones fixed at creation. Reverts on zero freelancer address, freelancer == client, empty milestone list, or any zero milestone amount. |
| `fund(uint256 escrowId)` (payable) | client only | Locks exactly the milestone total. Reverts on double funding or an incorrect amount. |
| `approveMilestone(uint256 escrowId, uint256 milestoneIndex)` | client only | Marks a milestone approved. Moves no funds. Reverts if unfunded, invalid index, already approved, or already released. |
| `releaseMilestone(uint256 escrowId, uint256 milestoneIndex)` | anyone | Pays an approved milestone to the freelancer. Reverts if unfunded, invalid index, unapproved, or already released. |
| `refund(uint256 escrowId)` | client only, after deadline | Returns all still-unreleased funds to the client. Reverts if unfunded, before the deadline, or if nothing is refundable. |

### Read functions

| Function | Returns |
| --- | --- |
| `getEscrow(uint256 escrowId)` | client, freelancer, deadline, total / funded / released / refunded amounts, funded flag, milestone count |
| `getMilestone(uint256 escrowId, uint256 milestoneIndex)` | milestone amount, approved flag, released flag |

### Events

`EscrowCreated`, `EscrowFunded`, `MilestoneApproved`, `MilestoneReleased`,
`EscrowRefunded`.

### Scope limits (honest)

One client + one freelancer per escrow; native currency only; milestones
fixed at creation (no editing after creation); no in-contract dispute
mediation — the deadline refund is the fallback. Platform fees,
multi-freelancer escrows, and mediation are future work, not built.

## Setup instructions

Prerequisites: Node.js with npm, and a wallet with MST Testnet funds
(claim tMSTC from the MST faucet) for Testnet deployment.

```bash
# Install dependencies
npm install

# Compile the contract
npx hardhat compile

# Run the test suite
npx hardhat test

# Run the full flow on a local node (local network only — not testnet proof)
npx hardhat node
npx hardhat run scripts/deploy.js --network localhost
npx hardhat run scripts/interact.js --network localhost
```

Testnet deployment (requires a funded deployer wallet):

```bash
npx hardhat run scripts/deploy.js --network mstTestnet
npx hardhat run scripts/interact.js --network mstTestnet
```

The deploy script writes the deployed address to `deployments.json` and
refuses to run with a zero-balance deployer. The app ABI is regenerated
from the compiled artifact with `node scripts/sync-abi.js` after compile.
Serve `app/index.html` from any static host for the demo frontend.

## Local verification (recorded in Phase 1 — local network only)

- `npx hardhat compile` — pass.
- `npx hardhat test` — 6/6 passing: create (+ bad-input reverts), fund
  (exact-amount / client-once rules), approve + release (exact payment, no
  double-spend), refund (blocked pre-deadline, correct post-deadline), and
  a full end-to-end flow (create → fund → approve all → release all →
  escrow balance 0).
- Local-node end-to-end run — pass (contract deployed and full flow
  executed with real transactions on the local network).

These results are local-network only and must NOT be presented as Testnet
proof. Testnet proof comes only from the deployment and transactions below.

## Submission values (Testnet values verified on-chain 28 Oct 2026; rest TBD)

| Item | Value |
| --- | --- |
| MST Testnet contract address (v2) | 0x40854b8c2436504FFB30Ac89298Da24eC434a905 — https://testnet.mstscan.com/address/0x40854b8c2436504FFB30Ac89298Da24eC434a905 |
| MST Testnet contract address (v1, superseded) | 0xd330F3F7cD35FA2512592dCC0aD75381aF3798F5 |
| Deploy tx | 0x7843d0788f8781eda9cf665ad361382c0b42cca29d484ed6a6d3b14313e6d5a6 (block 6634177) |
| createEscrow(0) tx | 0xcb04b4620a87c271a81cdecd35c41d3669e0a948aa8fcfa3e7110d474bf02c97 (block 6634184) |
| fund(0) tx — 1.0 tMSTC | 0x8cc61e2a097946d60ebff2d3bb78d0353dfc3b9dfe6ed56bea16882ff54796f6 (block 6634185) |
| approveMilestone(0,0) tx | 0xd989e5a12c6b273b20bc3dd26f0d06c67baac4df765591d7b5ca62388f799614 (block 6634186) |
| releaseMilestone(0,0) tx — 0.6 tMSTC paid | 0xed56b2e2a5ca61db25d9e6ebca393d4e20578fb89b436dfd309272a4e2b08fd3 (block 6634187) |
| approveMilestone(0,1) tx | 0xb4b8265d3600f7dbc9ef1ac8dcfa1256f853ad51cd82296b68d8336d60b23aeb (block 6634188) |
| releaseMilestone(0,1) tx — 0.4 tMSTC paid | 0x02265040e5958643db3ab81070701297b2f209f22fafef8b1601eb8344840af7 (block 6634189) |
| createEscrow(1) tx — refund path | 0x52513072e3a27a06f9fe7c916098df10e4978087b1c37276bfa91b5e8322fdfe (block 6634190) |
| fund(1) tx — 0.5 tMSTC | 0x9a04c4d9f47bc1babdc93d2ee33799a161fd0fdde6a7cfaedf38752503abacac (block 6634191) |
| refund(1) tx — 0.5 tMSTC returned | 0xd64105d11df29d1d0de8c68e550ffe72e30920803412d7a388ed445f471cdb9d (block 6634192) |
| Receipt verification | All 10 receipts status 0x1 via official Testnet RPC; contract bytecode verified on-chain. Explorer page fetch timed out and was not retried — verify visually at https://testnet.mstscan.com/tx/<hash>. |
| Live demo link | https://eres0045.github.io/safepay/app/ |
| Public GitHub repository (full source) | https://github.com/eres0045/safepay |
| Demo video (2–3 min) | TBD |
| Project PPT | Draft in `docs/safepay-pitch-deck.md` (this package) |
| Mainnet deployment details | TBD (organizer-provided funds) |

Submission deadline: **30 Oct 2026, 12:00 PM IST**.
Demo Day: **1 Nov 2026, 10:00–16:00 IST, MST office Pune** (top 15 teams,
in-person; top 15 announced evening of 30 Oct).

## Team

Ronit Shrimankar — solo builder.
