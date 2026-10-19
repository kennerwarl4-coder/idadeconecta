// Shared Sync Pay API Client with token caching
const { PRODUCT } = require('./_product');

const SYNC_BASE_URL = 'https://api.syncpayments.com.br';

// Credenciais vêm das variáveis de ambiente (Vercel > Settings > Environment Variables).
// Nunca escreva as chaves aqui: este arquivo vai para o GitHub.
const CLIENT_ID = process.env.SYNC_CLIENT_ID;
const CLIENT_SECRET = process.env.SYNC_CLIENT_SECRET;

// In-memory token cache to prevent excessive token generation
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Obtains a valid Bearer token for Sync Pay API.
 * Uses cached token if still valid (tokens last 1 hour).
 */
async function getAuthToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    const error = new Error('Pagamento indisponível no momento. Tente novamente em instantes.');
    error.status = 500;
    error.details = 'SYNC_CLIENT_ID e SYNC_CLIENT_SECRET não configurados no servidor.';
    throw error;
  }

  const now = Date.now();
  // If token is valid and has at least 3 minutes left, reuse it
  if (cachedToken && tokenExpiresAt > now + 180000) {
    return cachedToken;
  }

  const response = await fetch(`${SYNC_BASE_URL}/api/partner/v1/auth-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.access_token) {
    const errorMsg = data?.message || `Falha na autenticação Sync Pay (Status ${response.status})`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  cachedToken = data.access_token;
  // Token expires_in is usually 3600 seconds
  const ttlMs = (data.expires_in || 3600) * 1000;
  tokenExpiresAt = now + ttlMs;

  return cachedToken;
}

/**
 * Creates a Cash-In Pix transaction.
 * @param {Object} params
 * @param {number} params.amount
 * @param {string} params.description
 * @param {Object} params.client { name, cpf, email, phone }
 * @param {string} [params.webhook_url]
 */
async function createCashIn({ amount, description, client, webhook_url }) {
  const token = await getAuthToken();

  const bodyPayload = {
    amount: Number(amount),
    description: description || PRODUCT.name,
    client: {
      name: client.name,
      cpf: String(client.cpf).replace(/\D/g, ''),
      email: client.email.trim().toLowerCase(),
      phone: String(client.phone).replace(/\D/g, '')
    }
  };

  if (webhook_url) {
    bodyPayload.webhook_url = webhook_url;
  }

  const response = await fetch(`${SYNC_BASE_URL}/api/partner/v1/cash-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(bodyPayload)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg = data?.message || `Erro ao gerar Pix no Sync Pay (Status ${response.status})`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

/**
 * Consults transaction status by identifier.
 * @param {string} identifier
 */
async function getTransaction(identifier) {
  const token = await getAuthToken();

  const response = await fetch(`${SYNC_BASE_URL}/api/partner/v1/transaction/${encodeURIComponent(identifier)}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg = data?.message || `Erro ao consultar transação (Status ${response.status})`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

module.exports = {
  getAuthToken,
  createCashIn,
  getTransaction
};
