/**
 * READ-ONLY probe for an NfseDocument parked in PROCESSING.
 *
 * Emission is a non-transactional HTTP POST: if the process dies after the request
 * leaves but before the response is persisted, the note can be LIVE at the prefeitura
 * while our row still says PROCESSING with no `elotechNfseId`. Re-emitting blind would
 * mint a duplicate live municipal note, which then has to be cancelled with a
 * justification — so the live state must be established FIRST.
 *
 * This script writes nothing. It lists what Elotech actually has for the invoice's
 * customer CNPJ around the emission timestamp, and prints the local row next to it so a
 * human can decide: link the existing note, or re-emit.
 *
 * Run: NODE_ENV=production DOTENV_CONFIG_PATH=.env.production \
 *        npx ts-node -r dotenv/config -r tsconfig-paths/register --transpile-only \
 *        src/scripts/probe-stuck-nfse.ts <nfseDocumentId>
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { ElotechOxyNfseService } from '../modules/integrations/nfse/elotech-oxy-nfse.service';

// eslint-disable-next-line no-console
const out = (message: string): void => console.log(message);

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const docId = process.argv.find(a => /^[0-9a-f-]{36}$/i.test(a));
  if (!docId) {
    out('Uso: probe-stuck-nfse.ts <nfseDocumentId>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const elotech = app.get(ElotechOxyNfseService);

    const doc = await prisma.nfseDocument.findUnique({
      where: { id: docId },
      include: {
        invoice: {
          include: {
            customer: { select: { cnpj: true, corporateName: true, fantasyName: true } },
            task: { select: { id: true, name: true, serialNumber: true } },
            installments: {
              include: { bankSlip: true },
              orderBy: { number: 'asc' },
            },
          },
        },
      },
    });

    if (!doc) {
      out(`NfseDocument ${docId} não encontrado.`);
      return;
    }

    const inv = doc.invoice;
    out('══════════════════ ESTADO LOCAL ══════════════════');
    out(`  NfseDocument   ${doc.id}`);
    out(`  status         ${doc.status}`);
    out(`  elotechNfseId  ${doc.elotechNfseId ?? '(vazio)'}`);
    out(`  nfseNumber     ${doc.nfseNumber ?? '(vazio)'}`);
    out(`  errorCount     ${doc.errorCount}   errorMessage: ${doc.errorMessage ?? '(vazio)'}`);
    out(`  createdAt      ${doc.createdAt.toISOString()}`);
    out(`  updatedAt      ${doc.updatedAt.toISOString()}`);
    out(`  invoice        ${inv?.id} (${inv?.status}) total=${inv?.totalAmount}`);
    out(`  tarefa         ${inv?.task?.name} | série=${inv?.task?.serialNumber ?? '-'} | ${inv?.task?.id}`);
    out(`  cliente        ${inv?.customer?.corporateName ?? inv?.customer?.fantasyName} CNPJ=${inv?.customer?.cnpj}`);
    for (const inst of inv?.installments ?? []) {
      out(
        `  parcela #${inst.number}   ${inst.status}  venc=${inst.dueDate.toISOString().slice(0, 10)}  ` +
          `valor=${inst.amount}  boleto=${inst.bankSlip?.nossoNumero ?? '(nenhum)'} (${inst.bankSlip?.status ?? '-'})`,
      );
    }

    // Look a day either side of the emission attempt — enough to catch a note the
    // prefeitura timestamped slightly off from our clock.
    const from = new Date(doc.createdAt.getTime() - 24 * 60 * 60 * 1000);
    const to = new Date(doc.createdAt.getTime() + 24 * 60 * 60 * 1000);
    const cnpj = inv?.customer?.cnpj ?? null;

    out('');
    out('══════════════════ ESTADO NO ELOTECH ══════════════════');
    out(`  consultando ${ymd(from)} … ${ymd(to)}  cpfCnpj=${cnpj ?? '(todos)'}`);

    const byCnpj = await elotech.listNfses({
      dataEmissaoInicial: ymd(from),
      dataEmissaoFinal: ymd(to),
      cpfCnpj: cnpj,
      maxResult: 50,
    });
    out(`  notas para este CNPJ na janela: ${byCnpj.totalDocumentos}`);
    for (const n of byCnpj.data) {
      out(
        `    id=${n.id ?? n.idNotaFiscal ?? '?'}  nº=${n.numeroDocumento ?? n.numero ?? '?'}  ` +
          `emissão=${n.dataEmissao ?? '?'}  valor=${n.valorTotal ?? n.valorLiquido ?? '?'}  ` +
          `situação=${n.situacao ?? n.descricaoSituacao ?? '?'}  tomador=${n.razaoSocialTomador ?? n.razaoSocial ?? '?'}`,
      );
    }

    // Same window without the CNPJ filter — the payload's tomador razão social did not
    // match the customer record, so a note may be filed under a different document.
    const allInWindow = await elotech.listNfses({
      dataEmissaoInicial: ymd(doc.createdAt),
      dataEmissaoFinal: ymd(doc.createdAt),
      maxResult: 50,
    });
    out('');
    out(`  todas as notas emitidas em ${ymd(doc.createdAt)}: ${allInWindow.totalDocumentos}`);
    for (const n of allInWindow.data) {
      out(
        `    id=${n.id ?? n.idNotaFiscal ?? '?'}  nº=${n.numeroDocumento ?? n.numero ?? '?'}  ` +
          `emissão=${n.dataEmissao ?? '?'}  valor=${n.valorTotal ?? n.valorLiquido ?? '?'}  ` +
          `situação=${n.situacao ?? n.descricaoSituacao ?? '?'}  tomador=${n.razaoSocialTomador ?? n.razaoSocial ?? '?'}`,
      );
    }

    // The LIST carries the value (`valorServico` / `valorLiquidoNota`); `getNfseDetail`
    // returns a different, nested shape (formTomador/formDadosNFSe/formImposto/formTotal)
    // whose top level has no `valorTotal`. Reading the detail's absent field yields NaN,
    // which silently reads as "no match" — i.e. "safe to re-emit" — and would mint a
    // DUPLICATE live municipal note. Match on the list fields, and treat anything
    // unreadable as INCONCLUSIVE, never as "nothing was emitted".
    const seen = new Map<number, any>();
    for (const n of [...byCnpj.data, ...allInWindow.data]) {
      const id = Number(n.id ?? n.idNotaFiscal ?? n.notaFiscalId);
      if (Number.isFinite(id) && id > 0 && !seen.has(id)) seen.set(id, n);
    }

    out('');
    out('══════════════════ NOTAS NA JANELA (campos da listagem) ══════════════════');
    const target = Number(inv?.totalAmount ?? 0);
    const matches: any[] = [];
    let unreadable = 0;

    // Which Elotech ids are already claimed by another local document?
    // elotechNfseId / nfseNumber are INTEGER columns — passing strings makes Prisma throw.
    const linked = await prisma.nfseDocument.findMany({
      where: { elotechNfseId: { in: [...seen.keys()] } },
      select: { id: true, elotechNfseId: true, invoiceId: true, status: true },
    });
    const linkedById = new Map(linked.map(l => [Number(l.elotechNfseId), l]));

    for (const [id, n] of seen) {
      const valor = Number(n.valorLiquidoNota ?? n.valorServico ?? NaN);
      const numero = n.numeroNotaFiscal ?? '?';
      const claim = linkedById.get(id);
      out(
        `  id=${id}  nº=${numero}  valor=${Number.isFinite(valor) ? valor.toFixed(2) : '?'}  ` +
          `situação=${n.situacaoDescricao ?? n.descricaoSituacao ?? '?'}  ` +
          `cancelada=${n.cancelada}  digitação=${n.dataDigitacao ?? '?'}  ` +
          `tomador=${n.tomadorRazaoNome ?? '?'}  ` +
          `→ ${claim ? `JÁ VINCULADA ao doc ${claim.id} (fatura ${claim.invoiceId}, ${claim.status})` : 'SEM vínculo local'}`,
      );
      if (!Number.isFinite(valor)) unreadable++;
      else if (Math.abs(valor - target) < 0.01 && !claim) matches.push({ ...n, id, valor, numero });
    }

    out('');
    out('══════════════════ VEREDICTO ══════════════════');
    out(`  valor procurado: R$ ${target.toFixed(2)}`);
    if (unreadable > 0) {
      out(`  ATENÇÃO: ${unreadable} nota(s) sem valor legível — veredicto INCONCLUSIVO.`);
    } else if (matches.length === 0) {
      out(`  Nenhuma das ${seen.size} nota(s) do dia bate com o valor E está sem vínculo.`);
      out('  → nada foi emitido para esta fatura: reemitir é seguro.');
    } else if (matches.length === 1) {
      const m = matches[0];
      out(`  A nota JÁ ESTÁ VIVA e sem vínculo local:`);
      out(`    elotechNfseId=${m.id}  nº=${m.numero}  emitida=${m.emitida}  cancelada=${m.cancelada}`);
      out('  → VINCULAR (não reemitir). Correção sugerida:');
      out(
        `    UPDATE "NfseDocument" SET "elotechNfseId"=${m.id}, "nfseNumber"=${m.numero}, ` +
          `status='AUTHORIZED', "errorMessage"=NULL, "errorCount"=0 WHERE id='${doc.id}';`,
      );
    } else {
      out(`  ${matches.length} notas sem vínculo batem com o valor — AMBÍGUO, decidir manualmente:`);
      for (const m of matches) out(`    id=${m.id}  nº=${m.numero}  digitação=${m.dataDigitacao}`);
    }
  } finally {
    await app.close();
  }
}

main().catch(error => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
