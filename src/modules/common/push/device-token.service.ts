import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DeviceToken, Platform } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';

/**
 * Why a token stopped being usable. Stored on the row so a device that goes
 * quiet can be told apart from one the provider explicitly rejected.
 */
export const DEACTIVATION_REASON = {
  /** Provider said the token is dead (uninstalled / rotated / unregistered). */
  PROVIDER_REJECTED: 'PROVIDER_REJECTED',
  /** Too many consecutive delivery failures without a single success. */
  REPEATED_FAILURES: 'REPEATED_FAILURES',
  /** The same physical install registered a new token. */
  REPLACED_BY_SAME_DEVICE: 'REPLACED_BY_SAME_DEVICE',
  /** User has a fresher token and this one has not checked in for a long time. */
  STALE: 'STALE',
  /** No client check-in at all for an extreme amount of time. */
  ABANDONED: 'ABANDONED',
  /** Over the per-user cap; oldest check-ins dropped first. */
  OVER_LIMIT: 'OVER_LIMIT',
  /** Explicitly unregistered by the client (logout). */
  UNREGISTERED: 'UNREGISTERED',
} as const;

/**
 * Tokens minted by the retired Expo app (`ExponentPushToken[...]`).
 *
 * Push is FCM-only now — the Expo sending stack is gone. This check is the one
 * piece that has to stay: the old build is still installed on some phones and
 * still calls the register endpoint (last seen 2026-07-24), so without it those
 * devices keep inserting tokens nothing can deliver to, which is what left
 * users holding 3-5 "active" devices in the first place.
 */
export function isLegacyExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[/.test(token);
}

export type DeactivationReason =
  (typeof DEACTIVATION_REASON)[keyof typeof DEACTIVATION_REASON];

/**
 * How a provider error should be treated for the token that produced it.
 *
 * `TRANSIENT` covers everything that is the SERVER's or the network's problem —
 * counting those would deactivate every device of every user during an outage.
 */
export type FailureKind = 'DEAD' | 'TRANSIENT' | 'UNKNOWN';

const DAY_MS = 24 * 60 * 60 * 1000;

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Owns the DeviceToken lifecycle: registration, per-token delivery health and
 * the pruning that keeps a user from fanning every push out to a pile of dead
 * tokens.
 *
 * Every deactivation here is safe to get wrong: the mobile client re-asserts
 * its registration every 12 hours while authenticated, and registration flips
 * `isActive` back to true. A live device that gets pruned re-enables itself
 * within half a day; a dead one stays gone.
 */
@Injectable()
export class DeviceTokenService {
  private readonly logger = new Logger(DeviceTokenService.name);

  /** Retire a token this stale, but only when the user has a fresher one. */
  private readonly staleDays = envInt('PUSH_STALE_TOKEN_DAYS', 30);
  /** Retire a token this stale unconditionally — nobody has opened that app. */
  private readonly abandonedDays = envInt('PUSH_ABANDONED_TOKEN_DAYS', 120);
  /** Hard cap on simultaneously active tokens per user. */
  private readonly maxActivePerUser = envInt('PUSH_MAX_ACTIVE_TOKENS_PER_USER', 4);
  /** Consecutive non-transient failures tolerated before retiring a token. */
  private readonly failureThreshold = envInt('PUSH_FAILURE_THRESHOLD', 3);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Register (or re-assert) a token and retire the ones it supersedes.
   *
   * Returns the number of sibling tokens retired, for logging.
   */
  async register(
    userId: string,
    token: string,
    platform: Platform,
    deviceId?: string | null,
  ): Promise<{ token: DeviceToken; retired: number }> {
    if (isLegacyExpoToken(token)) {
      // An old build is still installed somewhere. Refuse the row outright
      // instead of storing a token no sender can use.
      throw new Error('Expo push tokens are no longer supported — update the app');
    }

    const now = new Date();

    const record = await this.prisma.deviceToken.upsert({
      where: { token },
      create: {
        userId,
        token,
        platform,
        deviceId: deviceId ?? null,
        isActive: true,
        lastRegisteredAt: now,
      },
      update: {
        userId,
        platform,
        // Never blank an existing deviceId when a client that does not send one
        // re-registers the same token.
        ...(deviceId ? { deviceId } : {}),
        isActive: true,
        lastRegisteredAt: now,
        // A fresh client check-in clears any prior verdict about this token.
        failureCount: 0,
        lastFailureAt: null,
        deactivatedAt: null,
        deactivationReason: null,
      },
    });

    const retired = await this.pruneUser(userId, record);

    return { token: record, retired };
  }

  /**
   * Retire the tokens of `userId` that the just-registered `current` token
   * supersedes. Conservative by design — a user may legitimately carry two
   * phones, so only tokens that are provably replaced or long silent go.
   */
  async pruneUser(userId: string, current?: DeviceToken | null): Promise<number> {
    const active = await this.prisma.deviceToken.findMany({
      where: { userId, isActive: true },
      orderBy: { lastRegisteredAt: 'desc' },
    });

    if (active.length <= 1) return 0;

    const currentId = current?.id;
    const newest = active[0];
    const staleBefore = new Date(Date.now() - this.staleDays * DAY_MS);

    const doomed = new Map<string, DeactivationReason>();

    for (const candidate of active) {
      if (candidate.id === currentId || candidate.id === newest.id) continue;

      // Same physical install as the token that just registered → the old token
      // cannot receive anything any more.
      if (current?.deviceId && candidate.deviceId && candidate.deviceId === current.deviceId) {
        doomed.set(candidate.id, DEACTIVATION_REASON.REPLACED_BY_SAME_DEVICE);
        continue;
      }

      // Another token for this user has checked in recently while this one has
      // been silent past the staleness window. The client re-asserts every 12h,
      // so a month of silence means that install is gone (uninstalled, replaced,
      // or upgraded to a build that issues a different token type).
      if (candidate.lastRegisteredAt < staleBefore) {
        doomed.set(candidate.id, DEACTIVATION_REASON.STALE);
      }
    }

    // Backstop: even if everything looks fresh, keep only the most recent N.
    const survivors = active.filter(t => !doomed.has(t.id));
    if (survivors.length > this.maxActivePerUser) {
      for (const extra of survivors.slice(this.maxActivePerUser)) {
        if (extra.id === currentId) continue;
        doomed.set(extra.id, DEACTIVATION_REASON.OVER_LIMIT);
      }
    }

    if (doomed.size === 0) return 0;

    let retired = 0;
    for (const [id, reason] of doomed) {
      const { count } = await this.prisma.deviceToken.updateMany({
        where: { id, isActive: true },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
          deactivationReason: reason,
        },
      });
      retired += count;
    }

    this.logger.log(
      `[TOKENS] Retired ${retired} superseded token(s) for user ${userId} ` +
        `(${active.length} active before, ${active.length - retired} after)`,
    );

    return retired;
  }

  async unregister(token: string): Promise<boolean> {
    const { count } = await this.prisma.deviceToken.updateMany({
      where: { token },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
        deactivationReason: DEACTIVATION_REASON.UNREGISTERED,
      },
    });
    return count > 0;
  }

  // ---------------------------------------------------------------------------
  // Delivery health
  // ---------------------------------------------------------------------------

  async getActiveTokens(userId: string): Promise<string[]> {
    const devices = await this.prisma.deviceToken.findMany({
      where: { userId, isActive: true },
      orderBy: { lastRegisteredAt: 'desc' },
      select: { token: true },
    });
    return devices.map(d => d.token);
  }

  /** A delivery went through: clear the failure streak. */
  async recordSuccess(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;

    try {
      await this.prisma.deviceToken.updateMany({
        where: { token: { in: tokens } },
        data: { lastSuccessAt: new Date(), failureCount: 0 },
      });
    } catch (error) {
      this.logger.warn(`[TOKENS] Failed to record delivery success: ${error.message}`);
    }
  }

  /**
   * A delivery failed.
   *
   * `DEAD` retires the token immediately. `UNKNOWN` only increments the streak,
   * and the token is retired once it crosses the threshold with no success in
   * between. `TRANSIENT` is ignored entirely — it says nothing about the token.
   */
  async recordFailure(tokens: string[], kind: FailureKind, detail?: string): Promise<void> {
    if (tokens.length === 0 || kind === 'TRANSIENT') return;

    try {
      if (kind === 'DEAD') {
        await this.deactivate(tokens, DEACTIVATION_REASON.PROVIDER_REJECTED, detail);
        return;
      }

      await this.prisma.deviceToken.updateMany({
        where: { token: { in: tokens } },
        data: { lastFailureAt: new Date(), failureCount: { increment: 1 } },
      });

      const exhausted = await this.prisma.deviceToken.findMany({
        where: {
          token: { in: tokens },
          isActive: true,
          failureCount: { gte: this.failureThreshold },
        },
        select: { token: true },
      });

      if (exhausted.length > 0) {
        await this.deactivate(
          exhausted.map(t => t.token),
          DEACTIVATION_REASON.REPEATED_FAILURES,
          `${this.failureThreshold} consecutive failures; last: ${detail ?? 'unknown'}`,
        );
      }
    } catch (error) {
      this.logger.warn(`[TOKENS] Failed to record delivery failure: ${error.message}`);
    }
  }

  async deactivate(
    tokens: string[],
    reason: DeactivationReason,
    detail?: string,
  ): Promise<number> {
    if (tokens.length === 0) return 0;

    try {
      const { count } = await this.prisma.deviceToken.updateMany({
        where: { token: { in: tokens }, isActive: true },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
          deactivationReason: detail ? `${reason}: ${detail}`.slice(0, 500) : reason,
          lastFailureAt: new Date(),
        },
      });

      if (count > 0) {
        this.logger.warn(`[TOKENS] Deactivated ${count} token(s) — ${reason}${detail ? ` (${detail})` : ''}`);
      }

      return count;
    } catch (error) {
      this.logger.error(`[TOKENS] Failed to deactivate tokens: ${error.message}`);
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Scheduled maintenance
  // ---------------------------------------------------------------------------

  /**
   * Nightly sweep for tokens that no send ever touches — a user who stopped
   * receiving notifications generates no failures to learn from, so staleness
   * has to be checked on a timer as well as at registration.
   */
  @Cron('20 4 * * *', { timeZone: 'America/Sao_Paulo' })
  async pruneStaleTokens(): Promise<{ abandoned: number; stale: number }> {
    const abandonedBefore = new Date(Date.now() - this.abandonedDays * DAY_MS);

    const abandoned = await this.prisma.deviceToken.updateMany({
      where: { isActive: true, lastRegisteredAt: { lt: abandonedBefore } },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
        deactivationReason: DEACTIVATION_REASON.ABANDONED,
      },
    });

    // Users still holding more than one active token get the same supersede
    // rules as at registration time.
    const multiDevice = await this.prisma.deviceToken.groupBy({
      by: ['userId'],
      where: { isActive: true },
      _count: { _all: true },
      having: { userId: { _count: { gt: 1 } } },
    });

    let stale = 0;
    for (const { userId } of multiDevice) {
      stale += await this.pruneUser(userId);
    }

    if (abandoned.count > 0 || stale > 0) {
      this.logger.log(
        `[TOKENS] Nightly prune: ${abandoned.count} abandoned, ${stale} stale/superseded`,
      );
    }

    return { abandoned: abandoned.count, stale };
  }

  /** Diagnostics for the admin endpoint. */
  async getHealthSummary(): Promise<{
    activeTokens: number;
    usersWithTokens: number;
    usersWithMultipleTokens: number;
    inactiveTokens: number;
  }> {
    const [activeTokens, inactiveTokens, byUser] = await Promise.all([
      this.prisma.deviceToken.count({ where: { isActive: true } }),
      this.prisma.deviceToken.count({ where: { isActive: false } }),
      this.prisma.deviceToken.groupBy({
        by: ['userId'],
        where: { isActive: true },
        _count: { _all: true },
      }),
    ]);

    return {
      activeTokens,
      usersWithTokens: byUser.length,
      usersWithMultipleTokens: byUser.filter(u => u._count._all > 1).length,
      inactiveTokens,
    };
  }
}
