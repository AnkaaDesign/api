// api/src/modules/integrations/whatsapp-cloud/whatsapp-cloud.module.ts
//
// Canal oficial (Cloud API): entrada (webhook) e saída (template).
//
// Fica em `integrations/` e não dentro de `common/whatsapp/` de propósito: aquele
// módulo é o Baileys, com estado de sessão, QR code, guarda de saída e
// `forwardRef` para as notificações. Este aqui não tem sessão, não tem socket e
// não precisa de nada daquilo — juntar os dois só arrastaria o boot de um para o
// outro. Os dois canais convivem; quem escolhe entre eles é quem envia.
import { Module } from '@nestjs/common';
import { WhatsAppCloudConfig } from './whatsapp-cloud.config';
import { WhatsAppCloudWebhookController } from './whatsapp-cloud-webhook.controller';
import { WhatsAppCloudWebhookService } from './whatsapp-cloud-webhook.service';
import { WhatsAppCloudSender } from './whatsapp-cloud-sender.service';

@Module({
  controllers: [WhatsAppCloudWebhookController],
  providers: [WhatsAppCloudConfig, WhatsAppCloudWebhookService, WhatsAppCloudSender],
  exports: [WhatsAppCloudConfig, WhatsAppCloudSender],
})
export class WhatsAppCloudModule {}
