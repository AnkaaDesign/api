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
  /** `string | number` como no par de e-mail: `Budget.budgetNumber` é Int. */
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
 * Espelha o template `orcamento_para_assinar` da Cloud API — os dois textos
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

export interface WhatsAppReminderData extends SignatureWhatsAppBase {
  signingUrl: string;
  deadlineDate: string;
  /** Dias inteiros que faltam para a validade vencer. Negativo nunca chega aqui. */
  daysLeft: number;
}

/**
 * Lembrete de que a assinatura segue pendente.
 *
 * NÃO REPETE O CONVITE. Quem recebe isto já recebeu o convite — reabrir com "o
 * orçamento está pronto para sua assinatura" faz a pessoa achar que é a mesma
 * mensagem duplicada e ensina a ignorar as próximas. A informação nova é UMA: o
 * tempo que resta.
 *
 * O prazo é dito em DIAS e também em data. "Vence em 22/09" exige que a pessoa
 * saiba que dia é hoje; "faltam 3 dias" é a frase que faz alguém parar o que
 * está fazendo. As duas juntas custam meia linha.
 *
 * Espelha o template `orcamento_aguardando_assinatura` da Cloud API.
 */
export function generateSignatureReminderWhatsApp(data: WhatsAppReminderData): string {
  const prazo =
    data.daysLeft <= 0
      ? '*hoje é o último dia*'
      : data.daysLeft === 1
        ? '*vence amanhã*'
        : `faltam *${data.daysLeft} dias*`;

  return [
    `Olá, ${firstName(data.signerName)}. O orçamento nº *${data.budgetNumber}* ainda aguarda sua assinatura — ${prazo} (validade até ${data.deadlineDate}).`,
    '',
    'Seu link continua o mesmo:',
    '',
    data.signingUrl,
  ].join('\n');
}

export interface WhatsAppExpiredData extends SignatureWhatsAppBase {
  /** Verdadeiro para quem chegou a assinar antes de a validade vencer. */
  hadSigned: boolean;
}

/**
 * A validade venceu sem todas as assinaturas.
 *
 * O TOM É NOSSO, NÃO DELE. O cliente não descumpriu nada: um orçamento tem
 * validade porque PREÇO tem validade, e a nossa é que venceu. Escrever "você não
 * assinou a tempo" seria cobrar de quem estava decidindo — e é o mesmo cliente
 * que vai receber a proposta reformulada na semana que vem.
 *
 * DIZ O QUE ACONTECE AGORA, e não só o que deixou de valer. "Vamos rever o valor
 * e enviar uma nova proposta" é a frase que impede a pergunta "e agora?" — que,
 * sem ela, chega por telefone ao comercial, um cliente de cada vez.
 *
 * VAI PARA QUEM JÁ ASSINOU TAMBÉM (decisão de 11/09): quem assinou e vê a coleta
 * cair sem explicação nenhuma conclui que a assinatura dele se perdeu por
 * descuido nosso. A frase do `hadSigned` existe para dizer que o ato dele foi
 * registrado e que o que venceu foi o prazo, não a assinatura.
 *
 * O CONTATO É NOMEADO, e não "responda esta mensagem" — que era o que estava
 * escrito aqui até 13/09. No canal oficial aquilo virou um beco: a resposta do
 * cliente chega pelo webhook, vira uma linha de log e não abre conversa com
 * ninguém. Dizer COM QUEM falar, e por qual número, é o que transforma o aviso
 * de vencimento na próxima proposta em vez de numa mensagem sem saída.
 *
 * Espelha o template `orcamento_vencido` da Cloud API.
 */
export function generateSignatureExpiredWhatsApp(data: WhatsAppExpiredData): string {
  return [
    `Olá, ${firstName(data.signerName)}. A validade do orçamento nº *${data.budgetNumber}* venceu, e a coleta de assinaturas foi encerrada.`,
    '',
    data.hadSigned
      ? 'Sua assinatura ficou registrada — o que venceu foi o prazo do orçamento, não ela.'
      : 'O link que você recebeu não vale mais.',
    '',
    `A ${COMPANY.name} vai revisar os valores e enviar uma proposta atualizada. Se preferir adiantar, fale com ${COMPANY.directorName}, ${COMPANY.directorTitle}: ${COMPANY.phone}.`,
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

export interface WhatsAppRefusalNoticeData extends SignatureWhatsAppBase {
  /** Quem RECUSOU — o responsável do cliente. `signerName` aqui é quem RECEBE. */
  refusedByName: string;
  reason: string;
  /** A tela interna do orçamento. Como no aviso de contra-assinatura: exige login. */
  quoteUrl: string;
}

/**
 * A versão Baileys do aviso de recusa — usada enquanto a Cloud API estiver
 * desligada, e como recuo se ela for desligada de novo.
 *
 * O MOTIVO VEM INTEIRO aqui, ao contrário do template: texto livre não tem
 * limite de parâmetro, e o comercial que vai ligar para o cliente precisa da
 * frase completa, não de um resumo.
 */
export function generateRefusalNoticeWhatsApp(data: WhatsAppRefusalNoticeData): string {
  return [
    `Olá, ${firstName(data.signerName)}.`,
    '',
    `*${data.refusedByName}* recusou a assinatura do orçamento nº *${data.budgetNumber}*.`,
    '',
    'Motivo informado:',
    `_${data.reason}_`,
    '',
    'A coleta NÃO foi encerrada: as assinaturas já colhidas continuam valendo.',
    'Para retomar, use "Pedir novamente" no sistema — ou ajuste o orçamento, lembrando que o reajuste invalida as assinaturas já colhidas.',
    '',
    data.quoteUrl,
  ].join('\n');
}

export interface WhatsAppCollectionPausedData extends SignatureWhatsAppBase {
  /** Quem recusou. O MOTIVO não vai — ver a nota no gerador. */
  refusedByName: string;
}

/**
 * Aviso aos DEMAIS responsáveis de que um colega recusou.
 *
 * SEM O MOTIVO, de propósito. O motivo é uma frase que um responsável escreveu
 * sobre o negócio ("o preço está acima do que a diretoria aprovou") e repassá-la
 * aos colegas dele é divulgar uma posição interna do cliente para dentro da
 * própria empresa dele, por um canal que nós escolhemos. Quem precisa do motivo
 * para agir é o nosso comercial, e é a ele que ele vai.
 *
 * O que estes destinatários precisam saber é só isto: a coleta parou, o link
 * deles continua válido, e ninguém está esperando uma ação deles agora.
 */
export function generateCollectionPausedWhatsApp(data: WhatsAppCollectionPausedData): string {
  return [
    `Olá, ${firstName(data.signerName)}.`,
    '',
    `A coleta de assinaturas do orçamento nº *${data.budgetNumber}* foi pausada: ` +
      `*${data.refusedByName}* não aprovou a proposta.`,
    '',
    'As assinaturas já registradas continuam valendo — nada do que você assinou foi perdido.',
    '',
    `A ${COMPANY.name} vai retomar o contato. Se o orçamento for alterado, você recebe um novo link.`,
  ].join('\n');
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

/**
 * A COBRANÇA da contra-assinatura — o gêmeo do lembrete do cliente, do nosso lado.
 *
 * O aviso (`generateAnkaaCountersignWhatsApp`) sai UMA vez, quando o cliente
 * termina. Este sai enquanto a nossa caneta não sai, na mesma cadência do
 * cliente (3 dias úteis, depois de 5 em 5).
 *
 * NÃO REPETE O AVISO. Quem recebe isto já recebeu aquele — reabrir com "todos
 * já assinaram" faz a pessoa ler a mesma mensagem duas vezes e ensina a
 * ignorá-la. A informação nova é o TEMPO parado, e a consequência dele.
 *
 * O template do canal oficial é o MESMO do aviso (`orcamento_contra_assinatura`):
 * o corpo aprovado diz "aguarda a contra-assinatura", que é verdade nos dois
 * momentos. É aqui, no texto livre, que a diferença cabe.
 */
export function generateAnkaaCountersignReminderWhatsApp(
  data: WhatsAppAnkaaNoticeData & {
    /** Dias civis desde que o último responsável do cliente assinou. */
    daysPending: number;
  },
): string {
  const tempo =
    data.daysPending <= 0
      ? 'hoje'
      : data.daysPending === 1
        ? '*desde ontem*'
        : `*há ${data.daysPending} dias*`;
  return [
    `Olá, ${firstName(data.signerName)}.`,
    '',
    `O orçamento nº *${data.budgetNumber}* está assinado pelo cliente ${tempo} e ainda aguarda a contra-assinatura da ${COMPANY.name}.`,
    '',
    'Sem ela o documento final não é emitido e o orçamento não é aprovado.',
    '',
    data.quoteUrl,
  ].join('\n');
}
