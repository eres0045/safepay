// Deploys the relayer stack (SafePayForwarder + relayer-enabled
// SafePayEscrow) and records it WITHOUT touching the existing v2 entries.
// Usage: npx hardhat run scripts/deploy-relayer.js --network mstTestnet
// Writes: deployments.json["mstTestnetRelayer"] and relayer/addresses.json
// (addresses only — safe to commit). NEVER run against mstMainnet.
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  console.log(`Deploying relayer stack from ${deployer.address} on chain ${network.chainId}...`);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${hre.ethers.formatEther(balance)}`);
  if (balance === 0n) throw new Error('Deployer has zero balance — fund it first.');

  const Forwarder = await hre.ethers.getContractFactory('SafePayForwarder');
  const forwarder = await Forwarder.deploy();
  await forwarder.waitForDeployment();
  const forwarderAddr = await forwarder.getAddress();
  console.log(`SafePayForwarder deployed at ${forwarderAddr}`);
  console.log(`Deploy tx: ${forwarder.deploymentTransaction().hash}`);

  const Escrow = await hre.ethers.getContractFactory('SafePayEscrow');
  const escrow = await Escrow.deploy(forwarderAddr);
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log(`SafePayEscrow (relayer-enabled) deployed at ${escrowAddr}`);
  console.log(`Deploy tx: ${escrow.deploymentTransaction().hash}`);
  console.log(`Escrow trusts forwarder: ${await escrow.trustedForwarder()}`);

  const explorer = network.chainId === 91562037n
    ? 'https://testnet.mstscan.com'
    : 'https://mstscan.com';
  console.log(`Forwarder: ${explorer}/address/${forwarderAddr}`);
  console.log(`Escrow: ${explorer}/address/${escrowAddr}`);

  const out = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    forwarder: forwarderAddr,
    forwarderDeployTx: forwarder.deploymentTransaction().hash,
    contract: escrowAddr,
    deployTx: escrow.deploymentTransaction().hash,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };
  const depFile = path.join(__dirname, '..', 'deployments.json');
  const prev = fs.existsSync(depFile) ? JSON.parse(fs.readFileSync(depFile, 'utf8')) : {};
  prev[`${hre.network.name}Relayer`] = out;
  fs.writeFileSync(depFile, JSON.stringify(prev, null, 2));
  console.log(`Wrote ${depFile} (key ${hre.network.name}Relayer; v2 entry untouched)`);

  const addrFile = path.join(__dirname, '..', 'relayer', 'addresses.json');
  fs.writeFileSync(addrFile, JSON.stringify({
    chainId: Number(network.chainId),
    forwarder: forwarderAddr,
    escrow: escrowAddr,
    deployedAt: out.deployedAt,
  }, null, 2));
  console.log(`Wrote ${addrFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
