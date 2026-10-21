// Registra uma venda confirmada no Meta (API de Conversões) e na UTMify.
// Chamado por dois caminhos que podem acontecer juntos:
//  - api/check-pix.js (o checkout aberto confere o status a cada 4 s);
//  - api/webhook.js (a Sync Pay avisa o pagamento, mesmo que o cliente feche a página).
// Os dois enviam os mesmos dados: o Meta descarta a duplicata pelo event_id e a
// UTMify só atualiza o mesmo pedido (mesmo orderId e createdAt).
const { PRODUCT } = require('./_product');
const { sendMetaPurchaseEvent } = require('./_meta-capi');
const { sendUtmifyOrder, utmifyDate, pickUtms } = require('./_track');

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
    sendUtmifyOrder({
      orderId: identifier,
      status: 'paid',
      track: t,
      approvedDate: utmifyDate(Date.now())
    })
  ]);
  return { meta, utmify };
}

module.exports = { registerSale };
