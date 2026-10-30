const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const ONE = ethers.parseEther('1');
const M0 = ethers.parseEther('0.6');
const M1 = ethers.parseEther('0.4');

async function deploy() {
  const [client, freelancer, resolver, other] = await ethers.getSigners();
  const Forwarder = await ethers.getContractFactory('SafePayForwarder');
  const forwarder = await Forwarder.deploy();
  await forwarder.waitForDeployment();
  const Factory = await ethers.getContractFactory('SafePayEscrow');
  const escrow = await Factory.deploy(await forwarder.getAddress());
  await escrow.waitForDeployment();
  return { escrow, client, freelancer, resolver, other };
}

async function fundedEscrow(escrow, client, freelancer, resolver) {
  const deadline = (await time.latest()) + 7 * 24 * 3600;
  if (resolver) {
    await escrow
      .connect(client)
      .createEscrowWithResolver(freelancer.address, [M0, M1], deadline, resolver.address);
  } else {
    await escrow.connect(client).createEscrow(freelancer.address, [M0, M1], deadline);
  }
  await escrow.connect(client).fund(0, { value: ONE });
  return deadline;
}

describe('SafePayEscrow disputes', function () {
  it('raise: either party can raise with a reason; state is readable via getDispute', async function () {
    const { escrow, client, freelancer, resolver } = await deploy();
    await fundedEscrow(escrow, client, freelancer, resolver);
    await expect(escrow.connect(freelancer).raiseDispute(0, 'Work delivered, client silent'))
      .to.emit(escrow, 'DisputeRaised')
      .withArgs(0, freelancer.address, 'Work delivered, client silent');
    const d = await escrow.getDispute(0);
    expect(d.resolver).to.equal(resolver.address);
    expect(d.disputed).to.equal(true);
    expect(d.disputeResolved).to.equal(false);
    expect(d.disputeRaisedBy).to.equal(freelancer.address);
    expect(d.disputeReason).to.equal('Work delivered, client silent');
  });

  it('raise: default resolver is the client; zero-address resolver falls back to client', async function () {
    const { escrow, client, freelancer } = await deploy();
    await fundedEscrow(escrow, client, freelancer, null);
    expect((await escrow.getDispute(0)).resolver).to.equal(client.address);
    const deadline = (await time.latest()) + 3600;
    await escrow
      .connect(client)
      .createEscrowWithResolver(freelancer.address, [M0], deadline, ethers.ZeroAddress);
    expect((await escrow.getDispute(1)).resolver).to.equal(client.address);
  });

  it('raise: non-party cannot raise; empty reason rejected; double dispute rejected', async function () {
    const { escrow, client, freelancer, resolver, other } = await deploy();
    await fundedEscrow(escrow, client, freelancer, resolver);
    await expect(escrow.connect(other).raiseDispute(0, 'not my escrow')).to.be.revertedWithCustomError(
      escrow,
      'NotParty'
    );
    await expect(escrow.connect(client).raiseDispute(0, '')).to.be.revertedWithCustomError(
      escrow,
      'EmptyDisputeReason'
    );
    await escrow.connect(client).raiseDispute(0, 'quality issue');
    await expect(escrow.connect(freelancer).raiseDispute(0, 'again')).to.be.revertedWithCustomError(
      escrow,
      'AlreadyDisputed'
    );
  });

  it('freeze: disputed escrow blocks release, deadline claim, and refund', async function () {
    const { escrow, client, freelancer, resolver } = await deploy();
    const deadline = await fundedEscrow(escrow, client, freelancer, resolver);
    await escrow.connect(freelancer).submitDelivery(0, 0, 'https://example.com/work-0');
    await escrow.connect(client).approveMilestone(0, 0);
    await escrow.connect(client).raiseDispute(0, 'milestone quality disputed');
    await expect(escrow.connect(client).releaseMilestone(0, 0)).to.be.revertedWithCustomError(
      escrow,
      'EscrowDisputed'
    );
    await time.increaseTo(deadline + 1);
    await expect(
      escrow.connect(freelancer).claimDelivered(0, 0)
    ).to.be.revertedWithCustomError(escrow, 'EscrowDisputed');
    await expect(escrow.connect(client).refund(0)).to.be.revertedWithCustomError(
      escrow,
      'EscrowDisputed'
    );
  });

  it('resolve: non-resolver cannot resolve; resolver can release everything to freelancer', async function () {
    const { escrow, client, freelancer, resolver, other } = await deploy();
    await fundedEscrow(escrow, client, freelancer, resolver);
    await escrow.connect(freelancer).raiseDispute(0, 'payment withheld');
    await expect(escrow.connect(client).resolveDispute(0, true)).to.be.revertedWithCustomError(
      escrow,
      'NotResolver'
    );
    await expect(escrow.connect(other).resolveDispute(0, true)).to.be.revertedWithCustomError(
      escrow,
      'NotResolver'
    );
    await expect(escrow.connect(resolver).resolveDispute(0, true))
      .to.emit(escrow, 'DisputeResolved')
      .withArgs(0, resolver.address, true, ONE);
    await expect(escrow.connect(resolver).resolveDispute(0, true)).to.be.revertedWithCustomError(
      escrow,
      'NotDisputed'
    );
    const e = await escrow.getEscrow(0);
    expect(e.releasedAmount).to.equal(ONE);
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
    const d = await escrow.getDispute(0);
    expect(d.disputed).to.equal(false);
    expect(d.disputeResolved).to.equal(true);
  });

  it('resolve: resolver can refund the remaining balance to the client', async function () {
    const { escrow, client, freelancer, resolver } = await deploy();
    await fundedEscrow(escrow, client, freelancer, resolver);
    await escrow.connect(client).approveMilestone(0, 0);
    await escrow.connect(client).releaseMilestone(0, 0); // 0.6 paid, 0.4 held
    await escrow.connect(client).raiseDispute(0, 'second milestone never delivered');
    await expect(escrow.connect(resolver).resolveDispute(0, false))
      .to.changeEtherBalances([client, escrow], [M1, -M1]);
    const e = await escrow.getEscrow(0);
    expect(e.refundedAmount).to.equal(M1);
    expect(e.releasedAmount).to.equal(M0);
  });

  it('resolve: client-as-default-resolver can settle a dispute it raised', async function () {
    const { escrow, client, freelancer } = await deploy();
    await fundedEscrow(escrow, client, freelancer, null);
    await escrow.connect(client).raiseDispute(0, 'default resolver path');
    await expect(escrow.connect(client).resolveDispute(0, false))
      .to.changeEtherBalances([client, escrow], [ONE, -ONE]);
  });

  it('raise: dispute after completion is rejected', async function () {
    const { escrow, client, freelancer, resolver } = await deploy();
    await fundedEscrow(escrow, client, freelancer, resolver);
    await escrow.connect(client).approveMilestone(0, 0);
    await escrow.connect(client).approveMilestone(0, 1);
    await escrow.connect(client).releaseMilestone(0, 0);
    await escrow.connect(client).releaseMilestone(0, 1);
    await expect(escrow.connect(client).raiseDispute(0, 'too late')).to.be.revertedWithCustomError(
      escrow,
      'EscrowCompleted'
    );
  });

  it('raise: dispute on an unfunded escrow is rejected', async function () {
    const { escrow, client, freelancer, resolver } = await deploy();
    const deadline = (await time.latest()) + 3600;
    await escrow
      .connect(client)
      .createEscrowWithResolver(freelancer.address, [M0], deadline, resolver.address);
    await expect(escrow.connect(client).raiseDispute(0, 'no funds yet')).to.be.revertedWithCustomError(
      escrow,
      'NotFunded'
    );
  });
});
