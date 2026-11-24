#!/usr/bin/env node
// Read-only: shows where the money and the shares of a painting are right now (nothing is sent).
//   node tools/money-check.js ART001
const { fs, path, ROOT, readJson } = require('./lib');
const { SEL, w, addr, load, client } = require('./rpc');
const code = (process.argv[2] || '').toUpperCase(); if (!code) { console.error('Usage: node tools/money-check.js ART001'); process.exit(1); }
const S = { bal: '0x70a08231', owner: '0x6352211e', next: '0x75794a3c', rRes: '0x68f38a6b', rInv: '0xdaa9618c', admin: '0xf851a440', liab: null };
const big = (h) => BigInt(h && h !== '0x' ? h : '0x0');
const u = (r, dec) => { const s = BigInt(r).toString().padStart(dec + 1, '0'); const a = s.slice(0, -dec), b = s.slice(-dec).replace(/0+$/, ''); return (b ? a + '.' + b : a); };
(async () => {
  const { d, rpcs } = load(code), rpc = client(rpcs), c = d.contracts;
  const tok = [{ s: 'USDC', a: d.quotes[0].address, dec: d.quotes[0].decimals }, { s: 'EURC', a: d.quotes[1].address, dec: d.quotes[1].decimals }, { s: code, a: c.share, dec: 18 }];
  const deployer = '0x' + (await rpc.ethCall(c.hook, S.admin)).slice(26);
  const show = async (label, who) => { const out = []; for (const t of tok) out.push(`${u(big(await rpc.ethCall(t.a, S.bal + w(who))), t.dec)} ${t.s}`); console.log(`${label.padEnd(22)} ${who}\n   ${out.join('   ')}`); };
  console.log(`== ${code} on ${d.chain.name} ==\n`);
  await show('Deployer wallet', deployer); await show('Safe', c.safe);
  if (c.note) {
    console.log('\n-- Buyback note contract ' + c.note);
    await show('Note contract holds', c.note);
    console.log(`   free reserve ${u(big(await rpc.ethCall(c.note, S.rRes + w(d.quotes[0].address))), 6)} USDC   free shares ${u(big(await rpc.ethCall(c.note, S.rInv + w(c.share))), 18)}   (this part can be taken back: .\\note-withdraw.ps1)`);
  }
  console.log('\n-- Credit market (Morpho)');
  for (const q of d.quotes) { const m = (await rpc.ethCall(c.morpho, SEL.market + w(q.marketId))).slice(2).match(/.{64}/g).map(x => BigInt('0x' + x)); console.log(`   ${q.symbol}: lent ${u(m[0], q.decimals)}   borrowed ${u(m[2], q.decimals)}`); }
  // pool positions (Uniswap v4 position NFTs)
  let cfg = {}; for (const f of ['launch.arc.json']) { try { cfg = readJson(path.join(ROOT, f)); } catch (e) {} }
  const posm = Object.entries(cfg).find(([k]) => /positionmanager/i.test(k))?.[1];
  if (posm) {
    const next = Number(big(await rpc.ethCall(posm, S.next))); const mine = [];
    for (let id = Math.max(1, next - 60); id < next; id++) { try { const o = '0x' + (await rpc.ethCall(posm, S.owner + w(id.toString(16)))).slice(26); if ([c.safe, deployer].some(x => x.toLowerCase() === o.toLowerCase())) mine.push(`#${id} owner ${o.toLowerCase() === c.safe.toLowerCase() ? 'Safe' : 'deployer'}`); } catch (e) {} }
    console.log('\n-- Pool liquidity positions (NFTs) among the latest 60: ' + (mine.join(', ') || 'none found'));
    console.log('   The pools were launched sell-only: only shares were put in, no USDC/EURC. Money raised sits inside these positions and is collected by whoever holds the NFT.');
  }
  console.log('\nGas on Arc is paid in USDC and is not refundable.');
})().catch(e => { console.error('Failed: ' + (e && e.message || e)); process.exit(1); });
