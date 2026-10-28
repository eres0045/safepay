// Deploys SafePayEscrow and records the address in deployments.json.
// Usage: npx hardhat run scripts/deploy.js --network mstTestnet
// Requires funding first: the deployer (hidden_files/wallet.json) must hold
// tMSTC on testnet (faucet) or MSTC on mainnet (organizer funds).
// NEVER run against mstMainnet without explicit organizer go-ahead.
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  console.log(`Deploying from ${deployer.address} on chain ${network.chainId}...`);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${hre.ethers.formatEther(balance)}`);
  if (balance === 0n) {
    throw new Error('Deployer has zero balance — fund it from the faucet (testnet) first.');
  }
  const Factory = await hre.ethers.getContractFactory('SafePayEscrow');
  const escrow = await Factory.deploy();
  await escrow.waitForDeployment();
  const address = await escrow.getAddress();
  const tx = escrow.deploymentTransaction();
  console.log(`SafePayEscrow deployed at ${address}`);
  console.log(`Deploy tx: ${tx ? tx.hash : '(unavailable)'}`);
  const out = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    contract: address,
    deployer: deployer.address,
    deployTx: tx ? tx.hash : null,
    deployedAt: new Date().toISOString(),
  };
  const file = path.join(__dirname, '..', 'deployments.json');
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  prev[hre.network.name] = out;
  fs.writeFileSync(file, JSON.stringify(prev, null, 2));
  console.log(`Wrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
