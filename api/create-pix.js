const { createCashIn } = require('./_sync-client');
const { PRODUCT, setCorsHeaders, parseBody, withTimeout } = require('./_product');
const { seal, pickUtms, utmifyDate, requestContext, sendUtmifyOrder } = require('./_track');
const store = require('./_store');

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

    const { name, email, cpf, phone, utms } = body;

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

    const client = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      cpf: cleanCpf,
      phone: cleanPhone
    };

    // Pacote criptografado com tudo que a venda precisa quando o pagamento for confirmado
    const ctx = requestContext(req);
    const track = {
      n: client.name, e: client.email, p: client.phone, d: client.cpf,
      ip: ctx.ip, ua: ctx.ua, fbp: ctx.fbp, fbc: ctx.fbc,
      u: pickUtms(utms || {}),
      c: utmifyDate(Date.now())
    };
    const trackToken = seal(track);

    // A Sync Pay avisa o pagamento nesta URL (limite dela: 255 caracteres)
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const base = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, '') : (host ? `https://${host}` : '');
    const webhookUrl = base ? `${base}/api/webhook` : undefined;

    const result = await createCashIn({
      amount: PRODUCT.amount,
      description: PRODUCT.name,
      webhook_url: webhookUrl,
      client
    });

    // Guarda o pacote para o webhook (caso o cliente pague e feche a página) e
    // registra o pedido como "aguardando pagamento" na UTMify
    await withTimeout(Promise.all([
      store.save('track:' + result.identifier, trackToken),
      sendUtmifyOrder({ orderId: result.identifier, status: 'waiting_payment', track })
    ]), 2500);

    return res.status(200).json({
      success: true,
      message: 'Cobrança Pix gerada com sucesso!',
      pix_code: result.pix_code,
      identifier: result.identifier,
      amount: PRODUCT.amount,
      track: trackToken
    });
  } catch (error) {
    console.error('Erro ao gerar Pix:', error, error.details || '');

    return res.status(error.status && error.status < 600 ? error.status : 500).json({
      success: false,
      message: error.message || 'Erro ao processar cobrança via Pix.'
    });
  }
};
