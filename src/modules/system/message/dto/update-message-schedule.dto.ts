import { PartialType } from '@nestjs/swagger';
import { CreateMessageScheduleDto } from './create-message-schedule.dto';

/**
 * Atualização de um agendamento. Todos os campos são opcionais.
 *
 * Mexer em qualquer campo de recorrência faz o service RECALCULAR `nextRun` a
 * partir de agora — senão o agendamento continuaria mirando a data da regra
 * antiga.
 */
export class UpdateMessageScheduleDto extends PartialType(CreateMessageScheduleDto) {}
