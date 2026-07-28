import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AttentionGateway } from './attention.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { TaskStatus, CutStatus, SectorPrivileges, Prisma } from '@prisma/client';

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
      (r) => privilege === SectorPrivileges.ADMIN || r.privileges.includes(privilege),
    );
    const evaluatedRuleIds = visible.map((r) => r.ruleId);
    if (visible.length === 0) return { matches: [], evaluatedRuleIds, truncatedTypes: [] };

    // One round trip for every rule. `take: MATCH_LIMIT + 1` is how truncation is detected
    // without a second count query.
    const rows = await this.prisma.$transaction(
      visible.map((rule) =>
        rule.entityType === 'CUT'
          ? this.prisma.cut.findMany({ where: rule.where(now) as Prisma.CutWhereInput, select: { id: true }, take: MATCH_LIMIT + 1 })
          : this.prisma.task.findMany({ where: rule.where(now) as Prisma.TaskWhereInput, select: { id: true }, take: MATCH_LIMIT + 1 }),
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

interface RuleQuery {
  /** Same id as the client rule (web/src/lib/attention/rules.ts). */
  ruleId: string;
  entityType: 'TASK' | 'CUT';
  /** Sectors the client rule targets (`AttentionRule.targetSectors`). */
  privileges: SectorPrivileges[];
  where: (now: Date) => Prisma.TaskWhereInput | Prisma.CutWhereInput;
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

/** The server-side mirror of `ATTENTION_RULES`, one entry per rule id. */
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
    where: (now) => ({ AND: [IN_FLIGHT, { forecastDate: { lt: now }, cleared: false }] }),
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
    privileges: [SectorPrivileges.WAREHOUSE],
    where: () => ({ status: CutStatus.PENDING }),
  },
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
