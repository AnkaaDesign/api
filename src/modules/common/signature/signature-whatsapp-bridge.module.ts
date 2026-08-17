/**
 * Liga o transporte de WhatsApp à cerimônia de assinatura.
 *
 * POR QUE ESTE MÓDULO EXISTE EM VEZ DE UM IMPORT DIRETO
 *   `SignatureModule` NÃO pode importar `WhatsAppModule`. O comentário no topo
 *   daquele arquivo registra o motivo, e ele continua verdadeiro: o WhatsApp é
 *   exportado sob o token STRING `'WhatsAppService'` e o módulo que o exporta
 *   importa `forwardRef(() => NotificationModule)` — ou seja, um import direto
 *   arrastaria o módulo de notificações inteiro (fila Bull, processadores,
 *   agendadores) para dentro do módulo de assinatura, que hoje é enxuto e cujo
 *   boot é crítico (ele derruba o processo quando falta segredo).
 *
 *   A ponte inverte a direção: quem conhece os dois lados é um terceiro, que
 *   ninguém importa. `SignatureModule` segue sem saber que WhatsApp existe;
 *   `WhatsAppModule` segue sem saber que assinatura existe.
 *
 *   É o mesmo padrão que `TaskQuoteModule` já usa para registrar
 *   `setOnEnvelopeCompleted` — injeção tardia por callback, e não dependência de
 *   módulo.
 *
 * TOLERA A AUSÊNCIA DO TRANSPORTE
 *   O cliente é injetado com `@Optional()`. Sem ele, o port simplesmente não é
 *   registrado e `sendWhatsApp` devolve `false` com log — que é exatamente o que
 *   deve acontecer se alguém rodar a API com `DISABLE_WHATSAPP=true`. Derrubar o
 *   boot aqui seria desproporcional: e-mail continua funcionando, e uma
 *   configuração `SIGNATURE_DELIVERY_CHANNEL=email` não precisa de WhatsApp
 *   nenhum.
 */

import { Inject, Logger, Module, OnModuleInit, Optional, forwardRef } from '@nestjs/common';
import { WhatsAppModule } from '@modules/common/whatsapp/whatsapp.module';
import { SignatureModule } from './signature.module';
import { SignatureEnvelopeService } from './services/signature-envelope.service';

/** Só o que a cerimônia usa do cliente — evita depender da classe concreta. */
interface WhatsAppClient {
  sendMessage(phone: string, message: string): Promise<unknown>;
  isReady?(): boolean;
}

@Module({
  imports: [forwardRef(() => WhatsAppModule), forwardRef(() => SignatureModule)],
})
export class SignatureWhatsAppBridgeModule implements OnModuleInit {
  private readonly logger = new Logger(SignatureWhatsAppBridgeModule.name);

  constructor(
    private readonly envelopes: SignatureEnvelopeService,
    @Optional() @Inject('WhatsAppService') private readonly whatsapp?: WhatsAppClient,
  ) {}

  onModuleInit(): void {
    if (!this.whatsapp) {
      this.logger.warn(
        'Transporte de WhatsApp indisponível — a assinatura de orçamento só poderá usar e-mail. ' +
          'Se SIGNATURE_DELIVERY_CHANNEL incluir "whatsapp", os envios vão falhar.',
      );
      return;
    }

    // Achata para o port booleano, como o adaptador de e-mail faz. `sendMessage`
    // LANÇA quando a sessão está caída ou o número não existe no WhatsApp — o
    // catch aqui é o que transforma isso em INVITATION_FAILED/OTP_DELIVERY_FAILED
    // em vez de um 500 na cara do operador.
    this.envelopes.setWhatsAppSender({
      sendMessage: async (phone, message) => {
        try {
          // Devolve o booleano do transporte em vez de assumir `true`. Hoje o
          // Baileys sempre lança em caso de falha, mas o port é booleano: se um
          // dia ele passar a devolver `false` no lugar de lançar, um `true` fixo
          // aqui gravaria INVITATION_SENT/OTP_SENT para mensagem que não saiu.
          return (await this.whatsapp!.sendMessage(phone, message)) !== false;
        } catch (error) {
          this.logger.error(
            `Falha ao enviar WhatsApp de assinatura: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return false;
        }
      },
    });

    this.logger.log('Transporte de WhatsApp registrado na cerimônia de assinatura.');
  }
}
