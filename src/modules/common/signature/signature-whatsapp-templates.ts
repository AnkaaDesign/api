// api/src/modules/common/signature/signature-whatsapp-templates.ts
//
// Catálogo dos templates aprovados na Meta para a cerimônia de assinatura.
//
// POR QUE UM CATÁLOGO, E NÃO NOMES SOLTOS NAS CHAMADAS
//   O nome do template é um contrato com um sistema de fora: existe lá, aprovado,
//   com um número exato de variáveis numa ordem exata. Errar a ORDEM não quebra
//   nada no `tsc` — produz uma mensagem que diz o número do orçamento onde
//   deveria dizer o nome do cliente, já entregue, impossível de recolher. Juntar
//   os três num arquivo só significa que conferir o texto aprovado contra o
//   código é ler uma tela, e não caçar chamadas pelo serviço de 5 mil linhas.
//
// O TEXTO NÃO ESTÁ AQUI DE PROPÓSITO
//   O corpo aprovado mora na Meta. Duplicá-lo em comentário garantiria que as
//   duas versões divergissem. O que está aqui é o CONTRATO: quantas variáveis,
//   em que ordem, e o que cada uma significa.
import { firstName } from '../../../templates/signature-whatsapp';

/** Mesma forma que `WhatsAppCloudTemplateMessage`, sem importar o transporte. */
export interface SignatureWhatsAppTemplate {
  name: string;
  language: string;
  bodyParams: string[];
  urlButtonParam?: string;
  otpButtonParam?: string;
}

const LANGUAGE = 'pt_BR';

export const SIGNATURE_WHATSAPP_TEMPLATE_NAMES = {
  /**
   * Convite e reenvio. `{{1}}` nome · `{{2}}` orçamento · `{{3}}` prazo + botão de URL.
   *
   * O nome não é `orcamento_pronto_assinatura` por um detalhe operacional que
   * vale registrar: a Meta trava o NOME de um template apagado por tempo longo
   * e indeterminado ("being deleted" por minutos que viram dias). Renomear o
   * template é barato; esperar o nome liberar, não.
   */
  INVITATION: 'orcamento_para_assinar',
  /** Código de uso único. `{{1}}` código + botão de copiar. Categoria AUTHENTICATION. */
  OTP: 'orcamento_codigo',
  /** Coleta encerrada por mudança no documento. `{{1}}` nome · `{{2}}` orçamento. */
  VOIDED: 'orcamento_assinatura_cancelada',
  /**
   * Lembrete periódico. Mesma forma do convite — `{{1}}` nome · `{{2}}` orçamento
   * · `{{3}}` prazo + botão de URL —, texto diferente: o convite anuncia, o
   * lembrete cobra.
   *
   * É um template PRÓPRIO, e não o convite reenviado, por um motivo que só
   * aparece na conta do fim do mês: a Meta mede qualidade POR TEMPLATE. Um
   * lembrete que alguns clientes vão bloquear derruba a nota DELE — e o convite,
   * que é a mensagem sem a qual nenhum orçamento é assinado, continua de pé.
   * Fundidos num só, o bloqueio do lembrete levaria o convite junto.
   */
  REMINDER: 'orcamento_aguardando_assinatura',
  /**
   * A validade venceu sem todas as assinaturas. `{{1}}` nome · `{{2}}` orçamento.
   *
   * SEM BOTÃO DE LINK, de propósito: o link não assina mais nada, e um botão que
   * leva a uma página dizendo "expirado" é pior do que botão nenhum. O que o
   * template carrega é um botão de TELEFONE ("Falar com o comercial"), estático:
   * a Meta o resolve no aparelho, ele não consome parâmetro de envio, e por isso
   * `expiredTemplate` continua mandando só as duas variáveis do corpo.
   */
  EXPIRED: 'orcamento_vencido',
  /**
   * O CLIENTE RECUSOU. `{{1}}` quem recusou · `{{2}}` orçamento · `{{3}}` motivo.
   *
   * ⚠️ É o PRIMEIRO template deste catálogo cujo destinatário é INTERNO — vai
   * para o comercial da Ankaa, não para o cliente. Os avisos internos moram no
   * Baileys justamente por não precisarem de template; este sai pelo número
   * oficial por decisão de negócio, e por isso precisa de um.
   *
   * O MOTIVO É VARIÁVEL, e isso tem consequência: a Meta recusa no ENVIO (não no
   * cadastro) parâmetro com quebra de linha, tabulação ou corrida de espaços, e
   * o motivo é texto que o cliente digitou num `textarea`. `cleanParam` achata
   * tudo; `clampParam` corta o comprimento. Sem os dois, a recusa mais informativa
   * — a que o cliente se deu ao trabalho de explicar — seria justamente a que
   * não chega.
   *
   * Categoria UTILITY: é atualização de uma transação em curso, não marketing.
   */
  REFUSED: 'orcamento_recusado',

  /**
   * COLETA PAUSADA — um responsável do cliente recusou e os COLEGAS dele são
   * avisados. `{{1}}` nome de quem recebe · `{{2}}` orçamento · `{{3}}` quem
   * recusou.
   *
   * ⚠️ DESTINATÁRIO É CLIENTE, e é por isso que este é o mais urgente dos três
   * acrescentados em 17/09. Ele saía em TEXTO LIVRE pelo Baileys, para o número
   * de um responsável do cliente, fora da janela de 24 h — exatamente o envio
   * que a Cloud API recusa e que, pelo canal não oficial, é o que derruba número.
   *
   * SEM O MOTIVO da recusa, pela mesma razão do texto livre: o motivo é uma
   * posição interna do cliente e repassá-la aos colegas dele, por um canal que
   * nós escolhemos, é indiscrição. Quem precisa do motivo é o nosso comercial.
   *
   * Sem botão: o link pessoal de cada um continua valendo e já está na conversa
   * dele, no convite. Um botão novo aqui convidaria a assinar agora, que é o
   * contrário do que a mensagem diz.
   */
  COLLECTION_PAUSED: 'orcamento_assinatura_pausada',

  /**
   * CONTRA-ASSINATURA PENDENTE, para o lado da Ankaa. `{{1}}` nome · `{{2}}`
   * orçamento.
   *
   * Serve os DOIS momentos: o aviso de que o cliente terminou
   * (`notifyAnkaaSigner`) e a cobrança periódica que passou a existir na
   * cadência (`dispatchDueReminders`, grupo 1). O corpo é verdadeiro nos dois —
   * "aguarda a contra-assinatura" — e o que muda entre eles é o texto LIVRE, que
   * sai por e-mail e pelo Baileys e ali diz há quantos dias está parado.
   *
   * Sem botão, como o `orcamento_recusado`: quem recebe é gente de casa, a tela
   * exige login e o orçamento é achado pelo número. Um botão de URL para uma
   * tela atrás de login só produziria uma ida ao login sem contexto.
   */
  ANKAA_COUNTERSIGN: 'orcamento_contra_assinatura',

  /**
   * COLETA ANULADA por alteração material — versão do lado da ANKAA. `{{1}}`
   * nome · `{{2}}` orçamento · `{{3}}` motivo.
   *
   * Gêmeo interno de `VOIDED`, e separado dele porque o que os dois precisam
   * dizer é diferente: o cliente precisa saber que vem outro link; quem trabalha
   * aqui precisa saber POR QUE a coleta caiu, e é o motivo que diz isso. Mesmo
   * tratamento do `orcamento_recusado` para a variável de texto livre
   * (`cleanParam` + `clampParam`).
   */
  VOIDED_INTERNAL: 'orcamento_assinatura_cancelada_interna',
} as const;

/**
 * A Meta recusa variável com quebra de linha, tabulação ou corrida de espaços —
 * e recusa no ENVIO, não no cadastro. Um nome colado de planilha com `\n` no fim
 * derrubaria o convite de um cliente específico, de forma reprodutível e
 * invisível em teste.
 */
function cleanParam(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Encurta um parâmetro sem cortar palavra no meio.
 *
 * O motivo da recusa aceita 1000 caracteres no banco — é um `textarea`, e há
 * cliente que escreve um parágrafo. Um corpo de template que estoura o limite da
 * Meta é recusado INTEIRO: em vez de um aviso truncado, o comercial não recebe
 * aviso nenhum, que é o pior dos dois resultados. O texto completo continua no
 * sistema, e é para lá que a mensagem manda olhar.
 */
function clampParam(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function invitationTemplate(data: {
  signerName: string;
  budgetNumber: string | number;
  deadlineDate: string;
  /**
   * O token do signatário — o SUFIXO do botão, não a URL inteira.
   * O template guarda `https://…/cliente/assinar/{{1}}`.
   */
  accessToken: string;
}): SignatureWhatsAppTemplate {
  return {
    name: SIGNATURE_WHATSAPP_TEMPLATE_NAMES.INVITATION,
    language: LANGUAGE,
    bodyParams: [
      cleanParam(firstName(data.signerName)),
      cleanParam(data.budgetNumber),
      cleanParam(data.deadlineDate),
    ],
    urlButtonParam: cleanParam(data.accessToken),
  };
}

/**
 * O reenvio usa o MESMO template do convite.
 *
 * A mensagem antiga abria com "Reenviando o link…", o que só informa uma falha
 * nossa: ou o cliente perdeu a primeira, ou ela não chegou. Para quem recebe, a
 * frase útil é a mesma das duas vezes — o orçamento está pronto e o link é este.
 */
export const resendTemplate = invitationTemplate;

/**
 * O aviso de RECUSA para o comercial da Ankaa.
 *
 * Sem botão: quem recebe é gente de casa, com sessão no sistema, e o orçamento
 * é achado pelo número. Um botão de URL para uma tela atrás de login só
 * produziria uma ida ao login sem contexto.
 */
export function refusedTemplate(data: {
  /** Quem recusou — o responsável do CLIENTE, não quem recebe o aviso. */
  refusedByName: string;
  budgetNumber: string | number;
  reason: string;
}): SignatureWhatsAppTemplate {
  return {
    name: SIGNATURE_WHATSAPP_TEMPLATE_NAMES.REFUSED,
    language: LANGUAGE,
    bodyParams: [
      // Nome COMPLETO, não só o primeiro: quem lê precisa saber qual dos
      // responsáveis do cliente recusou, e num cadastro com dois "Carlos" o
      // primeiro nome não responde isso.
      cleanParam(data.refusedByName),
      cleanParam(data.budgetNumber),
      clampParam(cleanParam(data.reason), 320),
    ],
  };
}

export function otpTemplate(data: { code: string }): SignatureWhatsAppTemplate {
  return {
    name: SIGNATURE_WHATSAPP_TEMPLATE_NAMES.OTP,
    language: LANGUAGE,
    // Nos templates de autenticação o código vai DUAS vezes: uma no corpo, que
    // a pessoa lê, e outra no botão, que ela toca para copiar. São parâmetros
    // distintos para a Meta, com o mesmo valor.
    bodyParams: [cleanParam(data.code)],
    otpButtonParam: cleanParam(data.code),
  };
}

/**
 * Lembrete de que a assinatura segue pendente.
 *
 * A cadência que decide QUANDO isto sai mora em `SignatureReminderScheduler`;
 * aqui só se monta a mensagem.
 */
export function reminderTemplate(data: {
  signerName: string;
  budgetNumber: string | number;
  deadlineDate: string;
  accessToken: string;
}): SignatureWhatsAppTemplate {
  return {
    name: SIGNATURE_WHATSAPP_TEMPLATE_NAMES.REMINDER,
    language: LANGUAGE,
    bodyParams: [
      cleanParam(firstName(data.signerName)),
      cleanParam(data.budgetNumber),
      cleanParam(data.deadlineDate),
    ],
    urlButtonParam: cleanParam(data.accessToken),
  };
}

/** Validade vencida sem todas as assinaturas — o comercial vai reanalisar. */
export function expiredTemplate(data: {
  signerName: string;
  budgetNumber: string | number;
}): SignatureWhatsAppTemplate {
  return {
    name: SIGNATURE_WHATSAPP_TEMPLATE_NAMES.EXPIRED,
    language: LANGUAGE,
    bodyParams: [cleanParam(firstName(data.signerName)), cleanParam(data.budgetNumber)],
  };
}

export function voidedTemplate(data: {
  signerName: string;
  budgetNumber: string | number;
}): SignatureWhatsAppTemplate {
  return {
    name: SIGNATURE_WHATSAPP_TEMPLATE_NAMES.VOIDED,
    language: LANGUAGE,
    bodyParams: [cleanParam(firstName(data.signerName)), cleanParam(data.budgetNumber)],
  };
}

/**
 * Aviso aos DEMAIS responsáveis do cliente de que um colega recusou.
 *
 * Espelha `generateCollectionPausedWhatsApp` — os dois textos têm de dizer a
 * mesma coisa, porque o mesmo responsável pode receber um hoje e o outro amanhã,
 * se o canal oficial cair.
 */
export function collectionPausedTemplate(data: {
  /** Quem RECEBE o aviso. */
  signerName: string;
  budgetNumber: string | number;
  /** Quem recusou — outro responsável do mesmo cliente. */
  refusedByName: string;
}): SignatureWhatsAppTemplate {
  return {
    name: SIGNATURE_WHATSAPP_TEMPLATE_NAMES.COLLECTION_PAUSED,
    language: LANGUAGE,
    bodyParams: [
      cleanParam(firstName(data.signerName)),
      cleanParam(data.budgetNumber),
      // Nome COMPLETO de quem recusou, como no `orcamento_recusado`: num cadastro
      // com dois "Carlos" o primeiro nome não diz qual dos colegas foi.
      cleanParam(data.refusedByName),
    ],
  };
}

/**
 * O cliente terminou (ou continua terminado) e falta a nossa caneta.
 *
 * O MESMO template serve o aviso e o lembrete — ver a nota em
 * `ANKAA_COUNTERSIGN`. Quem distingue os dois momentos é o texto livre.
 */
export function ankaaCountersignTemplate(data: {
  signerName: string;
  budgetNumber: string | number;
}): SignatureWhatsAppTemplate {
  return {
    name: SIGNATURE_WHATSAPP_TEMPLATE_NAMES.ANKAA_COUNTERSIGN,
    language: LANGUAGE,
    bodyParams: [cleanParam(firstName(data.signerName)), cleanParam(data.budgetNumber)],
  };
}

/** A coleta caiu por alteração material — o que o lado da ANKAA recebe. */
export function voidedInternalTemplate(data: {
  signerName: string;
  budgetNumber: string | number;
  /** Por que a coleta foi anulada. Texto nosso, mas de tamanho livre. */
  reason: string;
}): SignatureWhatsAppTemplate {
  return {
    name: SIGNATURE_WHATSAPP_TEMPLATE_NAMES.VOIDED_INTERNAL,
    language: LANGUAGE,
    bodyParams: [
      cleanParam(firstName(data.signerName)),
      cleanParam(data.budgetNumber),
      clampParam(cleanParam(data.reason), 320),
    ],
  };
}
