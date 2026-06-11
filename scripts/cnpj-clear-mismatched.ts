/**
 * CNPJ mismatch cleanup
 *
 * For every customer flagged as WRONG_CNPJ_HIGH / WRONG_CNPJ_REVIEW /
 * CNPJ_BELONGS_TO_OTHER in the reconciliation report, this script:
 *
 *   1. Checks whether the customer already has any NfseDocument in OUR
 *      system (any status — PENDING, PROCESSING, AUTHORIZED, CANCELLED, ERROR).
 *   2. If YES  → skip (the wrong CNPJ is already baked into issued / queued NFs).
 *   3. If NO   → null the customer.cnpj so we don't accidentally emit future
 *      NFS-e to the wrong CNPJ.  The correct CNPJ must be researched and
 *      entered manually afterwards.
 *
 * Run modes:
 *   pnpm tsx scripts/cnpj-clear-mismatched.ts          → report only (dry-run)
 *   pnpm tsx scripts/cnpj-clear-mismatched.ts --apply  → apply the CNPJ nulls
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ──────────────────────────────────────────────────────────────────────────────
// Flagged customers from cnpj-reconciliation.json
// (WRONG_CNPJ_HIGH + WRONG_CNPJ_REVIEW + CNPJ_BELONGS_TO_OTHER)
// ──────────────────────────────────────────────────────────────────────────────
const FLAGGED = [
  // ── WRONG_CNPJ_HIGH ────────────────────────────────────────────────────────
  {
    id: '4d29bb05-b6ac-42fd-a066-5dd47b60bc07',
    fantasyName: 'Grc Frutas',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '06296907000126',
  },
  {
    id: '1661516a-14a5-4594-858f-81bfc53f5af4',
    fantasyName: 'Mammut',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '00146306000150',
  },
  {
    id: 'fc669c34-bd71-490d-a060-586b71fda383',
    fantasyName: 'Bellaver Frutas e Transporte LTDA',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '41740170000190',
  },
  {
    id: 'ea9e3f35-a42c-444f-8c63-5ba3c1f437f1',
    fantasyName: 'Frutas União',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '03616588000109',
  },
  {
    id: '9c08eeeb-bccc-4a54-a026-e7e27da70959',
    fantasyName: 'Mark Frutas',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '08436822000121',
  },
  {
    id: 'b0d6c3a1-eb55-4c92-b5d9-0ee8c6e122ab',
    fantasyName: 'Cerqueira',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '02247880000120',
  },
  {
    id: '31f8d6d8-764f-4efc-8c51-902237c672bc',
    fantasyName: 'Sem Limite',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '00483692000176',
  },
  {
    id: '930b3e87-8381-4509-af55-1da660e370ca',
    fantasyName: 'Distribuidora Chapada de Alimentos',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '13772084000123',
  },
  {
    id: 'bdba1b11-66aa-4726-aedd-f6f030df7e3e',
    fantasyName: 'Maranata',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '14160653000142',
  },
  {
    id: '0195d624-3b0c-47f1-a71a-98296e8801c3',
    fantasyName: 'Frut Frios',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '09110388000158',
  },
  {
    id: '83190163-ff88-4b33-89f5-aa68eb9f301b',
    fantasyName: 'Gazzoni',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '06986900000136',
  },
  {
    id: '2a7b7ae5-a136-47b6-9e39-6fb55bdfafd2',
    fantasyName: 'Laticíonios Veneza',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '08385677000105',
  },
  {
    id: 'ac4fec38-0b6f-432f-8e99-8fc41861062b',
    fantasyName: 'Lubriporto',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '17510137000199',
  },
  {
    id: '85f5d3e7-286d-4d58-9af1-e1288e37e67a',
    fantasyName: 'Pasqualotto Supermercado',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '10478007000177',
  },
  {
    id: '05fca131-dbea-4240-bc9c-561015dd90ba',
    fantasyName: 'Percicoti',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '07131982000108',
  },
  {
    id: 'ec1a5626-daa7-44f3-acca-fe67c8c8ccfe',
    fantasyName: 'Santomé',
    kind: 'WRONG_CNPJ_HIGH',
    storedCnpj: '57612731000105',
  },

  // ── WRONG_CNPJ_REVIEW ──────────────────────────────────────────────────────
  {
    id: '5f41735f-0313-490e-b91d-5d2db9e01d11',
    fantasyName: 'Terra Verde',
    kind: 'WRONG_CNPJ_REVIEW',
    storedCnpj: '30880916000144',
  },
  {
    id: 'fd970dd5-c23a-459b-b1a6-098a74e23661',
    fantasyName: 'Frigorifico do Sul',
    kind: 'WRONG_CNPJ_REVIEW',
    storedCnpj: '02591772000170',
  },
  {
    id: '9f2d6327-5d6c-4c2a-a006-5242ca7a28ad',
    fantasyName: 'Giro Certo',
    kind: 'WRONG_CNPJ_REVIEW',
    storedCnpj: '03083948000146',
  },
  {
    id: '0c111d76-6c4d-4532-89d0-6f0561e19d23',
    fantasyName: 'Perboni',
    kind: 'WRONG_CNPJ_REVIEW',
    storedCnpj: '14456704000188',
  },
  {
    id: '42233bb8-1930-47f8-aeff-5eef4ca44582',
    fantasyName: 'Red Beef',
    kind: 'WRONG_CNPJ_REVIEW',
    storedCnpj: '30269671000113',
  },

  // ── CNPJ_BELONGS_TO_OTHER ──────────────────────────────────────────────────
  {
    id: 'e2d292b2-c6bd-4b51-86f0-0207a4faf299',
    fantasyName: 'Mar e Rio',
    kind: 'CNPJ_BELONGS_TO_OTHER',
    storedCnpj: '07859054000156',
  },
  {
    id: '8fdc7f79-14b0-4fae-bcbf-f2cb2471f627',
    fantasyName: 'Frigorifico Bismark',
    kind: 'CNPJ_BELONGS_TO_OTHER',
    storedCnpj: '14434266000157',
  },
] as const;

type Row = {
  id: string;
  fantasyName: string;
  kind: string;
  storedCnpj: string;
};

function fmt(cnpj: string): string {
  // digits only → ##.###.###/####-##  (or ###.###.###-## for CPF 11 digits)
  const d = cnpj.replace(/\D/g, '');
  if (d.length === 14)
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (d.length === 11)
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return cnpj;
}

async function main() {
  const APPLY = process.argv.includes('--apply');

  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' CNPJ Mismatch — NFS-e Safety Cleanup');
  console.log(` Mode: ${APPLY ? '🔴 APPLY (will null CNPJs)' : '🟡 DRY-RUN (report only)'}`);
  console.log('══════════════════════════════════════════════════════════════');
  console.log('');

  // ── 1. Load live CNPJ from DB (may differ from snapshot) ─────────────────
  const dbCustomers = await prisma.customer.findMany({
    where: { id: { in: FLAGGED.map((f) => f.id) } },
    select: { id: true, fantasyName: true, cnpj: true },
  });
  const dbById = new Map(dbCustomers.map((c) => [c.id, c]));

  // ── 2. Check NfseDocument existence per customer ───────────────────────────
  //   Customer → Invoice → NfseDocument  (any status)
  const nfseRows = await prisma.nfseDocument.findMany({
    where: {
      invoice: {
        customerId: { in: FLAGGED.map((f) => f.id) },
      },
    },
    select: {
      id: true,
      status: true,
      nfseNumber: true,
      elotechNfseId: true,
      invoice: { select: { customerId: true } },
    },
  });

  // Group by customerId
  const nfseByCustomer = new Map<string, typeof nfseRows>();
  for (const nf of nfseRows) {
    const cid = nf.invoice.customerId;
    if (!nfseByCustomer.has(cid)) nfseByCustomer.set(cid, []);
    nfseByCustomer.get(cid)!.push(nf);
  }

  // ── 3. Classify ───────────────────────────────────────────────────────────
  const toSkip: Array<Row & { nfses: typeof nfseRows }> = [];
  const toClear: Array<Row & { currentCnpjInDb: string | null }> = [];
  const notInDb: Row[] = [];

  for (const row of FLAGGED) {
    const dbRec = dbById.get(row.id);
    if (!dbRec) {
      notInDb.push(row);
      continue;
    }
    const nfses = nfseByCustomer.get(row.id) ?? [];
    if (nfses.length > 0) {
      toSkip.push({ ...row, nfses });
    } else {
      toClear.push({ ...row, currentCnpjInDb: dbRec.cnpj });
    }
  }

  // ── 4. Print report ───────────────────────────────────────────────────────
  console.log('┌─────────────────────────────────────────────────────────────');
  console.log('│ SKIP — have NFS-e in our system (do NOT touch)');
  console.log('└─────────────────────────────────────────────────────────────');
  if (toSkip.length === 0) {
    console.log('  (none)\n');
  } else {
    for (const c of toSkip) {
      const statusSummary = [...new Set(c.nfses.map((n) => n.status))].join(', ');
      const authorized = c.nfses.filter((n) => n.status === 'AUTHORIZED').length;
      console.log(
        `  ⛔  ${c.fantasyName.padEnd(35)} [${c.kind}]`,
      );
      console.log(
        `       CNPJ: ${fmt(c.storedCnpj)}  |  NFS-e count: ${c.nfses.length}  (${authorized} authorized, statuses: ${statusSummary})`,
      );
    }
    console.log('');
  }

  console.log('┌─────────────────────────────────────────────────────────────');
  console.log('│ CLEAR — no NFS-e in our system → CNPJ will be nulled');
  console.log('└─────────────────────────────────────────────────────────────');
  if (toClear.length === 0) {
    console.log('  (none)\n');
  } else {
    for (const c of toClear) {
      const liveTag =
        c.currentCnpjInDb !== c.storedCnpj
          ? `  ⚠ DB has different value: ${c.currentCnpjInDb ?? 'NULL'}`
          : '';
      console.log(
        `  ✔  ${c.fantasyName.padEnd(35)} [${c.kind}]`,
      );
      console.log(
        `       CNPJ to null: ${fmt(c.storedCnpj)}${liveTag}`,
      );
    }
    console.log('');
  }

  if (notInDb.length > 0) {
    console.log('┌─────────────────────────────────────────────────────────────');
    console.log('│ NOT FOUND in DB (customer may have been deleted)');
    console.log('└─────────────────────────────────────────────────────────────');
    for (const c of notInDb) {
      console.log(`  ?  ${c.fantasyName}  (id: ${c.id})`);
    }
    console.log('');
  }

  console.log('──────────────────────────────────────────────────────────────');
  console.log(` Summary: ${FLAGGED.length} flagged → ${toSkip.length} skip | ${toClear.length} to clear | ${notInDb.length} not found`);
  console.log('──────────────────────────────────────────────────────────────');
  console.log('');

  // ── 5. Apply if requested ─────────────────────────────────────────────────
  if (!APPLY) {
    console.log('Run with --apply to null the CNPJs listed above.');
    console.log('');
    return;
  }

  if (toClear.length === 0) {
    console.log('Nothing to clear. Exiting.');
    return;
  }

  console.log('Applying...');
  let ok = 0;
  let fail = 0;

  for (const c of toClear) {
    try {
      await prisma.customer.update({
        where: { id: c.id },
        data: { cnpj: null },
      });
      console.log(`  ✔  Cleared CNPJ for "${c.fantasyName}" (${fmt(c.storedCnpj)})`);
      ok++;
    } catch (err: any) {
      console.error(`  ✖  Failed for "${c.fantasyName}": ${err.message}`);
      fail++;
    }
  }

  console.log('');
  console.log(`Done. ${ok} cleared, ${fail} failed.`);
}

main().finally(() => prisma.$disconnect());
