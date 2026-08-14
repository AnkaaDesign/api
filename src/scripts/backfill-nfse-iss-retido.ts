/**
 * Corrige o campo "ISS retido" das NFS-e do padrão nacional.
 *
 * O parser derivava `issRetained` como `tpRetISSQN === '1'`, mas no leiaute
 * nacional 1 significa **Não Retido** (2 = retido pelo tomador, 3 = pelo
 * intermediário). A comparação estava invertida: marcava como RETIDO exatamente
 * o caso em que não há retenção.
 *
 * Consequência: toda NFS-e de prestador MEI entrou no sistema com "ISS retido:
 * Sim" — e para MEI a retenção é PROIBIDA (regra E0583, o ISS está no DAS).
 * Isso engana quem lê a nota e distorce a conciliação.
 *
 * Duas passadas, nesta ordem de confiança:
 *   1. Onde existe o XML arquivado, RE-PARSEIA e usa o valor recomputado — é a
 *      correção exata, sem inferência.
 *   2. Onde não há XML, corrige apenas as notas cujo emitente é um MEI
 *      cadastrado (opSimpNac = 2), onde a retenção é impossível por regra.
 *      As demais ficam intocadas: sem o XML não dá para saber, e chutar seria
 *      trocar um dado errado por outro.
 *
 * Rodar: npm run backfill:nfse-iss-retido            (relatório, não grava)
 *        npm run backfill:nfse-iss-retido -- --apply (grava)
 */

import { NestFactory } from '@nestjs/core';
import { promises as fs } from 'node:fs';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { SiegXmlParserService } from '../modules/integrations/sieg/sieg-xml-parser.service';
import { FiscalDocumentType } from '@prisma/client';

async function main() {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    const prisma = app.get(PrismaService, { strict: false });
    const parser = app.get(SiegXmlParserService, { strict: false });

    const meiCnpjs = new Set(
      (
        await prisma.fiscalEmitterProfile.findMany({
          where: { opSimpNac: 2 },
          select: { cnpj: true },
        })
      ).map(p => p.cnpj),
    );

    const docs = await prisma.fiscalDocument.findMany({
      where: { docType: FiscalDocumentType.NFSE, issRetained: true },
      select: {
        id: true,
        accessKey: true,
        emitCnpj: true,
        issRetained: true,
        rawXmlFile: { select: { path: true } },
      },
    });

    console.log(`\n▸ ${docs.length} NFS-e marcadas como "ISS retido"\n`);

    let porXml = 0;
    let porRegraMei = 0;
    let semEvidencia = 0;

    for (const doc of docs) {
      let novo: boolean | null = null;
      let origem = '';

      if (doc.rawXmlFile?.path) {
        try {
          const xml = await fs.readFile(doc.rawXmlFile.path, 'utf8');
          const parsed = parser.parse(xml);
          if (parsed && parsed.issRetained !== undefined) {
            novo = parsed.issRetained ?? null;
            origem = 'XML';
          }
        } catch {
          // XML ausente no disco — cai na regra do MEI abaixo.
        }
      }

      if (novo === null && meiCnpjs.has(doc.emitCnpj)) {
        novo = false;
        origem = 'regra MEI (E0583)';
      }

      if (novo === null) {
        semEvidencia += 1;
        continue;
      }
      if (novo === doc.issRetained) continue;

      if (origem === 'XML') porXml += 1;
      else porRegraMei += 1;

      console.log(`  ${doc.accessKey}: ISS retido ${doc.issRetained} → ${novo}  (${origem})`);
      if (apply) {
        await prisma.fiscalDocument.update({
          where: { id: doc.id },
          data: { issRetained: novo },
        });
      }
    }

    console.log(
      `\n  Corrigidas pelo XML: ${porXml} | pela regra do MEI: ${porRegraMei} | sem evidência (intocadas): ${semEvidencia}`,
    );
    console.log(apply ? '\n  ✅ Alterações gravadas.\n' : '\n  (simulação — rode com --apply para gravar)\n');
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
