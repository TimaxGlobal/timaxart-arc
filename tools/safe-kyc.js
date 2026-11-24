#!/usr/bin/env node
// Add (or remove) wallets that may buy and hold the art shares. Builds a batch for the Safe and shows who is allowed to sign it.
//   node tools/safe-kyc.js ART001 0xabc...,0xdef...            add wallets
//   node tools/safe-kyc.js ART001 0xabc... --remove             remove
//   node tools/safe-kyc.js ART001 0xabc... --check              only show the current status
const { path, ROOT, writeJson } = require('./lib');
const { SEL, w, addr, num, load, client } = require('./rpc');
const [codeArg, list, ...flags] = process.argv.slice(2);
const fail = (m) => { console.error('\n' + m + '\n'); process.exit(1); };
if (!codeArg || !list) fail('Usage: node tools/safe-kyc.js ART001 0xwallet1,0xwallet2 [--remove|--check]');
(async () => {
  const CODE = codeArg.toUpperCase(), { d, rpcs } = load(CODE), rpc = client(rpcs), hook = d.contracts.hook;
  const wallets = [...new Set(list.split(/[\s,;]+/).filter(Boolean).map(addr))];
  const read = async (sel) => '0x' + (await rpc.ethCall(hook, sel)).slice(26, 66);
  const admin = await read(SEL.admin), op = await read(SEL.kycOperator);
  console.log(`Hook ${hook}\n  admin        ${admin}${admin.toLowerCase() === d.contracts.safe.toLowerCase() ? '  (your Safe)' : ''}\n  KYC operator ${op}${op.toLowerCase() === d.contracts.safe.toLowerCase() ? '  (your Safe)' : ''}`);
  for (const a of wallets) { const r = await rpc.ethCall(hook, SEL.kyc + w(a)); console.log(`  ${a}  ${BigInt(r) ? 'VERIFIED' : 'not verified'}`); }
  if (flags.includes('--check')) return;
  const ok = !flags.includes('--remove');
  const data = SEL.setKyc + num(64) + num(ok ? 1 : 0) + num(wallets.length) + wallets.map(w).join('');
  const out = path.join(ROOT, 'bonus', `safe-kyc-${CODE}-${Date.now()}.json`); require('fs').mkdirSync(path.dirname(out), { recursive: true });
  writeJson(out, { version: '1.0', chainId: String(d.chain.chainId), createdAt: Date.now(), meta: { name: `${CODE} ${ok ? 'verify' : 'unverify'} ${wallets.length} wallet(s)` }, transactions: [{ to: hook, value: '0', data }] });
  console.log(`\n${ok ? 'Verify' : 'Remove'} ${wallets.length} wallet(s). Safe file: ${out}\nIn the Safe app: New transaction > Transaction Builder > upload this JSON > sign. The Safe must be the admin or KYC operator shown above.`);
})().catch(e => fail('Failed: ' + (e && e.message || e)));
