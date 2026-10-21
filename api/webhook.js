// Webhook Handler for Sync Pay Cash-In Notifications
// Note: Sync Pay requires all webhooks to respond within 5 seconds.
const { getTransaction } = require('./_sync-client');
const { sendAccessEmail } = require('./_deliver');
const { isPaid, withTimeout, parseBody } = require('./_product');
const { open } = require('./_track');
const { registerSale } = require('./_sale');
const store = require('./_store');

// Se o armazenamento não estiver ativo, aproveita os dados do cliente que vierem no aviso
function fromPayload(p) {
  const c = p?.client || p?.data?.client || p?.customer || p?.data?.customer;
  if (!c || !c.email) return null;
  return { n: c.name, e: c.email, p: c.phone, d: c.cpf || c.document };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método não permitido' });
  }

  try {
    const payload = parseBody(req) || {};
    const identifier = payload?.identifier || payload?.reference_id || payload?.data?.identifier || payload?.data?.reference_id || payload?.id;
    console.log('[SYNC-PAY WEBHOOK RECEIVED]:', identifier, payload?.status || payload?.data?.status);

    if (!identifier) {
      return res.status(200).json({ received: true, ignored: 'sem identificador' });
    }

    // Dados do pedido guardados pelo create-pix (cliente, UTMs, IP, cookies do Meta)
    const track = open(await store.load('track:' + identifier)) || fromPayload(payload);
    if (!track || !track.c) console.warn(`[SYNC-PAY WEBHOOK] Pedido ${identifier} sem dados completos de rastreamento (ative o Upstash Redis).`);

    // Não confia no corpo do webhook: qualquer um pode chamar esta URL.
    // Confirma o pagamento direto na Sync Pay antes de registrar a venda e entregar.
    const work = (async () => {
      const result = await getTransaction(identifier);
      const tx = result.data || result;
      if (!isPaid(tx?.status)) return { paid: false };

      const t = track || {};
      const [sale] = await Promise.all([
        registerSale({ identifier, track, source: 'webhook' }),
        store.once('email:' + identifier).then(first => (first ? sendAccessEmail({ identifier, name: t.n, email: t.e }) : null))
      ]);
      return { paid: true, meta: !!(sale.meta && sale.meta.success), utmify: !!(sale.utmify && sale.utmify.success) };
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
