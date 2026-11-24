#!/usr/bin/env node
// Builds the Safe batch that opens a guaranteed-return series (buyback note) for a painting.
//   node tools/note-series.js ART001 USDC --apr 8 --days 90 --shares 500 --reserve 700 [--sale-days 60] [--price 1.3107] [--above 0] [--with-shares]
//   --apr      guaranteed return a year in percent (max 30)      --days   note length
//   --shares   how many shares this series may sell              --reserve USDC/EURC the Safe puts in as backing now (needs >= full payout to sell it all)
//   --price    entry price per share (default: current appraisal) --above  % the price may exceed the appraisal (default 0, max 10)
//   --with-shares  also moves the shares from the Safe into the contract (leave out if another wallet holds the inventory)
const { fs, path, ROOT, writeJson } = require('./lib');
const { SEL, w, addr, num, load, client } = require('./rpc');
const [codeArg, symArg, ...rest] = process.argv.slice(2);
const flag = (n, d) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
const fail = (m) => { console.error('\n' + m + '\n'); process.exit(1); };
if (!codeArg || !symArg) fail('Usage: node tools/note-series.js ART001 USDC --apr 8 --days 90 --shares 500 --reserve 700');
const toRaw = (t, dec) => { const [a, b = ''] = String(t).split('.'); return BigInt(a + b.padEnd(dec, '0').slice(0, dec)); };
const units = (r, dec) => { const s = BigInt(r).toString().padStart(dec + 1, '0'); const a = s.slice(0, -dec), b = s.slice(-dec).replace(/0+$/, ''); return b ? a + '.' + b : a; };
const S = { create: '0xfc3a4d36', exempt: '0x9fde54f5', price: '0x99530b06' };
(async () => {
  const CODE = codeArg.toUpperCase(), SYM = symArg.toUpperCase(), { d, rpcs } = load(CODE), rpc = client(rpcs);
  const note = d.contracts.note; if (!note) fail('Deploy the note contract first: .\\launch-note.ps1 -Code ' + CODE);
  const q = d.quotes.find(x => x.symbol === SYM); if (!q) fail('No ' + SYM + ' market for ' + CODE);
  const apr = Number(flag('apr', 0)), days = Number(flag('days', 0)), shares = Number(flag('shares', 0)), reserve = Number(flag('reserve', 0)), saleDays = Number(flag('sale-days', 60)), above = Number(flag('above', 0));
  if (!(apr > 0 && apr <= 30)) fail('--apr must be between 0 and 30 (percent a year).');
  if (!(days >= 7 && days <= 730)) fail('--days must be between 7 and 730.');
  if (!(shares > 0)) fail('--shares is required.'); if (!(above >= 0 && above <= 10)) fail('--above must be 0 to 10.');
  const dec = q.decimals ?? 6;
  const appraisal = BigInt(await rpc.ethCall(q.oracle, S.price));
  const price = flag('price') ? toRaw(flag('price'), dec) : appraisal;
  if (price > appraisal * BigInt(10000 + Math.round(above * 100)) / 10000n) fail(`Entry price ${units(price, dec)} is above the appraisal ${units(appraisal, dec)} (+${above}%). Clients could not buy. Lower --price or raise --above.`);
  const capRaw = toRaw(shares, 18), aprBps = Math.round(apr * 100), term = days * 86400;
  const cost = (capRaw * price + 10n ** 18n - 1n) / 10n ** 18n, payout = cost + cost * BigInt(aprBps) * BigInt(term) / (10000n * 31536000n);
  const saleEnds = Math.floor(Date.now() / 1000) + saleDays * 86400, resRaw = toRaw(reserve, dec);
  const txs = [{ to: d.contracts.share, value: '0', data: S.exempt + w(note) + num(1) }];
  if (resRaw > 0n) txs.push({ to: q.address, value: '0', data: SEL.transfer + w(note) + num(resRaw) });
  if (process.argv.includes('--with-shares')) txs.push({ to: d.contracts.share, value: '0', data: SEL.transfer + w(note) + num(capRaw) });
  txs.push({ to: note, value: '0', data: S.create + w(d.contracts.share) + w(q.address) + w(q.oracle) + num(price) + num(aprBps) + num(term) + num(Math.round(above * 100)) + num(capRaw) + num(saleEnds) });
  // createSeries(address share,address quote,address oracle,uint128 entryPrice,uint32 aprBps,uint32 term,uint16 maxAbove,uint128 capacity,uint64 saleEnds): order matches the selector above
  const out = path.join(ROOT, 'bonus', `safe-note-${CODE}-${SYM}-${Date.now()}.json`); fs.mkdirSync(path.dirname(out), { recursive: true });
  writeJson(out, { version: '1.0', chainId: String(d.chain.chainId), createdAt: Date.now(), meta: { name: `${CODE} ${SYM} guaranteed ${apr}% / ${days} days` }, transactions: txs });
  console.log(`Series: ${shares} shares of ${CODE} at ${units(price, dec)} ${SYM} each (appraisal ${units(appraisal, dec)}), guaranteed ${apr}% a year for ${days} days.`);
  console.log(`A client buying 100 shares pays ${units(100n * price, dec)} ${SYM} and gets ${units(((100n * price) * (10000n * 31536000n + BigInt(aprBps) * BigInt(term))) / (10000n * 31536000n), dec)} back at maturity.`);
  console.log(`Backing needed to sell the whole series: ${units(payout, dec)} ${SYM}. You are putting in ${units(resRaw, dec)} ${SYM}${resRaw < payout ? ' (the series stops selling when this is used up; add more later by sending ' + SYM + ' to ' + note + ')' : ''}.`);
  console.log(`\nSafe file: ${out}\nIn the Safe app: New transaction > Transaction Builder > upload this JSON > check > sign.${process.argv.includes('--with-shares') ? '' : '\nThen send ' + shares + ' ' + CODE + ' shares from the wallet that holds them to ' + note + ' (the contract can only sell shares it holds).'}`);
})().catch(e => fail('Failed: ' + (e && e.message || e)));
