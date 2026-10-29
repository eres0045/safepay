// Copies the compiled relayer-enabled SafePayEscrow ABI into
// app/abi-relayer.json for the frontend's gasless mode.
// Run after: npx hardhat compile
// (The v2 app/abi.json lacks trustedForwarder/isTrustedForwarder;
// the escrow functions are otherwise identical, but gasless mode
// uses this exact artifact ABI rather than relying on that.)
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
const out = path.join(__dirname, '..', 'app', 'abi-relayer.json');
if (!fs.existsSync(artifact)) {
  throw new Error('Artifact not found — run `npx hardhat compile` first.');
}
const { abi } = JSON.parse(fs.readFileSync(artifact, 'utf8'));
fs.writeFileSync(out, JSON.stringify(abi, null, 2));
console.log(`Wrote ${out} (${abi.length} ABI entries)`);
