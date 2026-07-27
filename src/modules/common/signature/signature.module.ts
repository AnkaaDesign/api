/**
 * Módulo de assinatura eletrônica.
 *
 * Reúne a cerimônia (envelope, desafio OTP, trilha encadeada), a produção do
 * documento (render server-side, montagem, selo PAdES) e as rotas interna e
 * pública.
 *
 * O signer PAdES vive aqui, e não em `PpeModule`, porque este suporta carimbo do
 * tempo RFC 3161 (PAdES-B-T). O `PpePadesSignerService` original permanece
 * intocado — os fluxos de RH funcionam e não há motivo para arriscá-los; ambos
 * podem coexistir, pois produzem arquivos independentes.
 */

import { Module, OnModuleInit, Inject, Logger, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { WhatsAppModule } from '@modules/common/whatsapp/whatsapp.module';
import { assertSignatureSecrets } from './utils/secrets';

import { PadesSignerService } from './pades/pades-signer.service';
import { SignatureAuditService } from './services/signature-audit.service';
import { SigningChallengeService } from './services/signing-challenge.service';
import { QuoteSnapshotService } from './services/quote-snapshot.service';
import { SignatureEnvelopeService } from './services/signature-envelope.service';
import { SignatureDeletionService } from './services/signature-deletion.service';
import { SignatureExpiryScheduler } from './services/signature-expiry.scheduler';
import { QuoteRendererService } from './document/quote-renderer.service';
import { QuoteAssemblerService } from './document/quote-assembler.service';
import { DossierAssemblerService } from './dossier/dossier-assembler.service';
import { NfseModule } from '@modules/integrations/nfse/nfse.module';
import { SicrediModule } from '@modules/integrations/sicredi/sicredi.module';
import { SignatureController, PublicSignatureController } from './signature.controller';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    forwardRef(() => WhatsAppModule),
    // O dossiê busca NFS-e na Elotech e boleto no Sicredi quando não há cópia
    // local. forwardRef nos dois: são módulos de integração grandes e o custo de
    // um ciclo futuro é um boot quebrado.
    forwardRef(() => NfseModule),
    forwardRef(() => SicrediModule),
  ],
  controllers: [SignatureController, PublicSignatureController],
  providers: [
    PadesSignerService,
    SignatureAuditService,
    SigningChallengeService,
    QuoteSnapshotService,
    QuoteRendererService,
    QuoteAssemblerService,
    DossierAssemblerService,
    SignatureEnvelopeService,
    SignatureDeletionService,
    SignatureExpiryScheduler,
  ],
  exports: [
    SignatureEnvelopeService,
    DossierAssemblerService,
    SignatureDeletionService,
    SignatureAuditService,
    QuoteSnapshotService,
    PadesSignerService,
  ],
})
export class SignatureModule implements OnModuleInit {
  private readonly logger = new Logger(SignatureModule.name);

  constructor(
    private readonly envelopes: SignatureEnvelopeService,
    private readonly config: ConfigService,
    // O transporte de WhatsApp é registrado sob um token string, e o módulo dele
    // depende de NotificationModule — injetar por setter mantém o grafo de
    // dependências raso e evita ciclo.
    @Inject('WhatsAppService') private readonly whatsapp: { sendMessage(p: string, m: string): Promise<boolean> },
  ) {}

  onModuleInit(): void {
    // FALHA NO BOOT, de propósito.
    //
    // O modo de falha que isto substitui era silencioso: sem
    // `SIGNATURE_HMAC_SECRET` o serviço gravava `hmacSignature = null` e seguia
    // assinando. O sistema parecia funcionar e produzia documentos com evidência
    // enfraquecida — descobrir isso na contestação de um contrato é tarde demais,
    // e não há como remendar retroativamente (as assinaturas já foram colhidas).
    //
    // Preferir derrubar o boot a operar degradado é a mesma escolha que a trilha
    // append-only faz: em prova, falhar é melhor do que fingir.
    this.assertSecretsOrDie();
    this.envelopes.setWhatsAppSender(this.whatsapp);
  }

  private assertSecretsOrDie(): void {
    try {
      assertSignatureSecrets(key => this.config.get<string>(key));
    } catch (error) {
      // Log antes de relançar: dependendo de como o processo é supervisionado, a
      // exceção do boot pode sair truncada, e esta é a mensagem que diz o que fazer.
      this.logger.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}
