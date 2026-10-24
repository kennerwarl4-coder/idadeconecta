// Cria a cobrança Pix na BravoPay e devolve ao navegador só o necessário
// (copia e cola, identificador, valor e validade). A chave nunca sai do servidor.
const crypto = require('crypto');
const { criarCobrancaPix } = require('./_bravopay');
const { PRODUCT, BRAVOPAY_PRODUCT_ID, setCorsHeaders, parseBody, withTimeout } = require('./_product');
const { seal, pickAdParams, toBravoUtm, utmifyDate, requestContext, sendUtmifyOrder } = require('./_track');
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

    // UTMs e ids de clique guardados pelo navegador desde o anúncio
    const adParams = pickAdParams(utms || {});

    const pix = await criarCobrancaPix({
      amountCents: PRODUCT.amountCents,
      customer: { name: client.name, email: client.email, phone: '55' + client.phone, cpf: client.cpf },
      externalReference: 'IC-' + crypto.randomUUID(),
      utm: toBravoUtm(adParams),
      productId: BRAVOPAY_PRODUCT_ID || undefined
    });

    // Pacote criptografado com o que a BravoPay não guarda (IP, navegador, cookies do Meta).
    // createdAt = data da transação na BravoPay, a mesma que o webhook vai ler depois.
    const ctx = requestContext(req);
    const track = {
      n: client.name, e: client.email, p: client.phone, d: client.cpf,
      ip: ctx.ip, ua: ctx.ua, fbp: ctx.fbp, fbc: ctx.fbc,
      u: adParams,
      c: utmifyDate(pix.createdAt)
    };
    const trackToken = seal(track);

    // Guarda o pacote para o webhook e, se a UTMify própria estiver ligada, avisa "aguardando pagamento"
    await withTimeout(Promise.all([
      store.save('track:' + pix.id, trackToken),
      sendUtmifyOrder({ orderId: pix.id, status: 'waiting_payment', track })
    ]), 2500);

    const expiresIn = pix.expiresAt
      ? Math.max(60, Math.floor((new Date(pix.expiresAt).getTime() - Date.now()) / 1000))
      : 60 * 60;

    return res.status(200).json({
      success: true,
      message: 'Cobrança Pix gerada com sucesso!',
      pix_code: pix.copyPaste,
      identifier: pix.id,
      amount: PRODUCT.amount,
      expires_in: expiresIn,
      track: trackToken
    });
  } catch (error) {
    console.error('Erro ao gerar Pix:', error.message, error.details || '', error.requestId ? `x-request-id=${error.requestId}` : '');

    return res.status(error.status && error.status < 600 ? error.status : 500).json({
      success: false,
      message: error.message || 'Erro ao processar cobrança via Pix.'
    });
  }
};
