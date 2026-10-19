// Registro manual de compra no Meta (CAPI).
// Só envia o evento se a Sync Pay confirmar que a transação está paga,
// para que ninguém consiga criar vendas falsas chamando esta URL.
const { getTransaction } = require('./_sync-client');
const { sendMetaPurchaseEvent } = require('./_meta-capi');
const { PRODUCT, isPaid, setCorsHeaders, parseBody } = require('./_product');

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido. Utilize POST.' });
  }

  try {
    const body = parseBody(req);
    if (!body) {
      return res.status(400).json({ success: false, message: 'JSON inválido' });
    }

    const { identifier, eventSourceUrl, customData } = body;
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Parâmetro identifier é obrigatório.' });
    }

    const result = await getTransaction(identifier);
    const tx = result.data || result;
    if (!isPaid(tx?.status)) {
      return res.status(409).json({ success: false, message: 'Transação ainda não está paga.' });
    }

    const metaResult = await sendMetaPurchaseEvent({
      eventId: identifier,
      value: PRODUCT.amount,
      user: tx?.client || {},
      req,
      eventSourceUrl: eventSourceUrl || req.headers.referer,
      customData: customData || {}
    });

    return res.status(200).json({
      success: true,
      meta_response: metaResult
    });

  } catch (error) {
    console.error('Erro no endpoint /api/meta-purchase:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erro ao registrar evento de compra no Meta.'
    });
  }
};
