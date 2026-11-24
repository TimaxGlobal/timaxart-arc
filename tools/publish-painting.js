#!/usr/bin/env node
// One step after launch-painting: (1) writes the Safe file that accepts the oracles, (2) copies the painting's folder into the app's
// public folder (so images, video and metadata.json are online), (3) registers the painting with the admin panel (hidden).
//   node tools/publish-painting.js ART002 --app C:\TimaxPay-HubPlus --api https://<backend> [--push]
// Password for step 3: env ART_ADMIN_PASSWORD (the same one you set in Azure).
const { fs, path, ROOT, PAINTINGS, readJson, writeJson, settings, paintingDir, paintingFile } = require('./lib');
const { execSync } = require('child_process');
const args = process.argv.slice(2), code = (args.find((a) => !a.startsWith('--')) || '').toUpperCase();
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const fail = (m) => { console.error('\n' + m + '\n'); process.exit(1); };
if (!code) fail('Usage: node tools/publish-painting.js ART002 [--app C:\\TimaxPay-HubPlus] [--api https://backend] [--push]');
const st = settings(), app = opt('app', st.appRepo || 'C:\\TimaxPay-HubPlus'), api = opt('api', st.api || 'https://timaxpaybridge-backend-gyehgqdbhfd0gefk.eastus2-01.azurewebsites.net').replace(/\/+$/, '');
(async () => {
  if (!fs.existsSync(paintingFile(code))) fail(`No painting.json for ${code}. Run .\\add-painting.ps1 and .\\launch-painting.ps1 first.`);
  const p = readJson(paintingFile(code)); const d = p.deployment;
  if (!d || !d.contracts || !d.contracts.share) fail(`${code} is not launched yet (no deployment block). Run .\\launch-painting.ps1 -Chain arc -Code ${code} first.`);
  console.log(`== ${code}: ${p.title || ''}  share ${d.contracts.share}`);

  // 1. ONE Safe file: accept both oracles + the P2P escrow steps (allow the share, let the escrow hold it) - sign it once
  const out = path.join(ROOT, 'bonus', `safe-accept-oracles-${code}.json`); fs.mkdirSync(path.dirname(out), { recursive: true });
  const txs = d.quotes.map((q) => ({ to: q.oracle, value: '0', data: '0x79ba5097' })); let p2pNote = '';
  try { const pl = await require('./art-p2p-setup').plan(code, opt('escrow', st.escrow)); txs.push(...pl.txs); p2pNote = pl.txs.length ? ` + ${pl.txs.length} P2P escrow step(s)` : ' (P2P escrow already set up)'; }
  catch (e) { p2pNote = ` (P2P escrow steps skipped: ${e.message}; run .\\art-p2p-setup.ps1 -Code ${code} later)`; }
  writeJson(out, { version: '1.0', chainId: String(d.chain.chainId), createdAt: Date.now(), meta: { name: `${code} accept oracles and P2P setup` }, transactions: txs });
  console.log(`1/3 Safe file (accept both oracles${p2pNote}): ${out}`);

  // 2. site files
  const dest = path.join(app, 'public', 'offer', 'paintings', code);
  if (!fs.existsSync(app)) console.log(`2/3 SKIPPED: app folder ${app} not found (use --app).`);
  else {
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.cpSync(paintingDir(code), dest, { recursive: true });
    for (const f of ['paintings.js']) { const s = path.join(ROOT, 'offer', f); if (fs.existsSync(s)) fs.copyFileSync(s, path.join(app, 'public', 'offer', f)); }
    const idx = path.join(PAINTINGS, 'index.json'); if (fs.existsSync(idx)) fs.copyFileSync(idx, path.join(app, 'public', 'offer', 'paintings', 'index.json'));
    console.log(`2/3 Files copied to ${dest}`);
    if (args.includes('--push')) { try { execSync('git add public/offer && git commit -m "Add painting ' + code + '" && git push', { cwd: app, stdio: 'inherit' }); console.log('    Pushed. The site updates when the GitHub Action finishes.'); } catch (e) { console.log('    git push failed: do it by hand in ' + app); } }
    else console.log(`    Not pushed. In ${app} run:  git add -A ; git commit -m "Add ${code}" ; git push`);
  }

  // 3. register with the admin panel (hidden)
  const pw = process.env.ART_ADMIN_PASSWORD; if (!pw) fail('Set the admin password first:  $env:ART_ADMIN_PASSWORD = "..."   (the same value as in Azure), or use publish-painting.ps1 which asks for it.');
  const painting = { ...p }; delete painting.metadata;
  const r = await fetch(api + '/api/art/import', { method: 'POST', headers: { 'content-type': 'application/json', 'x-art-password': pw }, body: JSON.stringify({ code, painting }) });
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.success) console.log(`3/3 Registered in the admin panel (hidden).`);
  else if (r.status === 409) console.log(`3/3 Already registered in the admin panel.`);
  else fail(`3/3 FAILED (${r.status}): ${j.error || 'no answer from ' + api}`);

  console.log(`\nLeft for you:\n  a) Safe: upload ${out} in Transaction Builder and sign (one file: oracles + P2P escrow).\n  b) Verify investor wallets:  .\\whitelist-wallets.ps1 -Code ${code} -Wallets 0x...\n  c) Admin panel > Gallery > pick ${code} > tick Published > Save. Bank-transfer (P2P) selling switches on by itself with Published; nothing to set in Azure.`);
})().catch((e) => fail('Failed: ' + (e && e.message || e)));
