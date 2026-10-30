// Real disputed-then-resolved escrow flow on MST Testnet ONLY.
// Usage: npx hardhat run scripts/dispute-e2e-testnet.js --network mstTestnet
// The deployer acts as client; two throwaway wallets are generated in-memory
// (never printed, never saved) as freelancer and resolver, funded with a
// little tMSTC for gas. Prints ONLY addresses and tx hashes + receipts.
// NEVER run against mstMainnet.
const hre = require('hardhat');

const DISPUTE_ESCROW = '0x3bdb0d50F1e7b85286450E2bec633Cf5a2285968';

async function main() {
  if (hre.network.name === 'mstMainnet') throw new Error('Refusing mainnet.');
  const [client] = await hre.ethers.getSigners();
  const provider = hre.ethers.provider;
  const freelancer = hre.ethers.Wallet.createRandom().connect(provider);
  const resolver = hre.ethers.Wallet.createRandom().connect(provider);
  console.log(`Client: ${client.address}`);
  console.log(`Freelancer: ${freelancer.address}`);
  console.log(`Resolver: ${resolver.address}`);

  // Gas money for the two throwaway wallets (testnet only, tiny amounts).
  for (const w of [freelancer, resolver]) {
    const tx = await client.sendTransaction({ to: w.address, value: hre.ethers.parseEther('0.05') });
    await tx.wait();
  }

  const Escrow = await hre.ethers.getContractFactory('SafePayEscrow');
  const escrow = Escrow.attach(DISPUTE_ESCROW);
  const deadline = Math.floor(Date.now() / 1000) + 7 * 86400;
  const m0 = hre.ethers.parseEther('0.01');
  const m1 = hre.ethers.parseEther('0.01');

  const escrowId = await escrow.nextEscrowId();
  console.log(`Using escrow id: ${escrowId}`);
  let tx = await escrow.connect(client).createEscrowWithResolver(
    freelancer.address, [m0, m1], deadline, resolver.address
  );
  let rc = await tx.wait();
  console.log(`createEscrowWithResolver tx: ${tx.hash} status: ${rc.status}`);
  tx = await escrow.connect(client).fund(escrowId, { value: hre.ethers.parseEther('0.02') });
  rc = await tx.wait();
  console.log(`fund tx: ${tx.hash} status: ${rc.status}`);

  tx = await escrow.connect(freelancer).raiseDispute(escrowId, 'Demo Day dispute: milestone scope contested');
  rc = await tx.wait();
  console.log(`raiseDispute tx: ${tx.hash} status: ${rc.status}`);
  const d1 = await escrow.getDispute(escrowId);
  console.log(`disputed after raise: ${d1[1]} raisedBy freelancer: ${d1[3] === freelancer.address}`);

  // Frozen while disputed: release must revert with EscrowDisputed
  // (selector 0x065832f6 — live RPCs return the raw selector, not the name).
  try {
    await escrow.connect(client).releaseMilestone.staticCall(escrowId, 0);
    throw new Error('release should have reverted while disputed');
  } catch (e) {
    if (!String(e).includes('0x065832f6')) throw e;
    console.log('release correctly reverts with EscrowDisputed while disputed');
  }

  tx = await escrow.connect(resolver).resolveDispute(escrowId, true);
  rc = await tx.wait();
  console.log(`resolveDispute (to freelancer) tx: ${tx.hash} status: ${rc.status}`);
  const d2 = await escrow.getDispute(escrowId);
  console.log(`disputed after resolve: ${d2[1]} resolved: ${d2[2]}`);
  const e = await escrow.getEscrow(escrowId);
  console.log(`releasedAmount: ${hre.ethers.formatEther(e[5])} tMSTC (expected 0.02)`);
  if (rc.status !== 1) throw new Error('resolve receipt not 0x1');
  if (e[5] !== hre.ethers.parseEther('0.02')) throw new Error('freelancer was not paid in full');
  console.log('TESTNET DISPUTE FLOW OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
