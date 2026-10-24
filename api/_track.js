// Dados de rastreamento de um pedido (cliente, UTMs, IP, cookies do Meta).
// A BravoPay devolve o cliente e as UTMs na consulta da transação, mas não o IP, o
// navegador nem os cookies do Meta (_fbp/_fbc), que melhoram a correspondência da Compra.
// Esses extras viajam num "pacote" criptografado:
//  - guardado no Redis (para o webhook, quando o cliente paga e fecha a página);
//  - com o checkout, que reenvia o pacote a cada verificação de status.
// AES-256-GCM: ninguém lê os dados pessoais (nem em logs) e ninguém consegue alterá-los.
const crypto = require('crypto');
const { PRODUCT } = require('./_product');

function key() {
  const secret = process.env.TRACKING_SECRET || process.env.BRAVOPAY_API_KEY || '';
  if (!secret) throw new Error('TRACKING_SECRET ou BRAVOPAY_API_KEY não configurado.');
  return crypto.createHash('sha256').update('idadeconecta-track:' + secret).digest();
}

function seal(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

function open(token) {
  if (!token || typeof token !== 'string' || token.length > 4000) return null;
  try {
    const buf = Buffer.from(token, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const dec = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch (e) {
    return null;
  }
}

// Parâmetros aceitos pela UTMify
const TRACKING_KEYS = ['src', 'sck', 'utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term'];
// Parâmetros guardados do anúncio (UTMs + ids de clique do Facebook, TikTok e Google)
const AD_KEYS = TRACKING_KEYS.concat(['fbclid', 'ttclid', 'gclid']);

function pickAdParams(params) {
  const out = {};
  AD_KEYS.forEach(k => {
    const v = params && params[k];
    if (v) out[k] = String(v).slice(0, 250);
  });
  return out;
}

// Formato do campo "utm" da BravoPay
function toBravoUtm(p) {
  return {
    source: p.utm_source || null,
    medium: p.utm_medium || null,
    campaign: p.utm_campaign || null,
    content: p.utm_content || null,
    term: p.utm_term || null,
    fbclid: p.fbclid || null,
    ttclid: p.ttclid || null,
    gclid: p.gclid || null
  };
}

/**
 * Monta os dados da venda a partir da transação da BravoPay (cliente, UTMs, data de criação)
 * e completa com o pacote do create-pix (IP, navegador, cookies do Meta), se houver.
 */
function trackFromTransaction(tx, extra) {
  const c = tx.customer || {};
  const t = tx.tracking || {};
  const base = {
    n: c.name || null,
    e: c.email || null,
    p: c.phone ? String(c.phone).replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '') : null,
    d: c.cpf || null,
    u: {
      utm_source: t.utm_source || null, utm_medium: t.utm_medium || null, utm_campaign: t.utm_campaign || null,
      utm_content: t.utm_content || null, utm_term: t.utm_term || null, src: null, sck: null
    },
    c: tx.created_at ? utmifyDate(tx.created_at) : null
  };
  const x = extra || {};
  return { ...base, ip: x.ip || null, ua: x.ua || null, fbp: x.fbp || null, fbc: x.fbc || null,
    u: { ...base.u, ...(x.u || {}) }, c: base.c || x.c || null, n: base.n || x.n, e: base.e || x.e, p: base.p || x.p, d: base.d || x.d };
}

function pickUtms(utms) {
  const out = {};
  TRACKING_KEYS.forEach(k => {
    const v = utms && utms[k];
    out[k] = v ? String(v).slice(0, 250) : null;
  });
  return out;
}

// Formato exigido pela UTMify: "YYYY-MM-DD HH:MM:SS" em UTC
function utmifyDate(d) {
  return new Date(d).toISOString().slice(0, 19).replace('T', ' ');
}

function requestContext(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return {
    ip: forwarded ? forwarded.split(',')[0].trim() : (req.socket && req.socket.remoteAddress) || null,
    ua: (req.headers['user-agent'] || '').slice(0, 300) || null,
    fbp: cookies._fbp || null,
    fbc: cookies._fbc || null
  };
}

/**
 * Envia (ou atualiza) um pedido na UTMify.
 * Para atualizar o status, o createdAt precisa ser exatamente o mesmo do envio original.
 * @param {Object} o
 * @param {string} o.orderId
 * @param {'waiting_payment'|'paid'|'refused'|'refunded'|'chargedback'} o.status
 * @param {Object} o.track - pacote aberto (n, e, p, d, ip, u, c)
 * @param {string|null} [o.approvedDate]
 */
async function sendUtmifyOrder({ orderId, status, track, approvedDate = null }) {
  const token = process.env.UTMIFY_API_TOKEN;
  if (!token) {
    // Sem token: a UTMify é alimentada pela integração nativa da BravoPay (aba Integrações)
    return { success: false, skipped: true };
  }
  if (!track || !track.c) {
    console.warn(`[UTMIFY] Pedido ${orderId} sem dados de rastreamento. Não enviado.`);
    return { success: false, skipped: true };
  }

  const cents = Math.round(PRODUCT.amount * 100);
  const fee = Math.max(0, parseInt(process.env.UTMIFY_GATEWAY_FEE_CENTS || '0', 10) || 0);

  const payload = {
    orderId: String(orderId),
    platform: 'IdadeConecta',
    paymentMethod: 'pix',
    status,
    createdAt: track.c,
    approvedDate,
    refundedAt: null,
    customer: {
      name: track.n || 'Cliente',
      email: track.e || '',
      phone: track.p || null,
      document: track.d || null,
      country: 'BR',
      ip: track.ip || undefined
    },
    products: [{
      id: PRODUCT.id,
      name: PRODUCT.name,
      planId: null,
      planName: null,
      quantity: 1,
      priceInCents: cents
    }],
    trackingParameters: pickUtms(track.u),
    commission: {
      totalPriceInCents: cents,
      gatewayFeeInCents: fee,
      userCommissionInCents: cents - fee
    },
    isTest: process.env.UTMIFY_IS_TEST === 'true'
  };

  try {
    const response = await fetch('https://api.utmify.com.br/api-credentials/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-token': token },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      console.error(`[UTMIFY ERROR] ${status} ${orderId}:`, response.status, JSON.stringify(result));
      return { success: false, status: response.status, error: result };
    }
    console.log(`[UTMIFY SUCCESS] Pedido ${orderId} enviado como ${status}.`);
    return { success: true };
  } catch (err) {
    console.error('[UTMIFY NETWORK ERROR]:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { seal, open, pickUtms, pickAdParams, toBravoUtm, trackFromTransaction, utmifyDate, requestContext, sendUtmifyOrder };
