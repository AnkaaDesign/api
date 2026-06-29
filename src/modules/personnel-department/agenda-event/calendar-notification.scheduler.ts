// calendar-notification.scheduler.ts
// Crons diários do calendário:
//   1) Lembretes de eventos da agenda (AgendaEvent) — codificação de
//      notifyDaysBefore (Int[]):
//        N > 0 ⇒ lembrete N dias antes do evento;
//        0     ⇒ lembrete no dia do evento (notifyOnDay legado também conta);
//        -1    ⇒ aviso de ATRASO, 1 dia após o evento.
//      Enviados pelos canais configurados no evento (in-app, push, e-mail,
//      WhatsApp) aos usuários/setores-alvo (ou somente ao criador quando não
//      há alvo). Idempotência: claim atômico em lastNotifiedAt (no máximo
//      1 envio por dia por evento — os dias de lembrete são dias distintos
//      por construção, inclusive o par "no dia" (D0) e "atraso" (D+1)).
//   2) Aniversariantes do dia — template 'user.birthday' para o colaborador
//      ativo cuja data de nascimento (dia/mês) é hoje + anúncio temático
//      'user.birthday.announcement' para TODOS os demais usuários ativos.
//      Idempotência: existência de notificação USER_BIRTHDAY (pessoal) /
//      USER_BIRTHDAY_ANNOUNCEMENT (anúncio) criada hoje para o aniversariante.

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationService } from '@modules/common/notification/notification.service';
import { NotificationTemplateService } from '@modules/common/notification/templates/notification-template.service';
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_TYPE,
} from '../../../constants';
import { EMPLOYED_USER_WHERE } from '../../../utils/contract';

const BIRTHDAY_RELATED_ENTITY_TYPE = 'USER_BIRTHDAY';
const BIRTHDAY_ANNOUNCEMENT_RELATED_ENTITY_TYPE = 'USER_BIRTHDAY_ANNOUNCEMENT';
const AGENDA_EVENT_RELATED_ENTITY_TYPE = 'AGENDA_EVENT';

// Sentinela de "aviso de atraso" dentro de notifyDaysBefore: -1 ⇒ notificar
// 1 dia APÓS a data do evento (daysUntil === -1).
const OVERDUE_SENTINEL = -1;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateBr(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()}`;
}

@Injectable()
export class CalendarNotificationScheduler {
  private readonly logger = new Logger(CalendarNotificationScheduler.name);
  private isProcessingAgenda = false;
  private isProcessingBirthdays = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly templateService: NotificationTemplateService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // 1) Lembretes de eventos da agenda — diário às 08:00 (horário de SP)
  // ───────────────────────────────────────────────────────────────────────────
  @Cron('0 8 * * *', { timeZone: 'America/Sao_Paulo' })
  async processAgendaEventReminders(): Promise<void> {
    if (this.isProcessingAgenda) {
      this.logger.warn('Processamento de lembretes da agenda já em andamento, pulando...');
      return;
    }
    this.isProcessingAgenda = true;

    try {
      const today = startOfDay(new Date());
      // Janela inclui ONTEM para cobrir o aviso de atraso (D+1).
      const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);

      // Eventos ativos de ontem em diante — lembretes antecipados (D-N),
      // do dia (D0) e de atraso (D+1).
      const events = await this.prisma.agendaEvent.findMany({
        where: {
          isActive: true,
          eventDate: { gte: yesterday },
        },
      });

      let sentEvents = 0;
      for (const event of events) {
        try {
          const eventDay = startOfDay(new Date(event.eventDate));
          const daysUntil = Math.round((eventDay.getTime() - today.getTime()) / 86_400_000);

          const reminders = event.notifyDaysBefore || [];
          // notifyOnDay legado equivale a 0 ∈ notifyDaysBefore (o service
          // mantém os dois em sincronia nas escritas novas).
          const shouldNotify =
            (daysUntil === 0 && (event.notifyOnDay || reminders.includes(0))) ||
            (daysUntil > 0 && reminders.includes(daysUntil)) ||
            (daysUntil === OVERDUE_SENTINEL && reminders.includes(OVERDUE_SENTINEL));
          if (!shouldNotify) continue;

          // Claim atômico: marca lastNotifiedAt hoje; se outra execução já
          // marcou hoje, count === 0 e este processo não envia nada.
          const claim = await this.prisma.agendaEvent.updateMany({
            where: {
              id: event.id,
              isActive: true,
              OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: today } }],
            },
            data: { lastNotifiedAt: new Date() },
          });
          if (claim.count === 0) continue;

          const recipientIds = await this.resolveRecipients(event);
          if (recipientIds.length === 0) {
            this.logger.warn(`Evento ${event.id} sem destinatários ativos — nada a enviar.`);
            continue;
          }

          const channels =
            event.channels && event.channels.length > 0
              ? event.channels
              : [NOTIFICATION_CHANNEL.IN_APP];

          const dateLabel = formatDateBr(eventDay);
          const descriptionSuffix = event.description ? ` ${event.description}` : '';
          let title: string;
          let body: string;
          if (daysUntil === 0) {
            title = `Hoje: ${event.title}`;
            body = `O evento "${event.title}" acontece hoje (${dateLabel}).${descriptionSuffix}`;
          } else if (daysUntil === OVERDUE_SENTINEL) {
            title = `Atraso: ${event.title}`;
            body = `O evento "${event.title}" estava marcado para ontem (${dateLabel}) e segue em aberto.${descriptionSuffix}`;
          } else {
            title = `Lembrete: ${event.title}`;
            body = `O evento "${event.title}" acontece em ${daysUntil} ${daysUntil === 1 ? 'dia' : 'dias'} (${dateLabel}).${descriptionSuffix}`;
          }

          for (const recipientId of recipientIds) {
            try {
              await this.notificationService.createNotification(
                {
                  userId: recipientId,
                  title,
                  body,
                  type: NOTIFICATION_TYPE.GENERAL,
                  channel: channels,
                  // Atraso é mais urgente que lembrete preventivo.
                  importance:
                    daysUntil === OVERDUE_SENTINEL
                      ? NOTIFICATION_IMPORTANCE.HIGH
                      : NOTIFICATION_IMPORTANCE.NORMAL,
                  actionType: null,
                  actionUrl: null,
                  scheduledAt: null,
                  relatedEntityType: AGENDA_EVENT_RELATED_ENTITY_TYPE,
                  relatedEntityId: event.id,
                  metadata: {
                    agendaEventId: event.id,
                    daysUntil,
                    eventDate: eventDay.toISOString(),
                  },
                } as any,
                undefined,
                // IMPORTANTE: não passar 'system' aqui — o changelog conecta
                // userId ao User por FK e 'system' não existe, derrubando a
                // transação inteira (notificação perdida). undefined ⇒
                // userId null + triggeredBy SYSTEM no changelog.
                undefined,
              );
            } catch (error) {
              this.logger.error(
                `Erro ao notificar usuário ${recipientId} sobre o evento ${event.id}:`,
                error,
              );
            }
          }

          sentEvents++;
          const reminderLabel =
            daysUntil === OVERDUE_SENTINEL ? 'atraso D+1' : daysUntil === 0 ? 'no dia (D0)' : `D-${daysUntil}`;
          this.logger.log(
            `Evento "${event.title}" (${event.id}): lembrete ${reminderLabel} enviado a ${recipientIds.length} destinatário(s) via [${channels.join(', ')}].`,
          );
        } catch (error) {
          this.logger.error(`Erro ao processar lembrete do evento ${event.id}:`, error);
        }
      }

      this.logger.log(
        `Lembretes da agenda processados: ${sentEvents} evento(s) notificado(s) de ${events.length} avaliado(s).`,
      );
    } catch (error) {
      this.logger.error('Erro no processamento de lembretes da agenda:', error);
    } finally {
      this.isProcessingAgenda = false;
    }
  }

  /**
   * Destinatários do evento: targetUserIds ∪ usuários ativos dos setores-alvo;
   * quando ambos vazios, somente o criador.
   */
  private async resolveRecipients(event: {
    targetUserIds: string[];
    targetSectorIds: string[];
    createdById: string;
  }): Promise<string[]> {
    const ids = new Set<string>();

    const hasTargets =
      (event.targetUserIds && event.targetUserIds.length > 0) ||
      (event.targetSectorIds && event.targetSectorIds.length > 0);

    if (!hasTargets) {
      ids.add(event.createdById);
    } else {
      for (const id of event.targetUserIds || []) ids.add(id);
      if (event.targetSectorIds && event.targetSectorIds.length > 0) {
        const sectorUsers = await this.prisma.user.findMany({
          where: { sectorId: { in: event.targetSectorIds }, ...EMPLOYED_USER_WHERE },
          select: { id: true },
        });
        for (const u of sectorUsers) ids.add(u.id);
      }
    }

    if (ids.size === 0) return [];

    // Apenas usuários ativos recebem.
    const activeUsers = await this.prisma.user.findMany({
      where: { id: { in: Array.from(ids) }, ...EMPLOYED_USER_WHERE },
      select: { id: true },
    });
    return activeUsers.map(u => u.id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2) Aniversariantes do dia — diário às 07:30 (horário de SP)
  // ───────────────────────────────────────────────────────────────────────────
  @Cron('30 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async processBirthdays(): Promise<void> {
    if (this.isProcessingBirthdays) {
      this.logger.warn('Processamento de aniversários já em andamento, pulando...');
      return;
    }
    this.isProcessingBirthdays = true;

    try {
      const today = startOfDay(new Date());
      const month = today.getMonth(); // 0-based
      const day = today.getDate();

      // 28/02 em ano não bissexto também celebra nascidos em 29/02.
      const isNonLeapFeb28 =
        month === 1 && day === 28 && !this.isLeapYear(today.getFullYear());

      const users = await this.prisma.user.findMany({
        where: { ...EMPLOYED_USER_WHERE, birth: { not: null } },
        select: { id: true, name: true, birth: true },
      });

      const birthdayUsers = users.filter(u => {
        if (!u.birth) return false;
        const b = new Date(u.birth);
        if (b.getMonth() === month && b.getDate() === day) return true;
        if (isNonLeapFeb28 && b.getMonth() === 1 && b.getDate() === 29) return true;
        return false;
      });

      if (birthdayUsers.length === 0) {
        this.logger.log('Nenhum aniversariante hoje.');
        return;
      }

      // Parabenização temática — o anúncio vai para TODOS os usuários ativos
      // (inclusive sem data de nascimento cadastrada), exceto o próprio
      // aniversariante, que recebe a mensagem pessoal 'user.birthday'.
      const allActiveUsers = await this.prisma.user.findMany({
        where: { ...EMPLOYED_USER_WHERE },
        select: { id: true },
      });

      let sent = 0;
      let announced = 0;
      for (const user of birthdayUsers) {
        try {
          // Idempotência por dia: já existe notificação de aniversário hoje?
          const existing = await this.prisma.notification.findFirst({
            where: {
              userId: user.id,
              relatedEntityType: BIRTHDAY_RELATED_ENTITY_TYPE,
              relatedEntityId: user.id,
              createdAt: { gte: today },
            },
            select: { id: true },
          });
          if (existing) {
            // Mensagem pessoal já enviada hoje — pula direto ao anúncio
            // (que tem idempotência própria abaixo).
          } else {
            const rendered = this.templateService.render('user.birthday', {
              userName: user.name,
            });

            await this.notificationService.createNotification(
              {
                userId: user.id,
                title: rendered.title,
                body: rendered.body,
                type: NOTIFICATION_TYPE.USER,
                channel: rendered.channels || [NOTIFICATION_CHANNEL.IN_APP],
                importance: rendered.importance || NOTIFICATION_IMPORTANCE.NORMAL,
                actionType: rendered.actionType ?? null,
                actionUrl: null,
                scheduledAt: null,
                relatedEntityType: BIRTHDAY_RELATED_ENTITY_TYPE,
                relatedEntityId: user.id,
                metadata: { templateKey: 'user.birthday' },
              } as any,
              undefined,
              // undefined ⇒ changelog com userId null + triggeredBy SYSTEM
              // ('system' literal quebraria o connect por FK no ChangeLog).
              undefined,
            );
            sent++;
          }

          // Anúncio temático para toda a empresa. Idempotência por dia: a
          // existência de QUALQUER anúncio de hoje para este aniversariante
          // pula o fan-out inteiro (mesma granularidade diária do pessoal).
          const existingAnnouncement = await this.prisma.notification.findFirst({
            where: {
              relatedEntityType: BIRTHDAY_ANNOUNCEMENT_RELATED_ENTITY_TYPE,
              relatedEntityId: user.id,
              createdAt: { gte: today },
            },
            select: { id: true },
          });
          if (existingAnnouncement) continue;

          const announcement = this.templateService.render('user.birthday.announcement', {
            userName: user.name,
          });

          for (const recipient of allActiveUsers) {
            if (recipient.id === user.id) continue;
            try {
              await this.notificationService.createNotification(
                {
                  userId: recipient.id,
                  title: announcement.title,
                  body: announcement.body,
                  type: NOTIFICATION_TYPE.USER,
                  channel: announcement.channels || [NOTIFICATION_CHANNEL.IN_APP],
                  importance: announcement.importance || NOTIFICATION_IMPORTANCE.NORMAL,
                  actionType: announcement.actionType ?? null,
                  actionUrl: null,
                  scheduledAt: null,
                  relatedEntityType: BIRTHDAY_ANNOUNCEMENT_RELATED_ENTITY_TYPE,
                  relatedEntityId: user.id,
                  metadata: { templateKey: 'user.birthday.announcement', birthdayUserId: user.id },
                } as any,
                undefined,
                undefined,
              );
              announced++;
            } catch (error) {
              this.logger.error(
                `Erro ao anunciar aniversário de ${user.id} ao usuário ${recipient.id}:`,
                error,
              );
            }
          }
        } catch (error) {
          this.logger.error(`Erro ao enviar parabéns ao usuário ${user.id}:`, error);
        }
      }

      this.logger.log(
        `Aniversários processados: ${sent} parabéns pessoal(is) + ${announced} anúncio(s) para ${birthdayUsers.length} aniversariante(s).`,
      );
    } catch (error) {
      this.logger.error('Erro no processamento de aniversários:', error);
    } finally {
      this.isProcessingBirthdays = false;
    }
  }

  private isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }
}
