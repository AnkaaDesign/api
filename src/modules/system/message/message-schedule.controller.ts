import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MessageScheduleService } from './message-schedule.service';
import {
  CreateMessageScheduleDto,
  UpdateMessageScheduleDto,
  FilterMessageScheduleDto,
} from './dto';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SCHEDULE_RUN_STATUS } from '../../../constants/enums';

/**
 * Agendamentos de comunicado recorrente.
 *
 * Montado em `/message-schedules` e NÃO em `/messages/schedules` de propósito:
 * `MessageController` tem um `@Get(':id')` que engoliria o sub-caminho — a mesma
 * armadilha que já obrigou `/messages/batch` a ser declarado antes do `:id`.
 * Raiz própria elimina a ordem de declaração como fator.
 */
@ApiTags('Message Schedules')
@ApiBearerAuth()
@Controller('message-schedules')
export class MessageScheduleController {
  constructor(private readonly service: MessageScheduleService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING')
  @ApiOperation({
    summary: 'Criar agendamento de comunicado recorrente',
    description:
      'O público é enviado como REGRA (targetType + ids), não como lista de usuários resolvida: ' +
      'quem resolve é o disparo, para o comunicado acompanhar quem entra e sai do setor.',
  })
  @ApiResponse({ status: 201, description: 'Agendamento criado' })
  @ApiResponse({ status: 400, description: 'Recorrência ou público inválidos' })
  async create(@Body() dto: CreateMessageScheduleDto, @UserId() userId: string) {
    const schedule = await this.service.create(dto, userId);
    return {
      success: true,
      data: schedule,
      message: 'Agendamento criado com sucesso',
    };
  }

  /**
   * ⚠️ Declarado ANTES de `@Get(':id')`: sem isso o Nest casaria "preview" como
   * um id e o ParseUUIDPipe devolveria 400.
   */
  @Post('preview-occurrences')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING')
  @ApiOperation({
    summary: 'Prever as próximas datas de disparo',
    description:
      'Não grava nada. Serve para o compositor mostrar "Próximas: 01/09, 08/09, 15/09" e o autor ' +
      'conferir a regra antes de salvar.',
  })
  async preview(
    @Body() dto: CreateMessageScheduleDto,
    @Query('count') count?: string,
  ) {
    const n = Math.min(Math.max(parseInt(count || '5', 10) || 5, 1), 24);
    const dates = this.service.previewOccurrences(dto, n);
    return { success: true, data: dates };
  }

  @Get()
  @Roles('ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING')
  @ApiOperation({ summary: 'Listar agendamentos' })
  async findAll(@Query() filters: FilterMessageScheduleDto) {
    const result = await this.service.findAll(filters);
    return {
      success: true,
      data: result.data,
      meta: {
        totalRecords: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit),
      },
    };
  }

  @Get(':id')
  @Roles('ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING')
  @ApiOperation({
    summary: 'Detalhe do agendamento',
    description: 'Inclui as 12 ocorrências mais recentes com contagem de alvos e leituras.',
  })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const schedule = await this.service.findOne(id);
    return { success: true, data: schedule };
  }

  @Put(':id')
  @Roles('ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING')
  @ApiOperation({
    summary: 'Atualizar agendamento',
    description:
      'Mexer na recorrência recalcula `nextRun` a partir de agora. O conteúdo editado vale para as ' +
      'ocorrências FUTURAS; as já publicadas guardam o que foi enviado no dia.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMessageScheduleDto,
  ) {
    const schedule = await this.service.update(id, dto);
    return {
      success: true,
      data: schedule,
      message: 'Agendamento atualizado com sucesso',
    };
  }

  @Delete(':id')
  @Roles('ADMIN', 'PRODUCTION_MANAGER')
  @ApiOperation({
    summary: 'Excluir agendamento',
    description:
      'As mensagens já publicadas NÃO são apagadas — a FK é ON DELETE SET NULL e elas viram ' +
      'mensagens avulsas, com as visualizações intactas.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const { orphanedOccurrences } = await this.service.remove(id);
    return {
      success: true,
      message:
        orphanedOccurrences > 0
          ? `Agendamento excluído. ${orphanedOccurrences} mensagem(ns) já publicada(s) foram preservadas.`
          : 'Agendamento excluído com sucesso',
    };
  }

  @Patch(':id/pause')
  @Roles('ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING')
  @ApiOperation({ summary: 'Pausar agendamento' })
  async pause(@Param('id', ParseUUIDPipe) id: string) {
    const schedule = await this.service.setActive(id, false);
    return { success: true, data: schedule, message: 'Agendamento pausado' };
  }

  @Patch(':id/resume')
  @Roles('ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING')
  @ApiOperation({
    summary: 'Retomar agendamento',
    description: '`nextRun` é recalculado a partir de agora; ciclos perdidos não são repostos.',
  })
  async resume(@Param('id', ParseUUIDPipe) id: string) {
    const schedule = await this.service.setActive(id, true);
    return { success: true, data: schedule, message: 'Agendamento retomado' };
  }

  @Post(':id/run-now')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN', 'PRODUCTION_MANAGER')
  @ApiOperation({
    summary: 'Publicar uma ocorrência agora',
    description:
      'Publica a ocorrência de HOJE sem mexer em `nextRun` — o ciclo normal segue no horário. ' +
      'Idempotente: chamar duas vezes no mesmo dia não gera duas mensagens.',
  })
  async runNow(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.service.runNow(id);

    if (result.status === SCHEDULE_RUN_STATUS.SKIPPED_NO_ITEMS) {
      return {
        success: false,
        data: null,
        message: result.reason ?? 'Nenhum destinatário para este agendamento',
      };
    }
    if (!result.message) {
      return {
        success: true,
        data: null,
        message: 'A ocorrência de hoje já havia sido publicada',
      };
    }
    return {
      success: true,
      data: result.message,
      message: 'Comunicado publicado com sucesso',
    };
  }
}
