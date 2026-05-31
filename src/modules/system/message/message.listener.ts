import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { MessagePublishedEvent } from './message.events';

/**
 * MessageListener handles message/announcement events and dispatches notifications
 * using the database configuration-based approach (checks config enablement + user preferences).
 *
 * Config keys:
 * - message.published
 */
@Injectable()
export class MessageListener {
  private readonly logger = new Logger(MessageListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly dispatchService: NotificationDispatchService,
  ) {
    this.registerEventListeners();
  }

  /**
   * Register all event listeners
   */
  private registerEventListeners(): void {
    this.eventEmitter.on('message.published', this.handleMessagePublished.bind(this));

    this.logger.log('Message event listeners registered successfully');
  }

  /**
   * Handle message published event.
   * When the message has explicit targets, notify only those users; otherwise
   * dispatch by configuration (the config target rule covers all sectors / all users).
   */
  async handleMessagePublished(event: MessagePublishedEvent): Promise<void> {
    try {
      const { message, targetUserIds, createdBy } = event;
      this.logger.log(
        `Handling message published event for message ${message.id} (${targetUserIds.length} explicit target(s))`,
      );

      // Short pt-BR body. The message content is block JSON; never dump it here.
      const title = message.title;
      const body = `Nova mensagem disponível: "${title}".`;

      const context = {
        entityType: 'MESSAGE',
        entityId: message.id,
        action: 'published',
        data: {
          title,
        },
        overrides: {
          title,
          body,
          webUrl: '/pessoal/mensagens',
          relatedEntityType: 'MESSAGE',
        },
      };

      if (targetUserIds.length > 0) {
        await this.dispatchService.dispatchByConfigurationToUsers(
          'message.published',
          createdBy,
          context,
          targetUserIds,
        );
      } else {
        // No explicit targets => ALL active users (config target rule covers all sectors)
        await this.dispatchService.dispatchByConfiguration('message.published', createdBy, context);
      }
    } catch (error) {
      this.logger.error('Error handling message published event:', error);
    }
  }
}
