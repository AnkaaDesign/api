/**
 * MONTAGEM DE ORÇAMENTO PARA OS TESTES DA MÁQUINA DO ORÇAMENTO (P14).
 *
 * O orçamento nasce pelo caminho REAL (`TaskService.batchCreateWithQuote`, com o
 * zod da rota), e não por `prisma.budget.create`: é esse caminho que decide o
 * nascimento (D-34), cria o faturamento e o pagador, e um orçamento montado à
 * mão pularia exatamente o que os testes querem provar.
 *
 * Tudo o que nasce aqui é registrado em `created` e sai no `cleanup`, na ordem
 * que os gatilhos do banco exigem (a trilha da assinatura é append-only e o
 * arquivo referenciado não se apaga sem a licença da sessão).
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

export interface BudgetFixtureCreated {
  quoteIds: string[];
  taskIds: string[];
  responsibleIds: string[];
  fileIds: string[];
}

export function newCreated(): BudgetFixtureCreated {
  return { quoteIds: [], taskIds: [], responsibleIds: [], fileIds: [] };
}

export async function mkQuote(
  deps: { prisma: any; tasks: any; schema: any },
  created: BudgetFixtureCreated,
  args: {
    tag: string;
    customerId: string;
    userId: string;
    roles?: string[];
    /** O que o corpo pede como nascimento — o servidor ignora (D-34). */
    status?: string;
    amount?: number;
  },
): Promise<{ quoteId: string; taskId: string; implementId: string; responsibleId: string }> {
  const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const resp = await deps.prisma.responsible.create({
    data: {
      name: `ZZ-P14-${args.tag}-${suffix}`,
      email: `zz.p14.${args.tag.toLowerCase()}.${suffix}@ankaa.local`,
      phone: `4398${suffix}`,
      roles: args.roles ?? ['COMMERCIAL'],
      companyId: args.customerId,
    },
    select: { id: true },
  });
  created.responsibleIds.push(resp.id);
  const amount = args.amount ?? 100;
  const res = await deps.tasks.batchCreateWithQuote(
    deps.schema.parse({
      tasks: [
        {
          status: 'PREPARATION',
          name: `ZZ-P14-${args.tag}-${suffix}`,
          customerId: args.customerId,
          implement: { serialNumber: `ZZP${suffix}` },
          responsibleIds: [resp.id],
        },
      ],
      quote: {
        billingSplit: 'JOINT',
        expiresAt: new Date(Date.now() + 30 * 86400000),
        status: args.status ?? 'PENDING',
        subtotal: amount,
        total: amount,
        customerConfigs: [
          {
            customerId: args.customerId,
            subtotal: amount,
            total: amount,
            discountType: 'NONE',
            generateInvoice: false,
            generateBankSlip: false,
            paymentConfig: { type: 'CASH', method: 'PIX', cashDays: 5 },
          },
        ],
        services: [{ description: 'Logomarca Lateral', amount }],
      },
    }),
    undefined,
    args.userId,
  );
  const quoteId: string = res?.data?.quote?.id;
  const taskId: string = res?.data?.tasks?.[0]?.id;
  if (!quoteId || !taskId) throw new Error('mkQuote: o orçamento de teste não nasceu');
  created.quoteIds.push(quoteId);
  created.taskIds.push(taskId);
  const implement = await deps.prisma.implement.findFirst({
    where: { taskId },
    select: { id: true },
  });
  return { quoteId, taskId, implementId: implement.id, responsibleId: resp.id };
}

/** A arte APROVADA do implemento (montagem: o ato é do `implement-layout.test.ts`). */
export async function approveArt(
  prisma: any,
  created: BudgetFixtureCreated,
  implementId: string,
): Promise<void> {
  const file = await prisma.file.create({
    data: {
      filename: `zz-p14-arte-${implementId.slice(0, 8)}.png`,
      originalName: 'Arte aprovada (teste P14).png',
      mimetype: 'image/png',
      path: `/tmp/zz-p14-arte-${implementId}.png`,
      size: 1,
    },
    select: { id: true },
  });
  created.fileIds.push(file.id);
  await prisma.layout.create({ data: { fileId: file.id, implementId, status: 'APPROVED' } });
}

/** Um `Express.Multer.File` de verdade no disco (o serviço de arquivo o move). */
export function fakeUpload(tag: string, mimetype = 'image/png', bytes = 64): Express.Multer.File {
  const dir = resolve(join(tmpdir(), `p14-upload-${process.pid}`));
  mkdirSync(dir, { recursive: true });
  const ext = mimetype === 'application/pdf' ? 'pdf' : mimetype === 'text/plain' ? 'txt' : 'png';
  const path = join(dir, `${tag}-${Date.now()}.${ext}`);
  writeFileSync(path, Buffer.alloc(bytes, tag.charCodeAt(0)));
  return {
    fieldname: 'offlineSignatureFile',
    originalname: `zz-p14-${tag}.${ext}`,
    encoding: '7bit',
    mimetype,
    size: bytes,
    path,
    destination: dir,
    filename: `${tag}.${ext}`,
  } as any;
}

export async function cleanup(prisma: any, created: BudgetFixtureCreated): Promise<void> {
  for (const quoteId of created.quoteIds) {
    await prisma
      .$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_signature_audit_delete = 'on'`);
        await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_referenced_file_delete = 'on'`);
        const envelopes = await tx.signatureEnvelope.findMany({
          where: { quoteId },
          select: { id: true },
        });
        const pdfs = await tx.envelopeDocument.findMany({
          where: { envelopeId: { in: envelopes.map((e: any) => e.id) } },
          select: { originalFileId: true },
        });
        const offline = await tx.budgetOfflineSignature.findMany({
          where: { budgetId: quoteId },
          select: { fileId: true },
        });
        await tx.budgetOfflineSignature.deleteMany({ where: { budgetId: quoteId } });
        await tx.budget.deleteMany({ where: { id: quoteId } });
        await tx.file.deleteMany({
          where: {
            id: { in: [...pdfs.map((d: any) => d.originalFileId), ...offline.map((o: any) => o.fileId)] },
          },
        });
      })
      .catch((e: Error) => console.log(`  ⚠️  limpeza do orçamento ${quoteId} falhou: ${e.message}`));
  }
  if (created.fileIds.length) {
    await prisma.layout.deleteMany({ where: { fileId: { in: created.fileIds } } }).catch(() => {});
    await prisma
      .$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_referenced_file_delete = 'on'`);
        await tx.file.deleteMany({ where: { id: { in: created.fileIds } } });
      })
      .catch(() => {});
  }
  if (created.taskIds.length) {
    await prisma.task.deleteMany({ where: { id: { in: created.taskIds } } }).catch(() => {});
  }
  if (created.responsibleIds.length) {
    await prisma.responsible.deleteMany({ where: { id: { in: created.responsibleIds } } }).catch(() => {});
  }
}
