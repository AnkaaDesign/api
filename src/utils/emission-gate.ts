// O PORTÃO DE EMISSÃO DO ORÇAMENTO — `assertEmissionReady` (D-29, PLANO §2A.7).
//
// Para EMITIR as assinaturas, o valor E a arte de todo veículo têm de estar
// aprovados (DD2), e o resto do que já se exigia continua: nenhuma coleta viva ou
// concluída, um pagador só, validade em dia, alguém para assinar.
//
// ⛔ UMA FUNÇÃO, CHAMADA EM TRÊS LUGARES: o preflight (`GET …/preflight`), o
// `createEnvelope` antes de montar o documento e DENTRO da transação que cria o
// envelope. Portões repetidos em três lugares divergem — o preflight diz "pode"
// e o POST dá 400 —, e a arte pode ser reprovada entre o render e o commit: por
// isso a última conferência é na transação, com o `tx`.
//
// A forma de fora não muda (G27): o preflight continua devolvendo
// `blockers: string[]` (o app instalado só lê texto) e ganha `gates` estruturado
// AO LADO. `emissionOf` é a mesma conta para o detalhe do orçamento e para o
// portal ("Para emitir falta…").
//
// E7 (recortes válidos) NÃO mora aqui: depende das seções que o operador escolhe
// no ato da emissão, e só o `createEnvelope` as conhece.
import type { Prisma, PrismaClient } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { BUDGET_SIGNATURE_STATUS, TASK_QUOTE_STATUS } from '../constants/enums';
import { artworkGateFailure } from './quote-artwork';
import { sortQuoteTasks } from './quote-tasks';

type Client = PrismaClient | Prisma.TransactionClient;

export type EmissionGateCode =
  | 'VALUE_NOT_APPROVED'
  | 'ARTWORK_PENDING'
  | 'ENVELOPE_LIVE'
  | 'TWO_PAYERS'
  | 'VALIDITY_EXPIRED'
  | 'RESPONSIBLES';

/** A ordem em que a tela lista o que falta: da decisão ao cadastro. */
export const EMISSION_GATE_CODES: readonly EmissionGateCode[] = [
  'VALUE_NOT_APPROVED',
  'ARTWORK_PENDING',
  'ENVELOPE_LIVE',
  'TWO_PAYERS',
  'VALIDITY_EXPIRED',
  'RESPONSIBLES',
];

export interface EmissionArtworkRow {
  taskId: string;
  serialNumber: string | null;
  plate: string | null;
  implementId: string | null;
  /** A arte mais recente do implemento (qualquer estado), ou nula ("Sem arte"). */
  layoutId: string | null;
  status: string | null;
  sentAt: Date | null;
  decidedAt: Date | null;
}

export interface EmissionGate {
  code: EmissionGateCode;
  ok: boolean;
  /** A frase do bloqueio (vazia quando `ok`). É a que vai em `blockers[]`. */
  message: string;
  detail?: {
    artworks?: EmissionArtworkRow[];
    value?: { at: Date; by: string | null; source: string; total: number | null } | null;
  };
}

export interface Emission {
  ready: boolean;
  blockers: Array<{ code: EmissionGateCode; message: string }>;
}

const EMISSION_SELECT = {
  id: true,
  status: true,
  signatureStatus: true,
  expiresAt: true,
  customerConfigs: { select: { customerId: true } },
  valueApprovals: {
    where: { revokedAt: null },
    orderBy: { decidedAt: 'desc' as const },
    take: 1,
    select: {
      decidedAt: true,
      source: true,
      total: true,
      user: { select: { name: true } },
      responsible: { select: { name: true } },
    },
  },
  tasks: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      createdAt: true,
      status: true,
      responsibles: { select: { id: true } },
      implement: {
        select: {
          id: true,
          serialNumber: true,
          plate: true,
          layouts: {
            where: { status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REPROVED'] } },
            orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
            select: { id: true, fileId: true, status: true, sentAt: true, decidedAt: true },
          },
        },
      },
    },
  },
} satisfies Prisma.BudgetSelect;

const brDate = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/**
 * Os seis portões do orçamento, cada um com `ok`. `null` quando o orçamento não
 * existe.
 */
export async function emissionGatesOf(
  client: Client,
  quoteId: string,
  now: Date = new Date(),
): Promise<EmissionGate[] | null> {
  const quote = await (client as any).budget.findUnique({
    where: { id: quoteId },
    select: EMISSION_SELECT,
  });
  if (!quote) return null;

  const gates: EmissionGate[] = [];

  // E1 — o VALOR aprovado e a aprovação vigente.
  const vigente = quote.valueApprovals[0] ?? null;
  const e1 = quote.status === TASK_QUOTE_STATUS.APPROVED && vigente !== null;
  gates.push({
    code: 'VALUE_NOT_APPROVED',
    ok: e1,
    message: e1
      ? ''
      : 'O valor do orçamento ainda não foi aprovado. Envie para aprovação do cliente ou ' +
        'aprove o valor em nome dele (com nota).',
    detail: {
      value: vigente
        ? {
            at: vigente.decidedAt,
            by: vigente.responsible?.name ?? vigente.user?.name ?? null,
            source: vigente.source,
            total: vigente.total !== null ? Number(vigente.total) : null,
          }
        : null,
    },
  });

  // E2 — a ARTE aprovada de todo veículo não cancelado. Sem dispensa (DD9).
  const approvedOnly = {
    tasks: quote.tasks.map((t: any) => ({
      ...t,
      implement: t.implement
        ? { ...t.implement, layouts: t.implement.layouts.filter((l: any) => l.status === 'APPROVED') }
        : null,
    })),
  };
  const art = artworkGateFailure(approvedOnly as any);
  gates.push({
    code: 'ARTWORK_PENDING',
    ok: art === null,
    message: art
      ? `${art.message} O documento leva a arte aprovada de cada veículo: aprove a arte antes de ` +
        'enviar o orçamento para assinatura.'
      : '',
    detail: {
      artworks: sortQuoteTasks(quote.tasks as any[])
        .filter((t: any) => t.status !== 'CANCELLED')
        .map((t: any) => {
          const layouts = t.implement?.layouts ?? [];
          const current = layouts.find((l: any) => l.status === 'APPROVED') ?? layouts[0] ?? null;
          return {
            taskId: t.id,
            serialNumber: t.implement?.serialNumber ?? null,
            plate: t.implement?.plate ?? null,
            implementId: t.implement?.id ?? null,
            layoutId: current?.id ?? null,
            status: current?.status ?? null,
            sentAt: current?.sentAt ?? null,
            decidedAt: current?.decidedAt ?? null,
          };
        }),
    },
  });

  // E3 — nenhuma coleta viva ou concluída, e nenhum "assinado fora do sistema"
  // vigente (não se reemite por cima de uma assinatura, eletrônica ou não).
  const live = await (client as any).signatureEnvelope.findFirst({
    where: { quoteId, status: { in: ['RUNNING', 'COMPLETED'] } },
    select: { status: true, version: true },
  });
  const offline = quote.signatureStatus === BUDGET_SIGNATURE_STATUS.SIGNED_OFFLINE;
  gates.push({
    code: 'ENVELOPE_LIVE',
    ok: !live && !offline,
    message: live
      ? live.status === 'RUNNING'
        ? 'Já existe uma coleta de assinaturas em andamento para este orçamento. ' +
          'Cancele-a antes de emitir outra.'
        : `Este orçamento já tem uma coleta CONCLUÍDA e assinada (versão ${live.version}). ` +
          'Reemitir criaria um segundo contrato selado para o mesmo número.'
      : offline
        ? 'Este orçamento já está assinado fora do sistema. Reemitir criaria uma segunda ' +
          'assinatura para o mesmo número.'
        : '',
  });

  // E4 — um pagador só (o documento congelado descreve um).
  const payers = new Set((quote.customerConfigs ?? []).map((c: any) => c.customerId));
  gates.push({
    code: 'TWO_PAYERS',
    ok: payers.size <= 1,
    message:
      payers.size > 1
        ? `Este orçamento fatura para ${payers.size} clientes, e a cerimônia de assinatura ainda ` +
          'não recorta o documento por pagador — todos assinariam um instrumento com os serviços, ' +
          'o desconto e as cláusulas de apenas um deles. Separe em um orçamento por cliente antes ' +
          'de enviar para assinatura.'
        : '',
  });

  // E5 — validade em dia. Estender a validade NÃO revoga o valor.
  const expired = quote.expiresAt.getTime() <= now.getTime();
  gates.push({
    code: 'VALIDITY_EXPIRED',
    ok: !expired,
    message: expired
      ? `A validade deste orçamento venceu em ${brDate(quote.expiresAt)}. Atualize a data de ` +
        'validade antes de enviar para assinatura.'
      : '',
  });

  // E6 — alguém do cliente para assinar.
  const hasResponsible = quote.tasks.some((t: any) => (t.responsibles ?? []).length > 0);
  gates.push({
    code: 'RESPONSIBLES',
    ok: hasResponsible,
    message: hasResponsible
      ? ''
      : 'Selecione ao menos um responsável na tarefa antes de enviar o orçamento para assinatura.',
  });

  return gates;
}

/** `emission { ready, blockers[] }` — o detalhe do orçamento e o portal. */
export async function emissionOf(client: Client, quoteId: string): Promise<Emission> {
  const gates = (await emissionGatesOf(client, quoteId)) ?? [];
  const blockers = gates.filter(g => !g.ok).map(g => ({ code: g.code, message: g.message }));
  return { ready: gates.length > 0 && blockers.length === 0, blockers };
}

/**
 * Lança 400 com TODOS os bloqueios, na ordem, quando algum portão fecha. É o
 * que `createEnvelope` chama antes do render e dentro da transação.
 */
export async function assertEmissionReady(client: Client, quoteId: string): Promise<void> {
  const gates = await emissionGatesOf(client, quoteId);
  if (!gates) throw new BadRequestException('Orçamento não encontrado.');
  const failing = gates.filter(g => !g.ok);
  if (failing.length > 0) {
    throw new BadRequestException(failing.map(g => g.message).join(' '));
  }
}
