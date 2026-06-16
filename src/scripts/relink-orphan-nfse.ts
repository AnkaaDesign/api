/**
 * Reconcile ORPHAN Elotech notes (active or cancelled at the prefeitura but with NO local
 * NfseDocument) back to their task quotes, so the task quote page shows the full NFS-e
 * history. Matching is by the serial number ("n série: NNNNN") and order number ("Pedido:")
 * embedded in the note's discriminação, cross-checked against Task.serialNumber and value.
 *
 * DRY-RUN by default. Pass --apply to create the linking NfseDocument rows.
 *
 * Run: NODE_ENV=production npx ts-node -r tsconfig-paths/register src/scripts/relink-orphan-nfse.ts [--apply]
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import axios from 'axios';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { ElotechOxyAuthService } from '../modules/integrations/nfse/elotech-oxy-auth.service';
import { ElotechOxyNfseService } from '../modules/integrations/nfse/elotech-oxy-nfse.service';

const RANGE_START = 2900;
const RANGE_END = 3130;
const APPLY = process.argv.includes('--apply');

function parseSerial(discriminacao: string): string | null {
  const m = discriminacao.match(/n[º°]?\s*s[ée]rie:\s*([0-9A-Za-z\-]+)/i);
  return m ? m[1].trim() : null;
}
function parseOrder(discriminacao: string): string | null {
  const m = discriminacao.match(/Pedido:\s*(?:PEDIDO\s*NR\s*)?([0-9]+)/i);
  return m ? m[1].trim() : null;
}

async function main(): Promise<void> {
  const logger = new Logger('RelinkOrphanNfse');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const auth = app.get(ElotechOxyAuthService);
    const nfse = app.get(ElotechOxyNfseService);

    await auth.getToken();
    const baseUrl = auth.baseUrl;
    const headers = { ...auth.getAuthHeaders(), active_view: '/consulta-documentos-fiscais' };
    const contribuinteId = Number(auth.getEmpresaId());

    // 1) All Elotech notes in range
    const payload = {
      tipoServico: 'PRESTADOS',
      homologacao: 'N',
      apenasAtividadesDoCadastro: 'false',
      intermediario: 'false',
      cnae: '',
      situacao: null,
      numeroDocumentoInicial: RANGE_START,
      numeroDocumentoFinal: RANGE_END,
      firstResult: 0,
      maxResult: 500,
      contribuinteId,
      notasSelecionadas: [],
    };
    const elotechNotes: any[] =
      (await axios.post(`${baseUrl}/consultar-documentos-fiscais/consultar`, payload, { headers }))
        .data?.data || [];
    logger.log(`Elotech notes in ${RANGE_START}-${RANGE_END}: ${elotechNotes.length}`);

    // 2) Our existing elotech ids
    const ourDocs = await prisma.nfseDocument.findMany({
      where: { elotechNfseId: { not: null } },
      select: { elotechNfseId: true },
    });
    const ourIds = new Set(ourDocs.map(d => d.elotechNfseId));

    const orphans = elotechNotes.filter(n => !ourIds.has(n.id));
    logger.log(`Orphans (no local record): ${orphans.length}`);

    const linked: string[] = [];
    const ambiguousOrUnmatched: string[] = [];

    for (const note of orphans) {
      let discriminacao = '';
      let total = note.valorDoc ?? null;
      try {
        const detail = await nfse.getNfseDetail(note.id);
        discriminacao = detail?.formDadosNFSe?.discriminacaoServico || '';
        total = detail?.formTotal?.totalNfse ?? total;
      } catch {
        /* keep going with list data */
      }
      const serial = parseSerial(discriminacao);
      const order = parseOrder(discriminacao);

      // Match strategy: serial -> Task.serialNumber (unique). Fallback: order number.
      let task:
        | { id: string; serialNumber: string | null; name: string; customer: { cnpj: string | null; cpf: string | null } | null }
        | null = null;
      if (serial) {
        task = await prisma.task.findUnique({
          where: { serialNumber: serial },
          select: {
            id: true,
            serialNumber: true,
            name: true,
            customer: { select: { cnpj: true, cpf: true } },
          },
        });
      }

      const label = `NF ${note.numeroNotaFiscal} (id ${note.id}, ${
        note.cancelada ? 'CANCELADA' : 'EMITIDA'
      }, R$${total}, tomador=${(note.tomadorRazaoNome || '').slice(0, 22)})`;

      if (!task) {
        ambiguousOrUnmatched.push(
          `${label} serie=${serial ?? '—'} pedido=${order ?? '—'} → no matching task`,
        );
        continue;
      }

      // Guard against test notes: the note's tomador must be the task's customer. Test notes
      // (emitted to Kennedy's CNPJ but carrying a real task's série) would otherwise pollute a
      // real task's history. Require a CNPJ/CPF digit match.
      const noteDoc = String(note.tomadorCnpjCpf || '').replace(/\D/g, '');

      // Kennedy's own CNPJ is only ever used for test emissions — never a real customer note.
      const KENNEDY_CNPJ = '53842320000155';
      if (noteDoc === KENNEDY_CNPJ) {
        ambiguousOrUnmatched.push(`${label} serie=${serial} → tomador é Kennedy (nota de teste), SKIPPED`);
        continue;
      }
      const taskDocs = [task.customer?.cnpj, task.customer?.cpf]
        .map(d => String(d || '').replace(/\D/g, ''))
        .filter(Boolean);
      if (noteDoc && taskDocs.length > 0 && !taskDocs.includes(noteDoc)) {
        ambiguousOrUnmatched.push(
          `${label} serie=${serial} → task ${task.name} but TOMADOR MISMATCH (note ${noteDoc} ≠ task ${taskDocs.join('/')}) — likely a test note, SKIPPED`,
        );
        continue;
      }

      const status = note.cancelada ? 'CANCELLED' : 'AUTHORIZED';
      logger.log(
        `MATCH ${label} serie=${serial} → task ${task.name} (${task.id}) ⇒ link as ${status}`,
      );
      linked.push(`NF ${note.numeroNotaFiscal} → task ${task.serialNumber} (${task.name}) [${status}]`);

      if (APPLY) {
        // Avoid duplicate link if a row for this elotechNfseId already exists
        const exists = await prisma.nfseDocument.findFirst({
          where: { elotechNfseId: note.id },
          select: { id: true },
        });
        if (exists) continue;
        await prisma.nfseDocument.create({
          data: {
            taskId: task.id,
            invoiceId: null,
            elotechNfseId: note.id,
            nfseNumber: note.numeroNotaFiscal,
            status,
            // No errorMessage: invoiceId=null already marks it as a re-linked orphan; a note
            // here would surface as noise in the task NFS-e section.
            ...(note.cancelada ? { cancelResolvedAt: new Date(), cancelRequestStatus: 'AUTORIZADO' } : {}),
          },
        });
      }
    }

    logger.log(`\n=== SUMMARY (${APPLY ? 'APPLIED' : 'DRY-RUN'}) ===`);
    logger.log(`Matched & ${APPLY ? 'linked' : 'would link'}: ${linked.length}`);
    linked.forEach(l => logger.log(`  ✓ ${l}`));
    logger.log(`\nUnmatched orphans: ${ambiguousOrUnmatched.length}`);
    ambiguousOrUnmatched.forEach(l => logger.log(`  · ${l}`));
  } finally {
    await app.close();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
