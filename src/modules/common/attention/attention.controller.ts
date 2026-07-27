import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { UserId } from '../auth/decorators/user.decorator';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { attentionAckUpsertSchema, attentionSendWarningSchema } from '@schemas/attention';
import { AttentionService, SendWarningInput } from './attention.service';
import { AttentionAckService, AckUpsertInput } from './attention-ack.service';
import { AttentionGateway } from './attention.gateway';

/**
 * HTTP surface for the attention system. Presence + entity-change flow over the
 * socket; this exposes the manual "send a warning" action, the ack/cooldown
 * persistence, and a point-in-time presence read used as a save-time override guard.
 * Protected by the global JWT guard (no `@Public()`), so `@UserId()` is always the
 * authenticated caller.
 */
@Controller('attention')
export class AttentionController {
  constructor(
    private readonly attentionService: AttentionService,
    private readonly ackService: AttentionAckService,
    private readonly gateway: AttentionGateway,
  ) {}

  @Post('warnings')
  async sendWarning(
    @UserId() userId: string,
    @Body(new ZodValidationPipe(attentionSendWarningSchema)) body: SendWarningInput,
  ) {
    const result = await this.attentionService.sendWarning(userId, body);
    return { success: true, ...result };
  }

  /** The caller's persisted acks — the client hydrates its cooldown state from this. */
  @Get('ack')
  listAcks(@UserId() userId: string) {
    return this.ackService.list(userId);
  }

  /**
   * Global attention counts for the caller's sector — independent of what the
   * client currently has loaded/registered. Drives the nav-menu blink from pages
   * (e.g. the dashboard) that never load the underlying entities themselves.
   */
  @Get('summary')
  getSummary(@UserId() userId: string) {
    return this.attentionService.getSummary(userId);
  }

  /**
   * Who is editing this entity RIGHT NOW, read straight from the gateway's registry.
   *
   * The socket already streams `presence:update`, so the UI does not need this to
   * render a badge. It exists for the SAVE-TIME check: a client is about to write and
   * wants a definitive answer rather than trusting its own possibly-stale socket state
   * (dropped connection, events missed while backgrounded). Cheap — an in-memory lookup.
   */
  @Get('presence/:entityType/:entityId')
  getPresence(@Param('entityType') entityType: string, @Param('entityId') entityId: string) {
    return { editors: this.gateway.getEditors(entityType, entityId) };
  }

  /** Upsert one ack (snooze / acknowledged / lastFired) for the caller. */
  @Put('ack')
  upsertAck(
    @UserId() userId: string,
    @Body(new ZodValidationPipe(attentionAckUpsertSchema)) body: AckUpsertInput,
  ) {
    return this.ackService.upsert(userId, body);
  }
}
