// api/src/modules/people/portal/portal-identity.service.ts
//
// `PATCH /cliente/me/veiculos/:taskId/identificacao` — o cliente escreve a
// identidade do próprio veículo.
//
// O pedido do dono, literal: *"eles devem ser capazes de definir e alterar
// campos como numero de serie, placa, chassi, plaqueta e numero de pedido"*.
//
// ─────────────────────────────────────────────────────────────────────────────
// AS SEIS ARMADILHAS DESTE PACOTE, EM ORDEM DE CUSTO
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. ⛔ A COLETA DE ASSINATURAS. Trocar um dado que o documento congelado já
//    IMPRIME invalida todo envelope vivo e joga fora as assinaturas colhidas —
//    e o contato do portal não tem como reconvocar quem já assinou. Preencher o
//    que estava EM BRANCO é legítimo (a lacuna foi reservada para isso);
//    SOBRESCREVER é recusado com 409 e o nome de quem procurar. A regra inteira,
//    com a citação do construtor do documento, está em
//    `portal-vehicle-identity.ts` — módulo PURO, testado nos dois ramos —, e a
//    guarda que a aplica contra o banco está em `portal-frozen-document.ts`,
//    COMPARTILHADA com `POST /cliente/me/pedidos`: os dois caminhos escrevem o
//    mesmo `customerOrderNumber` e não podem responder coisas diferentes.
//
// 2. ⛔ O ESCOPO É O COMERCIAL, NÃO O DE LEITURA. `taskScopeWhere` tem o
//    caminho (c) — "eu sou contato deste veículo" —, que é PESSOAL, atravessa
//    empresas de propósito e não carrega laço comercial nenhum. Escrever a
//    placa de um implemento é ato comercial: vale `commercialTaskScopeWhere`,
//    (a) PAGADOR ∨ (b) DONO, o MESMO predicado do pedido de compra. E a
//    conferência é feita DUAS vezes — no `where` e, sobre a linha carregada,
//    por `commercialTaskLink`, que falha FECHADO quando o `select` não trouxe a
//    prova do pagador.
//
// 3. ⛔ FORA DO ESCOPO É 404, NUNCA 403. A existência de um veículo de outra
//    empresa não é informação que o portal confirme — 403 confirmaria.
//
// 4. ⛔ `Implement` PODE NÃO EXISTIR. É 1:1 com `Task` e NULLABLE, e os editores
//    internos simplesmente desaparecem quando não há linha. Um `implement.update`
//    otimista estoura P2025 e derruba a transação; o portal CRIA a linha quando
//    chega placa, chassi ou plaqueta para uma tarefa que não a tem.
//
// 5. ⛔ NUNCA `plate` NO TOPO. `taskUpdateSchema` não é `.strict()` e chave fora
//    do lugar SOME EM SILÊNCIO — o formulário diria "salvo", e a placa não
//    existiria. Aqui não se passa por `TaskService`: escreve-se direto em
//    `tx.implement`, que é o modelo que tem as colunas.
//
// 6. ⛔ O PEDIDO DE COMPRA NÃO É ESCRITO AQUI. Ele é DUAL
//    (`Task.purchaseOrderId` + `Task.customerOrderNumber`), porque a regra de
//    atenção `budget.ibipora-missing-order-number`, a discriminação da NFS-e e
//    o `seuNumero` do boleto leem a coluna legada e NENHUM deles conhece
//    `PurchaseOrder`. Escrever só um dos lados deixa a nota sair sem o pedido
//    que o cliente exige, e o erro aparece na prefeitura, semanas depois. Quem
//    escreve é o `PurchaseOrderService`, que RECON-1 endureceu.
//
// ⚠️ E NENHUM `@UserId()`. Em ponto nenhum deste pacote. São 827 chamadas e 46
//    FKs NOT NULL apontando para `User`: um id de contato ali vira UUID de
//    contato gravado em coluna de funcionário. O ator é `@CurrentResponsible()`,
//    o changelog vai com `userId: null` e a autoria em `metadata`.
//
// ─────────────────────────────────────────────────────────────────────────────
// O QUE ESTE SERVIÇO NÃO FAZ, E POR QUÊ
// ─────────────────────────────────────────────────────────────────────────────
// NÃO chama `SignatureEnvelopeService.onQuoteContentChanged`. Dois motivos:
//
//   · ele é o gancho da INVALIDAÇÃO, e o único caso que chegaria até ele por
//     esta rota é o do preenchimento tardio — que as tolerâncias já absolvem
//     (`tolerateLateRegistration`). A sobrescrita, que é o caso que ele
//     derrubaria, nunca passa da guarda acima;
//   · chamá-lo faria ESTA rota ser a que invalida um envelope que já estava
//     divergindo por outro motivo (um layout trocado ontem, por exemplo). O
//     cliente apertaria "salvar placa" e apagaria assinaturas por uma mudança
//     que não foi dele.
//
// A deriva não fica sem registro: `changesSinceFrozen` a grava por CÁLCULO na
// primeira vez que alguém observa o envelope — foi assim que o buraco de
// `PUT /tasks/:id` (que também não chama o gancho) foi fechado.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { FileService } from '@modules/common/file/file.service';
import { PurchaseOrderService } from '@modules/production/purchase-order/purchase-order.service';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import type { ResponsiblePrincipal } from '@modules/people/responsible-auth/responsible-auth.guard';
import { CHANGE_ACTION, CHANGE_TRIGGERED_BY, ENTITY_TYPE } from '@constants';
import type { PortalColisao } from '@/schemas/portal-request';
import {
  NADA_PARA_MUDAR_MENSAGEM,
  temAlgoParaMudar,
  type PortalIdentificacaoFormData,
} from '@/schemas/portal-vehicle-identity';
import { PortalReadService } from './portal-read.service';
import { commercialTaskLink, PortalScopeService } from './portal-scope.service';
import { hasCapability, PORTAL_CAPABILITY } from './portal-capabilities';
import { assertIdentidadeNaoContradizDocumento } from './portal-frozen-document';
import {
  LADOS_DO_PORTAL,
  medidaParaPrisma,
  portaParaPrisma,
  type LadoDoPortal,
  type PortaTraseiraPrisma,
} from '@/schemas/portal-request';
import {
  FACE_FK,
  FACE_REL,
  setFace,
  type FaceFk,
  type FaceRel,
  type ImplementFace,
  type MeasureInput,
} from '@modules/production/implement-measure/implement-measure-writer';
import { IMPLEMENT_REAR_DOOR_FIELDS } from '@/constants/implement-faces';
import {
  VEHICLE_IDENTITY_FIELDS,
  mesmaMedida,
  travaDeProducao,
  type DesiredVehicleIdentity,
  type MudancaTravavel,
} from './portal-vehicle-identity';

/** O que o multipart entrega. Só a plaqueta importa nesta rota. */
export interface PortalIdentificacaoArquivos {
  implementVinPlate?: Express.Multer.File[];
}

/** O multipart de `POST …/projeto`: o campo `implementProject`. */
export interface PortalProjetoArquivos {
  implementProject?: Express.Multer.File[];
}

export const PROJETO_AUSENTE_MENSAGEM =
  'Envie o projeto do implemento (PDF ou imagem) no campo `implementProject`.';

/**
 * O PROJETO DO IMPLEMENTO É PDF OU IMAGEM.
 *
 * `multerConfig` aceita a lista inteira do sistema (EPS, planilha, vídeo…),
 * porque é o mesmo config de dez rotas. O projeto do furgão chega como o PDF
 * da fábrica ou a foto dele; um `.xlsx` aqui não teria miniatura nem leitura na
 * produção, e o erro só apareceria lá.
 */
export function ehArquivoDeProjeto(mimetype: string | null | undefined): boolean {
  const tipo = String(mimetype ?? '').toLowerCase();
  return tipo === 'application/pdf' || tipo.startsWith('image/');
}

/** O mínimo para enviar o projeto: o escopo comercial e a lista atual. */
const projetoSelectFor = (customerId: string) =>
  ({
    id: true,
    customerId: true,
    customer: { select: { fantasyName: true } },
    implement: { select: { id: true, projectFiles: { select: { id: true } } } },
    billingEntry: {
      select: {
        billing: {
          select: { customerConfigs: { where: { customerId }, select: { customerId: true } } },
        },
      },
    },
  }) as const;

/** O desenho gravado de uma face — o bastante para saber se o pedido o MUDA. */
const MEDIDA_GRAVADA = {
  select: {
    height: true,
    sections: {
      select: { width: true, isDoor: true, doorHeight: true, position: true },
      orderBy: { position: 'asc' },
    },
  },
} as const;

/**
 * As quatro faces, com o desenho. O `satisfies` amarra a lista ao escritor: uma
 * quinta face em `FACE_REL` quebra o `tsc` aqui, em vez de a trava de produção
 * e a comparação de no-op ficarem cegas para ela.
 */
const FACES_GRAVADAS = {
  leftSideMeasure: MEDIDA_GRAVADA,
  rightSideMeasure: MEDIDA_GRAVADA,
  backSideMeasure: MEDIDA_GRAVADA,
  frontSideMeasure: MEDIDA_GRAVADA,
} as const satisfies Record<FaceRel, typeof MEDIDA_GRAVADA>;

/**
 * O VEÍCULO, com a prova do laço comercial junto.
 *
 * ⚠️ `customerConfigs` vai SEMPRE com `where: { customerId }` — contrato §3.
 * Nunca `customerConfigs: true`: aqui a pergunta é um booleano ("esta empresa
 * está na conta?") e trazer os outros pagadores seria trazer o cadastro fiscal
 * deles para respondê-lo. É o mesmo `select` de `purchase-order.service.ts`,
 * pelo mesmo motivo — `commercialTaskLink` falha FECHADO sem ele.
 */
const taskSelectFor = (customerId: string) =>
  ({
    id: true,
    name: true,
    // A TRAVA DE PRODUÇÃO lê o estado da tarefa (DD5): sem ele, a trava nunca
    // morderia — e não daria erro nenhum.
    status: true,
    quoteId: true,
    customerId: true,
    customerOrderNumber: true,
    purchaseOrderId: true,
    // A previsão de liberação — o cliente a edita pelo portal.
    forecastDate: true,
    customer: { select: { id: true, fantasyName: true, corporateName: true } },
    implement: {
      select: {
        serialNumber: true,
        id: true,
        plate: true,
        chassisNumber: true,
        category: true,
        type: true,
        leftSideMeasureId: true,
        rightSideMeasureId: true,
        backSideMeasureId: true,
        frontSideMeasureId: true,
        ...FACES_GRAVADAS,
        rearDoorLeaves: true,
        rearDoorBarCount: true,
        rearDoorHatchCount: true,
        vinPlateId: true,
      },
    },
    billingEntry: {
      select: {
        billing: {
          select: { customerConfigs: { where: { customerId }, select: { customerId: true } } },
        },
      },
    },
  }) as const;

type TaskDaIdentidade = Prisma.TaskGetPayload<{ select: ReturnType<typeof taskSelectFor> }>;

/**
 * Os lados da medida no portal, a face de cada um e a coluna dela no implemento
 * — as QUATRO faces, derivadas da lista única da borda (`LADOS_DO_PORTAL`). A
 * frente entrou aqui no P13a; antes a leitura a mostrava e esta escrita não.
 */
const LADOS_DA_MEDIDA = LADOS_DO_PORTAL.map(({ face, chave }) => ({
  chave,
  face,
  coluna: FACE_FK[face],
  relacao: FACE_REL[face],
}));

/** Uma face que o pedido de fato muda (a que não muda nem chega aqui). */
interface FaceAEscrever {
  face: ImplementFace;
  chave: LadoDoPortal;
  coluna: FaceFk;
  atualId: string | null;
  /** Em METROS; `null` = apagar a face. */
  desejada: MeasureInput | null;
}

/**
 * O QUE O PEDIDO MUDA NO IMPLEMENTO, já reduzido ao que difere do gravado.
 *
 * Calculado UMA vez, antes de qualquer escrita, e usado duas: pela trava de
 * produção (que só julga o que muda) e pela escrita (que não regrava face
 * igual nem enche a trilha de "atualizada" sobre nada).
 */
interface PlanoDoImplemento {
  faces: FaceAEscrever[];
  /** Só as colunas da porta que mudam. */
  porta: PortaTraseiraPrisma;
  serieMuda: boolean;
}

@Injectable()
export class PortalIdentityService {
  private readonly logger = new Logger(PortalIdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: PortalScopeService,
    private readonly changeLogs: ChangeLogService,
    private readonly files: FileService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly read: PortalReadService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // A ROTA
  // ═══════════════════════════════════════════════════════════════════════════

  async atualizarIdentificacao(
    principal: ResponsiblePrincipal,
    taskId: string,
    dados: PortalIdentificacaoFormData,
    arquivos?: PortalIdentificacaoArquivos,
  ) {
    // ── 1. A GUARDA DA EMPRESA, ANTES DE QUALQUER CONSULTA ───────────────────
    //
    // `Responsible.companyId` é NULLABLE. Um `where` montado sem esta guarda não
    // vira "nada": vira `customerId IS NULL`, que no Postgres casa com TODOS os
    // órfãos. `assertScoped` devolve o par já provado não-nulo, e é por isso que
    // daqui para baixo se usa `companyId` e nunca `principal.companyId`.
    const { companyId, responsibleId } = this.scope.assertScoped(principal);

    const plaqueta = arquivos?.implementVinPlate?.[0] ?? null;

    if (!temAlgoParaMudar(dados, { temPlaqueta: Boolean(plaqueta) })) {
      throw new BadRequestException(NADA_PARA_MUDAR_MENSAGEM);
    }

    // A PLAQUETA É IMAGEM. `multerConfig` aceita toda a lista de tipos do
    // sistema (PDF, EPS, planilha…), porque é o mesmo config de dez rotas. Aqui
    // o campo é a FOTO da plaqueta rebitada no chassi — um PDF ali quebraria a
    // miniatura e a visualização da produção, e o erro só apareceria na oficina.
    if (plaqueta && !String(plaqueta.mimetype ?? '').startsWith('image/')) {
      throw new BadRequestException(
        'A plaqueta precisa ser uma imagem (foto da plaqueta rebitada no veículo).',
      );
    }

    // ── 2. O VEÍCULO, PELO ESCOPO COMERCIAL ──────────────────────────────────
    const task = await this.prisma.task.findFirst({
      where: {
        AND: [{ id: taskId }, this.scope.commercialTaskScopeWhere(principal)],
      },
      select: taskSelectFor(companyId),
    });

    // ⛔ 404, NUNCA 403 — inclusive para o veículo que existe e é de outra
    // empresa. Distinguir "não existe" de "não é seu" é entregar, a quem tem só
    // um id, a informação de que aquele id existe.
    if (!task) throw new NotFoundException('Veículo não encontrado.');

    // REDE, e não redundância: `commercialTaskLink` responde à MESMA pergunta
    // sobre a linha JÁ CARREGADA e falha FECHADO quando o `select` não trouxe a
    // prova do pagador. Se alguém editar o `select` acima e tirar
    // `billingEntry`, isto recusa — em vez de aceitar por omissão.
    if (commercialTaskLink(task, companyId) === null) {
      throw new NotFoundException('Veículo não encontrado.');
    }

    // ── 3. O SUB-PORTÃO DO PEDIDO DE COMPRA ──────────────────────────────────
    //
    // A rota inteira exige `WRITE_VEHICLE_IDENTITY`, que o GESTOR DE FROTA tem.
    // O número do pedido é outro ato: é documento fiscal, e quem o emite é o
    // Compras (ou o Financeiro) do cliente. Sem este segundo portão, a rota
    // daria ao gestor de frota um campo que a tabela de capacidades lhe nega —
    // e daria por uma porta que a tela do pedido de compra não abre.
    const pedido = dados?.purchaseOrderNumber;
    if (pedido !== undefined) {
      if (!hasCapability(principal.roles, PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER)) {
        throw new ForbiddenException(
          'Seu perfil de contato não permite informar o pedido de compra. ' +
            'Placa, chassi e número de série você pode alterar. Fale com o comercial.',
        );
      }
      // ⛔ REMOVER NÃO PASSA POR AQUI. O caminho de escrita é
      // `PurchaseOrderService.upsertAndLink`, que ACHA-OU-CRIA e liga — ele não
      // sabe desligar, e desligar à mão seria escrever `customerOrderNumber`
      // por fora da escrita dupla, que é exatamente o que a armadilha 6 proíbe.
      // Recusar nomeando o motivo é honesto; aceitar e não apagar seria um 200
      // mentiroso.
      if (pedido === null || !pedido.trim()) {
        throw new BadRequestException(
          'O número do pedido de compra não pode ser apagado pelo portal — ele é ' +
            'citado na nota fiscal e no boleto. Para corrigi-lo, informe o número novo.',
        );
      }
    }

    // ── 4. ⛔ A TRAVA DE PRODUÇÃO (DD5, pergunta 15) ──────────────────────────
    //
    // Com a tarefa em produção (ou concluída), medida, porta traseira e série
    // não mudam mais pelo portal: a oficina já trabalha pelo que está gravado.
    // ANTES da guarda do documento e de qualquer escrita, e sobre o que DE FATO
    // muda — reenviar o que já está gravado passa. A regra, pura, mora em
    // `portal-vehicle-identity.ts`.
    const plano = this.planejarImplemento(task, dados);
    const trava = travaDeProducao(task.status, this.mudancasTravaveis(plano));
    if (trava) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: trava.message,
        fields: trava.fields,
      });
    }

    // ── 5. ⛔ A COLETA DE ASSINATURAS ────────────────────────────────────────
    //
    // ⚠️ SÓ O QUE DE FATO MUDA É JULGADO. Um campo cujo valor pedido é o que já
    // está gravado é NO-OP: não escreve nada, não pode contradizer documento
    // nenhum, e julgá-lo produziria um 409 sobre nada.
    //
    // O caso não é hipotético. O congelado e o cadastro de hoje PODEM divergir
    // sem que ninguém tenha passado por aqui: `PUT /tasks/:id` escreve placa e
    // chassi por escrita aninhada em `implement` e NÃO chama
    // `onQuoteContentChanged` — é o buraco medido no orçamento nº 945. Nesse
    // estado, um reenvio do formulário do portal com os valores que ele acabou
    // de LER seria recusado por uma alteração que outra pessoa fez.
    const desejado = this.apenasOQueMuda(task, dados, pedido);
    await this.assertNaoContradizDocumento(task.quoteId, taskId, desejado);

    // ── 6. AS UNICIDADES GLOBAIS ─────────────────────────────────────────────
    await this.garantirUnicidade(taskId, dados);

    // ── 7. O PEDIDO DE COMPRA, PELO SERVIÇO QUE FAZ A ESCRITA DUPLA ──────────
    //
    // ANTES da transação de identidade, e de propósito: `upsertAndLink` é
    // IDEMPOTENTE (`upsert` no par único + pular quando os dois lados já dizem o
    // mesmo), então uma repetição não custa nada. Se a identidade falhar depois,
    // o cliente reenvia o formulário inteiro e só a parte que faltava escreve.
    // Na ordem inversa, uma falha do pedido deixaria a placa gravada e o
    // formulário devolvendo erro — e a repetição gravaria a placa de novo, com
    // uma linha de changelog a cada tentativa.
    if (pedido !== undefined) {
      await this.purchaseOrders.createFromPortal(principal, {
        number: pedido,
        issuedAt: null,
        taskIds: [taskId],
      });
    }

    // ── 8. A ESCRITA DA IDENTIDADE ───────────────────────────────────────────
    await this.gravar(task, dados, plaqueta, responsibleId, plano);

    this.logger.log(
      `Identificação do veículo ${taskId} atualizada pelo portal ` +
        `(contato ${responsibleId}, empresa ${companyId})`,
    );

    // ── 9. A RESPOSTA É A MESMA DO `GET` ─────────────────────────────────────
    //
    // Releitura por `PortalReadService.getVehicle`, e não um objeto montado
    // aqui: é ele que aplica o RECORTE POR SEÇÃO e a projeção monotônica do
    // andamento. Um retorno montado à mão nesta rota seria a única resposta do
    // portal sem recorte — e entregaria ao gestor de frota, na volta do
    // `PATCH`, os campos que o `GET` esconde dele.
    const fresco = await this.read.getVehicle(principal, taskId);
    return { ...fresco, message: 'Identificação do veículo atualizada com sucesso.' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // O PROJETO DO IMPLEMENTO — `POST /cliente/me/veiculos/:taskId/projeto`
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * O cliente (a Furgões, o dono do baú) ANEXA o projeto do implemento.
   *
   * É o "projeto do implemento" do dono (R6): o desenho do furgão, que chega da
   * fábrica e que até aqui vinha por WhatsApp e era largado em arquivos-base.
   * NÃO é o projeto da TAREFA (o PDF cotado de colagem, `Task.projectFiles`),
   * que o cliente não vê (D-22).
   *
   * As MESMAS regras da identificação, e pelos mesmos motivos: escopo COMERCIAL
   * (pagador ∨ dono, sem o caminho pessoal), 404 fora dele — nunca 403 —, a
   * conferência dupla por `commercialTaskLink`, o arquivo nascendo na MESMA
   * transação do vínculo, `userId` indefinido no `File` e `null` na trilha.
   *
   * ⚠️ ACRESCENTA, não substitui: o portal não tem como tirar um projeto (o
   * `PUT /implements/:id/project-files` interno, que recebe a lista inteira, é
   * quem tira). Um envio que trocasse a lista apagaria o projeto que o comercial
   * anexou do lado de dentro.
   *
   * ⚠️ SEM trava de produção: a trava é sobre medida, porta e série (DD5). O
   * projeto pode chegar com o veículo na linha, e é bom que chegue.
   */
  async enviarProjeto(
    principal: ResponsiblePrincipal,
    taskId: string,
    arquivos?: PortalProjetoArquivos,
  ) {
    const { companyId, responsibleId } = this.scope.assertScoped(principal);

    const enviados = arquivos?.implementProject ?? [];
    if (!enviados.length) throw new BadRequestException(PROJETO_AUSENTE_MENSAGEM);
    const recusado = enviados.find(arquivo => !ehArquivoDeProjeto(arquivo.mimetype));
    if (recusado) {
      throw new BadRequestException(
        `O projeto do implemento precisa ser PDF ou imagem ("${recusado.originalname}" não é).`,
      );
    }

    const task = await this.prisma.task.findFirst({
      where: { AND: [{ id: taskId }, this.scope.commercialTaskScopeWhere(principal)] },
      select: projetoSelectFor(companyId),
    });
    // ⛔ 404, NUNCA 403 — pelo mesmo motivo da identificação.
    if (!task) throw new NotFoundException('Veículo não encontrado.');
    if (commercialTaskLink(task, companyId) === null) {
      throw new NotFoundException('Veículo não encontrado.');
    }

    const implementId = task.implement?.id ?? null;
    if (!implementId) {
      throw new InternalServerErrorException(
        'Tarefa sem implemento: toda tarefa tem exatamente um implemento.',
      );
    }

    await this.prisma.$transaction(async tx => {
      const novos: string[] = [];
      for (const arquivo of enviados) {
        // O MESMO contexto do caminho interno (`ImplementService.setProjectFiles`):
        // `implementProjectFiles` → pasta Projetos, com a referência que protege
        // o arquivo de ser apagado em uso (G10).
        const registro = await this.files.createFromUploadWithTransaction(
          tx,
          arquivo,
          'implementProjectFiles',
          // ⛔ `File.createdById` é FK de `User`: um id de contato ali é o defeito
          // que este portal inteiro existe para não cometer.
          undefined,
          {
            entityId: implementId,
            entityType: 'IMPLEMENT',
            customerName: task.customer?.fantasyName ?? undefined,
          },
        );
        novos.push(registro.id);
      }

      await tx.implement.update({
        where: { id: implementId },
        data: { projectFiles: { connect: novos.map(id => ({ id })) } },
      });

      // A trilha na MESMA forma do caminho interno (`IMPLEMENT/projectFiles`,
      // lista antes × lista depois), para o histórico mostrar os dois iguais.
      const antes = (task.implement?.projectFiles ?? []).map(f => f.id).sort();
      const depois = [...new Set([...antes, ...novos])].sort();
      await this.auditar(tx, {
        entityType: ENTITY_TYPE.IMPLEMENT,
        entityId: implementId,
        field: 'projectFiles',
        oldValue: antes,
        newValue: depois,
        responsibleId,
        reason: 'Projeto do implemento enviado pelo cliente no portal',
      });
    });

    this.logger.log(
      `Projeto do implemento do veículo ${taskId} enviado pelo portal ` +
        `(${enviados.length} arquivo(s), contato ${responsibleId}, empresa ${companyId})`,
    );

    // A resposta é a do `GET`, recortada por seção — como na identificação.
    const fresco = await this.read.getVehicle(principal, taskId);
    return { ...fresco, message: 'Projeto do implemento enviado com sucesso.' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ⛔ O DOCUMENTO ASSINADO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * O corpo REDUZIDO ao que de fato altera o cadastro.
   *
   * Campo ausente do corpo (`undefined`) continua ausente; campo cujo valor
   * pedido já é o gravado VIRA ausente — ver a nota no chamador.
   */
  private apenasOQueMuda(
    task: {
      customerOrderNumber?: string | null;
      implement?: {
        serialNumber?: string | null;
        plate?: string | null;
        chassisNumber?: string | null;
        category?: string | null;
        type?: string | null;
      } | null;
    },
    dados: PortalIdentificacaoFormData,
    pedido: string | null | undefined,
  ): DesiredVehicleIdentity {
    const atual = {
      serialNumber: task.implement?.serialNumber ?? null,
      plate: task.implement?.plate ?? null,
      chassisNumber: task.implement?.chassisNumber ?? null,
      orderNumber: task.customerOrderNumber ?? null,
      category: task.implement?.category ?? null,
      type: task.implement?.type ?? null,
    };
    const pedidos: DesiredVehicleIdentity = {
      serialNumber: dados?.serialNumber,
      plate: dados?.plate,
      chassisNumber: dados?.chassisNumber,
      orderNumber: pedido,
      category: dados?.category,
      type: dados?.type,
    };

    const out: DesiredVehicleIdentity = {};
    for (const campo of VEHICLE_IDENTITY_FIELDS) {
      const valor = pedidos[campo];
      if (valor === undefined) continue;
      if ((valor ?? null) === atual[campo]) continue;
      out[campo] = valor;
    }
    return out;
  }

  /**
   * A PORTA DESTE SERVIÇO PARA A GUARDA COMPARTILHADA.
   *
   * ⛔ A guarda NÃO mora mais aqui, e isso é a correção de 20/09/2026. O mesmo
   * `Task.customerOrderNumber` é escrito por `POST /cliente/me/pedidos`
   * (`PurchaseOrderService`), que não passava por guarda nenhuma — a porta dos
   * fundos da porta que esta rota tranca. Uma segunda cópia da regra divergiria
   * no primeiro conserto, e a que ficasse para trás seria a que um cliente
   * encontraria; então a regra saiu para `portal-frozen-document.ts` e os DOIS
   * caminhos chamam a MESMA função.
   *
   * O método fica como delegação de uma linha porque é ele que a leitura desta
   * rota procura, na ordem em que a rota acontece: conferir o documento ANTES
   * de escrever.
   */
  private async assertNaoContradizDocumento(
    quoteId: string | null,
    taskId: string,
    desejado: DesiredVehicleIdentity,
  ): Promise<void> {
    await assertIdentidadeNaoContradizDocumento(this.prisma, quoteId, taskId, desejado);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // O QUE MUDA NO IMPLEMENTO — medida, porta e série (a trava e a escrita)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * As faces, a porta e a série que o pedido DE FATO muda.
   *
   * ⚠️ `medidas: null` apaga as QUATRO faces (regra 1 da borda: `null` é
   * "apague"); um lado `null` apaga só aquele; lado ausente não entra. Apagar a
   * face que já está vazia, ou mandar o desenho que já está gravado, não é
   * mudança — nem para a trava, nem para a escrita.
   */
  private planejarImplemento(
    task: TaskDaIdentidade,
    dados: PortalIdentificacaoFormData,
  ): PlanoDoImplemento {
    const implemento = task.implement ?? null;
    const medidas = dados?.medidas;

    const faces: FaceAEscrever[] = [];
    if (medidas !== undefined) {
      for (const lado of LADOS_DA_MEDIDA) {
        const entrada = medidas === null ? null : medidas[lado.chave];
        if (entrada === undefined) continue;

        const atualId = (implemento?.[lado.coluna] as string | null | undefined) ?? null;
        if (entrada === null) {
          if (atualId) {
            faces.push({ face: lado.face, chave: lado.chave, coluna: lado.coluna, atualId, desejada: null });
          }
          continue;
        }

        // ⚠️ CENTÍMETROS ENTRAM, METROS SÃO GRAVADOS — a MESMA função da
        // requisição; a comparação com o gravado já é em metros.
        const desejada = medidaParaPrisma(entrada);
        if (mesmaMedida(implemento?.[lado.relacao] ?? null, desejada)) continue;
        faces.push({ face: lado.face, chave: lado.chave, coluna: lado.coluna, atualId, desejada });
      }
    }

    const porta: PortaTraseiraPrisma = {};
    const pedidaDaPorta = portaParaPrisma(dados?.portaTraseira);
    for (const coluna of IMPLEMENT_REAR_DOOR_FIELDS) {
      const valor = pedidaDaPorta[coluna];
      if (valor === undefined) continue;
      if ((valor ?? null) === (implemento?.[coluna] ?? null)) continue;
      (porta as Record<string, unknown>)[coluna] = valor;
    }

    const serie = dados?.serialNumber;
    const serieMuda = serie !== undefined && (serie ?? null) !== (implemento?.serialNumber ?? null);

    return { faces, porta, serieMuda };
  }

  /** O plano na língua da trava de produção. */
  private mudancasTravaveis(plano: PlanoDoImplemento): MudancaTravavel[] {
    const mudancas: MudancaTravavel[] = plano.faces.map(f => ({
      campo: 'medida' as const,
      face: f.face,
      chave: f.chave,
    }));
    if (Object.keys(plano.porta).length) mudancas.push({ campo: 'portaTraseira' });
    if (plano.serieMuda) mudancas.push({ campo: 'serialNumber' });
    return mudancas;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AS UNICIDADES — `Implement.serialNumber` e `Implement.plate` são GLOBAIS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Recusa com 400 e o VALOR CULPADO, antes de qualquer escrita.
   *
   * ⛔ NUNCA deixe o P2002 do Prisma vazar. "Unique constraint failed on the
   * fields: (`serialNumber`)" é um 500 na tela do cliente e não diz qual série
   * está repetida nem onde. O contrato de erro é o MESMO que a requisição já
   * estabeleceu — `{ message, errors[], conflicts[] }` —, para que o formulário
   * do portal marque o campo em vermelho sem fazer parsing de frase.
   *
   * `null` não colide com `null`: as duas colunas são `String?` e o Postgres não
   * considera dois NULLs iguais num índice único. Um baú ainda sem placa é
   * legítimo, e continua sendo.
   */
  private async garantirUnicidade(
    taskId: string,
    dados: PortalIdentificacaoFormData,
  ): Promise<void> {
    const colisoes: PortalColisao[] = [];

    const serie = dados?.serialNumber;
    if (typeof serie === 'string' && serie !== '') {
      // DD1: a série é do IMPLEMENTO (a unicidade é `Implement_serialNumber_key`).
      const dono = await this.prisma.implement.findFirst({
        // `NOT: { taskId }` e não um filtro em memória: reescrever a série do MESMO
        // veículo com o valor que ele já tem não é colisão, e sem esta exclusão
        // todo reenvio do formulário acusaria o próprio veículo.
        where: { serialNumber: serie, NOT: { taskId } },
        select: { id: true },
      });
      if (dono) {
        colisoes.push({
          field: 'serialNumber',
          value: serie,
          scope: 'database',
          vehicleIndexes: [0],
        });
      }
    }

    const placa = dados?.plate;
    if (typeof placa === 'string' && placa !== '') {
      const dono = await this.prisma.implement.findFirst({
        where: { plate: placa, NOT: { taskId } },
        select: { id: true },
      });
      if (dono) {
        colisoes.push({ field: 'plate', value: placa, scope: 'database', vehicleIndexes: [0] });
      }
    }

    if (!colisoes.length) return;

    const frases = colisoes.map(c => descreverColisaoDeVeiculo(c));
    throw new BadRequestException({
      statusCode: 400,
      message: frases[0],
      errors: frases,
      // O CAMPO QUE A TELA LÊ — `field` e `value`, como na requisição.
      conflicts: colisoes,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // A ESCRITA
  // ═══════════════════════════════════════════════════════════════════════════

  private async gravar(
    task: TaskDaIdentidade,
    dados: PortalIdentificacaoFormData,
    plaqueta: Express.Multer.File | null,
    responsibleId: string,
    plano: PlanoDoImplemento,
  ): Promise<void> {
    const serie = dados?.serialNumber;
    const placa = dados?.plate;
    const chassi = dados?.chassisNumber;
    const plaquetaId = dados?.vinPlateFileId;
    // Categoria e tipo moram no MESMO implemento da placa e do chassi, e
    // seguem o mesmo par de regras: `undefined` é "não mexa", `null` é "apague".
    const categoria = dados?.category;
    const implemento = dados?.type;
    const previsao = dados?.forecastDate;
    const medidas = dados?.medidas;
    const portaTraseira = dados?.portaTraseira;

    // Algo do IMPLEMENTO (além da série) chegou? Se não, o bloco abaixo é pulado.
    //
    // ⛔ CATEGORIA E IMPLEMENTO ENTRAM NESTA CONTA, e esquecê-los custou um
    // `200 OK` que não gravou nada: a rota aceitava os dois, a guarda do
    // documento os classificava, e então este `false` pulava o bloco inteiro do
    // implemento em silêncio. Um "salvo com sucesso" que não salvou é pior do que
    // um erro — o cliente fecha a tela achando que corrigiu o cadastro.
    const mexeNoImplemento =
      placa !== undefined ||
      chassi !== undefined ||
      categoria !== undefined ||
      implemento !== undefined ||
      // ⚠️ A MEDIDA TAMBÉM É DO IMPLEMENTO: as quatro colunas de `ImplementMeasure`
      // (a frente inclusive) penduram no implemento, e sem passar por aqui o
      // bloco das medidas é pulado — 200 sem gravar, o mesmo defeito que
      // categoria e implemento tiveram antes de entrarem nesta conta.
      medidas !== undefined ||
      // ⚠️ E A PORTA TRASEIRA, pelo mesmo motivo (P13a): chave nova do corpo
      // que não entra aqui é um "salvo com sucesso" que não salvou.
      portaTraseira !== undefined ||
      plaquetaId !== undefined ||
      Boolean(plaqueta);

    // ⚠️ UMA TRANSAÇÃO. Tarefa, implemento, arquivo e as linhas de auditoria
    // descrevem UM fato; metade aplicada é o pior estado possível — um implemento
    // criado com a placa e a série antiga na tarefa, ou um `File` gravado sem
    // ninguém apontando para ele.
    await this.prisma.$transaction(async tx => {
      // ── A PREVISÃO DE LIBERAÇÃO, em `Task` ────────────────────────────────
      //
      // Mesma coluna que o quadro de preparação interno usa. Quem sabe quando o
      // implemento sai da frota é o cliente; até aqui a data entrava por telefone.
      if (previsao !== undefined) {
        const antes = task.forecastDate ?? null;
        const depois = previsao ?? null;
        const mudou =
          (antes?.getTime?.() ?? null) !== (depois instanceof Date ? depois.getTime() : null);
        if (mudou) {
          await tx.task.update({ where: { id: task.id }, data: { forecastDate: depois } });
          await this.auditar(tx, {
            entityType: ENTITY_TYPE.TASK,
            entityId: task.id,
            field: 'forecastDate',
            oldValue: antes,
            newValue: depois,
            responsibleId,
          });
        }
      }

      // ── A SÉRIE, no IMPLEMENTO (DD1, W5) ──────────────────────────────────
      //
      // A tarefa não tem mais a coluna. A trilha continua `TASK/serialNumber`
      // (S-5) — é a chave que o aditivo da assinatura e o histórico leem.
      const serieAtual = task.implement?.serialNumber ?? null;
      if (serie !== undefined && (serie ?? null) !== serieAtual) {
        await tx.implement.update({
          where: { taskId: task.id },
          data: { serialNumber: serie ?? null },
        });
        await this.auditar(tx, {
          entityType: ENTITY_TYPE.TASK,
          entityId: task.id,
          field: 'serialNumber',
          oldValue: serieAtual,
          newValue: serie ?? null,
          responsibleId,
        });
      }

      if (!mexeNoImplemento) return;

      // ── O IMPLEMENTO SEMPRE EXISTE (DD1) ──────────────────────────────────
      //
      // Toda tarefa nasce com implemento (gatilho diferido da M1s). O ramo que
      // "criava o implemento se não existisse" saiu: seria uma segunda fonte de
      // criação sem `spot` explícito.
      //
      // ⚠️ E NUNCA por `taskUpdateSchema` com `plate` no topo: aqui se escreve no
      // modelo que TEM as colunas.
      const implementId = task.implement?.id ?? null;
      if (!implementId) {
        throw new InternalServerErrorException(
          'Tarefa sem implemento: toda tarefa tem exatamente um implemento.',
        );
      }
      const anterior = {
        plate: task.implement?.plate ?? null,
        chassisNumber: task.implement?.chassisNumber ?? null,
        category: task.implement?.category ?? null,
        type: task.implement?.type ?? null,
        vinPlateId: task.implement?.vinPlateId ?? null,
        rearDoorLeaves: task.implement?.rearDoorLeaves ?? null,
        rearDoorBarCount: task.implement?.rearDoorBarCount ?? null,
        rearDoorHatchCount: task.implement?.rearDoorHatchCount ?? null,
      };

      {
        const mudancas: Prisma.ImplementUpdateInput = {};
        if (placa !== undefined && (placa ?? null) !== anterior.plate) {
          mudancas.plate = placa ?? null;
        }
        if (chassi !== undefined && (chassi ?? null) !== anterior.chassisNumber) {
          mudancas.chassisNumber = chassi ?? null;
        }
        if (categoria !== undefined && (categoria ?? null) !== anterior.category) {
          mudancas.category = categoria ?? null;
        }
        if (implemento !== undefined && (implemento ?? null) !== anterior.type) {
          mudancas.type = implemento ?? null;
        }
        if (plaquetaId !== undefined && (plaquetaId ?? null) !== anterior.vinPlateId) {
          mudancas.vinPlate = plaquetaId ? { connect: { id: plaquetaId } } : { disconnect: true };
        }
        // A PORTA TRASEIRA: só as colunas que o plano achou diferentes. As faixas
        // já passaram pelo zod (e o CHECK do banco é a rede de quem escreve por fora).
        Object.assign(mudancas, plano.porta);

        if (Object.keys(mudancas).length) {
          await tx.implement.update({ where: { id: implementId }, data: mudancas });

          for (const [campo, antes, depois] of [
            ['plate', anterior.plate, placa],
            ['chassisNumber', anterior.chassisNumber, chassi],
            ['category', anterior.category, categoria],
            ['type', anterior.type, implemento],
            ['vinPlateId', anterior.vinPlateId, plaquetaId],
            ['rearDoorLeaves', anterior.rearDoorLeaves, plano.porta.rearDoorLeaves],
            ['rearDoorBarCount', anterior.rearDoorBarCount, plano.porta.rearDoorBarCount],
            ['rearDoorHatchCount', anterior.rearDoorHatchCount, plano.porta.rearDoorHatchCount],
          ] as const) {
            if (depois === undefined || (depois ?? null) === antes) continue;
            await this.auditar(tx, {
              entityType: ENTITY_TYPE.IMPLEMENT,
              entityId: implementId,
              field: campo,
              oldValue: antes,
              newValue: depois ?? null,
              responsibleId,
            });
          }
        }
      }

      // ── AS MEDIDAS DO IMPLEMENTO ──────────────────────────────────────────
      //
      // ⛔ O cliente DESENHA o implemento ao pedir o orçamento e, até aqui, não
      // tinha como corrigi-lo: o portal mostrava tabelas de leitura. Medida
      // errada trava o layout e a pintura, e quem a conhece é quem opera o
      // implemento.
      //
      // ⚠️ CENTÍMETROS ENTRAM, METROS SÃO GRAVADOS — `medidaParaPrisma` é a
      // MESMA função da requisição, e a conversão acontece num lugar só nas
      // duas rotas. Ver a armadilha 3 de `portal-request.service.ts`.
      //
      // ⚠️ SUBSTITUI a medida do lado, não acumula: a face tem UMA medida
      // corrente. Existindo linha, ela é atualizada e as seções são refeitas —
      // manter as antigas somaria vãos que o desenho não tem.
      //
      // ⚠️ SÓ AS FACES QUE O PLANO ACHOU DIFERENTES: o desenho reenviado igual
      // não é regravado nem vira linha de trilha sobre nada.
      for (const lado of plano.faces) {
        // Pelo escritor único: `null` explícito apaga a face (a linha só sai se
        // mais ninguém a usa — antes, `.delete().catch()` dentro da transação
        // abortava tudo quando a linha era de outro implemento); editar mexe na
        // linha só se ela é deste lado, senão ganha uma cópia — corrigir o
        // próprio furgão não pode mudar o de outro cliente.
        await setFace(tx, implementId, lado.face, lado.desejada);

        await this.auditar(tx, {
          entityType: ENTITY_TYPE.IMPLEMENT,
          entityId: implementId,
          field: lado.coluna,
          oldValue: lado.atualId,
          // Apagar também deixa trilha — antes, a face sumia sem linha nenhuma.
          newValue: lado.desejada ? 'atualizada pelo cliente no portal' : null,
          responsibleId,
          ...(lado.desejada ? {} : { reason: 'Medida removida pelo cliente no portal' }),
        });
      }

      // ── A PLAQUETA, quando veio como ARQUIVO ──────────────────────────────
      //
      // Mesmo caminho de `task.service.ts` (`createFromUploadWithTransaction`
      // com o contexto `implementVinPlate`, que `files-storage.service.ts` mapeia
      // para a pasta `Plaquetas`). Gravar o `File` na MESMA transação da tarefa
      // é o que impede um arquivo órfão quando algo adiante falha.
      //
      // ⚠️ `userId` vai INDEFINIDO. `File.createdById` é FK para `User`, e um id
      // de contato ali é o defeito que este portal inteiro existe para não
      // cometer. O serviço já trata `undefined`.
      if (plaqueta) {
        const arquivo = await this.files.createFromUploadWithTransaction(
          tx,
          plaqueta,
          'implementVinPlate',
          undefined,
          {
            entityId: implementId,
            entityType: 'IMPLEMENT',
            customerName: task.customer?.fantasyName ?? undefined,
          },
        );

        const antes = task.implement?.vinPlateId ?? null;
        await tx.implement.update({ where: { id: implementId }, data: { vinPlateId: arquivo.id } });

        // O arquivo ANTERIOR não é apagado, de propósito: ele continua
        // acessível pelo changelog, e o `File` pode estar referenciado em outro
        // lugar. É a mesma escolha de `task.service.ts`.
        await this.auditar(tx, {
          entityType: ENTITY_TYPE.IMPLEMENT,
          entityId: implementId,
          field: 'vinPlateId',
          oldValue: antes,
          newValue: arquivo.id,
          responsibleId,
          reason: 'Foto da plaqueta enviada pelo cliente no portal',
        });
      }
    });
  }

  /**
   * UMA LINHA DE AUDITORIA, sempre com `userId: null`.
   *
   * ⛔ `ChangeLog.userId` é FK para `User` e o repositório grava por `connect`:
   * um id de CONTATO ali vira P2025 e derruba a transação de NEGÓCIO que estava
   * sendo auditada — foi assim que sumiram 7 linhas de bonificação em 07/2026.
   * Quem escreveu fica em `metadata.responsibleId`, que é o mesmo lugar onde o
   * caminho do pedido de compra o registra.
   */
  private async auditar(
    tx: PrismaTransaction,
    args: {
      entityType: ENTITY_TYPE;
      entityId: string;
      field: string | null;
      oldValue: unknown;
      newValue: unknown;
      responsibleId: string;
      action?: CHANGE_ACTION;
      reason?: string;
    },
  ): Promise<void> {
    await this.changeLogs.logChange({
      entityType: args.entityType,
      entityId: args.entityId,
      action: args.action ?? CHANGE_ACTION.UPDATE,
      field: args.field ?? undefined,
      oldValue: args.oldValue ?? null,
      newValue: args.newValue ?? null,
      reason: args.reason ?? 'Identificação do veículo informada pelo cliente no portal',
      triggeredBy: CHANGE_TRIGGERED_BY.TASK_UPDATE,
      triggeredById: args.entityId,
      // ⛔ NUNCA o id do contato. Ver o bloco acima.
      userId: null,
      transaction: tx,
      metadata: { origem: 'portal', responsibleId: args.responsibleId },
    });
  }
}

/**
 * A FRASE DA COLISÃO, para UM veículo.
 *
 * `descreverColisao` (de `schemas/portal-request`) fala a língua do FORMULÁRIO
 * de requisição — "nos veículos 2 e 4" —, que não existe aqui: este `PATCH` tem
 * um veículo só e a linha de formulário é sempre a mesma. A FORMA do erro é
 * idêntica (`{ message, errors[], conflicts[] }`, com `field`, `value` e
 * `scope`); o que muda é a frase, que nomeia o valor sem citar um índice que o
 * cliente não veria na tela.
 */
function descreverColisaoDeVeiculo(colisao: PortalColisao): string {
  const rotulo = colisao.field === 'plate' ? 'A placa' : 'O número de série';
  return (
    `${rotulo} ${colisao.value} já está cadastrada em outro veículo. ` +
    'Confira o valor ou fale com o comercial.'
  );
}
