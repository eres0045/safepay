// SafePay relayer service: accepts a signed ERC-2771 meta-transaction and
// submits it on-chain, paying the gas from the relayer key.
//
//   RELAYER_RPC            JSON-RPC URL (default: MST Testnet)
//   RELAYER_FORWARDER      SafePayForwarder address (default: relayer/addresses.json)
//   RELAYER_ESCROW         relayer-enabled SafePayEscrow address (default: relayer/addresses.json)
//   RELAYER_PRIVATE_KEY    relayer key — REQUIRED, never logged, never committed
//   RELAYER_PORT           default 3001
//   RELAYER_MAX_GAS        max gas a single request may ask for (default 500000)
//
// Endpoints:
//   GET  /health  -> chain, forwarder, escrow, relayer address + balance
//   GET  /config  -> chainId, forwarder, escrow (for the demo frontend)
//   POST /relay   -> { request: {from,to,value,gas,deadline,data,signature} }
//                    validates, submits, returns {txHash, explorerUrl, blockNumber, status}
//
// Safety rules (all enforced before any submission):
//   1. `to` must be exactly the configured escrow contract — the relayer
//      never executes arbitrary calls on behalf of signers.
//   2. `value` must be 0 — funding moves a user's own escrow money and is
//      never relayed; fund() stays a direct, user-paid call.
//   3. `gas` must be <= RELAYER_MAX_GAS (bounds griefing).
//   4. `deadline` must be in the future.
//   5. forwarder.verify(request) must be true (signature + nonce + trust).
// The relayer pays only gas; it can never move funds, because the escrow
// only pays the recorded client/freelancer and _msgSender() is the signer.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { forwarderContract, toTuple } = require('./signing');

const RPC = process.env.RELAYER_RPC || 'https://testnetrpc.mstblockchain.com';
const EXPLORER = process.env.RELAYER_EXPLORER || 'https://testnet.mstscan.com';
const PORT = Number(process.env.RELAYER_PORT || 3001);
const MAX_GAS = BigInt(process.env.RELAYER_MAX_GAS || 500000);

let defaults = {};
try {
  defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'addresses.json'), 'utf8'));
} catch { /* no addresses file yet — env vars required */ }

const FORWARDER = process.env.RELAYER_FORWARDER || defaults.forwarder;
const ESCROW = process.env.RELAYER_ESCROW || defaults.escrow;
const KEY = process.env.RELAYER_PRIVATE_KEY;

if (!FORWARDER || !ESCROW) {
  console.error('Missing forwarder/escrow addresses: set RELAYER_FORWARDER + RELAYER_ESCROW or deploy first (see relayer/addresses.json).');
  process.exit(1);
}
if (!KEY) {
  console.error('RELAYER_PRIVATE_KEY is required (fund it with a small amount of tMSTC only).');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
// NOTE: ethers v6 providers deduplicate identical low-level requests made
// within 250ms (cacheTimeout). That is fatal for a relayer: a pending-count
// query made <250ms after the previous relay returns the STALE count and
// the next transaction reuses a nonce (this exact failure was reproduced
// in load testing: the 3rd rapid relay failed with a stale nonce while
// the node log showed no fresh count query). cacheTimeout: -1 disables
// the cache for this provider, so every nonce query hits the network.
const relayer = new ethers.Wallet(KEY, provider);
const forwarder = forwarderContract(FORWARDER, relayer);

// Serialize relay submissions through a promise queue. The relayer wallet
// must never send two transactions with the same nonce, even under rapid
// sequential requests: each submission queries the pending count fresh
// and passes it explicitly, instead of relying on implicit population.
// (A load test once produced a stale-nonce send on the 3rd rapid relay
// against a local automining node; the queue + explicit nonce removes
// that class of failure entirely.)
let submitQueue = Promise.resolve();

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  try {
    if (req.method === 'GET' && req.url === '/health') {
      const [chainId, bal] = [Number((await provider.getNetwork()).chainId), await provider.getBalance(relayer.address)];
      return json(res, 200, { ok: true, chainId, forwarder: FORWARDER, escrow: ESCROW, relayer: relayer.address, relayerBalance: ethers.formatEther(bal) });
    }
    if (req.method === 'GET' && req.url === '/config') {
      const chainId = Number((await provider.getNetwork()).chainId);
      return json(res, 200, { chainId, forwarder: FORWARDER, escrow: ESCROW });
    }
    if (req.method === 'POST' && req.url === '/relay') {
      const { request } = await readBody(req);
      if (!request || !request.from || !request.to || !request.data || !request.signature) {
        return json(res, 400, { error: 'missing request fields' });
      }
      if (request.to.toLowerCase() !== ESCROW.toLowerCase()) {
        return json(res, 400, { error: 'relayer only executes calls to the configured SafePay escrow' });
      }
      if (BigInt(request.value) !== 0n) {
        return json(res, 400, { error: 'value-bearing requests are refused (funding is never relayed)' });
      }
      if (BigInt(request.gas) > MAX_GAS) {
        return json(res, 400, { error: `requested gas exceeds relayer cap ${MAX_GAS}` });
      }
      const now = (await provider.getBlock('latest')).timestamp;
      if (Number(request.deadline) <= now) {
        return json(res, 400, { error: 'request deadline expired' });
      }
      const ok = await forwarder.verify(toTuple(request));
      if (!ok) {
        return json(res, 400, { error: 'forwarder verification failed (bad signature, stale nonce, or expired request)' });
      }
      const run = submitQueue.then(async () => {
        const nonce = await provider.getTransactionCount(relayer.address, 'pending');
        const tx = await forwarder.execute(toTuple(request), { nonce });
        const receipt = await tx.wait();
        return { tx, receipt };
      });
      // Keep the queue alive after a failure so later requests still run.
      submitQueue = run.catch(() => {});
      const { tx, receipt } = await run;
      console.log(`relayed from=${request.from} tx=${tx.hash} status=${receipt.status}`);
      return json(res, 200, {
        txHash: tx.hash,
        explorerUrl: `${EXPLORER}/tx/${tx.hash}`,
        blockNumber: receipt.blockNumber,
        status: receipt.status,
      });
    }
    return json(res, 404, { error: 'unknown route' });
  } catch (e) {
    console.error('relay error:', e.shortMessage || e.message);
    return json(res, 500, { error: e.shortMessage || e.message });
  }
});

server.listen(PORT, () => {
  console.log(`SafePay relayer listening on :${PORT} (relayer=${relayer.address}, escrow=${ESCROW})`);
});
