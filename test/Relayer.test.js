// End-to-end relayer tests: user signs a meta-transaction, the relayer
// submits it and pays the gas, and the escrow records the ORIGINAL user
// as the actor — never the relayer. This is the property the whole
// gasless design depends on, because onlyClient / onlyFreelancer checks
// read _msgSender(), which ERC2771Context recovers from the forwarded
// calldata suffix.
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const ONE = ethers.parseEther('1');
const M0 = ethers.parseEther('0.6');
const M1 = ethers.parseEther('0.4');
const FORWARDER_NAME = 'SafePayForwarder';
const RELAY_GAS = 500000n;

const TYPES = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
};

async function deploy() {
  const [client, freelancer, other, relayer] = await ethers.getSigners();
  const Forwarder = await ethers.getContractFactory('SafePayForwarder');
  const forwarder = await Forwarder.deploy();
  await forwarder.waitForDeployment();
  const Factory = await ethers.getContractFactory('SafePayEscrow');
  const escrow = await Factory.deploy(await forwarder.getAddress());
  await escrow.waitForDeployment();
  return { escrow, forwarder, client, freelancer, other, relayer };
}

async function domain(forwarder) {
  const net = await ethers.provider.getNetwork();
  return {
    name: FORWARDER_NAME,
    version: '1',
    chainId: net.chainId,
    verifyingContract: await forwarder.getAddress(),
  };
}

// Build + sign a forward request for `data` (already ABI-encoded escrow
// call) on behalf of `user`. Returns the request struct for execute().
async function signRequest(forwarder, user, to, data) {
  const nonce = await forwarder.nonces(user.address);
  const deadline = (await time.latest()) + 3600;
  const message = {
    from: user.address,
    to,
    value: 0n,
    gas: RELAY_GAS,
    nonce,
    deadline,
    data,
  };
  const signature = await user.signTypedData(await domain(forwarder), TYPES, message);
  return { ...message, signature };
}

// The relayer submits; returns the receipt. Rejects value-bearing requests
// (same rule as the relayer service: funding moves user money, never relayed).
async function relay(forwarder, relayer, request) {
  if (request.value !== 0n) throw new Error('relayer refuses value-bearing requests');
  const tx = await forwarder.connect(relayer).execute(request);
  return tx.wait();
}

async function fundedEscrow(escrow, client, freelancer) {
  const deadline = (await time.latest()) + 7 * 24 * 3600;
  await escrow.connect(client).createEscrow(freelancer.address, [M0, M1], deadline);
  await escrow.connect(client).fund(0, { value: ONE });
  return deadline;
}

describe('SafePayEscrow via relayer (ERC-2771)', function () {
  it('relayed approve: client signs, relayer pays gas, milestone approved, client balance untouched', async function () {
    const { escrow, forwarder, client, freelancer, relayer } = await deploy();
    await fundedEscrow(escrow, client, freelancer);
    const escrowAddr = await escrow.getAddress();
    const data = escrow.interface.encodeFunctionData('approveMilestone', [0, 0]);
    const request = await signRequest(forwarder, client, escrowAddr, data);
    expect(await forwarder.verify(request)).to.equal(true);

    const userBefore = await ethers.provider.getBalance(client.address);
    const relayerBefore = await ethers.provider.getBalance(relayer.address);
    await relay(forwarder, relayer, request);
    const userAfter = await ethers.provider.getBalance(client.address);
    const relayerAfter = await ethers.provider.getBalance(relayer.address);

    expect((await escrow.getMilestone(0, 0)).approved).to.equal(true);
    expect(userAfter).to.equal(userBefore); // user paid zero gas
    expect(relayerAfter).to.be.lt(relayerBefore); // relayer paid the gas
  });

  it('relayed delivery: event records the freelancer, not the relayer', async function () {
    const { escrow, forwarder, client, freelancer, relayer } = await deploy();
    await fundedEscrow(escrow, client, freelancer);
    const escrowAddr = await escrow.getAddress();
    const data = escrow.interface.encodeFunctionData('submitDelivery', [0, 0, 'https://example.com/work-0']);
    const request = await signRequest(forwarder, freelancer, escrowAddr, data);
    const tx = await forwarder.connect(relayer).execute(request);
    const receipt = await tx.wait();
    // The on-chain msg.sender of the forwarded call is the forwarder, yet
    // the event must name the freelancer: proof _msgSender() recovered her.
    const iface = escrow.interface;
    const delivered = receipt.logs
      .map((l) => { try { return iface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === 'MilestoneDelivered');
    expect(delivered.args.freelancer).to.equal(freelancer.address);
    expect(delivered.args.freelancer).to.not.equal(relayer.address);
    const m = await escrow.getMilestone(0, 0);
    expect(m.delivered).to.equal(true);
    expect(m.proof).to.equal('https://example.com/work-0');
  });

  it('relayed create: recorded client is the signer, not the relayer', async function () {
    const { escrow, forwarder, client, freelancer, relayer } = await deploy();
    const escrowAddr = await escrow.getAddress();
    const deadline = (await time.latest()) + 7 * 24 * 3600;
    const data = escrow.interface.encodeFunctionData('createEscrow', [freelancer.address, [M0, M1], deadline]);
    const request = await signRequest(forwarder, client, escrowAddr, data);
    await relay(forwarder, relayer, request);
    const e = await escrow.getEscrow(0);
    expect(e.client).to.equal(client.address);
    expect(e.client).to.not.equal(relayer.address);
    expect(e.freelancer).to.equal(freelancer.address);
  });

  it('relayed claimDelivered: freelancer claims via relayer after deadline and is paid', async function () {
    const { escrow, forwarder, client, freelancer, relayer } = await deploy();
    const deadline = await fundedEscrow(escrow, client, freelancer);
    await escrow.connect(freelancer).submitDelivery(0, 0, 'https://example.com/work-0');
    await time.increaseTo(deadline + 1);
    const escrowAddr = await escrow.getAddress();
    const data = escrow.interface.encodeFunctionData('claimDelivered', [0, 0]);
    const request = await signRequest(forwarder, freelancer, escrowAddr, data);
    await expect(forwarder.connect(relayer).execute(request))
      .to.changeEtherBalances([freelancer, escrow], [M0, -M0]);
    expect((await escrow.getMilestone(0, 0)).released).to.equal(true);
  });

  it('relayed release: third-party relayer releases an approved milestone to the freelancer', async function () {
    const { escrow, forwarder, client, freelancer, relayer } = await deploy();
    await fundedEscrow(escrow, client, freelancer);
    await escrow.connect(client).approveMilestone(0, 0);
    const escrowAddr = await escrow.getAddress();
    const data = escrow.interface.encodeFunctionData('releaseMilestone', [0, 0]);
    const request = await signRequest(forwarder, client, escrowAddr, data);
    await expect(forwarder.connect(relayer).execute(request))
      .to.changeEtherBalances([freelancer, escrow], [M0, -M0]);
  });

  it('security: forged signature reverts, replay reverts, direct spoof still blocked', async function () {
    const { escrow, forwarder, client, freelancer, other, relayer } = await deploy();
    await fundedEscrow(escrow, client, freelancer);
    const escrowAddr = await escrow.getAddress();

    // Forged: signature over approve(0,0) but data swapped to approve(0,1).
    const good = await signRequest(forwarder, client, escrowAddr,
      escrow.interface.encodeFunctionData('approveMilestone', [0, 0]));
    const forged = { ...good, data: escrow.interface.encodeFunctionData('approveMilestone', [0, 1]) };
    expect(await forwarder.verify(forged)).to.equal(false);
    await expect(forwarder.connect(relayer).execute(forged))
      .to.be.revertedWithCustomError(forwarder, 'ERC2771ForwarderInvalidSigner');

    // Replay: the same valid request executes once, then the nonce is spent.
    await relay(forwarder, relayer, good);
    await expect(forwarder.connect(relayer).execute(good)).to.be.reverted;

    // Direct spoof: calling the escrow directly as someone else still fails,
    // because _msgSender() == msg.sender off the forwarder path.
    await expect(escrow.connect(other).approveMilestone(0, 1))
      .to.be.revertedWithCustomError(escrow, 'NotClient');
    await expect(escrow.connect(other).submitDelivery(0, 1, 'https://example.com/x'))
      .to.be.revertedWithCustomError(escrow, 'NotFreelancer');
  });

  it('relayed refund: client refunds undelivered funds via relayer after deadline', async function () {
    const { escrow, forwarder, client, freelancer, relayer } = await deploy();
    const deadline = await fundedEscrow(escrow, client, freelancer);
    await escrow.connect(client).approveMilestone(0, 0);
    await escrow.connect(client).releaseMilestone(0, 0); // 0.6 paid, 0.4 refundable
    await time.increaseTo(deadline + 1);
    const escrowAddr = await escrow.getAddress();
    const data = escrow.interface.encodeFunctionData('refund', [0]);
    const request = await signRequest(forwarder, client, escrowAddr, data);
    await expect(forwarder.connect(relayer).execute(request))
      .to.changeEtherBalances([client, escrow], [M1, -M1]);
  });
});
