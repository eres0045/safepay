// Gasless segment recording for the SafePay Round 2 video update.
// On camera (all real MST Testnet txs, no simulations):
//  1. Demo app (locally served, Phase 2 build) -> connect injected test wallet
//  2. Switch mode to "Gasless via relayer", Check relayer status -> "Relayer OK"
//  3. Approve milestone (gasless) on a pre-created, pre-funded relayer escrow
//     -> page shows "Relayed: <tx hash>" (relayer submitted, user paid no gas)
//  4. Read escrow -> milestone shows approved: true
// HONEST LIMIT: the connected wallet on camera is an injected test wallet,
// NOT the BridgeKey extension UI (which cannot be automated from this VM).
// Same limit as the original video. A BridgeKey on-camera pass remains the
// fully-compliant option. No private key is printed or saved by this script.
const net = require('net');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const { ethers } = require('ethers');

const APP_DIR = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/mst-safepay/app';
const PROJ = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/mst-safepay';
const OUT_DIR = '/home/hatch/workspace/harness-safepay';
const DEMO = 'http://127.0.0.1:8000/index.html';
const CHAIN_HEX = '0x5752035';
const RPC = 'https://testnetrpc.mstblockchain.com';
const RELAYER_ESCROW = '0xd75e0774942E0eC755f4caccD5eEdb3e216c3d6d';
const FORWARDER = '0x1Eb5bB559Dee94548e28c12Ae36105405BA209f9';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hex = v => typeof v === 'bigint' ? '0x' + v.toString(16) : v;

async function startForwarder() {
  const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
  const u = new URL(proxyUrl);
  const auth = Buffer.from(decodeURIComponent(u.username) + ':' + decodeURIComponent(u.password)).toString('base64');
  const server = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) return;
      sock.removeListener('data', onData);
      const firstLine = buf.subarray(0, buf.indexOf('\r\n')).toString();
      const m = firstLine.match(/^CONNECT ([^ ]+) /);
      if (!m) { sock.end(); return; }
      const rest = buf.subarray(end + 4);
      const up = net.connect(Number(u.port || 3128), u.hostname, () => {
        up.write(`CONNECT ${m[1]} HTTP/1.1\r\nHost: ${m[1]}\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`);
        let hbuf = Buffer.alloc(0);
        const onHead = c => {
          hbuf = Buffer.concat([hbuf, c]);
          if (hbuf.indexOf('\r\n\r\n') === -1) return;
          up.removeListener('data', onHead);
          sock.write(hbuf);
          if (rest.length) up.write(rest);
          sock.pipe(up); up.pipe(sock);
        };
        up.on('data', onHead);
      });
      up.on('error', () => sock.end());
      sock.on('error', () => up.end());
    };
    sock.on('data', onData);
  });
  await new Promise(r => server.listen(3129, '127.0.0.1', r));
  return server;
}

(async () => {
  const server = await startForwarder();
  const provider = new ethers.JsonRpcProvider(RPC);
  const deployerKey = JSON.parse(fs.readFileSync(PROJ + '/hidden_files/wallet.json', 'utf8')).privateKey;
  const deployer = new ethers.Wallet(deployerKey, provider);
  const user = ethers.Wallet.createRandom().connect(provider);
  const userAddr = await user.getAddress();
  const freelancer = ethers.Wallet.createRandom().connect(provider);
  const freelancerAddr = await freelancer.getAddress();
  console.log('USER:', userAddr);
  console.log('FREELANCER:', freelancerAddr);
  const fundTx = await deployer.sendTransaction({ to: userAddr, value: ethers.parseEther('1') });
  await fundTx.wait();
  console.log('USER FUNDED:', fundTx.hash);
  const relayerAbi = JSON.parse(fs.readFileSync(APP_DIR + '/abi-relayer.json', 'utf8'));
  const escrow = new ethers.Contract(RELAYER_ESCROW, relayerAbi, user);
  const idBefore = await escrow.nextEscrowId();
  const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const cTx = await escrow.createEscrow(freelancerAddr, [ethers.parseEther('0.3')], deadline);
  await cTx.wait();
  const escrowId = Number(idBefore);
  console.log('RELAYER ESCROW ID:', escrowId, 'create:', cTx.hash);
  const fTx = await escrow.fund(escrowId, { value: ethers.parseEther('0.3') });
  await fTx.wait();
  console.log('FUNDED:', fTx.hash);
  const balBefore = await provider.getBalance(userAddr);
  console.log('USER BALANCE BEFORE GASLESS (tMSTC):', ethers.formatEther(balBefore));

  const browser = await puppeteer.launch({ headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
           '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
           '--ignore-certificate-errors', '--proxy-server=http://127.0.0.1:3129', '--proxy-bypass-list=127.0.0.1;localhost'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.exposeFunction('__harnessRequest', async (method, params) => {
    switch (method) {
      case 'eth_requestAccounts': case 'eth_accounts': return [userAddr];
      case 'eth_chainId': return CHAIN_HEX;
      case 'net_version': return '91562037';
      case 'wallet_switchEthereumChain': return null;
      case 'wallet_addEthereumChain': return null;
      case 'eth_sendTransaction': {
        const tx = params[0];
        const sent = await user.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n });
        return sent.hash;
      }
      case 'eth_signTypedData_v4': {
        let td = params[1];
        if (typeof td === 'string') td = JSON.parse(td);
        const types = { ...td.types };
        delete types.EIP712Domain;
        const msg = { ...td.message };
        for (const k of ['value', 'gas', 'nonce', 'deadline']) {
          if (msg[k] !== undefined && msg[k] !== null) msg[k] = BigInt(msg[k]);
        }
        return user.signTypedData(td.domain, types, msg);
      }
      case 'personal_sign': case 'eth_sign': return user.signMessage(ethers.getBytes(params[params.length - 1] || '0x'));
      case 'eth_getBalance': return hex(await provider.getBalance(params[0]));
      case 'eth_call': return provider.call(params[0]);
      case 'eth_estimateGas': return hex(await provider.estimateGas(params[0]));
      case 'eth_gasPrice': return hex((await provider.getFeeData()).gasPrice);
      case 'eth_maxFeePerGas': return hex((await provider.getFeeData()).maxFeePerGas);
      case 'eth_maxPriorityFeePerGas': return hex((await provider.getFeeData()).maxPriorityFeePerGas);
      case 'eth_getTransactionCount': return hex(await provider.getTransactionCount(params[0]));
      case 'eth_blockNumber': return hex(await provider.getBlockNumber());
      case 'eth_getTransactionReceipt': return provider.getTransactionReceipt(params[0]);
      case 'eth_getTransactionByHash': return provider.getTransaction(params[0]);
      case 'eth_getCode': return provider.getCode(params[0]);
      default: throw new Error('unhandled method ' + method);
    }
  });
  await page.evaluateOnNewDocument((a, ch) => {
    window.ethereum = { isMetaMask: true, chainId: ch, selectedAddress: a,
      request: async ({ method, params }) => window.__harnessRequest(method, params || []),
      on: () => {}, removeListener: () => {}, emit: () => {} };
  }, userAddr, CHAIN_HEX);

  const framesDir = OUT_DIR + '/frames-gasless';
  fs.mkdirSync(framesDir, { recursive: true });
  for (const f of fs.readdirSync(framesDir)) fs.unlinkSync(framesDir + '/' + f);
  const recT0 = Date.now();
  const frameTimes = [];
  const session = await page.target().createCDPSession();
  await session.send('Page.enable');
  let frames = 0;
  session.on('Page.screencastFrame', async ({ data, sessionId }) => {
    try { await session.send('Page.screencastFrameAck', { sessionId }); } catch {}
    frames++;
    const f = 'frame-' + String(frames).padStart(4, '0') + '.jpg';
    fs.writeFileSync(framesDir + '/' + f, Buffer.from(data, 'base64'));
    frameTimes.push({ file: f, tSec: Number(((Date.now() - recT0) / 1000).toFixed(2)) });
  });
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });

  const outText = id => page.$eval('#' + id, el => el.textContent);
  const setVal = (id, v) => page.$eval('#' + id, (el, x) => { el.value = x; }, v);
  const marks = [];
  const mark = step => { const s = ((Date.now() - recT0) / 1000).toFixed(1); marks.push({ step, tSec: Number(s) }); console.log('MARK', s, step); };
  async function waitContains(id, needle, label, timeoutMs = 180000) {
    const tStart = Date.now();
    while (Date.now() - tStart < timeoutMs) {
      const t = await outText(id).catch(() => '');
      if (t.includes(needle)) { console.log('STEP', label, '->', t.replace(/\n/g, ' | ').slice(0, 300)); return t; }
      await sleep(1500);
    }
    throw new Error('timeout waiting for ' + needle + ' at ' + label + '; last: ' + (await outText(id).catch(() => '')));
  }
  let relayedHash = null, relayReceipt = null, readBack = null;
  try {
    await page.goto(DEMO, { waitUntil: 'networkidle2', timeout: 90000 });
    mark('demo-loaded');
    await page.click('#connect');
    await waitContains('walletOut', 'Connected:', 'wallet-connected');
    mark('wallet-connected');
    await sleep(1500);
    // Switch to Gasless mode
    await page.$eval('#mode', el => el.scrollIntoView());
    await sleep(1000);
    await page.select('#mode', 'gasless');
    await sleep(1500);
    mark('gasless-mode');
    await page.$eval('#checkRelayer', el => el.scrollIntoView());
    await sleep(1000);
    await page.click('#checkRelayer');
    await waitContains('relayerOut', 'Relayer OK', 'relayer-ok');
    mark('relayer-ok');
    await sleep(2000);
    // Approve milestone 0 (gasless) on the pre-funded escrow
    await setVal('escrowId', String(escrowId));
    await setVal('approveIdx', '0');
    await page.$eval('#approveGasless', el => el.scrollIntoView());
    await sleep(1000);
    await page.click('#approveGasless');
    const txOut = await waitContains('txOut', 'Relayed:', 'approve-gasless');
    const m = txOut.match(/0x[0-9a-fA-F]{64}/);
    relayedHash = m ? m[0] : null;
    console.log('RELAYED TX:', relayedHash);
    mark('approve-relayed');
    await sleep(3000);
    // Read back: milestone approved
    await page.$eval('#readEscrow', el => el.scrollIntoView());
    await sleep(1000);
    await page.click('#readEscrow');
    readBack = await waitContains('readOut', 'approved: true', 'read-approved');
    mark('read-approved');
    await sleep(4000);
    await page.screenshot({ path: OUT_DIR + '/gasless-final.png' });
    mark('end');
  } finally {
    try { await session.send('Page.stopScreencast'); } catch {}
    await sleep(1000);
    console.log('FRAMES:', frames);
    await browser.close(); server.close();
    // Independent on-chain verification (no browser involved)
    if (relayedHash) {
      relayReceipt = await provider.getTransactionReceipt(relayedHash);
      console.log('RELAY RECEIPT status:', relayReceipt ? relayReceipt.status : null, 'from:', relayReceipt ? relayReceipt.from : null, 'to:', relayReceipt ? relayReceipt.to : null);
    }
    const e = await escrow.getEscrow(escrowId);
    const ms = await escrow.getMilestone(escrowId, 0);
    const balAfter = await provider.getBalance(userAddr);
    console.log('ONCHAIN milestone0 approved:', ms[1], 'released:', ms[2]);
    console.log('USER BALANCE AFTER GASLESS (tMSTC):', ethers.formatEther(balAfter), 'delta:', ethers.formatEther(balAfter - balBefore));
    fs.writeFileSync(OUT_DIR + '/record-gasless-log.json', JSON.stringify({
      userAddr, freelancerAddr, escrowId, createTx: cTx.hash, fundTx: fTx.hash,
      relayedHash, relayReceipt: relayReceipt ? { status: relayReceipt.status, from: relayReceipt.from, to: relayReceipt.to, blockNumber: relayReceipt.blockNumber } : null,
      milestone0Approved: ms[1], milestone0Released: ms[2],
      userBalanceBefore: ethers.formatEther(balBefore), userBalanceAfter: ethers.formatEther(balAfter),
      marks, frames, frameTimes,
    }, null, 2));
    console.log('=== RECORD GASLESS DONE ===');
  }
})().catch(e => { console.error('RECORD FAIL:', e.message); process.exit(1); });
