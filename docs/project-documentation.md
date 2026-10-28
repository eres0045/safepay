# SafePay — Project Documentation (DRAFT)

> **Draft only — not submitted.** Testnet values in the submission table
> are real, verified on-chain values (28 Oct 2026). Remaining **TBD**s
> (video, Mainnet) must be filled in only with real,
> verified values when they exist. Nothing in this document
> is published, submitted, or deployed.

## Description

SafePay is a freelance escrow built on MST Blockchain. A client locks payment
on-chain for a freelancer across fixed milestones. Funds release per milestone
only after the client approves it. The freelancer records delivery on-chain
with proof; delivered-but-unapproved work can be claimed by the freelancer
after the deadline, so a ghosting client cannot refund it away. Only
unapproved, undelivered funds return to the client after the deadline.
The blockchain itself holds the money — no middleman, no
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
| Deploy tx (v2) | 0x6e52a3661e5a044893ce16153c6005458f9b5ea15f953d3fb78e6ead8a185fde (block 6636444) |
| fundFreelancerWallet — 0.3 tMSTC gas | 0xba5e49024bb5a10df6e32a66133fea0cffcc584d7c1d52d55f8337476cb145a0 (block 6636453) |
| createEscrow(0) tx | 0xf858ba38563de2bb63557444afb0fbad89673e0af621fba969e474e5f950cc3c (block 6636454) |
| fund(0) tx — 1.0 tMSTC | 0x9fa2ecc82171bb83f24c762faed7da34dc908d07759eb11fa468f42415bc82ef (block 6636455) |
| approveMilestone(0,0) tx | 0x6c66730ff8a957e7deb2d7bbf2037aab767ee140289cec5f31cbd9c0d62ebddb (block 6636456) |
| releaseMilestone(0,0) tx — 0.6 tMSTC paid | 0x0ad76f8200adebc9706dbfe5e1acefbc1af6bf75a15f41aa2831ada0ce903a91 (block 6636457) |
| approveMilestone(0,1) tx | 0x0092e15702275a5f3739695f7d95e89cf7d791820f49b01269b01fbe8e6317b5 (block 6636458) |
| releaseMilestone(0,1) tx — 0.4 tMSTC paid | 0x5e95af131e29c98b2585e476d96f9740a220b8e94caa57a67f23f8de5db9aef4 (block 6636459) |
| createEscrow(1) tx — refund path | 0x063ada4f597a54965720657f850a8aabc8db4da80483006e05ee9b243fe3a65a (block 6636460) |
| fund(1) tx — 0.5 tMSTC | 0x233281aec91bd9506944af7089cadb7b1948ef263b5dbb741ade340d73754b1c (block 6636461) |
| refund(1) tx — 0.5 tMSTC returned | 0xc136c1b9fdfc75eae0f4da53ac3d715c8f073c663e09f9bf273190305ed94fa2 (block 6636462) |
| createEscrow(2) tx — delivery path | 0x20d7b3786e2b735ee0bb5370d457147019d6cf0ffe7327883187e93d61828322 (block 6636463) |
| fund(2) tx — 0.5 tMSTC | 0x634636255f5a43de502152500be599bdd31e38bf0d8b2fc5207c7b64bc795e61 (block 6636464) |
| submitDelivery(2,0) tx | 0x26fbc6190634d8a187c78bf891857ee40a21ef1a0bd119a77f9fc55c0fc47352 (block 6636465) |
| createEscrow(3) tx — refund-lock path | 0xc5693a6e957d67e7e220a336eee2d6d29d5e2bc1b07dcf735bd3b4e838d073f1 (block 6636466) |
| fund(3) tx — 1.6 tMSTC | 0xb5783109d7d65ff422a0adf9006e032003237f5df6137d99cca808a7b9f942ca (block 6636467) |
| submitDelivery(3,1) tx | 0xa2d2d116d5276b2b07bf5b5884251e2b5d7ca0b3bc1cc297bd9968f2acd91a5a (block 6636468) |
| approveMilestone(3,0) tx | 0x7c8155647ea58295dde6279a8b5cef32cd5145a5501915c3beb4a4ef65f7110d (block 6636469) |
| releaseMilestone(3,0) tx — 0.6 tMSTC paid | 0x40d585b97fb26a9ebd4fa54e3f4492496d19eb55871bbb4a28c43c3538c2a2fb (block 6636470) |
| claimDelivered(2,0) tx — 0.5 tMSTC claimed, no approval | 0x79687f07a2c5d330aa1a63d4baddb8c9971aa78911895a226688b7d1b22ce7a7 (block 6636517) |
| refund(3) tx — 0.6 tMSTC returned (delivered 0.4 LOCKED, not swept) | 0x043afd53052c8475c176090d8499d56f1981b6537623ed8d4f98f33cd5d23962 (block 6636518) |
| claimDelivered(3,1) tx — 0.4 tMSTC claimed | 0x1b6de3266d7b0cd1beb9e32fb4b811d5e990cce515f87598e606e5206eb0796f (block 6636519) |
| Receipt verification (v2) | All 22 receipts (deploy + 21 flows) status 0x1 via official Testnet RPC; bytecode verified (18888 chars); final states re-read on-chain (escrow 0: 1.0/1.0; escrow 1: refunded 0.5/0.5; escrow 2: 0.5 claimed; escrow 3: released 1.0, refunded 0.6, total 1.6). Explorer page fetch timed out once and was not retried — verify visually at https://testnet.mstscan.com/tx/<hash>. |
| v1 flows (superseded contract 0xd330F3F7cD35FA2512592dCC0aD75381aF3798F5) | Deploy 0x7843d0788f8781eda9cf665ad361382c0b42cca29d484ed6a6d3b14313e6d5a6 (block 6634177) + 9 flow txs, blocks 6634184–6634192, all receipts status 0x1 (full hashes in git history). |
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
