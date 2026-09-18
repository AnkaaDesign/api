// api/src/modules/common/auth-otp/auth-otp-templates.ts
//
// Catálogo dos templates Meta usados para ENTREGAR CÓDIGO DE ACESSO.
//
// Mesma doutrina do catálogo da assinatura (`signature-whatsapp-templates.ts`):
// o nome do template é um contrato com um sistema de fora — existe lá, aprovado,
// com um número exato de variáveis numa ordem exata —, e errar a ordem não
// quebra nada no `tsc`: produz uma mensagem errada, já entregue, impossível de
// recolher. O TEXTO aprovado mora na Meta de propósito; aqui fica o contrato.
//
// POR QUE UM TEMPLATE PRÓPRIO, E NÃO REUSAR `orcamento_codigo`
//   Ele já está APPROVED e tem exatamente esta forma — serviria hoje, sem espera.
//   Duas razões para não fazer isso:
//
//   1. O texto aprovado dele fala de ORÇAMENTO. Um código de login chegando como
//      "código do seu orçamento" é confuso, e num fluxo de autenticação confusão
//      é vetor de phishing: a pessoa aprende a digitar código que chegou com
//      contexto que não bate com o que ela está fazendo.
//
//   2. A Meta mede qualidade POR TEMPLATE. É o mesmo argumento que já separou
//      `REMINDER` de `INVITATION` naquele catálogo: fundir login com assinatura
//      faz um bloqueio derrubar o outro — e o da assinatura é o que sustenta o
//      faturamento. Recuperação de senha é justamente a mensagem que mais chega
//      a quem não a pediu, logo a que mais acumula "bloquear".
//
// ENQUANTO O TEMPLATE NOVO NÃO É APROVADO
//   `resolveAccessCodeTemplateName()` cai em `orcamento_codigo`, que tem a mesma
//   forma (1 variável no corpo + botão de copiar). A troca é por variável de
//   ambiente, sem deploy: ver `AUTH_OTP_WHATSAPP_TEMPLATE`.

/** Mesma forma que `WhatsAppCloudTemplateMessage`, sem importar o transporte. */
export interface AuthOtpWhatsAppTemplate {
  name: string;
  language: string;
  bodyParams: string[];
  otpButtonParam?: string;
}

const LANGUAGE = 'pt_BR';

export const AUTH_OTP_TEMPLATE_NAMES = {
  /**
   * Código de acesso ao sistema. `{{1}}` código + botão de copiar.
   * Categoria AUTHENTICATION, `code_expiration_minutes: 10`,
   * `add_security_recommendation: true`.
   *
   * ⚠️ AINDA NÃO SUBMETIDO À META. Enquanto não for aprovado, o envio usa
   * `FALLBACK` — ver `resolveAccessCodeTemplateName`. Passos de submissão no
   * runbook (`docs/WHATSAPP-CLOUD-RUNBOOK.md`).
   */
  ACCESS_CODE: 'ankaa_codigo_acesso',

  /**
   * O template AUTHENTICATION que já está APPROVED. Mesma forma exata.
   * Usado como ponte até `ACCESS_CODE` sair da fila da Meta.
   */
  FALLBACK: 'orcamento_codigo',
} as const;

/**
 * Qual template usar agora. `AUTH_OTP_WHATSAPP_TEMPLATE` permite virar a chave
 * no dia em que a Meta aprovar, sem deploy — o mesmo padrão de
 * `WHATSAPP_CLOUD_ENABLED`.
 */
export function resolveAccessCodeTemplateName(): string {
  const configured = (process.env.AUTH_OTP_WHATSAPP_TEMPLATE ?? '').trim();
  return configured || AUTH_OTP_TEMPLATE_NAMES.FALLBACK;
}

/**
 * Monta a mensagem do código.
 *
 * O código vai no corpo E no botão porque é assim que a Meta exige de um
 * template AUTHENTICATION com `COPY_CODE`: os dois carregam o mesmo valor, e o
 * botão é o que faz a pessoa não errar ao digitar. Note que `bodyParams` e
 * `otpButtonParam` recebem a MESMA string — se um dia divergirem, a pessoa
 * copia um código e lê outro.
 */
export function accessCodeTemplate(code: string): AuthOtpWhatsAppTemplate {
  return {
    name: resolveAccessCodeTemplateName(),
    language: LANGUAGE,
    bodyParams: [code],
    otpButtonParam: code,
  };
}
