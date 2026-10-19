const { getTransaction } = require('./_sync-client');
const { sendMetaPurchaseEvent } = require('./_meta-capi');
const { PRODUCT, isPaid, withTimeout, setCorsHeaders } = require('./_product');

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

    // Pagamento confirmado pela Sync Pay: registra a compra no Meta (servidor).
    // O mesmo event_id do Pixel do navegador evita contar a venda duas vezes.
    if (paid) {
      await withTimeout(sendMetaPurchaseEvent({
        eventId: identifier,
        value: PRODUCT.amount,
        user: txData?.client || {},
        req,
        eventSourceUrl: req.headers.referer,
        customData: { verified_via_status_polling: true }
      }), 2500);
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
