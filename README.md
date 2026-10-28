# SafePay — Freelance Escrow on MST Blockchain

MST Blockchain Buildathon 2.0, Round 2 MVP. A client locks payment on-chain;
funds release per milestone only after the client approves it; unreleased
funds refund to the client after the deadline. Real on-chain functionality —
no UI mocks, no simulated transactions.

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
| `releaseMilestone(escrowId, index)` | anyone | Pays an approved milestone to the freelancer; reverts if unapproved or already released |
| `refund(escrowId)` | client only, after deadline | Returns all still-unreleased funds to the client |
| `getEscrow(id)` / `getMilestone(id, index)` | anyone | Read state |

Events: `EscrowCreated`, `EscrowFunded`, `MilestoneApproved`,
`MilestoneReleased`, `EscrowRefunded`. Native currency only (tMSTC/MSTC).

## Tests (honest results, 28 Oct 2026)

- `npx hardhat compile` — **pass** (3 Solidity files).
- `npx hardhat test` — **6/6 passing**: create (+bad-input reverts), fund
  (exact-amount/client-once rules), approve+release (exact payment, no
  double-spend), refund (blocked pre-deadline, correct post-deadline),
  full e2e (create → fund → approve all → release all → escrow balance 0).
- Local-node e2e — **pass**: `hardhat node` + `deploy.js` + `interact.js`
  ran the full flow with real transactions on the local network
  (contract `0x5FbDB2315678afecb367f032d93F642f64180aa3`). NOTE: those
  transaction hashes are LOCAL-network only and must NOT be presented as
  testnet proof. Real Testnet proof (28 Oct 2026, Phase 2): contract
  `0xd330F3F7cD35FA2512592dCC0aD75381aF3798F5`, deploy tx
  `0x7843d0788f8781eda9cf665ad361382c0b42cca29d484ed6a6d3b14313e6d5a6`,
  plus 9 flow txs (create/fund/approve/release/refund) — all receipts
  status 0x1, blocks 6634177–6634192, verified via the official Testnet
  RPC. See `docs/project-documentation.md` for the full list.

## App shell

- `app/index.html` — static page (ethers v6 via CDN): connect injected
  wallet, switch/add MST Testnet (chain 91562037), create/fund/approve/
  release/refund, read escrow state, links each tx to testnet.mstscan.com.
- `app/abi.json` — generated from the compiled artifact
  (`node scripts/sync-abi.js` after compile).
- `scripts/deploy.js` — deploys and writes `deployments.json` (refuses to
  run with a zero-balance deployer). `scripts/interact.js` — full-flow CLI
  (create → fund → approve → release) with explorer links.

## Next steps (in order)

1. **Mainnet allocation form (due 28 Oct, 2:00 PM IST):** submit a wallet
   address in the Message body of https://mstblockchain.com/contact/
   (generic form, no dedicated wallet field — verified by parent). Either
   address above works; Ronit's own wallet is the natural choice.
2. **Fund the testnet deployer from the faucet** — DONE 28 Oct 2026
   (faucet claim solved by Ronit; 60 tMSTC verified on-chain).
3. `npx hardhat run scripts/deploy.js --network mstTestnet`, then
   `npx hardhat run scripts/interact.js --network mstTestnet` — DONE
   28 Oct 2026 (contract + 10 txs, receipts status 0x1, blocks
   6634177–6634192; explorer page fetch timed out, not retried —
   verify visually at testnet.mstscan.com).
4. Deploy the app shell (static host), record demo link, video, PPT, docs.
   NOTE (organizer announcement 28 Oct, via parent): submission is on
   Unstop + WhatsApp group share after Unstop submission; the demo video
   must show the deployment AND the working DApp with BridgeKey Wallet
   connected and interacting with the deployed contract.
5. **OPEN QUESTION for parent:** the original brief forbids Mainnet
   deployment now (organizer funds later), but the latest submission
   checklist mentions "Mainnet deployment details." Clarify whether the
   allocation-form address suffices for the 30 Oct noon submission, or a
   Mainnet deploy is expected before then.

## What was NOT done (per brief)

No Mainnet deployment. No submission anywhere (no GitHub publish, no form,
no video). No invented transaction hashes, addresses, or test results.
No private key in this README, in any report, or in any committed file.
