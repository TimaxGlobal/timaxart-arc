#!/usr/bin/env node
// Lender bonus for an art credit market: TimaxArt pays extra APR on top of the Morpho supply rate, to attract lenders.
// Morpho's own rate cannot be changed. This tool adds a promised bonus, tracks who earned it, and builds the payout batch for your Safe.
//   node tools/lender-bonus.js set      ART001 USDC 3 [--days 90] [--budget 500]   start / change the bonus (3 = 3% a year)
//   node tools/lender-bonus.js snapshot ART001 USDC [--from BLOCK]                    record lenders and accrue the bonus (run daily; more often = fairer)
//   node tools/lender-bonus.js status   ART001 USDC
//   node tools/lender-bonus.js pay      ART001 USDC [--min 1]                         writes a Safe batch of USDC transfers and marks them paid
//   node tools/lender-bonus.js off      ART001 USDC                                   stop the bonus (what was earned stays payable)
const { fs, path, ROOT, readJson, writeJson } = require('./lib');
const { SEL, SUPPLY_TOPIC, w, addr, num, load, client } = require('./rpc');
const YEAR = 31536000n;
const [cmd, CODE0, Q0, ...rest] = process.argv.slice(2);
const flag = (n, d) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
const fail = (m) => { console.error('\n' + m + '\n'); process.exit(1); };
if (!cmd || !CODE0 || !Q0) fail('Usage: node tools/lender-bonus.js <set|snapshot|status|pay|off> ART001 USDC [apr] [--days N] [--budget X] [--from BLOCK] [--min X]');
const CODE = CODE0.toUpperCase(), SYM = Q0.toUpperCase();
const units = (raw, dec) => { const s = BigInt(raw).toString().padStart(dec + 1, '0'); const a = s.slice(0, -dec), b = s.slice(-dec).replace(/0+$/, ''); return b ? a + '.' + b : a; };
const toRaw = (txt, dec) => { const [a, b = ''] = String(txt).split('.'); return BigInt(a + b.padEnd(dec, '0').slice(0, dec)); };
const ledgerFile = () => path.join(ROOT, 'bonus', `ledger-${CODE}-${SYM}.json`);
const readLedger = () => fs.existsSync(ledgerFile()) ? readJson(ledgerFile()) : null;
const saveLedger = (l) => { fs.mkdirSync(path.dirname(ledgerFile()), { recursive: true }); writeJson(ledgerFile(), l); };

(async () => {
  const { p, f, d, rpcs } = load(CODE);
  const q = (d.quotes || []).find(x => x.symbol === SYM); if (!q) fail(`${CODE} has no ${SYM} market. Available: ${(d.quotes || []).map(x => x.symbol).join(', ')}`);
  const dec = q.decimals ?? 6, rpc = client(rpcs);
  const head = async () => { const b = await rpc.call('eth_getBlockByNumber', ['latest', false]); return { n: Number(BigInt(b.number)), ts: Number(BigInt(b.timestamp)) }; };

  if (cmd === 'set') {
    const apr = Number(rest[0]); if (!(apr > 0 && apr <= 50)) fail('Give the bonus APR in percent, between 0 and 50. Example: set ART001 USDC 3');
    const days = Number(flag('days', 0)), budget = flag('budget', '');
    const h = await head();
    p.lenderBonus = p.lenderBonus || {};
    p.lenderBonus[SYM] = { aprPct: apr, until: days ? new Date((h.ts + days * 86400) * 1000).toISOString().slice(0, 10) : null, budget: budget ? Number(budget) : null, startBlock: h.n };
    writeJson(f, p);
    if (!readLedger()) saveLedger({ code: CODE, quote: SYM, decimals: dec, lastBlock: h.n, lastTs: h.ts, lenders: {} });
    console.log(`Bonus set: ${SYM} lenders on ${CODE} get +${apr}% a year${days ? ' until ' + p.lenderBonus[SYM].until : ''}${budget ? ', budget ' + budget + ' ' + SYM : ''}.`);
    console.log('Saved in painting.json (the app shows it on the Lend tab after you publish). Now run snapshot daily.');
    return;
  }
  const cfg = p.lenderBonus && p.lenderBonus[SYM];
  if (cmd === 'off') { if (cfg) { delete p.lenderBonus[SYM]; writeJson(f, p); } console.log('Bonus switched off in painting.json. Earned amounts stay in the ledger and can still be paid.'); return; }

  const ledger = readLedger(); if (!ledger) fail('No ledger yet. Run "set" first.');
  if (cmd === 'snapshot') {
    const h = await head();
    // 1. find lenders: Supply events of this market
    const from = Number(flag('from', ledger.lastBlock + 1));
    let chunk = 20000, lo = from, found = 0;
    while (lo <= h.n) {
      const hi = Math.min(lo + chunk - 1, h.n);
      try {
        const logs = await rpc.call('eth_getLogs', [{ address: d.contracts.morpho, fromBlock: '0x' + lo.toString(16), toBlock: '0x' + hi.toString(16), topics: [SUPPLY_TOPIC, '0x' + w(q.marketId)] }]);
        for (const l of logs) { const a = '0x' + l.topics[3].slice(26).toLowerCase(); if (!ledger.lenders[a]) { ledger.lenders[a] = { assets: '0', owed: '0', paid: '0' }; found++; } }
        lo = hi + 1;
      } catch (e) { if (chunk > 500) chunk = Math.floor(chunk / 4); else throw e; }
    }
    // 2. current supplied assets of every known lender
    const m = await rpc.ethCall(d.contracts.morpho, SEL.market + w(q.marketId)); const mw = m.slice(2).match(/.{64}/g).map(x => BigInt('0x' + x));
    const tsa = mw[0], tss = mw[1];
    const now = {};
    for (const a of Object.keys(ledger.lenders)) {
      const pos = await rpc.ethCall(d.contracts.morpho, SEL.position + w(q.marketId) + w(a)); const sh = BigInt('0x' + pos.slice(2, 66));
      now[a] = (sh * (tsa + 1n)) / (tss + 1000000n);
    }
    // 3. accrue the bonus for the time since the last snapshot, using the balance recorded then
    let accrued = 0n;
    if (cfg) {
      const until = cfg.until ? Math.floor(Date.parse(cfg.until + 'T23:59:59Z') / 1000) : Infinity;
      const t1 = Math.min(h.ts, until), dt = BigInt(Math.max(0, t1 - ledger.lastTs)), bps = BigInt(Math.round(cfg.aprPct * 100));
      let room = cfg.budget != null ? toRaw(cfg.budget, dec) - Object.values(ledger.lenders).reduce((s, x) => s + BigInt(x.owed) + BigInt(x.paid), 0n) : null;
      for (const [a, x] of Object.entries(ledger.lenders)) {
        let add = (BigInt(x.assets) * bps * dt) / (10000n * YEAR);
        if (room != null) { if (add > room) add = room > 0n ? room : 0n; room -= add; }
        x.owed = (BigInt(x.owed) + add).toString(); accrued += add;
      }
    }
    for (const a of Object.keys(ledger.lenders)) ledger.lenders[a].assets = (now[a] ?? 0n).toString();
    ledger.lastBlock = h.n; ledger.lastTs = h.ts; saveLedger(ledger);
    console.log(`Snapshot at block ${h.n}: ${Object.keys(ledger.lenders).length} lender(s) (${found} new), bonus accrued ${units(accrued, dec)} ${SYM}${cfg ? '' : ' (bonus is off: nothing accrued)'}.`);
    return;
  }
  if (cmd === 'status') {
    const rows = Object.entries(ledger.lenders);
    console.log(`${CODE} ${SYM} bonus: ${cfg ? '+' + cfg.aprPct + '% a year' + (cfg.until ? ' until ' + cfg.until : '') + (cfg.budget != null ? ', budget ' + cfg.budget : '') : 'OFF'}   last snapshot: ${ledger.lastTs ? new Date(ledger.lastTs * 1000).toISOString() : 'never'}`);
    let tO = 0n, tP = 0n, tA = 0n;
    for (const [a, x] of rows) { console.log(`${a}  supplied ${units(x.assets, dec).padStart(12)}  owed ${units(x.owed, dec).padStart(10)}  paid ${units(x.paid, dec).padStart(10)}`); tO += BigInt(x.owed); tP += BigInt(x.paid); tA += BigInt(x.assets); }
    console.log(`TOTAL supplied ${units(tA, dec)}  owed ${units(tO, dec)}  paid ${units(tP, dec)} ${SYM}`);
    return;
  }
  if (cmd === 'pay') {
    const min = toRaw(flag('min', '1'), dec), txs = []; let total = 0n;
    for (const [a, x] of Object.entries(ledger.lenders)) {
      const owed = BigInt(x.owed); if (owed < min) continue;
      txs.push({ to: q.address, value: '0', data: SEL.transfer + w(a) + num(owed) }); x.paid = (BigInt(x.paid) + owed).toString(); x.owed = '0'; total += owed;
    }
    if (!txs.length) { console.log('Nothing to pay yet (nobody has reached the minimum of ' + units(min, dec) + ' ' + SYM + ').'); return; }
    const out = path.join(ROOT, 'bonus', `safe-pay-${CODE}-${SYM}-${new Date().toISOString().slice(0, 10)}.json`);
    writeJson(out, { version: '1.0', chainId: String(d.chain.chainId), createdAt: Date.now(), meta: { name: `${CODE} ${SYM} lender bonus`, description: 'Lender bonus payout' }, transactions: txs });
    saveLedger(ledger);
    console.log(`${txs.length} payment(s), ${units(total, dec)} ${SYM} in total.\nSafe file: ${out}\nIn the Safe app: New transaction > Transaction Builder > upload this JSON, check the amounts, sign. The Safe needs at least ${units(total, dec)} ${SYM}.`);
    return;
  }
  fail('Unknown command ' + cmd);
})().catch(e => fail('Failed: ' + (e && e.message || e)));
