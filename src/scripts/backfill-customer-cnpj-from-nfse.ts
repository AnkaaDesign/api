/**
 * backfill-customer-cnpj-from-nfse.ts
 * Bootstraps the receivable matcher's strongest signal: populates Customer.cnpj /
 * Customer.cpf from the destinatário document on the SAIDA NFS-e WE issued to
 * them (FiscalDocument.destCnpj → NfseDocument → Invoice → Customer). That is, by
 * definition, the customer's own document. Only fills EMPTY slots, only when a
 * customer maps to a SINGLE distinct document, and never collides with a
 * document another customer already owns (Customer.cnpj/cpf are @unique).
 *
 * Dry-run by default; pass --apply to write.
 *   npx tsx -r tsconfig-paths/register src/scripts/backfill-customer-cnpj-from-nfse.ts
 *   npx tsx -r tsconfig-paths/register src/scripts/backfill-customer-cnpj-from-nfse.ts --apply
 */

import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const digits = (v: string | null | undefined): string => (v || '').replace(/\D/g, '');

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const L = (s: string) => process.stdout.write(s + '\n');
  try {
    // destCnpj per customer from the NFS-e issued to them.
    const docs = await prisma.fiscalDocument.findMany({
      where: { operationType: 'SAIDA', destCnpj: { not: null }, nfseDocumentId: { not: null } },
      select: {
        destCnpj: true,
        destCpf: true,
        nfseDocument: { select: { invoice: { select: { customerId: true } } } },
      },
    });

    // customerId → set of distinct documents seen on their NFs.
    const byCustomer = new Map<string, Set<string>>();
    for (const d of docs) {
      const customerId = d.nfseDocument?.invoice?.customerId;
      if (!customerId) continue;
      const doc = digits(d.destCnpj) || digits(d.destCpf);
      if (doc.length !== 14 && doc.length !== 11) continue;
      if (!byCustomer.has(customerId)) byCustomer.set(customerId, new Set());
      byCustomer.get(customerId)!.add(doc);
    }

    const customers = await prisma.customer.findMany({
      where: { id: { in: [...byCustomer.keys()] } },
      select: { id: true, fantasyName: true, cnpj: true, cpf: true },
    });
    const custById = new Map(customers.map(c => [c.id, c]));

    // Pre-load all documents already owned, to avoid @unique collisions.
    const owned = new Set<string>();
    for (const c of await prisma.customer.findMany({ select: { cnpj: true, cpf: true } })) {
      if (c.cnpj) owned.add(digits(c.cnpj));
      if (c.cpf) owned.add(digits(c.cpf));
    }

    let planned = 0;
    let skippedHasDoc = 0;
    let skippedAmbiguous = 0;
    let skippedCollision = 0;

    for (const [customerId, docSet] of byCustomer) {
      const cust = custById.get(customerId);
      if (!cust) continue;
      if (cust.cnpj || cust.cpf) {
        skippedHasDoc += 1;
        continue;
      }
      if (docSet.size !== 1) {
        skippedAmbiguous += 1;
        continue;
      }
      const doc = [...docSet][0];
      if (owned.has(doc)) {
        skippedCollision += 1;
        continue;
      }
      const field = doc.length === 14 ? 'cnpj' : 'cpf';
      planned += 1;
      owned.add(doc); // reserve so two customers in this run can't both claim it
      L(`${APPLY ? 'SET ' : 'PLAN'} ${field}=${doc}  ${cust.fantasyName} (${customerId})`);
      if (APPLY) {
        await prisma.customer
          .update({ where: { id: customerId }, data: { [field]: doc } })
          .catch(err => L(`  ! failed: ${err}`));
      }
    }

    L('------------------------------------------------------------');
    L(`${APPLY ? 'APPLIED' : 'DRY-RUN'}: ${planned} customer(s) ${APPLY ? 'updated' : 'would be updated'}`);
    L(`skipped: ${skippedHasDoc} already-have-doc, ${skippedAmbiguous} ambiguous(multi-doc), ${skippedCollision} unique-collision`);
    if (!APPLY) L('Re-run with --apply to write.');
  } catch (err) {
    process.stderr.write(`Backfill failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
