// api/src/modules/integrations/whatsapp-cloud/whatsapp-cloud-sender.service.ts
//
// Envio pelo canal OFICIAL. Só template, e de propósito.
//
// FORA DA JANELA DE 24 H, TEXTO LIVRE NÃO EXISTE
//   A Cloud API recusa qualquer corpo escrito por nós enquanto o cliente não
//   escrever primeiro. Toda mensagem que a cerimônia INICIA — convite, código,
//   aviso de cancelamento — nasce fora dessa janela. Por isso este serviço não
//   tem `sendText`: oferecer um significaria oferecer um caminho que falha em
//   produção sempre que importa.
//
// O TEXTO NÃO É NOSSO, A ESTRUTURA É
//   O template aprovado mora na Meta; daqui saem só as variáveis. É o inverso do
//   Baileys, onde o corpo inteiro era string montada em código. A troca compra
//   três coisas que não existiam: botão que copia o código, botão que abre o
//   link, e um `wamid` que o webhook devolve dizendo se chegou.
import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppCloudConfig } from './whatsapp-cloud.config';

/** O que a cerimônia pede. Nomes de template ficam em quem chama, não aqui. */
export interface WhatsAppCloudTemplateMessage {
  /** Nome exato do template aprovado na WABA. */
  name: string;
  /** Código de idioma do template — `pt_BR` no nosso caso. */
  language: string;
  /** Variáveis do corpo, na ordem de `{{1}}`, `{{2}}`, … */
  bodyParams: string[];
  /**
   * Sufixo dinâmico do botão de URL.
   *
   * O template guarda `https://…/cliente/assinar/{{1}}` e só o TOKEN viaja. É
   * isso que permite um botão por signatário sem um template por signatário.
   */
  urlButtonParam?: string;
  /** Código do botão "copiar" dos templates de autenticação. */
  otpButtonParam?: string;
}

export interface WhatsAppCloudSendResult {
  ok: boolean;
  /** Identificador da mensagem na Meta. É por ele que o webhook nos encontra. */
  wamid?: string;
  /** Texto em português para o OPERADOR — trilha e tela, nunca o signatário. */
  reason?: string;
  /** Código da Meta, quando houve. Separa "tente de novo" de "não adianta". */
  code?: string;
}

/**
 * Códigos que mudam a CONDUTA de quem vê a falha.
 *
 * O resto vira "erro da Meta (código N)" com a mensagem original no log: uma
 * tabela exaustiva envelheceria a cada versão do Graph, e o que o operador
 * precisa saber é se insiste, se conserta o cadastro ou se espera.
 */
const ERROR_REASONS: Record<number, string> = {
  131026: 'O número não tem WhatsApp ou não pode receber mensagens.',
  131047: 'Janela de conversa fechada — só template aprovado é aceito agora.',
  131049:
    'A Meta segurou a entrega por controle de qualidade do ecossistema. Tente mais tarde.',
  131031: 'A conta de WhatsApp da empresa está restrita pela Meta.',
  132000: 'O template não bate com o número de variáveis enviado.',
  132001: 'Template não encontrado nesse idioma — confira se está aprovado.',
  132005: 'O texto de uma variável é longo demais para o template.',
  132007: 'O conteúdo de uma variável foi recusado pelas regras do template.',
  132012: 'Formato de variável inválido para o template.',
  132015: 'O template está pausado pela Meta por qualidade baixa.',
  132016: 'O template foi desativado pela Meta.',
  133010: 'O número remetente não está registrado na Cloud API.',
  190: 'Token da Cloud API inválido ou expirado — gere um novo usuário de sistema.',
  80007: 'Limite de chamadas da Cloud API atingido. Tente em instantes.',
  130429: 'Limite de envio atingido para este número hoje.',
};

@Injectable()
export class WhatsAppCloudSender {
  private readonly logger = new Logger(WhatsAppCloudSender.name);

  constructor(private readonly config: WhatsAppCloudConfig) {}

  /**
   * Pronto para falar com CLIENTE: tem credencial E a chave está ligada.
   * É o que a ponte da assinatura consulta para decidir o canal.
   */
  get isConfigured(): boolean {
    return this.config.canSend && this.config.clientChannelEnabled;
  }

  /**
   * Envia um template. NUNCA lança — devolve `{ ok: false, reason }`.
   *
   * A cerimônia grava o resultado na trilha append-only e decide entre
   * `INVITATION_SENT` e `INVITATION_FAILED`. Uma exceção aqui viraria 500 numa
   * rota pública e deixaria a trilha sem o evento.
   */
  async sendTemplate(
    phone: string,
    template: WhatsAppCloudTemplateMessage,
  ): Promise<WhatsAppCloudSendResult> {
    const url = this.config.messagesUrl;
    const token = this.config.accessToken;
    if (!url || !token) {
      return { ok: false, reason: 'Canal oficial de WhatsApp não configurado no servidor.' };
    }

    const to = this.toE164Digits(phone);
    if (!to) {
      return { ok: false, reason: 'Telefone inválido para envio pelo WhatsApp.' };
    }

    const components: unknown[] = [];
    if (template.bodyParams.length > 0) {
      components.push({
        type: 'body',
        parameters: template.bodyParams.map(text => ({ type: 'text', text })),
      });
    }
    // Botão de URL e botão de copiar código usam o MESMO envelope na API
    // (`sub_type: 'url'`, índice 0). Não é engano: para a Meta os dois são
    // "botão 0 com um parâmetro", e o que muda é o tipo declarado no template.
    const buttonParam = template.urlButtonParam ?? template.otpButtonParam;
    if (buttonParam) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: buttonParam }],
      });
    }

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(components.length ? { components } : {}),
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const body = (await response.json()) as any;

      if (!response.ok) {
        const error = body?.error ?? {};
        const code = Number(error.code);
        const detail = error.error_data?.details ?? error.message ?? 'sem detalhe';
        this.logger.error(
          `Envio recusado pela Cloud API (template ${template.name}, código ${code}): ${detail}`,
        );
        return {
          ok: false,
          reason: ERROR_REASONS[code] ?? `A Meta recusou o envio (código ${code}).`,
          code: String(code),
        };
      }

      const wamid: string | undefined = body?.messages?.[0]?.id;
      this.logger.log(`Template ${template.name} aceito pela Cloud API — wamid ${wamid ?? '?'}`);
      return { ok: true, wamid };
    } catch (error) {
      // Falha de REDE, não de política: não há código da Meta para gravar, e a
      // conduta é tentar de novo — o oposto de um template recusado.
      this.logger.error(
        `Falha de rede ao falar com a Cloud API: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return { ok: false, reason: 'Não foi possível falar com o WhatsApp agora. Tente de novo.' };
    }
  }

  /**
   * Telefone como a Meta espera: só dígitos, COM código do país.
   *
   * A cerimônia guarda o número como o cadastro brasileiro o escreve — DDD +
   * 8 ou 9 dígitos, sem o 55. O Baileys tolerava isso; a Cloud API entrega para
   * o país errado sem reclamar. O nono dígito, esse, não é problema nosso: a
   * Meta resolve a ambiguidade sozinha e devolve o `wa_id` que existe.
   */
  private toE164Digits(phone: string): string | null {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.length < 10) return null;
    if (digits.length <= 11) return `55${digits}`;
    return digits;
  }
}
