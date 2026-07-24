import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { UserId } from '../auth/decorators/user.decorator';
import { AttentionService, SendWarningInput } from './attention.service';
import { AttentionAckService, AckUpsertInput } from './attention-ack.service';

/**
 * HTTP surface for the attention system. Presence + entity-change flow over the
 * socket; this exposes the manual "send a warning" action and the ack/cooldown
 * persistence. Protected by the global JWT guard (no `@Public()`), so `@UserId()`
 * is always the authenticated caller.
 */
@Controller('attention')
export class AttentionController {
  constructor(
    private readonly attentionService: AttentionService,
    private readonly ackService: AttentionAckService,
  ) {}

  @Post('warnings')
  async sendWarning(@UserId() userId: string, @Body() body: SendWarningInput) {
    // The client supplies fromUserName (display only) inside the body when available.
    const result = await this.attentionService.sendWarning(userId, body.fromUserName, body);
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

  /** Upsert one ack (snooze / acknowledged / lastFired) for the caller. */
  @Put('ack')
  upsertAck(@UserId() userId: string, @Body() body: AckUpsertInput) {
    return this.ackService.upsert(userId, body);
  }
}
