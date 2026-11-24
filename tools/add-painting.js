// Adds (or updates) one painting: copies the images, writes painting.json + metadata.json, rebuilds the page data.
//   node tools/add-painting.js                       asks for every missing detail
//   node tools/add-painting.js --code ART002 --title "Harbour at Dusk" --artist "A. Painter" --year 2019 --medium "Oil on canvas" ^
//        --description "..." --price 10000 --images "C:\pics\front.jpg" "C:\pics\detail.jpg" --video "C:\pics\closeup.mp4"
//   Video is optional (mp4 or webm, ideally under 20 MB). --video none removes the current one.
const readline = require('readline');
const os = require('os');
const { fs, path, readJson, writeJson, settings, paintingDir, paintingFile } = require('./lib');
const { build } = require('./build-paintings');

function parseArgs(argv) {
  const a = {}; let key = null;
  for (const t of argv) {
    if (t.startsWith('--')) { key = t.slice(2); a[key] = []; }
    else if (key) a[key].push(t);
  }
  const out = {}; for (const k in a) out[k] = a[k].length > 1 ? a[k] : (a[k][0] === undefined ? true : a[k][0]);
  return out;
}
// line queue: works when typing, pasting several lines at once, or piping input
const lineQ = [], waiters = []; let closed = false;
const rlGlobal = readline.createInterface({ input: process.stdin, terminal: false });
rlGlobal.on('line', l => { const w = waiters.shift(); if (w) w(l); else lineQ.push(l); });
rlGlobal.on('close', () => { closed = true; while (waiters.length) waiters.shift()(''); });
const nextLine = () => new Promise(res => { if (lineQ.length) res(lineQ.shift()); else if (closed) res(''); else waiters.push(res); });
const ask = async (rl, q, def) => { process.stdout.write(q + (def !== undefined && def !== '' ? ' [' + def + ']' : '') + ': '); const v = (await nextLine()).trim(); return v || (def === undefined ? '' : String(def)); };
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp'], VID_EXT = ['.mp4', '.webm'];
async function fetchMedia(url, i, exts) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error('Could not download ' + url + ' (HTTP ' + r.status + ')');
  const ct = (r.headers.get('content-type') || '').split(';')[0].trim();
  const byType = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm' };
  const ext = byType[ct] || path.extname(new URL(url).pathname).toLowerCase();
  if (!exts.includes(ext)) throw new Error('That link is not a ' + exts.join('/').replace(/\./g, '') + ' file: ' + url);
  const f = path.join(os.tmpdir(), 'painting-' + Date.now() + '-' + i + ext);
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  return f;
}
const clean = p => p.trim().replace(/^["']|["']$/g, '');
const splitPaths = v => Array.isArray(v) ? v.map(clean) : String(v || '').split(/[,;]| ?\|\| ?/).map(clean).filter(Boolean);

(async () => {
  const A = parseArgs(process.argv.slice(2)), cfg = settings();
  const rl = rlGlobal;
  const need = async (k, q, def, req = true) => { let v = A[k]; if (v === undefined || v === true) { v = await ask(rl, q, def); } while (req && !String(v).trim()) { if (closed && !lineQ.length) { console.error('Missing required value: ' + q); process.exit(1); } v = await ask(rl, q + ' (required)', def); } return v; };

  console.log('\nAdd a painting. Press Enter to accept a value in [brackets].\n');
  const code = String(await need('code', 'Short code, 3-12 capitals/digits (becomes the token symbol)', 'ART001')).toUpperCase();
  if (!/^[A-Z0-9]{3,12}$/.test(code)) { console.error('The code must be 3-12 letters or digits, for example ART002.'); process.exit(1); }
  const exists = fs.existsSync(paintingFile(code));
  const prev = exists ? readJson(paintingFile(code)) : {};
  if (exists) console.log('Updating the existing ' + code + ' (its launch data and artwork link are kept).');

  const title = await need('title', 'Name of the painting', prev.title);
  const artist = await need('artist', 'Artist', prev.artist);
  const year = await need('year', 'Year', prev.year, false);
  const medium = await need('medium', 'Medium and size', prev.medium || 'Oil on canvas', false);
  const description = await need('description', 'Short description (what a buyer should know)', prev.description, false);
  const needNum = async (k, q, def, max) => {
    for (;;) {
      const n = Number(String(await need(k, q, def)).replace(/[,£\s]/g, ''));
      if (n > 0 && (!max || n <= max)) return n;
      if (A[k] !== undefined && A[k] !== true) { console.error('--' + k + ' must be a number above zero' + (max ? ' and at most ' + max : '') + '.'); process.exit(1); }
      console.log('  Please type a number' + (max ? ' up to ' + max : '') + ', for example ' + def + '.');
    }
  };
  const price = await needNum('price', 'Valuation in GBP (numbers only)', prev.priceGbp || 10000);
  const shares = Math.round(await needNum('shares', 'Total number of shares', prev.shares || cfg.defaultShares || 10000));
  const defOffer = prev.offeredShares || Math.round(shares * (cfg.offeredPercent || 49) / 100);
  const offered = Math.round(await needNum('offered', 'Shares put on sale', defOffer, shares));
  const valuer = await need('valuer', 'Independent valuer', prev.valuer, false);
  const custodian = await need('custodian', 'Who stores and insures it', prev.custodian, false);
  const owner = await need('owner', 'Company that holds the painting', prev.owner, false);
  const reportUri = await need('report', 'Valuation report link (ipfs:// or https://), if any', prev.reportUri, false);
  let imgs = A.images !== undefined ? splitPaths(A.images) : null;
  if (imgs === null) { const keep = (prev.images || []).length ? ' (Enter keeps the ' + prev.images.length + ' current image(s))' : ''; const v = await ask(rl, 'Image files or web links, separate several with a comma' + keep, ''); imgs = splitPaths(v); }

  let vid = A.video !== undefined ? (A.video === true ? '' : clean(String(A.video))) : null;
  if (vid === null) { const keep = prev.video ? ' (Enter keeps the current video, type none to remove it)' : ''; vid = clean(await ask(rl, 'Short video file or web link, optional, mp4 or webm' + keep, '')); }

  if (process.stdin.isTTY && !A.yes) {
    console.log('\nCheck before saving:');
    [['Code', code], ['Name', title], ['Artist', artist], ['Year', year], ['Medium', medium], ['Description', description], ['Valuation', 'GBP ' + price + ' (GBP ' + (price / shares).toFixed(4) + ' a share)'], ['Shares', shares + ', ' + offered + ' on sale'],
      ['Valuer', valuer], ['Stored by', custodian], ['Held by', owner], ['Images', imgs.length ? imgs.length + ' new' : 'unchanged'], ['Video', vid.toLowerCase() === 'none' ? 'removed' : vid ? 'new' : (prev.video ? 'unchanged' : 'none')]].forEach(r => console.log('  ' + (r[0] + ':').padEnd(13) + (r[1] === '' || r[1] === undefined ? '-' : r[1])));
    const ok = (await ask(rl, 'Save? (Y/n)', 'Y')).toLowerCase();
    if (ok !== 'y' && ok !== 'yes') { console.log('Nothing saved. Run it again to retype.'); process.exit(0); }
  }
  rl.close();
  if (!imgs.length && !(prev.images || []).length) console.warn('Note: no image yet. Run this again with the image files to add them.');

  fs.mkdirSync(paintingDir(code), { recursive: true });
  let images = prev.images || [];
  if (imgs.length) {
    images = [];
    for (let i = 0; i < imgs.length; i++) {
      let src = imgs[i];
      if (/^https?:\/\//i.test(src)) { try { src = await fetchMedia(src, i, IMG_EXT); } catch (e) { console.error(e.message); process.exit(1); } }
      if (!fs.existsSync(src)) { console.error('Image not found: ' + src); process.exit(1); }
      const ext = path.extname(src).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) { console.error('Use jpg, png or webp: ' + src); process.exit(1); }
      const size = fs.statSync(src).size; if (size > 5 * 1024 * 1024) console.warn('Warning: ' + path.basename(src) + ' is ' + (size / 1048576).toFixed(1) + ' MB. Smaller loads faster for investors.');
      const name = 'image' + (i + 1) + ext; fs.copyFileSync(src, path.join(paintingDir(code), name)); images.push(name);
    }
    for (const f of fs.readdirSync(paintingDir(code))) if (/^image\d+\./.test(f) && !images.includes(f)) fs.unlinkSync(path.join(paintingDir(code), f));
  }

  let video = prev.video || '';
  if (vid.toLowerCase() === 'none') { if (video) try { fs.unlinkSync(path.join(paintingDir(code), video)); } catch (e) {} video = ''; }
  else if (vid) {
    let src = vid;
    if (/^https?:\/\//i.test(src)) { try { src = await fetchMedia(src, 'v', VID_EXT); } catch (e) { console.error(e.message); process.exit(1); } }
    if (!fs.existsSync(src)) { console.error('Video not found: ' + src); process.exit(1); }
    const ext = path.extname(src).toLowerCase();
    if (!VID_EXT.includes(ext)) { console.error('Use an mp4 or webm video: ' + src); process.exit(1); }
    const mb = fs.statSync(src).size / 1048576;
    if (mb > 100) { console.error('The video is ' + mb.toFixed(0) + ' MB. Please shrink it to under 100 MB (20 MB or less loads fast on phones).'); process.exit(1); }
    if (mb > 20) console.warn('Warning: the video is ' + mb.toFixed(1) + ' MB. About 20 MB or less loads faster for investors.');
    for (const f of fs.readdirSync(paintingDir(code))) if (/^video\d+\./.test(f)) fs.unlinkSync(path.join(paintingDir(code), f));
    video = 'video1' + ext; fs.copyFileSync(src, path.join(paintingDir(code), video));
  }

  const painting = {
    code, title, artist, year, medium, description, images, video, priceGbp: price, shares, offeredShares: offered,
    sharePriceGbp: +(price / shares).toFixed(6), valuer, custodian, owner, reportUri,
    artworkUri: prev.artworkUri || '', deployment: prev.deployment || null, createdAt: prev.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  writeJson(paintingFile(code), painting);

  const base = (cfg.artworkBaseUrl || '').replace(/\/$/, '');
  const metadata = {
    name: title + ' (' + code + ')',
    description: (description ? description + ' ' : '') + 'Fractional shares of one physical painting valued at GBP ' + price + ', split into ' + shares + ' shares.',
    image: images[0] ? (base ? base + '/' + code + '/' + images[0] : images[0]) : '',
    ...(video ? { animation_url: base ? base + '/' + code + '/' + video : video } : {}),
    attributes: [
      { trait_type: 'Artist', value: artist }, { trait_type: 'Year', value: year }, { trait_type: 'Medium', value: medium },
      { trait_type: 'Valuation (GBP)', value: price }, { trait_type: 'Total shares', value: shares }
    ].filter(x => x.value !== '' && x.value !== undefined)
  };
  writeJson(path.join(paintingDir(code), 'metadata.json'), metadata);

  build();
  console.log('\nSaved ' + code + ' in offer\\paintings\\' + code + '\\  (painting.json, metadata.json, ' + images.length + ' image(s)' + (video ? ', 1 video' : '') + ').');
  console.log('Price per share: GBP ' + painting.sharePriceGbp + '. Offer page data rebuilt.');
  console.log('\nNext:  .\\autofill-config.ps1 -Chain arc      (once per chain)\n       .\\launch-painting.ps1 -Chain arc -Code ' + code + '\n');
})().catch(e => { console.error(e.message || e); process.exit(1); });
