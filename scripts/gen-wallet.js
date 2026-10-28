// Generates a FRESH EVM wallet for MST SafePay.
// Prints ONLY the public address. The private key is written to
// hidden_files/wallet.json (chmod 600) and must NEVER be printed,
// committed, or pasted anywhere.
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'hidden_files');
const outFile = path.join(outDir, 'wallet.json');
fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });

if (fs.existsSync(outFile)) {
  const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  console.log('EXISTING_WALLET_ADDRESS=' + existing.address);
  console.log('NOTE: wallet already existed; no new key generated.');
  process.exit(0);
}

const wallet = ethers.Wallet.createRandom();
fs.writeFileSync(
  outFile,
  JSON.stringify(
    {
      network: 'MST Testnet + MST Mainnet (EVM-style address, same on both chains)',
      address: wallet.address,
      privateKey: wallet.privateKey,
      createdAt: new Date().toISOString(),
      purpose: 'SafePay escrow deployer + Mainnet $MSTC allocation recipient',
    },
    null,
    2
  ),
  { mode: 0o600 }
);
console.log('NEW_WALLET_ADDRESS=' + wallet.address);
console.log('Private key stored ONLY in hidden_files/wallet.json (0600). Never print or commit it.');
