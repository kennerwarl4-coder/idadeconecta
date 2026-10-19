// Webhook Handler for Sync Pay Cash-In Notifications
// Note: Sync Pay requires all webhooks to respond within 5 seconds.
const { getTransaction } = require('./_sync-client');
const { sendMetaPurchaseEvent } = require('./_meta-capi');
const { sendAccessEmail } = require('./_deliver');
const { PRODUCT, isPaid, withTimeout, parseBody } = require('./_product');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método não permitido' });
  }

  try {
    const payload = parseBody(req) || {};
    const identifier = payload?.identifier || payload?.data?.identifier || payload?.id;
    console.log('[SYNC-PAY WEBHOOK RECEIVED]:', identifier, payload?.status || payload?.data?.status);

    if (!identifier) {
      return res.status(200).json({ received: true, ignored: 'sem identificador' });
    }

    // Não confia no corpo do webhook: qualquer um pode chamar esta URL.
    // Confirma o pagamento direto na Sync Pay antes de registrar a venda e entregar.
    const work = (async () => {
      const result = await getTransaction(identifier);
      const tx = result.data || result;
      if (!isPaid(tx?.status)) return { paid: false };

      const client = tx?.client || {};
      await Promise.all([
        sendMetaPurchaseEvent({
          eventId: identifier,
          value: PRODUCT.amount,
          user: client,
          customData: { webhook_received: true }
        }),
        sendAccessEmail({ identifier, name: client.name, email: client.email })
      ]);
      return { paid: true };
    })().catch(err => {
      console.error('[SYNC-PAY WEBHOOK PROCESSING ERROR]:', err.message);
      return { error: true };
    });

    // Responde dentro do limite de 5 segundos da Sync Pay
    const outcome = await withTimeout(work, 4000);

    return res.status(200).json({
      received: true,
      outcome,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[SYNC-PAY WEBHOOK ERROR]:', error);
    return res.status(500).json({ received: false, error: error.message });
  }
};
