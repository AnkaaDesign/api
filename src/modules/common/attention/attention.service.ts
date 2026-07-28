import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AttentionGateway } from './attention.gateway';
import { PrismaService } from '../prisma/prisma.service';
import {
  TaskStatus,
  CutStatus,
  OrderStatus,
  PpeDeliveryStatus,
  AirbrushingStatus,
  TaskQuoteStatus,
  SectorPrivileges,
  Prisma,
} from '@prisma/client';

/** Only these sectors may send a manual attention warning — mirrors the client
 * gate (web/src/lib/attention/send-warning.tsx `SEND_WARNING_PRIVILEGES`); this is
 * the enforcing copy since the client gate is only UI, not security. */
const SEND_WARNING_PRIVILEGES: SectorPrivileges[] = [SectorPrivileges.ADMIN, SectorPrivileges.COMMERCIAL];

export interface SendWarningInput {
  entityType: string;
  entityId: string;
  /** { level: 'row' } | { level: 'detail' } | { level: 'field', field } */
  target: { level: 'row' | 'detail' | 'field'; field?: string };
  recipientUserIds: string[];
  message?: string;
  tone?: 'harsh' | 'soft' | 'none';
  blinkCount?: number;
  cooldownMs?: number;
  /** Auto-expire after this many ms (omit = until acknowledged). */
  expiresInMs?: number;
}

/**
 * Orchestrates manual "send a warning" dispatch and entity-change signalling.
 * Manual warnings are delivered in real time to online recipients via the
 * attention gateway (ephemeral). Offline persistence + server-side rule pushes
 * are a later phase and slot in here without changing the client contract.
 */
@Injectable()
export class AttentionService {
  constructor(
    private readonly gateway: AttentionGateway,
    private readonly prisma: PrismaService,
  ) {}

  async sendWarning(fromUserId: string, input: SendWarningInput): Promise<{ id: string; delivered: number; offline: number }> {
    // The sender's NAME is resolved here, never taken from the request body: a
    // client-supplied `fromUserName` let any authorized sender attribute a blinking,
    // beeping warning to someone else entirely.
    const sender = await this.prisma.user.findUnique({
      where: { id: fromUserId },
      select: { name: true, sector: { select: { privileges: true } } },
    });
    if (!sender?.sector || !SEND_WARNING_PRIVILEGES.includes(sender.sector.privileges)) {
      throw new ForbiddenException('Apenas ADMIN e COMERCIAL podem enviar avisos');
    }
    if (!input?.entityType || !input?.entityId) throw new BadRequestException('entityType e entityId são obrigatórios');
    if (!Array.isArray(input.recipientUserIds) || input.recipientUserIds.length === 0) {
      throw new BadRequestException('Selecione ao menos um destinatário');
    }
    if (input.target?.level === 'field' && !input.target.field) {
      throw new BadRequestException('Alvo de campo requer o nome do campo');
    }

    const fromUserName = sender.name;
    const id = randomUUID();
    const blinkCount = clamp(input.blinkCount ?? 5, 1, 20);
    const cooldownMs = clamp(input.cooldownMs ?? 30 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000);
    const tone = input.tone ?? 'soft';

    // Matches the web `PushedAttention` shape (lib/attention/engine.ts).
    const payload = {
      id,
      entityType: input.entityType,
      entityId: input.entityId,
      target: input.target,
      priority: 40, // manual warnings outrank the automatic rules
      message: input.message,
      fromUserId,
      fromUserName,
      expiresAt: input.expiresInMs ? Date.now() + clamp(input.expiresInMs, 1000, 7 * 24 * 60 * 60 * 1000) : undefined,
      cadence: {
        blinkCount,
        intervalMs: 750,
        pulseMs: 750,
        soundEnabled: tone !== 'none',
        tone,
        cooldownMs,
      },
    };

    // Don't nag the sender.
    const recipients = input.recipientUserIds.filter((uid) => uid !== fromUserId);
    if (recipients.length === 0) return { id, delivered: 0, offline: 0 };

    // A pushed warning is ephemeral — an offline recipient's socket room is empty and
    // the emit is silently dropped. Report that back so the sender is told the truth
    // ("2 de 3 entregues") instead of an unconditional "aviso enviado".
    const online = await this.gateway.filterOnlineUserIds(recipients);
    this.gateway.pushToUsers(online, payload);
    return { id, delivered: online.length, offline: recipients.length - online.length };
  }

  /** Public hook for domain services to signal a change (invalidation + re-eval). */
  notifyEntityChanged(entityType: string, entityId: string, changedFields?: string[]) {
    this.gateway.broadcastEntityChanged(entityType, entityId, changedFields);
  }

  /**
   * WHICH records match WHICH rule right now, for the caller's sector — independent of what
   * their browser tab happens to have loaded.
   *
   * The web engine (lib/attention/engine.ts) only evaluates entities a mounted page has
   * registered, so on any page that loads neither tasks nor cuts it had NOTHING to build a
   * blink/bip cycle from: the sound was structurally unreachable off the Agenda / Cronograma /
   * Recorte pages and their detail pages. This is the other half of that signal — the client
   * feeds these matches into the same cycle machinery as its locally-evaluated ones, so a
   * bip reaches the user wherever they are.
   *
   * IDS, not counts. It used to return `{ count, armed, harsh }` per entity type, which the
   * nav merged with the engine's own triple. Two implementations of "is this armed?" — one
   * here over `AttentionAck` rows, one in the client's ack store — is precisely how the nav
   * and the rows came to contradict each other. Now the server answers only the question it
   * can answer authoritatively (does this record match this rule?) and the CLIENT ENGINE is
   * the single authority on armed vs resting, for loaded and unloaded records alike.
   *
   * For the same reason the response deliberately does NOT filter out records the caller has
   * already acked: a match that vanished would look RESOLVED to the engine, which clears the
   * cooldown and re-arms — an ack would have caused an instant re-bip.
   *
   * Two fields tell the client how far to TRUST an absence, because "not in the list" has to be
   * distinguishable from "not looked for":
   *   • `evaluatedRuleIds` — the rules actually run for this caller. A client rule missing from
   *     the server mirror is then simply local-only; it can never have its cooldown cleared by
   *     an absence the server never checked for. That matters because these conditions are
   *     hand-mirrored: without it, every drift became re-blinking and re-bipping.
   *   • `truncatedTypes`   — entity types whose list hit `MATCH_LIMIT`, where a missing record
   *     may just be past the cap.
   *
   * Rule conditions mirror `web/src/lib/attention/rules.ts` and are keyed by the SAME rule
   * ids, so a rule present there and missing here is visible at a glance — R3c (foto da
   * plaqueta) had been added to the client and never here, and the nav silently under-counted.
   * A shared rule source is Phase 3 work (api/docs/attention-server-side.md §4.2).
   */
  async getSummary(userId: string): Promise<AttentionMatchesResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { sector: { select: { privileges: true } } },
    });
    const privilege = user?.sector?.privileges;
    if (!privilege) return { matches: [], evaluatedRuleIds: [], truncatedTypes: [] };

    const now = new Date();
    const visible = RULE_QUERIES.filter(
      // ADMIN inherits every sector's view (mirrors the client's canAccessAnyPrivilege).
      // An EMPTY audience means "every sector" — the same semantics the client engine
      // gives `targetSectors: []` — which is how the personal ("mine") rules reach the
      // sectors that have no shared-entity screens at all.
      (r) =>
        r.privileges.length === 0 ||
        privilege === SectorPrivileges.ADMIN ||
        r.privileges.includes(privilege),
    );
    const evaluatedRuleIds = visible.map((r) => r.ruleId);
    if (visible.length === 0) return { matches: [], evaluatedRuleIds, truncatedTypes: [] };

    // One round trip for every rule. `take: MATCH_LIMIT + 1` is how truncation is detected
    // without a second count query.
    //
    // The delegate comes from ENTITY_DELEGATES rather than a `entityType === 'CUT' ? … : …`
    // ternary. That ternary silently ran ANY non-CUT rule against `prisma.task`, so a rule
    // on a third entity type would have queried Task with a foreign `where` — which is why
    // rules could not leave TASK/CUT, and therefore why eleven of fifteen sectors had no
    // attention at all.
    const rows = await this.prisma.$transaction(
      visible.map((rule) =>
        ENTITY_DELEGATES[rule.entityType](this.prisma).findMany({
          where: rule.where({ now, userId }),
          select: { id: true },
          take: MATCH_LIMIT + 1,
        }),
      ),
    );

    const matches: AttentionMatchRef[] = [];
    const truncatedTypes = new Set<string>();
    visible.forEach((rule, i) => {
      const ids = rows[i];
      if (ids.length > MATCH_LIMIT) truncatedTypes.add(rule.entityType);
      for (const { id } of ids.slice(0, MATCH_LIMIT)) {
        matches.push({ ruleId: rule.ruleId, entityType: rule.entityType, entityId: id });
      }
    });

    return { matches, evaluatedRuleIds, truncatedTypes: [...truncatedTypes] };
  }
}

/** One rule↔record hit, addressed exactly as the web engine's `matchKey` addresses it. */
export interface AttentionMatchRef {
  /** Must equal an `AttentionRule.id` in web `rules.ts` — the client looks the rule up by it
   * to recover the target (row/field), cadence and priority, so none of that travels. */
  ruleId: string;
  entityType: string;
  entityId: string;
}

export interface AttentionMatchesResponse {
  matches: AttentionMatchRef[];
  /** Rules actually run for this caller — absence from `matches` only means "resolved" for these. */
  evaluatedRuleIds: string[];
  /** Types whose list was capped — absence from `matches` is NOT resolution for these. */
  truncatedTypes: string[];
}

/**
 * Per-rule id cap. Bounds the payload and the `id NOT IN`-free query cost; a sector with
 * more than this many unresolved records of one kind has a backlog problem, not a nav problem,
 * and the client still blinks/bips for the capped subset.
 */
const MATCH_LIMIT = 200;

/**
 * Entity types that can carry a rule. A subset of `ATTENTION_ENTITY_TYPES`
 * (api/src/schemas/attention.ts) — the wire accepts sixteen types for presence,
 * this is the smaller set that has a query delegate below.
 */
type RuleEntityType = 'TASK' | 'CUT' | 'ORDER' | 'PPE_DELIVERY' | 'AIRBRUSHING' | 'TASK_QUOTE';

/** What a rule's `where` may depend on. */
interface RuleContext {
  now: Date;
  /** The CALLER. Present so a rule can scope itself to the user's own records. */
  userId: string;
}

/**
 * The minimal shape every Prisma model delegate satisfies, for the dispatch table.
 *
 * The return type must be `PrismaPromise`, not `Promise`: `$transaction([...])`
 * only accepts the former, and that brand is how Prisma knows the calls can be
 * batched into one round trip instead of awaited independently.
 */
interface IdFindMany {
  findMany(args: {
    where: unknown;
    select: { id: true };
    take: number;
  }): Prisma.PrismaPromise<Array<{ id: string }>>;
}

/**
 * entityType → Prisma delegate. Adding a rule on a new entity means adding one
 * line here and one descriptor on the clients; nothing else in this file changes.
 */
const ENTITY_DELEGATES: Record<RuleEntityType, (prisma: PrismaService) => IdFindMany> = {
  TASK: (p) => p.task as unknown as IdFindMany,
  CUT: (p) => p.cut as unknown as IdFindMany,
  ORDER: (p) => p.order as unknown as IdFindMany,
  PPE_DELIVERY: (p) => p.ppeDelivery as unknown as IdFindMany,
  AIRBRUSHING: (p) => p.airbrushing as unknown as IdFindMany,
  TASK_QUOTE: (p) => p.taskQuote as unknown as IdFindMany,
};

interface RuleQuery {
  /** Same id as the client rule (web/src/lib/attention/rules.ts). */
  ruleId: string;
  entityType: RuleEntityType;
  /**
   * Sectors the client rule targets (`AttentionRule.targetSectors`).
   * EMPTY means every sector, matching the client engine's semantics.
   */
  privileges: SectorPrivileges[];
  where: (ctx: RuleContext) => unknown;
}

/** Every TASK rule is implicitly "…and still in flight" (see `whileInFlight` in rules.ts). */
const IN_FLIGHT: Prisma.TaskWhereInput = { status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] } };

// Empty string counts as missing — the client's isNull treats "" as null, and mirroring it
// here is what keeps an on-screen row and the nav from disagreeing about the same record.
const NO_CHASSIS: Prisma.TaskWhereInput = { OR: [{ truck: null }, { truck: { chassisNumber: null } }, { truck: { chassisNumber: '' } }] };
const NO_PLATE: Prisma.TaskWhereInput = { OR: [{ truck: null }, { truck: { plate: null } }, { truck: { plate: '' } }] };
const NO_SERIAL: Prisma.TaskWhereInput = { OR: [{ serialNumber: null }, { serialNumber: '' }] };
/** R3c tests the SCALAR `vinPlateId`, like the client rule — the `vinPlate` relation only
 * exists when included, so testing the relation would match every task. */
const NO_VIN_PLATE_PHOTO: Prisma.TaskWhereInput = { OR: [{ truck: null }, { truck: { vinPlateId: null } }] };

const TASK_AUDIENCE = [SectorPrivileges.LOGISTIC, SectorPrivileges.PRODUCTION_MANAGER];

/** Cutting is operated by the almoxarifado and by plotagem. */
const CUT_AUDIENCE = [SectorPrivileges.WAREHOUSE, SectorPrivileges.PLOTTING];

/** Faturamento/orçamento — the commercial and financial owners of a quote. */
const QUOTE_AUDIENCE = [SectorPrivileges.COMMERCIAL, SectorPrivileges.FINANCIAL];

/**
 * The server-side mirror of `ATTENTION_RULES`, one entry per rule id.
 *
 * Every rule here MUST exist with the SAME id in `web/src/lib/attention/rules.ts`
 * and `mobile_migration/lib/core/attention/attention_rules.dart`. `evaluatedRuleIds`
 * exists to make drift survivable, not acceptable.
 *
 * Rule selection principle: a rule must name work its audience can actually DO,
 * and must stop matching once that work is done. A permanently-unresolvable
 * alert teaches people to ignore the whole system, which is why there is (for
 * example) no "budget still pending" rule — every budget is legitimately pending
 * for a while — only "budget pending PAST ITS EXPIRY", which is a real backlog.
 */
const RULE_QUERIES: RuleQuery[] = [
  {
    ruleId: 'task.cleared-without-entry',
    entityType: 'TASK',
    privileges: TASK_AUDIENCE,
    where: () => ({ AND: [IN_FLIGHT, { cleared: true, entryDate: null }] }),
  },
  {
    ruleId: 'task.forecast-overdue-not-cleared',
    entityType: 'TASK',
    privileges: TASK_AUDIENCE,
    where: ({ now }) => ({ AND: [IN_FLIGHT, { forecastDate: { lt: now }, cleared: false }] }),
  },
  {
    ruleId: 'task.entry-without-chassis',
    entityType: 'TASK',
    privileges: TASK_AUDIENCE,
    where: () => ({ AND: [IN_FLIGHT, { entryDate: { not: null } }, NO_CHASSIS] }),
  },
  {
    ruleId: 'task.entry-without-plate',
    entityType: 'TASK',
    privileges: TASK_AUDIENCE,
    where: () => ({ AND: [IN_FLIGHT, { entryDate: { not: null } }, NO_SERIAL, NO_PLATE] }),
  },
  {
    ruleId: 'task.entry-without-vin-plate-photo',
    entityType: 'TASK',
    privileges: TASK_AUDIENCE,
    where: () => ({ AND: [IN_FLIGHT, { entryDate: { not: null } }, NO_VIN_PLATE_PHOTO] }),
  },
  {
    ruleId: 'cut.pending',
    entityType: 'CUT',
    privileges: CUT_AUDIENCE,
    where: () => ({ status: CutStatus.PENDING }),
  },

  // ── Almoxarifado ──────────────────────────────────────────────────────────
  {
    // The forecast passed and the order is still not in. Resolves on receipt or
    // cancellation; RECEIVED and CANCELLED are excluded rather than listing the
    // open statuses so a new OrderStatus member defaults to "still open".
    ruleId: 'order.forecast-overdue',
    entityType: 'ORDER',
    privileges: [SectorPrivileges.WAREHOUSE],
    where: ({ now }) => ({
      forecast: { lt: now },
      status: { notIn: [OrderStatus.RECEIVED, OrderStatus.CANCELLED] },
    }),
  },
  {
    // Approved but never handed over — the almoxarifado owns `mark-delivered`.
    ruleId: 'ppe-delivery.approved-not-delivered',
    entityType: 'PPE_DELIVERY',
    privileges: [SectorPrivileges.WAREHOUSE],
    where: () => ({ status: PpeDeliveryStatus.APPROVED }),
  },

  // ── Contabilidade ─────────────────────────────────────────────────────────
  {
    // Awaiting approve/reject. Targeted at ACCOUNTING alone even though
    // HUMAN_RESOURCES shares the approval permission: DP has no menu entry for
    // PPE deliveries, and a rule whose nav home the audience cannot open bips
    // with nowhere to go. Give DP the route first, then add it here.
    ruleId: 'ppe-delivery.pending-review',
    entityType: 'PPE_DELIVERY',
    privileges: [SectorPrivileges.ACCOUNTING],
    where: () => ({ status: PpeDeliveryStatus.PENDING }),
  },

  // ── Produção ──────────────────────────────────────────────────────────────
  {
    // Queued for the airbrushing bench.
    ruleId: 'airbrushing.waiting-production',
    entityType: 'AIRBRUSHING',
    privileges: [SectorPrivileges.PRODUCTION],
    where: () => ({ status: AirbrushingStatus.WAITING_PRODUCTION }),
  },

  // ── Comercial / Financeiro ────────────────────────────────────────────────
  {
    // Still PENDING after its own expiry date — renew it or cancel it.
    ruleId: 'task-quote.expired-pending',
    entityType: 'TASK_QUOTE',
    privileges: QUOTE_AUDIENCE,
    where: ({ now }) => ({ status: TaskQuoteStatus.PENDING, expiresAt: { lt: now } }),
  },
  {
    // An installment has come due.
    ruleId: 'task-quote.due',
    entityType: 'TASK_QUOTE',
    privileges: QUOTE_AUDIENCE,
    where: () => ({ status: TaskQuoteStatus.DUE }),
  },

  // ── Every sector ──────────────────────────────────────────────────────────
  {
    // The one rule with an EMPTY audience, and the reason the feature now
    // reaches every sector rather than three.
    //
    // Sectors like MANUTENÇÃO, AEROGRAFIA, DESIGNER, BÁSICO and EXTERNO have no
    // shared-entity screens at all — only the "Pessoal" block — so no rule over
    // tasks, cuts or orders could ever have reached them. This one is scoped to
    // the CALLER's own records (`userId`), lives on /pessoal/meus-epis, and names
    // something only that person can do: sign for the PPE they received.
    ruleId: 'ppe-delivery.awaiting-my-signature',
    entityType: 'PPE_DELIVERY',
    privileges: [],
    where: ({ userId }) => ({ status: PpeDeliveryStatus.WAITING_SIGNATURE, userId }),
  },
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
