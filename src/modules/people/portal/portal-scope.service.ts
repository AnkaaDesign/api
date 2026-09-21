// api/src/modules/people/portal/portal-scope.service.ts
//
// QUAIS LINHAS este contato pode ver. Um lugar só, e nunca um `where` escrito à
// mão num controlador.
//
// O PROBLEMA QUE ISTO RESOLVE — a Furgões Ibiporã não é dona do caminhão. Ela
// faz o baú e intermedeia a pintura, e isso já está em dado de produção: os
// orçamentos 259–262 têm DOIS clientes (Ibiporã Implementos + RKO Alimentos), UM
// faturamento, e a repartição estava escrita à mão na OBSERVAÇÃO de cada serviço
// porque não existia coluna (migration `20260917150100`). Um contato da Furgões
// tem `companyId = IBIPORA`; o caminhão é da RKO. Escopar por
// `responsible.companyId === Task.customerId` não mostraria NADA à Furgões.
//
// Daí os três caminhos, em UNIÃO:
//   (a) minha empresa PAGA por isto            ← o caso 259–262
//   (b) minha empresa é a DONA do veículo
//   (c) EU sou contato de um dos veículos      ← a única que hoje decide quem assina
//
// ⛔ ESCOPO NÃO É PROJEÇÃO. (a)(b)(c) dizem QUAIS LINHAS. `sectionsForRoles` diz
// QUAIS COLUNAS (`portal-projection.service.ts`). Os dois são obrigatórios e
// nenhum substitui o outro: escopo certo com projeção esquecida entrega o preço
// ao motorista; projeção certa com escopo esquecido entrega o orçamento do
// vizinho recortado direitinho.
//
// ⛔ E O `MoneyRedactionInterceptor` NÃO PROTEGE O PORTAL: ele chaveia em
// `request.user.role`, e a guarda do responsável escreve em
// `request.responsible`. Com privilégio indefinido ele deixa passar intocado. A
// redação do portal é do projetor, não dele.
//
// Padrão copiado de `DossierAssemblerService.build(quoteId, { customerId })`
// (`common/signature/dossier/dossier-assembler.service.ts:354-363, 1516-1550`),
// que é o único ajudante de escopo correto que já existia: ele RECUSA cliente
// fora do faturamento em vez de cair no dossiê completo em silêncio, e corta
// boleto e nota por `Invoice.customerId` (NOT NULL) e não por
// `Installment.customerConfigId` (opcional, e que fica órfão numa reversão).
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ResponsiblePrincipal } from '../responsible-auth/responsible-auth.guard';

/**
 * O mínimo que este serviço lê do principal.
 *
 * Deliberadamente um `Pick`, e não o `ResponsiblePrincipal` inteiro: o escopo
 * não depende de papel nenhum — papel decide COLUNAS, não LINHAS — e aceitar o
 * objeto inteiro convidaria alguém a misturar as duas perguntas aqui dentro.
 */
export type PortalScopePrincipal = Pick<ResponsiblePrincipal, 'id' | 'companyId'>;

/**
 * O escopo já provado: os dois ids, ambos NÃO-NULOS.
 *
 * `assertScoped` devolve isto em vez de `void` de propósito. Devolvendo o par, o
 * chamador usa `scope.companyId` — que o compilador sabe ser `string` — em vez
 * de voltar a ler `principal.companyId`, que é `string | null` e onde o `null`
 * volta a estar a um descuido de distância.
 */
export interface PortalScope {
  responsibleId: string;
  companyId: string;
}

@Injectable()
export class PortalScopeService {
  /**
   * ⛔ A GUARDA QUE SUSTENTA TUDO. Responsável sem empresa é RECUSADO aqui,
   * antes de qualquer `where` ser montado.
   *
   * `Responsible.companyId` é NULLABLE (`schema.prisma`, `@map("customerId")`).
   * Um `where` montado sem esta guarda não vira "nada": vira
   * `WHERE customerId IS NULL`, que no Postgres casa com TODOS OS ÓRFÃOS. O
   * contato sem empresa não receberia uma lista vazia — receberia a lista dos
   * orçamentos de todo mundo que também está sem empresa, e a consulta
   * pareceria estar funcionando.
   *
   * Pior: `undefined` é ainda mais perigoso que `null`. No Prisma,
   * `{ customerId: undefined }` não é "nenhum cliente" — é "sem filtro", e a
   * cláusula inteira desaparece. É exatamente a forma do defeito que já
   * aconteceu neste repositório com `{ AND: [{ OR: [] }] }`, que devolve a
   * TABELA porque o `OR` vazio evapora aninhado.
   *
   * Por isso os três `…ScopeWhere` abaixo chamam esta guarda eles mesmos, e não
   * confiam no chamador ter chamado: a única forma de obter um `where` deste
   * serviço é passar pela recusa.
   *
   * 403 e não 401: a sessão é VÁLIDA — quem entrou entrou de verdade, por OTP.
   * O que falta é vínculo com uma empresa, e isso é cadastro, não credencial.
   * Devolver 401 faria o portal do web apagar a sessão e mandar o contato fazer
   * login de novo, para cair exatamente no mesmo lugar.
   */
  assertScoped(principal: PortalScopePrincipal | null | undefined): PortalScope {
    const responsibleId = principal?.id?.trim();
    if (!responsibleId) {
      // Só acontece se alguém montar o `where` fora de uma rota
      // `@ResponsibleOnly()`. Falhar alto é o comportamento certo: o silencioso
      // seria montar o caminho (c) com `id: undefined` — "sem filtro".
      throw new ForbiddenException('Esta operação exige uma sessão do portal do cliente.');
    }

    const companyId = principal?.companyId?.trim();
    if (!companyId) {
      throw new ForbiddenException(
        'Seu cadastro de contato não está vinculado a uma empresa. Fale com o comercial.',
      );
    }

    return { responsibleId, companyId };
  }

  /**
   * OS ORÇAMENTOS que este contato pode ver — a união dos três caminhos.
   *
   * (a) `billings.customerConfigs.customerId` — minha empresa PAGA. A âncora é o
   *     PAGADOR do faturamento (`BudgetPayer.customerId`, NOT NULL), não
   *     `Budget.customerConfigs`, que sobrevive como lista depreciada de
   *     pagadores pendurada direto no orçamento. Ir pelo `Billing` é o que faz
   *     o caso Furgões funcionar: um faturamento, dois pagadores, e cada um
   *     enxerga o orçamento inteiro porque ambos estão na conta.
   *
   * (b) `tasks.customerId` — minha empresa é DONA de pelo menos um veículo.
   *
   * (c) `tasks.responsibles.id` — EU sou contato de pelo menos um veículo.
   *     `Task.responsibles` é m:n e NADA confere contra `Task.customerId`: um
   *     contato da Furgões já pode estar preso a um caminhão da RKO, e é, por
   *     acidente, a única modelagem de intermediação que existe. Este caminho
   *     transforma o acidente em regra — e é o ÚNICO dos três que é pessoal, e
   *     não da empresa.
   *
   * ⚠️ O `OR` tem SEMPRE três ramos e nenhum deles é `{}`. Um ramo vazio, ou um
   * `OR: []`, não restringe nada — devolve a tabela.
   */
  budgetScopeWhere(principal: PortalScopePrincipal): Prisma.BudgetWhereInput {
    const { responsibleId, companyId } = this.assertScoped(principal);
    return {
      OR: [
        { billings: { some: { customerConfigs: { some: { customerId: companyId } } } } },
        { tasks: { some: { customerId: companyId } } },
        { tasks: { some: { responsibles: { some: { id: responsibleId } } } } },
      ],
    };
  }

  /**
   * OS VEÍCULOS que este contato pode ver — as mesmas três ideias, um nível
   * abaixo.
   *
   * (a) `billingEntry.billing.customerConfigs.customerId` — minha empresa paga
   *     POR ESTE VEÍCULO. `Task.billingEntry` é de-UM (`BillingTask` tem
   *     `@@unique([taskId])`), então o operador é `is`, não `some`.
   *
   * (b) `customerId` — o veículo é da minha empresa.
   *
   * (c) `responsibles.some.id` — eu sou contato DESTE veículo.
   *
   * ⚠️ É DE PROPÓSITO mais estreito que "os veículos de um orçamento que eu
   * vejo". Num orçamento `PER_TASK` com dez veículos e dez faturamentos, quem
   * paga o terceiro vê o ORÇAMENTO inteiro (caminho (a) de `budgetScopeWhere`, e
   * tem de ver: o contrato é um só) mas não tem por que ver a placa dos outros
   * nove. Quem quiser as tarefas de um orçamento já escopado aplica este `where`
   * também no include:
   *
   *     include: { tasks: { where: scope.taskScopeWhere(principal) } }
   *
   * Sem isso, o include devolve TODAS as tarefas do orçamento, e o recorte por
   * seção não salva — `VEHICLE` libera placa e chassi de quem estiver na lista.
   */
  taskScopeWhere(principal: PortalScopePrincipal): Prisma.TaskWhereInput {
    const { responsibleId, companyId } = this.assertScoped(principal);
    return {
      OR: [
        {
          billingEntry: {
            is: { billing: { customerConfigs: { some: { customerId: companyId } } } },
          },
        },
        { customerId: companyId },
        { responsibles: { some: { id: responsibleId } } },
      ],
    };
  }

  /**
   * O CORTE COMERCIAL DE UM VEÍCULO — (a) e (b), SEM o (c).
   *
   * ⛔ O QUE ESTE MÉTODO EXISTE PARA IMPEDIR, nas duas direções
   *
   * O ato que o usa é o PEDIDO DE COMPRA: o Compras do cliente carimba o número
   * do pedido dele num veículo. Escopar esse ato pelo `taskScopeWhere` inteiro,
   * ou pela igualdade `task.customerId === companyId`, erra de um lado cada vez:
   *
   *   · `task.customerId === companyId` RECUSA O CASO PRINCIPAL. A Furgões
   *     Ibiporã emite o pedido e o caminhão é da RKO (orçamentos 259–262,
   *     migration `20260917150100`). Com a igualdade, o Compras da Furgões não
   *     consegue ligar o pedido dela a caminhão NENHUM — a feature nasce morta
   *     no cenário que a justifica.
   *
   *   · `taskScopeWhere` inteiro ACEITA DEMAIS. O caminho (c) — "eu sou contato
   *     deste veículo" — é PESSOAL, atravessa empresas de propósito e não
   *     carrega nenhum laço comercial: `Task.responsibles` é m:n e NADA confere
   *     contra `Task.customerId`. Um contato que apareça, por cadastro antigo ou
   *     por engano, na lista de um caminhão de outra empresa carimbaria o pedido
   *     da empresa DELE num veículo com que a empresa dele não tem conta a
   *     acertar — e o `@@unique([customerId, number])` não perceberia nada,
   *     porque o pedido está certo; errado está o vínculo.
   *
   * Sobram (a) e (b), que são exatamente "existe uma conta entre a minha empresa
   * e este veículo":
   *
   *   (a) minha empresa é PAGADORA do faturamento que cobre este veículo
   *       (`BudgetPayer.customerId`, NOT NULL) — o caso Furgões;
   *   (b) minha empresa é a DONA do veículo (`Task.customerId`) — o caso comum.
   *
   * ⚠️ É a MESMA expressão de (a) e (b) em `taskScopeWhere`, e tem de continuar
   * sendo: dois jeitos de escrever "minha empresa paga" envelhecem em um só.
   */
  commercialTaskScopeWhere(principal: PortalScopePrincipal): Prisma.TaskWhereInput {
    const { companyId } = this.assertScoped(principal);
    return commercialTaskWhereForCustomer(companyId);
  }

  /**
   * O FRAGMENTO que TODO `include`/`select` de pagador tem de espalhar.
   *
   *     customerConfigs: { ...scope.payerScopeSelect(principal), select: { … } }
   *
   * ⛔ NUNCA `customerConfigs: true`, e nunca um `select` de pagador sem este
   * `where`. `GET /budgets/public/:id` erra exatamente isso hoje: devolve o
   * cadastro fiscal, as parcelas, os boletos e as notas de TODOS os pagadores, e
   * o recorte por cliente é um `.filter()` no navegador
   * (`web/src/pages/public/budget/[id].tsx:161-170`). Num orçamento de dois
   * pagadores, A recebe o CNPJ, o endereço e o plano de pagamento de B.
   *
   * Por que devolve `{ where: … }` e não só o `where`: espalhar
   * (`...payerScopeSelect(p)`) escreve a chave certa sozinho. Devolvendo o
   * `where` nu, alguém escreveria `customerConfigs: { where: fragmento, … }`
   * hoje e `customerConfigs: { select: … }` amanhã, e a segunda forma compila.
   */
  payerScopeSelect(principal: PortalScopePrincipal): { where: Prisma.BudgetPayerWhereInput } {
    const { companyId } = this.assertScoped(principal);
    return { where: { customerId: companyId } };
  }

  /**
   * O mesmo corte, do lado do DINHEIRO.
   *
   * A âncora é `Invoice.customerId`, coluna NOT NULL, e não
   * `Installment.customerConfigId`, que é opcional e fica órfã numa reversão de
   * faturamento — um boleto sem lastro de configuração cairia na lista de todo
   * mundo. É literalmente o critério de `DossierAssemblerService.listBankSlips`
   * e `listNfse`, e está aqui para que o portal o copie em vez de reinventá-lo.
   */
  invoiceScopeWhere(principal: PortalScopePrincipal): Prisma.InvoiceWhereInput {
    const { companyId } = this.assertScoped(principal);
    return { customerId: companyId };
  }

  /**
   * OS CLIENTES QUE ESTE CONTATO PODE APONTAR.
   *
   * (a) a MINHA empresa — sempre, mesmo sem veículo nenhum: é a primeira
   *     requisição de um cliente novo, e sem este ramo o combobox nasceria
   *     vazio justamente para quem mais precisa dele.
   * (b) quem é DONO de um veículo que eu já vejo (`taskScopeWhere`).
   * (c) quem PAGA um orçamento que eu já vejo — o outro lado do caso Furgões.
   *
   * ⚠️ Os três são `OR` e nenhum é `{}`. Um ramo vazio devolveria o cadastro de
   * clientes inteiro da Ankaa a um contato de cliente.
   *
   * ⛔ POR QUE ELE MORA AQUI, E NÃO NO CATÁLOGO ONDE NASCEU.
   * Este predicado decidia só o que o COMBOBOX oferecia
   * (`portal-catalog.service.ts`), e a requisição resolvia o cliente e o
   * pagador com um `findUnique` pelo id — sem escopo nenhum. A lista era a
   * única guarda, e lista não é guarda: quem mandasse o `customerId` de
   * qualquer empresa da base criava um orçamento em nome dela, e podia elegê-la
   * como PAGADORA — e o pagador é a âncora do dinheiro
   * (`BudgetPayer.customerId` → `Invoice.customerId`). É a mesma doutrina que o
   * contrato escreve para o pedido de compra: o que a tela oferece e o que o
   * servidor aceita têm de ser a MESMA pergunta, feita uma vez só.
   */
  customerScopeWhere(principal: PortalScopePrincipal): Prisma.CustomerWhereInput {
    const { companyId } = this.assertScoped(principal);
    return {
      OR: [
        { id: companyId },
        { tasks: { some: this.taskScopeWhere(principal) } },
        { quoteCustomerConfigs: { some: { quote: this.budgetScopeWhere(principal) } } },
      ],
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// O LAÇO COMERCIAL, FORA DA CLASSE — as duas formas da MESMA pergunta
// ═══════════════════════════════════════════════════════════════════════════
//
// A pergunta "esta empresa tem conta a acertar com este veículo?" é feita em
// dois momentos e precisa da MESMA resposta nos dois:
//
//   · ANTES de carregar, como `where` do Prisma  → `commercialTaskWhereForCustomer`
//   · DEPOIS de carregar, sobre a linha na mão   → `commercialTaskLink`
//
// São funções soltas, e não métodos, por dois motivos somados: quem pergunta
// DEPOIS às vezes não tem principal nenhum (o caminho interno do pedido de
// compra recebe só um `customerId`), e um teste sem banco precisa alcançar o
// predicado sem instanciar serviço nenhum.

/** O `where` de (a)+(b) para UMA empresa. Ver `commercialTaskScopeWhere`. */
export function commercialTaskWhereForCustomer(customerId: string): Prisma.TaskWhereInput {
  return {
    OR: [
      { billingEntry: { is: { billing: { customerConfigs: { some: { customerId } } } } } },
      { customerId },
    ],
  };
}

/**
 * O que o predicado em memória precisa ter vindo no `select`.
 *
 * ⚠️ `customerConfigs` aqui é a LISTA JÁ RECORTADA por
 * `where: { customerId }` — é o mesmo fragmento que `payerScopeSelect` espalha,
 * e continua valendo a regra: nunca `customerConfigs: true`. Uma lista
 * não-vazia significa, e só pode significar, "esta empresa é pagadora deste
 * faturamento".
 */
export interface PortalCommercialTaskRow {
  customerId?: string | null;
  billingEntry?: {
    billing?: { customerConfigs?: Array<{ customerId?: string | null }> | null } | null;
  } | null;
}

/** Por qual dos dois caminhos o vínculo existe — ou `null` se não existe. */
export type PortalCommercialLink = 'OWNER' | 'PAYER';

/**
 * O MESMO (a)+(b), sobre uma linha já carregada.
 *
 * ⛔ FALHA FECHADO DE PROPÓSITO. Quando o `select` do chamador não trouxe
 * `billingEntry.billing.customerConfigs`, o caminho do pagador é INDETECTÁVEL e
 * esta função devolve `null` — recusa. É o comportamento certo: a alternativa
 * ("na dúvida, aceita") transformaria um `select` incompleto num veículo de
 * outra empresa carimbado com o nosso pedido, e nada no banco reclamaria.
 * Quem chama usa `commercialTaskWhereForCustomer` no `where` E este predicado
 * na conferência; os dois lados leem a mesma regra.
 */
export function commercialTaskLink(
  task: PortalCommercialTaskRow | null | undefined,
  customerId: string | null | undefined,
): PortalCommercialLink | null {
  const alvo = customerId?.trim();
  // Sem empresa não há vínculo NENHUM — e, sobretudo, `undefined === undefined`
  // não pode virar "é dono": `Task.customerId` é nullable e uma tarefa órfã
  // casaria com um principal sem empresa.
  if (!alvo) return null;

  if ((task?.customerId ?? null) === alvo) return 'OWNER';

  const pagadores = task?.billingEntry?.billing?.customerConfigs ?? [];
  if (pagadores.some(p => (p?.customerId ?? null) === alvo)) return 'PAYER';

  return null;
}
