import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { normalizeSearchTerm } from '@schemas';
import { EMPLOYED_USER_WHERE } from '@utils/contract';
import { calculateNextRunDate } from '@utils/schedule-recurrence';
import type { RecurringSchedule } from '@utils/schedule-recurrence';
import { SCHEDULE_FREQUENCY, SCHEDULE_RUN_STATUS } from '../../../constants/enums';
import { MessagePublishedEvent } from './message.events';
import {
  addCalendarDays,
  atSaoPauloHour,
  compareCalendarDays,
  endOfDisplayDay,
  endOfSaoPauloDay,
  fromProcessLocalDay,
  saoPauloCalendarDay,
  startOfDisplayDay,
  toProcessLocalDay,
} from './message-scheduling.util';
import {
  CreateMessageScheduleDto,
  UpdateMessageScheduleDto,
  FilterMessageScheduleDto,
  MESSAGE_SCHEDULE_STATUS,
  MESSAGE_TARGET_TYPE,
} from './dto';
import type { Message, MessageSchedule, Prisma } from '@prisma/client';

/** O que aconteceu numa tentativa de materializar uma ocorrência. */
export interface MaterializeResult {
  status: SCHEDULE_RUN_STATUS;
  /** A mensagem criada, ou null quando nada foi publicado. */
  message: Message | null;
  /** Motivo legível, para log e para `lastRunError`. */
  reason?: string;
  /** Data-calendário da ocorrência tentada. */
  occurrenceDate: Date;
}

const SCHEDULE_INCLUDE = {
  weeklyConfig: true,
  monthlyConfig: true,
  yearlyConfig: true,
} as const;

/** Colunas pelas quais a listagem aceita ordenar. */
const SORTABLE = new Set([
  'name',
  'title',
  'frequency',
  'nextRun',
  'lastRun',
  'isActive',
  'occurrenceCount',
  'createdAt',
  'updatedAt',
]);

/**
 * Agendamentos de comunicado recorrente.
 *
 * O serviço faz três coisas distintas e vale separar na cabeça:
 *   1. CRUD da REGRA (com o cálculo de `nextRun` a cada escrita);
 *   2. RESOLUÇÃO DO PÚBLICO a partir da regra, no instante do disparo;
 *   3. MATERIALIZAÇÃO da ocorrência — criar a `Message` filha e anunciá-la.
 *
 * Quem chama (2) e (3) é o `MessageScheduleScheduler` (cron) ou o `run-now` do
 * controller. Toda a matemática de datas mora em `@utils/schedule-recurrence`,
 * compartilhada com os agendamentos de pedido.
 */
@Injectable()
export class MessageScheduleService {
  private readonly logger = new Logger(MessageScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {}

  // =====================================================================
  // Validação
  // =====================================================================

  /**
   * A recorrência descreve mesmo um instante futuro?
   *
   * Uma frequência SEMANAL sem nenhum dia marcado, ou MENSAL sem dia nem
   * ocorrência, faz `calculateNextRunDate` devolver `null` — e um agendamento
   * com `nextRun` nulo fica vivo, ativo e mudo para sempre. Barrar na escrita é
   * mais barato do que descobrir isso três semanas depois.
   */
  private validateRecurrence(dto: CreateMessageScheduleDto | UpdateMessageScheduleDto): void {
    const freq = dto.frequency;
    if (!freq) return;

    const weeklyFamily: string[] = [SCHEDULE_FREQUENCY.WEEKLY, SCHEDULE_FREQUENCY.BIWEEKLY];
    const monthlyFamily: string[] = [
      SCHEDULE_FREQUENCY.MONTHLY,
      SCHEDULE_FREQUENCY.BIMONTHLY,
      SCHEDULE_FREQUENCY.QUARTERLY,
      SCHEDULE_FREQUENCY.TRIANNUAL,
      SCHEDULE_FREQUENCY.QUADRIMESTRAL,
      SCHEDULE_FREQUENCY.SEMI_ANNUAL,
    ];

    if (weeklyFamily.includes(freq)) {
      const w = dto.weeklyConfig;
      const anyDay =
        w &&
        (w.monday || w.tuesday || w.wednesday || w.thursday || w.friday || w.saturday || w.sunday);
      if (!anyDay) {
        throw new BadRequestException(
          'Selecione pelo menos um dia da semana para a recorrência semanal',
        );
      }
    }

    if (monthlyFamily.includes(freq)) {
      const m = dto.monthlyConfig;
      const hasDay = m?.dayOfMonth !== null && m?.dayOfMonth !== undefined;
      const hasOccurrence = !!m?.occurrence && !!m?.dayOfWeek;
      if (!hasDay && !hasOccurrence) {
        throw new BadRequestException(
          'Informe o dia do mês (ex.: dia 5) ou a ocorrência com o dia da semana (ex.: primeira segunda-feira)',
        );
      }
    }

    if (freq === SCHEDULE_FREQUENCY.ANNUAL) {
      const y = dto.yearlyConfig;
      if (!y?.month) {
        throw new BadRequestException('Informe o mês para a recorrência anual');
      }
      const hasDay = y.dayOfMonth !== null && y.dayOfMonth !== undefined;
      const hasOccurrence = !!y.occurrence && !!y.dayOfWeek;
      if (!hasDay && !hasOccurrence) {
        throw new BadRequestException(
          'Informe o dia do mês ou a ocorrência com o dia da semana para a recorrência anual',
        );
      }
    }

    if (freq === SCHEDULE_FREQUENCY.CUSTOM && !dto.customMonths?.length) {
      throw new BadRequestException('Selecione pelo menos um mês para a frequência personalizada');
    }

    if (freq === SCHEDULE_FREQUENCY.ONCE) {
      throw new BadRequestException(
        'Frequência ONCE não faz sentido em um agendamento recorrente; publique a mensagem diretamente',
      );
    }
  }

  /**
   * O público é uma regra que precisa selecionar alguém.
   *
   * ⚠️ Lista vazia em SECTOR/POSITION/SPECIFIC NÃO pode virar broadcast. Em
   * `Message`, "sem alvos" significa literalmente "toda a empresa" — é assim que
   * `canUserViewMessage` lê. Um agendamento de setor cujo público resolvesse
   * para vazio publicaria para todo mundo. Barra-se aqui na escrita, e o cron
   * barra de novo no disparo (`resolveAudience`).
   */
  private validateTargeting(dto: CreateMessageScheduleDto | UpdateMessageScheduleDto): void {
    switch (dto.targetType) {
      case MESSAGE_TARGET_TYPE.SECTOR:
        if (!dto.targetSectorIds?.length) {
          throw new BadRequestException('Selecione pelo menos um setor');
        }
        break;
      case MESSAGE_TARGET_TYPE.POSITION:
        if (!dto.targetPositionIds?.length) {
          throw new BadRequestException('Selecione pelo menos um cargo');
        }
        break;
      case MESSAGE_TARGET_TYPE.SPECIFIC:
        if (!dto.targetUserIds?.length) {
          throw new BadRequestException('Selecione pelo menos um usuário');
        }
        break;
      default:
        break;
    }
  }

  /** Mesmos blocos de conteúdo aceitos por `MessageService.create`. */
  private normalizeContentBlocks(contentBlocks: any[] | any): any[] {
    if (!contentBlocks) {
      throw new BadRequestException('É necessário pelo menos um bloco de conteúdo');
    }
    if (Array.isArray(contentBlocks)) {
      if (contentBlocks.length === 0) {
        throw new BadRequestException('É necessário pelo menos um bloco de conteúdo');
      }
      return contentBlocks;
    }
    if (typeof contentBlocks === 'object') {
      // O body parser às vezes converte array em objeto de chaves numéricas.
      const keys = Object.keys(contentBlocks);
      if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
        return keys.sort((a, b) => Number(a) - Number(b)).map(k => contentBlocks[k]);
      }
    }
    throw new BadRequestException('Formato de conteúdo inválido');
  }

  // =====================================================================
  // Cálculo de datas
  // =====================================================================

  /**
   * Materializa a data devolvida pelo motor como o instante em que a ocorrência
   * entra no ar: `publishHour` no relógio de São Paulo.
   *
   * Sem isto, a ocorrência de segunda entraria no ar no primeiro tick depois da
   * meia-noite e o push chegaria às 00h10.
   *
   * ⚠️ `day` vem do motor de recorrência, que trabalha no relógio DO PROCESSO —
   * é meia-noite LOCAL, não um instante com significado próprio. Ler seus campos
   * de calendário (`fromProcessLocalDay`) é o certo; reinterpretar o INSTANTE em
   * São Paulo era o defeito que fazia todo comunicado sair um dia antes num
   * processo em UTC, que é como a API roda em produção.
   */
  private atPublishHour(day: Date, publishHour: number): Date {
    return atSaoPauloHour(fromProcessLocalDay(day), publishHour);
  }

  /**
   * Próximo disparo ESTRITAMENTE no futuro.
   *
   * O laço existe para agendamento atrasado (servidor fora do ar, agendamento
   * retomado depois de pausa longa): avança ciclo a ciclo até passar de `now`,
   * em vez de despejar as ocorrências perdidas. Comunicado é perecível — o aviso
   * de três segundas atrás não interessa a ninguém.
   */
  computeNextRun(
    schedule: RecurringSchedule & { publishHour?: number; startsOn?: Date | null },
    fromDate?: Date | null,
    now: Date = new Date(),
  ): Date | null {
    const publishHour = schedule.publishHour ?? 8;

    // O motor raciocina em dia-calendário no relógio DO PROCESSO; converta o
    // instante para o dia de SÃO PAULO e entregue esse dia, não o instante —
    // senão, com a API em UTC, "segunda" vira o domingo anterior.
    let baseDay = saoPauloCalendarDay(fromDate ?? now);
    if (schedule.startsOn) {
      const startDay = saoPauloCalendarDay(schedule.startsOn);
      if (compareCalendarDays(startDay, baseDay) > 0) {
        // Um agendamento com início marcado para o futuro não pode disparar antes.
        // Recuar um dia faz o motor considerar o próprio `startsOn` como candidato.
        baseDay = addCalendarDays(startDay, -1);
      }
    }

    let day = calculateNextRunDate(
      { ...schedule, clampDayOfMonth: true },
      toProcessLocalDay(baseDay),
    );
    let guard = 0;
    while (day && this.atPublishHour(day, publishHour).getTime() <= now.getTime() && guard < 200) {
      day = calculateNextRunDate({ ...schedule, clampDayOfMonth: true }, day);
      guard++;
    }
    if (!day) return null;

    const next = this.atPublishHour(day, publishHour);
    // Fora da vigência: acabou.
    if (schedule.startsOn && next.getTime() < startOfDisplayDay(schedule.startsOn).getTime()) {
      return null;
    }
    return next;
  }

  /**
   * As próximas N datas de disparo, sem gravar nada. Alimenta a prévia
   * "Próximas: 01/09, 08/09, 15/09" do compositor, para o autor conferir a regra
   * ANTES de salvar — que é onde erro de recorrência custa mais barato.
   */
  previewOccurrences(dto: CreateMessageScheduleDto, count = 5): Date[] {
    this.validateRecurrence(dto);

    const probe = this.toRecurringShape(dto);
    const out: Date[] = [];
    const now = new Date();
    let cursor: Date | null = this.computeNextRun(probe, null, now);
    const endsOn = dto.endsOn ? endOfDisplayDay(dto.endsOn) : null;
    const max = dto.maxOccurrences ?? Infinity;

    while (cursor && out.length < count && out.length < max) {
      if (endsOn && cursor.getTime() > endsOn.getTime()) break;
      out.push(cursor);
      cursor = this.computeNextRun(probe, cursor, cursor);
    }
    return out;
  }

  /** Adapta um DTO à forma estrutural que o motor de recorrência espera. */
  private toRecurringShape(
    dto: CreateMessageScheduleDto | UpdateMessageScheduleDto,
  ): RecurringSchedule & { publishHour: number; startsOn: Date | null } {
    return {
      isActive: true,
      frequency: dto.frequency as string,
      frequencyCount: dto.frequencyCount ?? 1,
      lastRun: null,
      dayOfMonth: dto.dayOfMonth ?? null,
      customMonths: (dto.customMonths as string[] | undefined) ?? null,
      weeklyConfig: dto.weeklyConfig
        ? {
            monday: !!dto.weeklyConfig.monday,
            tuesday: !!dto.weeklyConfig.tuesday,
            wednesday: !!dto.weeklyConfig.wednesday,
            thursday: !!dto.weeklyConfig.thursday,
            friday: !!dto.weeklyConfig.friday,
            saturday: !!dto.weeklyConfig.saturday,
            sunday: !!dto.weeklyConfig.sunday,
          }
        : null,
      monthlyConfig: dto.monthlyConfig
        ? {
            dayOfMonth: dto.monthlyConfig.dayOfMonth ?? null,
            occurrence: (dto.monthlyConfig.occurrence as string | null) ?? null,
            dayOfWeek: (dto.monthlyConfig.dayOfWeek as string | null) ?? null,
          }
        : null,
      yearlyConfig: dto.yearlyConfig
        ? {
            month: dto.yearlyConfig.month as string,
            dayOfMonth: dto.yearlyConfig.dayOfMonth ?? null,
            occurrence: (dto.yearlyConfig.occurrence as string | null) ?? null,
            dayOfWeek: (dto.yearlyConfig.dayOfWeek as string | null) ?? null,
          }
        : null,
      publishHour: dto.publishHour ?? 8,
      startsOn: dto.startsOn ? startOfDisplayDay(dto.startsOn) : null,
      // Comunicado APARA o dia do mês: "todo dia 31" tem de sair em 28/fev, não
      // pular fevereiro inteiro em silêncio. Os agendamentos de pedido/EPI/
      // manutenção continuam com o comportamento herdado (a bandeira é opt-in).
      clampDayOfMonth: true,
    };
  }

  // =====================================================================
  // CRUD
  // =====================================================================

  async create(dto: CreateMessageScheduleDto, createdById: string): Promise<MessageSchedule> {
    this.validateRecurrence(dto);
    this.validateTargeting(dto);
    const contentBlocks = this.normalizeContentBlocks(dto.contentBlocks);

    const isActive = dto.isActive ?? true;
    const nextRun = isActive ? this.computeNextRun(this.toRecurringShape(dto)) : null;

    if (isActive && !nextRun) {
      throw new BadRequestException(
        'A recorrência informada não produz nenhuma data futura; revise a configuração',
      );
    }

    // Vigência que já nasce vencida: o agendamento ficaria ativo até o primeiro
    // tick do cron descobrir e encerrá-lo. Barrar aqui poupa o autor de achar
    // que agendou algo que nunca vai sair.
    const endsOn = dto.endsOn ? endOfDisplayDay(dto.endsOn) : null;
    if (isActive && endsOn && nextRun && nextRun.getTime() > endsOn.getTime()) {
      throw new BadRequestException(
        'A vigência termina antes da primeira publicação; ajuste as datas ou a recorrência',
      );
    }

    try {
      return await this.prisma.messageSchedule.create({
        data: {
          name: dto.name,
          title: dto.title,
          content: { blocks: contentBlocks },
          isDismissible: dto.isDismissible ?? true,
          requiresView: dto.requiresView ?? false,

          targetType: dto.targetType as any,
          targetUserIds: dto.targetUserIds ?? [],
          targetSectorIds: dto.targetSectorIds ?? [],
          targetPositionIds: dto.targetPositionIds ?? [],

          frequency: dto.frequency as any,
          frequencyCount: dto.frequencyCount ?? 1,
          dayOfMonth: dto.dayOfMonth ?? null,
          customMonths: (dto.customMonths ?? []) as any,
          ...this.buildConfigCreate(dto),

          displayDurationDays: dto.displayDurationDays ?? 7,
          publishHour: dto.publishHour ?? 8,

          startsOn: dto.startsOn ? startOfDisplayDay(dto.startsOn) : null,
          endsOn,
          maxOccurrences: dto.maxOccurrences ?? null,

          isActive,
          nextRun,
          // `connect` e não `createdById` cru: misturar FK escalar com escrita
          // aninhada (`weeklyConfig.create`) é o par checked/unchecked que o
          // Prisma recusa — os dois formatos são mutuamente exclusivos.
          createdBy: { connect: { id: createdById } },
        },
        include: SCHEDULE_INCLUDE,
      });
    } catch (error) {
      this.logger.error('Erro ao criar agendamento de mensagem:', error);
      throw new InternalServerErrorException('Falha ao criar agendamento de mensagem');
    }
  }

  /** Os três configs compartilhados são criados junto com o agendamento. */
  private buildConfigCreate(dto: CreateMessageScheduleDto | UpdateMessageScheduleDto) {
    return {
      ...(dto.weeklyConfig
        ? {
            weeklyConfig: {
              create: {
                monday: !!dto.weeklyConfig.monday,
                tuesday: !!dto.weeklyConfig.tuesday,
                wednesday: !!dto.weeklyConfig.wednesday,
                thursday: !!dto.weeklyConfig.thursday,
                friday: !!dto.weeklyConfig.friday,
                saturday: !!dto.weeklyConfig.saturday,
                sunday: !!dto.weeklyConfig.sunday,
              },
            },
          }
        : {}),
      ...(dto.monthlyConfig
        ? {
            monthlyConfig: {
              create: {
                dayOfMonth: dto.monthlyConfig.dayOfMonth ?? null,
                occurrence: (dto.monthlyConfig.occurrence ?? null) as any,
                dayOfWeek: (dto.monthlyConfig.dayOfWeek ?? null) as any,
              },
            },
          }
        : {}),
      ...(dto.yearlyConfig
        ? {
            yearlyConfig: {
              create: {
                month: dto.yearlyConfig.month as any,
                dayOfMonth: dto.yearlyConfig.dayOfMonth ?? null,
                occurrence: (dto.yearlyConfig.occurrence ?? null) as any,
                dayOfWeek: (dto.yearlyConfig.dayOfWeek ?? null) as any,
              },
            },
          }
        : {}),
    };
  }

  async findAll(filters: FilterMessageScheduleDto) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.MessageScheduleWhereInput = {};
    if (typeof filters.isActive === 'boolean') where.isActive = filters.isActive;

    // As três situações da interface. ENCERRADO não é um valor gravado: é
    // `finishedAt` preenchido — e sem separá-lo de PAUSADO os dois cairiam no
    // mesmo balde de `isActive = false`.
    //
    // ⚠️ Vai em `AND`, e não em `where.OR`: a busca por texto logo abaixo também
    // é um OR, e o segundo a escrever apagaria o primeiro — filtrar "pausado" e
    // digitar no campo de busca devolveria os pausados MAIS todo mundo cujo
    // título casasse, em vez da interseção.
    const and: Prisma.MessageScheduleWhereInput[] = [];

    if (filters.status?.length) {
      const clauses: Prisma.MessageScheduleWhereInput[] = [];
      if (filters.status.includes(MESSAGE_SCHEDULE_STATUS.ACTIVE)) {
        clauses.push({ isActive: true, finishedAt: null });
      }
      if (filters.status.includes(MESSAGE_SCHEDULE_STATUS.PAUSED)) {
        clauses.push({ isActive: false, finishedAt: null });
      }
      if (filters.status.includes(MESSAGE_SCHEDULE_STATUS.FINISHED)) {
        clauses.push({ finishedAt: { not: null } });
      }
      if (clauses.length) and.push({ OR: clauses });
    }

    if (filters.frequency?.length) where.frequency = { in: filters.frequency as any };
    if (filters.targetType?.length) where.targetType = { in: filters.targetType as any };
    if (filters.searchingFor?.trim()) {
      const term = normalizeSearchTerm(filters.searchingFor.trim());
      and.push({
        OR: [{ nameNormalized: { contains: term } }, { titleNormalized: { contains: term } }],
      });
    }

    if (and.length) where.AND = and;

    // Lista branca: `sortBy` chega da querystring e um campo inexistente
    // derrubaria a listagem inteira com 500 (mesma armadilha já corrigida em
    // MessageService.findAll).
    const sortBy = filters.sortBy && SORTABLE.has(filters.sortBy) ? filters.sortBy : 'createdAt';
    const sortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';

    const [rows, total] = await Promise.all([
      this.prisma.messageSchedule.findMany({
        where,
        include: {
          ...SCHEDULE_INCLUDE,
          createdBy: { select: { id: true, name: true } },
          _count: { select: { occurrences: true } },
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.messageSchedule.count({ where }),
    ]);

    return { data: rows, total, page, limit };
  }

  async findOne(id: string) {
    const schedule = await this.prisma.messageSchedule.findUnique({
      where: { id },
      include: {
        ...SCHEDULE_INCLUDE,
        createdBy: { select: { id: true, name: true } },
        // As ocorrências recentes contam a história do agendamento melhor que
        // qualquer contador: quando saiu, para quantos, quantos leram.
        occurrences: {
          orderBy: { occurrenceDate: 'desc' },
          take: 12,
          select: {
            id: true,
            title: true,
            status: true,
            occurrenceDate: true,
            publishedAt: true,
            startDate: true,
            endDate: true,
            _count: { select: { targets: true, views: true } },
          },
        },
        _count: { select: { occurrences: true } },
      },
    });
    if (!schedule) {
      throw new NotFoundException(`Agendamento ${id} não encontrado`);
    }
    return schedule;
  }

  async update(id: string, dto: UpdateMessageScheduleDto): Promise<MessageSchedule> {
    const current = await this.prisma.messageSchedule.findUnique({
      where: { id },
      include: SCHEDULE_INCLUDE,
    });
    if (!current) {
      throw new NotFoundException(`Agendamento ${id} não encontrado`);
    }

    // A validação precisa enxergar o estado RESULTANTE, não só o que veio no
    // corpo: trocar de MONTHLY para WEEKLY sem mandar `weeklyConfig` junto
    // passaria batido se olhássemos apenas o DTO.
    const merged = this.mergeForValidation(current, dto);
    this.validateRecurrence(merged);
    this.validateTargeting(merged);

    const data: Prisma.MessageScheduleUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.contentBlocks !== undefined) {
      data.content = { blocks: this.normalizeContentBlocks(dto.contentBlocks) };
    }
    if (dto.isDismissible !== undefined) data.isDismissible = dto.isDismissible;
    if (dto.requiresView !== undefined) data.requiresView = dto.requiresView;

    if (dto.targetType !== undefined) data.targetType = dto.targetType as any;
    if (dto.targetUserIds !== undefined) data.targetUserIds = dto.targetUserIds;
    if (dto.targetSectorIds !== undefined) data.targetSectorIds = dto.targetSectorIds;
    if (dto.targetPositionIds !== undefined) data.targetPositionIds = dto.targetPositionIds;

    if (dto.frequency !== undefined) data.frequency = dto.frequency as any;
    if (dto.frequencyCount !== undefined) data.frequencyCount = dto.frequencyCount;
    if (dto.dayOfMonth !== undefined) data.dayOfMonth = dto.dayOfMonth;
    if (dto.customMonths !== undefined) data.customMonths = dto.customMonths as any;

    if (dto.displayDurationDays !== undefined) data.displayDurationDays = dto.displayDurationDays;
    if (dto.publishHour !== undefined) data.publishHour = dto.publishHour;

    if (dto.startsOn !== undefined) {
      data.startsOn = dto.startsOn ? startOfDisplayDay(dto.startsOn) : null;
    }
    if (dto.endsOn !== undefined) {
      data.endsOn = dto.endsOn ? endOfDisplayDay(dto.endsOn) : null;
    }
    if (dto.maxOccurrences !== undefined) data.maxOccurrences = dto.maxOccurrences;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    // Configs: upsert do lado correspondente. `connectOrCreate` não serve —
    // são registros 1:1 sem chave natural.
    if (dto.weeklyConfig !== undefined) {
      const w = dto.weeklyConfig;
      const payload = {
        monday: !!w?.monday,
        tuesday: !!w?.tuesday,
        wednesday: !!w?.wednesday,
        thursday: !!w?.thursday,
        friday: !!w?.friday,
        saturday: !!w?.saturday,
        sunday: !!w?.sunday,
      };
      data.weeklyConfig = current.weeklyConfigId
        ? { update: payload }
        : { create: payload };
    }
    if (dto.monthlyConfig !== undefined) {
      const m = dto.monthlyConfig;
      const payload = {
        dayOfMonth: m?.dayOfMonth ?? null,
        occurrence: (m?.occurrence ?? null) as any,
        dayOfWeek: (m?.dayOfWeek ?? null) as any,
      };
      data.monthlyConfig = current.monthlyConfigId
        ? { update: payload }
        : { create: payload };
    }
    if (dto.yearlyConfig !== undefined && dto.yearlyConfig) {
      const y = dto.yearlyConfig;
      const payload = {
        month: y.month as any,
        dayOfMonth: y.dayOfMonth ?? null,
        occurrence: (y.occurrence ?? null) as any,
        dayOfWeek: (y.dayOfWeek ?? null) as any,
      };
      data.yearlyConfig = current.yearlyConfigId
        ? { update: payload }
        : { create: payload };
    }

    // Escrita e recálculo na MESMA transação.
    //
    // O `nextRun` só pode ser calculado depois de gravar, porque ele depende dos
    // três configs 1:1 e da vigência já resolvidos — e é justamente aí que as
    // recusas abaixo aparecem. Fora de uma transação, um `throw` devolveria 400
    // ao usuário com a nova regra JÁ gravada: o formulário diria que nada mudou
    // e o banco discordaria.
    return await this.prisma.$transaction(async tx => {
      const updated = await tx.messageSchedule.update({
        where: { id },
        data,
        include: SCHEDULE_INCLUDE,
      });

      // Mexer na regra sem recalcular `nextRun` deixaria o agendamento mirando a
      // data da regra ANTIGA — o sintoma clássico de "mudei para segunda e ele
      // continuou disparando na quinta".
      const recomputed = updated.isActive
        ? this.computeNextRun(updated as unknown as RecurringSchedule & { publishHour: number })
        : null;

      // As mesmas duas recusas do `create`, agora que a regra também pode ser
      // EDITADA. Sem elas o formulário aceitaria em silêncio uma configuração
      // que nunca publica — e o agendamento ficaria ativo, mudo, com a coluna
      // "Próxima" em branco, esperando por uma data que não existe.
      if (updated.isActive && !recomputed) {
        throw new BadRequestException(
          'A recorrência informada não produz nenhuma data futura; revise a configuração',
        );
      }
      if (updated.isActive && updated.endsOn && recomputed && recomputed > updated.endsOn) {
        throw new BadRequestException(
          'A vigência termina antes da próxima publicação; ajuste as datas ou a recorrência',
        );
      }

      // Editar é o único jeito de RESSUSCITAR um agendamento encerrado: quem
      // chegou ao fim da vigência (ou ao limite de publicações) só volta a
      // existir esticando a data ou o limite. Sem limpar `finishedAt` aqui, a
      // nova regra ficaria gravada e o cron continuaria pulando a linha para
      // sempre — o `where: { finishedAt: null }` dele não perdoa —, e a lista
      // mostraria "Encerrado" ao lado de uma próxima publicação que nunca chega.
      const revived = updated.isActive && !!recomputed && !!updated.finishedAt;

      if (revived || recomputed?.getTime() !== updated.nextRun?.getTime()) {
        return await tx.messageSchedule.update({
          where: { id },
          data: {
            nextRun: recomputed,
            ...(revived ? { finishedAt: null, lastRunError: null } : {}),
          },
          include: SCHEDULE_INCLUDE,
        });
      }
      return updated;
    });
  }

  /** Junta a linha atual com o patch, para validar o estado RESULTANTE. */
  private mergeForValidation(current: any, dto: UpdateMessageScheduleDto): any {
    return {
      ...dto,
      frequency: dto.frequency ?? current.frequency,
      frequencyCount: dto.frequencyCount ?? current.frequencyCount,
      dayOfMonth: dto.dayOfMonth ?? current.dayOfMonth,
      customMonths: dto.customMonths ?? current.customMonths,
      weeklyConfig: dto.weeklyConfig ?? current.weeklyConfig ?? undefined,
      monthlyConfig: dto.monthlyConfig ?? current.monthlyConfig ?? undefined,
      yearlyConfig: dto.yearlyConfig ?? current.yearlyConfig ?? undefined,
      targetType: dto.targetType ?? current.targetType,
      targetUserIds: dto.targetUserIds ?? current.targetUserIds,
      targetSectorIds: dto.targetSectorIds ?? current.targetSectorIds,
      targetPositionIds: dto.targetPositionIds ?? current.targetPositionIds,
    };
  }

  /**
   * Apagar a regra NÃO apaga as ocorrências: a FK é ON DELETE SET NULL, então
   * cada mensagem já publicada vira uma mensagem avulsa, com as visualizações
   * intactas. Histórico de leitura não se descarta por faxina de agendamento.
   */
  async remove(id: string): Promise<{ orphanedOccurrences: number }> {
    const schedule = await this.prisma.messageSchedule.findUnique({
      where: { id },
      select: { id: true, _count: { select: { occurrences: true } } },
    });
    if (!schedule) {
      throw new NotFoundException(`Agendamento ${id} não encontrado`);
    }
    await this.prisma.messageSchedule.delete({ where: { id } });
    return { orphanedOccurrences: schedule._count.occurrences };
  }

  /** Pausa sem perder a regra; `nextRun` é zerado para o cron ignorar. */
  async setActive(id: string, isActive: boolean): Promise<MessageSchedule> {
    const schedule = await this.prisma.messageSchedule.findUnique({
      where: { id },
      include: SCHEDULE_INCLUDE,
    });
    if (!schedule) {
      throw new NotFoundException(`Agendamento ${id} não encontrado`);
    }

    const nextRun = isActive
      ? this.computeNextRun({ ...(schedule as any), isActive: true })
      : null;

    if (isActive && !nextRun) {
      throw new BadRequestException(
        'A recorrência deste agendamento não produz nenhuma data futura; edite a configuração antes de retomar',
      );
    }

    return this.prisma.messageSchedule.update({
      where: { id },
      data: {
        isActive,
        nextRun,
        // Retomar limpa o erro da última execução: senão a interface mostraria
        // para sempre uma falha que já foi resolvida.
        ...(isActive ? { finishedAt: null, lastRunError: null } : {}),
      },
      include: SCHEDULE_INCLUDE,
    });
  }

  // =====================================================================
  // Público — resolvido NO DISPARO
  // =====================================================================

  /**
   * Quem recebe esta ocorrência, agora.
   *
   * Devolve `null` para broadcast (targetType ALL), que é como `Message`
   * representa "todo o quadro": sem linhas em `MessageTarget`. Devolve lista
   * vazia quando a regra não selecionou ninguém — e o chamador é OBRIGADO a
   * tratar isso como "pular", nunca como broadcast.
   */
  async resolveAudience(schedule: {
    targetType: string;
    targetUserIds: string[];
    targetSectorIds: string[];
    targetPositionIds: string[];
  }): Promise<string[] | null> {
    if (schedule.targetType === MESSAGE_TARGET_TYPE.ALL) {
      return null;
    }

    const where: Prisma.UserWhereInput = { ...EMPLOYED_USER_WHERE };

    switch (schedule.targetType) {
      case MESSAGE_TARGET_TYPE.SECTOR:
        where.sectorId = { in: schedule.targetSectorIds };
        break;
      case MESSAGE_TARGET_TYPE.POSITION:
        where.positionId = { in: schedule.targetPositionIds };
        break;
      case MESSAGE_TARGET_TYPE.SPECIFIC:
        where.id = { in: schedule.targetUserIds };
        break;
      default:
        return [];
    }

    const users = await this.prisma.user.findMany({ where, select: { id: true } });
    return users.map(u => u.id);
  }

  // =====================================================================
  // Materialização da ocorrência
  // =====================================================================

  /**
   * Publica UMA ocorrência do agendamento na data indicada.
   *
   * É idempotente por construção: a `@@unique([scheduleId, occurrenceDate])` de
   * `Message` recusa a segunda tentativa na mesma data (P2002) e a função
   * devolve SUCCESS sem criar nada. Isso cobre tanto dois workers do cluster
   * disputando o mesmo tick quanto um `run-now` clicado duas vezes.
   *
   * Não avança `nextRun` — quem cuida da escrituração é o chamador, porque o
   * caminho do cron e o do disparo manual escrituram diferente.
   */
  async materializeOccurrence(
    scheduleId: string,
    occurrenceDay: Date,
    now: Date = new Date(),
  ): Promise<MaterializeResult> {
    const occurrenceDate = startOfDisplayDay(occurrenceDay);

    const schedule = await this.prisma.messageSchedule.findUnique({
      where: { id: scheduleId },
      include: SCHEDULE_INCLUDE,
    });
    if (!schedule) {
      throw new NotFoundException(`Agendamento ${scheduleId} não encontrado`);
    }

    // ⚠️ A trava que impede um aviso de setor virar comunicado da empresa.
    const targetUserIds = await this.resolveAudience(schedule);
    if (targetUserIds !== null && targetUserIds.length === 0) {
      const reason =
        'Nenhum usuário ativo corresponde ao público configurado; disparo pulado para não virar broadcast';
      this.logger.warn(`Agendamento ${scheduleId}: ${reason}`);
      return {
        status: SCHEDULE_RUN_STATUS.SKIPPED_NO_ITEMS,
        message: null,
        reason,
        occurrenceDate,
      };
    }

    // A janela de exibição cobre `displayDurationDays` dias-calendário CONTADOS
    // A PARTIR do dia da ocorrência — daí o −1: duração 1 significa "só hoje".
    // A soma é feita sobre o DIA de São Paulo, não sobre os campos locais do
    // instante, para que a janela não escorregue num processo fora do fuso.
    const lastDay = addCalendarDays(
      saoPauloCalendarDay(occurrenceDate),
      Math.max(1, schedule.displayDurationDays) - 1,
    );

    const startDate = occurrenceDate;
    const endDate = endOfSaoPauloDay(lastDay);

    try {
      const message = await this.prisma.$transaction(async tx => {
        const created = await tx.message.create({
          data: {
            title: schedule.title,
            content: schedule.content as Prisma.InputJsonValue,
            status: 'ACTIVE',
            startDate,
            endDate,
            publishedAt: now,
            isDismissible: schedule.isDismissible,
            requiresView: schedule.requiresView,
            createdById: schedule.createdById,
            scheduleId: schedule.id,
            occurrenceDate,
          },
        });

        if (targetUserIds && targetUserIds.length > 0) {
          await tx.messageTarget.createMany({
            data: targetUserIds.map(userId => ({ messageId: created.id, userId })),
          });
        }

        return created;
      });

      this.logger.log(
        `Agendamento "${schedule.name}" publicou ocorrência ${message.id} ` +
          `(${occurrenceDate.toISOString().slice(0, 10)}, ${targetUserIds?.length ?? 'todos'} alvo(s))`,
      );

      // Mesmo evento das mensagens avulsas: o MessageListener já existente cuida
      // do push. Lista vazia = broadcast, exatamente como o listener lê.
      this.announce(message, targetUserIds ?? [], schedule.createdById);

      return { status: SCHEDULE_RUN_STATUS.SUCCESS, message, occurrenceDate };
    } catch (error: any) {
      if (error?.code === 'P2002') {
        // Outro worker (ou um clique repetido) já materializou esta data.
        this.logger.debug(
          `Agendamento ${scheduleId}: ocorrência de ${occurrenceDate.toISOString().slice(0, 10)} já existia`,
        );
        return {
          status: SCHEDULE_RUN_STATUS.SUCCESS,
          message: null,
          reason: 'Ocorrência já materializada',
          occurrenceDate,
        };
      }
      throw error;
    }
  }

  /**
   * Disparo MANUAL: publica a ocorrência de hoje sem mexer em `nextRun`.
   *
   * O ciclo normal segue intacto — quem clica "publicar agora" quer antecipar
   * um comunicado, não pular a segunda-feira que vem. `occurrenceCount` sobe
   * porque a ocorrência existe de verdade e conta para `maxOccurrences`.
   */
  async runNow(id: string): Promise<MaterializeResult> {
    const now = new Date();

    // Os mesmos limites que o cron respeita. Sem isto, o disparo manual seria a
    // porta dos fundos para estourar `maxOccurrences` ou publicar depois do fim
    // da vigência.
    const schedule = await this.prisma.messageSchedule.findUnique({
      where: { id },
      select: { id: true, endsOn: true, maxOccurrences: true, occurrenceCount: true },
    });
    if (!schedule) {
      throw new NotFoundException(`Agendamento ${id} não encontrado`);
    }
    if (schedule.endsOn && now.getTime() > schedule.endsOn.getTime()) {
      throw new BadRequestException('A vigência deste agendamento já terminou');
    }
    if (
      schedule.maxOccurrences !== null &&
      schedule.occurrenceCount >= schedule.maxOccurrences
    ) {
      throw new BadRequestException(
        `Este agendamento já publicou o máximo de ${schedule.maxOccurrences} comunicado(s)`,
      );
    }

    const result = await this.materializeOccurrence(id, now, now);

    if (result.status === SCHEDULE_RUN_STATUS.SUCCESS && result.message) {
      await this.prisma.messageSchedule.update({
        where: { id },
        data: {
          lastRun: now,
          lastFiredAt: now,
          occurrenceCount: { increment: 1 },
          lastRunStatus: SCHEDULE_RUN_STATUS.SUCCESS as any,
          lastRunError: null,
        },
      });
    } else if (result.status === SCHEDULE_RUN_STATUS.SKIPPED_NO_ITEMS) {
      await this.prisma.messageSchedule.update({
        where: { id },
        data: {
          lastRunStatus: SCHEDULE_RUN_STATUS.SKIPPED_NO_ITEMS as any,
          lastRunError: result.reason ?? null,
        },
      });
    }

    return result;
  }

  /** Notificação nunca derruba a publicação. */
  private announce(message: Message, targetUserIds: string[], createdById: string): void {
    try {
      this.eventEmitter.emit(
        'message.published',
        new MessagePublishedEvent(message, targetUserIds, createdById),
      );
    } catch (err) {
      this.logger.error(`Falha ao notificar publicação da mensagem ${message.id}: ${err}`);
    }
  }
}
