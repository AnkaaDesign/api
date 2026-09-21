// api/src/modules/common/notification/responsible-notice-templates.ts
//
// O TEXTO DOS AVISOS QUE SAEM PARA UM CONTATO DO CLIENTE.
//
// Mesma doutrina dos outros dois catálogos (`signature-whatsapp-templates.ts` e
// `auth-otp-templates.ts`): o nome do template é um contrato com um sistema de
// fora — existe na Meta, aprovado, com um número exato de variáveis numa ordem
// exata —, e errar a ordem não quebra nada no `tsc`. Produz uma mensagem errada,
// já entregue, impossível de recolher.
//
// ⛔ A VERDADE SOBRE O WHATSAPP AQUI, EM 20/09/2026
//   NÃO existe template aprovado para nenhum destes avisos. E, ao contrário do
//   código de acesso, não há PONTE possível: `accessCodeTemplate` cai em
//   `orcamento_codigo` porque aquele template tem a MESMA FORMA (1 variável +
//   botão de copiar). Um aviso de "o seu orçamento já tem valores" não tem forma
//   igual a nenhum dos nove templates aprovados.
//
//   Escrever o corpo à mão também não é opção: `WhatsAppCloudSender` não tem
//   `sendText` de propósito — fora da janela de 24 h a Cloud API RECUSA
//   qualquer corpo nosso, e todo aviso do sistema nasce fora dela.
//
//   Portanto, hoje: **o aviso ao contato do cliente sai por E-MAIL**. A perna do
//   WhatsApp está escrita, desligada por ausência de template, e liga por
//   variável de ambiente no dia em que a Meta aprovar — sem deploy, como
//   `AUTH_OTP_WHATSAPP_TEMPLATE` já faz. Passos de submissão no runbook
//   (`docs/WHATSAPP-CLOUD-RUNBOOK.md`).
//
//   ⚠️ E o caminho de WhatsApp do sistema de NOTIFICAÇÕES não serve de plano B:
//   ele está morto por allowlist vazia (`whatsapp-notification-policy.ts:50-56`)
//   e, mesmo ligado, roteia pelo Baileys com `userId` — que um contato de
//   cliente não tem.
import type { AuthOtpWhatsAppTemplate } from '@/modules/common/auth-otp/auth-otp-templates';

const LANGUAGE = 'pt_BR';

/**
 * O template do aviso "o seu orçamento já tem valores", quando houver.
 *
 * `PORTAL_NOTICE_WHATSAPP_TEMPLATE` recebe o nome aprovado. Vazio ou ausente =
 * `null`, e a escada de entrega pula o canal e vai ao e-mail. É allowlist por
 * omissão, pela mesma assimetria de custo que governa
 * `WHATSAPP_NOTIFICATION_ALLOWLIST`: esquecer de ligar custa um e-mail em vez de
 * uma mensagem; mandar para um template que não existe custa um erro 132001 por
 * destinatário e nota de qualidade na Meta.
 *
 * FORMA ESPERADA quando o template existir: `{{1}}` nome do contato · `{{2}}`
 * número do orçamento. Sem botão — o portal exige sessão, e um botão que leva a
 * uma tela de login não é melhor que o link do rodapé do e-mail.
 */
export function portalNoticeTemplate(
  responsibleName: string,
  budgetLabel: string,
): AuthOtpWhatsAppTemplate | null {
  const name = (process.env.PORTAL_NOTICE_WHATSAPP_TEMPLATE ?? '').trim();
  if (!name) return null;
  return {
    name,
    language: LANGUAGE,
    bodyParams: [cleanParam(responsibleName), cleanParam(budgetLabel)],
  };
}

/**
 * A Meta recusa NO ENVIO (não no cadastro) parâmetro com quebra de linha,
 * tabulação ou corrida de espaços. Nome de contato vem de cadastro digitado à
 * mão e o rótulo do orçamento é montado; os dois passam por aqui pela mesma
 * razão que `orcamento_recusado` achata o motivo da recusa.
 */
export function cleanParam(value: string): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
