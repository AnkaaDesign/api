// api/src/modules/people/portal/portal-request.controller.ts
//
// `POST /cliente/me/orcamentos` — a requisição de orçamento do cliente.
//
// NÃO HÁ `@UseGuards` NESTE ARQUIVO, e isso é a estrutura funcionando.
// `ResponsibleAuthGuard` é GLOBAL (`APP_GUARD`) e se divide com o `AuthGuard`
// pelo metadado de `@ResponsibleOnly()`: marcar a rota É guardá-la. O desenho
// anterior pedia as DUAS linhas — a marca e o `@UseGuards` —, e uma rota que
// ganhasse só a primeira ficava ABERTA, porque o `AuthGuard` já tinha cedido e
// ninguém assumia.
//
// O PORTÃO É A CAPACIDADE, não o papel: `@PortalCapability(REQUEST_BUDGET)`
// (API-1) instala a própria guarda e ainda PROJETA a capacidade no conjunto de
// papéis que a exercem — de modo que a guarda global do portal barra por papel
// mesmo que tudo o mais desta linha seja removido. Pela tabela §2.1, isso é
// Comercial, Vendedor, Representante, Coordenador e Marketing; Compras,
// Financeiro, Gestor de Frota e Motorista NÃO abrem requisição.
//
// ⛔ NÃO acrescente `@ResponsibleRoles(...)` aqui. Os dois decoradores gravam a
// MESMA chave de metadado (`RESPONSIBLE_ROLES_KEY`) no MESMO alvo, e
// `SetMetadata` sobrescreve: um dos dois sumiria em silêncio, e qual depende da
// ordem em que foram aplicados. Um eixo por rota.
//
// ⚠️ MARKETING abre requisição e NÃO VÊ PREÇO: `sectionsForRoles(['MARKETING'])`
// devolve só `LAYOUT`. Isso é coerente — a requisição nasce sem preço nenhum —,
// mas o projetor da resposta de LEITURA (API-1) é quem tem de continuar
// escondendo o valor quando o comercial precificar.

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { ResponsibleOnly } from '@modules/people/responsible-auth/responsible-auth.decorators';
import { CurrentResponsible } from '@modules/people/responsible-auth/current-responsible.decorator';
import type { ResponsiblePrincipal } from '@modules/people/responsible-auth/responsible-auth.guard';
import {
  MAXIMO_BASE_FILES,
  portalRequisicaoSchema,
  type PortalRequisicaoFormData,
} from '@/schemas/portal-request';
import { PORTAL_CAPABILITY } from './portal-capabilities';
import { PortalCapability } from './portal-roles.decorator';
import { PortalRequestService } from './portal-request.service';

@Controller('cliente/me')
export class PortalRequestController {
  constructor(private readonly portalRequestService: PortalRequestService) {}

  /**
   * ABRE UMA REQUISIÇÃO DE ORÇAMENTO.
   *
   * CORPO — `multipart/form-data` quando há arquivo, `application/json` quando
   * não há. O multer ignora requisição que não seja multipart, então as duas
   * formas entram pelo mesmo handler.
   *
   * EM MULTIPART O CORPO INTEIRO VIAJA NUM CAMPO SÓ, chamado `payload`, com o
   * JSON dentro — é o que `web/src/api-client/portal.ts` → `multipart()` manda,
   * e é a forma contra a qual três pacotes do web já compilam. A razão é boa: o
   * corpo tem objeto aninhado e lista (`veiculos[].medidas`), e multipart não
   * transporta isso sem uma convenção de colchetes que o Nest não desmonta
   * sozinho.
   *
   * ⚠️ A forma ANTIGA continua aceita — cada campo composto (`veiculos`,
   * `novoCliente`, `novaTinta`) como a sua própria string JSON. `payload` é
   * desembrulhado por um `preprocess` DENTRO de `portalRequisicaoSchema`, e não
   * pelo pipe, para que o schema continue testável sozinho (que é a propriedade
   * de que `test:portal-requisicao` depende para rodar sem banco).
   *
   * ARQUIVOS — campo `baseFiles`, no máximo 30 (o mesmo teto de
   * `task.controller.ts`). Sobem UMA vez e são conectados a TODOS os veículos:
   * `Task.baseFiles` é m:n, e a arte de uma requisição é a mesma para a frota.
   *
   * RESPOSTA — 201 com o envelope de sempre (`{ success, message, data }`).
   * `data` traz `budgetId` e `budgetNumber` (para navegar), `requestId`,
   * `billingId`/`payerId` (o pagador que nasceu), e uma linha por veículo com
   * `taskId`, `implementId` e os ids das medidas criadas.
   *
   * ERRO DE UNICIDADE — 400 com `conflicts[]`, cada item
   * `{ field: 'serialNumber' | 'plate', value, scope: 'payload' | 'database',
   * vehicleIndexes: number[] }`. NOMEIA o valor e o índice da linha do
   * formulário; nunca deixa vazar o P2002 do Prisma.
   */
  @Post('orcamentos')
  @ResponsibleOnly()
  @PortalCapability(PORTAL_CAPABILITY.REQUEST_BUDGET)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'baseFiles', maxCount: MAXIMO_BASE_FILES }], multerConfig),
  )
  async criarRequisicao(
    @Body(new ZodValidationPipe(portalRequisicaoSchema)) dados: PortalRequisicaoFormData,
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @UploadedFiles() arquivos?: Record<string, Express.Multer.File[]>,
  ) {
    return this.portalRequestService.criarRequisicao(principal, dados, {
      baseFiles: arquivos?.baseFiles,
    });
  }
}
