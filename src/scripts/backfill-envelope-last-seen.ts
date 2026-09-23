/**
 * Dá DATA à comparação de invalidação dos envelopes que já existiam.
 *
 * `SignatureEnvelope.lastSeenSnapshotSha256` responde "qual foi o último estado
 * do orçamento que o gancho de conteúdo já avaliou". A migração cria a coluna
 * nula porque o valor verdadeiro — o hash do recorte canônico ATUAL (RFC 8785) —
 * só o código sabe calcular. Este script escreve esse valor uma vez, para cada
 * coleta viva ou selada.
 *
 * É a ANISTIA da deriva preexistente, e ela é deliberada: a regra que enxerga
 * coleta CONCLUÍDA entrou em produção depois das divergências que já estavam no
 * acervo. Cobrá-las retroativamente anula contratos assinados na mão de quem
 * abrir a tela primeiro — foi o nº 973 em 22/09/2026, e o nº 959 era o próximo
 * da fila.
 *
 * A deriva NÃO é apagada: a tela e a rota de alterações continuam comparando
 * contra o congelado e continuam mostrando tudo. O que este script decide é que
 * ela não invalida SOZINHA, por gravação alheia. Daqui para a frente, toda
 * alteração material invalida no ato, por quem a fez.
 *
 * ⚠️ SEM `AppModule`: só `PrismaService` e `QuoteSnapshotService`. Subir o
 * contexto inteiro da aplicação aqui ligaria uma segunda instância de produção,
 * com os agendadores todos, contra o mesmo banco.
 *
 * Rodar: npx ts-node src/scripts/backfill-envelope-last-seen.ts           (relatório)
 *        npx ts-node src/scripts/backfill-envelope-last-seen.ts --apply   (grava)
 */

import { PrismaService } from '../modules/common/prisma/prisma.service';
import { QuoteSnapshotService } from '../modules/common/signature/services/quote-snapshot.service';

async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaService();
  await prisma.$connect();
  const snapshots = new QuoteSnapshotService(prisma);

  const envelopes = await prisma.signatureEnvelope.findMany({
    where: { status: { in: ['RUNNING', 'COMPLETED'] }, lastSeenSnapshotSha256: null },
    select: { id: true, quoteId: true, status: true, quoteSnapshotSha256: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`${envelopes.length} envelope(s) vivo(s) ou selado(s) sem marca.\n`);

  let iguais = 0;
  let derivados = 0;
  let semGrafo = 0;

  for (const env of envelopes) {
    const loaded = await snapshots.buildForQuote(env.quoteId);
    if (!loaded) {
      semGrafo++;
      console.log(`  ${env.id}  orçamento ${env.quoteId} não montou — pulado`);
      continue;
    }
    const derivou = loaded.hash !== env.quoteSnapshotSha256;
    if (derivou) {
      derivados++;
      console.log(
        `  ${env.id}  ${env.status}  DERIVA PREEXISTENTE anistiada ` +
          `(congelado ${env.quoteSnapshotSha256.slice(0, 12)} → atual ${loaded.hash.slice(0, 12)})`,
      );
    } else {
      iguais++;
    }
    if (apply) {
      await prisma.signatureEnvelope.update({
        where: { id: env.id },
        data: { lastSeenSnapshotSha256: loaded.hash },
      });
    }
  }

  console.log(
    `\n${iguais} sem deriva · ${derivados} com deriva anistiada · ${semGrafo} sem grafo` +
      (apply ? '\nGRAVADO.' : '\nRelatório apenas — rode com --apply para gravar.'),
  );

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
