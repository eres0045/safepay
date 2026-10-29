// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/// @title SafePayForwarder — the trusted ERC-2771 forwarder for SafePayEscrow.
/// @notice Thin wrapper around OpenZeppelin's ERC2771Forwarder so the
///         forwarder is a first-class project artifact (Hardhat only
///         compiles contracts/ by default). EIP-712 domain: name
///         "SafePayForwarder", version "1". A user signs a ForwardRequest
///         (from, to, value, gas, nonce, deadline, data); the relayer
///         submits it via execute() and pays the gas. The forwarder appends
///         the signer's address to the calldata, and SafePayEscrow recovers
///         it via ERC2771Context._msgSender() — so access checks still see
///         the real user, never the relayer.
contract SafePayForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("SafePayForwarder") {}
}
