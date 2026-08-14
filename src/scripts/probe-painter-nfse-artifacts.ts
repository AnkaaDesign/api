/**
 * Ensaia o arquivamento dos artefatos da NFS-e sem emitir nada.
 *
 * Injeta um XML autorizado (de arquivo) na linha da nota, roda o arquivamento
 * real — XML em "Notas Fiscais/XML", documento fiscal pelo ingestor do SIEG,
 * DANFSe nas "Notas Fiscais" da aerografia — mostra o resultado e, por padrão,
 * DESFAZ tudo.
 *
 * Existe porque esse caminho só roda depois de uma emissão bem-sucedida, e
 * descobrir que ele falha na primeira nota de produção é caro demais.
 *
 * Rodar:  npx ts-node -r tsconfig-paths/register --transpile-only \
 *           src/scripts/probe-painter-nfse-artifacts.ts <arquivo.xml> [--keep]
 */

import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { PainterNfseArtifactsService } from '../modules/integrations/nfse/painter/painter-nfse-artifacts.service';

async function main() {
  const xmlPath = process.argv[2];
  const keep = process.argv.includes('--keep');
  if (!xmlPath) {
    console.error('\nUso: probe-painter-nfse-artifacts.ts <arquivo.xml> [--keep]\n');
    process.exit(1);
  }

  const xml = readFileSync(xmlPath, 'utf-8');
  const chave = xml.match(/<chNFSe>(\d{50})<\/chNFSe>/)?.[1] ?? xml.match(/Id="NFS(\d{50})"/)?.[1] ?? null;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService, { strict: false });
    const artifacts = app.get(PainterNfseArtifactsService, { strict: false });

    const nfse = await prisma.airbrushingNfse.findFirst({
      select: { id: true, airbrushingId: true, nfseXml: true, accessKey: true, status: true },
    });
    if (!nfse) throw new Error('Nenhuma linha de NFS-e encontrada.');

    // Guarda o estado para devolver depois.
    const before = { ...nfse };

    await prisma.airbrushingNfse.update({
      where: { id: nfse.id },
      data: { nfseXml: xml, accessKey: chave, nfseNumber: xml.match(/<nNFSe>([^<]+)</)?.[1] ?? null },
    });

    console.log(`\n▸ Arquivando artefatos da nota ${nfse.id} (chave ${chave})\n`);
    const result = await artifacts.persist(nfse.id);
    console.log(JSON.stringify(result, null, 1));

    if (result.xmlFileId) {
      const f = await prisma.file.findUnique({
        where: { id: result.xmlFileId },
        select: { filename: true, path: true, size: true, mimetype: true },
      });
      console.log(`\n  XML   → ${f?.path} (${f?.size} bytes, ${f?.mimetype})`);
    }
    if (result.pdfFileId) {
      const f = await prisma.file.findUnique({
        where: { id: result.pdfFileId },
        select: { filename: true, path: true, size: true },
      });
      const linked = await prisma.airbrushing.findUnique({
        where: { id: nfse.airbrushingId },
        select: { invoices: { select: { id: true } } },
      });
      console.log(`  DANFSe → ${f?.path} (${f?.size} bytes)`);
      console.log(
        `  Anexado às Notas Fiscais da aerografia: ${
          linked?.invoices.some(i => i.id === result.pdfFileId) ? 'SIM' : 'NÃO'
        }`,
      );
    }
    if (result.fiscalDocumentId) {
      const d = await prisma.fiscalDocument.findUnique({
        where: { id: result.fiscalDocumentId },
        select: {
          accessKey: true,
          docType: true,
          operationType: true,
          status: true,
          emitCnpj: true,
          emitName: true,
          destCnpj: true,
          totalValue: true,
          rawXmlFileId: true,
        },
      });
      console.log(`\n  Documento fiscal: ${JSON.stringify(d, null, 1)}`);
    }

    if (keep) {
      console.log('\n  --keep: nada foi desfeito.\n');
      return;
    }

    // ── Desfaz ────────────────────────────────────────────────────────────────
    if (result.fiscalDocumentId) {
      await prisma.fiscalDocumentItem
        .deleteMany({ where: { fiscalDocumentId: result.fiscalDocumentId } })
        .catch(() => undefined);
      await prisma.fiscalDocument.delete({ where: { id: result.fiscalDocumentId } }).catch(() => undefined);
    }
    for (const fileId of [result.xmlFileId, result.pdfFileId]) {
      if (fileId) await prisma.file.delete({ where: { id: fileId } }).catch(() => undefined);
    }
    await prisma.airbrushingNfse.update({
      where: { id: nfse.id },
      data: {
        nfseXml: before.nfseXml,
        accessKey: before.accessKey,
        nfseNumber: null,
        xmlFileId: null,
        pdfFileId: null,
        fiscalDocumentId: null,
      },
    });
    console.log('\n  Ensaio desfeito — banco de volta ao estado anterior.\n');
  } finally {
    await app.close().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('\n❌ Falhou:', e?.message ?? e);
    process.exit(1);
  });
