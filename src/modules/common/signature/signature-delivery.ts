// api/src/modules/common/signature/signature-delivery.ts
//
// Canal de entrega da cerimônia de assinatura do orçamento — convite, aviso de
// contra-assinatura e código de uso único.
//
// POR QUE UM ARQUIVO SÓ PARA ISTO
//   O canal deixou de ser uma constante do código e passou a ser configuração
//   (`SIGNATURE_DELIVERY_CHANNEL`) mais, quando o modo é `both`, uma escolha do
//   operador por envelope. Essa decisão é lida em seis lugares diferentes do
//   serviço (validação de contato, criação do signatário, convite, reenvio,
//   aviso da Ankaa, OTP) e em dois repositórios. Espalhá-la como comparações de
//   string soltas era garantia de divergência — foi assim que o e-mail acabou
//   hardcoded em seis pontos quando substituiu o WhatsApp em 2026-07-29.
//
// O CANAL NÃO GANHOU COLUNA NOVA
//   `EnvelopeSigner.authMethod` (`SignatureAuthMethod`) JÁ é o canal: EMAIL_OTP
//   e WHATSAPP_OTP existem desde sempre no enum, `AUTH_METHOD_LABELS` já rotula
//   os dois, o selo do PDF já imprime o rótulo certo e a CHECK
//   `EnvelopeSigner_contact_matches_auth_method` já exige o contato compatível.
//   Uma coluna `deliveryChannel` paralela seria uma segunda fonte de verdade
//   para o mesmo fato, com risco de as duas discordarem no meio de uma coleta.

import { SignatureAuthMethod } from '@prisma/client';

/** Canal efetivo de UM envio. `both` nunca chega aqui — é modo, não canal. */
export const SIGNATURE_DELIVERY_CHANNELS = ['WHATSAPP', 'EMAIL'] as const;
export type SignatureDeliveryChannel = (typeof SIGNATURE_DELIVERY_CHANNELS)[number];

/**
 * Modo configurado no ambiente.
 *
 * `both` NÃO significa "envia pelos dois" — significa "o operador escolhe um dos
 * dois na hora de enviar". Duplicar a mensagem dobraria o custo no WhatsApp e,
 * pior, mandaria o MESMO código para duas caixas: a prova de autoria deixaria de
 * apontar para um canal só, que é justamente o que sustenta o valor probatório
 * do OTP.
 */
export const SIGNATURE_DELIVERY_MODES = ['whatsapp', 'email', 'both'] as const;
export type SignatureDeliveryMode = (typeof SIGNATURE_DELIVERY_MODES)[number];

/**
 * Padrão quando a variável está ausente ou ilegível.
 *
 * E-MAIL, e a razão mudou em 2026-08-17.
 *
 * O default era `whatsapp` porque essa era a decisão vigente do negócio. Ela se
 * inverteu: o WhatsApp passou a recusar os convites com o nack 463
 * (`SenderReachoutTimelocked`) — a conta fica impedida de INICIAR conversa com
 * quem não tem TC token, e o token só existe para quem falou com o número nos
 * últimos 28 dias. Enquanto isso durar, todo envelope que nasce em WhatsApp
 * nasce impossível de assinar, porque o OTP segue o canal gravado no signatário
 * e não há queda para e-mail (ver `sendWhatsApp`).
 *
 * Daí o default ser o canal que FUNCIONA: uma variável ausente ou com erro de
 * digitação passa a degradar para o caminho que entrega, em vez de fabricar
 * envelopes natimortos em silêncio. O modo continua explícito em
 * `.env.production`; isto é a rede de segurança, não a configuração.
 */
export const DEFAULT_SIGNATURE_DELIVERY_MODE: SignatureDeliveryMode = 'email';

export const SIGNATURE_DELIVERY_CHANNEL_LABELS: Record<SignatureDeliveryChannel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'e-mail',
};

/** Lê o modo do ambiente. Valor desconhecido cai no padrão e é sinalizado. */
export function parseSignatureDeliveryMode(raw: string | null | undefined): {
  mode: SignatureDeliveryMode;
  invalid: boolean;
} {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (!normalized) return { mode: DEFAULT_SIGNATURE_DELIVERY_MODE, invalid: false };
  const match = SIGNATURE_DELIVERY_MODES.find(m => m === normalized);
  if (match) return { mode: match, invalid: false };
  return { mode: DEFAULT_SIGNATURE_DELIVERY_MODE, invalid: true };
}

/** Canais que o modo permite. Em `both`, a ordem é a da preferência de exibição. */
export function channelsForMode(mode: SignatureDeliveryMode): SignatureDeliveryChannel[] {
  if (mode === 'whatsapp') return ['WHATSAPP'];
  if (mode === 'email') return ['EMAIL'];
  return ['WHATSAPP', 'EMAIL'];
}

/** O canal pré-selecionado na tela quando o modo é `both`. */
export function defaultChannelForMode(mode: SignatureDeliveryMode): SignatureDeliveryChannel {
  return channelsForMode(mode)[0];
}

/**
 * Resolve o canal de um envio a partir do modo e do que o operador pediu.
 *
 * Devolve `{ channel, rejected }` em vez de lançar: quem chama é que tem
 * contexto para transformar isso na mensagem certa (400 na criação do envelope,
 * silêncio na reemissão automática).
 *
 * A trava é deliberadamente do lado do servidor. A tela esconde o seletor quando
 * o modo é fixo, mas esconder não é impedir — sem esta função um POST à mão
 * mandaria OTP por um canal que a configuração desligou.
 */
export function resolveSignatureDeliveryChannel(
  mode: SignatureDeliveryMode,
  requested: string | null | undefined,
): { channel: SignatureDeliveryChannel; rejected: string | null } {
  const allowed = channelsForMode(mode);
  const normalized = (requested ?? '').trim().toUpperCase();

  if (!normalized) return { channel: defaultChannelForMode(mode), rejected: null };

  const match = SIGNATURE_DELIVERY_CHANNELS.find(c => c === normalized);
  if (!match || !allowed.includes(match)) {
    return { channel: defaultChannelForMode(mode), rejected: requested ?? null };
  }
  return { channel: match, rejected: null };
}

export function authMethodForChannel(channel: SignatureDeliveryChannel): SignatureAuthMethod {
  return channel === 'WHATSAPP'
    ? SignatureAuthMethod.WHATSAPP_OTP
    : SignatureAuthMethod.EMAIL_OTP;
}

/**
 * Canal de um signatário JÁ PERSISTIDO.
 *
 * Lê do envelope, nunca da configuração: um envelope emitido sob `whatsapp`
 * continua sendo um envelope de WhatsApp depois que a variável mudar para
 * `email`. Reenvio e reemissão de OTP de uma coleta em andamento têm de seguir o
 * canal em que a coleta nasceu, senão o segundo fator muda de caixa no meio da
 * cerimônia — exatamente o que o hash material existe para impedir.
 */
export function channelForAuthMethod(
  authMethod: SignatureAuthMethod | string | null | undefined,
): SignatureDeliveryChannel {
  return authMethod === SignatureAuthMethod.WHATSAPP_OTP ? 'WHATSAPP' : 'EMAIL';
}

/** Rótulo do canal na trilha de auditoria. Minúsculo: entra em `payload.channel`. */
export function auditChannelOf(channel: SignatureDeliveryChannel): 'whatsapp' | 'email' {
  return channel === 'WHATSAPP' ? 'whatsapp' : 'email';
}
