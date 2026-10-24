// Dados da oferta usados por todas as rotas da API.
// O preço é definido só aqui, no servidor: o navegador nunca escolhe o valor cobrado.
const PRODUCT = {
  id: 'idade-conecta-500-guias',
  name: 'Idade Conecta: +500 guias ilustrados + 4 bônus',
  shortName: 'Idade Conecta',
  amount: 19.9,
  amountCents: 1990,
  currency: 'BRL'
};

// ▼▼▼ ID DO PRODUTO NA BRAVOPAY ▼▼▼
// Copie em https://bravopay.club/dashboard/produtos e cole na variável BRAVOPAY_PRODUCT_ID
// da Vercel (ou entre as aspas abaixo). Necessário para a venda aparecer com o nome
// certo na UTMify; sem ele a BravoPay usa um produto interno "fantasma".
const BRAVOPAY_PRODUCT_ID = process.env.BRAVOPAY_PRODUCT_ID || '';
// ▲▲▲

// Status da BravoPay: PENDING, PAID, EXPIRED, REFUNDED, FAILED, CANCELED. Só PAID é pago.
function isPaid(status) {
  return String(status || '').toUpperCase() === 'PAID';
}

// Status simples para o checkout
function normalizeStatus(status) {
  const s = String(status || '').toUpperCase();
  return ({ PAID: 'paid', PENDING: 'pending', EXPIRED: 'expired', FAILED: 'failed', CANCELED: 'canceled', REFUNDED: 'refunded' })[s] || 'pending';
}

// Espera uma promessa por no máximo `ms` (webhooks precisam responder rápido)
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve({ success: false, timeout: true }), ms))
  ]);
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.SITE_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return null; }
  }
  return body || {};
}

module.exports = { PRODUCT, BRAVOPAY_PRODUCT_ID, isPaid, normalizeStatus, withTimeout, setCorsHeaders, parseBody };
