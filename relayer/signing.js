// Shared meta-transaction signing helper (Node side).
// Builds an OpenZeppelin ERC2771Forwarder ForwardRequest and signs it with
// EIP-712. The forwarder domain is: name "SafePayForwarder", version "1",
// chainId of the target network, verifyingContract = forwarder address.
// The signature covers the forwarder nonce, so every request is bound to
// one execution (replay-safe) and expires at `deadline`.
const { ethers } = require('ethers');

const FORWARDER_NAME = 'SafePayForwarder';
const FORWARDER_TYPES = {
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

const FORWARDER_ABI = [
  'function nonces(address owner) view returns (uint256)',
  'function verify(tuple(address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) view returns (bool)',
  'function execute(tuple(address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) payable',
];

function forwarderContract(address, providerOrSigner) {
  return new ethers.Contract(address, FORWARDER_ABI, providerOrSigner);
}

async function signForwardRequest({ forwarder, user, to, data, value = 0n, gas = 500000n, ttlSecs = 3600 }) {
  const nonce = await forwarder.nonces(user.address);
  // Runner may be a Wallet (has .provider) or a bare Provider.
  const provider = forwarder.runner.provider || forwarder.runner;
  const block = await provider.getBlock('latest');
  const deadline = block.timestamp + ttlSecs;
  const net = await provider.getNetwork();
  const domain = {
    name: FORWARDER_NAME,
    version: '1',
    chainId: net.chainId,
    verifyingContract: await forwarder.getAddress(),
  };
  const message = { from: user.address, to, value, gas, nonce, deadline, data };
  const signature = await user.signTypedData(domain, FORWARDER_TYPES, message);
  return { ...message, signature };
}

// Convert a request object to the tuple array ethers expects for
// verify()/execute() calls against the minimal ABI above.
function toTuple(request) {
  return [
    request.from,
    request.to,
    request.value,
    request.gas,
    request.deadline,
    request.data,
    request.signature,
  ];
}

module.exports = { FORWARDER_NAME, FORWARDER_TYPES, FORWARDER_ABI, forwarderContract, signForwardRequest, toTuple };
