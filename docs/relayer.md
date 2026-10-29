# SafePay Relayer (gasless) — Phase 1 proof

Organizers announced (29 Oct 2026) that relayer integration is a BONUS
point during evaluation: users should not have to manage gas manually.
This document is the Phase 1 record: forwarder + meta-transaction-aware
escrow + relayer service + end-to-end tests, deployed and verified on MST
Testnet. Phase 2 (gasless path inside the live demo app) is ON HOLD
pending user review — nothing in `app/` was changed for the relayer.

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

## What remains before the submission can claim the relayer

1. User review of this Phase 1 proof (this document + the txs above).
2. Phase 2 (only on user go): gasless buttons in `app/index.html`
   wired to a relayer URL, defaulting to the relayer-enabled escrow
   address, with the direct v2 path kept intact.
3. Submission-time decision (parent + user): whether the Unstop entry
   (submitted 29 Oct 2026, pre-relayer) gets a Change Submission update
   and whether the Google Form mentions the relayer. The relayer stack
   is live and proven either way; the claim must name the new escrow
   address (`0xd75e…c3d6d`), not the v2 address, for the gasless path.
4. Mainnet: untouched. A mainnet relayer stack needs organizer MSTC
   first, same as the mainnet escrow itself.

## Secrets

No private key appears in this repo, in any report, or in any committed
file. Testnet throwaway wallets live only in `hidden_files/`
(gitignored, mode 0600). The deployer key lives only in
`hidden_files/wallet.json` (gitignored, mode 0600).
