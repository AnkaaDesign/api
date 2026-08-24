// api/src/templates/signature-whatsapp.ts
//
// Mensagens da cerimônia de assinatura do orçamento quando o canal é WhatsApp.
// Espelham `signature-emails.ts` em conteúdo e obrigações, não em formato.
//
// DIFERENÇAS QUE IMPORTAM EM RELAÇÃO AO E-MAIL
//   1. Texto puro. Sem assunto, sem HTML, sem preheader — o transporte
//      (`BaileysWhatsAppService.sendMessage`) recebe uma string só.
//   2. Sem botão. O link vai cru, porque é ele que o cliente toca.
//   3. Curto. O e-mail pode explicar a cerimônia inteira; aqui, um bloco longo
//      é lido como spam e aumenta a chance de denúncia — que é exatamente o que
//      derrubou o número anterior.
//   4. O aviso anti-golpe NÃO pode mais dizer "a Ankaa nunca manda código por
//      WhatsApp", que era o texto do e-mail: agora manda. A promessa honesta é
//      outra — a Ankaa nunca PEDE o código de volta.
//
// Formatação: o WhatsApp interpreta *negrito* com asteriscos simples. Não usar
// markdown de e-mail (`**`), que aparece literal na conversa.

import { COMPANY } from '../config/company';

export interface SignatureWhatsAppBase {
  signerName: string;
  /** `string | number` como no par de e-mail: `TaskQuote.budgetNumber` é Int. */
  budgetNumber: string | number;
}

/** Só o primeiro nome: a mensagem fica pessoal sem virar um bloco de texto. */
function firstName(fullName: string): string {
  return (fullName ?? '').trim().split(/\s+/)[0] || 'tudo bem';
}

export interface WhatsAppInvitationData extends SignatureWhatsAppBase {
  signingUrl: string;
  deadlineDate: string;
  totalFormatted?: string | null;
  isResend?: boolean;
}

export function generateSignatureInvitationWhatsApp(data: WhatsAppInvitationData): string {
  const opening = data.isResend
    ? `Reenviando o link de assinatura do orçamento nº *${data.budgetNumber}*.`
    : `O orçamento nº *${data.budgetNumber}*${
        data.totalFormatted ? `, no valor total de *${data.totalFormatted}*,` : ''
      } está pronto para sua revisão e assinatura eletrônica.`;

  return [
    `Olá, ${firstName(data.signerName)}! Aqui é a ${COMPANY.name}.`,
    '',
    opening,
    '',
    'No link abaixo você lê o documento na íntegra, confere os valores e assina pelo celular. Não precisa imprimir nem instalar nada.',
    '',
    data.signingUrl,
    '',
    `Este link é *pessoal* — ele registra quem acessou o documento e vale até *${data.deadlineDate}*. Por favor, não encaminhe.`,
    '',
    // "confirma seus dados", e não "informa CPF e cargo".
    //
    // O cargo vem do CADASTRO (`Responsible.roles`) e a cerimônia só o PERGUNTA
    // quando não há nenhum em ficha — que é a minoria. O CPF idem: quando já
    // está cadastrado, o signatário completa só os dígitos que a máscara
    // esconde. Prometer que ele vai "informar CPF e cargo" descreve um
    // formulário que a maioria não vê, e a primeira coisa que a pessoa faz ao
    // abrir o link é procurar o campo que a mensagem citou.
    'Como funciona: você lê o orçamento, confirma seus dados, recebe um código de uso único aqui mesmo neste WhatsApp, digita o código e conclui.',
  ].join('\n');
}

export interface WhatsAppOtpData extends SignatureWhatsAppBase {
  code: string;
  expiryMinutes: number;
}

/**
 * O código vem nas PRIMEIRAS linhas de propósito.
 *
 * A prévia da notificação no celular corta a mensagem, e é dela que a pessoa lê
 * o código sem abrir a conversa. É o inverso da regra do e-mail — lá o código
 * fica fora do assunto e do preheader justamente para não vazar na prévia —, e a
 * diferença é o modelo de ameaça: a prévia do e-mail chega em telas
 * compartilhadas e em logs de servidor de terceiros; a do WhatsApp chega no
 * aparelho que a posse do número já pressupõe.
 */
export function generateSignatureOtpWhatsApp(data: WhatsAppOtpData): string {
  return [
    `*${data.code}* é o seu código de assinatura.`,
    '',
    `Use-o para concluir a assinatura eletrônica do orçamento nº *${data.budgetNumber}*.`,
    `Expira em *${data.expiryMinutes} minutos* e só pode ser usado uma vez.`,
    '',
    `*Nunca repasse este código a ninguém.* Nenhum atendente da ${COMPANY.name} vai pedir que você envie ou dite este código — nem por telefone, nem por aqui. Se alguém pedir, é golpe.`,
    '',
    'Se você não solicitou este código, ignore esta mensagem: ele perde a validade sozinho e nenhuma assinatura será registrada.',
  ].join('\n');
}

export interface WhatsAppVoidedData extends SignatureWhatsAppBase {
  reason: string;
  hadSigned: boolean;
  /**
   * Linhas JÁ FORMATADAS, uma por alteração.
   *
   * Antes isto era `{label, subject, before, after}` e o template montava
   * `label: before → after` na mão. Duas coisas quebravam nisso, e as duas
   * saíram para o cliente no orçamento nº 945:
   *
   *   1. Uma INCLUSÃO não tem "antes". `before` chegava nulo e o template
   *      imprimia a palavra `null`: "Serviço incluído: null → R$ 0,02".
   *   2. O `subject` — o nome do serviço — era ignorado. As quatro linhas de
   *      quatro serviços diferentes saíam idênticas.
   *
   * Quem formata agora é `describeQuoteChange`, o mesmo formatador que escreve
   * o motivo gravado no envelope e a linha do log ("Serviço incluído
   * \"Aerografia Laterais\" (R$ 0,02)"). Um formatador só, e não três.
   */
  changes: string[];
}

/**
 * Aviso de que a coleta caiu porque o orçamento mudou materialmente.
 *
 * A lista de mudanças vai TRUNCADA, ao contrário do e-mail, que a leva item a
 * item. Uma alteração de preço de dez linhas viraria um muro de texto no
 * celular; as três primeiras dizem o que houve e o resto vem no documento novo,
 * que chega em seguida.
 */
export function generateEnvelopeVoidedWhatsApp(data: WhatsAppVoidedData): string {
  const MAX_ITEMS = 3;
  const shown = data.changes.slice(0, MAX_ITEMS);
  const rest = data.changes.length - shown.length;

  const lines = [
    `Olá, ${firstName(data.signerName)}.`,
    '',
    `O orçamento nº *${data.budgetNumber}* foi alterado e a coleta de assinaturas anterior foi encerrada.`,
  ];

  if (data.hadSigned) {
    lines.push(
      '',
      'Sua assinatura foi anulada por causa dessa alteração — não por algum problema com ela. Você receberá um novo link para revisar a versão atualizada.',
    );
  } else {
    lines.push('', 'O link que você recebeu não vale mais. Um novo será enviado com a versão atualizada.');
  }

  if (shown.length) {
    lines.push('', '*O que mudou:*');
    for (const c of shown) {
      lines.push(`• ${c}`);
    }
    if (rest > 0) lines.push(`• e mais ${rest} ${rest === 1 ? 'alteração' : 'alterações'}.`);
  } else if (data.reason) {
    lines.push('', `Motivo: ${data.reason}`);
  }

  return lines.join('\n');
}

export interface WhatsAppAnkaaNoticeData extends SignatureWhatsAppBase {
  signingUrl: string;
}

export function generateAnkaaCountersignWhatsApp(data: WhatsAppAnkaaNoticeData): string {
  return [
    `Olá, ${firstName(data.signerName)}.`,
    '',
    `Todos os responsáveis do cliente já assinaram o orçamento nº *${data.budgetNumber}*. Falta a contra-assinatura da ${COMPANY.name}.`,
    '',
    data.signingUrl,
  ].join('\n');
}
