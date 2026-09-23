// api/src/modules/people/portal/portal-request.service.ts
//
// A REQUISIÇÃO DE ORÇAMENTO — o ato que dá razão de ser ao portal.
//
// O cliente descreve o que precisa, aponta os veículos e manda. Nasce um
// `Budget{ status: REQUESTED, subtotal: 0, total: 0 }` SEM `BudgetItem` — preço
// e serviço são do comercial, e inventá-los aqui seria o portal precificando
// sozinho —, com N `Task` (uma por veículo), UM `BudgetPayer` pendurado num
// `Billing` de verdade, e um `BudgetRequest` guardando o briefing.
//
// ═══════════════════════════════════════════════════════════════════════════
// AS CINCO ARMADILHAS DO CONTRATO §5 — E A SEXTA, QUE O DONO ACHOU NA TELA
// ═══════════════════════════════════════════════════════════════════════════
//
// 1. PRODUTO CARTESIANO × UNICIDADE GLOBAL. `Task.serialNumber` e `Truck.plate`
//    são `@unique` GLOBAIS. `garantirUnicidade()` recusa ANTES de escrever, com
//    400 nomeando a série/placa culpada — nunca deixando o Prisma responder
//    "Unique constraint failed on the fields: (`serialNumber`)", que não diz ao
//    cliente QUAL veículo corrigir. O catch de P2002 no fim é rede, não plano:
//    entre a checagem e o INSERT cabe uma criação concorrente.
//
// 2. SÉRIE É TEXTO. `portalSerialSchema` é `z.string()`. O caminho interno de
//    FAIXA é numérico (`serialNumberFrom/To: z.number()`) e não sabe dizer
//    `ABC-123456`.
//
// 3. CENTÍMETROS → METROS. `medidaParaPrisma()` divide por 100 na borda, uma
//    vez, e o teste puro fixa a conta.
//
// 4. `truck.plate`, NUNCA `plate` NO TOPO. Nada aqui é `.strict()`; uma placa no
//    nível errado do objeto some em silêncio e a tarefa nasce sem caminhão. As
//    escritas abaixo são explícitas, campo a campo, e nunca espalham o objeto do
//    cliente dentro de um `data:` do Prisma.
//
// 5. O CAMINHO DE FAIXA DE SÉRIE DESCARTA ARQUIVO. `createTasksFromSerialRange`
//    (`task.service.ts:1879-1936`) declara o parâmetro `files` e chama
//    `batchCreate({ tasks }, include, userId)` sem ele — os anexos somem sem
//    erro. Este serviço NÃO o reusa: cria as tarefas aqui e conecta os
//    `baseFiles` explicitamente.
//
// 6. ⛔ O DOCUMENTO QUE JÁ EXISTE NÃO É ERRO — É O MESMO CLIENTE. Até 20/09
//    este arquivo recusava com 400 ("O CNPJ … já está cadastrado.") quem
//    digitasse o documento de um cadastro que já existia. Era um beco: o
//    vendedor CONHECE a empresa, digita o CNPJ dela, e a porta fecha sem dizer
//    por onde seguir — porque o cadastro pode estar FORA do escopo dele, e
//    então nem a lista do combobox o encontra. O que ele faz em seguida é
//    reescrever o nome com uma letra diferente e criar um SEGUNDO cadastro da
//    MESMA empresa, que parte o faturamento em dois e é por isso que já existe
//    `POST /customers/merge` nesta base. Agora o documento que casa REAPROVEITA
//    o cadastro (`resolverCliente` → `clientePeloDocumento`), e o recibo diz
//    isso em `customerReused`.
//
//    ⚠️ E NADA do cadastro existente é sobrescrito: o nome, o endereço e as
//    inscrições são o registro-mestre da Ankaa, e quem abre a requisição não é
//    dono dele. Divergência entre o que foi digitado e o que está gravado NÃO é
//    erro — é ignorada, e o recibo mostra sob que nome a requisição correu.
//
//    ⚠️ O 400 que existia JÁ DIVULGAVA o mesmo fato (nomeava o CNPJ como
//    cadastrado). Reaproveitar não revela nada de novo; só troca a porta
//    fechada por um caminho. Por isso não há — e não deve haver — rota nova de
//    busca por documento: o dado sai pelo caminho que já existia.
//
// ═══════════════════════════════════════════════════════════════════════════
// E AS TRÊS REGRAS DO PORTAL QUE VALEM EM TODA LINHA
// ═══════════════════════════════════════════════════════════════════════════
//
// • NUNCA `@UserId()`, nunca `request.user`. O sujeito aqui é
//   `ResponsiblePrincipal`, e o id dele NÃO pode encostar em coluna FK de
//   `User` — são 46 NOT NULL, e o `ChangeLog` grava por `connect`. Toda
//   auditoria daqui vai com `userId: null` e autoria em `triggeredById`.
// • `companyId` é NULLABLE. Responsável sem empresa é recusado ANTES de
//   qualquer consulta: sem a guarda, um `where` por empresa vira "todos os
//   órfãos".
// • O pagador não pode nascer sem faturamento (`BudgetPayer.billingId` é NOT
//   NULL), e quem cria os dois é `reconcileQuoteCustomerConfigs` — o funil único
//   de toda recomposição de faturamento. Escrever a linha à mão aqui seria o
//   quinto caminho de escrita a divergir dele.

import {
  BadRequestException,
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
import { PaintService } from '@modules/paint/paint.service';
import {
  PortalNotificationService,
  PORTAL_NOTIFICATION_KEYS,
} from '@modules/common/notification/portal-notification.service';
import { NOTIFICATION_IMPORTANCE } from '@/constants/enums';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import type { ResponsiblePrincipal } from '@modules/people/responsible-auth/responsible-auth.guard';
import { PortalScopeService } from './portal-scope.service';
import { setFace } from '@modules/production/implement-measure/implement-measure-writer';
import {
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  TASK_QUOTE_STATUS,
  TASK_STATUS,
} from '@constants';
import { TASK_QUOTE_STATUS_ORDER, TASK_STATUS_ORDER } from '@/constants/sortOrders';
import { allocateBudgetNumber } from '@utils/budget-number';
import { reconcileQuoteCustomerConfigs } from '@utils/budget-customer-config-sync';
import { generateBaseFileName } from '@utils/task';
import { formatCNPJ, formatCPF } from '@utils';
import {
  colisoesNoPayload,
  descreverColisao,
  medidaParaPrisma,
  type PortalColisao,
  type PortalRequisicaoFormData,
} from '@/schemas/portal-request';

/** O que o multipart entrega. Só `baseFiles` importa nesta rota. */
export interface PortalRequisicaoArquivos {
  baseFiles?: Express.Multer.File[];
}

export interface PortalRequisicaoVeiculoCriado {
  taskId: string;
  truckId: string | null;
  serialNumber: string | null;
  plate: string | null;
  chassisNumber: string | null;
  /** Ids das `ImplementMeasure` criadas, já em METROS no banco. */
  measureIds: { esquerda: string | null; direita: string | null; traseira: string | null };
}

/** Qual documento casou com um cadastro existente. */
export type PortalDocumentoDoCliente = 'cnpj' | 'cpf';

/**
 * O CADASTRO QUE A REQUISIÇÃO REAPROVEITOU no lugar de criar um segundo.
 *
 * Existe para a TELA poder dizer, sem rodeio, que o nome digitado não é o nome
 * sob o qual a requisição correu. Trocar isso em silêncio seria pior que o 400
 * que havia antes: a pessoa digitou "Carrelli Implementos", a requisição nasceu
 * para "Carrellii Implementos Rodoviarios", e ela só descobriria na NFS-e.
 *
 * ⚠️ NADA aqui foi escrito. O cadastro é o registro-mestre da Ankaa e a
 * requisição não o toca — nem o nome, nem o endereço, nem as inscrições.
 */
export interface PortalClienteReaproveitado {
  id: string;
  /** O nome fantasia COMO ESTÁ NO CADASTRO — não o que o cliente digitou. */
  fantasyName: string;
  /** Por qual documento ele foi encontrado. */
  matchedBy: PortalDocumentoDoCliente;
  /** O documento JÁ FORMATADO, que é como a tela o cita. */
  document: string;
  /** O nome fantasia que o formulário trazia, quando difere do cadastrado. */
  typedFantasyName: string | null;
}

export interface PortalRequisicaoCriada {
  budgetId: string;
  budgetNumber: number;
  status: string;
  statusOrder: number;
  requestId: string;
  /** O dono dos veículos (`Task.customerId`). */
  customerId: string;
  /**
   * O nome fantasia do cadastro que a requisição DE FATO usou.
   *
   * ⚠️ Pode não ser o que o formulário digitou — ver `customerReused`.
   */
  customerName: string;
  /** Verdadeiro quando o cliente nasceu nesta requisição. */
  customerCreated: boolean;
  /**
   * Preenchido SÓ quando o documento digitado casou com um cadastro que já
   * existia e a requisição o reaproveitou. `null` em todo o resto — inclusive
   * quando o cliente foi escolhido na lista, que não é reaproveitamento: é
   * escolha.
   *
   * ⛔ `customerCreated === false` sozinho NÃO distingue os dois casos, e é por
   * isso que este campo existe em vez de um segundo booleano.
   */
  customerReused: PortalClienteReaproveitado | null;
  /** "Faturar Para" — o `BudgetPayer.customerId`. */
  faturarParaCustomerId: string;
  billingId: string;
  payerId: string;
  paintId: string | null;
  /** Verdadeiro quando a tinta nasceu nesta requisição. */
  paintCreated: boolean;
  vehicleCount: number;
  vehicles: PortalRequisicaoVeiculoCriado[];
  baseFileIds: string[];
}

/**
 * Validade provisória da requisição.
 *
 * `Budget.expiresAt` é NOT NULL e não tem `@default` — e uma requisição não tem
 * validade: não há proposta a vencer, porque não há preço. O carimbo aqui é
 * placeholder e o comercial o reescreve ao precificar.
 *
 * ⚠️ NÃO há risco de a varredura expirar uma requisição: `markExpiredBySignature`
 * recusa tudo que não esteja em `PENDING` (`budget.service.ts:3369-3375`), e
 * `EXPIRED` só é escrito por ela.
 */
const DIAS_DE_VALIDADE_PROVISORIA = 30;

/** Os lados da medida no portal e a face de cada um (a coluna é do escritor único). */
const LADOS = [
  { chave: 'esquerda', face: 'left' },
  { chave: 'direita', face: 'right' },
  { chave: 'traseira', face: 'back' },
] as const;

@Injectable()
export class PortalRequestService {
  private readonly logger = new Logger(PortalRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
    private readonly paintService: PaintService,
    private readonly notifications: PortalNotificationService,
    private readonly scope: PortalScopeService,
  ) {}

  // ═════════════════════════════════════════════════════════════════════════
  // A ROTA
  // ═════════════════════════════════════════════════════════════════════════

  async criarRequisicao(
    principal: ResponsiblePrincipal,
    dados: PortalRequisicaoFormData,
    arquivos?: PortalRequisicaoArquivos,
  ): Promise<{ success: true; message: string; data: PortalRequisicaoCriada }> {
    // ── A GUARDA DA EMPRESA, ANTES DE QUALQUER CONSULTA ────────────────────
    //
    // `Responsible.companyId` é nullable. Um contato órfão que chegasse até
    // aqui abriria requisição em nome de ninguém — e, pior, todo `where` por
    // empresa montado adiante viraria `companyId IS NULL`, que não é "nada": é
    // "todos os órfãos".
    if (!principal.companyId) {
      throw new ForbiddenException(
        'Seu contato ainda não está vinculado a uma empresa. Fale com o comercial da Ankaa.',
      );
    }

    const baseFiles = arquivos?.baseFiles ?? [];

    // ── A TINTA NOVA NASCE FORA DA TRANSAÇÃO ──────────────────────────────
    //
    // `PaintService.create` abre a PRÓPRIA transação (`paint.service.ts:609`) e
    // aninhá-la na nossa não é possível pela interface dele. O custo é conhecido
    // e aceito: uma requisição que falhe depois deixa a tinta criada no cadastro
    // — tinta é catálogo, não obrigação, e o comercial a reaproveita ou apaga.
    // A alternativa (escrever `tx.paint.create` à mão) pularia `paintValidation`,
    // que é a única coisa que impede tinta duplicada e tipo inexistente.
    let paintId: string | null = dados.paintId ?? null;
    let paintCreated = false;

    if (dados.novaTinta) {
      const criada = await this.paintService.create(
        {
          name: dados.novaTinta.name,
          hex: dados.novaTinta.hex,
          finish: dados.novaTinta.finish,
          paintTypeId: dados.novaTinta.paintTypeId,
          tags: [],
        } as any,
        undefined,
        // ⚠️ SEM userId. O `@UserId()` do portal não existe, e o id do
        // responsável aqui viraria FK de `User`.
        undefined,
      );
      paintId = criada.data?.id ?? null;
      paintCreated = true;
      if (!paintId) {
        throw new InternalServerErrorException('Não foi possível cadastrar a tinta informada.');
      }
    }

    try {
      const resultado = await this.prisma.$transaction(
        async (tx: PrismaTransaction) => {
          // ─── 1. O CLIENTE ──────────────────────────────────────────────
          const { customerId, customerName, customerCreated, customerReused } =
            await this.resolverCliente(tx, principal, dados);

          // ─── 2. "FATURAR PARA" ─────────────────────────────────────────
          //
          // ⚠️ RECEBE O `customerId` JÁ RESOLVIDO, e é o que faz o pagador
          // ausente cair no cadastro REAPROVEITADO em vez de num id que nunca
          // existiu: "ausente = o pagador é o dono do veículo" só é verdade se
          // "o dono" for lido depois da resolução, nunca antes.
          const faturarParaCustomerId = await this.resolverPagador(tx, principal, dados, customerId);

          // ─── 3. A TINTA EXISTENTE ──────────────────────────────────────
          if (paintId && !paintCreated) {
            const tinta = await tx.paint.findUnique({
              where: { id: paintId },
              select: { id: true },
            });
            if (!tinta) throw new NotFoundException('Tinta não encontrada.');
          }

          // ─── 4. AS UNICIDADES, ANTES DE ESCREVER ───────────────────────
          await this.garantirUnicidade(tx, dados.veiculos);

          // ─── 5. O ORÇAMENTO ────────────────────────────────────────────
          const budgetNumber = await allocateBudgetNumber(tx);
          const expiresAt = new Date(
            Date.now() + DIAS_DE_VALIDADE_PROVISORIA * 24 * 60 * 60 * 1000,
          );

          const budget = await tx.budget.create({
            data: {
              budgetNumber,
              // SEM `BudgetItem` e SEM dinheiro: serviço e preço são do
              // comercial. `recalcQuoteTotals` reescreve os dois quando ele
              // montar a lista.
              subtotal: 0,
              total: 0,
              expiresAt,
              status: TASK_QUOTE_STATUS.REQUESTED,
              // ⚠️ NUNCA 0: `sortOrder.ts:74` e `budget.service.ts:6206` calculam
              // `MAP[status] || 1` e transformariam 0 em 1 em silêncio, enquanto
              // `budget-prisma.repository.ts:241` usa `?? 8` e preservaria o 0 —
              // o mesmo status com ordem diferente no CREATE e no UPDATE.
              statusOrder: TASK_QUOTE_STATUS_ORDER[TASK_QUOTE_STATUS.REQUESTED],
              vehicleCount: dados.veiculos.length,
              // JOINT: um faturamento cobrindo os N veículos. É a intenção
              // DECLARADA, e o comercial refatia depois se o cliente pedir.
              billingSplit: 'JOINT',
            },
            select: { id: true, budgetNumber: true, status: true, statusOrder: true },
          });

          // ─── 6. OS VEÍCULOS ────────────────────────────────────────────
          const veiculosCriados: PortalRequisicaoVeiculoCriado[] = [];
          for (const [indice, veiculo] of dados.veiculos.entries()) {
            veiculosCriados.push(
              await this.criarVeiculo(tx, {
                indice,
                veiculo,
                budgetId: budget.id,
                customerId,
                customerName,
                paintId,
                responsibleId: principal.id,
              }),
            );
          }
          const taskIds = veiculosCriados.map(v => v.taskId);

          // ─── 7. OS ARQUIVOS-BASE ───────────────────────────────────────
          const baseFileIds = await this.anexarArquivosBase(tx, {
            baseFiles,
            taskIds,
            nomeDaPrimeiraTarefa: this.nomeDaTarefa(customerName, dados.veiculos[0], 0),
            primeiroVeiculo: dados.veiculos[0],
            customerName,
          });

          // ─── 8. A REQUISIÇÃO PROPRIAMENTE DITA ─────────────────────────
          const request = await tx.budgetRequest.create({
            data: {
              budgetId: budget.id,
              requestedByResponsibleId: principal.id,
              briefing: dados.briefing,
              logoName: dados.logoName ?? null,
            },
            select: { id: true },
          });

          // ─── 9. O PAGADOR, PELO FUNIL ÚNICO ────────────────────────────
          //
          // `reconcileQuoteCustomerConfigs` cria o `Billing` (via
          // `ensureBillingForCoverage`, porque `BudgetPayer.billingId` é NOT
          // NULL), cria o pagador e grava a cobertura — nesta ordem, e é a
          // MESMA função que a edição do orçamento usa. Escrever as três linhas
          // à mão aqui criaria o quinto caminho de escrita de faturamento.
          //
          // `taskIds` vai explícito porque as tarefas acabaram de nascer NESTA
          // transação: sem ele a função lê o banco e recebe o estado de antes.
          await reconcileQuoteCustomerConfigs(
            tx,
            budget.id,
            [{ customerId: faturarParaCustomerId, taskIds }],
            { billingSplit: 'JOINT', taskIds },
          );

          const pagador = await tx.budgetPayer.findFirst({
            where: { quoteId: budget.id, customerId: faturarParaCustomerId },
            select: { id: true, billingId: true },
          });
          if (!pagador) {
            // Nunca deve acontecer — mas um pagador que não nasceu é um
            // orçamento que não sabe quem paga, e isso não pode virar 201.
            throw new InternalServerErrorException(
              'A requisição foi montada sem um pagador. Nada foi gravado.',
            );
          }

          // ─── 10. A AUDITORIA ───────────────────────────────────────────
          await this.registrarAuditoria(tx, {
            principal,
            budgetId: budget.id,
            budgetNumber: budget.budgetNumber,
            requestId: request.id,
            customerId,
            customerReused,
            faturarParaCustomerId,
            paintId,
            veiculos: veiculosCriados,
            baseFileIds,
            briefing: dados.briefing,
            logoName: dados.logoName ?? null,
          });

          const criada: PortalRequisicaoCriada = {
            budgetId: budget.id,
            budgetNumber: budget.budgetNumber,
            status: budget.status as string,
            statusOrder: budget.statusOrder,
            requestId: request.id,
            customerId,
            customerName,
            customerCreated,
            customerReused,
            faturarParaCustomerId,
            billingId: pagador.billingId,
            payerId: pagador.id,
            paintId,
            paintCreated,
            vehicleCount: veiculosCriados.length,
            vehicles: veiculosCriados,
            baseFileIds,
          };
          return criada;
        },
        // Upload de até 30 arquivos roda DENTRO da transação (o `File` e o
        // vínculo com a tarefa têm de nascer no mesmo commit). Os 5 s padrão do
        // Prisma não cobrem isso; é o mesmo teto que `task.service.ts:2289` usa.
        { timeout: 180_000, maxWait: 20_000 },
      );

      this.logger.log(
        `[Portal] Requisição ${resultado.budgetNumber} aberta por ${principal.name} ` +
          `(${principal.id}) com ${resultado.vehicleCount} veículo(s).`,
      );

      // ── O AVISO AO COMERCIAL ────────────────────────────────────────────
      //
      // Depois do commit, e sem poder derrubá-lo: `notifyBudgetCommercial` não
      // lança, e uma requisição gravada não pode ser desfeita porque o aviso
      // falhou.
      //
      // Esta é a PRIMEIRA ponta da passagem de bastão, e era a única que não
      // avisava ninguém: a decisão do cliente já notificava
      // (`portal-decision.service.ts`), a precificação da Ankaa também
      // (`budget.service.ts` → `notifyRequesterValuesVisible`), mas a chegada
      // da requisição, não — apesar de a tela prometer "Nosso comercial recebe
      // na hora" e de o recibo dizer "já está com o comercial". Sem isto, uma
      // requisição só existe para quem reparar numa linha nova no topo de uma
      // lista de 495.
      const quoteLabel = `nº ${resultado.budgetNumber} · ${resultado.customerName}`;
      await this.notifications.notifyBudgetCommercial({
        budgetId: resultado.budgetId,
        // A tarefa-âncora é a do PRIMEIRO veículo: é o id que as telas
        // internas usam na URL, e uma requisição sempre nasce com pelo menos
        // um (o zod exige `veiculos` não vazio).
        taskId: resultado.vehicles[0]?.taskId ?? null,
        quoteLabel,
        configKey: PORTAL_NOTIFICATION_KEYS.REQUESTED,
        title: 'Nova requisição de orçamento',
        body:
          `${principal.name} abriu a requisição ${quoteLabel}` +
          `${principal.companyName ? ` (${principal.companyName})` : ''} ` +
          `com ${resultado.vehicleCount} veículo(s). Monte os serviços e os preços.`,
        importance: NOTIFICATION_IMPORTANCE.HIGH,
        extraMetadata: {
          requestedByResponsibleId: principal.id,
          requestId: resultado.requestId,
          vehicleCount: resultado.vehicleCount,
        },
      });

      return {
        success: true,
        // ⚠️ O REAPROVEITAMENTO ENTRA NA FRASE, e não só no corpo. O interceptor
        // do web toasta esta `message` em toda escrita que dá certo; deixá-lo só
        // em `data` faria a única pista de que o nome mudou depender de a tela
        // lembrar de desenhá-la.
        message: this.mensagemDoRecibo(resultado),
        data: resultado,
      };
    } catch (erro) {
      throw this.traduzirErro(erro, dados);
    }
  }

  /**
   * A FRASE DO RECIBO.
   *
   * Uma só quando nada de estranho aconteceu; duas quando a requisição correu
   * sob um cadastro que já existia — porque nesse caso a pessoa digitou um nome
   * e o orçamento nasceu com outro, e ela tem de saber disso ANTES de ligar para
   * o comercial perguntando por um cliente que não existe.
   */
  private mensagemDoRecibo(resultado: PortalRequisicaoCriada): string {
    const base = `Requisição enviada. O orçamento ${resultado.budgetNumber} já está com o comercial.`;
    const reuso = resultado.customerReused;
    if (!reuso) return base;

    const rotulo = reuso.matchedBy === 'cnpj' ? 'CNPJ' : 'CPF';
    return (
      `${base} O ${rotulo} ${reuso.document} já estava cadastrado como ` +
      `"${reuso.fantasyName}" — a requisição usou esse cadastro, e nada foi ` +
      'alterado nele.'
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // O CLIENTE
  // ═════════════════════════════════════════════════════════════════════════

  private async resolverCliente(
    tx: PrismaTransaction,
    principal: ResponsiblePrincipal,
    dados: PortalRequisicaoFormData,
  ): Promise<{
    customerId: string;
    customerName: string;
    customerCreated: boolean;
    customerReused: PortalClienteReaproveitado | null;
  }> {
    if (dados.customerId) {
      // ⛔ `findFirst` COM O ALCANCE, nunca `findUnique` pelo id cru.
      //
      // O combobox só oferece os clientes de `GET /cliente/me/clientes`, que é
      // escopado — mas LISTA NÃO É GUARDA. Enquanto aqui havia um `findUnique`,
      // quem mandasse o `customerId` de qualquer empresa da base criava um
      // orçamento em nome dela. O predicado é o MESMO que o catálogo oferece
      // (`PortalScopeService.customerScopeWhere`), para que a tela e o servidor
      // não possam divergir.
      //
      // Fora do alcance responde 404, e não 403, pela doutrina do contrato
      // (§4, decisão 1): a existência de um cadastro que este contato não
      // alcança não é informação dele.
      const existente = await tx.customer.findFirst({
        where: { AND: [{ id: dados.customerId }, this.scope.customerScopeWhere(principal)] },
        select: { id: true, fantasyName: true },
      });
      if (!existente) throw new NotFoundException('Cliente não encontrado.');
      return {
        customerId: existente.id,
        customerName: existente.fantasyName,
        customerCreated: false,
        // Escolher na lista NÃO é reaproveitar: não houve nome digitado que
        // pudesse ter sido trocado, e não há nada a avisar.
        customerReused: null,
      };
    }

    const novo = dados.novoCliente!;

    // ── 1. O DOCUMENTO MANDA — casou, REAPROVEITA (armadilha 6) ────────────
    //
    // Antes de qualquer outra checagem, e de propósito: se o documento é de um
    // cadastro que já existe, a discussão acabou — é o mesmo cliente, e a
    // requisição corre para ELE. O nome fantasia digitado nem é olhado; ver
    // abaixo por quê.
    const reaproveitado = await this.clientePeloDocumento(tx, novo);
    if (reaproveitado) {
      // ⛔ NENHUM `update`. O que o formulário trouxe de diferente (nome,
      // endereço, e-mail, inscrições) é DESCARTADO, não gravado: o cadastro é
      // o registro-mestre da Ankaa e quem abre a requisição não é dono dele.
      // Divergir do que está gravado não é erro do cliente — é o cadastro
      // estando mais completo que a memória de quem digitou.
      this.logger.log(
        `[Portal] ${principal.name} (${principal.id}) digitou um cadastro que já existe: ` +
          `${reaproveitado.matchedBy.toUpperCase()} ${reaproveitado.document} → ` +
          `"${reaproveitado.fantasyName}" (${reaproveitado.id}). Reaproveitado, nada criado.`,
      );
      return {
        customerId: reaproveitado.id,
        customerName: reaproveitado.fantasyName,
        customerCreated: false,
        customerReused: reaproveitado,
      };
    }

    // ── 2. SEM DOCUMENTO CASADO, o nome fantasia é conflito DE VERDADE ─────
    //
    // `Customer.fantasyName` é `@unique`, e chegar aqui significa que o
    // documento informado NÃO é o do cadastro que tem esse nome: são duas
    // empresas diferentes com o mesmo nome de fachada. Criar é impossível
    // (a unicidade recusa) e reaproveitar seria pior — amarraria a requisição
    // ao CNPJ errado. Então recusa-se, dizendo o que fazer.
    //
    // ⚠️ A ORDEM IMPORTA: esta checagem vem DEPOIS da do documento. Invertida,
    // ela recusaria o caso normal em que o cliente digita o mesmo nome e o
    // mesmo documento do cadastro que já existe — que é exatamente o caso que
    // a armadilha 6 veio atender.
    const porNome = await tx.customer.findFirst({
      where: { fantasyName: novo.fantasyName },
      select: { id: true },
    });
    if (porNome) {
      const frase =
        `Já existe outro cliente cadastrado com o nome fantasia "${novo.fantasyName}", ` +
        'e o documento que você informou não é o dele. Confira o CNPJ/CPF: se for o mesmo ' +
        'cliente, corrija o documento e usaremos o cadastro que já existe; se for outro ' +
        'cliente, escolha um nome fantasia que diferencie os dois.';
      throw new BadRequestException({
        statusCode: 400,
        message: frase,
        errors: [frase],
      });
    }

    const criado = await tx.customer.create({
      data: {
        fantasyName: novo.fantasyName,
        // ⚠️ `cpf` ENTRA. `CustomerService.quickCreate` grava `cpf: null` fixo
        // (`customer.service.ts:383`), o que torna impossível cadastrar pessoa
        // física pela combobox — e é exatamente o cliente que a NFS-e depois
        // cobra. Aqui o documento é o que o cliente informou.
        cpf: novo.cpf ?? null,
        cnpj: novo.cnpj ?? null,
        corporateName: novo.corporateName ?? null,
        email: novo.email ?? null,
        streetType: (novo.streetType ?? null) as any,
        address: novo.address ?? null,
        addressNumber: novo.addressNumber ?? null,
        addressComplement: novo.addressComplement ?? null,
        neighborhood: novo.neighborhood ?? null,
        city: novo.city ?? null,
        state: novo.state ?? null,
        zipCode: novo.zipCode ?? null,
        phones: novo.phones ?? [],
        tags: [],
        stateRegistration: novo.stateRegistration ?? null,
        municipalRegistration: novo.municipalRegistration ?? null,
      },
      select: { id: true, fantasyName: true },
    });

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.CUSTOMER,
      entityId: criado.id,
      action: CHANGE_ACTION.CREATE,
      reason: `Cliente cadastrado pelo portal, na requisição de ${principal.name}`,
      // ⚠️ `userId: null`, SEMPRE. O id do responsável não existe em `User`, e o
      // changelog grava por `connect`: ele viraria P2025 e derrubaria a
      // transação de NEGÓCIO que estava sendo auditada.
      userId: null,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: principal.id,
      metadata: { portal: true, responsibleId: principal.id, responsibleName: principal.name },
      transaction: tx,
    });

    return {
      customerId: criado.id,
      customerName: criado.fantasyName,
      customerCreated: true,
      customerReused: null,
    };
  }

  /**
   * O CADASTRO QUE JÁ TEM ESTE DOCUMENTO — nas DUAS grafias, para os DOIS
   * documentos.
   *
   * ⚠️ `customerCreateSchema` NUNCA limpou o documento, então o cadastro guarda
   * CNPJ **formatado** (`12.345.678/0001-90`) lado a lado com CNPJ em dígitos, e
   * a unicidade da coluna não reconhece as duas grafias como o mesmo documento.
   * Procurar só pelos dígitos — que é o que o zod do portal entrega — acharia
   * metade do cadastro e criaria o duplicado na outra metade.
   *
   * ⚠️ CNPJ ANTES DE CPF, e não por acaso: é a ordem determinística. Um cliente
   * que informe os dois e cujos documentos apontem para cadastros DIFERENTES é
   * dado inconsistente do lado de lá; escolher sempre o mesmo é o que faz o
   * resultado ser reproduzível em vez de depender da ordem da consulta.
   */
  private async clientePeloDocumento(
    tx: PrismaTransaction,
    novo: NonNullable<PortalRequisicaoFormData['novoCliente']>,
  ): Promise<PortalClienteReaproveitado | null> {
    const documentos: Array<{
      campo: PortalDocumentoDoCliente;
      digitos: string;
      formatado: string;
    }> = [];

    if (novo.cnpj) documentos.push({ campo: 'cnpj', digitos: novo.cnpj, formatado: formatCNPJ(novo.cnpj) });
    if (novo.cpf) documentos.push({ campo: 'cpf', digitos: novo.cpf, formatado: formatCPF(novo.cpf) });

    for (const documento of documentos) {
      const achado = await tx.customer.findFirst({
        where: {
          OR: [
            { [documento.campo]: documento.digitos },
            { [documento.campo]: documento.formatado },
          ],
        } as Prisma.CustomerWhereInput,
        select: { id: true, fantasyName: true },
      });
      if (!achado) continue;

      const digitado = (novo.fantasyName ?? '').trim();
      return {
        id: achado.id,
        fantasyName: achado.fantasyName,
        matchedBy: documento.campo,
        document: documento.formatado,
        // Só quando DIFERE: mandar o mesmo nome duas vezes faria a tela
        // desenhar "você digitou X, usaremos X", que é ruído.
        typedFantasyName:
          digitado && digitado !== achado.fantasyName ? digitado : null,
      };
    }

    return null;
  }

  private async resolverPagador(
    tx: PrismaTransaction,
    principal: ResponsiblePrincipal,
    dados: PortalRequisicaoFormData,
    customerId: string,
  ): Promise<string> {
    // Ausente = o pagador É o dono dos veículos. Ver a nota no schema: com
    // `novoCliente` o id ainda não existe quando o formulário é enviado, então
    // exigir o campo tornaria a criação inline inexpressável.
    if (!dados.faturarParaCustomerId) return customerId;
    if (dados.faturarParaCustomerId === customerId) return customerId;

    // ⛔ E AQUI O ALCANCE PESA MAIS QUE NO CLIENTE DO SERVIÇO.
    //
    // O pagador é a ÂNCORA DO DINHEIRO: `BudgetPayer.customerId` é o que vira
    // `Invoice.customerId` (NOT NULL) e o que a NFS-e cita. Com o `findUnique`
    // pelo id cru que havia aqui, um contato de uma empresa podia eleger
    // QUALQUER outra como pagadora de um orçamento — sem nenhum laço com ela.
    // Mesmo predicado do combobox, pela mesma razão do `resolverCliente`.
    const pagador = await tx.customer.findFirst({
      where: {
        AND: [{ id: dados.faturarParaCustomerId }, this.scope.customerScopeWhere(principal)],
      },
      select: { id: true },
    });
    if (!pagador) throw new NotFoundException('O cliente escolhido para faturamento não existe.');
    return pagador.id;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // AS UNICIDADES — a armadilha nº 1
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Recusa a requisição INTEIRA, com 400 e o valor culpado, quando uma série ou
   * uma placa colide — dentro do próprio envio ou contra o banco.
   *
   * TODAS as colisões voltam de uma vez. Devolver a primeira faria o cliente
   * corrigir cinco veículos em cinco idas e vindas.
   */
  private async garantirUnicidade(
    tx: PrismaTransaction,
    veiculos: PortalRequisicaoFormData['veiculos'],
  ): Promise<void> {
    const colisoes: PortalColisao[] = colisoesNoPayload(veiculos as any);

    const series = this.valoresDistintos(veiculos, 'serialNumber');
    const placas = this.valoresDistintos(veiculos, 'plate');

    if (series.size > 0) {
      const existentes = await tx.task.findMany({
        where: { serialNumber: { in: [...series.keys()] } },
        select: { serialNumber: true },
      });
      for (const { serialNumber } of existentes) {
        if (!serialNumber) continue;
        colisoes.push({
          field: 'serialNumber',
          value: serialNumber,
          scope: 'database',
          vehicleIndexes: series.get(serialNumber) ?? [],
        });
      }
    }

    if (placas.size > 0) {
      const existentes = await tx.truck.findMany({
        where: { plate: { in: [...placas.keys()] } },
        select: { plate: true },
      });
      for (const { plate } of existentes) {
        if (!plate) continue;
        colisoes.push({
          field: 'plate',
          value: plate,
          scope: 'database',
          vehicleIndexes: placas.get(plate) ?? [],
        });
      }
    }

    if (colisoes.length > 0) throw this.erroDeColisao(colisoes);
  }

  /** Valor → índices dos veículos que o usam. `null` não conta: duas colunas
   *  `String?` com NULL não colidem num índice único do Postgres. */
  private valoresDistintos(
    veiculos: PortalRequisicaoFormData['veiculos'],
    campo: 'serialNumber' | 'plate',
  ): Map<string, number[]> {
    const mapa = new Map<string, number[]>();
    veiculos.forEach((veiculo, indice) => {
      const valor = (veiculo as any)[campo];
      if (typeof valor !== 'string' || valor === '') return;
      const lista = mapa.get(valor);
      if (lista) lista.push(indice);
      else mapa.set(valor, [indice]);
    });
    return mapa;
  }

  private erroDeColisao(colisoes: PortalColisao[]): BadRequestException {
    const frases = colisoes.map(descreverColisao);
    return new BadRequestException({
      statusCode: 400,
      message: frases[0],
      errors: frases,
      // O CAMPO QUE A TELA LÊ. Traz `field`, `value` e o ÍNDICE do veículo para
      // que o formulário marque a linha exata em vermelho — um `message` solto
      // obrigaria o web a fazer parsing de frase.
      conflicts: colisoes,
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // O VEÍCULO
  // ═════════════════════════════════════════════════════════════════════════

  private nomeDaTarefa(
    customerName: string,
    veiculo: PortalRequisicaoFormData['veiculos'][number] | undefined,
    indice: number,
  ): string {
    const identidade =
      veiculo?.serialNumber || veiculo?.plate || veiculo?.chassisNumber || `Veículo ${indice + 1}`;
    return `${customerName} - ${identidade}`.slice(0, 200);
  }

  private async criarVeiculo(
    tx: PrismaTransaction,
    contexto: {
      indice: number;
      veiculo: PortalRequisicaoFormData['veiculos'][number];
      budgetId: string;
      customerId: string;
      customerName: string;
      paintId: string | null;
      responsibleId: string;
    },
  ): Promise<PortalRequisicaoVeiculoCriado> {
    const { veiculo, indice } = contexto;

    const task = await tx.task.create({
      data: {
        name: this.nomeDaTarefa(contexto.customerName, veiculo, indice),
        status: TASK_STATUS.PREPARATION,
        statusOrder: TASK_STATUS_ORDER[TASK_STATUS.PREPARATION],
        // ⚠️ TEXTO. Ver a armadilha 2 no cabeçalho.
        serialNumber: veiculo.serialNumber ?? null,
        customer: { connect: { id: contexto.customerId } },
        quote: { connect: { id: contexto.budgetId } },
        ...(contexto.paintId && { generalPainting: { connect: { id: contexto.paintId } } }),
        // ── O REQUISITANTE VIRA CONTATO DO VEÍCULO ───────────────────────
        //
        // É o caminho (c) do escopo do portal (`PortalScopeService`): "EU sou
        // contato de um dos veículos". Sem este vínculo, quem abriu a
        // requisição só a reencontraria pelo caminho da empresa — e o caso
        // Furgões existe justamente porque a empresa do contato não é
        // necessariamente a dona do caminhão.
        responsibles: { connect: { id: contexto.responsibleId } },
        // ⚠️ `truck.plate`, NUNCA `plate` no topo (armadilha 4). Nada é
        // `.strict()`: uma placa no nível errado sumiria sem erro e a tarefa
        // nasceria sem caminhão.
        truck: {
          create: {
            plate: veiculo.plate ?? null,
            chassisNumber: veiculo.chassisNumber ?? null,
            // O que o cliente informou na porta. Ausente = ausente: o comercial
            // pergunta, e o próprio cliente pode completar depois no portal.
            category: veiculo.category ?? null,
            implementType: veiculo.implementType ?? null,
          },
        },
      },
      select: { id: true, serialNumber: true, truck: { select: { id: true } } },
    });

    const truckId = task.truck?.id ?? null;
    const measureIds: PortalRequisicaoVeiculoCriado['measureIds'] = {
      esquerda: null,
      direita: null,
      traseira: null,
    };

    if (truckId && veiculo.medidas) {
      for (const lado of LADOS) {
        const entrada = (veiculo.medidas as any)?.[lado.chave];
        if (!entrada) continue;

        // ⚠️ AQUI, E SÓ AQUI, CENTÍMETROS VIRAM METROS (armadilha 3).
        const emMetros = medidaParaPrisma(entrada);

        // Pelo escritor único: o caminhão acabou de nascer, então a face ganha
        // a SUA linha.
        const medida = await setFace(tx, truckId, lado.face, emMetros);

        measureIds[lado.chave] = medida.measureId;
      }
    }

    return {
      taskId: task.id,
      truckId,
      serialNumber: task.serialNumber ?? null,
      plate: veiculo.plate ?? null,
      chassisNumber: veiculo.chassisNumber ?? null,
      measureIds,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // OS ARQUIVOS-BASE
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Sobe os arquivos UMA vez e os conecta a TODAS as tarefas.
   *
   * `Task.baseFiles` é m:n implícita (`File.taskBaseFiles`, `schema.prisma:790`),
   * então a mesma linha de `File` serve os N veículos — que é o certo: a arte de
   * uma requisição é a mesma para a frota inteira. Subir N cópias criaria N
   * arquivos idênticos no disco e N linhas a manter sincronizadas.
   *
   * ⚠️ É o oposto do caminho de FAIXA DE SÉRIE, que declara `files` e nunca os
   * usa (armadilha 5).
   */
  private async anexarArquivosBase(
    tx: PrismaTransaction,
    contexto: {
      baseFiles: Express.Multer.File[];
      taskIds: string[];
      nomeDaPrimeiraTarefa: string;
      primeiroVeiculo: PortalRequisicaoFormData['veiculos'][number] | undefined;
      customerName: string;
    },
  ): Promise<string[]> {
    if (contexto.baseFiles.length === 0 || contexto.taskIds.length === 0) return [];

    // `generateBaseFileName` lê as medidas da ESQUERDA e da DIREITA para compor
    // o sufixo do nome; o objeto abaixo é a forma mínima que ele espera. As
    // medidas vão EM METROS, porque é o que o resto do sistema formata.
    const medidas = contexto.primeiroVeiculo?.medidas ?? null;
    const taskParaNome = {
      truck: medidas
        ? {
            leftSideMeasure: medidas.esquerda ? medidaParaPrisma(medidas.esquerda) : null,
            rightSideMeasure: medidas.direita ? medidaParaPrisma(medidas.direita) : null,
          }
        : null,
    };

    const ids: string[] = [];
    for (let i = 0; i < contexto.baseFiles.length; i++) {
      const arquivo = contexto.baseFiles[i];
      arquivo.originalname = generateBaseFileName(
        contexto.nomeDaPrimeiraTarefa,
        taskParaNome,
        arquivo.originalname,
        i + 1,
      );

      const registro = await this.fileService.createFromUploadWithTransaction(
        tx,
        arquivo,
        'taskBaseFiles',
        // ⚠️ SEM userId — ver o cabeçalho. O serviço já trata `undefined`.
        undefined,
        {
          entityId: contexto.taskIds[0],
          entityType: 'TASK',
          customerName: contexto.customerName,
        },
      );
      ids.push(registro.id);
    }

    for (const taskId of contexto.taskIds) {
      await tx.task.update({
        where: { id: taskId },
        data: { baseFiles: { connect: ids.map(id => ({ id })) } },
      });
    }

    return ids;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // AUDITORIA E ERROS
  // ═════════════════════════════════════════════════════════════════════════

  private async registrarAuditoria(
    tx: PrismaTransaction,
    contexto: {
      principal: ResponsiblePrincipal;
      budgetId: string;
      budgetNumber: number;
      requestId: string;
      customerId: string;
      customerReused: PortalClienteReaproveitado | null;
      faturarParaCustomerId: string;
      paintId: string | null;
      veiculos: PortalRequisicaoVeiculoCriado[];
      baseFileIds: string[];
      briefing: string;
      logoName: string | null;
    },
  ): Promise<void> {
    const autoria = {
      portal: true,
      responsibleId: contexto.principal.id,
      responsibleName: contexto.principal.name,
      companyId: contexto.principal.companyId,
    };

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.TASK_QUOTE,
      entityId: contexto.budgetId,
      action: CHANGE_ACTION.CREATE,
      reason: `Requisição aberta no portal do cliente por ${contexto.principal.name}`,
      newValue: {
        budgetNumber: contexto.budgetNumber,
        status: TASK_QUOTE_STATUS.REQUESTED,
        requestId: contexto.requestId,
        customerId: contexto.customerId,
        // A TRILHA DO REAPROVEITAMENTO. Sem esta linha, o dia em que alguém
        // perguntar "por que esta requisição está no cliente X se o vendedor
        // jurou ter cadastrado o Y?" não tem resposta no changelog.
        customerReused: contexto.customerReused,
        faturarParaCustomerId: contexto.faturarParaCustomerId,
        paintId: contexto.paintId,
        briefing: contexto.briefing,
        logoName: contexto.logoName,
        vehicleCount: contexto.veiculos.length,
        baseFiles: contexto.baseFileIds.length,
      },
      userId: null,
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: contexto.principal.id,
      metadata: autoria,
      transaction: tx,
    });

    for (const veiculo of contexto.veiculos) {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.TASK,
        entityId: veiculo.taskId,
        action: CHANGE_ACTION.CREATE,
        reason: `Veículo incluído na requisição ${contexto.budgetNumber} pelo portal do cliente`,
        newValue: {
          serialNumber: veiculo.serialNumber,
          plate: veiculo.plate,
          chassisNumber: veiculo.chassisNumber,
          quoteId: contexto.budgetId,
        },
        userId: null,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: contexto.principal.id,
        metadata: autoria,
        transaction: tx,
      });
    }
  }

  /**
   * REDE, NÃO PLANO.
   *
   * `garantirUnicidade` roda antes de escrever, mas entre a checagem e o INSERT
   * cabe uma criação concorrente. Quando isso acontece o Prisma devolve P2002 —
   * e "Unique constraint failed on the fields: (`serialNumber`)" não diz ao
   * cliente QUAL veículo corrigir. Aqui ele vira a mesma frase de 400 que a
   * checagem produziria.
   */
  private traduzirErro(erro: unknown, dados: PortalRequisicaoFormData): unknown {
    if (
      erro instanceof BadRequestException ||
      erro instanceof NotFoundException ||
      erro instanceof ForbiddenException
    ) {
      return erro;
    }

    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      const alvo = erro.meta?.target;
      const campos = Array.isArray(alvo) ? alvo.map(String) : [String(alvo ?? '')];

      if (campos.some(c => c.includes('serialNumber'))) {
        const valores = [
          ...this.valoresDistintos(dados.veiculos, 'serialNumber').entries(),
        ].map(([value, vehicleIndexes]) => ({
          field: 'serialNumber' as const,
          value,
          scope: 'database' as const,
          vehicleIndexes,
        }));
        return new BadRequestException({
          statusCode: 400,
          message:
            'Um dos números de série desta requisição acabou de ser usado em outro serviço. ' +
            'Confira as séries e envie de novo.',
          errors: valores.map(descreverColisao),
          conflicts: valores,
        });
      }

      if (campos.some(c => c.includes('plate'))) {
        const valores = [...this.valoresDistintos(dados.veiculos, 'plate').entries()].map(
          ([value, vehicleIndexes]) => ({
            field: 'plate' as const,
            value,
            scope: 'database' as const,
            vehicleIndexes,
          }),
        );
        return new BadRequestException({
          statusCode: 400,
          message:
            'Uma das placas desta requisição acabou de ser usada em outro serviço. ' +
            'Confira as placas e envie de novo.',
          errors: valores.map(descreverColisao),
          conflicts: valores,
        });
      }

      if (campos.some(c => c.includes('cnpj') || c.includes('cpf') || c.includes('fantasyName'))) {
        // ⚠️ "Selecione-o na lista" era a saída ERRADA: o cadastro pode estar
        // fora do escopo de quem envia, e então a lista não o mostra. Com o
        // reaproveitamento por documento (armadilha 6), reenviar O MESMO corpo
        // resolve sozinho — a segunda tentativa encontra o cadastro e o usa.
        const frase =
          'Esse cliente acabou de ser cadastrado por outra pessoa. Envie a requisição de ' +
          'novo: ela vai usar o cadastro que já existe.';
        return new BadRequestException({
          statusCode: 400,
          message: frase,
          errors: [frase],
        });
      }
    }

    this.logger.error('[Portal] Falha ao abrir requisição de orçamento:', erro as any);
    return new InternalServerErrorException(
      'Não foi possível enviar a requisição. Tente novamente em alguns instantes.',
    );
  }
}
