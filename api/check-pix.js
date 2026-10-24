// O checkout pergunta aqui, a cada 3 s, se o Pix já foi pago; a página /obrigado
// também usa esta rota para mostrar o link de acesso.
// Fonte da verdade: GET /transactions/{id} da BravoPay (só PAID é pago).
// Cada Pix consulta a BravoPay no máximo a cada 3 s, e um Pix já confirmado
// (pelo webhook ou por uma consulta anterior) nem consulta: lê a marca "pago" do Redis.
const { consultarTransacao } = require('./_bravopay');
const { isPaid, normalizeStatus, withTimeout, setCorsHeaders } = require('./_product');
const { open, trackFromTransaction } = require('./_track');
const store = require('./_store');
const { registerSale } = require('./_sale');

const lastCheck = new Map();
const MIN_INTERVAL_MS = 3000;

function canQuery(identifier) {
  const now = Date.now();
  if (now - (lastCheck.get(identifier) || 0) < MIN_INTERVAL_MS) return false;
  lastCheck.set(identifier, now);
  if (lastCheck.size > 5000) lastCheck.clear();
  return true;
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const identifier = String(req.query?.identifier || req.body?.identifier || '');

    if (!identifier || identifier.length > 100 || !/^[\w-]+$/.test(identifier)) {
      return res.status(400).json({
        success: false,
        message: 'Parâmetro identifier é obrigatório.'
      });
    }

    let status = 'pending';
    let paid = false;

    if (await store.load('paid:' + identifier)) {
      status = 'paid';
      paid = true;
    } else if (canQuery(identifier)) {
      let tx = null;
      try {
        tx = await consultarTransacao(identifier);
      } catch (err) {
        if (err.status !== 429) throw err;   // limite: tenta na próxima rodada
      }
      if (tx) {
        status = normalizeStatus(tx.status);
        paid = isPaid(tx.status);
        if (paid) {
          // Pagamento confirmado pela BravoPay: registra a venda no Meta (e na UTMify própria, se ligada).
          await store.save('paid:' + identifier, '1', 7 * 24 * 60 * 60);
          const extra = open(req.query?.t || req.body?.t) || open(await store.load('track:' + identifier));
          await withTimeout(registerSale({ identifier, track: trackFromTransaction(tx, extra), req, source: 'status_polling' }), 3500);
        }
      }
    }

    // Devolve só o necessário: nunca os dados pessoais da transação
    return res.status(200).json({
      success: true,
      data: {
        status,
        paid,
        access_url: paid ? (process.env.PRODUCT_ACCESS_URL || null) : null
      }
    });
  } catch (error) {
    console.error('Erro ao verificar status do Pix:', error.message, error.requestId ? `x-request-id=${error.requestId}` : '');

    return res.status(error.status && error.status < 600 ? error.status : 500).json({
      success: false,
      message: error.message || 'Erro ao consultar status da transação.'
    });
  }
};
