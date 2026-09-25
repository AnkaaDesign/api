// api/src/modules/people/portal/portal-artwork.service.ts
//
// O CLIENTE APROVA A ARTE (P13b; PLANO §5.1, §7.1, §7.2; D-09, DD5).
//
// Este serviço NÃO decide nada sobre a arte. A máquina (a troca de estado com
// `updateMany … where status`, a `LayoutDecision`, o `fileSha256` dos bytes no
// ato, o fechamento das O.S. "Aprovar com o Cliente", a liberação da tarefa e a
// reavaliação da assinatura do orçamento) é do `ImplementLayoutService` (P12), e
// o portal passa por ela — `approveFromPortal`/`reproveFromPortal`, com o ator
// `RESPONSIBLE`. O que É daqui são as duas perguntas que aquele serviço declara
// não fazer ("o escopo e a capacidade são conferidos lá"):
//
//   · A CAPACIDADE `APPROVE_ARTWORK` — no controlador, por `@PortalCapability`.
//   · O ESCOPO COMERCIAL — aqui, por `commercialTaskScopeWhere` (pagador ∨ dono,
//     SEM o caminho pessoal): a Furgões pagadora aprova a arte do caminhão da
//     RKO; um contato preso ao veículo por cadastro antigo, de outra empresa, NÃO.
//
// ⛔ 404 FORA DO ESCOPO, NUNCA 403. A existência de uma arte de outra empresa não
// é informação que o portal confirme — é a mesma regra de `getBudget`. E o
// `taskId` da URL entra no MESMO `where`: uma arte certa sob o veículo errado é
// 404, não "aprovada mesmo assim".
//
// ⛔ NENHUM ID DE CONTATO EM COLUNA DE `User`. O ator é `@CurrentResponsible()` e
// vai como `{ id, name }` para o serviço do P12, que o grava em
// `decidedByResponsibleId`/`LayoutDecision.responsibleId` — nunca em
// `decidedByUserId`, `userId` de trilha ou `createdById`.
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { hasSection } from '@modules/common/signature/quote-sections';
import { ImplementLayoutService } from '@modules/production/implement/implement-layout.service';
import { LAYOUT_STATUS, LAYOUT_STATUS_LABELS, TASK_STATUS } from '@constants';
import {
  PORTAL_ARTWORK_VISIBLE_STATUSES,
  type PortalArtworkListQuery,
  type PortalArtworkVisibleStatus,
} from '../../../schemas/portal-artwork';
import type { ResponsiblePrincipal } from '../responsible-auth/responsible-auth.guard';
import { PortalScopeService } from './portal-scope.service';
import {
  PortalProjectionService,
  canDecideArtworkOf,
  projectArtwork,
  type PortalArtworkView,
} from './portal-projection.service';
import {
  PORTAL_ARTWORK_LAYOUT_ORDER,
  PORTAL_ARTWORK_LAYOUT_SELECT,
  portalCommercialLinkSelect,
} from './portal-read.service';

/** O veículo e o orçamento de cada arte da lista — o endereço, e só. */
export interface PortalArtworkListItem extends PortalArtworkView {
  vehicle: {
    taskId: string;
    name: string | null;
    serialNumber: string | null;
    plate: string | null;
  };
  budget: { id: string; budgetNumber: number } | null;
}

/**
 * A arte REPROVADA só é visível se foi ENVIADA (`sentAt`) — a reprovação interna
 * de um rascunho nunca foi ao cliente. É a mesma regra de
 * `isPortalVisibleArtwork`, escrita como `where` para a lista paginar certo.
 */
function visibleStatusWhere(
  statuses: readonly PortalArtworkVisibleStatus[],
): Prisma.LayoutWhereInput {
  const plain = statuses.filter(s => s !== 'REPROVED');
  const branches: Prisma.LayoutWhereInput[] = [];
  if (plain.length) branches.push({ status: { in: plain as any[] } });
  if (statuses.includes('REPROVED')) {
    branches.push({ status: LAYOUT_STATUS.REPROVED as any, sentAt: { not: null } });
  }
  // ⚠️ Nunca `OR: []` — que no Prisma não restringe nada. O schema garante ao
  // menos um estado; o ramo impossível abaixo é o cinto.
  return branches.length ? { OR: branches } : { id: { in: [] } };
}

@Injectable()
export class PortalArtworkService {
  private readonly logger = new Logger(PortalArtworkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: PortalScopeService,
    private readonly projection: PortalProjectionService,
    private readonly layouts: ImplementLayoutService,
  ) {}

  // ═════════════════════════════════════════════════════════════════════════
  // GET /cliente/me/artes
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * As artes que este contato VÊ, com `canDecide` em cada uma.
   *
   * Portão de SEÇÃO (`LAYOUT`), como `/cobrancas` é de `PAYMENT`: o FINANCEIRO,
   * o GESTOR DE FROTA e o MOTORISTA não veem arte (§7.2) e recebem 403 com a
   * mesma frase das outras seções. O escopo de LEITURA é o do veículo
   * (`taskScopeWhere`, os três caminhos): o COMPRAS vê a arte pendente e não a
   * decide — `canDecide: false` é a resposta certa para ele, e não a ausência.
   */
  async list(principal: ResponsiblePrincipal, query: PortalArtworkListQuery) {
    const sections = this.projection.sectionsFor(principal.roles);
    if (!hasSection(sections, 'LAYOUT')) {
      throw new ForbiddenException(
        'Seu perfil de contato não tem acesso a esta informação. Fale com o comercial.',
      );
    }
    const take = Math.min(Math.max(Number(query?.take) || 20, 1), 100);
    const page = Math.max(Number(query?.page) || 1, 1);
    const statuses: readonly PortalArtworkVisibleStatus[] = query?.status?.length
      ? query.status
      : PORTAL_ARTWORK_VISIBLE_STATUSES;

    const where: Prisma.LayoutWhereInput = {
      AND: [
        visibleStatusWhere(statuses),
        { implement: { is: { task: { is: this.scope.taskScopeWhere(principal) } } } },
      ],
    };
    const [totalRecords, data] = await Promise.all([
      this.prisma.layout.count({ where }),
      this.load(principal, where, { skip: (page - 1) * take, take }),
    ]);
    const totalPages = Math.max(Math.ceil(totalRecords / take), 1);
    return {
      success: true,
      message: 'Artes carregadas com sucesso.',
      data,
      meta: {
        totalRecords,
        page,
        take,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // AS DECISÕES
  // ═════════════════════════════════════════════════════════════════════════

  /** `PUT /cliente/me/veiculos/:taskId/artes/:layoutId/aprovar` */
  async approve(principal: ResponsiblePrincipal, taskId: string, layoutId: string) {
    await this.decidable(principal, [layoutId], taskId);
    await this.layouts.approveFromPortal(layoutId, this.actor(principal));
    this.logger.log(
      `Arte ${layoutId} (veículo ${taskId}) aprovada no portal por ${principal.id} (sessão ${principal.sessionId}).`,
    );
    const [data] = await this.reload(principal, [layoutId]);
    return { success: true, message: 'Arte aprovada.', data };
  }

  /** `PUT /cliente/me/veiculos/:taskId/artes/:layoutId/reprovar` · `{ motivo }` */
  async reprove(principal: ResponsiblePrincipal, taskId: string, layoutId: string, motivo: string) {
    await this.decidable(principal, [layoutId], taskId);
    await this.layouts.reproveFromPortal(layoutId, motivo, this.actor(principal));
    this.logger.log(
      `Arte ${layoutId} (veículo ${taskId}) reprovada no portal por ${principal.id} (sessão ${principal.sessionId}).`,
    );
    const [data] = await this.reload(principal, [layoutId]);
    return {
      success: true,
      message: 'Arte reprovada. A Ankaa vai preparar uma nova versão.',
      data,
    };
  }

  /**
   * `PUT /cliente/me/artes/aprovar` · `{ layoutIds[] }` — "Aprovar para os N
   * veículos" (§7.1, linha "Lote").
   *
   * ⛔ TUDO OU NADA NA CONFERÊNCIA. Antes da primeira escrita, as N artes são
   * provadas de uma vez — escopo comercial de CADA veículo e `PENDING_APPROVAL`
   * de CADA arte. Uma fora do escopo derruba o lote inteiro com 404; uma já
   * decidida derruba com 409; e nada foi gravado. É o que a tela promete: o
   * botão diz "N veículos", não "os que der".
   *
   * ⚠️ O QUE NÃO É ATÔMICO, e por quê. Cada aprovação é uma transação do
   * `ImplementLayoutService` (a decisão e a trilha dela), seguida dos efeitos
   * (O.S., liberação, assinatura) — e aquele serviço é do P12, que o P13b usa e
   * não edita. Se, ENTRE a conferência e a escrita, outra pessoa decidir uma das
   * artes (a corrida do G17), aquela responde 409 dentro do serviço e as que já
   * foram aprovadas ficam aprovadas: uma aprovação legítima não se desfaz (D-21).
   * A resposta diz exatamente quantas passaram. Um `approveManyFromPortal` numa
   * transação só, no serviço do P12, fecharia essa janela — registrado na nota.
   */
  async approveMany(principal: ResponsiblePrincipal, layoutIds: string[]) {
    await this.decidable(principal, layoutIds, null);
    const actor = this.actor(principal);
    const done: string[] = [];
    for (const layoutId of layoutIds) {
      try {
        await this.layouts.approveFromPortal(layoutId, actor);
        done.push(layoutId);
      } catch (error) {
        if (!done.length) throw error;
        const status = error instanceof HttpException ? error.getStatus() : 500;
        this.logger.warn(
          `Lote do portal (${principal.id}): ${done.length} de ${layoutIds.length} aprovadas antes de ` +
            `${layoutId} falhar (${status}): ${(error as Error)?.message ?? error}`,
        );
        throw new ConflictException(
          `${done.length} de ${layoutIds.length} artes foram aprovadas; as demais já tinham ` +
            'sido decididas por outra pessoa enquanto você aprovava. Recarregue para ver.',
        );
      }
    }
    this.logger.log(
      `${done.length} arte(s) aprovada(s) em lote no portal por ${principal.id} (sessão ${principal.sessionId}).`,
    );
    const data = await this.reload(principal, done);
    return {
      success: true,
      message:
        done.length === 1 ? 'Arte aprovada.' : `Arte aprovada para os ${done.length} veículos.`,
      data: { approved: done.length, artworks: data },
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // APOIO
  // ═════════════════════════════════════════════════════════════════════════

  /** O ator do portal — `{ id, name }` do contato, e nada de `User`. */
  private actor(principal: ResponsiblePrincipal): { id: string; name: string | null } {
    return { id: principal.id, name: principal.name ?? null };
  }

  /**
   * AS ARTES PODEM SER DECIDIDAS POR ESTE CONTATO? Todas, ou nenhuma.
   *
   *  · 404 — alguma não existe, está fora do escopo COMERCIAL, não é do veículo
   *    da URL, ou nunca foi ao cliente (rascunho; reprovação interna de
   *    rascunho). Nos quatro casos, para o cliente, ela não existe.
   *  · 409 — o veículo foi cancelado, ou alguma já foi decidida
   *    (`APPROVED`/`REPROVED`/`SUPERSEDED`): "Esta arte já foi decidida".
   */
  private async decidable(
    principal: ResponsiblePrincipal,
    layoutIds: string[],
    taskId: string | null,
  ): Promise<void> {
    const taskWhere: Prisma.TaskWhereInput = taskId
      ? { AND: [{ id: taskId }, this.scope.commercialTaskScopeWhere(principal)] }
      : this.scope.commercialTaskScopeWhere(principal);
    const rows = await this.prisma.layout.findMany({
      where: {
        id: { in: layoutIds },
        status: { not: LAYOUT_STATUS.DRAFT as any },
        NOT: { status: LAYOUT_STATUS.REPROVED as any, sentAt: null },
        implement: { is: { task: { is: taskWhere } } },
      },
      select: {
        id: true,
        status: true,
        implement: { select: { task: { select: { status: true } } } },
      },
    });
    if (rows.length !== layoutIds.length) {
      throw new NotFoundException(
        layoutIds.length === 1
          ? 'Arte não encontrada.'
          : 'Uma ou mais artes do lote não foram encontradas. Nenhuma foi aprovada.',
      );
    }
    if (rows.some(r => r.implement?.task?.status === TASK_STATUS.CANCELLED)) {
      throw new ConflictException(
        layoutIds.length === 1
          ? 'Este veículo foi cancelado: não há arte a aprovar.'
          : 'Um dos veículos do lote foi cancelado. Nenhuma arte foi aprovada.',
      );
    }
    const decided = rows.find(r => r.status !== LAYOUT_STATUS.PENDING_APPROVAL);
    if (decided) {
      const label =
        (LAYOUT_STATUS_LABELS as Record<string, string>)[decided.status] ?? decided.status;
      throw new ConflictException(
        layoutIds.length === 1
          ? `Esta arte já foi decidida (está "${label}"). Recarregue para ver a decisão.`
          : `Esta arte já foi decidida (uma do lote está "${label}"). Nenhuma foi aprovada; ` +
              'recarregue para ver.',
      );
    }
  }

  /** As artes, projetadas, pela ordem de `ids` (a resposta das decisões). */
  private async reload(
    principal: ResponsiblePrincipal,
    ids: string[],
  ): Promise<PortalArtworkListItem[]> {
    if (!ids.length) return [];
    const items = await this.load(principal, { id: { in: ids } }, {});
    const byId = new Map(items.map(i => [i.id, i]));
    return ids.map(id => byId.get(id)).filter((i): i is PortalArtworkListItem => !!i);
  }

  /**
   * Carrega e projeta. O `select` da arte é o ENUMERADO do portal
   * (`PORTAL_ARTWORK_LAYOUT_SELECT`) — a mesma forma que o veículo e o orçamento
   * recebem, e o mesmo projetor (`projectArtwork`), para que a lista e o cartão
   * do veículo não digam coisas diferentes sobre a mesma arte.
   */
  private async load(
    principal: ResponsiblePrincipal,
    where: Prisma.LayoutWhereInput,
    page: { skip?: number; take?: number },
  ): Promise<PortalArtworkListItem[]> {
    const { companyId } = this.scope.assertScoped(principal);
    const rows = await this.prisma.layout.findMany({
      where,
      orderBy: [{ sentAt: 'asc' }, ...PORTAL_ARTWORK_LAYOUT_ORDER, { id: 'asc' }],
      skip: page.skip,
      take: page.take,
      select: {
        ...PORTAL_ARTWORK_LAYOUT_SELECT,
        implement: {
          select: {
            serialNumber: true,
            plate: true,
            task: {
              select: {
                id: true,
                name: true,
                status: true,
                customerId: true,
                billingEntry: portalCommercialLinkSelect(companyId),
                quote: { select: { id: true, budgetNumber: true } },
              },
            },
          },
        },
      },
    });
    const decision = { roles: principal.roles, customerId: companyId };
    return rows.map((row: any) => {
      const task = row.implement?.task ?? null;
      const canDecide = task ? canDecideArtworkOf(task, decision) : false;
      return {
        ...projectArtwork(row, canDecide),
        vehicle: {
          taskId: task?.id ?? null,
          name: task?.name ?? null,
          serialNumber: row.implement?.serialNumber ?? null,
          plate: row.implement?.plate ?? null,
        },
        budget: task?.quote ? { id: task.quote.id, budgetNumber: task.quote.budgetNumber } : null,
      } as PortalArtworkListItem;
    });
  }
}
