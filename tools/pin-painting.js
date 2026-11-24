// Optional: pins the images, the optional video and the metadata to IPFS with Pinata and stores the ipfs:// link in painting.json.
//   $env:PINATA_JWT = "..." ; node tools/pin-painting.js ART001
const { fs, path, readJson, writeJson, paintingDir, paintingFile } = require('./lib');
const { build } = require('./build-paintings');
const code = (process.argv[2] || '').toUpperCase(), jwt = process.env.PINATA_JWT;
if (!code) { console.error('Usage: node tools/pin-painting.js ART001'); process.exit(1); }
if (!jwt) { console.error('Set PINATA_JWT first (your Pinata API JWT).'); process.exit(1); }
const auth = { Authorization: 'Bearer ' + jwt };
async function pinFile(file) {
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  const r = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers: auth, body: fd });
  if (!r.ok) throw new Error('Pinata refused ' + path.basename(file) + ': ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return (await r.json()).IpfsHash;
}
(async () => {
  const p = readJson(paintingFile(code)), meta = readJson(path.join(paintingDir(code), 'metadata.json'));
  if (!p.images.length) throw new Error('This painting has no image yet. Add one with add-painting first.');
  const hashes = []; for (const img of p.images) { hashes.push(await pinFile(path.join(paintingDir(code), img))); console.log('pinned ' + img + ' -> ipfs://' + hashes[hashes.length - 1]); }
  if (p.video) { const vh = await pinFile(path.join(paintingDir(code), p.video)); console.log('pinned ' + p.video + ' -> ipfs://' + vh); meta.animation_url = 'ipfs://' + vh; } else delete meta.animation_url;
  meta.image = 'ipfs://' + hashes[0]; meta.images = hashes.map(h => 'ipfs://' + h);
  const r = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ pinataContent: meta, pinataMetadata: { name: code + '-metadata.json' } }) });
  if (!r.ok) throw new Error('Pinata refused the metadata: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const uri = 'ipfs://' + (await r.json()).IpfsHash;
  writeJson(path.join(paintingDir(code), 'metadata.json'), meta);
  p.artworkUri = uri; writeJson(paintingFile(code), p); build();
  console.log('Artwork link saved: ' + uri);
})().catch(e => { console.error(e.message || e); process.exit(1); });
