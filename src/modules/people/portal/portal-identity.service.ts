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
//    placa de um caminhão é ato comercial: vale `commercialTaskScopeWhere`,
//    (a) PAGADOR ∨ (b) DONO, o MESMO predicado do pedido de compra. E a
//    conferência é feita DUAS vezes — no `where` e, sobre a linha carregada,
//    por `commercialTaskLink`, que falha FECHADO quando o `select` não trouxe a
//    prova do pagador.
//
// 3. ⛔ FORA DO ESCOPO É 404, NUNCA 403. A existência de um veículo de outra
//    empresa não é informação que o portal confirme — 403 confirmaria.
//
// 4. ⛔ `Truck` PODE NÃO EXISTIR. É 1:1 com `Task` e NULLABLE, e os editores
//    internos simplesmente desaparecem quando não há linha. Um `truck.update`
//    otimista estoura P2025 e derruba a transação; o portal CRIA a linha quando
//    chega placa, chassi ou plaqueta para uma tarefa que não a tem.
//
// 5. ⛔ NUNCA `plate` NO TOPO. `taskUpdateSchema` não é `.strict()` e chave fora
//    do lugar SOME EM SILÊNCIO — o formulário diria "salvo", e a placa não
//    existiria. Aqui não se passa por `TaskService`: escreve-se direto em
//    `tx.truck`, que é o modelo que tem as colunas.
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
  ForbiddenException,
  Injectable,
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
import { medidaParaPrisma } from '@/schemas/portal-request';
import {
  VEHICLE_IDENTITY_FIELDS,
  type DesiredVehicleIdentity,
} from './portal-vehicle-identity';

/** O que o multipart entrega. Só a plaqueta importa nesta rota. */
export interface PortalIdentificacaoArquivos {
  truckVinPlate?: Express.Multer.File[];
}

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
    quoteId: true,
    customerId: true,
    serialNumber: true,
    customerOrderNumber: true,
    purchaseOrderId: true,
    // A previsão de liberação — o cliente a edita pelo portal.
    forecastDate: true,
    customer: { select: { id: true, fantasyName: true, corporateName: true } },
    truck: {
      select: {
        id: true,
        plate: true,
        chassisNumber: true,
        category: true,
        implementType: true,
        leftSideMeasureId: true,
        rightSideMeasureId: true,
        backSideMeasureId: true,
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

/** Os três lados de `ImplementMeasure` e a coluna de `Truck` de cada um. */
const LADOS_DA_MEDIDA = [
  { chave: 'esquerda', coluna: 'leftSideMeasureId' },
  { chave: 'direita', coluna: 'rightSideMeasureId' },
  { chave: 'traseira', coluna: 'backSideMeasureId' },
] as const;

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

    const plaqueta = arquivos?.truckVinPlate?.[0] ?? null;

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

    // ── 4. ⛔ A COLETA DE ASSINATURAS ────────────────────────────────────────
    //
    // ⚠️ SÓ O QUE DE FATO MUDA É JULGADO. Um campo cujo valor pedido é o que já
    // está gravado é NO-OP: não escreve nada, não pode contradizer documento
    // nenhum, e julgá-lo produziria um 409 sobre nada.
    //
    // O caso não é hipotético. O congelado e o cadastro de hoje PODEM divergir
    // sem que ninguém tenha passado por aqui: `PUT /tasks/:id` escreve placa e
    // chassi por escrita aninhada em `truck` e NÃO chama
    // `onQuoteContentChanged` — é o buraco medido no orçamento nº 945. Nesse
    // estado, um reenvio do formulário do portal com os valores que ele acabou
    // de LER seria recusado por uma alteração que outra pessoa fez.
    const desejado = this.apenasOQueMuda(task, dados, pedido);
    await this.assertNaoContradizDocumento(task.quoteId, taskId, desejado);

    // ── 5. AS UNICIDADES GLOBAIS ─────────────────────────────────────────────
    await this.garantirUnicidade(taskId, dados);

    // ── 6. O PEDIDO DE COMPRA, PELO SERVIÇO QUE FAZ A ESCRITA DUPLA ──────────
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

    // ── 7. A ESCRITA DA IDENTIDADE ───────────────────────────────────────────
    await this.gravar(task, dados, plaqueta, responsibleId);

    this.logger.log(
      `Identificação do veículo ${taskId} atualizada pelo portal ` +
        `(contato ${responsibleId}, empresa ${companyId})`,
    );

    // ── 8. A RESPOSTA É A MESMA DO `GET` ─────────────────────────────────────
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
      serialNumber?: string | null;
      customerOrderNumber?: string | null;
      truck?: {
        plate?: string | null;
        chassisNumber?: string | null;
        category?: string | null;
        implementType?: string | null;
      } | null;
    },
    dados: PortalIdentificacaoFormData,
    pedido: string | null | undefined,
  ): DesiredVehicleIdentity {
    const atual = {
      serialNumber: task.serialNumber ?? null,
      plate: task.truck?.plate ?? null,
      chassisNumber: task.truck?.chassisNumber ?? null,
      orderNumber: task.customerOrderNumber ?? null,
      category: task.truck?.category ?? null,
      implementType: task.truck?.implementType ?? null,
    };
    const pedidos: DesiredVehicleIdentity = {
      serialNumber: dados?.serialNumber,
      plate: dados?.plate,
      chassisNumber: dados?.chassisNumber,
      orderNumber: pedido,
      category: dados?.category,
      implementType: dados?.implementType,
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
  // AS UNICIDADES — `Task.serialNumber` e `Truck.plate` são GLOBAIS
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
      const dono = await this.prisma.task.findFirst({
        // `NOT: { id }` e não um filtro em memória: reescrever a série do MESMO
        // veículo com o valor que ele já tem não é colisão, e sem esta exclusão
        // todo reenvio do formulário acusaria o próprio veículo.
        where: { serialNumber: serie, NOT: { id: taskId } },
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
      const dono = await this.prisma.truck.findFirst({
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
    task: Prisma.TaskGetPayload<{ select: ReturnType<typeof taskSelectFor> }>,
    dados: PortalIdentificacaoFormData,
    plaqueta: Express.Multer.File | null,
    responsibleId: string,
  ): Promise<void> {
    const serie = dados?.serialNumber;
    const placa = dados?.plate;
    const chassi = dados?.chassisNumber;
    const plaquetaId = dados?.vinPlateFileId;
    // Categoria e implemento moram no MESMO `Truck` da placa e do chassi, e
    // seguem o mesmo par de regras: `undefined` é "não mexa", `null` é "apague".
    const categoria = dados?.category;
    const implemento = dados?.implementType;
    const previsao = dados?.forecastDate;
    const medidas = dados?.medidas;

    // Precisa existir uma linha de `Truck`? Só quando algo do CAMINHÃO chega.
    // A série mora em `Task` e não justifica criar caminhão nenhum.
    //
    // ⛔ CATEGORIA E IMPLEMENTO ENTRAM NESTA CONTA, e esquecê-los custou um
    // `200 OK` que não gravou nada: a rota aceitava os dois, a guarda do
    // documento os classificava, e então este `false` pulava o bloco inteiro do
    // caminhão em silêncio. Um "salvo com sucesso" que não salvou é pior do que
    // um erro — o cliente fecha a tela achando que corrigiu o cadastro.
    const mexeNoCaminhao =
      placa !== undefined ||
      chassi !== undefined ||
      categoria !== undefined ||
      implemento !== undefined ||
      // ⚠️ A MEDIDA TAMBÉM É DO CAMINHÃO: as três colunas de `ImplementMeasure`
      // penduram em `Truck`, e sem passar por aqui o `truckId` fica nulo e o
      // bloco das medidas é pulado — 200 sem gravar, o mesmo defeito que
      // categoria e implemento tiveram antes de entrarem nesta conta.
      medidas !== undefined ||
      plaquetaId !== undefined ||
      Boolean(plaqueta);

    // ⚠️ UMA TRANSAÇÃO. Tarefa, caminhão, arquivo e as linhas de auditoria
    // descrevem UM fato; metade aplicada é o pior estado possível — um caminhão
    // criado com a placa e a série antiga na tarefa, ou um `File` gravado sem
    // ninguém apontando para ele.
    await this.prisma.$transaction(async tx => {
      // ── A PREVISÃO DE LIBERAÇÃO, em `Task` ────────────────────────────────
      //
      // Mesma coluna que o quadro de preparação interno usa. Quem sabe quando o
      // caminhão sai da frota é o cliente; até aqui a data entrava por telefone.
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

      // ── A SÉRIE, em `Task` ────────────────────────────────────────────────
      if (serie !== undefined && (serie ?? null) !== (task.serialNumber ?? null)) {
        await tx.task.update({ where: { id: task.id }, data: { serialNumber: serie ?? null } });
        await this.auditar(tx, {
          entityType: ENTITY_TYPE.TASK,
          entityId: task.id,
          field: 'serialNumber',
          oldValue: task.serialNumber ?? null,
          newValue: serie ?? null,
          responsibleId,
        });
      }

      if (!mexeNoCaminhao) return;

      // ── ⛔ O CAMINHÃO PODE NÃO EXISTIR ────────────────────────────────────
      //
      // `Truck` é 1:1 com `Task` e NULLABLE — os editores internos de placa e
      // chassi somem da tela quando não há linha. Um `tx.truck.update` otimista
      // estouraria P2025 e derrubaria a transação inteira; e a tarefa nasce sem
      // caminhão em todo caminho que não passa pelo formulário completo.
      //
      // ⚠️ E NUNCA por `taskUpdateSchema` com `plate` no topo: aquele schema não
      // é `.strict()`, a chave sumiria em silêncio e o portal diria "salvo".
      // Aqui se escreve no modelo que TEM as colunas.
      let truckId = task.truck?.id ?? null;
      const anterior = {
        plate: task.truck?.plate ?? null,
        chassisNumber: task.truck?.chassisNumber ?? null,
        category: task.truck?.category ?? null,
        implementType: task.truck?.implementType ?? null,
        vinPlateId: task.truck?.vinPlateId ?? null,
      };

      if (!truckId) {
        const criado = await tx.truck.create({
          data: {
            taskId: task.id,
            plate: placa ?? null,
            chassisNumber: chassi ?? null,
            category: categoria ?? null,
            implementType: implemento ?? null,
            // A plaqueta enviada por id entra já na criação; a que sobe por
            // multipart precisa do `truckId` para o contexto do arquivo e é
            // ligada logo abaixo.
            vinPlateId: plaquetaId ?? null,
          },
          select: { id: true },
        });
        truckId = criado.id;

        await this.auditar(tx, {
          entityType: ENTITY_TYPE.TRUCK,
          entityId: truckId,
          field: null,
          oldValue: null,
          newValue: {
            plate: placa ?? null,
            chassisNumber: chassi ?? null,
            category: categoria ?? null,
            implementType: implemento ?? null,
          },
          action: CHANGE_ACTION.CREATE,
          responsibleId,
          reason: 'Caminhão criado pelo cliente ao informar a identificação no portal',
        });
      } else {
        const mudancas: Prisma.TruckUpdateInput = {};
        if (placa !== undefined && (placa ?? null) !== anterior.plate) {
          mudancas.plate = placa ?? null;
        }
        if (chassi !== undefined && (chassi ?? null) !== anterior.chassisNumber) {
          mudancas.chassisNumber = chassi ?? null;
        }
        if (categoria !== undefined && (categoria ?? null) !== anterior.category) {
          mudancas.category = categoria ?? null;
        }
        if (implemento !== undefined && (implemento ?? null) !== anterior.implementType) {
          mudancas.implementType = implemento ?? null;
        }
        if (plaquetaId !== undefined && (plaquetaId ?? null) !== anterior.vinPlateId) {
          mudancas.vinPlate = plaquetaId ? { connect: { id: plaquetaId } } : { disconnect: true };
        }

        if (Object.keys(mudancas).length) {
          await tx.truck.update({ where: { id: truckId }, data: mudancas });

          for (const [campo, antes, depois] of [
            ['plate', anterior.plate, placa],
            ['chassisNumber', anterior.chassisNumber, chassi],
            ['category', anterior.category, categoria],
            ['implementType', anterior.implementType, implemento],
            ['vinPlateId', anterior.vinPlateId, plaquetaId],
          ] as const) {
            if (depois === undefined || (depois ?? null) === antes) continue;
            await this.auditar(tx, {
              entityType: ENTITY_TYPE.TRUCK,
              entityId: truckId,
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
      // caminhão.
      //
      // ⚠️ CENTÍMETROS ENTRAM, METROS SÃO GRAVADOS — `medidaParaPrisma` é a
      // MESMA função da requisição, e a conversão acontece num lugar só nas
      // duas rotas. Ver a armadilha 3 de `portal-request.service.ts`.
      //
      // ⚠️ SUBSTITUI a medida do lado, não acumula: a face tem UMA medida
      // corrente. Existindo linha, ela é atualizada e as seções são refeitas —
      // manter as antigas somaria vãos que o desenho não tem.
      if (medidas && truckId) {
        for (const lado of LADOS_DA_MEDIDA) {
          const entrada = (medidas as Record<string, unknown>)?.[lado.chave];
          if (entrada === undefined) continue;

          const atualId = (task.truck as Record<string, any> | null | undefined)?.[lado.coluna] ?? null;

          // `null` explícito = apagar a face.
          if (entrada === null) {
            if (atualId) {
              await tx.truck.update({ where: { id: truckId }, data: { [lado.coluna]: null } });
              await tx.implementMeasure.delete({ where: { id: atualId } }).catch(() => undefined);
            }
            continue;
          }

          const emMetros = medidaParaPrisma(entrada as never);

          if (atualId) {
            // ⚠️ A CHAVE É `implementMeasureId`, não `measureId` — o nome curto
            // devolve 400 do Prisma em runtime.
            await tx.implementMeasureSection.deleteMany({ where: { implementMeasureId: atualId } });
            await tx.implementMeasure.update({
              where: { id: atualId },
              data: {
                height: emMetros.height,
                sections: {
                  create: emMetros.sections.map(secao => ({
                    width: secao.width,
                    isDoor: secao.isDoor,
                    doorHeight: secao.doorHeight,
                    position: secao.position,
                  })),
                },
              },
            });
          } else {
            const criada = await tx.implementMeasure.create({
              data: {
                height: emMetros.height,
                sections: {
                  create: emMetros.sections.map(secao => ({
                    width: secao.width,
                    isDoor: secao.isDoor,
                    doorHeight: secao.doorHeight,
                    position: secao.position,
                  })),
                },
              },
              select: { id: true },
            });
            await tx.truck.update({
              where: { id: truckId },
              data: { [lado.coluna]: criada.id },
            });
          }

          await this.auditar(tx, {
            entityType: ENTITY_TYPE.TRUCK,
            entityId: truckId,
            field: lado.coluna,
            oldValue: atualId,
            newValue: 'atualizada pelo cliente no portal',
            responsibleId,
          });
        }
      }

      // ── A PLAQUETA, quando veio como ARQUIVO ──────────────────────────────
      //
      // Mesmo caminho de `task.service.ts` (`createFromUploadWithTransaction`
      // com o contexto `truckVinPlate`, que `files-storage.service.ts` mapeia
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
          'truckVinPlate',
          undefined,
          {
            entityId: truckId,
            entityType: 'TRUCK',
            customerName: task.customer?.fantasyName ?? undefined,
          },
        );

        const antes = task.truck?.vinPlateId ?? null;
        await tx.truck.update({ where: { id: truckId }, data: { vinPlateId: arquivo.id } });

        // O arquivo ANTERIOR não é apagado, de propósito: ele continua
        // acessível pelo changelog, e o `File` pode estar referenciado em outro
        // lugar. É a mesma escolha de `task.service.ts`.
        await this.auditar(tx, {
          entityType: ENTITY_TYPE.TRUCK,
          entityId: truckId,
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
