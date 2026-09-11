// api/src/modules/integrations/whatsapp-cloud/whatsapp-cloud.types.ts
//
// O RECORTE do payload da Meta que a gente de fato usa.
//
// Não é o esquema completo do webhook — é de propósito. O payload da Cloud API
// cresce a cada versão do Graph, e tipar o que não se lê só cria manutenção:
// tudo aqui é opcional porque a Meta entrega `value` com um conjunto de chaves
// diferente para cada `field`, e campo ausente é o caso NORMAL, não o erro.

/** Status de entrega de uma mensagem que NÓS enviamos. */
export type WhatsAppCloudStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'deleted';

/** Erro que a Meta anexa a um status `failed` — é ele que diz o porquê. */
export interface WhatsAppCloudError {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
  href?: string;
}

export interface WhatsAppCloudStatusEntry {
  id?: string; // wamid da mensagem enviada
  status?: WhatsAppCloudStatus;
  timestamp?: string; // epoch em SEGUNDOS, string
  recipient_id?: string; // telefone do destinatário, só dígitos
  conversation?: { id?: string; origin?: { type?: string } };
  pricing?: { billable?: boolean; category?: string; pricing_model?: string };
  errors?: WhatsAppCloudError[];
}

export interface WhatsAppCloudInboundMessage {
  id?: string;
  from?: string; // telefone de quem escreveu, só dígitos
  timestamp?: string;
  type?: string; // 'text' | 'button' | 'interactive' | 'image' | ...
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  context?: { id?: string; from?: string }; // resposta a uma mensagem nossa
}

export interface WhatsAppCloudValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: WhatsAppCloudInboundMessage[];
  statuses?: WhatsAppCloudStatusEntry[];
  errors?: WhatsAppCloudError[];

  // `field: 'message_template_status_update'`
  event?: string; // 'APPROVED' | 'REJECTED' | 'PAUSED' | ...
  message_template_id?: number | string;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string;

  // `field: 'account_update'` / alertas de qualidade do número
  phone_number?: string;
  current_limit?: string;
  event_type?: string;
}

export interface WhatsAppCloudChange {
  field?: string; // 'messages' | 'message_template_status_update' | 'account_update' | ...
  value?: WhatsAppCloudValue;
}

export interface WhatsAppCloudEntry {
  id?: string; // WABA id
  changes?: WhatsAppCloudChange[];
}

export interface WhatsAppCloudWebhookPayload {
  object?: string; // sempre 'whatsapp_business_account'
  entry?: WhatsAppCloudEntry[];
}

/** Eventos internos. Quem quiser reagir escuta — o webhook não conhece ninguém. */
export const WHATSAPP_CLOUD_EVENTS = {
  /** Status de entrega de mensagem NOSSA (sent/delivered/read/failed). */
  STATUS: 'whatsapp.cloud.status',
  /** Mensagem que o cliente mandou para o número oficial. */
  INBOUND: 'whatsapp.cloud.inbound',
  /** Template aprovado, recusado ou pausado pela Meta. */
  TEMPLATE_STATUS: 'whatsapp.cloud.template-status',
  /** Mudança na conta: limite de mensagens, qualidade, banimento. */
  ACCOUNT_UPDATE: 'whatsapp.cloud.account-update',
} as const;
