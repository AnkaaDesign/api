/**
 * DRY-RUN do reorganizador: lista exatamente o que sairia do lugar, sem mover nada.
 *
 * Somente leitura. Nenhum arquivo é tocado, nenhuma linha é escrita.
 *
 * Reproduz a decisão do FileOrganizationSchedulerService com o contexto vindo da
 * REFERÊNCIA (não da pasta), e checa antes as duas condições que fazem o mover abortar:
 * origem inexistente e destino já ocupado. Serve para conferir o plano ANTES de deixar
 * o cron às 04:00 executar.
 *
 *   npx tsx scripts/dry-run-file-organization.ts
 */
import { PrismaClient } from '@prisma/client';
import { existsSync } from 'fs';
import { dirname } from 'path';

const prisma = new PrismaClient();
const FILES_ROOT = process.env.FILES_ROOT || '/srv/files';

/** contexto -> subpasta, espelho de FilesStorageService.folderMapping */
const FOLDER: Record<string, string> = {
  tasksLayouts: 'Layouts',
  'quote-layouts': 'Layouts',
  taskBudgets: 'Orcamentos',
  budgetSignatures: 'Orcamentos/Assinaturas',
  budgetDossiers: 'Orcamentos/Dossies',
  taskInvoices: 'Notas Fiscais',
  taskReceipts: 'Comprovantes',
  installmentReceipts: 'Comprovantes',
  taskBankSlips: 'Boletos',
  taskReimbursements: 'Reembolsos',
  taskNfeReimbursements: 'Notas Fiscais Reembolso',
  taskBaseFiles: 'Outros',
  taskProjectFiles: 'Projetos',
  taskCheckinFiles: 'Checkin',
  taskCheckoutFiles: 'Checkout',
  serviceOrderCheckinFiles: 'Checkin',
  serviceOrderCheckoutFiles: 'Checkout',
  observations: 'Observacoes',
  cutFiles: 'Plotter',
  implementMeasurePhotos: 'Traseiras',
  truckVinPlate: 'Plaquetas',
  customerLogo: 'Logo',
  signedPpeDocuments: 'EPIs',
  warning: 'Advertencias',
  admissionDocuments: 'Admissao',
  terminationDocuments: 'Rescisao',
  medicalExams: 'Exames Medicos',
  leaveDocuments: 'Afastamentos',
  benefitDocuments: 'Beneficios',
  airbrushingInvoices: 'Aerografias/Notas Fiscais',
  airbrushingReceipts: 'Aerografias/Comprovantes',
};

/** Subpasta extra por tipo de arquivo, igual ao getFolderPath. */
function leaf(context: string, mimetype: string): string {
  if (context === 'tasksLayouts' || context === 'quote-layouts' || context === 'airbrushingLayouts')
    return mimetype === 'application/pdf' ? 'PDFs' : 'Imagens';
  if (context === 'taskProjectFiles') return mimetype === 'application/pdf' ? 'PDFs' : 'Imagens';
  if (context === 'taskBaseFiles') return mimetype.startsWith('image/') ? 'Imagens' : 'Documentos';
  return '';
}

function sanitize(name: string): string {
  return name
    .replace(/[/\\]/g, '_')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

type Ref = { key: string; context: string | null; owner: string | null };

async function referencesOf(fileId: string, quoteLayoutId: string | null): Promise<Ref[]> {
  const out: Ref[] = [];
  const push = (key: string, context: string | null, owner: string | null) =>
    out.push({ key, context, owner });

  if (quoteLayoutId) {
    const q = await prisma.taskQuote.findUnique({
      where: { id: quoteLayoutId },
      select: { task: { select: { customer: { select: { fantasyName: true } } } } },
    });
    push('File.quoteLayoutId', 'quote-layouts', q?.task?.customer?.fantasyName ?? null);
  }

  const layout = await prisma.layout.findFirst({
    where: { fileId },
    select: {
      tasks: { select: { customer: { select: { fantasyName: true } } }, take: 1 },
      airbrushing: { select: { task: { select: { customer: { select: { fantasyName: true } } } } } },
    },
  });
  if (layout) {
    const owner =
      layout.tasks[0]?.customer?.fantasyName ??
      layout.airbrushing?.task?.customer?.fantasyName ??
      null;
    push('Layout.fileId', layout.airbrushing ? 'airbrushingLayouts' : 'tasksLayouts', owner);
  }

  const taskRels: Array<[string, string, any]> = [
    ['_TASK_BASE_FILES', 'taskBaseFiles', { baseFiles: { some: { id: fileId } } }],
    ['_TASK_BUDGETS', 'taskBudgets', { budgets: { some: { id: fileId } } }],
    ['_TASK_INVOICES', 'taskInvoices', { invoices: { some: { id: fileId } } }],
    ['_TASK_RECEIPTS', 'taskReceipts', { receipts: { some: { id: fileId } } }],
    ['_TASK_PROJECT_FILES', 'taskProjectFiles', { projectFiles: { some: { id: fileId } } }],
  ];
  for (const [key, context, where] of taskRels) {
    const t = await prisma.task.findFirst({
      where,
      select: { customer: { select: { fantasyName: true } } },
    });
    if (t) push(key, context, t.customer?.fantasyName ?? null);
  }

  const inst = await prisma.installment.findFirst({
    where: { receiptFiles: { some: { id: fileId } } },
    select: { customerConfig: { select: { customer: { select: { fantasyName: true } } } } },
  });
  if (inst) {
    push('_InstallmentReceipts', 'installmentReceipts', inst.customerConfig?.customer?.fantasyName ?? null);
  }

  const admissionDoc = await prisma.admissionDocument.findFirst({
    where: { OR: [{ fileId }, { signedFileId: fileId }] },
    select: { admission: { select: { user: { select: { name: true } } } } },
  });
  if (admissionDoc) {
    push('AdmissionDocument', 'admissionDocuments', admissionDoc.admission?.user?.name ?? null);
  }

  const env = await prisma.signatureEnvelope.findFirst({
    where: { OR: [{ originalFileId: fileId }, { finalFileId: fileId }] },
    select: { quote: { select: { task: { select: { customer: { select: { fantasyName: true } } } } } } },
  });
  if (env) {
    push('SignatureEnvelope', 'budgetSignatures', env.quote?.task?.customer?.fantasyName ?? null);
  }

  return out;
}

async function main() {
  const files = await prisma.file.findMany({
    where: { path: { startsWith: FILES_ROOT } },
    select: { id: true, filename: true, path: true, mimetype: true, quoteLayoutId: true },
  });

  const moves: Array<{ from: string; to: string; why: string }> = [];
  const blocked: Array<{ path: string; reason: string }> = [];
  const stay: Record<string, number> = {};

  for (const f of files) {
    const refs = await referencesOf(f.id, f.quoteLayoutId);
    const withCtx = refs.filter(r => r.context && FOLDER[r.context]);
    if (withCtx.length === 0) {
      stay['sem contexto canônico'] = (stay['sem contexto canônico'] || 0) + 1;
      continue;
    }

    const destinations = [...new Set(withCtx.map(r => FOLDER[r.context!]))];
    if (destinations.length > 1) {
      stay[`destinos conflitantes (${destinations.join(' vs ')})`] =
        (stay[`destinos conflitantes (${destinations.join(' vs ')})`] || 0) + 1;
      continue;
    }

    const owner = withCtx.map(r => r.owner).find(Boolean);
    if (!owner) {
      stay['dono não resolvível'] = (stay['dono não resolvível'] || 0) + 1;
      continue;
    }

    const ctx = withCtx[0].context!;
    const sub = leaf(ctx, f.mimetype);
    const USER_CTX = new Set([
      'signedPpeDocuments', 'warning', 'admissionDocuments',
      'terminationDocuments', 'medicalExams', 'leaveDocuments', 'benefitDocuments',
    ]);
    const entityRoot = USER_CTX.has(ctx) ? 'Colaboradores' : 'Clientes';
    const expectedDir = [FILES_ROOT, entityRoot, sanitize(owner), FOLDER[ctx], sub]
      .filter(Boolean)
      .join('/');

    if (dirname(f.path) === expectedDir) continue; // já no lugar

    if (!existsSync(f.path)) {
      blocked.push({ path: f.path, reason: 'bytes não existem no disco' });
      continue;
    }
    const target = `${expectedDir}/${f.filename}`;
    if (existsSync(target)) {
      blocked.push({ path: f.path, reason: `destino já ocupado: ${target}` });
      continue;
    }

    moves.push({
      from: f.path.replace(`${FILES_ROOT}/`, ''),
      to: expectedDir.replace(`${FILES_ROOT}/`, ''),
      why: withCtx.map(r => r.key).join('+'),
    });
  }

  const byDest = new Map<string, number>();
  const byOrigin = new Map<string, number>();
  for (const m of moves) {
    const d = m.to.replace(/^Clientes\/[^/]+\//, 'Clientes/{cliente}/');
    byDest.set(d, (byDest.get(d) || 0) + 1);
    byOrigin.set(m.from.split('/')[0], (byOrigin.get(m.from.split('/')[0]) || 0) + 1);
  }

  console.log(`Arquivos analisados: ${files.length}`);
  console.log(`\n=== SERIAM MOVIDOS: ${moves.length} ===`);
  console.log('\npor pasta de ORIGEM:');
  [...byOrigin.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
    console.log(`  ${String(v).padStart(4)}  ${k}/`),
  );
  console.log('\npor pasta de DESTINO:');
  [...byDest.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
    console.log(`  ${String(v).padStart(4)}  ${k}/`),
  );

  console.log(`\n=== BLOQUEADOS (o mover pula, nada é perdido): ${blocked.length} ===`);
  const reasons = new Map<string, number>();
  blocked.forEach(b => {
    const r = b.reason.startsWith('destino') ? 'destino já ocupado' : b.reason;
    reasons.set(r, (reasons.get(r) || 0) + 1);
  });
  [...reasons.entries()].forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));

  console.log(`\n=== FICAM ONDE ESTÃO ===`);
  Object.entries(stay)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));

  console.log(`\n=== AMOSTRA (20 primeiros movimentos) ===`);
  moves.slice(0, 20).forEach(m => console.log(`  ${m.from}\n      -> ${m.to}/   [${m.why}]`));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
