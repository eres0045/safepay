// End-to-end interaction script: create -> fund -> approve -> release (+ refund path).
// Runs against --network localhost (default) or mstTestnet once funded.
// Reads the deployer key from hidden_files/wallet.json (local only, never logged).
// Usage: npx hardhat run scripts/interact.js --network mstTestnet
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

const EXPLORER = {
  91562037: 'https://testnet.mstscan.com',
  4646: 'https://mstscan.com',
};

async function main() {
  const deploymentsFile = path.join(__dirname, '..', 'deployments.json');
  if (!fs.existsSync(deploymentsFile)) {
    throw new Error('No deployments.json — run scripts/deploy.js first.');
  }
  const all = JSON.parse(fs.readFileSync(deploymentsFile, 'utf8'));
  const dep = all[hre.network.name];
  if (!dep) throw new Error(`No deployment recorded for network ${hre.network.name}`);
  const [client] = await hre.ethers.getSigners();
  // On Testnet only the deployer key is configured, so the freelancer is an
  // in-memory demo recipient address (no key stored, receives testnet funds only).
  const freelancer = hre.ethers.Wallet.createRandom();
  const escrow = await hre.ethers.getContractAt('SafePayEscrow', dep.contract);
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const link = (h) => (EXPLORER[chainId] ? `${EXPLORER[chainId]}/tx/${h}` : h);

  console.log(`Client: ${client.address} | Freelancer (demo recipient): ${freelancer.address}`);

  // --- Escrow 0: full milestone flow (0.6 + 0.4 = 1.0 tMSTC) ---
  const amounts = [hre.ethers.parseEther('0.6'), hre.ethers.parseEther('0.4')];
  const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  let tx = await escrow.connect(client).createEscrow(freelancer.address, amounts, deadline);
  await tx.wait();
  console.log(`createEscrow(0) tx: ${tx.hash} ${link(tx.hash)}`);
  const escrowId = 0; // first escrow on a fresh deployment
  tx = await escrow.connect(client).fund(escrowId, { value: hre.ethers.parseEther('1') });
  await tx.wait();
  console.log(`fund(0) tx: ${tx.hash} ${link(tx.hash)}`);
  tx = await escrow.connect(client).approveMilestone(escrowId, 0);
  await tx.wait();
  console.log(`approveMilestone(0,0) tx: ${tx.hash} ${link(tx.hash)}`);
  tx = await escrow.connect(client).releaseMilestone(escrowId, 0);
  await tx.wait();
  console.log(`releaseMilestone(0,0) tx: ${tx.hash} ${link(tx.hash)}`);
  tx = await escrow.connect(client).approveMilestone(escrowId, 1);
  await tx.wait();
  console.log(`approveMilestone(0,1) tx: ${tx.hash} ${link(tx.hash)}`);
  tx = await escrow.connect(client).releaseMilestone(escrowId, 1);
  await tx.wait();
  console.log(`releaseMilestone(0,1) tx: ${tx.hash} ${link(tx.hash)}`);
  let e = await escrow.getEscrow(escrowId);
  console.log(`Escrow 0 state: funded=${e.funded} released=${hre.ethers.formatEther(e.releasedAmount)} total=${hre.ethers.formatEther(e.totalAmount)}`);

  // --- Escrow 1: refund path (deadline already passed at creation) ---
  const pastDeadline = Math.floor(Date.now() / 1000) - 60;
  tx = await escrow.connect(client).createEscrow(freelancer.address, [hre.ethers.parseEther('0.5')], pastDeadline);
  await tx.wait();
  console.log(`createEscrow(1) tx: ${tx.hash} ${link(tx.hash)}`);
  tx = await escrow.connect(client).fund(1, { value: hre.ethers.parseEther('0.5') });
  await tx.wait();
  console.log(`fund(1) tx: ${tx.hash} ${link(tx.hash)}`);
  tx = await escrow.connect(client).refund(1);
  await tx.wait();
  console.log(`refund(1) tx: ${tx.hash} ${link(tx.hash)}`);
  e = await escrow.getEscrow(1);
  console.log(`Escrow 1 state: funded=${e.funded} released=${hre.ethers.formatEther(e.releasedAmount)} refunded=${hre.ethers.formatEther(e.refundedAmount)} total=${hre.ethers.formatEther(e.totalAmount)}`);
  console.log('E2E flow complete (escrow 0 fully released; escrow 1 refunded).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
