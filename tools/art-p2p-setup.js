#!/usr/bin/env node
// Sell the art shares through the TimaxPay P2P escrow (bank payment in, shares out).
//   node tools/art-p2p-setup.js ART001 [--escrow 0xP2P_ESCROW_ON_ARC]
// 1. checks what the escrow needs on-chain: token allowed, escrow can hold the share, fee treasury can receive it
// 2. writes ONE Safe file with only the missing steps
// 3. prints the Azure App Setting P2P_ART_TOKENS (backend) and the token list to add
const { fs, path, ROOT, writeJson } = require('./lib');
const { SEL, w, addr, num, load, client } = require('./rpc');
const ESCROW = '0x007dee5a43FF48e15596702bca9ED87c51e8aEEf';
const CLI = require.main === module;
const [codeArg, ...rest] = CLI ? process.argv.slice(2) : [];
const flag = (n, d) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
const fail = (m) => { console.error('\n' + m + '\n'); process.exit(1); };
if (CLI && !codeArg) fail('Usage: node tools/art-p2p-setup.js ART001 [--escrow 0x...]');
const S = { allowed: '0x756742f8', setAllowed: '0x8aaa2284', exempt: '0xf1320af2', setExempt: '0x9fde54f5', treasury: '0x60dc2340' };
const bool = (h) => BigInt(h) !== 0n;
// What the escrow still needs on-chain for this lot. Returns { lines, txs }; txs are Safe steps (empty when all is set).
async function plan(CODE, escrowArg) {
  const { d, rpcs } = load(CODE), rpc = client(rpcs);
  const escrow = addr(escrowArg || ESCROW), share = d.contracts.share;
  const treasury = '0x' + (await rpc.ethCall(escrow, S.treasury)).slice(26);
  const allowed = bool(await rpc.ethCall(escrow, S.allowed + w(share)));
  const escrowExempt = bool(await rpc.ethCall(share, S.exempt + w(escrow)));
  const treasuryExempt = bool(await rpc.ethCall(share, S.exempt + w(treasury)));
  const txs = [];
  if (!allowed) txs.push({ to: escrow, value: '0', data: S.setAllowed + w(share) + num(1) });
  if (!escrowExempt) txs.push({ to: share, value: '0', data: S.setExempt + w(escrow) + num(1) });
  if (!treasuryExempt) txs.push({ to: share, value: '0', data: S.setExempt + w(treasury) + num(1) });
  return { escrow, treasury, allowed, escrowExempt, treasuryExempt, txs };
}
module.exports = { plan };
if (CLI) (async () => {
  const CODE = codeArg.toUpperCase(), { d, p, rpcs } = load(CODE), rpc = client(rpcs);
  const escrow = addr(flag('escrow', '0x007dee5a43FF48e15596702bca9ED87c51e8aEEf')), share = d.contracts.share, hook = d.contracts.hook;
  const treasury = '0x' + (await rpc.ethCall(escrow, S.treasury)).slice(26);
  const allowed = bool(await rpc.ethCall(escrow, S.allowed + w(share)));
  const escrowExempt = bool(await rpc.ethCall(share, S.exempt + w(escrow)));
  const treasuryExempt = bool(await rpc.ethCall(share, S.exempt + w(treasury)));
  const yes = (b) => b ? 'ok ' : 'MISSING';
  console.log(`P2P escrow ${escrow}\nFee treasury ${treasury}\n  escrow allows ${CODE}:            ${yes(allowed)}\n  escrow can hold ${CODE} (exempt):  ${yes(escrowExempt)}\n  fee treasury can receive:        ${yes(treasuryExempt)}`);
  const txs = [];
  if (!allowed) txs.push({ to: escrow, value: '0', data: S.setAllowed + w(share) + num(1) });
  if (!escrowExempt) txs.push({ to: share, value: '0', data: S.setExempt + w(escrow) + num(1) });
  if (!treasuryExempt) txs.push({ to: share, value: '0', data: S.setExempt + w(treasury) + num(1) });
  if (txs.length) {
    const out = path.join(ROOT, 'bonus', `safe-p2p-${CODE}-${Date.now()}.json`); fs.mkdirSync(path.dirname(out), { recursive: true });
    writeJson(out, { version: '1.0', chainId: String(d.chain.chainId), createdAt: Date.now(), meta: { name: `${CODE} for the P2P escrow` }, transactions: txs });
    console.log(`\nSafe file (${txs.length} step${txs.length > 1 ? 's' : ''}): ${out}\nSafe app > Transaction Builder > upload > sign. The Safe must be the owner of the escrow and the admin of the share.`);
  } else console.log('\nOn-chain setup is complete. No Safe file needed.');
  const usd = (d.quotes || []).find(q => q.symbol === 'USDC'), eur = (d.quotes || []).find(q => q.symbol === 'EURC');
  const oracles = {}; if (usd) oracles.usd = usd.oracle; if (eur) oracles.eur = eur.oracle;
  const art = [{ chainId: d.chain.chainId, address: share, symbol: CODE, decimals: 18, kyc: hook, oracles, deviationPct: 3 }];
  console.log('\nAzure App Settings for the bridge-backend (add to the existing ones):');
  console.log('P2P_ART_TOKENS=' + JSON.stringify(art));
  console.log('P2P_ARC_ALLOWED_TOKENS=<what you have now>,' + share.toLowerCase());
  console.log('P2P_ARC_ALLOWED_RAILS=onchain,stripe,sepa      (stripe = bank payment link, sepa = Monerium IBAN; keep only the ones you use)');
  console.log('\nThen open  https://<your-backend>/api/p2p/escrow/art-check?chainId=' + d.chain.chainId + '&token=' + share + '  and wait for "ready": true.');
})().catch(e => fail('Failed: ' + (e && e.message || e)));
