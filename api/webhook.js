// Webhook da BravoPay (cadastre em https://bravopay.club/dashboard/integracoes/webhooks):
//   URL: https://SEU-SITE/api/webhook   ·   eventos: transaction.paid (e os outros, se quiser)
// Payload: { "event": "transaction.paid", "transaction": { "id": "tx_xxx", ... } }
// Nunca confia só no aviso: SEMPRE confirma no GET /transactions/{id} antes de registrar
// a venda e entregar. Idempotente: o mesmo pagamento avisado várias vezes entrega uma vez só.
const { consultarTransacao } = require('./_bravopay');
const { sendAccessEmail } = require('./_deliver');
const { isPaid, withTimeout, parseBody } = require('./_product');
const { open, trackFromTransaction } = require('./_track');
const { registerSale } = require('./_sale');
const store = require('./_store');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método não permitido' });
  }

  try {
    const payload = parseBody(req) || {};
    const txInfo = payload.transaction || payload.data || payload;
    const identifier = String(txInfo.id || txInfo.transaction_id || '');
    const event = payload.event || '';
    console.log(`[BRAVOPAY WEBHOOK] evento=${event} id=${identifier}`);

    if (!identifier || identifier.length > 100 || !/^[\w-]+$/.test(identifier)) {
      return res.status(200).json({ received: true, ignored: 'sem id da transação' });
    }

    const work = (async () => {
      const tx = await consultarTransacao(identifier);
      if (!isPaid(tx.status)) return { paid: false, status: tx.status };

      await store.save('paid:' + identifier, '1', 7 * 24 * 60 * 60);
      // A BravoPay já traz cliente e UTMs; o pacote do create-pix completa com IP e cookies do Meta
      const extra = open(await store.load('track:' + identifier));
      const track = trackFromTransaction(tx, extra);

      const [sale] = await Promise.all([
        registerSale({ identifier, track, source: 'webhook' }),
        track.e ? store.once('email:' + identifier).then(first => (first ? sendAccessEmail({ identifier, name: track.n, email: track.e }) : null)) : null
      ]);
      return { paid: true, meta: !!(sale.meta && sale.meta.success), utmify: !!(sale.utmify && sale.utmify.success) };
    })().catch(err => {
      console.error('[BRAVOPAY WEBHOOK PROCESSING ERROR]:', err.message, err.requestId ? `x-request-id=${err.requestId}` : '');
      return { error: true };
    });

    const outcome = await withTimeout(work, 6500);

    // Falhou ao confirmar: responde erro para a BravoPay reenviar mais tarde
    if (outcome && outcome.error) {
      return res.status(503).json({ received: false, retry: true });
    }

    return res.status(200).json({
      received: true,
      outcome,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BRAVOPAY WEBHOOK ERROR]:', error.message);
    return res.status(500).json({ received: false, error: 'erro interno' });
  }
};
