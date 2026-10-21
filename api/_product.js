// Dados da oferta usados por todas as rotas da API.
// O preço é definido só aqui, no servidor: o navegador nunca escolhe o valor cobrado.
const PRODUCT = {
  id: 'idade-conecta-500-guias',
  name: 'Idade Conecta: +500 guias ilustrados + 4 bônus',
  shortName: 'Idade Conecta',
  amount: 19.9,
  currency: 'BRL'
};

// Status da Sync Pay que significam pagamento confirmado
const PAID_STATUSES = ['completed', 'paid', 'approved'];

function isPaid(status) {
  return PAID_STATUSES.includes(String(status || '').toLowerCase());
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

module.exports = { PRODUCT, isPaid, withTimeout, setCorsHeaders, parseBody };
