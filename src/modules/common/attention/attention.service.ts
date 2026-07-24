import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AttentionGateway } from './attention.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { TaskStatus, SectorPrivileges, Prisma } from '@prisma/client';

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
  /** Display-only sender name supplied by the client. */
  fromUserName?: string;
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

  async sendWarning(fromUserId: string, fromUserName: string | undefined, input: SendWarningInput): Promise<{ id: string }> {
    const sender = await this.prisma.user.findUnique({ where: { id: fromUserId }, select: { sector: { select: { privileges: true } } } });
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
    if (recipients.length > 0) this.gateway.pushToUsers(recipients, payload);
    return { id };
  }

  /** Public hook for domain services to signal a change (invalidation + re-eval). */
  notifyEntityChanged(entityType: string, entityId: string, changedFields?: string[]) {
    this.gateway.broadcastEntityChanged(entityType, entityId, changedFields);
  }

  /**
   * Global attention count, independent of what's currently loaded in the caller's
   * browser tab. The web engine (lib/attention/engine.ts) only evaluates entities a
   * mounted page has registered, so e.g. the Produção dashboard — which loads no
   * tasks — never lights the Agenda/Cronograma nav entries even when matching tasks
   * exist. This mirrors the same 4 TASK rules (web/src/lib/attention/rules.ts R1-R3b)
   * as efficient Prisma counts instead of re-implementing the generic predicate DSL
   * server-side (Phase 1 — see api/docs/attention-server-side.md §6). Keep the
   * `whileInFlight` exclusion and the 4 conditions in sync with rules.ts by hand for
   * now; a shared rule source is Phase 3 work (§4.2).
   */
  async getSummary(userId: string): Promise<{ counts: { TASK: number }; armed: { TASK: boolean }; harsh: { TASK: boolean } }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { sector: { select: { privileges: true } } },
    });
    const privilege = user?.sector?.privileges;
    // R1-R3b are all targeted at LOGISTIC + PRODUCTION_MANAGER; ADMIN inherits everyone's view.
    const canSee =
      privilege === SectorPrivileges.ADMIN ||
      privilege === SectorPrivileges.LOGISTIC ||
      privilege === SectorPrivileges.PRODUCTION_MANAGER;
    if (!canSee) return { counts: { TASK: 0 }, armed: { TASK: false }, harsh: { TASK: false } };

    const now = new Date();
    const inFlight: Prisma.TaskWhereInput = { status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] } };
    // Empty-string chassis/plate count as "missing" (the client's isNullish treats "" as null),
    // so mirror that here or the nav under-counts vs an on-screen row.
    const noChassis: Prisma.TaskWhereInput = { OR: [{ truck: null }, { truck: { chassisNumber: null } }, { truck: { chassisNumber: "" } }] };
    const noPlate: Prisma.TaskWhereInput = { OR: [{ truck: null }, { truck: { vinPlate: null } }, { truck: { vinPlate: "" } }] };

    // The nav must "follow" the row: a task the user has VIEWED (acknowledged) or is in its
    // cooldown (snoozeUntil in the future) is resting/static — NOT blinking — so it must NOT
    // light the nav. Exclude those task ids (per this user's AttentionAck) from the counts.
    // (Suppressing at task granularity — if a task is acked/snoozed for ANY of its rules it's
    // resting; the same coarse "is anything blinking" signal the nav needs.)
    const acks = await this.prisma.attentionAck.findMany({
      where: { userId, OR: [{ acknowledged: true }, { snoozeUntil: { gt: now } }] },
      select: { entityId: true },
    });
    const suppressedIds = [...new Set(acks.map((a) => a.entityId))];
    const notSuppressed: Prisma.TaskWhereInput = suppressedIds.length ? { id: { notIn: suppressedIds } } : {};

    // The "any rule matches" predicate (drives the nav indicator at all).
    const anyRule: Prisma.TaskWhereInput = {
      OR: [
        { cleared: true, entryDate: null }, // R1 — cleared without entry
        { forecastDate: { lt: now }, cleared: false }, // R2 — forecast overdue, not cleared
        { entryDate: { not: null }, ...noChassis }, // R3a — entry given, no chassis
        { entryDate: { not: null }, ...noPlate }, // R3b — entry given, no plate
      ],
    };

    const [totalCount, armedCount, harshCount] = await this.prisma.$transaction([
      // count = EVERY matching task (armed OR resting) → the nav shows an indicator at all.
      this.prisma.task.count({ where: { AND: [inFlight, anyRule] } }),
      // armed = matching tasks the user has NOT viewed/snoozed → these BLINK (the rest are
      // resting: nav shows a static border instead). This is how the nav "follows" the row.
      this.prisma.task.count({ where: { AND: [inFlight, notSuppressed, anyRule] } }),
      // harsh (R2) → red vs amber.
      this.prisma.task.count({ where: { AND: [inFlight, { forecastDate: { lt: now }, cleared: false }] } }),
    ]);

    return { counts: { TASK: totalCount }, armed: { TASK: armedCount > 0 }, harsh: { TASK: harshCount > 0 } };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
