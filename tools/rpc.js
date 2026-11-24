// Tiny JSON-RPC + ABI helpers, no dependencies (Node 18+). Selectors are precomputed.
const { readJson, paintingFile } = require('./lib');
const SEL = { position: '0x93c52062', market: '0x5c60e39a', setKyc: '0x07004483', kyc: '0x2e0474ed', admin: '0xf851a440', kycOperator: '0x1001a512', transfer: '0xa9059cbb' };
const SUPPLY_TOPIC = '0xedf8870433c83823eb071d3df1caa8d008f12f6440918c20d75a3602cda30fe0';
const w = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const addr = (a) => { if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error('Not an address: ' + a); return a.toLowerCase(); };
const num = (n) => BigInt(n).toString(16).padStart(64, '0');
function load(code) {
  const f = paintingFile(code);
  let p; try { p = readJson(f); } catch (e) { throw new Error('No painting.json for ' + code); }
  if (!p.deployment) throw new Error(code + ' is not launched yet.');
  const rpcs = [process.env.ARC_RPC, p.deployment.chain.rpc].filter(Boolean);
  return { p, f, d: p.deployment, rpcs };
}
function client(rpcs) {
  let id = 1;
  async function call(method, params) {
    let last;
    for (const url of rpcs) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) });
        const j = await r.json();
        if (j.error) { last = new Error(j.error.message || JSON.stringify(j.error)); last.rpcError = true; if (rpcs.length === 1 || last.rpcError) { if (/range|limit|too many|exceed/i.test(last.message)) throw last; } continue; }
        return j.result;
      } catch (e) { last = e; if (/range|limit|too many|exceed/i.test(e.message)) throw e; }
    }
    throw last || new Error('RPC failed');
  }
  return { call, ethCall: (to, data) => call('eth_call', [{ to, data }, 'latest']) };
}
module.exports = { SEL, SUPPLY_TOPIC, w, addr, num, load, client };
