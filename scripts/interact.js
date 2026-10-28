// End-to-end interaction script for SafePayEscrow v2: approve/release flow,
// delivery + deadline-claim flow, refund path, and refund-lock flow.
// Runs against --network localhost (default) or mstTestnet once funded.
// Reads the deployer key from hidden_files/wallet.json (local only, never logged).
// The freelancer is an in-memory demo wallet (key never stored); the deployer
// funds it with a little tMSTC for gas so it can sign delivery/claim calls.
// Usage: npx hardhat run scripts/interact.js --network mstTestnet
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

const EXPLORER = {
  91562037: 'https://testnet.mstscan.com',
  4646: 'https://mstscan.com',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const deploymentsFile = path.join(__dirname, '..', 'deployments.json');
  if (!fs.existsSync(deploymentsFile)) {
    throw new Error('No deployments.json — run scripts/deploy.js first.');
  }
  const all = JSON.parse(fs.readFileSync(deploymentsFile, 'utf8'));
  const dep = all[hre.network.name];
  if (!dep) throw new Error(`No deployment recorded for network ${hre.network.name}`);
  const [client] = await hre.ethers.getSigners();
  const provider = hre.ethers.provider;
  const freelancer = hre.ethers.Wallet.createRandom().connect(provider);
  const escrow = await hre.ethers.getContractAt('SafePayEscrow', dep.contract);
  const chainId = Number((await provider.getNetwork()).chainId);
  const link = (h) => (EXPLORER[chainId] ? `${EXPLORER[chainId]}/tx/${h}` : h);
  const run = async (label, fn) => {
    const tx = await fn();
    await tx.wait();
    console.log(`${label} tx: ${tx.hash} ${link(tx.hash)}`);
    return tx;
  };

  console.log(`Client: ${client.address} | Freelancer (demo wallet): ${freelancer.address}`);
  console.log(`Contract: ${dep.contract}`);

  // Fund the demo freelancer wallet for gas (delivery + claim calls).
  await run('fundFreelancerWallet(0.3)', () =>
    client.sendTransaction({ to: freelancer.address, value: hre.ethers.parseEther('0.3') })
  );

  // --- Escrow 0: full approve/release flow (0.6 + 0.4 = 1.0 tMSTC) ---
  const amounts = [hre.ethers.parseEther('0.6'), hre.ethers.parseEther('0.4')];
  const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  await run('createEscrow(0)', () => escrow.connect(client).createEscrow(freelancer.address, amounts, deadline));
  await run('fund(0)', () => escrow.connect(client).fund(0, { value: hre.ethers.parseEther('1') }));
  await run('approveMilestone(0,0)', () => escrow.connect(client).approveMilestone(0, 0));
  await run('releaseMilestone(0,0)', () => escrow.connect(client).releaseMilestone(0, 0));
  await run('approveMilestone(0,1)', () => escrow.connect(client).approveMilestone(0, 1));
  await run('releaseMilestone(0,1)', () => escrow.connect(client).releaseMilestone(0, 1));
  let e = await escrow.getEscrow(0);
  console.log(`Escrow 0 state: funded=${e.funded} released=${hre.ethers.formatEther(e.releasedAmount)} total=${hre.ethers.formatEther(e.totalAmount)}`);

  // --- Escrow 1: plain refund path (deadline already passed at creation) ---
  const pastDeadline = Math.floor(Date.now() / 1000) - 60;
  await run('createEscrow(1)', () => escrow.connect(client).createEscrow(freelancer.address, [hre.ethers.parseEther('0.5')], pastDeadline));
  await run('fund(1)', () => escrow.connect(client).fund(1, { value: hre.ethers.parseEther('0.5') }));
  await run('refund(1)', () => escrow.connect(client).refund(1));
  e = await escrow.getEscrow(1);
  console.log(`Escrow 1 state: funded=${e.funded} released=${hre.ethers.formatEther(e.releasedAmount)} refunded=${hre.ethers.formatEther(e.refundedAmount)} total=${hre.ethers.formatEther(e.totalAmount)}`);

  // --- Escrows 2 + 3: deadline-gated v2 flows, shared short deadline ---
  const shortDeadline = Math.floor(Date.now() / 1000) + 150;
  await run('createEscrow(2)', () => escrow.connect(client).createEscrow(freelancer.address, [hre.ethers.parseEther('0.5')], shortDeadline));
  await run('fund(2)', () => escrow.connect(client).fund(2, { value: hre.ethers.parseEther('0.5') }));
  await run('submitDelivery(2,0)', () => escrow.connect(freelancer).submitDelivery(2, 0, 'https://example.com/safepay-demo-delivery'));
  await run('createEscrow(3)', () => escrow.connect(client).createEscrow(freelancer.address, [hre.ethers.parseEther('0.6'), hre.ethers.parseEther('0.4'), hre.ethers.parseEther('0.6')], shortDeadline));
  await run('fund(3)', () => escrow.connect(client).fund(3, { value: hre.ethers.parseEther('1.6') }));
  await run('submitDelivery(3,1)', () => escrow.connect(freelancer).submitDelivery(3, 1, 'https://example.com/safepay-demo-delivery-3'));
  await run('approveMilestone(3,0)', () => escrow.connect(client).approveMilestone(3, 0));
  await run('releaseMilestone(3,0)', () => escrow.connect(client).releaseMilestone(3, 0));
  const waitMs = (shortDeadline + 10) * 1000 - Date.now();
  console.log(`Waiting ${Math.ceil(waitMs / 1000)}s for the short deadline to pass...`);
  await sleep(waitMs);
  await run('claimDelivered(2,0)', () => escrow.connect(freelancer).claimDelivered(2, 0));
  await run('refund(3)', () => escrow.connect(client).refund(3));
  await run('claimDelivered(3,1)', () => escrow.connect(freelancer).claimDelivered(3, 1));
  e = await escrow.getEscrow(2);
  console.log(`Escrow 2 state: funded=${e.funded} released=${hre.ethers.formatEther(e.releasedAmount)} refunded=${hre.ethers.formatEther(e.refundedAmount)} total=${hre.ethers.formatEther(e.totalAmount)}`);
  e = await escrow.getEscrow(3);
  console.log(`Escrow 3 state: funded=${e.funded} released=${hre.ethers.formatEther(e.releasedAmount)} refunded=${hre.ethers.formatEther(e.refundedAmount)} total=${hre.ethers.formatEther(e.totalAmount)}`);
  console.log('E2E flow complete (escrow 0 released; escrow 1 refunded; escrow 2 deadline-claimed; escrow 3 partial refund + claim).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
