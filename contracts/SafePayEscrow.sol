// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SafePayEscrow — freelance escrow on MST Blockchain
/// @notice A client locks native MSTC/tMSTC for a freelancer across milestones.
///         Funds release per milestone only after the client approves it.
///         Unreleased funds return to the client after the deadline.
///         Tight MVP scope: native currency only, one client + one freelancer
///         per escrow, milestones fixed at creation.
contract SafePayEscrow is ReentrancyGuard {
    struct Milestone {
        uint256 amount;
        bool approved;
        bool released;
    }

    struct Escrow {
        address client;
        address freelancer;
        uint256 deadline;
        uint256 totalAmount;
        uint256 fundedAmount;
        uint256 releasedAmount;
        uint256 refundedAmount;
        bool funded;
        Milestone[] milestones;
    }

    uint256 public nextEscrowId;
    mapping(uint256 => Escrow) private escrows;

    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed client,
        address indexed freelancer,
        uint256 totalAmount,
        uint256 deadline
    );
    event EscrowFunded(uint256 indexed escrowId, uint256 amount);
    event MilestoneApproved(uint256 indexed escrowId, uint256 indexed milestoneIndex);
    event MilestoneReleased(
        uint256 indexed escrowId,
        uint256 indexed milestoneIndex,
        address indexed freelancer,
        uint256 amount
    );
    event EscrowRefunded(uint256 indexed escrowId, address indexed client, uint256 amount);

    error InvalidFreelancer();
    error EmptyMilestones();
    error ZeroMilestoneAmount();
    error NotClient();
    error AlreadyFunded();
    error NotFunded();
    error IncorrectFundingAmount(uint256 expected, uint256 received);
    error InvalidMilestone();
    error MilestoneAlreadyApproved();
    error MilestoneNotApproved();
    error MilestoneAlreadyReleased();
    error DeadlineNotReached();
    error NothingToRefund();
    error TransferFailed();

    modifier onlyClient(uint256 escrowId) {
        if (msg.sender != escrows[escrowId].client) revert NotClient();
        _;
    }

    /// @notice Create an escrow. Funding is a separate step (fund()).
    /// @param freelancer The freelancer who will receive released funds.
    /// @param amounts Per-milestone amounts in wei. Must be non-empty, all > 0.
    /// @param deadline Unix timestamp after which unreleased funds become refundable.
    /// @return escrowId The new escrow id.
    function createEscrow(
        address freelancer,
        uint256[] calldata amounts,
        uint256 deadline
    ) external returns (uint256 escrowId) {
        if (freelancer == address(0) || freelancer == msg.sender) revert InvalidFreelancer();
        if (amounts.length == 0) revert EmptyMilestones();

        uint256 total = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] == 0) revert ZeroMilestoneAmount();
            total += amounts[i];
        }

        escrowId = nextEscrowId++;
        Escrow storage e = escrows[escrowId];
        e.client = msg.sender;
        e.freelancer = freelancer;
        e.deadline = deadline;
        e.totalAmount = total;
        for (uint256 i = 0; i < amounts.length; i++) {
            e.milestones.push(Milestone({amount: amounts[i], approved: false, released: false}));
        }

        emit EscrowCreated(escrowId, msg.sender, freelancer, total, deadline);
    }

    /// @notice Lock the full milestone total into the escrow. Client only, exact amount.
    function fund(uint256 escrowId) external payable onlyClient(escrowId) nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.funded) revert AlreadyFunded();
        if (msg.value != e.totalAmount) {
            revert IncorrectFundingAmount(e.totalAmount, msg.value);
        }
        e.funded = true;
        e.fundedAmount = msg.value;
        emit EscrowFunded(escrowId, msg.value);
    }

    /// @notice Client approves one milestone. Approval alone does not move funds.
    function approveMilestone(uint256 escrowId, uint256 milestoneIndex) external onlyClient(escrowId) {
        Escrow storage e = escrows[escrowId];
        if (!e.funded) revert NotFunded();
        if (milestoneIndex >= e.milestones.length) revert InvalidMilestone();
        Milestone storage m = e.milestones[milestoneIndex];
        if (m.approved) revert MilestoneAlreadyApproved();
        if (m.released) revert MilestoneAlreadyReleased();
        m.approved = true;
        emit MilestoneApproved(escrowId, milestoneIndex);
    }

    /// @notice Release an approved milestone's funds to the freelancer. Anyone may call.
    function releaseMilestone(uint256 escrowId, uint256 milestoneIndex) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (!e.funded) revert NotFunded();
        if (milestoneIndex >= e.milestones.length) revert InvalidMilestone();
        Milestone storage m = e.milestones[milestoneIndex];
        if (!m.approved) revert MilestoneNotApproved();
        if (m.released) revert MilestoneAlreadyReleased();
        m.released = true;
        e.releasedAmount += m.amount;
        (bool ok, ) = payable(e.freelancer).call{value: m.amount}("");
        if (!ok) revert TransferFailed();
        emit MilestoneReleased(escrowId, milestoneIndex, e.freelancer, m.amount);
    }

    /// @notice After the deadline, return all still-unreleased funds to the client.
    /// @dev Only unapproved/unreleased milestones are refundable; released funds stay paid.
    function refund(uint256 escrowId) external onlyClient(escrowId) nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (!e.funded) revert NotFunded();
        if (block.timestamp < e.deadline) revert DeadlineNotReached();
        uint256 refundable = e.fundedAmount - e.releasedAmount - e.refundedAmount;
        if (refundable == 0) revert NothingToRefund();
        e.refundedAmount += refundable;
        (bool ok, ) = payable(e.client).call{value: refundable}("");
        if (!ok) revert TransferFailed();
        emit EscrowRefunded(escrowId, e.client, refundable);
    }

    // ---- Views ----

    function getEscrow(uint256 escrowId)
        external
        view
        returns (
            address client,
            address freelancer,
            uint256 deadline,
            uint256 totalAmount,
            uint256 fundedAmount,
            uint256 releasedAmount,
            uint256 refundedAmount,
            bool funded,
            uint256 milestoneCount
        )
    {
        Escrow storage e = escrows[escrowId];
        return (
            e.client,
            e.freelancer,
            e.deadline,
            e.totalAmount,
            e.fundedAmount,
            e.releasedAmount,
            e.refundedAmount,
            e.funded,
            e.milestones.length
        );
    }

    function getMilestone(uint256 escrowId, uint256 milestoneIndex)
        external
        view
        returns (uint256 amount, bool approved, bool released)
    {
        Escrow storage e = escrows[escrowId];
        if (milestoneIndex >= e.milestones.length) revert InvalidMilestone();
        Milestone storage m = e.milestones[milestoneIndex];
        return (m.amount, m.approved, m.released);
    }
}
