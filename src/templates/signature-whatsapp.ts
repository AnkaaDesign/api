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

/**
 * Só o primeiro nome: a mensagem fica pessoal sem virar um bloco de texto.
 *
 * Exportado porque o catálogo de templates da Cloud API monta a MESMA saudação
 * a partir do mesmo cadastro. Duas implementações divergiriam no dia em que
 * alguém tratasse nome composto de um lado só.
 */
export function firstName(fullName: string): string {
  return (fullName ?? '').trim().split(/\s+/)[0] || 'tudo bem';
}

export interface WhatsAppInvitationData extends SignatureWhatsAppBase {
  signingUrl: string;
  deadlineDate: string;
}

/**
 * Convite e reenvio — a MESMA mensagem.
 *
 * A versão anterior abria o reenvio com "Reenviando o link de assinatura", o que
 * só comunica uma falha nossa: ou a primeira não chegou, ou o cliente a perdeu.
 * Para quem recebe, a frase útil é idêntica nas duas vezes.
 *
 * Encolheu de seis blocos para três. O que saiu: a promessa de que "não precisa
 * imprimir nem instalar nada" (ninguém supôs o contrário) e o parágrafo "como
 * funciona", que descrevia em prosa uma tela que a pessoa vai ver em dois
 * toques. O que ficou é o que a pessoa precisa decidir: o que é, até quando
 * vale, e onde tocar.
 *
 * Espelha o template `orcamento_pronto_assinatura` da Cloud API — os dois textos
 * têm de dizer a mesma coisa, porque o mesmo cliente pode receber um hoje e o
 * outro amanhã, se o canal oficial cair.
 */
export function generateSignatureInvitationWhatsApp(data: WhatsAppInvitationData): string {
  return [
    `Olá, ${firstName(data.signerName)}! O orçamento nº *${data.budgetNumber}* está pronto para sua assinatura.`,
    '',
    `O link é pessoal e vale até *${data.deadlineDate}* — abra para ler o documento inteiro e assinar pelo celular:`,
    '',
    data.signingUrl,
  ].join('\n');
}

export interface WhatsAppOtpData extends SignatureWhatsAppBase {
  code: string;
  expiryMinutes: number;
}

/**
 * O código vem na PRIMEIRA linha de propósito.
 *
 * A prévia da notificação no celular corta a mensagem, e é dela que a pessoa lê
 * o código sem abrir a conversa. É o inverso da regra do e-mail — lá o código
 * fica fora do assunto e do preheader justamente para não vazar na prévia —, e a
 * diferença é o modelo de ameaça: a prévia do e-mail chega em telas
 * compartilhadas e em logs de servidor de terceiros; a do WhatsApp chega no
 * aparelho que a posse do número já pressupõe.
 *
 * TRÊS PARÁGRAFOS FORAM EMBORA, E NENHUM PROTEGIA NINGUÉM
 *   Dizer "só pode ser usado uma vez", "se você não solicitou, ignore" e
 *   explicar que o código expira sozinho é escrever para quem já está com a tela
 *   de assinatura aberta esperando seis dígitos. Texto longo em mensagem de
 *   código tem custo real: empurra o número para baixo na notificação, e é lido
 *   como spam — que foi o que derrubou o número anterior.
 *
 *   O aviso anti-golpe fica, em UMA frase, porque ele muda o comportamento de
 *   quem recebe uma ligação pedindo o código. A promessa honesta não é "a Ankaa
 *   nunca manda código" (agora manda), é "a Ankaa nunca PEDE o código de volta".
 */
export function generateSignatureOtpWhatsApp(data: WhatsAppOtpData): string {
  return [
    `*${data.code}* é o seu código de assinatura. Expira em ${data.expiryMinutes} minutos.`,
    '',
    `A ${COMPANY.name} nunca pede este código de volta. Se alguém pedir, é golpe.`,
  ].join('\n');
}

export interface WhatsAppVoidedData extends SignatureWhatsAppBase {
  hadSigned: boolean;
}

/**
 * Aviso de que a coleta caiu porque o orçamento mudou materialmente.
 *
 * A LISTA DE MUDANÇAS SAIU DAQUI — e isso foi decisão, não esquecimento.
 *
 *   O canal oficial manda este aviso por template aprovado
 *   (`orcamento_assinatura_cancelada`), e template tem corpo fixo: uma lista de
 *   tamanho variável não cabe nele. Manter a lista só no Baileys produziria dois
 *   avisos diferentes para o mesmo fato, e o cliente receberia um ou outro
 *   conforme o canal que estivesse de pé no dia.
 *
 *   O que a pessoa precisa saber cabe em três frases: caiu, por quê, e que vem
 *   outro link. O DETALHE de cada alteração continua inteiro em dois lugares que
 *   não têm limite de formato — o e-mail, que leva a tabela item a item, e o
 *   documento novo, que chega em seguida e é o que ela vai assinar.
 */
export function generateEnvelopeVoidedWhatsApp(data: WhatsAppVoidedData): string {
  return [
    `Olá, ${firstName(data.signerName)}. O orçamento nº *${data.budgetNumber}* foi alterado, e a coleta de assinaturas anterior foi encerrada.`,
    '',
    data.hadSigned
      ? 'Sua assinatura foi anulada pela alteração — não por algum problema com ela.'
      : 'O link que você recebeu não vale mais.',
    '',
    'Assim que a versão atualizada estiver pronta, você recebe um novo link para revisar e assinar.',
  ].join('\n');
}

export interface WhatsAppAnkaaNoticeData extends SignatureWhatsAppBase {
  /**
   * A tela INTERNA do orçamento, atrás do login. Ver a nota gêmea em
   * `AnkaaNoticeEmailData.quoteUrl`: um link que assinasse sem código seria uma
   * capability de obrigar a empresa circulando num aplicativo de mensagens.
   */
  quoteUrl: string;
  signedCount?: number;
}

export function generateAnkaaCountersignWhatsApp(data: WhatsAppAnkaaNoticeData): string {
  const quantos =
    data.signedCount && data.signedCount > 0
      ? `${data.signedCount} ${data.signedCount === 1 ? 'responsável do cliente já assinou' : 'responsáveis do cliente já assinaram'}`
      : 'Todos os responsáveis do cliente já assinaram';
  return [
    `Olá, ${firstName(data.signerName)}.`,
    '',
    `${quantos} o orçamento nº *${data.budgetNumber}*. Falta a contra-assinatura da ${COMPANY.name}.`,
    '',
    'Ela é feita dentro do sistema, na tela do orçamento — um botão, sem código.',
    '',
    data.quoteUrl,
  ].join('\n');
}
