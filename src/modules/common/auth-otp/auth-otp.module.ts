// api/src/modules/common/auth-otp/auth-otp.module.ts
//
// Entrega de código de acesso, compartilhada entre o login do funcionário e o
// do contato de cliente.
//
// Importa `WhatsAppCloudModule` DIRETO, sem ponte. A assinatura precisou de uma
// (`signature-whatsapp-bridge.module.ts`) porque o módulo de lá é o Baileys, que
// arrasta estado de sessão, socket, guarda de saída e `forwardRef` para as
// notificações. O canal oficial não tem nada disso: é config + um POST.
import { Module } from '@nestjs/common';
import { WhatsAppCloudModule } from '@/modules/integrations/whatsapp-cloud/whatsapp-cloud.module';
import { MailerModule } from '@/modules/common/mailer/mailer.module';
import { AuthOtpDeliveryService } from './auth-otp-delivery.service';

@Module({
  imports: [WhatsAppCloudModule, MailerModule],
  providers: [AuthOtpDeliveryService],
  exports: [AuthOtpDeliveryService],
})
export class AuthOtpModule {}
