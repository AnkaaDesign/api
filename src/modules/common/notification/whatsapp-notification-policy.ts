// api/src/modules/common/notification/whatsapp-notification-policy.ts
//
// Trava de código do WhatsApp no sistema de NOTIFICAÇÕES.
//
// POR QUE ISTO EXISTE, SE OS 204 CONFIGS JÁ ESTÃO COM WHATSAPP DESLIGADO
//   Porque desligar no banco é reversível com um clique. `PUT
//   /notification-configurations/:id/channels/WHATSAPP` deixa qualquer ADMIN
//   rearmar um config pela tela, e `POST /notifications` com `channel:
//   ['WHATSAPP']` explícito nem sequer consulta o registro. O número anterior foi
//   banido por volume; o novo carrega OTP de assinatura de contrato. Um número
//   banido no meio de uma coleta derruba a cerimônia inteira, então a distância
//   entre "política" e "um clique" precisa ser maior que uma coluna booleana.
//
// O QUE ESTA TRAVA **NÃO** ALCANÇA — E É DE PROPÓSITO
//   A cerimônia de assinatura do orçamento (convite, aviso de contra-assinatura
//   e OTP) NÃO passa pelo sistema de notificações. Ela fala com o transporte pela
//   `SignatureWhatsAppBridgeModule` e é governada por
//   `SIGNATURE_DELIVERY_CHANNEL`. Por isso a trava mora aqui, no roteador de
//   canal do dispatch, e não em `BaileysWhatsAppService.sendMessage`: travar no
//   transporte mataria junto o único uso que deve continuar vivo.
//
// COMO LIBERAR ALGUMA COISA DE VOLTA
//   `WHATSAPP_NOTIFICATION_ALLOWLIST` recebe chaves de config separadas por
//   vírgula (ex.: `task_quote.budget_approved,bank_slip.due`). Vazio ou ausente
//   = nada passa, que é a política vigente. É allowlist e não denylist porque o
//   custo dos dois erros é assimétrico: esquecer de bloquear uma chave nova
//   custa um banimento; esquecer de liberar uma custa uma notificação que chega
//   por push.

/** Chaves liberadas por ambiente. Vazio = WhatsApp desligado no dispatch. */
export function whatsAppNotificationAllowlist(
  raw: string | null | undefined = process.env.WHATSAPP_NOTIFICATION_ALLOWLIST,
): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map(key => key.trim())
      .filter(Boolean),
  );
}

/**
 * `configKey` sai de `Notification.metadata.configKey`, gravado na criação.
 *
 * Notificação sem `configKey` é bloqueada: é exatamente o formato que
 * `POST /notifications` com canal explícito produz — o caminho que ignora o
 * registro de configurações — e "não sei de onde veio" não é motivo para deixar
 * passar no número que carrega OTP de contrato.
 */
export function isWhatsAppNotificationAllowed(
  configKey: string | null | undefined,
  allowlist: ReadonlySet<string> = whatsAppNotificationAllowlist(),
): boolean {
  if (!configKey) return false;
  return allowlist.has(configKey);
}

/** Lê `configKey` do metadata sem confiar no formato do Json. */
export function configKeyOfNotification(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const key = (metadata as Record<string, unknown>).configKey;
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

/** Uma linha para o log de boot, para a política ser visível sem ler código. */
export function describeWhatsAppNotificationPolicy(
  allowlist: ReadonlySet<string> = whatsAppNotificationAllowlist(),
): string {
  return allowlist.size === 0
    ? 'WhatsApp DESLIGADO para notificações (allowlist vazia). A cerimônia de assinatura não é afetada.'
    : `WhatsApp liberado para ${allowlist.size} chave(s) de notificação: ${[...allowlist].join(', ')}.`;
}
