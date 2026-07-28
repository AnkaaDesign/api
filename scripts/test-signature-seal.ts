/**
 * Smoke test do selo PAdES: renderiza um orçamento, sela com o A1 e verifica
 * a assinatura resultante com `pdfsig` (poppler), se disponível.
 *
 *   npx tsx scripts/test-signature-seal.ts
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PadesSignerService } from '../src/modules/common/signature/pades/pades-signer.service';
import { QuoteRendererService } from '../src/modules/common/signature/document/quote-renderer.service';

(async () => {
  const cfg = new ConfigService();
  const pades = new PadesSignerService(cfg);
  pades.onModuleInit();

  console.log('PAdES habilitado:', pades.isEnabled());
  console.log('carimbo do tempo:', pades.isTimestampEnabled());
  const meta = pades.getCertMetadata();
  console.log('certificado:', meta?.subjectCommonName);
  console.log('CNPJ extraído:', meta?.cnpj);
  console.log('emissor:', meta?.issuer);
  console.log('expira em:', pades.getDaysToExpiry(), 'dias');
  if (!pades.isEnabled()) { console.error('SIGNER DESABILITADO'); process.exit(1); }

  const renderer = new QuoteRendererService();
  const out = await renderer.render({
    budgetNumber: 9999, issuedAt: new Date('2026-07-26T12:00:00Z'), expiresAt: new Date('2026-08-25T12:00:00Z'),
    corporateName: 'TRANSPORTES TESTE LTDA', customerDocumentFormatted: '12.345.678/0001-99',
    contactName: 'Joao da Silva', serialNumber: 'SN-1', plate: 'ABC1D23', chassisNumber: null,
    truckCategoryLabel: null, truckImplementLabel: null,
    services: [{ description: 'Pintura completa do implemento', amount: 12500, observation: null }],
    subtotal: 12500, total: 12500, discountLabel: null, discountAmount: 0,
    deliveryDays: 20, simultaneousTasks: null,
    paymentText: 'Pagamento à vista.', guaranteeText: 'Garantia de 5 anos.',
    layoutImages: [],
    signers: [{ id: 's1', name: 'Sergio Rodrigues', subtitle: 'Diretor Comercial', side: 'ANKAA' }],
    acceptanceClause: 'Cláusula de aceitação do meio eletrônico.',
    verificationCode: 'TEST-0000-0000', verificationUrl: 'https://ankaadesign.com.br/v/TEST-0000-0000',
  });

  const sealed = await pades.sealPdf(out.pdf, {
    reason: 'Teste de selo — orçamento 9999',
    location: 'Ibiporã-PR, Brasil',
    signerName: meta!.subjectCommonName,
    contactInfo: 'ankaadesign@outlook.com',
  });

  const path = join(tmpdir(), 'ankaa-orcamento-selado.pdf');
  writeFileSync(path, sealed.signedPdf);
  console.log('\nSELADO OK');
  console.log('  nível:', sealed.level);
  console.log('  bytes:', out.pdf.length, '->', sealed.signedPdf.length);
  console.log('  arquivo:', path);
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
