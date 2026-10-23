// O checkout aberto pergunta aqui, a cada 5 s, se o Pix já foi pago.
// Fonte da verdade: o /status da LofyPay (só PAID_OUT é pago).
// Limite da LofyPay: 30 consultas/min por IP. Como todos os clientes passam pelo nosso
// servidor, cada Pix consulta a LofyPay no máximo a cada 10 s, e um Pix já confirmado
// pelo webhook nem consulta (lê a marca "pago" guardada no Redis).
const { consultarStatus } = require('./_lofypay');
const { isPaid, normalizeStatus, withTimeout, setCorsHeaders } = require('./_product');
const { open } = require('./_track');
const store = require('./_store');
const { registerSale } = require('./_sale');

const lastCheck = new Map();
const MIN_INTERVAL_MS = 10 * 1000;

async function canQuery(identifier) {
  const now = Date.now();
  if (now - (lastCheck.get(identifier) || 0) < MIN_INTERVAL_MS) return false;
  lastCheck.set(identifier, now);
  if (lastCheck.size > 5000) lastCheck.clear();
  return store.once('st:' + identifier, Math.ceil(MIN_INTERVAL_MS / 1000));
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const identifier = String(req.query?.identifier || req.body?.identifier || '');

    if (!identifier || identifier.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Parâmetro identifier é obrigatório.'
      });
    }

    let lofyStatus = null;
    if (await store.load('paid:' + identifier)) {
      lofyStatus = 'PAID_OUT';
    } else if (await canQuery(identifier)) {
      try {
        lofyStatus = await consultarStatus(identifier);
      } catch (err) {
        if (err.status !== 429) throw err;   // limite: tenta na próxima rodada
      }
    }

    const status = lofyStatus ? normalizeStatus(lofyStatus) : 'pending';
    const paid = isPaid(lofyStatus);

    // Pagamento confirmado pela LofyPay: registra a venda no Meta e na UTMify (uma vez só).
    // O pacote "t" foi devolvido pelo create-pix e traz os dados do cliente e as UTMs.
    if (paid) {
      await store.save('paid:' + identifier, '1', 7 * 24 * 60 * 60);
      const track = open(req.query?.t || req.body?.t) || open(await store.load('track:' + identifier));
      await withTimeout(registerSale({ identifier, track, req, source: 'status_polling' }), 3500);
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
