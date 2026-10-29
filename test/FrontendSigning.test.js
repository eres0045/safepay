// Frontend-signing drift guards + payload-shape proof.
//
// The demo app (app/index.html) re-implements the meta-transaction
// signing in browser JS. If its EIP-712 type definition, domain, or
// addresses drift from relayer/signing.js + relayer/addresses.json, the
// gasless buttons will sign requests the forwarder rejects. These tests
// fail loudly on any such drift, and prove the EXACT JSON payload shape
// the frontend POSTs (Numbers, not BigInts) still verifies + executes.
const { expect } = require('chai');
const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');
const { FORWARDER_NAME, FORWARDER_TYPES, forwarderContract, signForwardRequest, toTuple } = require('../relayer/signing');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
const ADDRESSES = JSON.parse(fs.readFileSync(path.join(ROOT, 'relayer', 'addresses.json'), 'utf8'));

function htmlTypes() {
  // Extract the FORWARDER_TYPES block from the page and eval it in
  // isolation (it is a plain object literal, no DOM access).
  const m = HTML.match(/const FORWARDER_TYPES = (\{[\s\S]*?\n\};)/);
  expect(m, 'FORWARDER_TYPES block not found in app/index.html').to.not.be.null;
  const fn = new Function(`return (${m[1].replace(/;$/, '')});`);
  return fn();
}

describe('Frontend signing shape (app/index.html vs relayer/signing.js)', function () {
  it('uses the exact same EIP-712 ForwardRequest type as the server', function () {
    expect(htmlTypes()).to.deep.equal(FORWARDER_TYPES);
  });

  it('uses the same forwarder domain name/version as the server', function () {
    expect(HTML).to.include(`name: '${FORWARDER_NAME}'`);
    expect(HTML).to.include(`version: '1'`);
  });

  it('points at the deployed Testnet forwarder + relayer escrow', function () {
    expect(HTML).to.include(`const RELAYER_ESCROW_ADDR = '${ADDRESSES.escrow}'`);
    expect(HTML).to.include(`const FORWARDER_ADDR = '${ADDRESSES.forwarder}'`);
  });

  it('keeps the direct v2 contract as the default', function () {
    expect(HTML).to.include(`const V2_ADDR = '0x40854b8c2436504FFB30Ac89298Da24eC434a905'`);
    expect(HTML).to.include(`<option value="direct" selected>`);
    expect(HTML).to.include(`value="0x40854b8c2436504FFB30Ac89298Da24eC434a905"`);
  });

  it('has a gasless button for every relayable action, none for fund', function () {
    for (const id of ['createGasless', 'approveGasless', 'releaseGasless', 'refundGasless', 'deliverGasless', 'claimGasless']) {
      expect(HTML).to.include(`id="${id}"`);
    }
    expect(HTML).to.not.include('id="fundGasless"');
  });

  it('frontend-shaped JSON payload (Numbers) verifies and executes', async function () {
    const [client, freelancer, relayer] = await ethers.getSigners();
    const Forwarder = await ethers.getContractFactory('SafePayForwarder');
    const forwarder = await Forwarder.deploy();
    await forwarder.waitForDeployment();
    const Factory = await ethers.getContractFactory('SafePayEscrow');
    const escrow = await Factory.deploy(await forwarder.getAddress());
    await escrow.waitForDeployment();

    // Build the request exactly like the browser does, then JSON-round-trip
    // it exactly like fetch() does (BigInts become Numbers first).
    const data = escrow.interface.encodeFunctionData('createEscrow', [
      freelancer.address, [ethers.parseEther('0.6')], (await ethers.provider.getBlock('latest')).timestamp + 7 * 86400,
    ]);
    const signed = await signForwardRequest({ forwarder, user: client, to: await escrow.getAddress(), data });
    const payload = JSON.parse(JSON.stringify({
      request: {
        from: signed.from, to: signed.to, value: 0, gas: 500000,
        nonce: Number(signed.nonce), deadline: signed.deadline,
        data: signed.data, signature: signed.signature,
      },
    }));
    // Server-side handling: toTuple drops nonce (OZ calldata struct has
    // none) and verify() checks the signature against on-chain nonce.
    const fwdAsRelayer = forwarderContract(await forwarder.getAddress(), relayer);
    expect(await fwdAsRelayer.verify(toTuple(payload.request))).to.equal(true);
    const tx = await fwdAsRelayer.execute(toTuple(payload.request));
    await tx.wait();
    const e = await escrow.getEscrow(0);
    expect(e[0]).to.equal(client.address); // recorded client is the signer
    expect(e[0]).to.not.equal(relayer.address); // never the relayer
  });
});
