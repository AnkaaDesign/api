import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ZodQueryValidationPipe,
  ZodValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  airbrushingQuoteAcceptSchema,
  airbrushingQuoteCounterSchema,
  airbrushingQuoteNoteSchema,
  airbrushingQuoteProposeSchema,
  airbrushingQuoteRequestsQuerySchema,
} from '../../../schemas/airbrushing-quote';
import type {
  AirbrushingQuoteAcceptFormData,
  AirbrushingQuoteCounterFormData,
  AirbrushingQuoteNoteFormData,
  AirbrushingQuoteProposeFormData,
  AirbrushingQuoteRequestsQuery,
} from '../../../schemas/airbrushing-quote';
import { AirbrushingQuoteService } from './airbrushing-quote.service';

/**
 * Cotação da aerografia.
 *
 * Prefixo próprio (`airbrushing-quotes`) e não `airbrushings/...`: o
 * AirbrushingController declara `GET :id` com ParseUUIDPipe, e uma rota como
 * `airbrushings/quotes` registrada depois dele seria engolida pelo `:id` (400).
 *
 * - `requests/*` — o aerografista: lista, detalhe, propor, aceitar, recusar.
 *   Sempre sobre a PRÓPRIA negociação (o id vem do token, nunca do corpo).
 * - `airbrushing/:id` e `:quoteId/*` — o comercial: comparar, contrapropor,
 *   selecionar e reabrir.
 */
@Controller('airbrushing-quotes')
export class AirbrushingQuoteController {
  constructor(private readonly quoteService: AirbrushingQuoteService) {}

  // ── aerografista ────────────────────────────────────────────────────────────

  @Get('requests')
  @Roles(SECTOR_PRIVILEGES.AIRBRUSHING)
  listRequests(
    @Query(new ZodQueryValidationPipe(airbrushingQuoteRequestsQuerySchema))
    query: AirbrushingQuoteRequestsQuery,
    @UserId() userId: string,
  ) {
    return this.quoteService.listPainterRequests(userId, query);
  }

  @Get('requests/:airbrushingId')
  @Roles(SECTOR_PRIVILEGES.AIRBRUSHING)
  getRequest(
    @Param('airbrushingId', ParseUUIDPipe) airbrushingId: string,
    @UserId() userId: string,
  ) {
    return this.quoteService.getPainterRequest(airbrushingId, userId);
  }

  @Post('requests/:airbrushingId/propose')
  @Roles(SECTOR_PRIVILEGES.AIRBRUSHING)
  @HttpCode(HttpStatus.OK)
  propose(
    @Param('airbrushingId', ParseUUIDPipe) airbrushingId: string,
    @Body(new ZodValidationPipe(airbrushingQuoteProposeSchema))
    body: AirbrushingQuoteProposeFormData,
    @UserId() userId: string,
  ) {
    return this.quoteService.propose(airbrushingId, userId, body);
  }

  @Post('requests/:airbrushingId/accept')
  @Roles(SECTOR_PRIVILEGES.AIRBRUSHING)
  @HttpCode(HttpStatus.OK)
  accept(
    @Param('airbrushingId', ParseUUIDPipe) airbrushingId: string,
    @Body(new ZodValidationPipe(airbrushingQuoteAcceptSchema)) body: AirbrushingQuoteAcceptFormData,
    @UserId() userId: string,
  ) {
    return this.quoteService.accept(airbrushingId, userId, body);
  }

  @Post('requests/:airbrushingId/decline')
  @Roles(SECTOR_PRIVILEGES.AIRBRUSHING)
  @HttpCode(HttpStatus.OK)
  decline(
    @Param('airbrushingId', ParseUUIDPipe) airbrushingId: string,
    @Body(new ZodValidationPipe(airbrushingQuoteNoteSchema)) body: AirbrushingQuoteNoteFormData,
    @UserId() userId: string,
  ) {
    return this.quoteService.decline(airbrushingId, userId, body);
  }

  // ── comercial ───────────────────────────────────────────────────────────────

  @Get('airbrushing/:airbrushingId')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL)
  listForAirbrushing(@Param('airbrushingId', ParseUUIDPipe) airbrushingId: string) {
    return this.quoteService.listForAirbrushing(airbrushingId);
  }

  /** Contraproposta para todos que já enviaram proposta — ver counterAll. */
  @Post('airbrushing/:airbrushingId/counter')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  @HttpCode(HttpStatus.OK)
  counterAll(
    @Param('airbrushingId', ParseUUIDPipe) airbrushingId: string,
    @Body(new ZodValidationPipe(airbrushingQuoteCounterSchema))
    body: AirbrushingQuoteCounterFormData,
    @UserId() userId: string,
  ) {
    return this.quoteService.counterAll(airbrushingId, userId, body);
  }

  @Post('airbrushing/:airbrushingId/reopen')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  @HttpCode(HttpStatus.OK)
  reopen(@Param('airbrushingId', ParseUUIDPipe) airbrushingId: string, @UserId() userId: string) {
    return this.quoteService.reopen(airbrushingId, userId);
  }

  @Post(':quoteId/counter')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  @HttpCode(HttpStatus.OK)
  counter(
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Body(new ZodValidationPipe(airbrushingQuoteCounterSchema))
    body: AirbrushingQuoteCounterFormData,
    @UserId() userId: string,
  ) {
    return this.quoteService.counter(quoteId, userId, body);
  }

  @Post(':quoteId/select')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  @HttpCode(HttpStatus.OK)
  select(
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Body(new ZodValidationPipe(airbrushingQuoteNoteSchema)) body: AirbrushingQuoteNoteFormData,
    @UserId() userId: string,
  ) {
    return this.quoteService.select(quoteId, userId, body);
  }
}
