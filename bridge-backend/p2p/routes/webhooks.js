const crypto = require('crypto');
const { createBankRails } = require('../lib/bankRails');

function hashText(value) {
  return '0x' + crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}
function hmacEqual(a,b){
  const A=Buffer.from(String(a||'')); const B=Buffer.from(String(b||''));
  return A.length===B.length && crypto.timingSafeEqual(A,B);
}

function createP2PWebhookHandlers({ getOrdersContainer, relay, settlement = null, getEscrowWallet = () => '', stripe = null, bankRails = null }) {
  const rails = bankRails || createBankRails(process.env);
  async function queryOne(query, parameters=[]) {
    const c=getOrdersContainer?.(); if(!c)return null;
    const q=await c.items.query({query,parameters}).fetchAll();
    return q.resources?.[0] || null;
  }
  async function findOrder(id) {
    if(!id)return null;
    return queryOne('SELECT TOP 1 * FROM c WHERE c.id=@id AND c.type=@type',[
      {name:'@id',value:id},{name:'@type',value:'timax_p2p_escrow'}
    ]);
  }
  async function findMoneriumOrder(reference) {
    if(!reference)return null;
    const ref=String(reference).trim();
    return queryOne('SELECT TOP 1 * FROM c WHERE c.type=@type AND (c.moneriumReference=@ref OR c.moneriumReferenceNumber=@ref)',[
      {name:'@type',value:'timax_p2p_escrow'},{name:'@ref',value:ref}
    ]);
  }
  async function save(order,patch={}) {
    if(!order)return;
    const c=getOrdersContainer?.(); if(!c)return {...order,...patch};
    const prevStatus=order.status;
    const next={...order,...patch,updatedAt:new Date().toISOString()};
    await c.items.upsert(next);
    try{ require('../lib/p2pNotify').notifyOrder({status:prevStatus},next); }catch(_){ /* alerts never block */ }
    Object.assign(order,next);   // sequential saves in one handler must accumulate (a stale copy used to erase earlier fields)
    return next;
  }
  async function alreadyProcessed(kind,eventId){
    if(!eventId)return false;
    const id=`p2p_webhook_${kind}_${eventId}`;
    const existing=await queryOne('SELECT TOP 1 * FROM c WHERE c.id=@id AND c.type=@type',[
      {name:'@id',value:id},{name:'@type',value:'timax_p2p_webhook_event'}
    ]);
    return !!existing;
  }
  // Recorded only AFTER an event was fully handled, so a failed delivery can be retried.
  async function markProcessed(kind,eventId){
    if(!eventId)return;
    const c=getOrdersContainer?.();
    if(c) await c.items.upsert({id:`p2p_webhook_${kind}_${eventId}`,type:'timax_p2p_webhook_event',kind,eventId,createdAt:new Date().toISOString()});
  }

  async function handleStripeEvent(event){
    const obj=event?.data?.object; if(!obj)return;
    let orderId=obj.metadata?.timax_p2p_order_id;
    // Stripe Dispute objects do not inherit PaymentIntent metadata: map them via payment_intent.
    if(!orderId && String(event.type||'').startsWith('charge.dispute.') && obj.payment_intent){
      const byPi=await queryOne('SELECT TOP 1 * FROM c WHERE c.type=@type AND c.stripePaymentIntentId=@pi',[
        {name:'@type',value:'timax_p2p_escrow'},{name:'@pi',value:String(obj.payment_intent)}
      ]);
      orderId=byPi?.id;
    }
    if(!orderId)return;
    if(await alreadyProcessed('stripe',event.id))return;
    await handleStripeEventInner(event,obj,orderId);   // throws on failure -> not marked processed
    await markProcessed('stripe',event.id);
  }

  async function handleStripeEventInner(event,obj,orderId){
    console.log('[P2P] Stripe event '+event.type+' order '+orderId+' account '+(event.account||'platform'));
    const order=await findOrder(orderId); if(!order){ console.warn('[P2P] Stripe event for unknown order '+orderId); return; }

    // Hosted Checkout on the PLATFORM account: the buyer's money is held by the platform (fiat escrow) until the USDC is delivered.
    if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)){
      if(obj.payment_status!=='paid'){
        // Async method (bank debit / transfer): the payment is IN FLIGHT. PROCESSING is not settled: nothing is released and nothing is paid
        // out yet, but the buyer is protected - the order records it so the seller cannot cancel while it clears.
        if(event.type==='checkout.session.completed' && !event.account && !!order.stripeCheckoutSessionId && obj.id===order.stripeCheckoutSessionId){
          // Bank transfer (customer_balance): "completed" only means the buyer was SHOWN the transfer instructions. No money is in flight yet,
          // so do NOT freeze the order (otherwise an unpaid trade could never be cancelled). The funds arrive later -> async_payment_succeeded.
          if(stripe && obj.payment_intent){
            try{
              const pi0=await stripe.paymentIntents.retrieve(String(obj.payment_intent));
              if(pi0?.status==='requires_action' && String(pi0?.next_action?.type||'')==='display_bank_transfer_instructions'){
                await save(order,{stripeBankTransferAwaiting:true,stripePaymentIntentId:obj.payment_intent||order.stripePaymentIntentId||null});
                return;
              }
            }catch(_){ /* unreadable: fall through and treat as in flight (the safe side for the buyer) */ }
          }
          await save(order,{stripePaymentProcessing:true,stripeProcessingSince:order.stripeProcessingSince||new Date().toISOString(),stripePaymentIntentId:obj.payment_intent||order.stripePaymentIntentId||null});
        }
        return;   // success is announced later (async_payment_succeeded)
      }
      const okStates=['PAYMENT_INITIATED','PAYMENT_CREATED','PAYMENT_FAILED','FIAT_VERIFIED_PENDING_ONCHAIN']; // last one = legitimate retry
      const sessionMatches = !!order.stripeCheckoutSessionId && obj.id===order.stripeCheckoutSessionId;
      // The trade was frozen by the platform because the buyer's money arrived unmatched: this IS that payment completing. Never refund it here;
      // the sweep re-checks the payment and closes the dispute (USDC to the buyer, fiat to the seller).
      if(order.status==='DISPUTED' && order.disputeOpenedBy==='platform' && sessionMatches && !event.account){
        await save(order,{stripePaidWhileFrozen:true,stripePaymentIntentId:obj.payment_intent||order.stripePaymentIntentId||null});
        return;
      }
      const bound = okStates.includes(order.status) && sessionMatches
        && !event.account   // a platform-account event (a connected-account event is never ours)
        && !!obj.metadata?.timax_p2p_buyer_wallet
        && String(obj.metadata.timax_p2p_buyer_wallet).toLowerCase()===String(order.buyerAddress||'').toLowerCase();
      // Money arrived for THIS order's session but the order can no longer be honoured (cancelled, expired, released...): give it back.
      if(!bound){
        const refundable = sessionMatches && !event.account && !!obj.payment_intent;
        console.warn('[P2P] Stripe '+event.type+' NOT released for order '+order.id+' (status '+order.status+', fiatRail '+order.fiatRail+')'); await save(order,{stripeVerificationError:`Rejected ${event.type} (state=${order.status}, session=${obj.id})`,stripeUnmatchedSessionId:obj.id,
          ...(refundable?{stripePaymentIntentId:obj.payment_intent,needsRefund:true,settlementPending:true}:{})});
        return;
      }
      const expectedMinor=Math.round(Number(order.fiatAmount)*100);
      const received=Number(obj.amount_total ?? 0);
      if(!Number.isFinite(expectedMinor) || received!==expectedMinor || String(obj.currency||'').toLowerCase()!==String(order.fiatCurrency||'').toLowerCase()){
        // wrong amount: never verify; refund what was paid
        console.warn('[P2P] Stripe '+event.type+' NOT released for order '+order.id+' (status '+order.status+', fiatRail '+order.fiatRail+')'); await save(order,{stripeVerificationError:'Stripe amount or currency does not match the P2P order',stripePaymentIntentId:obj.payment_intent||null,needsRefund:true,settlementPending:true});
        return;
      }
      // BANK PAYMENTS ONLY: a bank push can not be charged back, a card can. Anything else is refunded and never verified.
      // Proof comes from the charge itself (payment_method_details.type); if it can not be read, the event is retried (safe: nothing is released).
      let paidType=null;
      if(stripe && obj.payment_intent){
        const pi=await stripe.paymentIntents.retrieve(String(obj.payment_intent),{expand:['latest_charge']});
        paidType=pi?.latest_charge?.payment_method_details?.type||null;
      }
      const sessionTypes=Array.isArray(obj.payment_method_types)?obj.payment_method_types:[];
      const bankOk = paidType
        ? rails.isAllowedType(paidType,order.fiatCurrency)
        : (sessionTypes.length>0 && sessionTypes.every(t=>rails.isAllowedType(t,order.fiatCurrency)));
      if(!bankOk){
        console.warn('[P2P] Stripe '+event.type+' NOT released for order '+order.id+' (status '+order.status+', fiatRail '+order.fiatRail+')'); await save(order,{stripeVerificationError:`Rejected: payment method "${paidType||sessionTypes.join(',')||'unknown'}" is not a bank payment`,stripePaymentIntentId:obj.payment_intent||null,needsRefund:true,settlementPending:true});
        return;
      }
      const referenceHash=hashText(obj.id);
      await save(order,{stripePaymentIntentId:obj.payment_intent||null,stripePaymentMethodType:paidType||null,fiatReferenceHash:referenceHash,fiatVerifiedAt:new Date().toISOString(),status:'FIAT_VERIFIED_PENDING_ONCHAIN',stripeEventId:event.id,stripePaymentProcessing:false,stripeFundsReceived:false,stripeBankTransferAwaiting:false,needsAttention:false});
      try{
        const result=await relay('/api/p2p/escrow/verify-fiat',{orderId,fiatReferenceHash:referenceHash,chainId: order.chainId, contractAddress: order.contractAddress});
        await save(order,{status:'FIAT_VERIFIED',fiatVerificationTxHash:result.txHash,settlementPending:!!order.autoRelease});
      }catch(error){
        await save(order,{status:'FIAT_VERIFIED_PENDING_ONCHAIN',fiatVerificationError:error.message});
        throw error;   // surface so the event is NOT marked processed and can be retried
      }
      // Automatic: both legs are secured (crypto in the contract, fiat held by the platform) -> settle and pay the seller.
      // A failure here is safe to swallow: the order is flagged settlementPending and the keeper finishes it.
      if(order.autoRelease && settlement){ try{ await settlement.settleAndPayout(order); }catch(e){ console.warn('[P2P] auto-settle deferred to keeper:',e.message); } }
      return;
    }

    // Checkout lets the buyer retry with another method, so a failed attempt is only recorded, not final.
    if(['checkout.session.async_payment_failed','payment_intent.payment_failed'].includes(event.type)){
      await save(order,{paymentFailureReason:obj.last_payment_error?.message||'Payment failed',stripePaymentProcessing:false});
      return;
    }
    if(event.type==='checkout.session.expired'){
      if(obj.id===order.stripeCheckoutSessionId) await save(order,{stripeCheckoutUrl:null,stripePaymentProcessing:false});   // buyer can request a fresh session
      return;
    }

    if(['charge.dispute.created','charge.dispute.updated'].includes(event.type)){
      // A chargeback is a FIAT-leg event. Before settlement, freeze the order (the seller cannot confirm) and remember where it was;
      // after settlement the order keeps mirroring the chain and the open chargeback is tracked by chargebackOpen (payout held / clawed back).
      const settled=['RELEASED','REFUNDED','CANCELLED'].includes(order.status);
      await save(order,{chargebackOpen:true,stripeDisputeId:obj.id,stripeDisputeStatus:obj.status||null,
        ...(settled?{}:{status:'DISPUTED',statusBeforeChargeback:order.status==='DISPUTED'?(order.statusBeforeChargeback||null):order.status})});
      if(order.stripeTransferId && settlement) { try{ await settlement.reverseTransfer(order); }catch(e){ console.warn('[P2P] transfer reversal failed:',e.message); } }
      return;
    }
    if(event.type==='charge.dispute.closed'){
      const restore=obj.status==='won' && order.status==='DISPUTED' && order.statusBeforeChargeback;
      await save(order,{stripeDisputeId:obj.id,stripeDisputeStatus:obj.status||'closed',stripeDisputeClosedAt:new Date().toISOString(),chargebackOpen:false,...(restore?{status:order.statusBeforeChargeback,statusBeforeChargeback:null}:{}),...(obj.status==='won'?{settlementPending:!order.stripeTransferId&&order.fiatRail==='stripe'&&order.status==='RELEASED'}:{})});
    }
  }

  function verifyMonerium(req){
    const secret=process.env.P2P_MONERIUM_WEBHOOK_SECRET||process.env.MONERIUM_WEBHOOK_SECRET||'';
    if(!secret || !req.rawBody)return false;
    const id=req.headers['webhook-id'];
    const timestamp=req.headers['webhook-timestamp'];
    const signature=req.headers['webhook-signature'];
    if(!id||!timestamp||!signature)return false;
    const tsNum=Number(timestamp);
    if(!Number.isFinite(tsNum)||Math.abs(Date.now()/1000-tsNum)>300)return false; // 5-minute replay window
    const key=Buffer.from(secret.replace(/^whsec_/,'').trim(),'base64');
    const signed=Buffer.concat([Buffer.from(`${id}.${timestamp}.`),req.rawBody]);
    const expected='v1,'+crypto.createHmac('sha256',key).update(signed).digest('base64');
    // Header is a SPACE-delimited list of "v1,<base64>" entries; splitting on ',' (old code) can never match.
    return String(signature).trim().split(/\s+/).some(v=>hmacEqual(v,expected));
  }

  // SEPA references can be re-formatted or embedded in longer text: extract our TMX-XXXXXXXXXX token first.
  function moneriumReference(data){
    const raw=`${data?.referenceNumber||''} ${data?.memo||''}`;
    const m=raw.match(/TMX-[0-9A-F]{10}/i);
    return m?m[0].toUpperCase():String(data?.referenceNumber || data?.memo || '').trim();
  }

  async function handleMoneriumEvent(event, webhookId){
    const key=webhookId || `${event?.type}:${event?.data?.id || ''}`;
    if(await alreadyProcessed('monerium',key))return;
    await handleMoneriumEventInner(event);   // throws on failure -> not marked processed
    await markProcessed('monerium',key);
  }

  // SEPA rail: the buyer paid the SELLER's own Monerium IBAN from any bank. Monerium minted the euros as EURe in the SELLER's wallet (kind 'issue').
  // Fail-closed value binding: minted to the seller's wallet, exact amount, EUR, a payment reference of this order, and an order still waiting for it.
  // The platform never holds this money, so there is nothing to refund here: an unmatched payment is flagged for a human, never auto-released.
  async function handleSepaProcessed(order,data){
    const seller=String(order.sellerAddress||'').toLowerCase();
    const amt=Number(data.amount);
    const amountOk=Number.isFinite(amt) && Math.abs(amt-Number(order.fiatAmount))<0.005;
    const currencyOk=String(data.currency||'').toLowerCase()===String(order.fiatCurrency||'').toLowerCase();
    const destOk=String(data.kind||'')==='issue' && !!data.address && !!seller && String(data.address).toLowerCase()===seller;
    const stateOk=['PAYMENT_INITIATED','PAYMENT_DETECTED','FIAT_VERIFIED_PENDING_ONCHAIN'].includes(order.status);
    if(!(amountOk&&currencyOk&&destOk&&stateOk)){
      const arrived=destOk && String(data.kind||'')==='issue';
      await save(order,{moneriumVerificationError:`Rejected SEPA payment (amountOk=${amountOk}, currencyOk=${currencyOk}, destOk=${destOk}, state=${order.status})`,moneriumUnmatchedOrderId:data.id,
        ...(arrived?{needsAttention:true,sepaPaymentUnmatched:true}:{})});
      if(arrived){ try{ require('../lib/p2pNotify').notifySepaRefundDue(order,{amount:data.amount,currency:data.currency,orderId:data.id}); }catch(_){ /* alerts never block */ } }
      return;
    }
    const referenceHash=hashText(data.id);
    await save(order,{moneriumOrderId:data.id,moneriumState:'processed',fiatReferenceHash:referenceHash,fiatVerifiedAt:new Date().toISOString(),status:'FIAT_VERIFIED_PENDING_ONCHAIN',moneriumTxHashes:data.meta?.txHashes||[]});
    try{
      const result=await relay('/api/p2p/escrow/verify-fiat',{orderId:order.id,fiatReferenceHash:referenceHash,chainId: order.chainId, contractAddress: order.contractAddress});
      await save(order,{status:'FIAT_VERIFIED',fiatVerificationTxHash:result.txHash,settlementPending:!!order.autoRelease});
    }catch(error){
      // The order was cancelled / refunded / expired on-chain before the transfer landed: the euros are already with the seller, so the buyer must be
      // refunded BY THE SELLER. Flag it for a human and stop (permanent: do not make Monerium retry forever).
      if(/Invalid fiat state|expired|not found/i.test(String(error.message))){
        await save(order,{fiatVerificationError:error.message,needsAttention:true,sepaPaidAfterClose:true});
        try{ require('../lib/p2pNotify').notifySepaRefundDue(order,{amount:data.amount,currency:data.currency,orderId:data.id}); }catch(_){ /* alerts never block */ }
        return;
      }
      await save(order,{status:'FIAT_VERIFIED_PENDING_ONCHAIN',fiatVerificationError:error.message});
      throw error;   // transient: not marked processed, Monerium retries
    }
    // Both legs are secured (crypto in the contract, euros already with the seller): release the USDC. A failure is safe to swallow, the keeper finishes it.
    if(order.autoRelease && settlement){ try{ await settlement.settleAndPayout(order); }catch(e){ console.warn('[P2P] SEPA auto-settle deferred to keeper:',e.message); } }
  }

  async function handleMoneriumEventInner(event){
    const data=event?.data||{};
    const ref=moneriumReference(data);
    const order=await findMoneriumOrder(ref); if(!order)return;

    if(event.type==='order.created'){
      if(order.status!=='PAYMENT_INITIATED')return;   // never regress an order that already moved on
      // SEPA: only a transfer that really is this order's payment (minted to the seller, right amount) may freeze the seller's cancel button. A 1-cent payment with our reference must not.
      if(order.fiatRail==='sepa'){
        const a=Number(data.amount);
        if(!(String(data.kind||'')==='issue' && String(data.address||'').toLowerCase()===String(order.sellerAddress||'').toLowerCase() && Number.isFinite(a) && Math.abs(a-Number(order.fiatAmount))<0.005))return;
      }
      await save(order,{moneriumOrderId:data.id,moneriumState:data.state||'placed',status:'PAYMENT_DETECTED',moneriumReferenceNumber:data.referenceNumber||null});
      return;
    }
    if(event.type!=='order.updated')return;

    if(data.state==='processed' && order.fiatRail==='sepa'){
      await handleSepaProcessed(order,data);
      return;
    }
    if(data.state==='processed'){
      // Fail-closed value binding: kind 'issue' (SEPA in -> EURe minted), minted to the PLATFORM escrow wallet, exact amount,
      // EUR, and an order that is still waiting for its payment. Anything else is left alone.
      const escrowWallet=String(getEscrowWallet()||'').toLowerCase();
      const amt=Number(data.amount);
      const amountOk=Number.isFinite(amt) && Math.abs(amt-Number(order.fiatAmount))<0.005;
      const currencyOk=String(data.currency||'').toLowerCase()===String(order.fiatCurrency||'').toLowerCase();
      const destOk=String(data.kind||'')==='issue' && !!data.address && !!escrowWallet && String(data.address).toLowerCase()===escrowWallet;
      const stateOk=['PAYMENT_INITIATED','PAYMENT_DETECTED','FIAT_VERIFIED_PENDING_ONCHAIN'].includes(order.status);
      if(!(amountOk&&currencyOk&&destOk&&stateOk)){
        // Real money reached the escrow wallet for this reference but cannot be matched to the order: needs a human refund.
        const arrived=destOk && String(data.kind||'')==='issue';
        await save(order,{moneriumVerificationError:`Rejected processed order (amountOk=${amountOk}, currencyOk=${currencyOk}, destOk=${destOk}, state=${order.status})`,moneriumUnmatchedOrderId:data.id,
          ...(arrived&&!stateOk?{needsFiatRefund:true,needsAttention:true}:{}),...(arrived&&stateOk&&!amountOk?{needsFiatRefund:true,needsAttention:true}:{})});
        return;
      }
      const referenceHash=hashText(data.id);
      await save(order,{moneriumOrderId:data.id,moneriumState:'processed',fiatReferenceHash:referenceHash,fiatVerifiedAt:new Date().toISOString(),status:'FIAT_VERIFIED_PENDING_ONCHAIN',moneriumTxHashes:data.meta?.txHashes||[]});
      try{
        const result=await relay('/api/p2p/escrow/deposit-fiat',{orderId:order.id,paymentReference:referenceHash,chainId: order.chainId, contractAddress: order.contractAddress});
        await save(order,{status:'FIAT_VERIFIED',fiatVerificationTxHash:result.txHash,settlementPending:!!order.autoRelease});
      }catch(error){
        // The contract refuses a deposit for an expired / already-funded order: the EURe stays in the escrow wallet -> manual refund.
        if(/expired|Invalid deposit state|already deposited/i.test(String(error.message))){
          await save(order,{fiatVerificationError:error.message,needsFiatRefund:true,needsAttention:true});
          return;   // permanent: do not make Monerium retry forever
        }
        await save(order,{status:'FIAT_VERIFIED_PENDING_ONCHAIN',fiatVerificationError:error.message});
        throw error;
      }
      if(order.autoRelease && settlement){ try{ await settlement.settleAndPayout(order); }catch(e){ console.warn('[P2P] auto-settle deferred to keeper:',e.message); } }
      return;
    }
    if(data.state==='rejected'){
      await save(order,{moneriumOrderId:data.id,moneriumState:'rejected',status:'PAYMENT_FAILED',paymentFailureReason:data.meta?.rejectedReason||null});
    }
  }

  return {handleStripeEvent,handleMoneriumEvent,verifyMonerium};
}

// Backward-compatible factory name used by the currently deployed bridge-backend/server.js.
// The implementation remains createP2PWebhookHandlers; this alias preserves the
// existing webhook behavior while supporting the older server bootstrap.
const createP2PWebhookRoutes = createP2PWebhookHandlers;

module.exports={
  createP2PWebhookHandlers,
  createP2PWebhookRoutes,
  hashText
};
