# SafePay — Freelance Escrow on MST Blockchain

MST Blockchain Buildathon 2.0, Round 2 MVP. A client locks payment on-chain;
funds release per milestone only after the client approves it. The freelancer
records delivery on-chain with proof; if delivered work is never approved,
the freelancer can claim it after the deadline instead of the client
refunding it away. Unapproved, undelivered funds refund to the client after
the deadline. Real on-chain functionality — no UI mocks, no simulated
transactions.

Live demo: https://eres0045.github.io/safepay/app/ · Public repo: https://github.com/eres0045/safepay

## Deadlines (confirmed by parent, 28 Oct 2026)

- **Round 2 submission: 30 Oct 2026, 12:00 PM IST (noon).** Must include:
  public GitHub repo (full source), live demo link, 2–3 min video, contract
  address, transaction hashes, project PPT, documentation, and Mainnet
  deployment details.
- **Demo Day: 1 Nov 2026, 10:00–16:00 IST, MST office Pune** (top 15 teams,
  in-person). Top 15 announced evening of 30 Oct.

## Networks (verified live, 28 Oct 2026)

| Network | RPC | Chain ID (live `eth_chainId` proof) | Symbol | Explorer |
| --- | --- | --- | --- | --- |
| MST Testnet | https://testnetrpc.mstblockchain.com | 91562037 (`0x5752035`) | tMSTC | https://testnet.mstscan.com |
| MST Mainnet | https://mariorpc.mstblockchain.com | 4646 (`0x1226`) | MSTC | https://mstscan.com |

## Toolchain findings (verified, not assumed)

- **MST is EVM-compatible.** Official docs state it ("EVM-compatible — works
  with standard Solidity contracts"), the docs' own example is Solidity
  `^0.8.24`, and both RPCs answer standard Ethereum JSON-RPC.
- **Vibe Kit scaffolder works.** `npx create-mst-app` (package
  `@mstblockchain/mst-vibe-kit` v0.1.1) generated a project in /tmp on this
  machine. Its template pins **Hardhat 2.22 + Toolbox 5** and pre-wires both
  networks (testnet 91562037, mainnet 4646) plus MSTScan verification
  endpoints. Caveat found: the default `npm i` pulled Hardhat 3, which is
  ESM-only and rejected this CommonJS project — the fix used here is the
  template's own pin (Hardhat 2.29 + Toolbox 5).
- **SDKs exist** (not yet wired in): `@mstblockchain/mst-sdk` v1.0.0 (TS),
  `mst-sdk-python` (PyPI). The scaffold uses Hardhat + ethers v6 directly,
  which is equivalent for deployment and interaction; the MST SDK can be
  adopted for the frontend later.
- **BridgeKey wallet** is the officially recommended wallet (bridgekey.io);
  the app shell uses generic injected-wallet (EIP-1193) calls, so BridgeKey
  works wherever MetaMask-style injection works.
- **Faucet claim flow NOT verifiable by text fetch.** Both
  https://faucet.mstblockchain.com (official, from the guide) and
  https://faucet.masterstroke.academy (from the announcement) render their
  claim forms in JavaScript, so no form fields, captcha status, or drip
  amounts could be read. Claiming needs a live-browser check or a manual
  claim by Ronit. This is the one human step gating testnet deployment.

## Wallets (addresses only — private keys are never printed or committed)

- **Fresh SafePay deployer wallet (generated 28 Oct 2026, Phase 1):**
  `0x79e5882a9cBF197EB14fA7E4cD3c704E2c12cb07`
  Verified: valid EVM address on BOTH chains (testnet balance 0, mainnet
  balance 0 — unfunded on both). Private key lives ONLY in
  `hidden_files/wallet.json` (mode 0600, gitignored via `.gitignore`).
  Use this address for the testnet faucet claim and as the testnet deployer.
- **Ronit's own wallet** (from parent context, independently re-verified here):
  `0x4903475C306A4E5Bf6cf19A4B8688f9c9475a3eC`
  Verified: `ethers.isAddress` true, EIP-55 checksum valid, balance 0 on both
  chains. This is the natural address for the Mainnet $MSTC allocation form
  (tokens land in his own wallet); the fresh wallet above is the fallback.
- **Are MST addresses EVM-style? YES.** Same 20-byte `0x` address format,
  same keypair → same address on Testnet and Mainnet (proven above: both
  addresses resolve with 0 balances on both chains). One address can be
  submitted for the Mainnet allocation form and used for testnet funding.

## Contract: `contracts/SafePayEscrow.sol` (Solidity 0.8.24, OpenZeppelin ReentrancyGuard)

| Function | Who | What |
| --- | --- | --- |
| `createEscrow(freelancer, amounts[], deadline)` | anyone (becomes client) | Creates escrow; milestones fixed at creation; reverts on zero freelancer, freelancer == client, empty/zero milestones |
| `fund(escrowId)` payable | client only | Locks exactly the milestone total; reverts on wrong amount, double fund, non-client |
| `approveMilestone(escrowId, index)` | client only | Marks a milestone approved (moves no funds) |
| `submitDelivery(escrowId, index, proof)` | freelancer only, before deadline | Records delivery on-chain with a proof link (moves no funds) |
| `releaseMilestone(escrowId, index)` | anyone | Pays an approved milestone to the freelancer; reverts if unapproved or already released |
| `claimDelivered(escrowId, index)` | freelancer only, after deadline | Pays a milestone delivered before the deadline but never approved — the anti-ghosting path |
| `refund(escrowId)` | client only, after deadline | Returns only unapproved, undelivered funds to the client; approved and delivered funds are LOCKED and cannot be refunded away |
| `getEscrow(id)` / `getMilestone(id, index)` | anyone | Read state (milestone reads include delivered flag + proof) |

Events: `EscrowCreated`, `EscrowFunded`, `MilestoneApproved`,
`MilestoneDelivered`, `MilestoneReleased`, `EscrowRefunded`. Native currency only (tMSTC/MSTC).

## Tests (honest results, 28 Oct 2026)

- `npx hardhat compile` — **pass**.
- `npx hardhat test` — **11/11 passing**: the original 6 (create, bad-input
  reverts, fund rules, approve+release, refund, full e2e) plus 5 v2 tests
  (delivery rules + proof, delivery rejected pre-funding and post-deadline,
  deadline-claim without approval, refund lock partial + full).
- Local-node e2e — **pass** (v1, local network only — local hashes must NOT
  be presented as testnet proof).
- Testnet proof v2 (28 Oct 2026): contract
  `0x40854b8c2436504FFB30Ac89298Da24eC434a905`, deploy tx
  `0x6e52a3661e5a044893ce16153c6005458f9b5ea15f953d3fb78e6ead8a185fde`.
  Full v2 flow verification (approve/release, delivery + deadline-claim,
  refund, refund-lock) was running on Testnet at last edit; flow hashes are
  appended to `docs/project-documentation.md` on completion.
- Testnet proof v1 (superseded 28 Oct 2026): contract
  `0xd330F3F7cD35FA2512592dCC0aD75381aF3798F5`, deploy tx
  `0x7843d0788f8781eda9cf665ad361382c0b42cca29d484ed6a6d3b14313e6d5a6`,
  plus 9 flow txs — all receipts status 0x1, blocks 6634177–6634192,
  verified via the official Testnet RPC. See `docs/project-documentation.md`.

## Relayer (gasless, Phase 1 — LIVE on MST Testnet, 29 Oct 2026)

Users sign their escrow action (EIP-712); a relayer service submits it and
pays the gas, so users never manage gas manually. Built on OpenZeppelin
ERC-2771: `contracts/SafePayForwarder.sol` (thin wrapper over
`ERC2771Forwarder`, domain name "SafePayForwarder", version "1") +
`contracts/SafePayEscrow.sol` now inherits `ERC2771Context`, so
`_msgSender()` returns the ORIGINAL signer — every onlyClient /
onlyFreelancer check still sees the real user, never the relayer. Direct
calls are unchanged (off the forwarder path, `_msgSender() == msg.sender`),
and all 11 original tests still pass.

- **Testnet (verified on-chain via the official RPC):**
  forwarder `0x1Eb5bB559Dee94548e28c12Ae36105405BA209f9`
  (deploy tx `0x6f4ce8a2add178c40a18989c1d8466ef2eb8a6c9e4254c6b2906e62db81409c8`),
  relayer-enabled escrow `0xd75e0774942E0eC755f4caccD5eEdb3e216c3d6d`
  (deploy tx `0x5de277b989169f3156d06e43a16088581d376ff5e2d9c49bbc443195941a0dde`).
  The v2 contract (`0x40854b…a905`) is untouched and still live.
- **Tests:** `npx hardhat test` — **18/18 passing** (11 original + 7 new
  relayer e2e: approve, delivery, create, deadline-claim, release, refund,
  and a security test covering forged signatures, replay, and direct
  spoofing). Testnet e2e (`scripts/relayer-e2e-testnet.js`) and HTTP
  service smoke test (`scripts/relayer-http-smoke.js`) both pass with
  real Testnet txs — see `docs/relayer.md` for hashes and balances.
- **Service:** `relayer/relayer-server.js` — `POST /relay` validates
  (escrow-only target, zero value, gas cap, future deadline,
  `forwarder.verify()`), then submits and pays gas. It runs on demand
  (not hosted 24/7); run it with `RELAYER_PRIVATE_KEY` set (fund the key
  with a small amount of tMSTC only). Funding is never relayed:
  value-bearing requests are refused, because moving a user's own escrow
  funds through a third party would defeat the escrow.
- **HONEST STATUS:** Phase 1 (standalone relayer) is complete and proven
  on Testnet. Phase 2 (gasless path inside the live demo app) is ON HOLD
  pending user review — the demo app still shows the direct v2 flow only.
  The Unstop submission (29 Oct 2026) describes the pre-relayer package;
  whether it and the Google Form should mention the relayer is a
  submission-time decision, not something this change makes by itself.

## App (live demo: https://eres0045.github.io/safepay/app/)
- `app/index.html` — static page (ethers v6 via CDN): connect BridgeKey /
  injected wallet, switch/add MST Testnet (chain 91562037), pre-filled
  Testnet contract address, create/fund/approve/release/refund, freelancer
  delivery + deadline-claim, read escrow state with per-milestone status
  (approved/released/delivered/proof), "My escrows" dashboard, links each
  tx to testnet.mstscan.com.
- `app/abi.json` — generated from the compiled artifact
  (`node scripts/sync-abi.js` after compile).
- `scripts/deploy.js` — deploys and writes `deployments.json` (refuses to
  run with a zero-balance deployer). `scripts/interact.js` — full-flow CLI
  (approve/release, delivery + deadline-claim, refund, refund-lock) with
  explorer links.

## Next steps (in order)

1. **Mainnet allocation — REQUEST MSTC modal SUBMITTED 28 Oct 2026, 12:36 IST**
   (repo https://github.com/eres0045/safepay, wallet
   `0x4903475C306A4E5Bf6cf19A4B8688f9c9475a3eC`, 500 coins, confirmed
   "Request submitted successfully!"). Tokens not yet distributed —
   Mainnet deploy waits on them.
2. **Demo video (2–3 min, pending):** must show the deployment AND the
   working DApp with BridgeKey Wallet connected and interacting with the
   deployed contract.
3. **Submission (due 30 Oct 2026, 12:00 PM IST):** Unstop form (video
   upload, repo link, demo URL, description) + WhatsApp group share after
   Unstop submission. Pre-submit checkpoint with Ronit before submitting.
4. **OPEN QUESTION for parent:** Mainnet deploy is mandatory per the
   guide, but tokens have not arrived; if they do not arrive before the
   deadline, the submission states Mainnet pending with the allocation
   form submitted.

## What was NOT done (per brief)

No Mainnet deployment (waiting on organizer tokens). No demo video yet.
No Unstop submission yet. No invented transaction hashes, addresses, or
test results. No private key in this README, in any report, or in any
committed file.
