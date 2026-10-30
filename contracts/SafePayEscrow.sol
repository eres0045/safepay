// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/// @title SafePayEscrow — freelance escrow on MST Blockchain
/// @notice A client locks native MSTC/tMSTC for a freelancer across milestones.
///         Funds release per milestone only after the client approves it.
///         The freelancer records delivery on-chain with proof. If work was
///         delivered before the deadline and the client never approves it,
///         the freelancer can claim it after the deadline — a ghosting client
///         cannot claw back delivered work via refund.
///         Unreleased, unapproved, undelivered funds return to the client
///         after the deadline. Tight MVP scope: native currency only, one
///         client + one freelancer per escrow, milestones fixed at creation.
///
///         DISPUTES (Demo Day build, Oct 2026): either party may raise a
///         dispute on a funded, unsettled escrow with a reason. While
///         disputed, every fund-moving call (release, deadline claim,
///         refund) is frozen. A designated resolver — set at escrow
///         creation, see createEscrowWithResolver — settles the WHOLE
///         remaining balance in one direction: to the freelancer (release)
///         or back to the client (refund). HONEST LIMIT: the default
///         resolver is the client (createEscrow keeps its old signature
///         and passes no resolver), and a client-as-resolver is NOT a
///         neutral arbitrator — it lets the client unilaterally decide a
///         dispute it is party to. For any real use, pass an independent
///         arbitrator address via createEscrowWithResolver; passing the
///         zero address there also falls back to the client, by design.
///
///         RELAYER (gasless) support: this contract trusts one ERC-2771
///         forwarder (set at deployment, immutable). When a call arrives via
///         that forwarder, _msgSender() returns the ORIGINAL signer, not the
///         relayer — so every onlyClient / onlyFreelancer check still sees the
///         real user. Direct calls are unaffected (_msgSender() == msg.sender
///         whenever the caller is not the trusted forwarder). Funding is
///         intentionally NOT relayable with value: the relayer service rejects
///         value-bearing requests, because moving a user's own escrow funds
///         through a third party would defeat the escrow's purpose; the gas
///         for create/approve/deliver/claim/release/refund can be relayed.
contract SafePayEscrow is ReentrancyGuard, ERC2771Context {
    struct Milestone {
        uint256 amount;
        bool approved;
        bool released;
        bool delivered;
        string proof;
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
        // Dispute state (see contract notice). disputeReason is kept after
        // resolution so the history stays readable on-chain.
        address resolver;
        bool disputed;
        bool disputeResolved;
        address disputeRaisedBy;
        string disputeReason;
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
    event MilestoneDelivered(
        uint256 indexed escrowId,
        uint256 indexed milestoneIndex,
        address indexed freelancer,
        string proof
    );
    event MilestoneReleased(
        uint256 indexed escrowId,
        uint256 indexed milestoneIndex,
        address indexed freelancer,
        uint256 amount
    );
    event EscrowRefunded(uint256 indexed escrowId, address indexed client, uint256 amount);
    event DisputeRaised(uint256 indexed escrowId, address indexed raisedBy, string reason);
    event DisputeResolved(
        uint256 indexed escrowId,
        address indexed resolver,
        bool releaseToFreelancer,
        uint256 amount
    );

    error InvalidFreelancer();
    error EmptyMilestones();
    error ZeroMilestoneAmount();
    error NotClient();
    error NotFreelancer();
    error AlreadyFunded();
    error NotFunded();
    error IncorrectFundingAmount(uint256 expected, uint256 received);
    error InvalidMilestone();
    error MilestoneAlreadyApproved();
    error MilestoneNotApproved();
    error MilestoneAlreadyReleased();
    error MilestoneAlreadyDelivered();
    error MilestoneNotDelivered();
    error DeadlineNotReached();
    error DeadlinePassed();
    error NothingToRefund();
    error TransferFailed();
    error NotParty();
    error NotResolver();
    error AlreadyDisputed();
    error NotDisputed();
    error EscrowDisputed();
    error EscrowCompleted();
    error EmptyDisputeReason();
    error NothingToResolve();

    modifier onlyClient(uint256 escrowId) {
        if (_msgSender() != escrows[escrowId].client) revert NotClient();
        _;
    }

    modifier onlyFreelancer(uint256 escrowId) {
        if (_msgSender() != escrows[escrowId].freelancer) revert NotFreelancer();
        _;
    }

    /// @notice The trusted forwarder is fixed at deployment. Direct calls
    ///         (the original v2 path) keep working unchanged.
    constructor(address trustedForwarder) ERC2771Context(trustedForwarder) {}

    /// @notice Create an escrow. Funding is a separate step (fund()).
    /// @param freelancer The freelancer who will receive released funds.
    /// @param amounts Per-milestone amounts in wei. Must be non-empty, all > 0.
    /// @param deadline Unix timestamp after which unreleased funds become refundable
    ///        (and delivered-but-unapproved milestones become claimable).
    /// @return escrowId The new escrow id.
    /// @dev Dispute resolver defaults to the client (NOT neutral — see the
    ///      contract notice). Use createEscrowWithResolver for a real
    ///      arbitrator.
    function createEscrow(
        address freelancer,
        uint256[] calldata amounts,
        uint256 deadline
    ) external returns (uint256 escrowId) {
        return _createEscrow(freelancer, amounts, deadline, _msgSender());
    }

    /// @notice Create an escrow with a designated dispute resolver.
    /// @param resolver An independent arbitrator address. Passing the zero
    ///        address falls back to the client (documented, not neutral).
    function createEscrowWithResolver(
        address freelancer,
        uint256[] calldata amounts,
        uint256 deadline,
        address resolver
    ) external returns (uint256 escrowId) {
        return _createEscrow(
            freelancer,
            amounts,
            deadline,
            resolver == address(0) ? _msgSender() : resolver
        );
    }

    function _createEscrow(
        address freelancer,
        uint256[] calldata amounts,
        uint256 deadline,
        address resolver
    ) internal returns (uint256 escrowId) {
        if (freelancer == address(0) || freelancer == _msgSender()) revert InvalidFreelancer();
        if (amounts.length == 0) revert EmptyMilestones();

        uint256 total = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] == 0) revert ZeroMilestoneAmount();
            total += amounts[i];
        }

        escrowId = nextEscrowId++;
        Escrow storage e = escrows[escrowId];
        e.client = _msgSender();
        e.freelancer = freelancer;
        e.deadline = deadline;
        e.totalAmount = total;
        e.resolver = resolver;
        for (uint256 i = 0; i < amounts.length; i++) {
            e.milestones.push(
                Milestone({amount: amounts[i], approved: false, released: false, delivered: false, proof: ""})
            );
        }

        emit EscrowCreated(escrowId, _msgSender(), freelancer, total, deadline);
    }

    /// @notice Either party raises a dispute, freezing all fund movement.
    /// @dev Rejected on unfunded escrows and on completed escrows (every
    ///      milestone already released, or nothing left to settle).
    function raiseDispute(uint256 escrowId, string calldata reason) external {
        Escrow storage e = escrows[escrowId];
        address sender = _msgSender();
        if (sender != e.client && sender != e.freelancer) revert NotParty();
        if (!e.funded) revert NotFunded();
        if (e.disputed) revert AlreadyDisputed();
        if (_isComplete(e)) revert EscrowCompleted();
        if (bytes(reason).length == 0) revert EmptyDisputeReason();
        e.disputed = true;
        e.disputeRaisedBy = sender;
        e.disputeReason = reason;
        emit DisputeRaised(escrowId, sender, reason);
    }

    /// @notice The designated resolver settles the whole remaining balance
    ///         in one direction. Release = freelancer, refund = client.
    ///         Unreleased milestones are marked released on the freelancer
    ///         path so the accounting stays consistent.
    function resolveDispute(uint256 escrowId, bool releaseToFreelancer)
        external
        nonReentrant
    {
        Escrow storage e = escrows[escrowId];
        if (_msgSender() != e.resolver) revert NotResolver();
        if (!e.disputed) revert NotDisputed();
        uint256 remaining = e.fundedAmount - e.releasedAmount - e.refundedAmount;
        if (remaining == 0) revert NothingToResolve();
        e.disputed = false;
        e.disputeResolved = true;
        address payee;
        if (releaseToFreelancer) {
            for (uint256 i = 0; i < e.milestones.length; i++) {
                if (!e.milestones[i].released) e.milestones[i].released = true;
            }
            e.releasedAmount += remaining;
            payee = e.freelancer;
        } else {
            e.refundedAmount += remaining;
            payee = e.client;
        }
        (bool ok, ) = payable(payee).call{value: remaining}("");
        if (!ok) revert TransferFailed();
        emit DisputeResolved(escrowId, _msgSender(), releaseToFreelancer, remaining);
    }

    /// @notice Complete = nothing left to settle: every milestone released,
    ///         or the held balance is already fully released + refunded.
    function _isComplete(Escrow storage e) internal view returns (bool) {
        if (e.fundedAmount == 0) return false;
        if (e.fundedAmount - e.releasedAmount - e.refundedAmount == 0) return true;
        for (uint256 i = 0; i < e.milestones.length; i++) {
            if (!e.milestones[i].released) return false;
        }
        return true;
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

    /// @notice Freelancer records delivery of one milestone, with a proof link.
    ///         Delivery must happen before the deadline to count for a
    ///         deadline claim. Delivery alone does not move funds.
    function submitDelivery(
        uint256 escrowId,
        uint256 milestoneIndex,
        string calldata proof
    ) external onlyFreelancer(escrowId) {
        Escrow storage e = escrows[escrowId];
        if (!e.funded) revert NotFunded();
        if (milestoneIndex >= e.milestones.length) revert InvalidMilestone();
        if (block.timestamp >= e.deadline) revert DeadlinePassed();
        Milestone storage m = e.milestones[milestoneIndex];
        if (m.released) revert MilestoneAlreadyReleased();
        if (m.delivered) revert MilestoneAlreadyDelivered();
        m.delivered = true;
        m.proof = proof;
        emit MilestoneDelivered(escrowId, milestoneIndex, _msgSender(), proof);
    }

    /// @notice Release an approved milestone's funds to the freelancer. Anyone may call.
    function releaseMilestone(uint256 escrowId, uint256 milestoneIndex) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (!e.funded) revert NotFunded();
        if (e.disputed) revert EscrowDisputed();
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

    /// @notice After the deadline, the freelancer claims a milestone that was
    ///         delivered before the deadline but never approved. This is the
    ///         anti-ghosting path: delivered work cannot be refunded away.
    function claimDelivered(uint256 escrowId, uint256 milestoneIndex)
        external
        onlyFreelancer(escrowId)
        nonReentrant
    {
        Escrow storage e = escrows[escrowId];
        if (!e.funded) revert NotFunded();
        if (e.disputed) revert EscrowDisputed();
        if (milestoneIndex >= e.milestones.length) revert InvalidMilestone();
        if (block.timestamp < e.deadline) revert DeadlineNotReached();
        Milestone storage m = e.milestones[milestoneIndex];
        if (!m.delivered) revert MilestoneNotDelivered();
        if (m.released) revert MilestoneAlreadyReleased();
        m.released = true;
        e.releasedAmount += m.amount;
        (bool ok, ) = payable(e.freelancer).call{value: m.amount}("");
        if (!ok) revert TransferFailed();
        emit MilestoneReleased(escrowId, milestoneIndex, e.freelancer, m.amount);
    }

    /// @notice After the deadline, return still-unreleased funds to the client.
    /// @dev Approved-but-unreleased and delivered-but-unreleased milestones are
    ///      LOCKED: approved funds are owed to the freelancer, delivered funds
    ///      are claimable by the freelancer. Only unapproved, undelivered
    ///      funds are refundable. Released funds stay paid.
    function refund(uint256 escrowId) external onlyClient(escrowId) nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (!e.funded) revert NotFunded();
        if (e.disputed) revert EscrowDisputed();
        if (block.timestamp < e.deadline) revert DeadlineNotReached();
        uint256 locked = 0;
        for (uint256 i = 0; i < e.milestones.length; i++) {
            Milestone storage m = e.milestones[i];
            if (!m.released && (m.approved || m.delivered)) locked += m.amount;
        }
        uint256 refundable = e.fundedAmount - e.releasedAmount - e.refundedAmount - locked;
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

    /// @notice Dispute state for one escrow. resolver is the address that
    ///         may call resolveDispute; it defaults to the client unless
    ///         createEscrowWithResolver named someone else.
    function getDispute(uint256 escrowId)
        external
        view
        returns (
            address resolver,
            bool disputed,
            bool disputeResolved,
            address disputeRaisedBy,
            string memory disputeReason
        )
    {
        Escrow storage e = escrows[escrowId];
        return (e.resolver, e.disputed, e.disputeResolved, e.disputeRaisedBy, e.disputeReason);
    }

    function getMilestone(uint256 escrowId, uint256 milestoneIndex)
        external
        view
        returns (uint256 amount, bool approved, bool released, bool delivered, string memory proof)
    {
        Escrow storage e = escrows[escrowId];
        if (milestoneIndex >= e.milestones.length) revert InvalidMilestone();
        Milestone storage m = e.milestones[milestoneIndex];
        return (m.amount, m.approved, m.released, m.delivered, m.proof);
    }
}
