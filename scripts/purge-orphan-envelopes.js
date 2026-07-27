/**
 * Limpeza de envelopes ÓRFÃOS — aqueles cujo PDF congelado sumiu do disco.
 *
 * Um envelope cujo `original.pdf` não existe mais não é evidência de coisa
 * alguma: o `originalSha256` gravado não pode ser conferido contra nada, a
 * cadeia de auditoria atesta um documento inexistente, e as duas rotas de PDF
 * (a do signatário e a de verificação) respondem ENOENT para sempre. Ele não
 * pode ser assinado, não pode ser finalizado e não pode ser verificado — só
 * ocupa espaço e quebra tela.
 *
 * A escolha aqui é APAGAR, não recriar. Recriar mintaria um envelope `version+1`
 * sobre orçamentos de clientes reais, colocando-os de volta numa cerimônia de
 * assinatura que ninguém pediu (e disparando convite). Apagar devolve o
 * orçamento ao estado anterior, que é o correto.
 *
 * TRAVAS:
 *   - só entra na lista envelope cujo `original.pdf` NÃO existe em disco;
 *   - nunca toca envelope `COMPLETED` nem com signatário `SIGNED` (aí o
 *     desaparecimento do arquivo é um incidente a investigar, não lixo a varrer);
 *   - dry-run por padrão. Precisa de `--apply` para escrever.
 *
 * USO (precisa do build; tsx não boota o Nest):
 *
 *     cd api && npm run build
 *     node -r ./scripts/module-alias-setup.js scripts/purge-orphan-envelopes.js
 *     node -r ./scripts/module-alias-setup.js scripts/purge-orphan-envelopes.js --apply
 *
 * Filtro opcional por orçamento: `--budget 580,581,582`.
 */
require('reflect-metadata');
process.env.DISABLE_WHATSAPP = 'true';
process.env.DISABLE_SMS = 'true';

const ROOT = require('path').resolve(__dirname, '..');
const { existsSync } = require('fs');

const APPLY = process.argv.includes('--apply');
const budgetArgIndex = process.argv.indexOf('--budget');
const BUDGETS =
  budgetArgIndex > -1 && process.argv[budgetArgIndex + 1]
    ? process.argv[budgetArgIndex + 1]
        .split(',')
        .map(n => Number(n.trim()))
        .filter(Number.isFinite)
    : null;

(async () => {
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(`${ROOT}/dist/app.module`);
  const { PrismaService } = require(`${ROOT}/dist/modules/common/prisma/prisma.service`);
  const {
    SignatureDeletionService,
  } = require(`${ROOT}/dist/modules/common/signature/services/signature-deletion.service`);

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.init();
  const prisma = app.get(PrismaService, { strict: false });
  const deletion = app.get(SignatureDeletionService, { strict: false });

  const all = await prisma.signatureEnvelope.findMany({
    where: BUDGETS ? { quote: { budgetNumber: { in: BUDGETS } } } : {},
    select: {
      id: true,
      status: true,
      version: true,
      verificationCode: true,
      createdAt: true,
      quote: { select: { budgetNumber: true } },
      originalFile: { select: { path: true } },
      finalFile: { select: { path: true } },
      signers: { select: { status: true } },
      _count: { select: { events: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const orphans = [];
  const suspicious = [];

  for (const e of all) {
    const originalMissing = !e.originalFile || !existsSync(e.originalFile.path);
    if (!originalMissing) continue;
    const binding = e.status === 'COMPLETED' || e.signers.some(s => s.status === 'SIGNED');
    (binding ? suspicious : orphans).push(e);
  }

  const line = e =>
    `  nº ${String(e.quote?.budgetNumber ?? '?').padEnd(5)} v${e.version} ${e.status.padEnd(12)} ` +
    `${e.verificationCode}  ${e.createdAt.toISOString().slice(0, 19)}  ` +
    `signers=${e.signers.length} signed=${e.signers.filter(s => s.status === 'SIGNED').length} ` +
    `events=${e._count.events}`;

  console.log(`\nEnvelopes inspecionados: ${all.length}`);

  if (suspicious.length) {
    console.log(
      `\n!! ${suspicious.length} envelope(s) VINCULANTE(S) com PDF ausente — NÃO serão tocados.\n` +
        '   Isso é perda de evidência, não lixo. Investigue backup/restauração.',
    );
    suspicious.forEach(e => console.log(line(e)));
  }

  if (!orphans.length) {
    console.log('\nNenhum envelope órfão não-vinculante. Nada a fazer.\n');
    await app.close();
    process.exit(0);
  }

  console.log(`\n${orphans.length} envelope(s) órfão(s) sem valor probatório:`);
  orphans.forEach(e => console.log(line(e)));

  if (!APPLY) {
    console.log('\nDRY-RUN. Rode de novo com --apply para remover.\n');
    await app.close();
    process.exit(0);
  }

  const ids = orphans.map(e => e.id);
  const purged = await prisma.$transaction(async tx => deletion.purgeEnvelopes(tx, ids));
  await deletion.unlinkFrozenDocuments(purged.frozenDocumentPaths);

  console.log(
    `\nRemovidos ${purged.envelopesRemoved} envelope(s) e ${purged.auditEventsRemoved} evento(s) de auditoria.\n`,
  );

  await app.close();
  process.exit(0);
})().catch(e => {
  console.error('FALHOU:', e);
  process.exit(1);
});
