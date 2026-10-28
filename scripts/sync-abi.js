// Copies the compiled SafePayEscrow ABI into app/abi.json for the frontend.
// Run after: npx hardhat compile
const fs = require('fs');
const path = require('path');

const artifact = path.join(
  __dirname,
  '..',
  'artifacts',
  'contracts',
  'SafePayEscrow.sol',
  'SafePayEscrow.json'
);
const out = path.join(__dirname, '..', 'app', 'abi.json');
if (!fs.existsSync(artifact)) {
  throw new Error('Artifact not found — run `npx hardhat compile` first.');
}
const { abi } = JSON.parse(fs.readFileSync(artifact, 'utf8'));
fs.writeFileSync(out, JSON.stringify(abi, null, 2));
console.log(`Wrote ${out} (${abi.length} ABI entries)`);
