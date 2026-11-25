#!/usr/bin/env node
// Collects the on-chain transaction hashes that prove the art products work and writes docs/EVIDENCE.md.
// Read-only: it only asks the Arc RPC for logs. No keys needed.
//   node tools/collect-evidence.js ART002 [ART001 ...] [--days 30]
// Env: ARC_RPC (optional), EXPLORER (default https://arcscan.app/tx/)
const fs = require('fs'), path = require('path');
const w = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
let PROJECT = process.cwd();
{ const i = process.argv.indexOf('--project'); if (i >= 0) PROJECT = path.resolve(process.argv[i + 1]); }
const ROOT = process.cwd();
function load(code) {
  const dirs = [path.join(PROJECT, 'offer', 'paintings'), path.join(PROJECT, 'public', 'offer', 'paintings'), path.join(PROJECT, 'paintings')];
  const f = dirs.map(d => path.join(d, code, 'painting.json')).find(x => fs.existsSync(x));
  if (!f) throw new Error(`No painting.json for ${code} under ${PROJECT}.\nRun from the art project folder (where launch-painting.ps1 is), or add: --project C:\\path\\to\\that\\folder`);
  const p = readJson(f); if (!p.deployment) throw new Error(code + ' is not launched yet.');
  const rpcs = [process.env.ARC_RPC, p.deployment.chain.rpc].filter(Boolean);
  return { p, d: p.deployment, rpcs };
}
const RATE = /rate|too many requests|429|throttl|capacity/i, RANGE = /range|block.*(limit|too)|exceed|too large|more than|results/i;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function client(rpcs) {
  let id = 1;
  rpcs = [...new Set([...rpcs, 'https://rpc.mainnet.arc.io'])];
  async function call(method, params) {
    let last;
    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(120);                                   // gentle pace: public RPC limits are per second
      for (const url of rpcs) {
        try {
          const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) });
          if (r.status === 429) { last = new Error('rate limit exceeded'); continue; }
          const j = await r.json();
          if (j.error) { last = new Error(j.error.message || JSON.stringify(j.error)); if (RATE.test(last.message)) continue; if (RANGE.test(last.message)) { last.range = true; throw last; } continue; }
          return j.result;
        } catch (e) { if (e.range) throw e; last = e; }
      }
      await sleep(Math.min(15000, 1000 * 2 ** attempt)); // every RPC said no: back off and retry
    }
    throw last || new Error('RPC failed');
  }
  return { call };
}
const args = process.argv.slice(2), codes = [];
let days = 30;
for (let i = 0; i < args.length; i++) { if (args[i] === '--days') days = Number(args[++i]); else if (args[i] === '--project') i++; else codes.push(args[i].toUpperCase()); }
if (!codes.length) { console.error('Usage: node tools/collect-evidence.js ART002 [ART001] [--days 30]'); process.exit(1); }
const EXPLORER = process.env.EXPLORER || 'https://arcscan.app/tx/';
const SAFE_OK = '0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e'; // ExecutionSuccess(bytes32,uint256)
const SUPPLY_TOPIC = '0xedf8870433c83823eb071d3df1caa8d008f12f6440918c20d75a3602cda30fe0';
const hx = (n) => '0x' + n.toString(16), words = (d) => (d.slice(2).match(/.{64}/g) || []);
const link = (h) => `[\`${h}\`](${EXPLORER}${h})`;

async function main() {
  const out = ['# On-chain evidence', '', `Generated ${new Date().toISOString()} from Arc (chain 5042) logs. Every hash below can be opened in the explorer.`, ''];
  for (const code of codes) {
    const { p, d, rpcs } = load(code), rpc = client(rpcs), c = d.contracts;
    const head = parseInt(await rpc.call('eth_blockNumber', []), 16);
    const tsc = {}; const ts = async (b) => tsc[b] ?? (tsc[b] = parseInt((await rpc.call('eth_getBlockByNumber', [hx(b), false])).timestamp, 16));
    const [t1, t0] = [await ts(head), await ts(Math.max(1, head - 100000))];
    const perBlock = 100000 / Math.max(1, t1 - t0), floor = Math.max(0, head - Math.ceil(days * 86400 * perBlock));
    // Scan newest to oldest in shrinking chunks; collect logs for one filter.
    async function logs(filter) {
      const res = []; let size = 200000, hi = head;
      while (hi >= floor) {
        process.stdout.write('.');
        const lo = Math.max(floor, hi - size + 1);
        try { res.push(...await rpc.call('eth_getLogs', [{ ...filter, fromBlock: hx(lo), toBlock: hx(hi) }])); hi = lo - 1; }
        catch (e) { if (!e.range || size <= 2000) throw e; size = Math.max(2000, Math.floor(size / 2)); }
      }
      return res.sort((a, b) => parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) || parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16));
    }
    const when = async (l) => new Date((await ts(parseInt(l.blockNumber, 16))) * 1000).toISOString().replace('.000Z', 'Z');
    out.push(`## ${code}${p.title ? ' ' + p.title : ''}`, '', '| Contract | Address |', '|---|---|');
    for (const [k, v] of Object.entries(c)) out.push(`| ${k} | \`${v}\` |`);
    out.push('');

    // 1. Pool creation: PoolManager Initialize event whose hooks field is our hook.
    out.push('### Pool creation (Uniswap v4, KYC hook)', '');
    let found = false;
    if (c.poolManager && c.hook) {
      const tokens = [c.share, ...(d.quotes || []).map(q => q.address)].filter(Boolean);
      for (const q of d.quotes || []) {
        for (const [a, b] of [[c.share, q.address], [q.address, c.share]]) {
          const [c0, c1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a]; if (a !== c0) continue;
          const ls = (await logs({ address: c.poolManager, topics: [null, null, '0x' + w(c0), '0x' + w(c1)] })).filter(l => words(l.data)[2] && ('0x' + words(l.data)[2].slice(24)).toLowerCase() === c.hook.toLowerCase());
          for (const l of ls) { found = true; out.push(`- ${code}/${q.symbol} pool \`${l.topics[1]}\`: ${link(l.transactionHash)} (block ${parseInt(l.blockNumber, 16)}, ${await when(l)})`); }
        }
      }
    }
    if (!found) out.push(`- Not found in the last ${days} days. Re-run with a larger --days, or paste the hash from the launch output.`);
    out.push('');

    // 2. Morpho markets: earliest log carrying the market id is CreateMarket; first Supply shows lending works.
    out.push('### Morpho markets (credit)', '');
    for (const q of d.quotes || []) {
      const ls = await logs({ address: c.morpho, topics: [null, '0x' + w(q.marketId)] });
      const create = ls[0], supply = ls.find(l => l.topics[0] === SUPPLY_TOPIC);
      out.push(`- ${code}/${q.symbol} market \`${q.marketId}\``);
      out.push(create ? `  - created: ${link(create.transactionHash)} (${await when(create)})` : `  - created: not in the last ${days} days`);
      if (supply) out.push(`  - first supply: ${link(supply.transactionHash)} (${await when(supply)})`);
    }
    out.push('');

    // 3. Buyback series: SeriesCreated has one indexed id and 7 data words; SeriesOpen has 1 data word.
    out.push('### Buyback note series', '');
    if (c.note) {
      const ls = (await logs({ address: c.note })).filter(l => l.topics.length === 2 && words(l.data).length === 7);
      if (!ls.length) out.push('- No series created in this window.');
      for (const l of ls) { const x = words(l.data); out.push(`- Series #${parseInt(l.topics[1], 16)} (${(Number(BigInt('0x' + x[3])) / 100).toFixed(2)}% a year, ${Math.round(Number(BigInt('0x' + x[4])) / 86400)} days): ${link(l.transactionHash)} (${await when(l)})`); }
    } else out.push('- No note contract recorded for this painting.');
    out.push('');

    // 4. Safe batches that touch this painting (ART002 share, hook or note contract, or one of its Morpho market ids).
    out.push('### Safe batches (multisig executions touching ' + code + ')', '');
    if (c.safe) {
      const mine = new Set([c.share, c.hook, c.note].filter(Boolean).map(x => x.toLowerCase()));
      const mids = new Set((d.quotes || []).map(q => ('0x' + w(q.marketId))));
      const all = await logs({ address: c.safe, topics: [SAFE_OK] });
      let shown = 0;
      for (const l of all) {
        const rc = await rpc.call('eth_getTransactionReceipt', [l.transactionHash]);
        const hit = (rc?.logs || []).some(g => mine.has(String(g.address).toLowerCase()) || (g.topics || []).some(t => mids.has(t.toLowerCase())));
        if (hit) { shown++; out.push(`- ${link(l.transactionHash)} (block ${parseInt(l.blockNumber, 16)}, ${await when(l)})`); }
      }
      if (!shown) out.push(`- No ${code} batches in this window (${all.length} other Safe executions ignored).`);
    }
    out.push('');

    // 5. Every movement of the share token: P2P escrow lock and release, pool, credit collateral, transfers.
    out.push('### ' + code + ' share movements (P2P escrow, pool, credit, transfers)', '');
    const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const names = {}; const nm = (a, n) => { if (a) names[a.toLowerCase()] = n; };
    nm(process.env.P2P_ESCROW || '0x007dee5a43FF48e15596702bca9ED87c51e8aEEf', 'P2P escrow'); nm('0x530C91DABa93F4A8E8FDCA868dA423d3E96824e5', 'fee treasury');
    nm(c.safe, 'Safe'); nm(c.morpho, 'Morpho (credit)'); nm(c.poolManager, 'pool manager'); nm(c.note, 'buyback note'); nm(c.hook, 'hook'); nm('0x0000000000000000000000000000000000000000', 'mint/burn');
    const who = (a) => names[a.toLowerCase()] || a.slice(0, 6) + '…' + a.slice(-4);
    const tl = await logs({ address: c.share, topics: [TRANSFER] });
    if (!tl.length) out.push('- No share transfers in this window.');
    for (const l of tl) {
      const from = '0x' + l.topics[1].slice(26), to = '0x' + l.topics[2].slice(26), amt = Number(BigInt(l.data)) / 1e18;
      out.push(`- ${amt.toLocaleString('en', { maximumFractionDigits: 4 })} ${code}: ${who(from)} → ${who(to)}: ${link(l.transactionHash)} (${await when(l)})`);
    }
    out.push('');
  }
  const f = path.join(ROOT, 'docs', 'EVIDENCE.md'); fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, out.join('\n') + '\n', 'utf8');
  console.log('Wrote ' + f); console.log(out.filter(l => /^- |^  - /.test(l)).length + ' hash lines. Open the file and check the explorer links.');
}
main().catch(e => { console.error('\n' + e.message + '\n'); process.exit(1); });
