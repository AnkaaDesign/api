/**
 * Smart reconciliation for billed invoices that have NO NfseDocument. For each, try to find the
 * matching note at Elotech (an "orphan" with no local record) using multiple signals:
 *   1) série     — Task.serialNumber vs "n série: NNNNN" in the discriminação   (HIGH)
 *   2) pedido    — customerConfig.orderNumber vs "Pedido: NNNNN"                 (HIGH)
 *   3) value+tomador+date — gross value + tomador CNPJ + emission within ±35d    (MEDIUM, unique only)
 * Outputs the split: how many already have a note at Elotech (→ relink) vs genuinely need an NF
 * emitted, plus ambiguous cases. DRY-RUN by default; --apply creates the linking NfseDocument rows.
 *
 * Run: NODE_ENV=production npx ts-node -r tsconfig-paths/register src/scripts/reconcile-missing-nfse.ts [--apply]
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import axios from 'axios';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { ElotechOxyAuthService } from '../modules/integrations/nfse/elotech-oxy-auth.service';
import { ElotechOxyNfseService } from '../modules/integrations/nfse/elotech-oxy-nfse.service';

const RANGE_START = 2850;
const RANGE_END = 3140;
const KENNEDY_CNPJ = '53842320000155';
const DATE_WINDOW_DAYS = 35;
const APPLY = process.argv.includes('--apply');

const digits = (s: any) => String(s ?? '').replace(/\D/g, '');
const parseSerial = (d: string) => (d.match(/n[º°]?\s*s[ée]rie:\s*([0-9A-Za-z\-]+)/i) || [])[1] || null;
const parsePedido = (d: string) => (d.match(/Pedido:\s*(?:PEDIDO\s*NR\s*)?([0-9]+)/i) || [])[1] || null;
const round2 = (n: number) => Math.round(n * 100) / 100;
const daysBetween = (a: string, b: string) =>
  Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

async function main(): Promise<void> {
  const logger = new Logger('ReconcileMissingNfse');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });

  try {
    const prisma = app.get(PrismaService);
    const auth = app.get(ElotechOxyAuthService);
    const nfse = app.get(ElotechOxyNfseService);

    // ── 1) Billed invoices with NO NfseDocument (by invoiceId) ─────────────────
    const invoices = await prisma.invoice.findMany({
      where: {
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        taskId: { not: null },
        nfseDocuments: { none: {} },
      },
      select: {
        id: true,
        customerId: true,
        totalAmount: true,
        createdAt: true,
        customer: { select: { cnpj: true, cpf: true, fantasyName: true } },
        customerConfig: { select: { orderNumber: true } },
        task: {
          select: {
            id: true,
            serialNumber: true,
            name: true,
            finishedAt: true,
            quote: { select: { services: { select: { amount: true, invoiceToCustomerId: true } } } },
          },
        },
      },
    });
    logger.log(`Billed invoices missing an NfseDocument: ${invoices.length}`);

    // ── 2) Orphan Elotech notes (no local record) + their details ──────────────
    await auth.getToken();
    const baseUrl = auth.baseUrl;
    const headers = { ...auth.getAuthHeaders(), active_view: '/consulta-documentos-fiscais' };
    const listPayload = {
      tipoServico: 'PRESTADOS', homologacao: 'N', apenasAtividadesDoCadastro: 'false',
      intermediario: 'false', cnae: '', situacao: null,
      numeroDocumentoInicial: RANGE_START, numeroDocumentoFinal: RANGE_END,
      firstResult: 0, maxResult: 600, contribuinteId: Number(auth.getEmpresaId()), notasSelecionadas: [],
    };
    const allNotes: any[] =
      (await axios.post(`${baseUrl}/consultar-documentos-fiscais/consultar`, listPayload, { headers }))
        .data?.data || [];
    const ourIds = new Set(
      (await prisma.nfseDocument.findMany({ where: { elotechNfseId: { not: null } }, select: { elotechNfseId: true } }))
        .map(d => d.elotechNfseId),
    );
    const orphanNotes = allNotes.filter(n => !ourIds.has(n.id) && digits(n.tomadorCnpjCpf) !== KENNEDY_CNPJ);
    logger.log(`Orphan Elotech notes to index: ${orphanNotes.length} (fetching details…)`);

    const orphans: Array<{
      id: number; numero: number; cancelada: boolean; valor: number; data: string;
      tomador: string; tomadorNome: string; serie: string | null; pedido: string | null; usedBy?: string;
    }> = [];
    for (const n of orphanNotes) {
      let disc = '';
      try {
        const d = await nfse.getNfseDetail(n.id);
        disc = d?.formDadosNFSe?.discriminacaoServico || '';
      } catch { /* fall back to list fields */ }
      orphans.push({
        id: n.id, numero: n.numeroNotaFiscal, cancelada: !!n.cancelada,
        valor: round2(Number(n.valorDoc ?? 0)), data: n.dataEmissao,
        tomador: digits(n.tomadorCnpjCpf), tomadorNome: n.tomadorRazaoNome || '',
        serie: parseSerial(disc), pedido: parsePedido(disc),
      });
    }

    // ── 3) Match each invoice ──────────────────────────────────────────────────
    const found: string[] = [];
    const needEmit: string[] = [];
    const ambiguous: string[] = [];
    const links: Array<{ invoiceId: string; taskId: string; orphan: (typeof orphans)[0]; tier: string }> = [];

    for (const inv of invoices) {
      const t = inv.task!;
      const custDocs = [digits(inv.customer?.cnpj), digits(inv.customer?.cpf)].filter(Boolean);
      const order = digits(inv.customerConfig?.orderNumber);
      const services = t.quote?.services ?? [];
      const gross = round2(
        services
          .filter(s => !s.invoiceToCustomerId || s.invoiceToCustomerId === inv.customerId)
          .reduce((sum, s) => sum + Number(s.amount), 0),
      );
      const refDate = (t.finishedAt ?? inv.createdAt).toISOString();
      const label = `${t.serialNumber ?? '—'} ${t.name} (cliente ${inv.customer?.fantasyName ?? '?'}, R$${gross})`;

      const avail = orphans.filter(o => !o.usedBy);
      // tomador must match when we know it
      const tomadorOk = (o: (typeof orphans)[0]) =>
        custDocs.length === 0 || custDocs.includes(o.tomador) || o.tomador === '';

      let cand = avail.filter(o => t.serialNumber && o.serie === t.serialNumber && tomadorOk(o));
      let tier = 'HIGH/série';
      if (cand.length === 0 && order) {
        cand = avail.filter(o => o.pedido && digits(o.pedido) === order && tomadorOk(o));
        tier = 'HIGH/pedido';
      }
      if (cand.length === 0 && gross > 0) {
        // Value + date. When we know the customer CNPJ, require it to match (strong). When we
        // don't (49/55 customers have no CNPJ in our DB), fall back to exact gross + tight date
        // window + a shared name token, and only accept a UNIQUE candidate.
        const nameTokens = (inv.customer?.fantasyName ?? '')
          .toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
        cand = avail.filter(o => {
          if (Math.abs(o.valor - gross) > 0.01) return false;
          if (daysBetween(o.data, refDate) > DATE_WINDOW_DAYS) return false;
          if (custDocs.length > 0) return custDocs.includes(o.tomador);
          // no CNPJ on file → soft name check against the note's tomador
          return false; // tomador name not indexed on orphan list here; handled below
        });
        tier = custDocs.length ? 'MEDIUM/valor+cnpj+data' : 'LOW/valor+data';
        // For CNPJ-less customers, also try value+date+name-token via the note tomador name.
        if (cand.length === 0 && custDocs.length === 0 && nameTokens.length > 0) {
          cand = avail.filter(
            o =>
              Math.abs(o.valor - gross) <= 0.01 &&
              daysBetween(o.data, refDate) <= DATE_WINDOW_DAYS &&
              nameTokens.some(tok => (o.tomadorNome || '').toLowerCase().includes(tok)),
          );
          tier = 'LOW/valor+data+nome';
        }
      }

      if (cand.length === 1) {
        const o = cand[0];
        o.usedBy = inv.id;
        links.push({ invoiceId: inv.id, taskId: t.id, orphan: o, tier });
        found.push(`${label} → NF ${o.numero} (${o.cancelada ? 'CANCELADA' : 'EMITIDA'}) [${tier}]`);
      } else if (cand.length > 1) {
        ambiguous.push(`${label} → ${cand.length} candidatos: ${cand.map(c => c.numero).join(', ')} [${tier}]`);
      } else {
        needEmit.push(label);
      }
    }

    // ── 4) Report ──────────────────────────────────────────────────────────────
    logger.log(`\n================ RESULT (${APPLY ? 'APPLIED' : 'DRY-RUN'}) ================`);
    logger.log(`FOUND at Elotech (relink): ${found.length}`);
    found.forEach(l => logger.log(`  ✓ ${l}`));
    logger.log(`\nAMBIGUOUS (manual check): ${ambiguous.length}`);
    ambiguous.forEach(l => logger.log(`  ? ${l}`));
    logger.log(`\nNO note at Elotech → NEEDS EMISSION: ${needEmit.length}`);
    needEmit.forEach(l => logger.log(`  ✗ ${l}`));

    if (APPLY) {
      let created = 0;
      for (const lk of links) {
        const exists = await prisma.nfseDocument.findFirst({ where: { elotechNfseId: lk.orphan.id }, select: { id: true } });
        if (exists) continue;
        await prisma.nfseDocument.create({
          data: {
            invoiceId: lk.invoiceId,
            taskId: lk.taskId,
            elotechNfseId: lk.orphan.id,
            nfseNumber: lk.orphan.numero,
            status: lk.orphan.cancelada ? 'CANCELLED' : 'AUTHORIZED',
            ...(lk.orphan.cancelada ? { cancelResolvedAt: new Date(), cancelRequestStatus: 'AUTORIZADO' } : {}),
          },
        });
        created++;
      }
      logger.log(`\nApplied: created ${created} NfseDocument link(s).`);
    }
  } finally {
    await app.close();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
