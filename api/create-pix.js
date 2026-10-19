const { createCashIn } = require('./_sync-client');
const { PRODUCT, setCorsHeaders, parseBody } = require('./_product');

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido. Utilize POST.' });
  }

  try {
    const body = parseBody(req);
    if (!body) {
      return res.status(400).json({ success: false, message: 'JSON inválido no corpo da requisição.' });
    }

    const { name, email, cpf, phone } = body;

    // Validações básicas
    if (!name || name.trim().length < 3) {
      return res.status(422).json({
        success: false,
        message: 'Por favor, informe seu nome completo.'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email.trim())) {
      return res.status(422).json({
        success: false,
        message: 'Por favor, informe um endereço de e-mail válido.'
      });
    }

    const cleanCpf = String(cpf || '').replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
      return res.status(422).json({
        success: false,
        message: 'CPF deve conter exatamente 11 dígitos numéricos.'
      });
    }

    const cleanPhone = String(phone || '').replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 11) {
      return res.status(422).json({
        success: false,
        message: 'Telefone deve conter DDD + número (10 ou 11 dígitos).'
      });
    }

    // A Sync Pay avisa o pagamento nesta rota (api/webhook.js)
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const webhookUrl = process.env.SITE_URL
      ? `${process.env.SITE_URL.replace(/\/$/, '')}/api/webhook`
      : (host ? `https://${host}/api/webhook` : undefined);

    const result = await createCashIn({
      amount: PRODUCT.amount,
      description: PRODUCT.name,
      webhook_url: webhookUrl,
      client: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        cpf: cleanCpf,
        phone: cleanPhone
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Cobrança Pix gerada com sucesso!',
      pix_code: result.pix_code,
      identifier: result.identifier,
      amount: PRODUCT.amount
    });
  } catch (error) {
    console.error('Erro ao gerar Pix:', error, error.details || '');

    return res.status(error.status && error.status < 600 ? error.status : 500).json({
      success: false,
      message: error.message || 'Erro ao processar cobrança via Pix.'
    });
  }
};
