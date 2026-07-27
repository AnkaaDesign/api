/**
 * Smoke test do renderizador server-side do orçamento.
 *
 *   npx tsx scripts/test-signature-document.ts          # 14 serviços
 *   NSVC=45 npx tsx scripts/test-signature-document.ts  # força paginação
 *
 * Verifica: o PDF é gerado, as âncoras de TODOS os slots de assinatura são
 * medidas, e a página de assinaturas não transborda (`sigOverflow=false`) —
 * transbordar significaria clipar uma linha de assinatura em silêncio.
 */
import { QuoteRendererService } from '../src/modules/common/signature/document/quote-renderer.service';
import { readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

(async () => {
  const svc = new QuoteRendererService();
  const ALL = [
    { id: 'sig-ankaa', name: 'Sergio Rodrigues', subtitle: 'Diretor Comercial — Ankaa Design', side: 'ANKAA' as const },
    { id: 'sig-c1', name: 'João da Silva Pereira', subtitle: 'Gestor de Frota — TRANSPORTES XYZ LTDA', side: 'CUSTOMER' as const },
    { id: 'sig-c2', name: 'Maria Souza', subtitle: 'Financeiro — TRANSPORTES XYZ LTDA', side: 'CUSTOMER' as const },
    { id: 'sig-c3', name: 'Carlos Eduardo Menezes', subtitle: 'Diretor de Operações — TRANSPORTES XYZ LTDA', side: 'CUSTOMER' as const },
    { id: 'sig-c4', name: 'Ana Paula Rodrigues', subtitle: 'Sócia-administradora — TRANSPORTES XYZ LTDA', side: 'CUSTOMER' as const },
    { id: 'sig-c5', name: 'Roberto Nakamura', subtitle: 'Gerente de Manutenção — TRANSPORTES XYZ LTDA', side: 'CUSTOMER' as const },
  ];
  const signers = ALL.slice(0, Number(process.env.NSIG || 3));
  const t0 = Date.now();
  const out = await svc.render({
    budgetNumber: 1234,
    issuedAt: new Date('2026-07-24T12:00:00Z'),
    expiresAt: new Date('2026-08-23T12:00:00Z'),
    corporateName: 'TRANSPORTES XYZ LTDA',
    customerDocumentFormatted: '12.345.678/0001-99',
    contactName: 'João da Silva Pereira',
    serialNumber: 'SN-99120',
    plate: 'ABC1D23',
    chassisNumber: '9BWZZZ377VT004251',
    vinPlate: null,
    // Enum CRU de propósito: é o que `SignatureEnvelopeService` entrega hoje, e
    // o template precisa imprimir "Semirreboque 2 Eixos" / "Sider".
    truckCategoryLabel: 'SEMI_TRAILER_2_AXLES',
    truckImplementLabel: 'CURTAIN_SIDE',
    services: Array.from({ length: Number(process.env.NSVC||14) }, (_, i) => (
      // O primeiro item exercita a regra do "Outros" (mostra só a observação) e
      // o segundo o Title Case sobre cadastro em caixa alta.
      i === 0
        ? { description: 'Outros', amount: 980, observation: 'Adesivagem das portas traseiras conforme layout' }
        : i === 1
          ? { description: 'PINTURA GERAL DA CABINE', amount: 4200, observation: 'Azul Firenze' }
          : {
              description: `Serviço de pintura e plotagem — etapa ${i + 1} com descrição razoavelmente longa para testar quebra`,
              amount: 1234.56 + i * 100,
              observation: i % 4 === 0 ? 'Observação técnica adicional sobre a etapa' : null,
            }
    )),
    subtotal: 28000, total: 26600,
    // Percentual E referência juntos: o rótulo deve sair "Desconto (5%) — ESPECIAL".
    discountLabel: '5%', discountPercent: 5, discountReference: 'ESPECIAL', discountAmount: 1400,
    deliveryDays: 20, simultaneousTasks: 3,
    paymentText: 'Fica acertado o pagamento em 3 (três) parcelas de R$ 8.866,67 via boleto, com entrada para 5 dias a partir da finalização do serviço e as demais a cada 20 dias.',
    guaranteeText: 'A Garantia para o serviço de pintura é de 5 anos desde que seja atendido as condições de uso e cuidado do implemento.',
    // LAYOUT=/caminho/img.jpg exercita a folha de assinaturas COM layout, que tem
    // mecânica própria (a imagem cresce para ocupar a sobra vertical).
    layoutImages: process.env.LAYOUT
      ? [
          `data:image/${process.env.LAYOUT.endsWith('.png') ? 'png' : 'jpeg'};base64,` +
            readFileSync(process.env.LAYOUT).toString('base64'),
        ]
      : [],
    signers,
    acceptanceClause: 'ACEITAÇÃO DO MEIO ELETRÔNICO. As partes reconhecem e aceitam, para todos os fins do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001, a assinatura eletrônica deste orçamento.',
    verificationCode: 'A7K9-2FMQ-XR4T',
    verificationUrl: 'https://ankaadesign.com.br/v/A7K9-2FMQ-XR4T',
  });
  const ms = Date.now() - t0;
  const outPath = join(tmpdir(), 'ankaa-orcamento-render.pdf');
  writeFileSync(outPath, out.pdf);
  const { PDFDocument } = await import('pdf-lib');
  const pc = (await PDFDocument.load(out.pdf)).getPageCount();
  console.log(`OK  -> ${outPath}\n    bytes=${out.pdf.length}  ms=${ms}  pages=${pc} contentPages=${out.contentPages}  fitIter=${out.fitIterations}  sigOverflow=${out.overflowed}`);
  console.log('anchors:');
  for (const [id, a] of Object.entries(out.anchors)) {
    console.log(`  ${id}: page=${a.page} x=${a.x.toFixed(1)} y=${a.y.toFixed(1)} w=${a.width.toFixed(1)} h=${a.height.toFixed(1)} pageCss=${a.pageWidthCss.toFixed(1)}x${a.pageHeightCss.toFixed(1)}`);
  }
  const missing = signers.filter(s => !out.anchors[s.id]);
  console.log(missing.length ? `MISSING ANCHORS: ${missing.map(m=>m.id).join(',')}` : 'all anchors present');
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
