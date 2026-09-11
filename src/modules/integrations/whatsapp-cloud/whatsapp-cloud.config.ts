// api/src/modules/integrations/whatsapp-cloud/whatsapp-cloud.config.ts
//
// Configuração do canal OFICIAL de WhatsApp (Cloud API da Meta).
//
// POR QUE EXISTE UM SEGUNDO CANAL
//   O Baileys continua sendo o transporte do tráfego INTERNO (notificação de
//   colaborador). Ele fala pelo número que a Ankaa já usa no celular e, por não
//   ser oficial, vive sob a guarda de saída — tetos de conversa fria, disjuntor,
//   `DUPLICATE_BODY` — porque o risco real ali é BANIMENTO do número.
//
//   A Cloud API é o oposto em quase tudo: número dedicado que sai do app do
//   celular, envio proativo SÓ por template aprovado e cobrado, e reputação
//   medida pela Meta em vez de inferida por nós. É o canal do CLIENTE: aviso de
//   orçamento pronto para assinatura e código de uso único da cerimônia.
//
// O QUE É PERMANENTE E O QUE NÃO É
//   `WABA_ID` é da conta e sobrevive à troca de chip. `PHONE_NUMBER_ID` é do
//   número — trocar o chip troca esse valor e só esse. Os templates pertencem à
//   WABA, então a troca de número não refaz aprovação nenhuma.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Versão do Graph API usada nas chamadas de envio.
 *
 * Fixada de propósito: a Meta deprecia versões com prazo, e uma URL sem versão
 * explícita muda de comportamento debaixo do código sem ninguém pedir.
 */
const DEFAULT_GRAPH_VERSION = 'v25.0';

@Injectable()
export class WhatsAppCloudConfig implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppCloudConfig.name);

  constructor(private readonly config: ConfigService) {}

  /** ID da WhatsApp Business Account. Permanente, não muda com o chip. */
  get wabaId(): string | undefined {
    return this.config.get<string>('WHATSAPP_CLOUD_WABA_ID');
  }

  /** ID do número remetente. MUDA quando o chip muda. */
  get phoneNumberId(): string | undefined {
    return this.config.get<string>('WHATSAPP_CLOUD_PHONE_NUMBER_ID');
  }

  /** Token do usuário de sistema (permanente). O token de 24 h do painel é só teste. */
  get accessToken(): string | undefined {
    return this.config.get<string>('WHATSAPP_CLOUD_TOKEN');
  }

  /**
   * App Secret do app na Meta.
   *
   * É a CHAVE DA ASSINATURA do webhook (`x-hub-signature-256`), não um segredo
   * qualquer: sem ele não há como provar que o corpo veio da Meta, e um webhook
   * público sem prova de origem aceita status forjado de qualquer um.
   */
  get appSecret(): string | undefined {
    return this.config.get<string>('WHATSAPP_CLOUD_APP_SECRET');
  }

  /**
   * Segredo do handshake de assinatura do webhook — inventado por nós e colado
   * no painel da Meta. Só é usado no `GET` de verificação; não tem relação com
   * o App Secret nem com a assinatura do corpo.
   */
  get verifyToken(): string | undefined {
    return this.config.get<string>('WHATSAPP_CLOUD_VERIFY_TOKEN');
  }

  get graphVersion(): string {
    return this.config.get<string>('WHATSAPP_CLOUD_API_VERSION') || DEFAULT_GRAPH_VERSION;
  }

  /** Base das chamadas de envio: `https://graph.facebook.com/<versão>/<phoneNumberId>`. */
  get messagesUrl(): string | undefined {
    if (!this.phoneNumberId) return undefined;
    return `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`;
  }

  /** O ENVIO está configurado (token + número). Não diz nada sobre o webhook. */
  get canSend(): boolean {
    return Boolean(this.accessToken && this.phoneNumberId);
  }

  /**
   * Chave que vira o canal do CLIENTE para a Cloud API.
   *
   * Separada de `canSend` de propósito, e o padrão é DESLIGADO. Configurar o
   * token não é o mesmo que estar pronto para falar com cliente: os templates
   * precisam estar APROVADOS na Meta, e aprovação é dela, não nossa. Com a
   * chave desligada, a cerimônia segue no Baileys exatamente como antes — o
   * código novo fica no ar, inerte, e o dia da virada é uma variável de
   * ambiente em vez de um deploy.
   *
   * É também o botão de pânico: se um template for pausado por qualidade no
   * meio de uma coleta, `false` devolve o canal do cliente ao Baileys sem
   * recompilar nada.
   */
  get clientChannelEnabled(): boolean {
    return (this.config.get<string>('WHATSAPP_CLOUD_ENABLED') ?? '').trim().toLowerCase() === 'true';
  }

  /** O RECEBIMENTO está configurado (verify token + app secret). */
  get canReceive(): boolean {
    return Boolean(this.verifyToken && this.appSecret);
  }

  /**
   * Diz no boot o que falta. Sem derrubar o processo: um ambiente de
   * desenvolvimento sem Cloud API é um caso legítimo, e o e-mail continua sendo
   * o canal padrão da cerimônia de assinatura.
   */
  onModuleInit(): void {
    const missing: string[] = [];
    if (!this.accessToken) missing.push('WHATSAPP_CLOUD_TOKEN');
    if (!this.phoneNumberId) missing.push('WHATSAPP_CLOUD_PHONE_NUMBER_ID');
    if (!this.appSecret) missing.push('WHATSAPP_CLOUD_APP_SECRET');
    if (!this.verifyToken) missing.push('WHATSAPP_CLOUD_VERIFY_TOKEN');

    if (missing.length === 0) {
      this.logger.log(
        `WhatsApp Cloud API configurada (WABA ${this.wabaId ?? '?'}, número ${this.phoneNumberId}, ` +
          `Graph ${this.graphVersion}) — canal do cliente ${this.clientChannelEnabled ? 'LIGADO' : 'desligado (WHATSAPP_CLOUD_ENABLED)'}`,
      );
      return;
    }

    this.logger.warn(
      `WhatsApp Cloud API incompleta — ausentes: ${missing.join(', ')}. ` +
        'O webhook responde, mas recusa payload que não puder verificar.',
    );
  }
}
