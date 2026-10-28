// Independently verifies the v2 Testnet deployment: every receipt status,
// contract bytecode, and final on-chain states. Exits non-zero on any failure.
// Usage: npx hardhat run scripts/verify-v2.js --network mstTestnet
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

const DEPLOY_TX = '0x6e52a3661e5a044893ce16153c6005458f9b5ea15f953d3fb78e6ead8a185fde';
const FLOW_TXS = {
  'fundFreelancerWallet': '0xba5e49024bb5a10df6e32a66133fea0cffcc584d7c1d52d55f8337476cb145a0',
  'createEscrow(0)': '0xf858ba38563de2bb63557444afb0fbad89673e0af621fba969e474e5f950cc3c',
  'fund(0)': '0x9fa2ecc82171bb83f24c762faed7da34dc908d07759eb11fa468f42415bc82ef',
  'approveMilestone(0,0)': '0x6c66730ff8a957e7deb2d7bbf2037aab767ee140289cec5f31cbd9c0d62ebddb',
  'releaseMilestone(0,0)': '0x0ad76f8200adebc9706dbfe5e1acefbc1af6bf75a15f41aa2831ada0ce903a91',
  'approveMilestone(0,1)': '0x0092e15702275a5f3739695f7d95e89cf7d791820f49b01269b01fbe8e6317b5',
  'releaseMilestone(0,1)': '0x5e95af131e29c98b2585e476d96f9740a220b8e94caa57a67f23f8de5db9aef4',
  'createEscrow(1)': '0x063ada4f597a54965720657f850a8aabc8db4da80483006e05ee9b243fe3a65a',
  'fund(1)': '0x233281aec91bd9506944af7089cadb7b1948ef263b5dbb741ade340d73754b1c',
  'refund(1)': '0xc136c1b9fdfc75eae0f4da53ac3d715c8f073c663e09f9bf273190305ed94fa2',
  'createEscrow(2)': '0x20d7b3786e2b735ee0bb5370d457147019d6cf0ffe7327883187e93d61828322',
  'fund(2)': '0x634636255f5a43de502152500be599bdd31e38bf0d8b2fc5207c7b64bc795e61',
  'submitDelivery(2,0)': '0x26fbc6190634d8a187c78bf891857ee40a21ef1a0bd119a77f9fc55c0fc47352',
  'createEscrow(3)': '0xc5693a6e957d67e7e220a336eee2d6d29d5e2bc1b07dcf735bd3b4e838d073f1',
  'fund(3)': '0xb5783109d7d65ff422a0adf9006e032003237f5df6137d99cca808a7b9f942ca',
  'submitDelivery(3,1)': '0xa2d2d116d5276b2b07bf5b5884251e2b5d7ca0b3bc1cc297bd9968f2acd91a5a',
  'approveMilestone(3,0)': '0x7c8155647ea58295dde6279a8b5cef32cd5145a5501915c3beb4a4ef65f7110d',
  'releaseMilestone(3,0)': '0x40d585b97fb26a9ebd4fa54e3f4492496d19eb55871bbb4a28c43c3538c2a2fb',
  'claimDelivered(2,0)': '0x79687f07a2c5d330aa1a63d4baddb8c9971aa78911895a226688b7d1b22ce7a7',
  'refund(3)': '0x043afd53052c8475c176090d8499d56f1981b6537623ed8d4f98f33cd5d23962',
  'claimDelivered(3,1)': '0x1b6de3266d7b0cd1beb9e32fb4b811d5e990cce515f87598e606e5206eb0796f',
};

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployments.json'), 'utf8'))[hre.network.name];
  const provider = hre.ethers.provider;
  let failed = false;
  const check = (label, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} ${detail}`);
    if (!ok) failed = true;
  };

  const deployReceipt = await provider.getTransactionReceipt(DEPLOY_TX);
  check('deploy receipt status', deployReceipt && deployReceipt.status === 1, `block ${deployReceipt?.blockNumber}`);
  check('deploy contractAddress matches', deployReceipt?.contractAddress === dep.contract, deployReceipt?.contractAddress);
  const code = await provider.getCode(dep.contract);
  check('contract bytecode present', code && code !== '0x', `length ${code.length}`);

  const blocks = [];
  for (const [label, hash] of Object.entries(FLOW_TXS)) {
    const r = await provider.getTransactionReceipt(hash);
    check(`receipt ${label}`, r && r.status === 1, `block ${r?.blockNumber}`);
    if (r) blocks.push(r.blockNumber);
  }
  console.log(`Flow blocks range: ${Math.min(...blocks)}–${Math.max(...blocks)}`);

  const escrow = await hre.ethers.getContractAt('SafePayEscrow', dep.contract);
  const fmt = (v) => hre.ethers.formatEther(v);
  const expectState = async (id, released, refunded, total) => {
    const e = await escrow.getEscrow(id);
    const ok = fmt(e.releasedAmount) === released && fmt(e.refundedAmount) === refunded && fmt(e.totalAmount) === total;
    check(`escrow ${id} state`, ok, `released=${fmt(e.releasedAmount)} refunded=${fmt(e.refundedAmount)} total=${fmt(e.totalAmount)}`);
  };
  await expectState(0, '1.0', '0.0', '1.0');
  await expectState(1, '0.0', '0.5', '0.5');
  await expectState(2, '0.5', '0.0', '0.5');
  await expectState(3, '1.0', '0.6', '1.6');
  const m20 = await escrow.getMilestone(2, 0);
  check('escrow2 milestone0 delivered+released', m20.delivered === true && m20.released === true, `proof=${m20.proof}`);
  const m31 = await escrow.getMilestone(3, 1);
  check('escrow3 milestone1 delivered+released', m31.delivered === true && m31.released === true, `proof=${m31.proof}`);
  const m30 = await escrow.getMilestone(3, 0);
  check('escrow3 milestone0 approved+released', m30.approved === true && m30.released === true, '');

  if (failed) throw new Error('Verification FAILED');
  console.log('VERIFICATION PASSED: deploy + 21 flow txs + final states all confirmed on-chain.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
