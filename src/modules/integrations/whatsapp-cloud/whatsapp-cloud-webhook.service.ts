// api/src/modules/integrations/whatsapp-cloud/whatsapp-cloud-webhook.service.ts
//
// O que a Meta nos conta depois que a mensagem sai.
//
// POR QUE ISTO IMPORTA MAIS AQUI DO QUE NO BAILEYS
//   No Baileys, "enviado" significa "o socket aceitou". A cerimônia de
//   assinatura grava isso na trilha como se fosse entrega, e não é: o aparelho
//   pode nunca ter recebido. A Cloud API devolve `sent`, `delivered`, `read` e
//   `failed` COM CÓDIGO — e é esse par (wamid + status) que transforma "mandei o
//   código" em prova de que o código chegou ao aparelho do signatário.
//
// POR QUE ELE NÃO ESCREVE NO BANCO AINDA
//   Nada envia pela Cloud API neste momento, então não existe `wamid` nosso para
//   casar com o status que chega. Gravar agora seria inventar vínculo. O serviço
//   registra em log estruturado e EMITE evento; quem for enviar (o provider da
//   Cloud API e a trilha da assinatura) assina o evento e faz a correlação com o
//   `wamid` que ELE guardou no envio. Ver WHATSAPP_CLOUD_EVENTS.
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { maskPhone } from '@modules/common/signature/utils/identity';
import {
  WHATSAPP_CLOUD_EVENTS,
  WhatsAppCloudChange,
  WhatsAppCloudError,
  WhatsAppCloudInboundMessage,
  WhatsAppCloudStatusEntry,
  WhatsAppCloudWebhookPayload,
} from './whatsapp-cloud.types';

@Injectable()
export class WhatsAppCloudWebhookService {
  private readonly logger = new Logger(WhatsAppCloudWebhookService.name);

  constructor(private readonly events: EventEmitter2) {}

  /**
   * Processa um lote do webhook.
   *
   * NUNCA lança. O controller já respondeu 200 quando isto roda, e exceção aqui
   * viraria `unhandledRejection` — a Meta reentrega o mesmo lote por horas
   * quando não recebe 200, e um erro nosso de parsing não pode virar tempestade
   * de reentrega.
   */
  process(payload: WhatsAppCloudWebhookPayload): void {
    try {
      for (const entry of payload?.entry ?? []) {
        for (const change of entry.changes ?? []) {
          this.processChange(entry.id, change);
        }
      }
    } catch (error) {
      this.logger.error(
        `Falha ao processar lote do webhook do WhatsApp: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private processChange(wabaId: string | undefined, change: WhatsAppCloudChange): void {
    const value = change.value;
    if (!value) return;

    switch (change.field) {
      case 'messages':
        for (const status of value.statuses ?? []) this.handleStatus(status);
        for (const message of value.messages ?? []) this.handleInbound(message);
        // Erro de nível de lote (sem `wamid`): normalmente conta suspensa ou
        // número sem permissão de envio. É de OPERADOR, não de destinatário.
        for (const error of value.errors ?? []) {
          this.logger.error(`[CONTA] ${this.describeError(error)}`);
        }
        break;

      case 'message_template_status_update':
        this.handleTemplateStatus(value.message_template_name, value.event, value.reason);
        break;

      default:
        // `account_update`, `phone_number_quality_update`, `account_alerts`, ...
        // Tudo que muda o TETO ou a saúde do número cai aqui, e isso é operação:
        // registrar em log e avisar quem escuta é o suficiente por ora.
        this.logger.log(
          `[${change.field ?? 'desconhecido'}] ${this.compact(value as Record<string, unknown>)}`,
        );
        this.events.emit(WHATSAPP_CLOUD_EVENTS.ACCOUNT_UPDATE, {
          wabaId,
          field: change.field,
          value,
        });
    }
  }

  private handleStatus(status: WhatsAppCloudStatusEntry): void {
    const to = maskPhone(status.recipient_id);
    const line = `wamid=${status.id ?? '?'} → ${status.status ?? '?'} (${to})`;

    if (status.status === 'failed') {
      const errors = (status.errors ?? []).map(e => this.describeError(e)).join(' | ');
      // Falha é o único status que muda decisão: é ele que separa "tente de
      // novo" de "não adianta insistir" (template recusado, número inválido,
      // janela fechada, pacing do ecossistema).
      this.logger.error(`[FALHA] ${line}${errors ? ` — ${errors}` : ''}`);
    } else {
      this.logger.log(`[STATUS] ${line}`);
    }

    this.events.emit(WHATSAPP_CLOUD_EVENTS.STATUS, status);
  }

  private handleInbound(message: WhatsAppCloudInboundMessage): void {
    const from = maskPhone(message.from);
    const body =
      message.text?.body ??
      message.button?.text ??
      message.interactive?.button_reply?.title ??
      message.interactive?.list_reply?.title ??
      `<${message.type ?? 'sem tipo'}>`;

    // Resposta do cliente ABRE a janela de 24 h: dentro dela o envio volta a ser
    // texto livre e sai de graça. Quem for responder precisa saber a hora.
    this.logger.log(`[RECEBIDO] ${from}: ${this.truncate(body, 180)}`);

    this.events.emit(WHATSAPP_CLOUD_EVENTS.INBOUND, message);
  }

  private handleTemplateStatus(
    name: string | undefined,
    event: string | undefined,
    reason: string | undefined,
  ): void {
    const summary = `template "${name ?? '?'}" → ${event ?? '?'}${reason ? ` (${reason})` : ''}`;

    // Recusa e pausa são silenciosas do lado de quem envia: a chamada de envio
    // simplesmente passa a falhar. Gritar no log é o que evita descobrir isso
    // pelo cliente que não recebeu o orçamento.
    if (event && event !== 'APPROVED') this.logger.error(`[TEMPLATE] ${summary}`);
    else this.logger.log(`[TEMPLATE] ${summary}`);

    this.events.emit(WHATSAPP_CLOUD_EVENTS.TEMPLATE_STATUS, { name, event, reason });
  }

  private describeError(error: WhatsAppCloudError): string {
    const details = error.error_data?.details ?? error.message ?? '';
    return `código ${error.code ?? '?'}: ${error.title ?? 'erro'}${details ? ` — ${details}` : ''}`;
  }

  private compact(value: Record<string, unknown>): string {
    return this.truncate(JSON.stringify(value), 500);
  }

  private truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }
}
