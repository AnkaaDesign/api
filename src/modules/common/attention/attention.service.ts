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
   * Global attention state per entity type, independent of what's loaded in the caller's
   * browser tab. The web engine (lib/attention/engine.ts) only evaluates entities a mounted
   * page has registered, so e.g. the Produção dashboard — which loads neither tasks nor cuts —
   * would never light the Agenda/Cronograma/Recorte nav entries even when matching records
   * exist. This mirrors the rules in `web/src/lib/attention/rules.ts` as efficient Prisma
   * counts instead of re-implementing the generic predicate DSL server-side (Phase 1 — see
   * api/docs/attention-server-side.md §6). Keep the conditions in sync with rules.ts by hand
   * for now; a shared rule source is Phase 3 work (§4.2).
   *
   * The response shape is `{ [entityType]: { count, armed, harsh } }` — the SAME triple the
   * client engine's `getAttentionSnapshot()` produces, so the sidebar merges local and server
   * state without translating between two vocabularies. That translation is precisely where
   * the nav and the rows used to disagree: cuts had a bespoke count-only poll with `armed`
   * hardcoded true, so the cut nav could never mirror a resting cut row.
   */
  async getSummary(userId: string): Promise<Record<string, AttentionSummaryEntry>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { sector: { select: { privileges: true } } },
    });
    const privilege = user?.sector?.privileges;
    if (!privilege) return {};
    const isAdmin = privilege === SectorPrivileges.ADMIN; // ADMIN inherits every sector's view

    const now = new Date();
    const summary: Record<string, AttentionSummaryEntry> = {};

    // ---- TASK (R1-R3b, targeted at LOGISTIC + PRODUCTION_MANAGER) ----
    if (isAdmin || privilege === SectorPrivileges.LOGISTIC || privilege === SectorPrivileges.PRODUCTION_MANAGER) {
      const inFlight: Prisma.TaskWhereInput = { status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] } };
      // Empty-string chassis/plate count as "missing" (the client's isNullish treats "" as null),
      // so mirror that here or the nav under-counts vs an on-screen row.
      const noChassis: Prisma.TaskWhereInput = { OR: [{ truck: null }, { truck: { chassisNumber: null } }, { truck: { chassisNumber: '' } }] };
      const noPlate: Prisma.TaskWhereInput = { OR: [{ truck: null }, { truck: { vinPlate: null } }, { truck: { vinPlate: '' } }] };
      const anyRule: Prisma.TaskWhereInput = {
        OR: [
          { cleared: true, entryDate: null }, // R1 — cleared without entry
          { forecastDate: { lt: now }, cleared: false }, // R2 — forecast overdue, not cleared
          { entryDate: { not: null }, ...noChassis }, // R3a — entry given, no chassis
          { entryDate: { not: null }, ...noPlate }, // R3b — entry given, no plate
        ],
      };
      const notSuppressed = await this.restingIdFilter(userId, 'TASK', now);
      const [count, armed, harsh] = await this.prisma.$transaction([
        // count = EVERY matching task (armed OR resting) → the nav shows an indicator at all.
        this.prisma.task.count({ where: { AND: [inFlight, anyRule] } }),
        // armed = matching tasks still inside their cooldown → these BLINK (the rest are
        // resting: nav shows a static border instead). This is how the nav "follows" the row.
        this.prisma.task.count({ where: { AND: [inFlight, notSuppressed, anyRule] } }),
        // harsh (R2) → red vs amber.
        this.prisma.task.count({ where: { AND: [inFlight, { forecastDate: { lt: now }, cleared: false }] } }),
      ]);
      summary.TASK = { count, armed: armed > 0, harsh: harsh > 0 };
    }

    // ---- CUT (R0 `cut.pending`, targeted at WAREHOUSE) ----
    if (isAdmin || privilege === SectorPrivileges.WAREHOUSE) {
      const pending: Prisma.CutWhereInput = { status: CutStatus.PENDING };
      const notSuppressed = await this.restingIdFilter(userId, 'CUT', now);
      const [count, armed] = await this.prisma.$transaction([
        this.prisma.cut.count({ where: pending }),
        this.prisma.cut.count({ where: { AND: [pending, notSuppressed] } }),
      ]);
      // `cut.pending` has tone `harsh`, so any match is red.
      summary.CUT = { count, armed: armed > 0, harsh: count > 0 };
    }

    return summary;
  }

  /**
   * `{ id: { notIn: [...] } }` for records this user has viewed and that are still inside
   * their cooldown, i.e. RESTING rather than blinking. Suppressing at record granularity: if
   * a record is snoozed for ANY of its rules it's resting, which is the coarse "is anything
   * blinking" signal the nav needs.
   *
   * `acknowledged` deliberately does NOT suppress. There is one quiet axis — the cooldown —
   * shared with the client engine (see web `markViewed`). Treating `acknowledged` as a
   * permanent mute here is what made the nav go dark for good on a record whose row had
   * already re-armed.
   *
   * Bounded: without a cap this list grows for the life of the account and is spliced
   * verbatim into `id NOT IN ($1..$n)` on a 60s poll — eventually a multi-thousand-parameter
   * query, and past ~65k bind params Postgres refuses outright. Only records inside an active
   * cooldown can appear, so a few thousand is far above the ceiling this legitimately needs.
   */
  private async restingIdFilter(userId: string, entityType: string, now: Date): Promise<{ id?: { notIn: string[] } }> {
    const acks = await this.prisma.attentionAck.findMany({
      where: { userId, entityType, snoozeUntil: { gt: now } },
      select: { entityId: true },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    });
    const ids = [...new Set(acks.map((a) => a.entityId))];
    return ids.length ? { id: { notIn: ids } } : {};
  }
}

/** Per-entity-type triple, mirroring the web engine's `AttentionTypeSnapshot`. */
export interface AttentionSummaryEntry {
  /** Records with any unresolved match (armed OR resting). 0 ⇒ the nav shows nothing. */
  count: number;
  /** At least one is actively blinking ⇒ the nav blinks; otherwise a static border. */
  armed: boolean;
  /** Highest severity present ⇒ red vs amber. */
  harsh: boolean;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
