// Registra uma venda confirmada no Meta (API de Conversões) e na UTMify.
// Chamado por dois caminhos que podem acontecer juntos (cada envio acontece uma única vez):
//  - api/check-pix.js (o checkout aberto confere o status a cada 3 s);
//  - api/webhook.js (a BravoPay avisa o pagamento, mesmo que o cliente feche a página).
// O primeiro caminho que detectar o pagamento envia; o outro é ignorado.
const { PRODUCT } = require('./_product');
const { sendMetaPurchaseEvent } = require('./_meta-capi');
const { sendUtmifyOrder, utmifyDate, pickUtms } = require('./_track');
const store = require('./_store');

// "pago" vai para a UTMify uma única vez por Pix (mesma lógica da Compra no Meta)
const utmifySent = new Set();
async function sendUtmifyPaidOnce(identifier, t) {
  const key = 'utmify:paid:' + identifier;
  if (utmifySent.has(key)) return { success: true, deduplicated: true };
  utmifySent.add(key);
  if (!(await store.once(key))) return { success: true, deduplicated: true };
  const r = await sendUtmifyOrder({ orderId: identifier, status: 'paid', track: t, approvedDate: utmifyDate(Date.now()) });
  if (!r.success) { utmifySent.delete(key); await store.remove(key); } // libera nova tentativa
  return r;
}

async function registerSale({ identifier, track, req = null, source }) {
  const t = track || {};
  const [meta, utmify] = await Promise.all([
    sendMetaPurchaseEvent({
      eventId: identifier,
      value: PRODUCT.amount,
      user: { name: t.n, email: t.e, phone: t.p, cpf: t.d },
      req,
      context: { ip: t.ip, ua: t.ua, fbp: t.fbp, fbc: t.fbc },
      eventSourceUrl: (process.env.SITE_URL || '').replace(/\/$/, '') + '/checkout.html',
      customData: { source, ...pickUtms(t.u) }
    }),
    sendUtmifyPaidOnce(identifier, t)
  ]);
  return { meta, utmify };
}

module.exports = { registerSale };
