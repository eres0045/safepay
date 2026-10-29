# SafePay Relayer (gasless) — Phase 1 proof

Organizers announced (29 Oct 2026) that relayer integration is a BONUS
point during evaluation: users should not have to manage gas manually.
This document is the Phase 1 record: forwarder + meta-transaction-aware
escrow + relayer service + end-to-end tests, deployed and verified on MST
Testnet. Phase 2 (gasless path inside the live demo app) is DONE as of
29 Oct 2026 (see below) — the demo app now offers both paths, direct
still the default.

## Design

```
user signs EIP-712 ForwardRequest  ──►  relayer service (POST /relay)
   (from, to=escrow, value=0, gas,        validates, submits
    nonce, deadline, data, signature)        forwarder.execute()
                                                    │
                                        SafePayForwarder appends
                                        signer address to calldata
                                                    │
                                        SafePayEscrow (ERC2771Context)
                                        _msgSender() == original signer
                                        ──► state changes, events name
                                            the real user, never relayer
```

- Contracts: `contracts/SafePayForwarder.sol` (thin wrapper over
  OpenZeppelin `ERC2771Forwarder`, EIP-712 domain name
  "SafePayForwarder", version "1") and `contracts/SafePayEscrow.sol`
  (now `ReentrancyGuard, ERC2771Context`; trusted forwarder set once in
  the constructor, immutable; every `msg.sender` in access checks and
  events replaced with `_msgSender()`).
- Why this preserves the security model: the escrow's client/freelancer
  checks read `_msgSender()`. Off the forwarder path that equals
  `msg.sender` (the direct v2 flow is byte-for-byte the same behavior).
  On the forwarder path, the forwarder guarantees the appended address
  equals the EIP-712 signer, and the escrow trusts exactly one forwarder.
  A relayer cannot act as someone else: a forged or tampered request
  fails `verify()` and reverts; a spent nonce cannot replay.
- Relayer service: `relayer/relayer-server.js` (plain Node + ethers v6,
  no new dependencies). `POST /relay` enforces, in order: target must be
  exactly the configured escrow; value must be 0; gas ≤ cap (default
  500,000); deadline in the future; `forwarder.verify()` true. Only then
  it submits and pays gas from `RELAYER_PRIVATE_KEY`.
- Deliberate limits (honest, not bugs):
  - Funding is never relayed. `fund()` moves the user's own money; a
    relayer fronting it would be a custodial payment, not gasless UX.
    Fund stays a direct call; create/approve/deliver/claim/release/
    refund can all be relayed.
  - The service runs on demand (e.g. `node relayer/relayer-server.js`);
    it is not hosted 24/7 anywhere. The demo frontend (Phase 2) will
    point at a configurable relayer URL.
  - The relayer key should hold only a small amount of tMSTC; it can
    only ever lose gas, never escrow funds, because payouts go to the
    recorded client/freelancer only.

## Testnet deployment (29 Oct 2026, verified via official Testnet RPC)

| Item | Address / hash |
| --- | --- |
| SafePayForwarder | `0x1Eb5bB559Dee94548e28c12Ae36105405BA209f9` |
| Forwarder deploy tx | `0x6f4ce8a2add178c40a18989c1d8466ef2eb8a6c9e4254c6b2906e62db81409c8` |
| SafePayEscrow (relayer-enabled) | `0xd75e0774942E0eC755f4caccD5eEdb3e216c3d6d` |
| Escrow deploy tx | `0x5de277b989169f3156d06e43a16088581d376ff5e2d9c49bbc443195941a0dde` |
| Explorer | https://testnet.mstscan.com/address/0xd75e0774942E0eC755f4caccD5eEdb3e216c3d6d |

The v2 contract (`0x40854b8c2436504FFB30Ac89298Da24eC434a905`) is
untouched and still live; `deployments.json` keeps both entries
(`mstTestnet` = v2, `mstTestnetRelayer` = relayer stack).

## Test evidence

- `npx hardhat test` — **18/18 passing**: 11 original escrow tests
  (direct path unchanged) + 7 relayer tests (approve, delivery with
  event-actor proof, create, deadline-claim, release, refund, and a
  security test: forged signature reverts, replay reverts, direct
  spoofing still blocked).
- `npx hardhat run scripts/relayer-e2e-testnet.js --network mstTestnet`
  — **all assertions passed** on real Testnet: fresh client/freelancer/
  relayer wallets; create → fund (direct) → deliver → approve → release
  all via the relayer except funding. Relayed txs:
  create `0xe6da8a0ba2831c90c3fa7684b69c9f9863b5d089bc4b1c2b6a44a13125702e86`,
  deliver `0xb912d887850e4bf9b7e951605e3759c36e41ce0f0da7a8a099e9d171365ed3a4`,
  approve `0x004b5ef3b2e592dcb1cd89ccde07da319d064e1ab36b4d378ea7acf9afe601bb`,
  release `0x688ef86bd163fcbe4e29eaba77aafdc0be7983c9420dc9f2c62c86b395e31f91`.
  Final on-chain state (read back independently): escrow 0 funded 1.0,
  released 0.6, balance 0.4; freelancer balance exactly 0.6 (started at
  0, paid zero gas); client balance unchanged across all relayed calls;
  relayer balance decreased (paid the gas).
- `node scripts/relayer-http-smoke.js` — **all assertions passed**: the
  HTTP service approved milestone 1 of escrow 0 on Testnet
  (tx `0x7e6fd246add68ee5272105a7e0e011e3a5eeed366d871ad961bfd1d1ca5f978c`,
  block 6669299, status 1) and refused a non-escrow target with 400.
- Toolchain note: Hardhat's default EVM target resolved to Paris, but
  OpenZeppelin v5 metatx utils use MCOPY (Cancun). `hardhat.config.js`
  now pins `evmVersion: 'cancun'`. Testnet execution of relayed calls
  proves the chain accepts this target.

## Run it

```sh
# Contracts + local tests
npx hardhat compile
npx hardhat test

# Deploy relayer stack to Testnet (deployer key from hidden_files/wallet.json)
npx hardhat run scripts/deploy-relayer.js --network mstTestnet

# On-chain e2e (fresh throwaway test wallets, keys to hidden_files/ only)
npx hardhat run scripts/relayer-e2e-testnet.js --network mstTestnet

# Relayer service (needs a funded key; testnet only, small amount)
RELAYER_PRIVATE_KEY=<relayer key> node relayer/relayer-server.js
# -> GET /health, GET /config, POST /relay { request }

# HTTP smoke test against Testnet (spawns the server itself)
node scripts/relayer-http-smoke.js
```

Frontend signing note (for Phase 2): the signed request's BigInt fields
(value, gas, nonce, deadline) must be converted to Numbers before
`JSON.stringify` — plain `JSON.stringify` throws on BigInt. The server
converts them back with `BigInt()`.

## Phase 2 — gasless path in the demo app (DONE 29 Oct 2026)

- `app/index.html`: a Direct / Gasless mode switch (section 2). Direct
  is the default and is behavior-identical to before (v2 contract,
  `app/abi.json`). Gasless switches the contract address to the relayer
  escrow and the ABI to `app/abi-relayer.json` (generated from the
  compiled artifact via `node scripts/sync-relayer-abi.js`; the only
  differences from the v2 ABI are `trustedForwarder` /
  `isTrustedForwarder`), shows a relayer URL field (default
  `http://localhost:3001`, editable) + forwarder field + "Check relayer
  status" (`GET /health`), and adds a "(gasless)" button next to every
  relayable action: create, approve, release, deliver, claim, refund.
  Fund has no gasless button, by design. The page signs an EIP-712
  ForwardRequest with the connected wallet (`signer.signTypedData`,
  domain "SafePayForwarder" / "1", types identical to `relayer/signing.js`)
  and POSTs the JSON request to the relayer, then shows the relayed tx
  hash + explorer link and fills in the new escrow id on create.
- `test/FrontendSigning.test.js` (6 tests): the page's EIP-712 type,
  domain, forwarder/escrow addresses, and v2-default are asserted equal
  to `relayer/signing.js` + `relayer/addresses.json` (drift guards);
  gasless buttons exist for every relayable action and none for fund;
  and the frontend's exact JSON payload shape (Numbers, not BigInts)
  verifies + executes on Hardhat with the signer recorded as actor.
- `scripts/relayer-frontend-shape-test.js`: full HTTP-path test through
  the real server on a local node (`npx hardhat node`, then
  `npx hardhat run scripts/relayer-frontend-shape-test.js --network
  localhost`). Relayed create → direct fund → relayed deliver → relayed
  approve → relayed release, plus value-bearing and wrong-target
  refusals; final assertion is freelancer gains exactly 0.6 having paid
  zero gas (relative assertion, so it passes on fresh or reused nodes).
  Result: ALL PASSED, twice in a row on a reused node.
- App verification (29 Oct 2026): extracted page JS passes
  `node --check`; every `$('...')` id exists in the HTML; both ABIs are
  valid JSON; the served page returns 200 for `index.html` and
  `abi-relayer.json`; the default contract is still the v2 address.
  NOT verified: a live browser-wallet click-through of the gasless
  buttons (no wallet automation exists here) — first live click should
  be a judge's or Ronit's own, with the service running.

### Relayer hardening: the 250ms request-cache stale nonce (found + fixed)

Load testing caught a real failure: the 3rd rapid relay failed with a
stale nonce ("expected 2 but got 1"), while the node log showed NO fresh
count query for it. Root cause, proven with debug logging: ethers v6
`JsonRpcProvider` deduplicates identical low-level requests made within
250ms (`cacheTimeout`, in `AbstractProvider.#perform`). A pending-count
query made <250ms after the previous relay returned the CACHED count
(1 instead of 2), so the next transaction reused a nonce. It flipped
between runs purely on timing, which is why one full run passed and the
next failed at the same step. Fix: the server creates its provider with
`cacheTimeout: -1` (documented provider option; -1 disables the cache),
so every nonce query hits the network. Submissions are additionally
serialized through a promise queue, each using an explicitly queried
pending nonce. The demo page needs no equivalent change: human clicks are
seconds apart, far outside the 250ms window.

### Judge runbook: try the gasless path yourself

```bash
# 1. Start the relayer (fund its key with a small amount of tMSTC only)
RELAYER_PRIVATE_KEY=<relayer key> node relayer/relayer-server.js
# -> listening on :3001; check GET http://localhost:3001/health

# 2. Open the demo (serve app/ or use the Pages deployment once pushed),
#    connect BridgeKey, switch to MST Testnet, pick "Gasless via relayer"
#    in section 2, confirm the relayer status, then:
#    Create (gasless) -> Fund (direct, exact total) -> Deliver (gasless)
#    -> Approve (gasless) -> Release (gasless).
#    Each gasless step shows a relayed tx hash; you pay no gas for them.
```

The service runs on demand, not hosted 24/7 — for a judged demo, start it
first (or point the page's relayer URL at a running instance).

## What remains before the submission can claim the relayer

1. Submission-time decision (parent + user): update the Unstop entry
   (submitted 29 Oct 2026, pre-relayer) via Change Submission before the
   30 Oct 2026, 2:00 PM IST deadline, and mention the relayer in the
   Google Form. Any claim must name the relayer escrow address
   (`0xd75e…c3d6d`) for the gasless path (not the v2 address) and must
   say the service runs on demand, not 24/7.
2. Mainnet: untouched. A mainnet relayer stack needs organizer MSTC
   first, same as the mainnet escrow itself.

## Secrets

No private key appears in this repo, in any report, or in any committed
file. Testnet throwaway wallets live only in `hidden_files/`
(gitignored, mode 0600). The deployer key lives only in
`hidden_files/wallet.json` (gitignored, mode 0600).

## Round 2 video update (29 Oct 2026) — gasless segment spliced into the demo video

- Segment recorded with `scripts/record-gasless-video.js` (locally served Phase 2 app,
  injected test wallet, real relayer service on port 3001, real MST Testnet):
  switch to Gasless mode -> "Relayer OK" (chain 91562037, forwarder, relayer escrow,
  relayer balance) -> Approve milestone (gasless) on relayer escrow 2 ->
  page shows "Relayed: 0xfb844dac66a1644240254a376cd4087d095697301057812b30e660654f15181d"
  -> Read escrow shows milestone 0 approved: true.
- On-chain verification of that relayed tx (direct RPC): status 1, from the relayer
  (0x3310Cfab1ac9dE2A348169E8A517B1C542244C1D), to the forwarder, block 6669810.
  The signing user's Testnet balance was identical before and after (delta exactly 0)
  — the user paid no gas.
- Final video: original 0..144.55s + gasless segment (~23.2s, captioned
  "NEW - Gasless mode: user signs, relayer submits and pays the gas", narrated with
  the same Fish Audio voice) + closing card, first 10s (full closing narration kept).
  Total 178.1s (2:58) at 1280x800, h264+aac — inside the 2-3 min requirement.
  Verified by thumbnails at intro, base, Relayer OK, relayed tx, approved read-back,
  and closing card, plus silence detection showing narration in the gasless and
  closing windows. Splice script: `scripts/splice-relayer-video.sh`.
- Honest limits, unchanged from Phase 2: the wallet on camera is an injected test
  wallet, NOT BridgeKey extension UI; the relayer service runs on demand, not 24/7;
  funding stays direct-only. The pre-relayer video is backed up in the harness dir.
