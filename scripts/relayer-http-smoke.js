// Smoke test for the relayer SERVICE over HTTP, on MST Testnet.
// Spawns relayer/relayer-server.js as a child process, signs a real
// approveMilestone meta-transaction with a test client key, POSTs it to
// /relay, and verifies the on-chain effect. This proves the HTTP service
// path — not just the in-process contract calls used by relayer-e2e.
// Usage: node scripts/relayer-http-smoke.js
// Requires: relayer/addresses.json (deployed stack) and
// hidden_files/relayer-testnet.json (throwaway test wallets from the e2e).
// Prints addresses, balances and tx hashes — never private keys.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { signForwardRequest, forwarderContract, toTuple } = require('../relayer/signing');

const ROOT = path.join(__dirname, '..');
const PORT = 3001;
const URL = `http://127.0.0.1:${PORT}`;

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ok: ${msg}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${URL}/health`);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error('relayer server did not become healthy');
}

async function main() {
  const addrs = JSON.parse(fs.readFileSync(path.join(ROOT, 'relayer', 'addresses.json'), 'utf8'));
  const wallets = JSON.parse(fs.readFileSync(path.join(ROOT, 'hidden_files', 'relayer-testnet.json'), 'utf8'));
  const provider = new ethers.JsonRpcProvider('https://testnetrpc.mstblockchain.com');
  const forwarder = forwarderContract(addrs.forwarder, provider);
  const escrow = new ethers.Contract(addrs.escrow,
    ['function getMilestone(uint256,uint256) view returns (uint256,bool,bool,bool,string)'], provider);
  const client = new ethers.Wallet(wallets.client.privateKey, provider);

  const server = spawn(process.execPath, [path.join(ROOT, 'relayer', 'relayer-server.js')], {
    env: {
      ...process.env,
      RELAYER_PORT: String(PORT),
      RELAYER_RPC: 'https://testnetrpc.mstblockchain.com',
      RELAYER_FORWARDER: addrs.forwarder,
      RELAYER_ESCROW: addrs.escrow,
      RELAYER_PRIVATE_KEY: wallets.relayer.privateKey,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOut = '';
  server.stdout.on('data', (d) => { serverOut += d; });
  server.stderr.on('data', (d) => { serverOut += d; });

  try {
    const health = await waitHealth();
    console.log(`Server healthy: chain=${health.chainId} relayer=${health.relayer} balance=${health.relayerBalance} tMSTC`);
    assert(health.forwarder.toLowerCase() === addrs.forwarder.toLowerCase(), 'server serves the deployed forwarder');
    assert(health.escrow.toLowerCase() === addrs.escrow.toLowerCase(), 'server serves the deployed escrow');

    // Approve milestone 1 of escrow 0 (untouched by the earlier e2e) via HTTP.
    const iface = new ethers.Interface(['function approveMilestone(uint256,uint256)']);
    const data = iface.encodeFunctionData('approveMilestone', [0, 1]);
    const request = await signForwardRequest({ forwarder, user: client, to: addrs.escrow, data });
    assert(await forwarder.verify(toTuple(request)), 'forwarder verifies the HTTP-bound request');

    // BigInts do not JSON-serialize: value/gas/nonce/deadline are all
    // small enough to send as Numbers (the server BigInt()s them back).
    // (The browser frontend must do the same conversion before POSTing.)
    const jsonRequest = JSON.stringify({ request },
      (k, v) => (typeof v === 'bigint' ? Number(v) : v));
    const res = await fetch(`${URL}/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonRequest,
    });
    const body = await res.json();
    console.log(`POST /relay -> HTTP ${res.status}:`, JSON.stringify(body));
    assert(res.status === 200, 'server accepted the relay');
    assert(body.status === 1, 'relay receipt status 1');
    assert(/^0x[0-9a-f]{64}$/.test(body.txHash), 'server returned a tx hash');
    console.log(`  relay tx: https://testnet.mstscan.com/tx/${body.txHash}`);

    const m1 = await escrow.getMilestone(0, 1);
    assert(m1[1] === true, 'milestone 1 approved on-chain via the HTTP relayer');

    // Negative check: a request to a different contract must be refused.
    const bad = { ...request, to: addrs.forwarder };
    const badRes = await fetch(`${URL}/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: bad },
        (k, v) => (typeof v === 'bigint' ? Number(v) : v)),
    });
    assert(badRes.status === 400, 'server refuses non-escrow targets');
    console.log('\nHTTP RELAYER SMOKE: ALL ASSERTIONS PASSED');
  } finally {
    server.kill('SIGTERM');
    await sleep(500);
    if (serverOut.trim()) console.log('--- server log ---\n' + serverOut.trim());
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
