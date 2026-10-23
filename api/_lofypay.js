// Cliente da LofyPay (gateway Pix). Documentação: https://docs.lofypay.com
// A chave secreta só existe aqui, no servidor, em LOFYPAY_SECRET_KEY.
// sk_live_ = produção · sk_test_ = sandbox (a URL é a mesma; o prefixo decide).
const crypto = require('crypto');

const BASE_URL = 'https://app.lofypay.com/api/v1';

function secretKey() {
  const key = process.env.LOFYPAY_SECRET_KEY;
  if (!key) {
    const error = new Error('Pagamento indisponível no momento. Tente novamente em instantes.');
    error.status = 500;
    error.details = 'LOFYPAY_SECRET_KEY não configurada no servidor.';
    throw error;
  }
  return key;
}

// Mensagens da LofyPay traduzidas para algo que o cliente entende
const FRIENDLY = {
  deposit_below_minimum: 'O valor está abaixo do mínimo aceito pelo Pix agora. Fale com o suporte.',
  missing_key: 'Pagamento indisponível no momento. Tente novamente em instantes.',
  invalid_format: 'Pagamento indisponível no momento. Tente novamente em instantes.',
  key_not_found: 'Pagamento indisponível no momento. Tente novamente em instantes.',
  key_revoked: 'Pagamento indisponível no momento. Tente novamente em instantes.',
  public_key_used: 'Pagamento indisponível no momento. Tente novamente em instantes.'
};

async function call(path, body, { idempotencyKey } = {}) {
  const headers = {
    'Authorization': `Bearer ${secretKey()}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const response = await fetch(BASE_URL + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const requestId = response.headers.get('x-request-id') || '-';
  const data = await response.json().catch(() => null);

  if (!response.ok || (data && String(data.status).toLowerCase() === 'error')) {
    const code = data?.code || data?.error || null;
    const apiMsg = data?.message || `Erro na LofyPay (HTTP ${response.status})`;
    // Nunca registra a chave; só o status, o código e o x-request-id (para o suporte da LofyPay)
    console.error(`[LOFYPAY ERROR] ${path} http=${response.status} code=${code} x-request-id=${requestId} msg=${apiMsg}`);
    const error = new Error(
      (code && FRIENDLY[code]) ||
      (response.status === 429 ? 'Muitas tentativas em pouco tempo. Aguarde alguns segundos e tente de novo.' :
       response.status >= 500 ? 'O banco não conseguiu gerar o Pix agora. Nada foi cobrado; tente de novo.' :
       response.status === 401 || response.status === 403 ? 'Pagamento indisponível no momento. Tente novamente em instantes.' :
       apiMsg)
    );
    error.status = response.status >= 400 ? response.status : 502;
    error.code = code;
    error.retryAfter = Number(response.headers.get('retry-after')) || null;
    error.requestId = requestId;
    throw error;
  }

  return { data: data || {}, requestId };
}

/**
 * Cria a cobrança Pix.
 * @param {Object} p
 * @param {number} p.amount - em REAIS (ex.: 19.9)
 * @param {string} p.externalReference - id do pedido no nosso sistema (volta no webhook)
 * @param {Object} p.client - { name, document (só dígitos), email }
 * @param {string} [p.notificationUrl]
 * @param {number} [p.expiration] - segundos (60 a 86400)
 * @returns {Promise<{ idTransaction: string, paymentCode: string, paymentCodeBase64: string|null }>}
 */
async function criarCobrancaPix({ amount, externalReference, client, notificationUrl, expiration }) {
  const body = {
    amount: Number(Number(amount).toFixed(2)),
    method: 'pix',
    external_reference: externalReference,
    client: { name: client.name, document: client.document, email: client.email }
  };
  if (notificationUrl) body.notification_url = notificationUrl;
  if (expiration) body.expiration = expiration;

  const { data, requestId } = await call('/gateway', body, { idempotencyKey: externalReference });

  // HTTP 200 não garante sucesso: precisa de status "success" (ou "OK" no sandbox) e do idTransaction
  const st = String(data.status || '').toLowerCase();
  if (!(st === 'success' || st === 'ok') || !data.idTransaction || !data.paymentCode) {
    console.error(`[LOFYPAY ERROR] /gateway resposta inesperada x-request-id=${requestId} status=${data.status}`);
    const error = new Error(data.message || 'Não conseguimos gerar o Pix agora. Tente de novo em instantes.');
    error.status = 502;
    throw error;
  }

  console.log(`[LOFYPAY] Pix criado ${data.idTransaction} ref=${externalReference} x-request-id=${requestId}`);
  return {
    idTransaction: String(data.idTransaction),
    paymentCode: data.paymentCode,
    paymentCodeBase64: data.paymentCodeBase64 || null
  };
}

/**
 * Consulta o status (fonte da verdade). Só PAID_OUT é pago.
 * @returns {Promise<'WAITING_FOR_APPROVAL'|'PAID_OUT'|'EXPIRED'|'REFUNDED'|'FAILED'|string>}
 */
async function consultarStatus(idTransaction) {
  const { data } = await call('/status', { idtransaction: idTransaction });
  return String(data.status || '').toUpperCase();
}

/**
 * Valida a assinatura de um webhook do canal assinado (cadastrado no painel).
 * Usa o corpo CRU e o secret do endpoint (LOFYPAY_WEBHOOK_SECRET, não a sk_).
 * @returns {boolean|null} true/false, ou null se não houver assinatura/secret para validar
 */
function verificarWebhook(rawBody, headers) {
  const secret = process.env.LOFYPAY_WEBHOOK_SECRET;
  const sig = headers['x-lofypay-signature'];
  if (!secret || !sig || typeof rawBody !== 'string') return null;

  const parts = Object.fromEntries(String(sig).split(',').map(p => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;

  const expected = crypto.createHmac('sha256', secret).update(parts.t + '.' + rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { criarCobrancaPix, consultarStatus, verificarWebhook };
