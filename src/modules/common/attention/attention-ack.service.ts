import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AckUpsertInput {
  ruleId: string;
  entityType: string;
  entityId: string;
  /** Epoch ms (client `AckRecord` uses numbers); 0/absent = clear. */
  snoozeUntil?: number | null;
  acknowledged?: boolean;
  lastFiredAt?: number | null;
}

/** Wire-shape returned to the client (epoch ms so it maps straight onto AckRecord). */
export interface AckDto {
  ruleId: string;
  entityType: string;
  entityId: string;
  snoozeUntil: number;
  acknowledged: boolean;
  lastFiredAt: number;
}

/**
 * Server-side persistence of attention acknowledge / cooldown state so the
 * "already saw it" + 30-min snooze survive reloads and follow the user across
 * devices. The client keeps a localStorage cache and syncs against these.
 */
@Injectable()
export class AttentionAckService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<AckDto[]> {
    const rows = await this.prisma.attentionAck.findMany({ where: { userId } });
    return rows.map((r) => ({
      ruleId: r.ruleId,
      entityType: r.entityType,
      entityId: r.entityId,
      snoozeUntil: r.snoozeUntil ? r.snoozeUntil.getTime() : 0,
      acknowledged: r.acknowledged,
      lastFiredAt: r.lastFiredAt ? r.lastFiredAt.getTime() : 0,
    }));
  }

  async upsert(userId: string, input: AckUpsertInput): Promise<{ success: true }> {
    if (!input?.ruleId || !input?.entityType || !input?.entityId) {
      throw new BadRequestException('ruleId, entityType e entityId são obrigatórios');
    }
    const snoozeUntil = input.snoozeUntil ? new Date(input.snoozeUntil) : null;
    const lastFiredAt = input.lastFiredAt ? new Date(input.lastFiredAt) : null;
    const acknowledged = input.acknowledged ?? false;

    await this.prisma.attentionAck.upsert({
      where: {
        userId_ruleId_entityId: { userId, ruleId: input.ruleId, entityId: input.entityId },
      },
      create: {
        userId,
        ruleId: input.ruleId,
        entityType: input.entityType,
        entityId: input.entityId,
        snoozeUntil,
        acknowledged,
        lastFiredAt,
      },
      update: { snoozeUntil, acknowledged, lastFiredAt, entityType: input.entityType },
    });
    return { success: true };
  }
}
