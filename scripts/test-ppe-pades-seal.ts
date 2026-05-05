/**
 * End-to-end smoke test for PPE PAdES sealing.
 *
 * Generates a tiny PDF with PDFKit, runs it through PpePadesSignerService,
 * writes the sealed PDF to /tmp, and prints cert metadata + verification hints.
 *
 * Run with:
 *   npx tsx scripts/test-ppe-pades-seal.ts
 */

import 'dotenv/config';
import * as path from 'path';
import { writeFileSync } from 'fs';
import PDFDocument from 'pdfkit';
import { ConfigService } from '@nestjs/config';
import { PpePadesSignerService } from '../src/modules/inventory/ppe/ppe-pades-signer.service';

function generateSamplePdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4' });
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(20).text('Termo de Entrega de EPI — TESTE', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Gerado em: ${new Date().toISOString()}`);
    doc.moveDown();
    doc.text('Este PDF é um teste de selo PAdES com cert ICP-Brasil A1.');
    doc.end();
  });
}

async function main() {
  const config = new ConfigService({
    PPE_CERT_PATH: process.env.PPE_CERT_PATH,
    PPE_CERT_PASSWORD: process.env.PPE_CERT_PASSWORD,
    PPE_TSA_URL: process.env.PPE_TSA_URL,
  });

  const signer = new PpePadesSignerService(config);
  signer.onModuleInit();

  if (!signer.isEnabled()) {
    console.error('Signer not enabled — check PPE_CERT_PATH / PPE_CERT_PASSWORD in .env');
    process.exit(1);
  }

  const meta = signer.getCertMetadata();
  console.log('=== CERT METADATA ===');
  console.log('Subject CN:    ', meta?.subjectCommonName);
  console.log('CNPJ:          ', meta?.cnpj);
  console.log('Issuer:        ', meta?.issuer);
  console.log('Serial:        ', meta?.serialNumber);
  console.log('Valid:         ', meta?.notBefore.toISOString(), '→', meta?.notAfter.toISOString());

  console.log('\n=== GENERATING PDF ===');
  const sample = await generateSamplePdf();
  console.log('Sample PDF size:', sample.length, 'bytes');

  console.log('\n=== APPLYING PAdES SEAL ===');
  const result = await signer.sealPdf(sample, {
    reason: 'Smoke test — PAdES seal',
    location: 'Ibiporã-PR, Brasil',
    signerName: meta?.subjectCommonName || 'Ankaa Design',
    contactInfo: 'contato@ankaadesign.com.br',
  });

  const outPath = path.join('/tmp', `ppe-seal-test-${Date.now()}.pdf`);
  writeFileSync(outPath, result.signedPdf);

  console.log('Sealed PDF size:', result.signedPdf.length, 'bytes');
  console.log('Sealed at:     ', result.sealedAt.toISOString());
  console.log('Output:        ', outPath);

  console.log('\n=== VERIFICATION HINTS ===');
  console.log('• Open the file in Adobe Reader — it should show a signature panel.');
  console.log('• Inspect with pdfsig:');
  console.log(`    pdfsig "${outPath}"`);
  console.log('• Or with Poppler:');
  console.log(`    pdfinfo "${outPath}" | grep -i sign`);
}

main().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
