/**
 * O PORTÃO DA ARTE NA LIBERAÇÃO PARA PRODUÇÃO (PLANO D-15; DD3, DD9, DD10).
 *
 * Trabalho NOVO só vai para produção com a arte do implemento APROVADA — pelo
 * cliente no portal, ou "em nome do cliente" (com nota). Não existe dispensa
 * (DD9: todo serviço tem arte). Vale para a liberação automática (O.S. de ARTE e
 * comercial concluídas) E para a manual ("Disponibilizar para produção", DD10).
 *
 * "Trabalho novo" (D-15): a primeira O.S. de ARTE da tarefa nasceu DEPOIS da
 * R-B. Sem O.S. de ARTE nenhuma, vale a criação da tarefa (DD9: todo serviço tem
 * arte, então não ter O.S. de arte não é motivo para ir à produção sem ela). O
 * corte é o instante em que a M3 foi aplicada NESTE banco
 * (`_prisma_migrations.finished_at`, casado pelo sufixo do nome — o carimbo muda
 * no P30, o nome não). `ARTWORK_GATE_SINCE` (ISO) sobrepõe o corte, para bancos
 * de teste montados com `db push`, que não têm a tabela de migrações; sem corte
 * nenhum, o portão não se aplica (o legado nunca é travado por falta de dado).
 *
 * O resultado alimenta as funções PURAS de `task-service-order-sync.ts`, que
 * continuam recebendo só dados:
 *   - `OK`: o implemento tem arte `APPROVED`;
 *   - `PENDING`: trabalho novo sem arte aprovada — a ida a WAITING_PRODUCTION
 *     não acontece (a volta a PREPARATION continua igual);
 *   - `NOT_APPLICABLE`: trabalho antigo.
 */

import type { PrismaTransaction } from '@modules/common/base/base.repository';

export type ArtworkGate = 'OK' | 'PENDING' | 'NOT_APPLICABLE';

/** A frase que a liberação manual devolve (400) quando o portão está fechado. */
export const ARTWORK_GATE_BLOCKED_MESSAGE =
  'A arte do implemento ainda não foi aprovada: a tarefa só vai para produção com a arte ' +
  'aprovada pelo cliente — ou aprovada em nome dele, com nota, na arte do implemento.';

/** O sufixo do nome da M3 em `_prisma_migrations` (o carimbo muda no P30; o nome, não). */
const M3_NAME_SUFFIX = '_arte_do_implemento_e_projeto_da_tarefa';

/** Parte pura, para o teste de tabela. */
export function artworkGateOf(input: {
  /** Criação da primeira O.S. de ARTE da tarefa, ou da tarefa quando não há. */
  reference: Date;
  /** Instante da R-B neste banco; `null` = sem corte conhecido. */
  cutoff: Date | null;
  hasApprovedArt: boolean;
}): ArtworkGate {
  if (!input.cutoff) return 'NOT_APPLICABLE';
  if (input.reference.getTime() < input.cutoff.getTime()) return 'NOT_APPLICABLE';
  return input.hasApprovedArt ? 'OK' : 'PENDING';
}

let cutoffCache: { at: Date | null } | undefined;

/** Para os testes que trocam `ARTWORK_GATE_SINCE` no meio do processo. */
export function resetArtworkGateCutoffCache(): void {
  cutoffCache = undefined;
}

export async function artworkGateCutoff(tx: PrismaTransaction): Promise<Date | null> {
  if (cutoffCache) return cutoffCache.at;
  const override = process.env.ARTWORK_GATE_SINCE;
  if (override) {
    const at = new Date(override);
    if (!Number.isNaN(at.getTime())) {
      cutoffCache = { at };
      return at;
    }
  }
  try {
    const rows = await (tx as any).$queryRaw<Array<{ finished_at: Date | null }>>`
      SELECT finished_at FROM "_prisma_migrations"
      WHERE migration_name LIKE ${`%${M3_NAME_SUFFIX}`}
        AND finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY finished_at ASC
      LIMIT 1`;
    cutoffCache = { at: rows[0]?.finished_at ?? null };
  } catch {
    // Banco sem a tabela de migrações (`db push`): sem corte, o portão não se aplica.
    cutoffCache = { at: null };
  }
  return cutoffCache.at;
}

/** O portão da arte de UMA tarefa, lido dentro da transação de quem vai decidir. */
export async function artworkGateFor(tx: PrismaTransaction, taskId: string): Promise<ArtworkGate> {
  const task = await tx.task.findUnique({
    where: { id: taskId },
    select: {
      createdAt: true,
      implement: {
        select: { layouts: { where: { status: 'APPROVED' }, select: { id: true }, take: 1 } },
      },
      serviceOrders: {
        where: { type: 'ARTWORK' },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  if (!task) return 'NOT_APPLICABLE';
  return artworkGateOf({
    reference: task.serviceOrders[0]?.createdAt ?? task.createdAt,
    cutoff: await artworkGateCutoff(tx),
    hasApprovedArt: (task.implement?.layouts?.length ?? 0) > 0,
  });
}

/** Estados em que a tarefa já está (ou vai) para o chão de fábrica. */
const PRODUCTION_STATES = new Set(['WAITING_PRODUCTION', 'IN_PRODUCTION', 'COMPLETED']);

/**
 * A troca MANUAL de status entra em produção? (PREPARATION ou CANCELLED →
 * WAITING_PRODUCTION / IN_PRODUCTION / COMPLETED.) É ela que o portão checa na
 * liberação manual (DD10); mover dentro da produção não é liberar.
 */
export function entersProduction(fromStatus: string, toStatus: string): boolean {
  return PRODUCTION_STATES.has(toStatus) && !PRODUCTION_STATES.has(fromStatus);
}
