// Entrega do produto por e-mail, usando a Resend (https://resend.com).
// Só funciona com RESEND_API_KEY, EMAIL_FROM e PRODUCT_ACCESS_URL configurados.
const { PRODUCT } = require('./_product');

const sentEmails = new Set();

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendAccessEmail({ identifier, name, email }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const accessUrl = process.env.PRODUCT_ACCESS_URL;

  if (!apiKey || !from || !accessUrl) {
    console.warn('[ENTREGA] RESEND_API_KEY, EMAIL_FROM ou PRODUCT_ACCESS_URL não configurados. E-mail não enviado.');
    return { success: false, skipped: true };
  }
  if (!email) return { success: false, error: 'Transação sem e-mail do cliente.' };

  const key = identifier || email;
  if (sentEmails.has(key)) return { success: true, deduplicated: true };

  const firstName = escapeHtml(String(name || '').trim().split(' ')[0] || 'tudo bem');
  const url = escapeHtml(accessUrl);
  const support = escapeHtml(process.env.SUPPORT_EMAIL || '');

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2B1D14;font-size:18px;line-height:1.55">
    <h1 style="font-size:26px;margin:0 0 12px">Olá, ${firstName}! Seu acesso chegou 🎉</h1>
    <p>Seu pagamento do <b>${escapeHtml(PRODUCT.name)}</b> foi confirmado.</p>
    <p>Toque no botão abaixo para baixar os 120 cartões e os 3 bônus. É só imprimir e deixar ao lado do celular.</p>
    <p style="margin:28px 0">
      <a href="${url}" style="background:#1A7F3C;color:#fff;text-decoration:none;font-weight:bold;padding:16px 26px;border-radius:12px;display:inline-block">BAIXAR MEUS CARTÕES</a>
    </p>
    <p style="font-size:15px;color:#5A4232">Se o botão não abrir, copie este endereço: <br>${url}</p>
    ${support ? `<p style="font-size:15px;color:#5A4232">Dúvidas? Responda este e-mail ou escreva para ${support}.</p>` : ''}
    <p style="font-size:15px;color:#5A4232">Garantia de 7 dias: se não gostar, devolvemos 100% do seu dinheiro.</p>
  </div>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: [email],
        reply_to: process.env.SUPPORT_EMAIL || undefined,
        subject: 'Seu acesso ao Idade Conecta chegou',
        html
      })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      console.error('[ENTREGA] Falha ao enviar e-mail:', response.status, result);
      return { success: false, error: result };
    }
    sentEmails.add(key);
    console.log(`[ENTREGA] E-mail de acesso enviado para a transação ${identifier}.`);
    return { success: true };
  } catch (err) {
    console.error('[ENTREGA] Erro de rede ao enviar e-mail:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendAccessEmail };
