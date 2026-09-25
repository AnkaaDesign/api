// api/src/modules/people/portal/portal-capabilities.ts
//
// AS AÇÕES DO PORTAL — o segundo eixo de privilégio, e o menor possível.
//
// `sectionsForRoles()` (`common/signature/quote-sections.ts`) já responde "o que
// este contato VÊ". Não responde "o que este contato FAZ", e as duas perguntas
// não têm a mesma resposta: o Marketing abre uma requisição de serviço e não
// pode ver o preço dela; o Compras informa o número do pedido e não decide
// nada comercial; o Gestor de Frota é quem sabe placa e chassi, e não assina.
//
// Por que um enum e não `@ResponsibleRoles(COMMERCIAL, SELLER, ...)` espalhado
// pelos controladores: a lista de papéis que pode pré-aprovar é a MESMA em
// quatro rotas, e escrita à mão ela diverge na quinta. O nome da ação é
// estável; o conjunto de papéis que a exerce é dado, e dado mora num lugar só.
//
// ⚠️ UNIÃO, NUNCA INTERSEÇÃO. Papel de responsável é LISTA
// (`Responsible.roles`), e um contato que é MARKETING + FINANCIAL exerce o que
// qualquer um dos dois exerce. É a mesma semântica de `sectionsForRoles`, e é
// deliberado: recortar pela interseção faria acumular papéis TIRAR poder, o que
// ninguém espera ao cadastrar um contato com duas funções.
//
// Fonte: `docs/PORTAL-CONTRATO.md` §2.1. A tabela abaixo é a transcrição literal
// daquela tabela; mudá-la aqui sem mudar lá cria duas verdades.
import { RESPONSIBLE_ROLE } from '@constants/enums';
import {
  sectionsForRoles,
  withAlwaysSections,
  type QuoteSection,
} from '@/modules/common/signature/quote-sections';

/**
 * As ações do portal do cliente.
 *
 * Cinco, e não mais: cada valor aqui é um portão que alguém precisa manter. O
 * que não é uma AÇÃO com consequência no banco (abrir requisição, decidir,
 * escrever identidade de veículo, escrever pedido de compra) ou uma superfície
 * inteira de leitura (acompanhar) não vira capacidade — vira seção, e seção já
 * tem dono.
 *
 * `SIGN` NÃO está aqui, e a ausência é decisão, não esquecimento: quem assina o
 * quê é decidido na EMISSÃO do envelope, contato a contato, por
 * `sectionsForRoles` — recorte vazio significa "não assina". Um `SIGN` nesta
 * tabela seria uma segunda verdade sobre a mesma pergunta, e as duas
 * divergiriam na primeira emissão em que o operador sobrescrevesse o padrão.
 * (`docs/PORTAL-DO-RESPONSAVEL.md` §2.1 lista `SIGN` como PROPOSTA; o contrato
 * §2.1, que é a fonte, não o lista. Seguimos o contrato.)
 */
export enum PORTAL_CAPABILITY {
  /** Abrir uma requisição de orçamento (`POST /cliente/me/orcamentos`). */
  REQUEST_BUDGET = 'REQUEST_BUDGET',
  /** Pré-aprovar ou recusar o orçamento precificado pela Ankaa. */
  PRE_APPROVE = 'PRE_APPROVE',
  /** Informar o número do pedido de compra do cliente. */
  WRITE_PURCHASE_ORDER = 'WRITE_PURCHASE_ORDER',
  /** Escrever série, placa, chassi e plaqueta do veículo. */
  WRITE_VEHICLE_IDENTITY = 'WRITE_VEHICLE_IDENTITY',
  /** Acompanhar o andamento da produção. */
  TRACK = 'TRACK',
}

export const PORTAL_CAPABILITIES: readonly PORTAL_CAPABILITY[] = [
  PORTAL_CAPABILITY.REQUEST_BUDGET,
  PORTAL_CAPABILITY.PRE_APPROVE,
  PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER,
  PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY,
  PORTAL_CAPABILITY.TRACK,
];

/** Rótulo em português, para a mensagem de recusa e para a tela. */
export const PORTAL_CAPABILITY_LABELS: Record<PORTAL_CAPABILITY, string> = {
  [PORTAL_CAPABILITY.REQUEST_BUDGET]: 'solicitar orçamento',
  [PORTAL_CAPABILITY.PRE_APPROVE]: 'pré-aprovar ou recusar orçamento',
  [PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER]: 'informar o pedido de compra',
  [PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY]: 'informar série, placa e chassi',
  [PORTAL_CAPABILITY.TRACK]: 'acompanhar a produção',
};

/**
 * QUEM FAZ O QUÊ — `docs/PORTAL-CONTRATO.md` §2.1, transcrita.
 *
 * As quatro defesas que valem registro:
 *
 *  · COMERCIAL, VENDEDOR, REPRESENTANTE e COORDENADOR são o mesmo bloco: quem
 *    conduz a negociação do lado do cliente pede, decide, corrige a identidade
 *    do veículo e acompanha. O que eles NÃO têm é o pedido de compra — esse é
 *    ato do Compras, e dar a eles reproduziria o texto livre que
 *    `Task.customerOrderNumber` já é.
 *
 *  · COMPRAS escreve pedido de compra e identidade de veículo, e não decide
 *    preço. É quem emite o documento sem o qual a nota não sai; a decisão
 *    comercial é de outro. Ver o PORTÃO DO PEDIDO DE COMPRA (contrato §7): um
 *    contato cujo ÚNICO papel é COMPRAS só assina com número de pedido
 *    informado — regra que mora na cerimônia de assinatura, não aqui.
 *
 *  · MARKETING pede e acompanha, e nada mais. Pedir é o caso real (a arte chega
 *    por ele); decidir preço não é assunto dele, e a seção `PRICING` nem sequer
 *    está no recorte dele.
 *
 *  · FINANCEIRO escreve pedido de compra e SÓ ISSO. Não acompanha produção — o
 *    que ele acompanha é dinheiro, e dinheiro é a seção `PAYMENT`, que ele já
 *    tem. Dar-lhe `TRACK` misturaria as duas superfícies.
 *
 *  · GESTOR DE FROTA escreve identidade de veículo e acompanha; MOTORISTA só
 *    acompanha. São os dois papéis que hoje não fazem NADA no sistema — não
 *    assinam, não recebem nada. Esta tabela é a primeira coisa que lhes dá
 *    função.
 *
 * ⚠️ `Record<RESPONSIBLE_ROLE, …>` de propósito: acrescentar um papel ao enum
 * sem decidir o que ele pode fazer passa a ser ERRO DE COMPILAÇÃO. A alternativa
 * (`Partial<Record<…>>` + `?? []`) faria o papel novo nascer sem nenhuma
 * capacidade e em silêncio — que é seguro, mas invisível, e invisível é como um
 * papel fica dois anos sem função.
 */
/**
 * ⚠️ `WRITE_PURCHASE_ORDER` ESTÁ EM TODOS OS PAPÉIS, e isso é decisão do dono:
 *
 *   "vendedor também pode definir o número de pedido, não apenas o compras,
 *    todos os papéis — mas se não tiver, pelo menos o compras fica impedido
 *    de assinar"
 *
 * A regra anterior dava a escrita só a Compras e Financeiro. Ela partia de uma
 * premissa razoável (o pedido é documento de quem o emite) e produzia um
 * gargalo: o número é o endereço administrativo daquela entrega, quem o tem na
 * mão é quem estiver com o e-mail do ERP aberto, e um orçamento inteiro
 * esperava uma pessoa específica digitar cinco dígitos.
 *
 * ⛔ O PORTÃO NÃO MUDOU, e é ele que preserva a exigência original: quem tem
 * Compras como ÚNICA função continua sem assinar enquanto faltar o número
 * (`purchase-order-gate.ts`). A regra sempre foi sobre o ATO DE APROVAR, não
 * sobre quem pode digitar — e separar as duas coisas é o que a torna
 * cumprível: agora o vendedor preenche e o Compras assina, em vez de os dois
 * se esperarem.
 */
export const ROLE_CAPABILITIES: Record<RESPONSIBLE_ROLE, PORTAL_CAPABILITY[]> = {
  [RESPONSIBLE_ROLE.COMMERCIAL]: [
    PORTAL_CAPABILITY.REQUEST_BUDGET,
    PORTAL_CAPABILITY.PRE_APPROVE,
    PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY,
    PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER,
    PORTAL_CAPABILITY.TRACK,
  ],
  [RESPONSIBLE_ROLE.SELLER]: [
    PORTAL_CAPABILITY.REQUEST_BUDGET,
    PORTAL_CAPABILITY.PRE_APPROVE,
    PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY,
    PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER,
    PORTAL_CAPABILITY.TRACK,
  ],
  [RESPONSIBLE_ROLE.REPRESENTATIVE]: [
    PORTAL_CAPABILITY.REQUEST_BUDGET,
    PORTAL_CAPABILITY.PRE_APPROVE,
    PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY,
    PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER,
    PORTAL_CAPABILITY.TRACK,
  ],
  [RESPONSIBLE_ROLE.COORDINATOR]: [
    PORTAL_CAPABILITY.REQUEST_BUDGET,
    PORTAL_CAPABILITY.PRE_APPROVE,
    PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY,
    PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER,
    PORTAL_CAPABILITY.TRACK,
  ],
  [RESPONSIBLE_ROLE.PURCHASING]: [
    PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER,
    PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY,
    PORTAL_CAPABILITY.TRACK,
  ],
  [RESPONSIBLE_ROLE.MARKETING]: [
    PORTAL_CAPABILITY.REQUEST_BUDGET,
    PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER,
    PORTAL_CAPABILITY.TRACK,
  ],
  [RESPONSIBLE_ROLE.FINANCIAL]: [PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER],
  [RESPONSIBLE_ROLE.FLEET_MANAGER]: [
    PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY,
    PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER,
    PORTAL_CAPABILITY.TRACK,
  ],
  [RESPONSIBLE_ROLE.DRIVER]: [PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER, PORTAL_CAPABILITY.TRACK],
};

/**
 * UNIÃO das capacidades das funções do contato, em ordem canônica.
 *
 * Espelha `sectionsForRoles` linha a linha, e isso é intencional:
 *
 *  · entrada é `readonly string[] | null | undefined`, porque quem chama tem um
 *    `ResponsibleRole[]` vindo do banco, ou um corpo HTTP, ou `null` — e nenhum
 *    desses caminhos merece um `?? []` escrito à mão no chamador;
 *  · papel desconhecido é DESCARTADO em silêncio (`?? []`), não rejeitado: um
 *    valor que saiu do enum não é erro do contato, e recusar a requisição
 *    puniria quem não fez nada;
 *  · a saída sai na ordem de `PORTAL_CAPABILITIES`, deduplicada, para que dois
 *    contatos com os mesmos poderes produzam o MESMO array — o que faz a
 *    comparação em teste e a chave de cache serem estáveis.
 */
export function capabilitiesForRoles(
  roles: readonly string[] | null | undefined,
): PORTAL_CAPABILITY[] {
  const union = new Set<string>();
  for (const role of roles ?? []) {
    for (const capability of ROLE_CAPABILITIES[role as RESPONSIBLE_ROLE] ?? []) {
      union.add(capability);
    }
  }
  return PORTAL_CAPABILITIES.filter(c => union.has(c));
}

/**
 * O contato exerce esta ação?
 *
 * `roles` vazio, nulo ou desconhecido devolve `false` — a negação é o padrão, e
 * é ela que faz um cadastro incompleto (`roles: []`, que o banco permite por
 * `@default([])`) ficar de fora em vez de passar por omissão.
 */
export function hasCapability(
  roles: readonly string[] | null | undefined,
  capability: PORTAL_CAPABILITY,
): boolean {
  for (const role of roles ?? []) {
    if ((ROLE_CAPABILITIES[role as RESPONSIBLE_ROLE] ?? []).includes(capability)) return true;
  }
  return false;
}

/**
 * O contato exerce ALGUMA das ações pedidas?
 *
 * É a semântica de `@Roles()` e de `@ResponsibleRoles()` — "tem algum destes?"
 * —, e é a que `@PortalCapability(...)` aplica. Lista vazia devolve `true`:
 * "nenhuma exigência" é ausência de portão, não portão fechado, e é o que o
 * reflector entrega quando o decorador não foi usado.
 */
export function hasAnyCapability(
  roles: readonly string[] | null | undefined,
  capabilities: readonly PORTAL_CAPABILITY[],
): boolean {
  if (!capabilities.length) return true;
  return capabilities.some(c => hasCapability(roles, c));
}

/**
 * Os PAPÉIS que exercem alguma das capacidades pedidas.
 *
 * É a tabela lida na direção contrária, e existe por um motivo estrutural: a
 * guarda global `ResponsibleAuthGuard` já sabe barrar por PAPEL
 * (`RESPONSIBLE_ROLES_KEY`), e ela roda em toda requisição marcada com
 * `@ResponsibleOnly()`, sem `@UseGuards` que alguém possa esquecer. Projetando
 * a capacidade para papéis, `@PortalCapability(...)` é enforçada por aquela
 * guarda — não por uma segunda que dependa de alguém lembrar de instalá-la.
 * Ver `portal-roles.decorator.ts`.
 *
 * Sai na ordem de declaração de `RESPONSIBLE_ROLE`, deduplicada.
 */
export function rolesWithAnyCapability(
  capabilities: readonly PORTAL_CAPABILITY[],
): RESPONSIBLE_ROLE[] {
  return (Object.values(RESPONSIBLE_ROLE) as RESPONSIBLE_ROLE[]).filter(role =>
    capabilities.some(c => ROLE_CAPABILITIES[role].includes(c)),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// O RECORTE DO PORTAL — e por que ele NÃO é `sectionsForRoles` puro
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A seção que cada capacidade IMPLICA para quem a tem.
 *
 * ── O defeito que isto conserta ──
 *
 * `sectionsForRoles(['FLEET_MANAGER'])` e `(['DRIVER'])` devolvem `[]`, e isso
 * está CERTO para a assinatura: conjunto vazio ali significa "este contato não
 * assina", que é o padrão desses dois papéis. Assinar por padrão seria colher a
 * assinatura de quem provavelmente não tem poderes para obrigar a empresa — a
 * disputa que a declaração de representação existe para enfrentar (CC art. 118;
 * ver `docs/BUDGET-SIGNATURE-DESIGN.md` §4.4).
 *
 * Mas aplicado à TELA, o mesmo vazio dava um portal em branco justamente a quem
 * o desenho deu trabalho a fazer: o gestor de frota escreve placa e chassi, e
 * ele e o motorista acompanham o serviço. O `PATCH` funcionaria e o `GET` viria
 * vazio.
 *
 * ── Por que a saída não é mexer em `ROLE_DEFAULT_SECTIONS` ──
 *
 * Dar `['VEHICLE']` ao gestor de frota o tornaria signatário de todo orçamento,
 * porque `createEnvelope` decide quem assina por `sections.length > 0`. Conserta
 * a tela e estraga a cerimônia.
 *
 * ── A regra ──
 *
 * > Você vê o que assinaria, MAIS o que pode fazer.
 *
 * Não é um segundo mapa de seções escrito à mão — é DERIVAÇÃO do mapa de
 * capacidades que já existe logo acima. `sectionsForRoles` continua sendo a
 * régua da assinatura, byte a byte, e ninguém a "ajusta".
 */
export const SECTION_IMPLIED_BY_CAPABILITY: Record<PORTAL_CAPABILITY, readonly string[]> = {
  // Descrever o serviço é dizer QUAL implemento e QUE arte. Preço não entra: a
  // requisição não tem preço por construção — é o que ela vai pedir.
  [PORTAL_CAPABILITY.REQUEST_BUDGET]: ['VEHICLE', 'LAYOUT'],
  // Não se aprova um preço que não se pode ver.
  [PORTAL_CAPABILITY.PRE_APPROVE]: ['VEHICLE', 'SERVICES', 'PRICING'],
  // ⛔ SÓ `VEHICLE`, e este encolhimento é OBRIGATÓRIO desde que a capacidade
  // passou a valer para TODOS os papéis.
  //
  // A implicação era `['VEHICLE', 'PAYMENT']`, e fazia sentido enquanto só
  // Compras e Financeiro escreviam o pedido: os dois vivem do dinheiro, e ver o
  // plano de pagamento era contexto do trabalho deles. Com a capacidade
  // universal, a MESMA linha entregaria parcelas, boletos e notas fiscais ao
  // MARKETING — que por desenho "vê a arte e não vê o preço" — e ao MOTORISTA.
  // Uma decisão sobre quem digita um número teria virado, em silêncio, uma
  // escalada de privilégio sobre documento financeiro.
  //
  // E nada se perde: o número do pedido MORA na identidade do veículo (é o
  // endereço administrativo daquela entrega), não no plano de pagamento. Quem
  // precisa de `PAYMENT` continua recebendo pelo PAPEL — `sectionsForRoles` dá
  // `PAYMENT` ao Financeiro e o documento inteiro a Compras, Comercial,
  // Vendedor, Representante e Coordenador.
  [PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER]: ['VEHICLE'],
  [PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY]: ['VEHICLE'],
  // Acompanhar é `DELIVERY` (prazo, previsão, etapas) sobre um veículo que se
  // possa nomear.
  [PORTAL_CAPABILITY.TRACK]: ['VEHICLE', 'DELIVERY'],
};

/**
 * O recorte de TELA de um contato: o que ele assinaria ∪ o que suas capacidades
 * implicam.
 *
 * Para quem já recebe o documento inteiro (Comercial, Vendedor, Representante,
 * Coordenador, Compras) a união é no-op. Ela só tem efeito nos três papéis de
 * recorte estreito — e é exatamente lá que o portal precisava dela.
 *
 * ⚠️ Passa por `withAlwaysSections` no fim, como `sectionsForRoles`, para que a
 * ordem canônica e a injeção de `VEHICLE` sejam as MESMAS nos dois caminhos.
 * Sem isso, duas listas com o mesmo conteúdo em ordens diferentes produziriam
 * `variantKey` diferentes se um dia alguém as comparasse.
 */
export function portalSectionsFor(roles: readonly string[] | null | undefined): QuoteSection[] {
  const union = new Set<string>(sectionsForRoles(roles));
  for (const capability of capabilitiesForRoles(roles)) {
    for (const section of SECTION_IMPLIED_BY_CAPABILITY[capability]) union.add(section);
  }
  return withAlwaysSections([...union]);
}
