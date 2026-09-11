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
