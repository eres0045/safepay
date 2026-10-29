// End-to-end relayer proof ON MST TESTNET (not a simulation).
// Flow: fresh client + freelancer + relayer wallets; the client funds the
// escrow directly (value-bearing calls are never relayed), and EVERYTHING
// else — create, deliver, approve, release — goes through the relayer as
// signed meta-transactions. Assertions prove: (a) the escrow records the
// original signer, never the relayer; (b) the freelancer pays zero gas
// (starts at 0, stays 0 until paid); (c) the relayer pays the gas.
// Usage: npx hardhat run scripts/relayer-e2e-testnet.js --network mstTestnet
// Test wallets are written ONLY to hidden_files/relayer-testnet.json
// (gitignored). This script prints ADDRESSES, balances and tx hashes —
// never private keys.
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');
const { signForwardRequest, forwarderContract, toTuple } = require('../relayer/signing');

const EXPLORER = 'https://testnet.mstscan.com';
const escrowAbi = require('../artifacts/contracts/SafePayEscrow.sol/SafePayEscrow.json').abi;

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ok: ${msg}`);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const provider = hre.ethers.provider;
  const addrs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'relayer', 'addresses.json'), 'utf8'));
  const forwarder = forwarderContract(addrs.forwarder, provider);
  const escrow = new hre.ethers.Contract(addrs.escrow, escrowAbi, provider);
  console.log(`Forwarder: ${addrs.forwarder}`);
  console.log(`Escrow (relayer-enabled): ${addrs.escrow}`);
  assert((await escrow.trustedForwarder()).toLowerCase() === addrs.forwarder.toLowerCase(),
    'escrow trusts the deployed forwarder');

  // Fresh throwaway Testnet wallets (test funds only).
  const relayerWallet = hre.ethers.Wallet.createRandom().connect(provider);
  const clientWallet = hre.ethers.Wallet.createRandom().connect(provider);
  const freelancerWallet = hre.ethers.Wallet.createRandom().connect(provider);
  const keyFile = path.join(__dirname, '..', 'hidden_files', 'relayer-testnet.json');
  fs.writeFileSync(keyFile, JSON.stringify({
    note: 'Throwaway MST TESTNET wallets only. Never mainnet, never committed (hidden_files/ is gitignored).',
    relayer: { address: relayerWallet.address, privateKey: relayerWallet.privateKey },
    client: { address: clientWallet.address, privateKey: clientWallet.privateKey },
    freelancer: { address: freelancerWallet.address, privateKey: freelancerWallet.privateKey },
  }, null, 2), { mode: 0o600 });
  console.log(`Test wallets: relayer=${relayerWallet.address} client=${clientWallet.address} freelancer=${freelancerWallet.address}`);
  console.log(`(keys saved to hidden_files/relayer-testnet.json, mode 0600, gitignored — NOT printed)`);

  // Fund relayer (gas only) + client (escrow funds + one direct fund tx).
  console.log('Funding test wallets from deployer...');
  await (await deployer.sendTransaction({ to: relayerWallet.address, value: hre.ethers.parseEther('1') })).wait();
  await (await deployer.sendTransaction({ to: clientWallet.address, value: hre.ethers.parseEther('2') })).wait();

  const escrowIface = new hre.ethers.Interface(escrowAbi);
  async function relayAs(user, fnName, args) {
    const data = escrowIface.encodeFunctionData(fnName, args);
    const req = await signForwardRequest({ forwarder, user, to: addrs.escrow, data });
    const ok = await forwarder.verify(toTuple(req));
    assert(ok, `forwarder verifies ${fnName} request from ${user.address.slice(0, 10)}...`);
    const tx = await forwarder.connect(relayerWallet).execute(toTuple(req));
    const receipt = await tx.wait();
    assert(receipt.status === 1, `${fnName} relay receipt status 1`);
    console.log(`  ${fnName} via relayer: ${EXPLORER}/tx/${tx.hash}`);
    return receipt;
  }

  const M0 = hre.ethers.parseEther('0.6');
  const M1 = hre.ethers.parseEther('0.4');
  const ONE = hre.ethers.parseEther('1');

  // 1. Create via relayer.
  const nextBefore = await escrow.nextEscrowId();
  await relayAs(clientWallet, 'createEscrow', [freelancerWallet.address, [M0, M1], Math.floor(Date.now() / 1000) + 7 * 86400]);
  const escrowId = nextBefore;
  const e0 = await escrow.getEscrow(escrowId);
  assert(e0[0].toLowerCase() === clientWallet.address.toLowerCase(), 'created escrow records CLIENT as client (not relayer)');
  assert(e0[1].toLowerCase() === freelancerWallet.address.toLowerCase(), 'created escrow records freelancer');

  // 2. Fund DIRECTLY (value-bearing: never relayed).
  const fundTx = await escrow.connect(clientWallet).fund(escrowId, { value: ONE });
  await fundTx.wait();
  console.log(`  fund direct: ${EXPLORER}/tx/${fundTx.hash}`);
  assert((await escrow.getEscrow(escrowId))[7] === true, 'escrow funded');

  const clientAfterFund = await provider.getBalance(clientWallet.address);
  const freelancerBefore = await provider.getBalance(freelancerWallet.address);
  const relayerBefore = await provider.getBalance(relayerWallet.address);
  assert(freelancerBefore === 0n, 'freelancer starts at 0 (gasless: never needed funds)');

  // 3. Deliver via relayer (freelancer signs).
  await relayAs(freelancerWallet, 'submitDelivery', [escrowId, 0, 'https://example.com/relayed-work']);
  const m0 = await escrow.getMilestone(escrowId, 0);
  assert(m0[3] === true && m0[4] === 'https://example.com/relayed-work', 'milestone delivered with proof via relayer');

  // 4. Approve via relayer (client signs).
  await relayAs(clientWallet, 'approveMilestone', [escrowId, 0]);
  assert((await escrow.getMilestone(escrowId, 0))[1] === true, 'milestone approved via relayer');

  // 5. Release via relayer (client signs; anyone may release).
  await relayAs(clientWallet, 'releaseMilestone', [escrowId, 0]);
  const freelancerAfter = await provider.getBalance(freelancerWallet.address);
  const relayerAfter = await provider.getBalance(relayerWallet.address);
  const clientAfter = await provider.getBalance(clientWallet.address);
  assert(freelancerAfter === M0, `freelancer paid exactly 0.6 tMSTC (got ${hre.ethers.formatEther(freelancerAfter)})`);
  assert((await escrow.getMilestone(escrowId, 0))[2] === true, 'milestone released via relayer');
  assert(clientAfter === clientAfterFund, 'client paid ZERO gas for all relayed calls (balance unchanged since funding)');
  assert(relayerAfter < relayerBefore, 'relayer balance decreased (relayer paid the gas)');

  console.log('\nTESTNET RELAYER E2E: ALL ASSERTIONS PASSED');
  console.log(`Escrow id: ${escrowId} on ${addrs.escrow}`);
  console.log(`Explorer: ${EXPLORER}/address/${addrs.escrow}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
