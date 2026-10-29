// Full HTTP-path test of the EXACT payload shape the demo frontend sends.
//
// Run with a local Hardhat node in the background:
//   1. npx hardhat node            (port 8545)
//   2. npx hardhat run scripts/relayer-frontend-shape-test.js --network localhost
//
// The script deploys forwarder + escrow to localhost, starts
// relayer/relayer-server.js as a child process pointed at the local node,
// then drives it with frontend-shaped JSON payloads (Numbers, not BigInts):
// relayed create -> direct fund -> relayed deliver -> relayed approve ->
// relayed release, plus refusal cases (value-bearing, wrong target).
// It asserts the freelancer is paid exactly and paid zero gas.
// The relayer key is a fresh random wallet funded from a Hardhat signer;
// nothing here touches Testnet, Mainnet, or any real key.
const { ethers } = require('hardhat');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { forwarderContract, signForwardRequest } = require('../relayer/signing');

const PORT = 3002;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('relayer server did not come up');
}

// Build the EXACT JSON object the demo frontend POSTs: Numbers for
// value/gas/nonce/deadline (JSON cannot carry BigInt).
async function frontendPayload(forwarder, user, to, data) {
  const signed = await signForwardRequest({ forwarder, user, to, data });
  return {
    from: signed.from, to: signed.to, value: 0, gas: 500000,
    nonce: Number(signed.nonce), deadline: signed.deadline,
    data: signed.data, signature: signed.signature,
  };
}

async function relay(payload) {
  const r = await fetch(`${BASE}/relay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request: payload }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function main() {
  const [funder, client, freelancer] = await ethers.getSigners();
  const provider = ethers.provider;
  // Baseline: the test may run against a reused node, so assert the
  // freelancer GAINS exactly 0.6 rather than an absolute balance.
  const startBal = await provider.getBalance(freelancer.address);

  const Forwarder = await ethers.getContractFactory('SafePayForwarder');
  const forwarder = await Forwarder.deploy();
  await forwarder.waitForDeployment();
  const Factory = await ethers.getContractFactory('SafePayEscrow');
  const escrow = await Factory.deploy(await forwarder.getAddress());
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log('forwarder:', await forwarder.getAddress());
  console.log('escrow:', escrowAddr);

  // Fresh random relayer wallet, funded from a Hardhat signer.
  const relayerWallet = ethers.Wallet.createRandom().connect(provider);
  await (await funder.sendTransaction({ to: relayerWallet.address, value: ethers.parseEther('1') })).wait();

  const server = spawn(process.execPath, [path.join(__dirname, '..', 'relayer', 'relayer-server.js')], {
    env: {
      ...process.env,
      RELAYER_RPC: 'http://127.0.0.1:8545',
      RELAYER_PORT: String(PORT),
      RELAYER_FORWARDER: await forwarder.getAddress(),
      RELAYER_ESCROW: escrowAddr,
      RELAYER_PRIVATE_KEY: relayerWallet.privateKey,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  server.stderr.on('data', (d) => process.stdout.write('[server:err] ' + d));
  let exitCode = 0;
  try {
    const health = await waitHealth();
    console.log('health:', JSON.stringify(health));
    if (health.forwarder.toLowerCase() !== (await forwarder.getAddress()).toLowerCase()) throw new Error('health forwarder mismatch');
    if (health.escrow.toLowerCase() !== escrowAddr.toLowerCase()) throw new Error('health escrow mismatch');

    const latest = await provider.getBlock('latest');
    const deadline = latest.timestamp + 7 * 86400;

    // 1. Relayed create (client signs, relayer pays gas).
    const createData = escrow.interface.encodeFunctionData('createEscrow', [freelancer.address, [ethers.parseEther('0.6')], deadline]);
    const fwdRead = forwarderContract(await forwarder.getAddress(), provider);
    let res = await relay(await frontendPayload(fwdRead, client, escrowAddr, createData));
    if (res.status !== 200) throw new Error('relayed create failed: ' + JSON.stringify(res.body));
    console.log('relayed create tx:', res.body.txHash);
    await provider.getTransactionReceipt(res.body.txHash);
    let e = await escrow.getEscrow(0);
    if (e[0] !== client.address) throw new Error('create recorded wrong client: ' + e[0]);

    // 2. Direct fund (funding is never relayed) + refusal case for value.
    await (await escrow.connect(client).fund(0, { value: ethers.parseEther('0.6') })).wait();
    const badValue = await frontendPayload(fwdRead, client, escrowAddr, createData);
    badValue.value = ethers.parseEther('0.1').toString();
    res = await relay(badValue);
    if (res.status !== 400 || !/value-bearing/.test(res.body.error || '')) throw new Error('value-bearing request was not refused: ' + JSON.stringify(res.body));
    console.log('value-bearing refusal OK:', res.body.error);

    // 3. Wrong-target refusal.
    const wrongTarget = await frontendPayload(fwdRead, client, escrowAddr, createData);
    wrongTarget.to = await forwarder.getAddress();
    res = await relay(wrongTarget);
    if (res.status !== 400) throw new Error('wrong-target request was not refused: ' + JSON.stringify(res.body));
    console.log('wrong-target refusal OK:', res.body.error);

    // 4. Relayed deliver (freelancer), approve + release (client).
    const deliverData = escrow.interface.encodeFunctionData('submitDelivery', [0, 0, 'https://example.com/proof']);
    res = await relay(await frontendPayload(fwdRead, freelancer, escrowAddr, deliverData));
    if (res.status !== 200) throw new Error('relayed deliver failed: ' + JSON.stringify(res.body));
    console.log('relayed deliver tx:', res.body.txHash);

    const approveData = escrow.interface.encodeFunctionData('approveMilestone', [0, 0]);
    res = await relay(await frontendPayload(fwdRead, client, escrowAddr, approveData));
    if (res.status !== 200) throw new Error('relayed approve failed: ' + JSON.stringify(res.body));
    console.log('relayed approve tx:', res.body.txHash);

    const releaseData = escrow.interface.encodeFunctionData('releaseMilestone', [0, 0]);
    res = await relay(await frontendPayload(fwdRead, client, escrowAddr, releaseData));
    if (res.status !== 200) throw new Error('relayed release failed: ' + JSON.stringify(res.body));
    console.log('relayed release tx:', res.body.txHash);

    // 5. Final state: freelancer gained exactly 0.6, having paid zero gas.
    // (The freelancer's only on-chain action was the relayed deliver, so
    // its balance must be start + 0.6 exactly, on a fresh or reused node.)
    const freeBal = await provider.getBalance(freelancer.address);
    const expected = startBal + ethers.parseEther('0.6');
    if (freeBal !== expected) throw new Error(`freelancer balance ${ethers.formatEther(freeBal)} != start + 0.6 (${ethers.formatEther(expected)})`);
    e = await escrow.getEscrow(0);
    if (e[5] !== ethers.parseEther('0.6')) throw new Error('released total wrong: ' + ethers.formatEther(e[5]));
    const m0 = await escrow.getMilestone(0, 0);
    if (!m0[1] || !m0[2] || !m0[3]) throw new Error('milestone 0 not approved+released+delivered');
    console.log(`FINAL: freelancer gained exactly 0.6 ETH (${ethers.formatEther(startBal)} -> ${ethers.formatEther(freeBal)}), milestone 0 approved+released+delivered`);
    console.log('FRONTEND-SHAPE HTTP TEST: ALL PASSED');
  } catch (err) {
    console.error('FRONTEND-SHAPE HTTP TEST: FAILED:', err.message);
    exitCode = 1;
  } finally {
    server.kill('SIGTERM');
    await sleep(500);
    if (!server.killed) server.kill('SIGKILL');
  }
  process.exit(exitCode);
}

main().catch((err) => { console.error(err); process.exit(1); });
