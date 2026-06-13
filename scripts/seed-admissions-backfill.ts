/**
 * Seed: Admission backfill for every existing employment contract (vínculo).
 *
 * After the EmploymentContract migration each user has one or more contracts but
 * most have NO Admission workflow row. This creates a COMPLETED Admission for every
 * CLT contract that lacks one, so the Admissões list is populated with history.
 *
 * What it does (idempotent — safe to re-run):
 *   - For every EmploymentContract with employeeType=CLT and no linked Admission,
 *     create an Admission { status: COMPLETED, hireDate = contract.admissionDate,
 *     contractId, userId } plus the default required-document checklist marked
 *     WAIVED (historical records, no files on hand).
 *   - Terceirizado/PJ/intern/autônomo contracts are skipped (no CLT admission).
 *   - Contracts that already have an Admission are skipped.
 *
 * Usage (DO NOT run while the DB is being restored):
 *   cd api && npx ts-node -r tsconfig-paths/register scripts/seed-admissions-backfill.ts
 *   cd api && npx ts-node -r tsconfig-paths/register scripts/seed-admissions-backfill.ts --dry-run
 */

import {
  PrismaClient,
  AdmissionStatus,
  AdmissionDocumentType,
  AdmissionDocumentStatus,
  EmployeeType,
} from '@prisma/client';

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');

const BACKFILL_NOTE_MARKER = 'Seed: admissão histórica (backfill vínculo)';

// statusOrder for COMPLETED (mirrors ADMISSION_STATUS_ORDER in src/constants/sortOrders.ts).
const COMPLETED_STATUS_ORDER = 5;

// Default required-document checklist: every type EXCEPT the optional ones
// (OTHER / DRIVER_LICENSE / TIME_BANK_AGREEMENT) — mirrors admission.service.ts.
const OPTIONAL_DOCUMENT_TYPES: AdmissionDocumentType[] = [
  AdmissionDocumentType.OTHER,
  AdmissionDocumentType.DRIVER_LICENSE,
  AdmissionDocumentType.TIME_BANK_AGREEMENT,
];
const DEFAULT_CHECKLIST: AdmissionDocumentType[] = (
  Object.values(AdmissionDocumentType) as AdmissionDocumentType[]
).filter(t => !OPTIONAL_DOCUMENT_TYPES.includes(t));

async function main() {
  console.log(`\n=== Admission backfill ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  const contracts = await prisma.employmentContract.findMany({
    where: { employeeType: EmployeeType.CLT, admission: { is: null } },
    select: {
      id: true,
      userId: true,
      sequence: true,
      admissionDate: true,
      createdAt: true,
      user: { select: { name: true } },
    },
    orderBy: [{ user: { name: 'asc' } }, { sequence: 'asc' }],
  });

  console.log(`Found ${contracts.length} CLT contract(s) without an admission.\n`);

  let created = 0;
  for (const c of contracts) {
    const hireDate = c.admissionDate ?? c.createdAt;
    console.log(
      `  ${DRY_RUN ? '[dry] ' : ''}+ ${c.user?.name ?? c.userId} (vínculo #${c.sequence}) — admissão ${hireDate.toISOString().slice(0, 10)} + ${DEFAULT_CHECKLIST.length} docs (WAIVED)`,
    );
    if (DRY_RUN) {
      created++;
      continue;
    }

    await prisma.admission.create({
      data: {
        userId: c.userId,
        contractId: c.id,
        status: AdmissionStatus.COMPLETED,
        statusOrder: COMPLETED_STATUS_ORDER,
        hireDate,
        notes: BACKFILL_NOTE_MARKER,
        createdAt: hireDate,
        documents: {
          create: DEFAULT_CHECKLIST.map(type => ({
            type,
            required: true,
            status: AdmissionDocumentStatus.WAIVED,
          })),
        },
      },
    });
    created++;
  }

  console.log(
    `\n${DRY_RUN ? 'Would create' : 'Created'} ${created} admission(s).${DRY_RUN ? ' (no writes)' : ''}\n`,
  );
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
