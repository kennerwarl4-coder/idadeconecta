// Armazenamento simples via Upstash Redis (REST), usado para o webhook encontrar
// os dados do pedido quando o cliente paga e fecha a página.
// Na Vercel: Storage > Marketplace > Upstash for Redis > Connect. As variáveis
// KV_REST_API_URL e KV_REST_API_TOKEN (ou UPSTASH_REDIS_REST_*) são criadas sozinhas.
// Sem elas, tudo continua funcionando pelo checkout; só o webhook fica com menos dados.

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function command(args) {
  const c = config();
  if (!c) return { skipped: true };
  try {
    const response = await fetch(c.url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      console.error('[STORE ERROR]:', response.status, data);
      return { error: true };
    }
    return data || {};
  } catch (err) {
    console.error('[STORE NETWORK ERROR]:', err.message);
    return { error: true };
  }
}

const DAY = 24 * 60 * 60;

/** Guarda um valor (já criptografado) por `ttl` segundos */
async function save(key, value, ttl = 2 * DAY) {
  return command(['SET', key, value, 'EX', ttl]);
}

async function load(key) {
  const r = await command(['GET', key]);
  return r && typeof r.result === 'string' ? r.result : null;
}

/** true se esta é a primeira vez que a chave é marcada (para não repetir envios) */
async function once(key, ttl = 7 * DAY) {
  const r = await command(['SET', key, '1', 'NX', 'EX', ttl]);
  if (r.skipped || r.error) return true; // sem armazenamento: deixa enviar
  return r.result === 'OK';
}

module.exports = { save, load, once, isConfigured: () => !!config() };
