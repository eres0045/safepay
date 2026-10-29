const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const ONE = ethers.parseEther('1');
const M0 = ethers.parseEther('0.6');
const M1 = ethers.parseEther('0.4');

async function deploy() {
  const [client, freelancer, other] = await ethers.getSigners();
  // Relayer-enabled deployment: a trusted forwarder first, then the escrow
  // trusting it. Direct calls still behave exactly as before (v2 path).
  const Forwarder = await ethers.getContractFactory('SafePayForwarder');
  const forwarder = await Forwarder.deploy();
  await forwarder.waitForDeployment();
  const Factory = await ethers.getContractFactory('SafePayEscrow');
  const escrow = await Factory.deploy(await forwarder.getAddress());
  await escrow.waitForDeployment();
  return { escrow, forwarder, client, freelancer, other };
}

async function fundedEscrow(escrow, client, freelancer) {
  const deadline = (await time.latest()) + 7 * 24 * 3600;
  await escrow.connect(client).createEscrow(freelancer.address, [M0, M1], deadline);
  await escrow.connect(client).fund(0, { value: ONE });
  return deadline;
}

describe('SafePayEscrow', function () {
  it('create: records client, freelancer, totals, milestone count; emits event', async function () {
    const { escrow, client, freelancer } = await deploy();
    const deadline = (await time.latest()) + 7 * 24 * 3600;
    await expect(escrow.connect(client).createEscrow(freelancer.address, [M0, M1], deadline))
      .to.emit(escrow, 'EscrowCreated')
      .withArgs(0, client.address, freelancer.address, ONE, deadline);
    const e = await escrow.getEscrow(0);
    expect(e.client).to.equal(client.address);
    expect(e.freelancer).to.equal(freelancer.address);
    expect(e.totalAmount).to.equal(ONE);
    expect(e.milestoneCount).to.equal(2);
    expect(e.funded).to.equal(false);
  });

  it('create: reverts on bad inputs', async function () {
    const { escrow, client, freelancer } = await deploy();
    const deadline = (await time.latest()) + 3600;
    await expect(
      escrow.connect(client).createEscrow(ethers.ZeroAddress, [M0], deadline)
    ).to.be.revertedWithCustomError(escrow, 'InvalidFreelancer');
    await expect(
      escrow.connect(client).createEscrow(client.address, [M0], deadline)
    ).to.be.revertedWithCustomError(escrow, 'InvalidFreelancer');
    await expect(
      escrow.connect(client).createEscrow(freelancer.address, [], deadline)
    ).to.be.revertedWithCustomError(escrow, 'EmptyMilestones');
    await expect(
      escrow.connect(client).createEscrow(freelancer.address, [M0, 0], deadline)
    ).to.be.revertedWithCustomError(escrow, 'ZeroMilestoneAmount');
  });

  it('fund: exact amount only, client only, once', async function () {
    const { escrow, client, freelancer, other } = await deploy();
    const deadline = (await time.latest()) + 3600;
    await escrow.connect(client).createEscrow(freelancer.address, [M0, M1], deadline);
    await expect(
      escrow.connect(other).fund(0, { value: ONE })
    ).to.be.revertedWithCustomError(escrow, 'NotClient');
    await expect(
      escrow.connect(client).fund(0, { value: M0 })
    ).to.be.revertedWithCustomError(escrow, 'IncorrectFundingAmount');
    await expect(escrow.connect(client).fund(0, { value: ONE }))
      .to.emit(escrow, 'EscrowFunded')
      .withArgs(0, ONE);
    await expect(
      escrow.connect(client).fund(0, { value: ONE })
    ).to.be.revertedWithCustomError(escrow, 'AlreadyFunded');
  });

  it('approve+release: client approves, freelancer is paid exactly, no double-spend', async function () {
    const { escrow, client, freelancer, other } = await deploy();
    await fundedEscrow(escrow, client, freelancer);
    await expect(
      escrow.connect(other).approveMilestone(0, 0)
    ).to.be.revertedWithCustomError(escrow, 'NotClient');
    await expect(
      escrow.connect(client).releaseMilestone(0, 0)
    ).to.be.revertedWithCustomError(escrow, 'MilestoneNotApproved');
    await expect(escrow.connect(client).approveMilestone(0, 0))
      .to.emit(escrow, 'MilestoneApproved')
      .withArgs(0, 0);
    await expect(
      escrow.connect(client).approveMilestone(0, 0)
    ).to.be.revertedWithCustomError(escrow, 'MilestoneAlreadyApproved');
    await expect(
      escrow.connect(client).releaseMilestone(0, 0)
    ).to.changeEtherBalances([freelancer, escrow], [M0, -M0]);
    await expect(
      escrow.connect(client).releaseMilestone(0, 0)
    ).to.be.revertedWithCustomError(escrow, 'MilestoneAlreadyReleased');
  });

  it('refund: blocked before deadline, returns unreleased funds after deadline', async function () {
    const { escrow, client, freelancer } = await deploy();
    const deadline = await fundedEscrow(escrow, client, freelancer);
    await escrow.connect(client).approveMilestone(0, 0);
    await escrow.connect(client).releaseMilestone(0, 0); // 0.6 paid, 0.4 locked
    await expect(
      escrow.connect(client).refund(0)
    ).to.be.revertedWithCustomError(escrow, 'DeadlineNotReached');
    await time.increaseTo(deadline + 1);
    await expect(escrow.connect(client).refund(0))
      .to.changeEtherBalances([client, escrow], [M1, -M1]);
    await expect(
      escrow.connect(client).refund(0)
    ).to.be.revertedWithCustomError(escrow, 'NothingToRefund');
  });

  it('e2e: create -> fund -> approve all -> release all drains escrow to freelancer', async function () {
    const { escrow, client, freelancer } = await deploy();
    await fundedEscrow(escrow, client, freelancer);
    await escrow.connect(client).approveMilestone(0, 0);
    await escrow.connect(client).approveMilestone(0, 1);
    await escrow.connect(client).releaseMilestone(0, 0);
    await expect(escrow.connect(client).releaseMilestone(0, 1))
      .to.changeEtherBalances([freelancer, escrow], [M1, -M1]);
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
    const e = await escrow.getEscrow(0);
    expect(e.releasedAmount).to.equal(ONE);
  });

  it('delivery: freelancer records delivery with proof; others cannot; no double delivery', async function () {
    const { escrow, client, freelancer, other } = await deploy();
    await fundedEscrow(escrow, client, freelancer);
    await expect(
      escrow.connect(other).submitDelivery(0, 0, 'https://example.com/work')
    ).to.be.revertedWithCustomError(escrow, 'NotFreelancer');
    await expect(
      escrow.connect(client).submitDelivery(0, 0, 'https://example.com/work')
    ).to.be.revertedWithCustomError(escrow, 'NotFreelancer');
    await expect(escrow.connect(freelancer).submitDelivery(0, 0, 'https://example.com/work-0'))
      .to.emit(escrow, 'MilestoneDelivered')
      .withArgs(0, 0, freelancer.address, 'https://example.com/work-0');
    const m = await escrow.getMilestone(0, 0);
    expect(m.delivered).to.equal(true);
    expect(m.proof).to.equal('https://example.com/work-0');
    await expect(
      escrow.connect(freelancer).submitDelivery(0, 0, 'https://example.com/again')
    ).to.be.revertedWithCustomError(escrow, 'MilestoneAlreadyDelivered');
    await escrow.connect(client).approveMilestone(0, 1);
    await escrow.connect(client).releaseMilestone(0, 1);
    await expect(
      escrow.connect(freelancer).submitDelivery(0, 1, 'https://example.com/late')
    ).to.be.revertedWithCustomError(escrow, 'MilestoneAlreadyReleased');
  });

  it('delivery: rejected before funding and after the deadline', async function () {
    const { escrow, client, freelancer } = await deploy();
    const deadline = (await time.latest()) + 3600;
    await escrow.connect(client).createEscrow(freelancer.address, [M0, M1], deadline);
    await expect(
      escrow.connect(freelancer).submitDelivery(0, 0, 'https://example.com/work')
    ).to.be.revertedWithCustomError(escrow, 'NotFunded');
    await escrow.connect(client).fund(0, { value: ONE });
    await time.increaseTo(deadline + 1);
    await expect(
      escrow.connect(freelancer).submitDelivery(0, 0, 'https://example.com/work')
    ).to.be.revertedWithCustomError(escrow, 'DeadlinePassed');
  });

  it('claimDelivered: delivered work is claimable after deadline even without approval', async function () {
    const { escrow, client, freelancer } = await deploy();
    const deadline = await fundedEscrow(escrow, client, freelancer);
    await escrow.connect(freelancer).submitDelivery(0, 0, 'https://example.com/work-0');
    await expect(
      escrow.connect(freelancer).claimDelivered(0, 0)
    ).to.be.revertedWithCustomError(escrow, 'DeadlineNotReached');
    await expect(
      escrow.connect(freelancer).claimDelivered(0, 1)
    ).to.be.revertedWithCustomError(escrow, 'DeadlineNotReached');
    await time.increaseTo(deadline + 1);
    await expect(
      escrow.connect(freelancer).claimDelivered(0, 1)
    ).to.be.revertedWithCustomError(escrow, 'MilestoneNotDelivered');
    await expect(escrow.connect(freelancer).claimDelivered(0, 0))
      .to.changeEtherBalances([freelancer, escrow], [M0, -M0]);
    await expect(
      escrow.connect(freelancer).claimDelivered(0, 0)
    ).to.be.revertedWithCustomError(escrow, 'MilestoneAlreadyReleased');
  });

  it('refund lock: approved and delivered funds are NOT refundable; unlocked funds are', async function () {
    const { escrow, client, freelancer } = await deploy();
    const deadline = (await time.latest()) + 7 * 24 * 3600;
    await escrow.connect(client).createEscrow(freelancer.address, [M0, M1, M0], deadline);
    const total = M0 + M1 + M0;
    await escrow.connect(client).fund(0, { value: total });
    await escrow.connect(freelancer).submitDelivery(0, 1, 'https://example.com/work-1');
    await escrow.connect(client).approveMilestone(0, 0);
    await escrow.connect(client).releaseMilestone(0, 0); // 0.6 paid
    await time.increaseTo(deadline + 1);
    // Only milestone 2 (0.6, untouched) is refundable; 0.4 delivered is locked.
    await expect(escrow.connect(client).refund(0))
      .to.changeEtherBalances([client, escrow], [M0, -M0]);
    await expect(
      escrow.connect(client).refund(0)
    ).to.be.revertedWithCustomError(escrow, 'NothingToRefund');
    await expect(escrow.connect(freelancer).claimDelivered(0, 1))
      .to.changeEtherBalances([freelancer, escrow], [M1, -M1]);
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
  });

  it('refund lock: fully approved+delivered escrow refunds nothing', async function () {
    const { escrow, client, freelancer } = await deploy();
    const deadline = await fundedEscrow(escrow, client, freelancer);
    await escrow.connect(freelancer).submitDelivery(0, 1, 'https://example.com/work-1');
    await escrow.connect(client).approveMilestone(0, 0); // approved, not released
    await time.increaseTo(deadline + 1);
    await expect(
      escrow.connect(client).refund(0)
    ).to.be.revertedWithCustomError(escrow, 'NothingToRefund');
    await escrow.connect(client).releaseMilestone(0, 0);
    await escrow.connect(freelancer).claimDelivered(0, 1);
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
  });
});
