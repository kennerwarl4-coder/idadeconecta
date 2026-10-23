// Webhook da LofyPay. Recebe os dois canais:
//  A) notification_url de cada cobrança (sem assinatura): { status, idTransaction, external_reference, ... }
//  B) endpoint cadastrado no painel (assinado): { event, sent_at, data: { idTransaction, ... } }
// Nunca confia só no aviso: valida a assinatura quando houver (LOFYPAY_WEBHOOK_SECRET)
// e SEMPRE confirma no /status antes de registrar a venda e entregar.
// Responde em até 8 s (a LofyPay reenvia em 1 min, 5 min, 30 min, 2 h e 12 h se não receber 2xx).
const { consultarStatus, verificarWebhook } = require('./_lofypay');
const { sendAccessEmail } = require('./_deliver');
const { isPaid, withTimeout } = require('./_product');
const { open } = require('./_track');
const { registerSale } = require('./_sale');
const store = require('./_store');

// Corpo CRU, necessário para a assinatura bater
async function readRawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (req.readable && !req.readableEnded) {
    const chunks = [];
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw) return raw;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método não permitido' });
  }

  try {
    const raw = await readRawBody(req);
    let payload = {};
    if (raw) {
      try { payload = JSON.parse(raw); } catch (e) { return res.status(400).json({ received: false, error: 'JSON inválido' }); }
    } else if (req.body && typeof req.body === 'object') {
      payload = req.body;
    }

    // Canal assinado: rejeita assinatura inválida (só dá para validar com o corpo cru)
    const signature = raw ? verificarWebhook(raw, req.headers) : null;
    if (signature === false) {
      console.warn('[LOFYPAY WEBHOOK] Assinatura inválida. Aviso rejeitado.');
      return res.status(401).json({ received: false, error: 'assinatura inválida' });
    }

    const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    const identifier = String(data.idTransaction || data.id_transaction || data.idtransaction || '');
    const event = req.headers['x-lofypay-event'] || payload.event || data.status || '';
    const isTest = req.headers['x-lofypay-environment'] === 'test';
    console.log(`[LOFYPAY WEBHOOK] evento=${event} id=${identifier} assinado=${signature === true}${isTest ? ' (sandbox)' : ''}`);

    if (!identifier) {
      return res.status(200).json({ received: true, ignored: 'sem idTransaction' });
    }

    // Mesma entrega reenviada: ignora
    const deliveryId = req.headers['x-lofypay-id'];
    if (deliveryId && !(await store.once('lofy:delivery:' + deliveryId))) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    const work = (async () => {
      const status = await consultarStatus(identifier);
      if (!isPaid(status)) return { paid: false, status };

      await store.save('paid:' + identifier, '1', 7 * 24 * 60 * 60);
      const track = open(await store.load('track:' + identifier));
      if (!track) console.warn(`[LOFYPAY WEBHOOK] Pedido ${identifier} sem dados de rastreamento (ative o Upstash Redis).`);

      const t = track || {};
      const [sale] = await Promise.all([
        registerSale({ identifier, track, source: 'webhook' }),
        t.e ? store.once('email:' + identifier).then(first => (first ? sendAccessEmail({ identifier, name: t.n, email: t.e }) : null)) : null
      ]);
      return { paid: true, meta: !!(sale.meta && sale.meta.success), utmify: !!(sale.utmify && sale.utmify.success) };
    })().catch(async err => {
      console.error('[LOFYPAY WEBHOOK PROCESSING ERROR]:', err.message, err.requestId ? `x-request-id=${err.requestId}` : '');
      if (deliveryId) await store.remove('lofy:delivery:' + deliveryId);   // deixa a LofyPay reenviar
      return { error: true };
    });

    const outcome = await withTimeout(work, 6500);

    // Falhou ao confirmar: responde erro para a LofyPay reenviar mais tarde
    if (outcome && outcome.error) {
      return res.status(503).json({ received: false, retry: true });
    }

    return res.status(200).json({
      received: true,
      outcome,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[LOFYPAY WEBHOOK ERROR]:', error.message);
    return res.status(500).json({ received: false, error: 'erro interno' });
  }
};
