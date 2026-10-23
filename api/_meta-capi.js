const crypto = require('crypto');
const { PRODUCT } = require('./_product');
const store = require('./_store');

// Credenciais do Meta vêm das variáveis de ambiente. Nunca escreva o token aqui.
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
// Opcional: código da aba "Testar eventos" do Gerenciador de Eventos (ex.: TEST12112).
// Com ele, as compras aparecem lá; apague depois do teste.
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE;

// A Compra é enviada só pelo servidor, e uma única vez por Pix:
//  - na mesma instância: marca antes de enviar (cobre o checkout e o webhook chegando juntos);
//  - entre instâncias: trava no Redis, quando configurado.
const sentEventsCache = new Set();

/**
 * Standard SHA-256 hash for Meta Conversions API
 */
function sha256(val) {
  if (!val || typeof val !== 'string') return null;
  const clean = val.trim().toLowerCase();
  if (!clean) return null;
  return crypto.createHash('sha256').update(clean).digest('hex');
}

/**
 * Normalize phone for Meta (E.164 without '+' sign, standard 55 for Brazil)
 */
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('55') && digits.length >= 12) {
    return digits;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

/**
 * Parse cookies from request header
 */
function parseCookies(req) {
  const cookieHeader = req?.headers?.cookie || '';
  const cookies = {};
  cookieHeader.split(';').forEach(part => {
    const [k, v] = part.split('=');
    if (k && v) cookies[k.trim()] = decodeURIComponent(v.trim());
  });
  return cookies;
}

/**
 * Sends a Purchase event to Meta Conversions API (CAPI)
 * @param {Object} options
 * @param {string} options.eventId - Transaction identifier for deduplication
 * @param {number} [options.value]
 * @param {string} [options.currency='BRL']
 * @param {Object} options.user - { name, email, phone, cpf }
 * @param {Object} [options.req] - Incoming HTTP request for IP and User-Agent
 * @param {string} [options.eventSourceUrl]
 * @param {Object} [options.customData]
 * @param {Object} [options.context] - { ip, ua, fbp, fbc } guardados quando o Pix foi gerado
 */
async function sendMetaPurchaseEvent({
  eventId,
  value = PRODUCT.amount,
  currency = PRODUCT.currency,
  user = {},
  req = null,
  eventSourceUrl = null,
  customData = {},
  context = {}
}) {
  if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
    console.warn('[META CAPI] META_PIXEL_ID ou META_ACCESS_TOKEN não configurados. Evento ignorado.');
    return { success: false, skipped: true };
  }

  const dedupKey = `purchase_${eventId || user.email || Date.now()}`;
  if (sentEventsCache.has(dedupKey)) {
    console.log(`[META CAPI] Evento de compra ${dedupKey} já transmitido previamente. Ignorando duplicata.`);
    return { success: true, deduplicated: true };
  }
  sentEventsCache.add(dedupKey);
  if (!(await store.once('meta:' + dedupKey))) {
    console.log(`[META CAPI] Evento de compra ${dedupKey} já enviado por outro caminho. Ignorando duplicata.`);
    return { success: true, deduplicated: true };
  }
  // Se o envio falhar, libera para a próxima tentativa (checkout ou webhook)
  const release = () => { sentEventsCache.delete(dedupKey); return store.remove('meta:' + dedupKey); };

  // Extract client IP & User Agent
  let clientIp = null;
  let clientUa = null;
  let fbc = null;
  let fbp = null;

  if (req) {
    const forwarded = req.headers['x-forwarded-for'];
    clientIp = forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress;
    clientUa = req.headers['user-agent'];
    const cookies = parseCookies(req);
    fbc = cookies['_fbc'] || null;
    fbp = cookies['_fbp'] || null;
  }

  // O webhook é chamado pela LofyPay, não pelo navegador do cliente:
  // nesse caso usamos o IP, navegador e cookies guardados quando o Pix foi gerado.
  if (context.ip) clientIp = context.ip;
  if (context.ua) clientUa = context.ua;
  fbp = fbp || context.fbp || null;
  fbc = fbc || context.fbc || null;

  // Name splitting
  const rawName = (user.name || '').trim();
  const nameParts = rawName ? rawName.split(' ') : [];
  const firstName = nameParts[0] || '';
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

  const userData = {};

  const hashedEmail = sha256(user.email);
  if (hashedEmail) userData.em = [hashedEmail];

  const normPhone = normalizePhone(user.phone);
  const hashedPhone = sha256(normPhone);
  if (hashedPhone) userData.ph = [hashedPhone];

  const hashedFn = sha256(firstName);
  if (hashedFn) userData.fn = [hashedFn];

  const hashedLn = sha256(lastName);
  if (hashedLn) userData.ln = [hashedLn];

  const hashedCpf = sha256(String(user.cpf || '').replace(/\D/g, ''));
  if (hashedCpf) userData.external_id = [hashedCpf];

  if (clientIp) userData.client_ip_address = clientIp;
  if (clientUa) userData.client_user_agent = clientUa;
  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;

  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');

  const eventPayload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: String(eventId || Date.now()),
        event_source_url: eventSourceUrl || (siteUrl ? `${siteUrl}/checkout.html` : undefined),
        action_source: 'website',
        user_data: userData,
        custom_data: {
          value: parseFloat(value),
          currency,
          content_name: PRODUCT.name,
          content_type: 'product',
          order_id: String(eventId || ''),
          ...customData
        }
      }
    ]
  };
  if (META_TEST_EVENT_CODE) eventPayload.test_event_code = META_TEST_EVENT_CODE;

  try {
    const url = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(eventPayload)
    });

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      console.error('[META CAPI ERROR]:', response.status, result);
      await release();
      return { success: false, status: response.status, error: result };
    }

    console.log(`[META CAPI SUCCESS] Purchase registrado com sucesso para id: ${eventId}. fbtrace_id: ${result?.fbtrace_id}`);
    return { success: true, result };

  } catch (err) {
    console.error('[META CAPI NETWORK ERROR]:', err.message);
    await release();
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendMetaPurchaseEvent
};
