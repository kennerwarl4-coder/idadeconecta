// Cliente da BravoPay (gateway Pix). Base: https://bravopay.club/api/v1
// A chave (bp_live_...) só existe aqui, no servidor, em BRAVOPAY_API_KEY.
// Nunca vai para o navegador, para o GitHub ou para os logs.

const BASE_URL = 'https://bravopay.club/api/v1';

function apiKey() {
  const key = process.env.BRAVOPAY_API_KEY;
  if (!key) {
    const error = new Error('Pagamento indisponível no momento. Tente novamente em instantes.');
    error.status = 500;
    error.details = 'BRAVOPAY_API_KEY não configurada no servidor.';
    throw error;
  }
  return key;
}

async function call(method, path, body) {
  const headers = { 'Authorization': `Bearer ${apiKey()}`, 'Accept': 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';

  const response = await fetch(BASE_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const requestId = response.headers.get('x-request-id') || '-';
  const data = await response.json().catch(() => null);

  if (!response.ok || !data || data.error) {
    const apiMsg = (data && (data.error?.message || data.message || (typeof data.error === 'string' ? data.error : null))) || `HTTP ${response.status}`;
    // Registra só o necessário para o suporte (nunca a chave nem dados do cliente)
    console.error(`[BRAVOPAY ERROR] ${method} ${path.split('/').slice(0, 2).join('/')} http=${response.status} x-request-id=${requestId} msg=${apiMsg}`);
    const error = new Error(
      response.status === 429 ? 'Muitas tentativas em pouco tempo. Aguarde alguns segundos e tente de novo.' :
      response.status === 401 || response.status === 403 ? 'Pagamento indisponível no momento. Tente novamente em instantes.' :
      response.status >= 500 ? 'O banco não conseguiu gerar o Pix agora. Nada foi cobrado; tente de novo.' :
      apiMsg
    );
    error.status = response.status >= 400 ? response.status : 502;
    error.retryAfter = Number(response.headers.get('retry-after')) || null;
    error.requestId = requestId;
    throw error;
  }

  return { data, requestId };
}

/**
 * Cria a cobrança Pix.
 * @param {Object} p
 * @param {number} p.amountCents - valor em CENTAVOS (ex.: 3700 = R$ 37,00)
 * @param {Object} p.customer - { name, email, phone (55 + DDD + número), cpf (só dígitos) }
 * @param {string} p.externalReference - id do pedido no nosso sistema
 * @param {Object} [p.utm] - { source, medium, campaign, content, term, fbclid, ttclid, gclid }
 * @param {string} [p.productId] - produto real da BravoPay (necessário para a UTMify nativa da BravoPay)
 */
async function criarCobrancaPix({ amountCents, customer, externalReference, utm, productId }) {
  const body = {
    amount_cents: amountCents,
    method: 'pix',
    customer,
    external_reference: externalReference
  };
  if (utm) body.utm = utm;
  if (productId) body.product_id = productId;

  const { data, requestId } = await call('POST', '/transactions', body);

  const copyPaste = data.pix && data.pix.copy_paste;
  if (!data.id || !copyPaste) {
    console.error(`[BRAVOPAY ERROR] POST /transactions sem id ou copia e cola x-request-id=${requestId} status=${data.status}`);
    const error = new Error('Não conseguimos gerar o Pix agora. Tente de novo em instantes.');
    error.status = 502;
    throw error;
  }

  console.log(`[BRAVOPAY] Pix criado ${data.id} ref=${externalReference} x-request-id=${requestId}`);
  return {
    id: String(data.id),
    copyPaste,
    expiresAt: data.pix.expires_at || null,
    createdAt: data.created_at || new Date().toISOString()
  };
}

/**
 * Consulta a transação (fonte da verdade). Traz status, cliente, UTMs e datas.
 * Status: PENDING, PAID, EXPIRED, REFUNDED, FAILED, CANCELED (só PAID é pago).
 */
async function consultarTransacao(id) {
  const { data } = await call('GET', '/transactions/' + encodeURIComponent(id));
  return data;
}

module.exports = { criarCobrancaPix, consultarTransacao };
