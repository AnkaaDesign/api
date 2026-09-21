// api/src/modules/people/portal/portal-identity.controller.ts
//
// `PATCH /cliente/me/veiculos/:taskId/identificacao` — a ÚLTIMA rota do §4 do
// contrato, e a que o `web` já chamava recebendo 404
// (`web/src/api-client/portal.ts` → `updateVehicleIdentity`).
//
// Controller SEPARADO de `portal-read.controller.ts` pelo mesmo motivo que
// `portal-decision.controller.ts`: aquele LÊ e este ESCREVE, e a diferença
// aparece no portão. Toda rota daqui exige `WRITE_VEHICLE_IDENTITY` — que é de
// Comercial, Vendedor, Representante, Coordenador, COMPRAS e GESTOR DE FROTA, e
// de mais ninguém. Marketing, Financeiro e Motorista não escrevem identidade de
// veículo. Um controller só, com a capacidade posta rota a rota, é como uma rota
// nova nasce sem portão.
//
// NÃO HÁ `@UseGuards` AQUI, e isso é a estrutura funcionando. `@ResponsibleOnly()`
// na classe entrega a requisição ao `ResponsibleAuthGuard` global; o
// `@PortalCapability(...)` instala a guarda de capacidade por
// `applyDecorators(UseGuards(…))` e ainda PROJETA a capacidade para
// `RESPONSIBLE_ROLES_KEY`, que a guarda global já sabe cobrar — de modo que o
// portão vale mesmo que a segunda guarda seja removida.
//
// ⛔ NÃO acrescente `@ResponsibleRoles(...)` a este handler. Os dois decoradores
// gravam a MESMA chave de metadado no MESMO alvo e `SetMetadata` sobrescreve:
// um dos dois some em silêncio, e qual depende da ordem de aplicação.
//
// ⚠️ E NÃO HÁ `@UserId()`. O ator é `@CurrentResponsible()`.

import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import {
  portalIdentificacaoSchema,
  type PortalIdentificacaoFormData,
} from '@/schemas/portal-vehicle-identity';
import { CurrentResponsible } from '../responsible-auth/current-responsible.decorator';
import { ResponsibleOnly } from '../responsible-auth/responsible-auth.decorators';
import type { ResponsiblePrincipal } from '../responsible-auth/responsible-auth.guard';
import { PORTAL_CAPABILITY } from './portal-capabilities';
import { PortalCapability } from './portal-roles.decorator';
import { PortalIdentityService } from './portal-identity.service';

/** A plaqueta é UMA foto. Mais de uma não é "mais informação": é ambiguidade. */
export const MAXIMO_PLAQUETAS = 1;

@Controller('cliente/me')
@ResponsibleOnly()
export class PortalIdentityController {
  constructor(private readonly identity: PortalIdentityService) {}

  /**
   * ESCREVE SÉRIE, PLACA, CHASSI, PLAQUETA E Nº DO PEDIDO DE UM VEÍCULO.
   *
   * CORPO — `multipart/form-data` quando há a foto da plaqueta,
   * `application/json` quando não há. O multer ignora requisição que não seja
   * multipart, então as duas formas entram pelo mesmo handler.
   *
   * EM MULTIPART O CORPO INTEIRO VIAJA NUM CAMPO SÓ, chamado `payload`, com o
   * JSON dentro — é o que `web/src/api-client/portal.ts` → `multipart()` manda
   * (`form.append("payload", JSON.stringify(payload))`), e é a mesma forma da
   * requisição de orçamento. O desembrulho mora DENTRO do schema
   * (`desempacotarPayload`, reusado de `schemas/portal-request.ts`) e não no
   * pipe, para que o schema continue testável sozinho — que é a propriedade de
   * que `test:portal-identificacao` depende para rodar sem banco.
   *
   * ⚠️ `payload` chega ao schema como STRING (chamada direta, teste) ou como
   * OBJETO JÁ DESSERIALIZADO (pela rota: `ZodValidationPipe.transform` roda
   * `fixArrays` antes do `parse`, e `fixArrays` desserializa toda string que
   * seja JSON válido). O desembrulho trata as duas.
   *
   * ARQUIVO — campo `truckVinPlate`, no MÁXIMO 1, e o serviço exige
   * `image/*`: é a FOTO da plaqueta rebitada no chassi. O campo de TEXTO
   * `Truck.vinPlate` foi removido em `20260727150000_truck_vin_plate_image`
   * porque "a plaqueta era um campo de texto que ninguém preenchia".
   *
   * `taskId` passa por `ParseUUIDPipe`: um id malformado é 400 aqui, e não uma
   * consulta que devolve `null` e vira o 404 de "não é seu" — que diria a coisa
   * errada sobre um id que nunca poderia existir.
   *
   * RESPOSTAS
   *   · 200 — o veículo RELIDO pelo `GET`, já recortado por seção.
   *   · 400 — corpo vazio, chave desconhecida, valor inválido, OU colisão de
   *           unicidade (`{ message, errors[], conflicts[] }`, o mesmo contrato
   *           de erro da requisição).
   *   · 403 — `purchaseOrderNumber` enviado por quem não tem
   *           `WRITE_PURCHASE_ORDER` (o gestor de frota escreve placa e chassi,
   *           e não o pedido de compra).
   *   · 404 — veículo inexistente OU fora do escopo COMERCIAL deste contato.
   *           Nunca 403: confirmar a existência do veículo de outra empresa já
   *           é entregar informação.
   *   · 409 — ⛔ o orçamento está em coleta de assinaturas (ou já assinado) e o
   *           documento congelado IMPRIME o valor que se quer trocar. Preencher
   *           o que estava em branco passa; sobrescrever, não.
   */
  @Patch('veiculos/:taskId/identificacao')
  @PortalCapability(PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY)
  @UseInterceptors(
    FileFieldsInterceptor(
      [{ name: 'truckVinPlate', maxCount: MAXIMO_PLAQUETAS }],
      multerConfig,
    ),
  )
  async atualizarIdentificacao(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body(new ZodValidationPipe(portalIdentificacaoSchema))
    dados: PortalIdentificacaoFormData,
    @UploadedFiles() arquivos?: Record<string, Express.Multer.File[]>,
  ) {
    return this.identity.atualizarIdentificacao(principal, taskId, dados, {
      truckVinPlate: arquivos?.truckVinPlate,
    });
  }
}
