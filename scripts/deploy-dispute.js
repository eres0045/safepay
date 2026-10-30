// Deploys the dispute-enabled SafePayEscrow (Demo Day build) to MST Testnet
// ONLY, reusing the existing SafePayForwarder as the trusted forwarder, and
// records it WITHOUT touching the v2 or relayer entries.
// Usage: npx hardhat run scripts/deploy-dispute.js --network mstTestnet
// Writes: deployments.json["mstTestnetDispute"] (addresses only).
// NEVER run against mstMainnet. Dispute actions are direct-only in the app:
// the relayer service allowlists the relayer escrow, not this contract.
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

const EXISTING_FORWARDER = '0x1Eb5bB559Dee94548e28c12Ae36105405BA209f9';

async function main() {
  if (hre.network.name === 'mstMainnet') {
    throw new Error('Refusing to deploy the dispute contract to mainnet.');
  }
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  console.log(`Deploying dispute escrow from ${deployer.address} on chain ${network.chainId}...`);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${hre.ethers.formatEther(balance)}`);
  if (balance === 0n) throw new Error('Deployer has zero balance — fund it first.');

  const Escrow = await hre.ethers.getContractFactory('SafePayEscrow');
  const escrow = await Escrow.deploy(EXISTING_FORWARDER);
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log(`SafePayEscrow (dispute-enabled) deployed at ${escrowAddr}`);
  console.log(`Deploy tx: ${escrow.deploymentTransaction().hash}`);
  console.log(`Escrow trusts forwarder: ${await escrow.trustedForwarder()}`);

  const out = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    forwarder: EXISTING_FORWARDER,
    contract: escrowAddr,
    deployTx: escrow.deploymentTransaction().hash,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };
  const depFile = path.join(__dirname, '..', 'deployments.json');
  const prev = fs.existsSync(depFile) ? JSON.parse(fs.readFileSync(depFile, 'utf8')) : {};
  prev[`${hre.network.name}Dispute`] = out;
  fs.writeFileSync(depFile, JSON.stringify(prev, null, 2));
  console.log(`Wrote ${depFile} (key ${hre.network.name}Dispute; v2 + relayer entries untouched)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
