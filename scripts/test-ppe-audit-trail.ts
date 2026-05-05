/**
 * End-to-end smoke test for the PPE audit trail PDF page.
 *
 * Generates a signed delivery PDF with a Clicksign-style audit trail page
 * using a real delivery (or a synthesized fake one if there are none),
 * applies the PAdES seal, writes the result to /tmp.
 *
 * Run: npx tsx scripts/test-ppe-audit-trail.ts [deliveryId]
 */

import 'dotenv/config';
import { writeFileSync } from 'fs';
import { join } from 'path';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PpeDocumentService } from '../src/modules/inventory/ppe/ppe-document.service';
import { PpePadesSignerService } from '../src/modules/inventory/ppe/ppe-pades-signer.service';

async function main() {
  const prisma = new PrismaClient();
  const config = new ConfigService({
    PPE_CERT_PATH: process.env.PPE_CERT_PATH,
    PPE_CERT_PASSWORD: process.env.PPE_CERT_PASSWORD,
  });

  const signer = new PpePadesSignerService(config);
  signer.onModuleInit();

  // Find a delivery to use
  const deliveryId =
    process.argv[2] ||
    (
      await prisma.ppeDelivery.findFirst({
        orderBy: { createdAt: 'desc' },
        include: { user: true, item: true },
      })
    )?.id;

  if (!deliveryId) {
    console.error('No delivery found. Pass a deliveryId arg.');
    process.exit(1);
  }

  console.log('=== Using delivery:', deliveryId);

  // Build a synthetic event timeline for the demo (events the audit service
  // would normally have logged)
  const now = Date.now();
  const fakeEvents = [
    {
      type: 'DELIVERY_CREATED',
      occurredAt: new Date(now - 1000 * 60 * 60 * 4),
      actorName: 'Almoxarifado',
      ipAddress: null,
      userAgent: null,
      metadata: { itemName: 'Capacete de segurança', quantity: 1 },
    },
    {
      type: 'DELIVERY_APPROVED',
      occurredAt: new Date(now - 1000 * 60 * 60 * 3),
      actorName: 'Sergio Rodrigues',
      ipAddress: null,
      userAgent: null,
      metadata: { itemName: 'Capacete de segurança' },
    },
    {
      type: 'NOTIFICATION_SENT',
      occurredAt: new Date(now - 1000 * 60 * 60 * 2),
      actorName: 'Sistema Ankaa',
      ipAddress: null,
      userAgent: null,
      metadata: { recipientName: 'Pedro Antônio de Oliveira', channel: 'WhatsApp + Push' },
    },
    {
      type: 'DOCUMENT_VIEWED',
      occurredAt: new Date(now - 1000 * 60 * 30),
      actorName: 'Pedro Antônio de Oliveira',
      ipAddress: '189.127.225.35',
      userAgent: 'Ankaa Mobile/2.4.1 iOS',
      metadata: {},
    },
    {
      type: 'BIOMETRIC_PROMPTED',
      occurredAt: new Date(now - 1000 * 60 * 5),
      actorName: 'Pedro Antônio de Oliveira',
      ipAddress: '189.127.225.35',
      userAgent: null,
      metadata: {},
    },
    {
      type: 'BIOMETRIC_SUCCEEDED',
      occurredAt: new Date(now - 1000 * 60 * 4),
      actorName: 'Pedro Antônio de Oliveira',
      ipAddress: '189.127.225.35',
      userAgent: null,
      metadata: { method: 'FACE_ID' },
    },
    {
      type: 'SIGNATURE_SUBMITTED',
      occurredAt: new Date(now - 1000 * 60 * 3),
      actorName: 'Pedro Antônio de Oliveira',
      ipAddress: '189.127.225.35',
      userAgent: null,
      metadata: {
        biometricMethod: 'FACE_ID',
        deviceModel: 'iPhone 12 Pro',
        appVersion: '2.4.1',
      },
    },
    {
      type: 'HMAC_VALIDATED',
      occurredAt: new Date(now - 1000 * 60 * 3 + 200),
      actorName: 'Servidor Ankaa',
      ipAddress: null,
      userAgent: null,
      metadata: { evidenceHash: 'a4b5c6d7e8f901234567890abcdef0123456789012' },
    },
    {
      type: 'PADES_SEALED',
      occurredAt: new Date(now - 1000 * 60 * 3 + 500),
      actorName: 'Servidor Ankaa',
      ipAddress: null,
      userAgent: null,
      metadata: {
        certCnpj: '13636938000144',
        certSerial: '47E65AB60BCBC633',
        certIssuer: 'AC SAFEWEB RFB v5',
      },
    },
    {
      type: 'SIGNATURE_COMPLETED',
      occurredAt: new Date(now - 1000 * 60 * 3 + 700),
      actorName: 'Pedro Antônio de Oliveira',
      ipAddress: '189.127.225.35',
      userAgent: null,
      metadata: { verificationCode: '649B3A5C71CC22E7', padesSealed: true },
    },
  ];

  const docService = new PpeDocumentService(prisma as any);
  const sig = {
    signerName: 'Pedro Antônio de Oliveira',
    signerCpf: '12345145900',
    biometricMethod: 'FACE_ID',
    deviceModel: 'iPhone 12 Pro',
    clientTimestamp: new Date(now - 1000 * 60 * 3),
    serverTimestamp: new Date(now - 1000 * 60 * 3 + 700),
    latitude: -23.286,
    longitude: -51.0742,
    hmacSignature: '649b3a5c71cc22e7e1a4d6c4b8f0d3e5a8b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7',
  };

  // Pass 1 — render to compute hash
  console.log('=== rendering pass 1 (for hash) ===');
  const buf1 = await docService.generateSignedDeliveryDocument(deliveryId, sig as any, {
    events: fakeEvents,
    documentNumber: deliveryId,
    filename: `termo_epi_Pedro_${deliveryId.substring(0, 8)}.pdf`,
    originalDocHash: null,
  });
  const sha = crypto.createHash('sha256').update(buf1).digest('hex');
  console.log('SHA-256:', sha);

  // Pass 2 — render with hash injected
  console.log('=== rendering pass 2 (with hash injected) ===');
  const buf2 = await docService.generateSignedDeliveryDocument(deliveryId, sig as any, {
    events: fakeEvents,
    documentNumber: deliveryId,
    filename: `termo_epi_Pedro_${deliveryId.substring(0, 8)}.pdf`,
    originalDocHash: sha,
  });

  // Apply PAdES seal
  console.log('=== applying PAdES seal ===');
  const sealed = await signer.sealPdf(buf2, {
    reason: `Termo de entrega de EPI — ${deliveryId}`,
    location: 'Ibiporã-PR, Brasil',
    signerName: signer.getCertMetadata()?.subjectCommonName || 'Ankaa Design',
    contactInfo: 'contato@ankaadesign.com.br',
  });

  const out = join('/tmp', `audit-trail-test-${Date.now()}.pdf`);
  writeFileSync(out, sealed.signedPdf);
  console.log('=== output ===');
  console.log('Sealed PDF size:', sealed.signedPdf.length, 'bytes');
  console.log('Output:         ', out);
  console.log('\nOpen in Preview:');
  console.log(`  open "${out}"`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
