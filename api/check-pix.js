const { getTransaction } = require('./_sync-client');
const { isPaid, withTimeout, setCorsHeaders } = require('./_product');
const { open } = require('./_track');
const store = require('./_store');
const { registerSale } = require('./_sale');

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const identifier = req.query?.identifier || req.body?.identifier;

    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: 'Parâmetro identifier é obrigatório.'
      });
    }

    const result = await getTransaction(identifier);
    const txData = result.data || result;
    const status = txData?.status;
    const paid = isPaid(status);

    // Pagamento confirmado pela Sync Pay: registra a venda no Meta e na UTMify.
    // O pacote "t" foi devolvido pelo create-pix e traz os dados do cliente e as UTMs.
    if (paid) {
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
    console.error('Erro ao verificar status do Pix:', error, error.details || '');

    return res.status(error.status && error.status < 600 ? error.status : 500).json({
      success: false,
      message: error.message || 'Erro ao consultar status da transação.'
    });
  }
};
