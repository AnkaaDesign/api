/**
 * Auditoria de arquivamento: onde cada arquivo ESTÁ vs onde suas REFERÊNCIAS dizem
 * que ele deveria estar.
 *
 * Somente leitura. Não move, não apaga, não escreve nada.
 *
 * Roda a mesma inversão que o organizador passou a usar: a pasta canônica sai de quem
 * usa o arquivo, não do caminho em que ele já está. Um arquivo largado numa pasta
 * genérica (Fotos/, Auxiliares/, Uploads/) não tem contexto detectável pelo caminho —
 * era exatamente por isso que ele ficava invisível para o organizador e acabava
 * classificado como órfão.
 *
 *   npx tsx scripts/audit-file-placement.ts            # resumo
 *   npx tsx scripts/audit-file-placement.ts --verbose  # lista arquivo a arquivo
 */
import { PrismaClient } from '@prisma/client';
import { existsSync } from 'fs';

const prisma = new PrismaClient();
const FILES_ROOT = process.env.FILES_ROOT || '/srv/files';
const VERBOSE = process.argv.includes('--verbose');

/** Pastas que não carregam significado de domínio — nada referenciado deveria morar aqui. */
const GENERIC_ROOTS = ['Fotos', 'Auxiliares', 'Uploads', 'Publico'];

type Row = { id: string; filename: string; path: string; quoteLayoutId: string | null };

async function inboundColumns(): Promise<Array<{ table: string; column: string }>> {
  const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_name = 'File' AND ccu.column_name = 'id'
      AND tc.table_name <> 'thumbnail_jobs'
    ORDER BY tc.table_name, kcu.column_name
  `;
  return rows.map(r => ({ table: r.table_name, column: r.column_name }));
}

/**
 * Referência -> pasta esperada, como (entityRoot, subpasta).
 * Espelha INBOUND_REFERENCES do FileReferenceService; `null` = sem pasta canônica,
 * o arquivo nunca deve ser movido por causa dessa referência.
 */
const PLACEMENT: Record<string, { root: 'Clientes' | 'Fornecedores' | 'Colaboradores'; sub: string } | null> = {
  'File.quoteLayoutId': { root: 'Clientes', sub: 'Layouts' },
  'Layout.fileId': { root: 'Clientes', sub: 'Layouts' },
  '_TASK_BUDGETS.A': { root: 'Clientes', sub: 'Orcamentos' },
  '_TASK_INVOICES.A': { root: 'Clientes', sub: 'Notas Fiscais' },
  '_TASK_RECEIPTS.A': { root: 'Clientes', sub: 'Comprovantes' },
  '_TASK_BANK_SLIPS.A': { root: 'Clientes', sub: 'Boletos' },
  '_TASK_REIMBURSEMENTS.A': { root: 'Clientes', sub: 'Reembolsos' },
  '_TASK_INVOICE_REIMBURSEMENTS.A': { root: 'Clientes', sub: 'Notas Fiscais Reembolso' },
  '_TASK_BASE_FILES.A': { root: 'Clientes', sub: 'Outros' },
  '_TASK_PROJECT_FILES.A': { root: 'Clientes', sub: 'Projetos' },
  '_TASK_CHECKIN_FILES.A': { root: 'Clientes', sub: 'Checkin' },
  '_TASK_CHECKOUT_FILES.A': { root: 'Clientes', sub: 'Checkout' },
  '_SERVICE_ORDER_CHECKIN_FILES.A': { root: 'Clientes', sub: 'Checkin' },
  '_SERVICE_ORDER_CHECKOUT_FILES.A': { root: 'Clientes', sub: 'Checkout' },
  '_OBSERVATIONS_FILES.A': { root: 'Clientes', sub: 'Observacoes' },
  '_InstallmentReceipts.A': { root: 'Clientes', sub: 'Comprovantes' },
  'Cut.fileId': { root: 'Clientes', sub: 'Plotter' },
  'ImplementMeasure.photoId': { root: 'Clientes', sub: 'Traseiras' },
  'Truck.vinPlateId': { root: 'Clientes', sub: 'Plaquetas' },
  'Customer.logoId': { root: 'Clientes', sub: 'Logo' },
  '_AIRBRUSHING_INVOICES.B': { root: 'Clientes', sub: 'Aerografias/Notas Fiscais' },
  '_AIRBRUSHING_RECEIPTS.B': { root: 'Clientes', sub: 'Aerografias/Comprovantes' },
  'Supplier.logoId': { root: 'Fornecedores', sub: 'Logo' },
  '_ORDER_RECEIPTS.A': { root: 'Fornecedores', sub: 'Comprovantes' },
  'User.avatarId': { root: 'Colaboradores', sub: 'Fotos' },
  '_FileToWarning.A': { root: 'Colaboradores', sub: 'Advertencias' },
  'PpeDeliverySignature.signedDocumentId': { root: 'Colaboradores', sub: 'EPIs' },
  'PpeDelivery.deliveryDocumentId': { root: 'Colaboradores', sub: 'EPIs' },
  'WarningSignature.signedDocumentId': { root: 'Colaboradores', sub: 'Advertencias' },
  'AdmissionDocument.fileId': { root: 'Colaboradores', sub: 'Admissao' },
  'AdmissionDocument.signedFileId': { root: 'Colaboradores', sub: 'Admissao' },
  'TerminationDocument.fileId': { root: 'Colaboradores', sub: 'Rescisao' },
  'MedicalExam.fileId': { root: 'Colaboradores', sub: 'Exames Medicos' },
  'UserBenefit.declarationFileId': { root: 'Colaboradores', sub: 'Beneficios' },
  '_FileToLeave.A': { root: 'Colaboradores', sub: 'Afastamentos' },
  'BankSlip.pdfFileId': { root: 'Clientes', sub: 'Boletos' },
  'SignatureEnvelope.originalFileId': { root: 'Clientes', sub: 'Orcamentos/Assinaturas' },
  'SignatureEnvelope.finalFileId': { root: 'Clientes', sub: 'Orcamentos/Assinaturas' },
};

function rootFolderOf(p: string): string {
  return p.startsWith(`${FILES_ROOT}/`) ? p.slice(FILES_ROOT.length + 1).split('/')[0] : '(fora do storage)';
}

async function main() {
  const columns = await inboundColumns();
  const files = await prisma.$queryRaw<Row[]>`
    SELECT id, filename, path, "quoteLayoutId" FROM "File" WHERE path LIKE ${`${FILES_ROOT}/%`}
  `;

  console.log(`Auditando ${files.length} arquivos contra ${columns.length} FKs de entrada + 1 de saída.\n`);

  const stats = {
    total: files.length,
    unreferenced: 0,
    referencedInGeneric: 0,
    referencedNoPlacement: 0,
    referencedPlacedOk: 0,
    referencedWrongDomain: 0,
    bytesMissing: 0,
  };
  const genericByContext = new Map<string, number>();
  const wrongDomainSamples: string[] = [];
  const genericSamples: string[] = [];

  for (const f of files) {
    if (!existsSync(f.path)) stats.bytesMissing++;

    const refs: string[] = [];
    if (f.quoteLayoutId) refs.push('File.quoteLayoutId');
    for (const { table, column } of columns) {
      const hit = await prisma.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM "${table}" WHERE "${column}" = $1 LIMIT 1`,
        f.id,
      );
      if (hit.length > 0) refs.push(`${table}.${column}`);
    }

    if (refs.length === 0) {
      stats.unreferenced++;
      continue;
    }

    const root = rootFolderOf(f.path);
    const placements = refs.map(r => PLACEMENT[r]).filter(Boolean) as Array<{ root: string; sub: string }>;

    if (GENERIC_ROOTS.includes(root)) {
      stats.referencedInGeneric++;
      const key = refs.join(' + ');
      genericByContext.set(key, (genericByContext.get(key) || 0) + 1);
      if (genericSamples.length < 8) genericSamples.push(`${root}/  ${f.filename}  <- ${key}`);
      continue;
    }

    if (placements.length === 0) {
      stats.referencedNoPlacement++;
      continue;
    }

    // Domínio = a raiz de entidade (Clientes / Fornecedores / Colaboradores).
    const expectedRoots = [...new Set(placements.map(p => p.root))];
    if (!expectedRoots.includes(root)) {
      stats.referencedWrongDomain++;
      if (wrongDomainSamples.length < 10) {
        wrongDomainSamples.push(`${f.path.replace(FILES_ROOT + '/', '')}  -> esperado ${expectedRoots.join('|')}/`);
      }
      continue;
    }

    // Subdomínio: a pasta esperada aparece no caminho?
    const subOk = placements.some(p => f.path.includes(`/${p.sub}/`));
    if (subOk) stats.referencedPlacedOk++;
    else {
      stats.referencedWrongDomain++;
      if (wrongDomainSamples.length < 10) {
        wrongDomainSamples.push(
          `${f.path.replace(FILES_ROOT + '/', '')}  -> esperado .../${placements.map(p => p.sub).join('|')}/`,
        );
      }
    }

    if (VERBOSE) console.log(`${subOk ? 'OK ' : 'XX '} ${f.path}  [${refs.join(', ')}]`);
  }

  console.log('--- RESUMO ---');
  console.log(`Total de arquivos no storage ........... ${stats.total}`);
  console.log(`  sem nenhuma referência ............... ${stats.unreferenced}`);
  console.log(`  referenciados, pasta correta ......... ${stats.referencedPlacedOk}`);
  console.log(`  referenciados, domínio/subpasta errada ${stats.referencedWrongDomain}`);
  console.log(`  referenciados em pasta GENÉRICA ...... ${stats.referencedInGeneric}   <-- risco`);
  console.log(`  referenciados sem pasta canônica ..... ${stats.referencedNoPlacement}`);
  console.log(`Linhas cujos bytes não existem no disco  ${stats.bytesMissing}`);

  if (genericByContext.size > 0) {
    console.log('\n--- REFERENCIADOS EM PASTA GENÉRICA, por tipo de vínculo ---');
    for (const [k, v] of [...genericByContext.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(4)}  ${k}`);
    }
    console.log('\n  exemplos:');
    genericSamples.forEach(s => console.log(`    ${s}`));
  }

  if (wrongDomainSamples.length > 0) {
    console.log('\n--- EXEMPLOS DE DOMÍNIO/SUBPASTA ERRADA ---');
    wrongDomainSamples.forEach(s => console.log(`  ${s}`));
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
