require('@nomicfoundation/hardhat-toolbox');
const fs = require('fs');
const path = require('path');

// Deployer key: read from hidden_files/wallet.json (0600, gitignored) if present.
// NEVER print it. For CI-style use, MST_PRIVATE_KEY env var takes precedence.
function deployerKey() {
  if (process.env.MST_PRIVATE_KEY) return process.env.MST_PRIVATE_KEY;
  const f = path.join(__dirname, 'hidden_files', 'wallet.json');
  if (fs.existsSync(f)) {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8')).privateKey;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const key = deployerKey();
const accounts = key ? [key] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  // OZ v5's metatx utils use the MCOPY opcode (EIP-5656), so the EVM
  // target must be Cancun; Hardhat's default here resolved to Paris.
  // Testnet execution of a relayed call is the proof this target works.
  solidity: {
    version: '0.8.24',
    settings: { evmVersion: 'cancun' },
  },
  networks: {
    localhost: { url: 'http://127.0.0.1:8545' },
    mstTestnet: {
      url: 'https://testnetrpc.mstblockchain.com',
      chainId: 91562037,
      accounts,
    },
    mstMainnet: {
      url: 'https://mariorpc.mstblockchain.com',
      chainId: 4646,
      accounts,
    },
  },
};
