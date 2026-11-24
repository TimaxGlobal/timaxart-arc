import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { encodeFunctionData, formatUnits, parseAbi, parseUnits } from 'viem';

// Guaranteed-return "buyback note": the client buys shares at a fixed price, TimaxArt buys them back at maturity at a fixed higher price.
// The payout is held in the contract as reserve from the moment the note is sold.
const SERIES = '(address share,address quote,address oracle,uint128 entryPrice,uint128 capacity,uint128 sold,uint32 aprBps,uint32 term,uint16 maxAboveOracleBps,uint64 saleEnds,bool open)';
const NOTE = '(address owner,uint32 seriesId,uint64 maturity,uint128 shares,uint128 paid,uint128 payout,uint8 status)';
const ABI = parseAbi([
  'function seriesCount() view returns (uint256)',
  `function getSeries(uint256) view returns (${SERIES})`,
  `function getNote(uint256) view returns (${NOTE})`,
  'function notesOf(address) view returns (uint256[])',
  'function reserveFree(address) view returns (uint256)',
  'function inventoryFree(address) view returns (uint256)',
  'function paused() view returns (bool)',
  'function quoteBuy(uint256,uint256) view returns (uint256 cost,uint256 payout)',
  'function buy(uint256,uint256) returns (uint256)',
  'function redeem(uint256)',
  'function takeShares(uint256)',
]);
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const f = (raw, dec, dp = 2) => Number(formatUnits(BigInt(raw), dec)).toLocaleString('en-GB', { maximumFractionDigits: dp });
const day = (ts) => new Date(Number(ts) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const nice = (e) => {
  const m = e?.shortMessage || e?.message || String(e);
  if (/user rejected|denied|cancel/i.test(m)) return 'You cancelled the request in your wallet.';
  if (/NotVerified/.test(m)) return 'Your wallet is not verified for this offer yet.';
  if (/ReserveTooLow|NoInventory|OverCapacity/.test(m)) return 'This offer has just sold out. Try a smaller amount or check back later.';
  if (/SaleClosed|Paused/.test(m)) return 'This offer is closed right now.';
  if (/StaleAppraisal|PriceAboveAppraisal/.test(m)) return 'The offer is paused until the painting valuation is refreshed.';
  return m.length > 160 ? `${m.slice(0, 160)}…` : m;
};

export default function ArtSharesNotes({ client, contracts, quotes, wallet, verified, send, code, onChanged }) {
  const [offers, setOffers] = useState(null);
  const [mine, setMine] = useState([]);
  const [pick, setPick] = useState(0);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: '', text: '' });
  const note = contracts?.note;

  const load = useCallback(async () => {
    if (!note) return;
    try {
      const n = Number(await client.readContract({ address: note, abi: ABI, functionName: 'seriesCount' }));
      const paused = await client.readContract({ address: note, abi: ABI, functionName: 'paused' });
      const list = [];
      for (let i = 0; i < n; i++) {
        const s = await client.readContract({ address: note, abi: ABI, functionName: 'getSeries', args: [BigInt(i)] });
        const qt = quotes.find((x) => x.address.toLowerCase() === s.quote.toLowerCase());
        if (!qt || !s.open || paused || Number(s.saleEnds) * 1000 < Date.now()) continue;
        const [res, inv] = await Promise.all([
          client.readContract({ address: note, abi: ABI, functionName: 'reserveFree', args: [s.quote] }),
          client.readContract({ address: note, abi: ABI, functionName: 'inventoryFree', args: [s.share] }),
        ]);
        const [, perShare] = await client.readContract({ address: note, abi: ABI, functionName: 'quoteBuy', args: [BigInt(i), 10n ** 18n] });
        const byReserve = perShare > 0n ? (res * 10n ** 18n) / perShare : 0n;
        let left = s.capacity - s.sold; if (inv < left) left = inv; if (byReserve < left) left = byReserve;
        list.push({ id: i, s, qt, left, perShare });
      }
      setOffers(list);
      if (wallet) {
        const ids = await client.readContract({ address: note, abi: ABI, functionName: 'notesOf', args: [wallet] });
        const rows = await Promise.all(ids.map(async (id) => {
          const nt = await client.readContract({ address: note, abi: ABI, functionName: 'getNote', args: [id] });
          const s = await client.readContract({ address: note, abi: ABI, functionName: 'getSeries', args: [BigInt(nt.seriesId)] });
          return { id: Number(id), nt, qt: quotes.find((x) => x.address.toLowerCase() === s.quote.toLowerCase()) };
        }));
        setMine(rows.reverse());
      } else setMine([]);
    } catch (e) { console.warn('[ArtShares notes]', e?.message); setOffers([]); }
  }, [client, note, quotes, wallet]);
  useEffect(() => { load(); }, [load]);

  async function run(label, fn) {
    setBusy(true); setMsg({ kind: '', text: '' });
    try { if (!wallet) throw new Error('Log in to your TimaxPay wallet first.'); await fn(); setMsg({ kind: 'good', text: `${label} confirmed.` }); setAmount(''); await load(); onChanged?.(); }
    catch (e) { setMsg({ kind: 'err', text: nice(e) }); } finally { setBusy(false); }
  }
  const o = offers?.[pick] || offers?.[0];
  const sh = (() => { try { return amount.trim() ? parseUnits(amount.trim(), 18) : 0n; } catch { return 0n; } })();
  const cost = o && sh > 0n ? (sh * o.s.entryPrice + 10n ** 18n - 1n) / 10n ** 18n : 0n;
  const payout = o && sh > 0n ? cost + (cost * BigInt(o.s.aprBps) * BigInt(o.s.term)) / (10000n * 31536000n) : 0n;

  const buy = () => run('Purchase', async () => {
    if (!verified) throw new Error('Your wallet is not verified for this offer yet.');
    if (sh <= 0n) throw new Error('Enter how many shares to buy.');
    if (sh > o.left) throw new Error(`Only ${f(o.left, 18, 2)} shares are left in this offer.`);
    const al = await client.readContract({ address: o.s.quote, abi: ERC20, functionName: 'allowance', args: [wallet, note] });
    if (al < cost) {
      setMsg({ kind: '', text: `Approve ${o.qt.symbol} in your wallet…` });
      await send({ to: o.s.quote, data: encodeFunctionData({ abi: ERC20, functionName: 'approve', args: [note, cost] }) });
      for (let i = 0; i < 40; i++) { if ((await client.readContract({ address: o.s.quote, abi: ERC20, functionName: 'allowance', args: [wallet, note] })) >= cost) break; await sleep(1500); }
    }
    setMsg({ kind: '', text: 'Confirm the purchase in your wallet…' });
    await send({ to: note, data: encodeFunctionData({ abi: ABI, functionName: 'buy', args: [BigInt(o.id), sh] }) });
  });
  const settle = (id, fn, label) => run(label, async () => { await send({ to: note, data: encodeFunctionData({ abi: ABI, functionName: fn, args: [BigInt(id)] }) }); });

  if (!note) return null;
  const hasMine = mine.length > 0;
  if (offers && !offers.length && !hasMine) return null;
  return (
    <div className="space-y-4 rounded-xl border border-amber-500/40 bg-slate-800/50 p-5">
      <div>
        <h3 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck size={18} className="text-amber-300" /> Guaranteed return</h3>
        <p className="text-sm text-slate-400">Buy {code} shares at a fixed price. TimaxArt buys them back at a fixed higher price on a set date, and the money for it is held in the contract from day one.</p>
      </div>
      {!offers && <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" /> Reading offers…</p>}
      {o && (
        <div className="space-y-3">
          {offers.length > 1 && (
            <div className="inline-flex rounded-lg border border-slate-600 p-0.5 text-sm">
              {offers.map((x, i) => <button key={x.id} type="button" onClick={() => { setPick(i); setAmount(''); }} className={`rounded-md px-3 py-1 ${i === pick ? 'bg-amber-600 text-white' : 'text-slate-300'}`}>{(Number(x.s.aprBps) / 100).toFixed(2)}% · {Math.round(Number(x.s.term) / 86400)} days · {x.qt.symbol}</button>)}
            </div>
          )}
          <div className="space-y-1 rounded-lg border border-dashed border-slate-600 p-3 text-sm">
            {[['Fixed return', `${(Number(o.s.aprBps) / 100).toFixed(2)}% a year`], ['Length', `${Math.round(Number(o.s.term) / 86400)} days`], ['Price per share', `${f(o.s.entryPrice, o.qt.decimals, 4)} ${o.qt.symbol}`], ['Left in this offer', `${f(o.left, 18, 2)} shares`], ['Offer open until', day(o.s.saleEnds)]].map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="text-slate-400">{k}</span><span>{v}</span></div>
            ))}
          </div>
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} placeholder="Shares to buy" inputMode="decimal" className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
          {cost > 0n && (
            <div className="space-y-1 rounded-lg border border-dashed border-slate-600 p-3 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">You pay now</span><span>{f(cost, o.qt.decimals, 2)} {o.qt.symbol}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">You get back after {Math.round(Number(o.s.term) / 86400)} days</span><span className="font-semibold text-emerald-300">{f(payout, o.qt.decimals, 2)} {o.qt.symbol}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Gain</span><span>{f(payout - cost, o.qt.decimals, 2)} {o.qt.symbol}</span></div>
            </div>
          )}
          <button type="button" onClick={buy} disabled={busy || !wallet || !verified || sh <= 0n} className="w-full rounded-lg bg-amber-600 py-2 font-semibold text-white disabled:opacity-40">{busy ? 'Working…' : 'Buy with guaranteed return'}</button>
          {wallet && verified === false && <p className="text-xs text-amber-300">Your wallet is not verified for this offer yet. Contact support@timaxpay.com to be added.</p>}
          <p className="text-[11px] text-slate-400">Your shares stay locked in the contract until the end date, so you cannot sell or borrow against them meanwhile. On that date you choose: take the fixed payout in {o.qt.symbol}, or keep the shares instead. If you do nothing, the payout is sent to you 30 days later. The payout is backed by money already held in the contract, not by a promise. The return is fixed, not a share of the painting&apos;s price.</p>
        </div>
      )}
      {hasMine && (
        <div className="space-y-2">
          <h4 className="font-semibold">Your notes</h4>
          {mine.map(({ id, nt, qt }) => {
            const ready = Date.now() / 1000 >= Number(nt.maturity), open = nt.status === 0;
            return (
              <div key={id} className="space-y-2 rounded-lg border border-slate-600 p-3 text-sm">
                <div className="flex justify-between"><span>{f(nt.shares, 18, 2)} {code}</span><span className="text-slate-400">{nt.status === 1 ? 'Paid out' : nt.status === 2 ? 'Shares taken' : ready ? 'Ready' : `Until ${day(nt.maturity)}`}</span></div>
                <div className="flex justify-between text-xs text-slate-400"><span>Paid {f(nt.paid, qt?.decimals ?? 6, 2)} {qt?.symbol}</span><span>Payout {f(nt.payout, qt?.decimals ?? 6, 2)} {qt?.symbol}</span></div>
                {open && ready && (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" disabled={busy} onClick={() => settle(id, 'redeem', 'Payout')} className="rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white disabled:opacity-40">Take payout</button>
                    <button type="button" disabled={busy} onClick={() => settle(id, 'takeShares', 'Shares')} className="rounded-lg border border-slate-600 py-2 text-xs font-semibold disabled:opacity-40">Keep the shares</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {msg.text && <p className={`text-xs ${msg.kind === 'err' ? 'text-red-400' : msg.kind === 'good' ? 'text-emerald-400' : 'text-slate-300'}`}>{msg.text}</p>}
    </div>
  );
}
