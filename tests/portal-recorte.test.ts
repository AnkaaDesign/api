/**
 * O RECORTE DO PORTAL — quais COLUNAS cada papel de contato pode ver, e quais
 * AÇÕES cada um exerce.
 *
 * É a PRIMEIRA verificação do eixo de privilégio do cliente neste repositório.
 * `@ResponsibleRoles()` e `<ResponsibleRoute roles={…}>` existem desde 17/09 com
 * ZERO call sites nos dois repos — ou seja, a régua nunca foi exercida. Por isso
 * este arquivo é exaustivo: 9 papéis × 7 seções e 9 papéis × 5 capacidades,
 * escritos como TABELA-VERDADE literal, transcrita de `docs/PORTAL-CONTRATO.md`
 * §2 e §2.1. Uma tabela escrita à mão é a única forma de a divergência entre o
 * documento e o código aparecer como falha, e não como comportamento.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. RECORTE NO NAVEGADOR. `findPublic` devolve tudo e o web filtra
 *     (`web/src/pages/public/budget/[id].tsx:161-170`). A tela esconde; o JSON
 *     cru está no DevTools. Aqui o recorte é do SERVIDOR: o que a seção não
 *     libera não existe no objeto.
 *  2. DOIS MAPAS DE SEÇÃO. Se o portal tivesse o seu próprio, a tela mostraria
 *     o que o PDF assinado pela MESMA pessoa esconde. A verificação de que
 *     `PortalProjectionService.sectionsFor` É `sectionsForRoles` está abaixo.
 *  3. INTERSEÇÃO NO LUGAR DE UNIÃO. Um contato MARKETING + FINANCIAL tem de
 *     receber a união dos dois recortes. Recortar pela interseção faria
 *     ACUMULAR papéis TIRAR poder — que é o inverso do que quem cadastra espera.
 *  4. CAMPO INTERNO VAZANDO. `totalActiveTimeSeconds`, `assignedTo`, `pausedAt`,
 *     `Implement.spot`, bonificação, `Task.details`, `Task.term` — e as O.S.
 *     COMERCIAIS, que incluem "Aplicar Desconto", "Contraproposta" e "Tratar
 *     Reclamação", e que `GET /task-quotes/public/:id` já devolve hoje.
 *
 * Sem banco e sem Nest: o projetor é puro, recebe a linha crua e devolve o DTO.
 *
 * `npm run test:portal-recorte`
 */

// ⚠️ `Prisma.Decimal` DE VERDADE, e não um dublê com `toNumber`. A conversão do
// projetor é por FORMA (`toNumber` + `toFixed`), e um dublê escrito aqui provaria
// apenas que o dublê casa com a régua — não que a classe que o driver realmente
// devolve casa. É a única linha deste arquivo que toca o cliente gerado, e ela
// não abre banco nenhum.
import { Prisma } from '@prisma/client';
import { RESPONSIBLE_ROLE } from '../src/constants/enums';
import {
  QUOTE_SECTIONS,
  sectionsForRoles,
  type QuoteSection,
} from '../src/modules/common/signature/quote-sections';
import {
  capabilitiesForRoles,
  hasAnyCapability,
  hasCapability,
  PORTAL_CAPABILITIES,
  PORTAL_CAPABILITY,
  ROLE_CAPABILITIES,
  rolesWithAnyCapability,
  portalSectionsFor,
} from '../src/modules/people/portal/portal-capabilities';
import {
  PORTAL_NEVER_EXPOSED,
  PORTAL_NEVER_EXPOSED_ON_VEHICLE,
  PortalProjectionService,
} from '../src/modules/people/portal/portal-projection.service';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * Todos os valores-FOLHA da árvore.
 *
 * Existe porque `JSON.stringify(...).includes('2000.00')` deixou de provar
 * qualquer coisa no dia em que o dinheiro virou número: `2000` não contém
 * `'2000.00'`, e a verificação passava sozinha mesmo com o valor vazando. A
 * comparação agora é com o VALOR, nas duas formas.
 */
function allValues(node: unknown, acc: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    node.forEach(v => allValues(v, acc));
    return acc;
  }
  if (node instanceof Date) {
    acc.push(node);
    return acc;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) allValues(v, acc);
    return acc;
  }
  acc.push(node);
  return acc;
}

/** Todas as chaves de objeto da árvore, em qualquer profundidade. */
function allKeys(node: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach(v => allKeys(v, acc));
    return acc;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      acc.add(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

const ALL_ROLES = Object.values(RESPONSIBLE_ROLE) as RESPONSIBLE_ROLE[];

// ─────────────────────────────────────────────────────────────────────────────
// A TABELA-VERDADE DAS SEÇÕES — `docs/PORTAL-CONTRATO.md` §2, transcrita
// ─────────────────────────────────────────────────────────────────────────────
const TODAS: QuoteSection[] = [
  'VEHICLE',
  'SERVICES',
  'PRICING',
  'DELIVERY',
  'PAYMENT',
  'GUARANTEE',
  'LAYOUT',
];

const SECOES_ESPERADAS: Record<RESPONSIBLE_ROLE, QuoteSection[]> = {
  [RESPONSIBLE_ROLE.COMMERCIAL]: TODAS,
  [RESPONSIBLE_ROLE.SELLER]: TODAS,
  [RESPONSIBLE_ROLE.REPRESENTATIVE]: TODAS,
  [RESPONSIBLE_ROLE.COORDINATOR]: TODAS,
  [RESPONSIBLE_ROLE.PURCHASING]: TODAS,
  // Tudo MENOS `LAYOUT`: preço, prazo, pagamento e garantia são o objeto dele; a
  // arte não é, e ela circula antes de estar aprovada.
  [RESPONSIBLE_ROLE.FINANCIAL]: [
    'VEHICLE',
    'SERVICES',
    'PRICING',
    'DELIVERY',
    'PAYMENT',
    'GUARANTEE',
  ],
  // Só a arte — e a identificação do veículo, que `withAlwaysSections` injeta em
  // todo recorte NÃO-vazio: sem série e sem placa o recorte não diz DE QUE
  // TRABALHO ele fala.
  [RESPONSIBLE_ROLE.MARKETING]: ['VEHICLE', 'LAYOUT'],
  // ⛔ VAZIO — e o vazio é PRESERVADO vazio. Ver a seção "A contradição do
  // contrato", mais abaixo.
  [RESPONSIBLE_ROLE.FLEET_MANAGER]: [],
  [RESPONSIBLE_ROLE.DRIVER]: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// A TABELA-VERDADE DO PORTAL — a de cima UNIDA ao que as capacidades implicam
// ─────────────────────────────────────────────────────────────────────────────
//
// A de cima é a régua da ASSINATURA (`sectionsForRoles`) e não muda. Esta é a da
// TELA (`portalSectionsFor`), e as duas divergem em exatamente três papéis —
// justamente os três de recorte estreito, que é onde a divergência era
// necessária. Ver `portal-capabilities.ts` → `SECTION_IMPLIED_BY_CAPABILITY`.
//
// Ordem canônica: VEHICLE, SERVICES, PRICING, DELIVERY, PAYMENT, GUARANTEE, LAYOUT.
const SECOES_PORTAL_ESPERADAS: Record<RESPONSIBLE_ROLE, QuoteSection[]> = {
  // Para quem já recebe o documento inteiro, a união é no-op.
  [RESPONSIBLE_ROLE.COMMERCIAL]: TODAS,
  [RESPONSIBLE_ROLE.SELLER]: TODAS,
  [RESPONSIBLE_ROLE.REPRESENTATIVE]: TODAS,
  [RESPONSIBLE_ROLE.COORDINATOR]: TODAS,
  [RESPONSIBLE_ROLE.PURCHASING]: TODAS,
  // `WRITE_PURCHASE_ORDER` implica só VEHICLE (ver abaixo); o FINANCEIRO
  // recebe PAYMENT pelo PAPEL, não pela capacidade.
  [RESPONSIBLE_ROLE.FINANCIAL]: [
    'VEHICLE',
    'SERVICES',
    'PRICING',
    'DELIVERY',
    'PAYMENT',
    'GUARANTEE',
  ],
  // +DELIVERY, de `TRACK`. Continua SEM `PRICING`, que é a regra que o papel
  // existe para sustentar.
  [RESPONSIBLE_ROLE.MARKETING]: ['VEHICLE', 'DELIVERY', 'LAYOUT'],
  // Era `[]` — o portal em branco. `WRITE_VEHICLE_IDENTITY` implica VEHICLE (ele
  // precisa LER a placa que escreve) e `TRACK` implica DELIVERY.
  [RESPONSIBLE_ROLE.FLEET_MANAGER]: ['VEHICLE', 'DELIVERY'],
  // Só acompanha: vê de que caminhão se fala e em que pé está. Nada de dinheiro,
  // nada de arte.
  [RESPONSIBLE_ROLE.DRIVER]: ['VEHICLE', 'DELIVERY'],
};

console.log('\nTABELA-VERDADE — 9 papéis × 7 seções');
{
  for (const papel of ALL_ROLES) {
    const obtido = sectionsForRoles([papel]);
    const esperado = SECOES_ESPERADAS[papel];
    check(
      `${papel}: ${esperado.length ? esperado.join(' ') : '(nenhuma)'}`,
      JSON.stringify(obtido) === JSON.stringify(esperado),
      `obtido: ${obtido.join(' ') || '(nenhuma)'}`,
    );
  }

  // E a mesma tabela, célula a célula: 63 respostas SIM/NÃO.
  let celulas = 0;
  let certas = 0;
  for (const papel of ALL_ROLES) {
    const obtido = sectionsForRoles([papel]);
    for (const secao of QUOTE_SECTIONS) {
      celulas++;
      if (obtido.includes(secao) === SECOES_ESPERADAS[papel].includes(secao)) certas++;
    }
  }
  check(`as ${celulas} células da tabela conferem`, certas === celulas, `${certas}/${celulas}`);
  check('são mesmo 9 papéis × 7 seções', celulas === 63, `${celulas}`);
}

console.log('\nUNIÃO, NUNCA INTERSEÇÃO');
{
  check(
    'MARKETING + FINANCIAL => as 7 (a união, não o vazio da interseção)',
    JSON.stringify(sectionsForRoles([RESPONSIBLE_ROLE.MARKETING, RESPONSIBLE_ROLE.FINANCIAL])) ===
      JSON.stringify(TODAS),
  );
  check(
    'FLEET_MANAGER + MARKETING => VEHICLE LAYOUT (o vazio não apaga o outro)',
    JSON.stringify(
      sectionsForRoles([RESPONSIBLE_ROLE.FLEET_MANAGER, RESPONSIBLE_ROLE.MARKETING]),
    ) === JSON.stringify(['VEHICLE', 'LAYOUT']),
  );
  check(
    'a ordem é CANÔNICA e independe da ordem dos papéis',
    JSON.stringify(sectionsForRoles([RESPONSIBLE_ROLE.FINANCIAL, RESPONSIBLE_ROLE.MARKETING])) ===
      JSON.stringify(sectionsForRoles([RESPONSIBLE_ROLE.MARKETING, RESPONSIBLE_ROLE.FINANCIAL])),
  );
  check(
    'papel desconhecido é descartado, não explode',
    sectionsForRoles(['NAO_EXISTE']).length === 0,
  );
  check('roles vazio => recorte vazio', sectionsForRoles([]).length === 0);
  check('roles nulo => recorte vazio', sectionsForRoles(null).length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// A TABELA-VERDADE DAS CAPACIDADES — `docs/PORTAL-CONTRATO.md` §2.1
// ─────────────────────────────────────────────────────────────────────────────
const C = PORTAL_CAPABILITY;
/**
 * ⚠️ `WRITE_PURCHASE_ORDER` APARECE EM TODOS OS NOVE — decisão do dono:
 * "vendedor também pode definir o número de pedido, não apenas o compras, todos
 * os papéis — mas se não tiver, pelo menos o compras fica impedido de assinar".
 * O PORTÃO (`purchase-order-gate.ts`) é que guarda a exigência; a escrita
 * deixou de ser gargalo de uma pessoa só.
 */
const TODOS_ESCREVEM_PEDIDO = C.WRITE_PURCHASE_ORDER;

const CAPS_ESPERADAS: Record<RESPONSIBLE_ROLE, PORTAL_CAPABILITY[]> = {
  [RESPONSIBLE_ROLE.COMMERCIAL]: [
    C.REQUEST_BUDGET,
    C.APPROVE_VALUE,
    TODOS_ESCREVEM_PEDIDO,
    C.WRITE_VEHICLE_IDENTITY,
    C.TRACK,
  ],
  [RESPONSIBLE_ROLE.SELLER]: [
    C.REQUEST_BUDGET,
    C.APPROVE_VALUE,
    TODOS_ESCREVEM_PEDIDO,
    C.WRITE_VEHICLE_IDENTITY,
    C.TRACK,
  ],
  [RESPONSIBLE_ROLE.REPRESENTATIVE]: [
    C.REQUEST_BUDGET,
    C.APPROVE_VALUE,
    TODOS_ESCREVEM_PEDIDO,
    C.WRITE_VEHICLE_IDENTITY,
    C.TRACK,
  ],
  [RESPONSIBLE_ROLE.COORDINATOR]: [
    C.REQUEST_BUDGET,
    C.APPROVE_VALUE,
    TODOS_ESCREVEM_PEDIDO,
    C.WRITE_VEHICLE_IDENTITY,
    C.TRACK,
  ],
  [RESPONSIBLE_ROLE.PURCHASING]: [TODOS_ESCREVEM_PEDIDO, C.WRITE_VEHICLE_IDENTITY, C.TRACK],
  [RESPONSIBLE_ROLE.MARKETING]: [C.REQUEST_BUDGET, TODOS_ESCREVEM_PEDIDO, C.TRACK],
  [RESPONSIBLE_ROLE.FINANCIAL]: [TODOS_ESCREVEM_PEDIDO],
  [RESPONSIBLE_ROLE.FLEET_MANAGER]: [
    TODOS_ESCREVEM_PEDIDO,
    C.WRITE_VEHICLE_IDENTITY,
    C.TRACK,
  ],
  [RESPONSIBLE_ROLE.DRIVER]: [TODOS_ESCREVEM_PEDIDO, C.TRACK],
};

console.log('\nTABELA-VERDADE — 9 papéis × 5 capacidades');
{
  let celulas = 0;
  let certas = 0;
  for (const papel of ALL_ROLES) {
    const obtido = capabilitiesForRoles([papel]);
    check(
      `${papel}: ${obtido.join(' ') || '(nenhuma)'}`,
      JSON.stringify(obtido) === JSON.stringify(CAPS_ESPERADAS[papel]),
      `esperado: ${CAPS_ESPERADAS[papel].join(' ') || '(nenhuma)'}`,
    );
    for (const cap of PORTAL_CAPABILITIES) {
      celulas++;
      if (hasCapability([papel], cap) === CAPS_ESPERADAS[papel].includes(cap)) certas++;
    }
  }
  check(`as ${celulas} células conferem`, certas === celulas, `${certas}/${celulas}`);
  check('são mesmo 9 papéis × 5 capacidades', celulas === 45, `${celulas}`);

  // As quatro linhas que valem defesa própria, citadas do contrato.
  check(
    'TODO papel escreve o pedido de compra (decisão do dono)',
    rolesWithAnyCapability([C.WRITE_PURCHASE_ORDER]).length === ALL_ROLES.length,
    rolesWithAnyCapability([C.WRITE_PURCHASE_ORDER]).join(' '),
  );
  check(
    'só os quatro papéis comerciais pré-aprovam',
    JSON.stringify(rolesWithAnyCapability([C.APPROVE_VALUE])) ===
      JSON.stringify([
        RESPONSIBLE_ROLE.COMMERCIAL,
        RESPONSIBLE_ROLE.SELLER,
        RESPONSIBLE_ROLE.REPRESENTATIVE,
        RESPONSIBLE_ROLE.COORDINATOR,
      ]),
  );
  check(
    'GESTOR DE FROTA escreve identidade de veículo (o papel que não fazia nada)',
    hasCapability([RESPONSIBLE_ROLE.FLEET_MANAGER], C.WRITE_VEHICLE_IDENTITY),
  );
  check(
    'FINANCEIRO não acompanha produção — ele acompanha dinheiro (seção PAYMENT)',
    !hasCapability([RESPONSIBLE_ROLE.FINANCIAL], C.TRACK),
  );
  check(
    'MOTORISTA acompanha e informa o pedido — e nada além disso',
    JSON.stringify(capabilitiesForRoles([RESPONSIBLE_ROLE.DRIVER])) ===
      JSON.stringify([C.WRITE_PURCHASE_ORDER, C.TRACK]),
    capabilitiesForRoles([RESPONSIBLE_ROLE.DRIVER]).join(' '),
  );
  check(
    'COMPRAS não pré-aprova nem solicita',
    !hasCapability([RESPONSIBLE_ROLE.PURCHASING], C.APPROVE_VALUE) &&
      !hasCapability([RESPONSIBLE_ROLE.PURCHASING], C.REQUEST_BUDGET),
  );
  check(
    'MARKETING solicita mas não pré-aprova — e não vê preço (PRICING não é dele)',
    hasCapability([RESPONSIBLE_ROLE.MARKETING], C.REQUEST_BUDGET) &&
      !hasCapability([RESPONSIBLE_ROLE.MARKETING], C.APPROVE_VALUE) &&
      !sectionsForRoles([RESPONSIBLE_ROLE.MARKETING]).includes('PRICING'),
  );
}

console.log('\nCapacidade: união, negação por padrão, e o espelho papel↔capacidade');
{
  check(
    'FINANCIAL + DRIVER => WRITE_PURCHASE_ORDER + TRACK (união)',
    JSON.stringify(capabilitiesForRoles([RESPONSIBLE_ROLE.FINANCIAL, RESPONSIBLE_ROLE.DRIVER])) ===
      JSON.stringify([C.WRITE_PURCHASE_ORDER, C.TRACK]),
  );
  check(
    'acumular papéis NUNCA tira poder',
    ALL_ROLES.every(a =>
      ALL_ROLES.every(b =>
        capabilitiesForRoles([a]).every(cap => capabilitiesForRoles([a, b]).includes(cap)),
      ),
    ),
  );
  check('roles vazio => nenhuma capacidade', capabilitiesForRoles([]).length === 0);
  check('roles nulo => nenhuma capacidade', capabilitiesForRoles(null).length === 0);
  check('papel desconhecido => nenhuma capacidade', capabilitiesForRoles(['OWNER']).length === 0);
  check(
    'hasCapability nega por padrão',
    PORTAL_CAPABILITIES.every(cap => !hasCapability([], cap) && !hasCapability(null, cap)),
  );
  check('exigência vazia não é portão fechado', hasAnyCapability([], []) === true);

  // ⛔ A EQUIVALÊNCIA QUE SUSTENTA `@PortalCapability`. O decorador projeta a
  // capacidade para PAPÉIS e deixa a guarda GLOBAL barrar; a guarda de
  // capacidade refaz a pergunta na forma original. Se as duas divergirem, uma
  // rota passa a ser guardada por uma tabela e negada por outra.
  let pares = 0;
  let iguais = 0;
  for (const cap of PORTAL_CAPABILITIES) {
    const projetado = rolesWithAnyCapability([cap]);
    for (const papel of ALL_ROLES) {
      pares++;
      const porPapel = projetado.includes(papel); // o que a guarda GLOBAL decide
      const porCapacidade = hasAnyCapability([papel], [cap]); // o que PortalCapabilityGuard decide
      if (porPapel === porCapacidade) iguais++;
    }
  }
  check(
    `as duas travas concordam nos ${pares} pares (papel × capacidade)`,
    iguais === pares,
    `${iguais}/${pares}`,
  );

  // E na forma composta (`@PortalCapability(A, B)` = "A OU B").
  const duas = [C.APPROVE_VALUE, C.WRITE_PURCHASE_ORDER];
  const projetadoDuas = rolesWithAnyCapability(duas);
  check(
    'duas capacidades => OU, não E',
    ALL_ROLES.every(p => projetadoDuas.includes(p) === hasAnyCapability([p], duas)),
  );
  check(
    'e FINANCEIRO (só pedido de compra) passa nesse portão composto',
    hasAnyCapability([RESPONSIBLE_ROLE.FINANCIAL], duas),
  );
  // ⚠️ O NEGATIVO PRECISOU MUDAR DE PAR. Enquanto só Compras e Financeiro
  // escreviam o pedido, `[APPROVE_VALUE, WRITE_PURCHASE_ORDER]` era um portão que
  // o MOTORISTA não passava. Com a escrita universal ele passa — e passar está
  // CERTO. Um teste negativo que vira trivialmente verdadeiro sem ninguém
  // reparar é pior que teste nenhum, então o par virou um que ainda separa.
  const soComerciais = [C.APPROVE_VALUE, C.REQUEST_BUDGET];
  check(
    'MOTORISTA não pré-aprova nem solicita',
    !hasAnyCapability([RESPONSIBLE_ROLE.DRIVER], soComerciais),
  );
  check(
    'nem o GESTOR DE FROTA, nem o FINANCEIRO',
    !hasAnyCapability([RESPONSIBLE_ROLE.FLEET_MANAGER], soComerciais) &&
      !hasAnyCapability([RESPONSIBLE_ROLE.FINANCIAL], soComerciais),
  );
}

console.log('\nROLE_CAPABILITIES cobre os 9 papéis — papel novo não nasce mudo por acidente');
{
  check(
    'toda chave do enum está na tabela',
    ALL_ROLES.every(p => Array.isArray(ROLE_CAPABILITIES[p])),
    ALL_ROLES.filter(p => !ROLE_CAPABILITIES[p]).join(','),
  );
  check(
    'e a tabela não tem chave a mais',
    Object.keys(ROLE_CAPABILITIES).length === ALL_ROLES.length,
  );
  check(
    'nenhuma capacidade declarada fora do enum',
    Object.values(ROLE_CAPABILITIES).every(caps =>
      caps.every(c => PORTAL_CAPABILITIES.includes(c)),
    ),
  );
  check(
    'toda capacidade do enum é exercida por alguém (nenhuma órfã)',
    PORTAL_CAPABILITIES.every(c => rolesWithAnyCapability([c]).length > 0),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// O PROJETOR
// ─────────────────────────────────────────────────────────────────────────────
const projector = new PortalProjectionService();

/**
 * DE QUEM É a resposta — o terceiro argumento OBRIGATÓRIO de `projectBudget`.
 *
 * Ele existe por um vazamento ESTRUTURAL: `Budget.nfseDocuments` pendura as
 * notas de TODOS os pagadores e a relação não tem dono embutido. Enquanto o
 * recorte morava no `select` de um chamador, o segundo chamador o esqueceria —
 * e esquecer não dá erro, dá a nota fiscal do outro pagador na tela.
 */
const EMPRESA = 'cust-ibipora';
const ESCOPO = { customerId: EMPRESA };

const LINHA_CRUA: any = {
  id: 'budget-1',
  budgetNumber: 812,
  status: 'PENDING',
  statusOrder: 5,
  createdAt: new Date('2026-09-01T12:00:00Z'),
  expiresAt: new Date('2026-10-01T12:00:00Z'),
  updatedAt: new Date('2026-09-10T12:00:00Z'),
  vehicleCount: 2,
  // ⛔ O DINHEIRO ENTRA NAS DUAS FORMAS QUE A VIDA REAL PRODUZ, de propósito:
  // `Prisma.Decimal` (o que o driver devolve, e o que virava `"74100"` no JSON)
  // e string crua (o que chega de `$queryRaw` e de payload remontado). As duas
  // têm de SAIR como `number`.
  subtotal: new Prisma.Decimal('1000.00'),
  total: new Prisma.Decimal('2000.00'),
  guaranteeYears: 5,
  customGuaranteeText: 'Garantia de 5 anos contra corrosão.',
  customForecastDays: 30,
  simultaneousTasks: 2,
  billingSplit: 'JOINT',
  // ⛔ Campos que NUNCA podem sair, plantados na linha crua de propósito: se o
  // projetor espalhasse (`...row`) em vez de copiar campo a campo, eles
  // apareceriam na saída e a varredura abaixo os pegaria.
  commercialUserId: 'user-ankaa-1',
  commercialUser: { id: 'user-ankaa-1', name: 'Vendedor da Ankaa' },
  services: [
    {
      id: 'svc-1',
      description: 'Pintura geral',
      amount: '700.00',
      observation: '(faturamento ibiporã)',
      position: 0,
    },
    {
      id: 'svc-2',
      description: 'Logomarca lateral',
      amount: new Prisma.Decimal('300.00'),
      observation: null,
      position: 1,
    },
  ],
  // A arte do orçamento não mora mais aqui (R1): é a arte APROVADA dos
  // implementos das tarefas (`quoteArtworkOf`), abaixo em `implement.layouts`.
  request: {
    briefing: 'Baú de 14 metros, pintura branca.',
    logoName: 'RKO Alimentos',
    requestedAt: new Date('2026-08-30T12:00:00Z'),
    preApprovedAt: null,
    refusedAt: null,
    decisionNote: null,
  },
  customerConfigs: [
    {
      id: 'payer-1',
      customerId: 'cust-ibipora',
      customer: {
        id: 'cust-ibipora',
        fantasyName: 'Ibiporã Implementos',
        corporateName: 'Ibiporã Ltda',
        cnpj: '11111111000199',
      },
      installments: [
        {
          id: 'inst-1',
          number: 1,
          amount: new Prisma.Decimal('1000.00'),
          // A PARCELA PAGA PELA METADE — o caso que obrigou `paidAmount` a
          // existir ao lado de `paidAt`. Sem ele a tela deriva `paidAt ? amount
          // : null` e os R$ 250,50 já pagos somem.
          paidAmount: new Prisma.Decimal('250.50'),
          dueDate: new Date('2026-10-10T12:00:00Z'),
          paidAt: null,
          status: 'PENDING',
          bankSlip: {
            id: 'slip-1',
            digitableLine: '00190...',
            dueDate: new Date('2026-10-10T12:00:00Z'),
            amount: '1000.00',
            status: 'ACTIVE',
          },
        },
      ],
    },
  ],
  // ⛔ AS TRÊS NOTAS DO CASO FURGÕES, num orçamento de DOIS pagadores.
  //
  // `Budget.nfseDocuments` pendura TODAS as notas do orçamento e a relação NÃO
  // TEM DONO: o dono são dois campos, `customerConfig.customerId` (o pagador) e
  // `invoice.customerId` (a fatura, NOT NULL). Os dois em `OR`, porque
  // `NfseDocument.customerConfigId` é `SetNull` — uma reversão de faturamento
  // apaga o vínculo com o pagador e a nota, viva na prefeitura, ficaria órfã.
  nfseDocuments: [
    {
      // MINHA, pelo pagador.
      id: 'nfse-1',
      nfseNumber: 4421,
      status: 'EMITIDA',
      createdAt: new Date('2026-09-15T12:00:00Z'),
      customerConfig: { customerId: 'cust-ibipora' },
      invoice: { customerId: 'cust-ibipora' },
    },
    {
      // ⛔ DO OUTRO PAGADOR. É esta que vazava.
      id: 'nfse-do-outro',
      nfseNumber: 9999,
      status: 'EMITIDA',
      createdAt: new Date('2026-09-16T12:00:00Z'),
      customerConfig: { customerId: 'cust-rko' },
      invoice: { customerId: 'cust-rko' },
    },
    {
      // MINHA, só pela FATURA — o pagador sumiu numa reversão (`SetNull`).
      id: 'nfse-orfa',
      nfseNumber: 4422,
      status: 'EMITIDA',
      createdAt: new Date('2026-09-17T12:00:00Z'),
      customerConfig: null,
      invoice: { customerId: 'cust-ibipora' },
    },
  ],
  tasks: [
    {
      id: 'task-1',
      name: 'Baú RKO 01',
      status: 'IN_PRODUCTION',
      statusOrder: 3,
      serialNumber: 'ABC-123456',
      customerOrderNumber: '8842',
      purchaseOrder: { id: 'po-1', number: '8842', issuedAt: new Date('2026-09-02T12:00:00Z') },
      entryDate: new Date('2026-09-03T12:00:00Z'),
      startedAt: new Date('2026-09-04T12:00:00Z'),
      finishedAt: null,
      forecastDate: new Date('2026-10-05T12:00:00Z'),
      customerId: 'cust-rko',
      customer: { id: 'cust-rko', fantasyName: 'RKO Alimentos', corporateName: 'RKO SA' },
      // o implemento como o select do portal o devolve
      implement: {
        serialNumber: 'ABC-123456',
        plate: 'ABC1D23',
        chassisNumber: '9BWZZZ377VT004251',
        category: 'TRUCK',
        type: 'BAU',
        spot: 'YARD_WAIT', // ⛔ onde o caminhão está no pátio
        vinPlate: {
          id: 'f-vin',
          filename: 'plaqueta.jpg',
          originalName: 'Plaqueta.jpg',
          mimetype: 'image/jpeg',
          size: 20,
          path: '/srv/uploads/x.jpg',
        },
        leftSideMeasure: {
          height: 2.7,
          sections: [{ width: 7.0, isDoor: false, doorHeight: null, position: 0 }],
        },
        rightSideMeasure: null,
        backSideMeasure: null,
        frontSideMeasure: {
          height: 2.5,
          sections: [{ width: 2.4, isDoor: false, doorHeight: null, position: 0 }],
        },
        rearDoorLeaves: 'BIPARTITE',
        rearDoorBarCount: 3,
        rearDoorHatchCount: 0,
        projectFiles: [
          {
            id: 'f-furgoes',
            filename: 'projeto.pdf',
            originalName: 'PROJETO 38174 ATE 38185.pdf',
            mimetype: 'application/pdf',
            size: 90,
            path: '/srv/uploads/projeto.pdf',
          },
        ],
        // A arte do implemento (R2). O select do portal só traz a APROVADA; a
        // pendente está aqui para provar que o projetor não a deixa passar.
        layouts: [
          {
            id: 'lay-1',
            status: 'APPROVED',
            fileId: 'f-ok',
            file: {
              id: 'f-ok',
              filename: 'aprovado.png',
              originalName: 'Aprovado.png',
              mimetype: 'image/png',
              size: 40,
              path: '/srv/uploads/Clientes/RKO/aprovado.png',
            },
          },
          {
            id: 'lay-2',
            status: 'PENDING_APPROVAL',
            fileId: 'f-rascunho',
            file: {
              id: 'f-rascunho',
              filename: 'rascunho.png',
              originalName: 'Rascunho.png',
              mimetype: 'image/png',
              size: 41,
            },
          },
        ],
      },
      generalPainting: { id: 'p-1', name: 'Branco Geada', hex: '#FFFFFF', finish: 'SOLID' },
      logoPaints: [{ id: 'p-2', name: 'Vermelho RKO', hex: '#CC0000', finish: 'SOLID' }],
      baseFiles: [
        {
          id: 'f-base',
          filename: 'arte.ai',
          originalName: 'Arte.ai',
          mimetype: 'application/postscript',
          size: 30,
          path: '/srv/x',
        },
      ],
      artworks: [],
      serviceOrders: [
        {
          id: 'so-1',
          type: 'PRODUCTION',
          status: 'COMPLETED',
          description: 'Preparação',
          startedAt: new Date('2026-09-04T12:00:00Z'),
          finishedAt: new Date('2026-09-06T12:00:00Z'),
          position: 0,
          totalActiveTimeSeconds: 7200,
          assignedToId: 'user-9',
          assignedTo: { id: 'user-9', name: 'Pintor' },
          pausedAt: new Date('2026-09-05T12:00:00Z'),
        },
        {
          id: 'so-2',
          type: 'PRODUCTION',
          status: 'PAUSED',
          description: 'Pintura',
          startedAt: new Date('2026-09-07T12:00:00Z'),
          finishedAt: null,
          position: 1,
          totalActiveTimeSeconds: 3600,
          pausedAt: new Date('2026-09-08T12:00:00Z'),
        },
        {
          id: 'so-3',
          type: 'COMMERCIAL',
          status: 'IN_PROGRESS',
          description: 'Contraproposta',
          startedAt: null,
          finishedAt: null,
          position: 2,
        },
        {
          id: 'so-4',
          type: 'COMMERCIAL',
          status: 'PENDING',
          description: 'Tratar Reclamação',
          startedAt: null,
          finishedAt: null,
          position: 3,
        },
        {
          id: 'so-5',
          type: 'ARTWORK',
          status: 'PENDING',
          description: 'Arte',
          startedAt: null,
          finishedAt: null,
          position: 4,
        },
      ],
      // ⛔ Plantados: o projetor não pode copiá-los de jeito nenhum.
      details: 'cliente chato, cobrar adiantado',
      term: new Date('2026-09-20T12:00:00Z'),
      bonification: 'FULL',
      bonificationOrder: 1,
      createdById: 'user-ankaa-1',
      observation: { id: 'obs-1', description: 'observação interna' },
      cuts: [{ id: 'cut-1', reason: 'WRONG_APPLY' }],
      airbrushings: [{ id: 'air-1', price: '500.00', painterId: 'user-7' }],
    },
  ],
};

/** Qual grupo do DTO cada seção libera. */
const GRUPO_DA_SECAO: Record<QuoteSection, (v: any) => boolean> = {
  VEHICLE: v => v.vehicles[0]?.identity !== undefined && v.vehicles[0]?.implement !== undefined,
  SERVICES: v => v.services !== undefined,
  PRICING: v => v.pricing !== undefined,
  DELIVERY: v => v.delivery !== undefined && v.vehicles[0]?.progress !== undefined,
  PAYMENT: v => v.payment !== undefined,
  GUARANTEE: v => v.guarantee !== undefined,
  LAYOUT: v => v.layout !== undefined && v.vehicles[0]?.layout !== undefined,
};

console.log('\nO PROJETOR — 9 papéis × 7 grupos do DTO');
{
  let celulas = 0;
  let certas = 0;
  const erradas: string[] = [];
  for (const papel of ALL_ROLES) {
    const view = projector.projectBudget(LINHA_CRUA, [papel], ESCOPO) as any;
    for (const secao of QUOTE_SECTIONS) {
      celulas++;
      const presente = GRUPO_DA_SECAO[secao](view);
      const deveria = SECOES_PORTAL_ESPERADAS[papel].includes(secao);
      if (presente === deveria) certas++;
      else erradas.push(`${papel}/${secao} presente=${presente} deveria=${deveria}`);
    }
  }
  check(`as ${celulas} células do projetor conferem`, certas === celulas, erradas.join(' | '));

  // As duas metades da seção VEHICLE (identidade e implemento, PLANO §7.4) andam
  // JUNTAS: um `implement` sem `identity` seria a seção vazando por um lado só —
  // e o detector acima, com `&&`, o leria como "ausente" e deixaria passar.
  const metades = ALL_ROLES.filter(papel => {
    const v = (projector.projectBudget(LINHA_CRUA, [papel], ESCOPO) as any).vehicles?.[0] ?? {};
    return (v.identity !== undefined) !== (v.implement !== undefined);
  });
  check('identidade e implemento saem juntos ou não saem (os 9 papéis)', metades.length === 0, metades.join(', '));

  // ⚠️ `portalSectionsFor`, NÃO `sectionsForRoles`. A régua da ASSINATURA
  // continua sendo `sectionsForRoles` e é intocada; a da TELA é ela UNIDA às
  // seções que as capacidades implicam. A diferença existe por um motivo só, e
  // ele está fixado logo abaixo, no bloco do gestor de frota.
  check(
    'o projetor usa a régua do PORTAL — sectionsFor === portalSectionsFor',
    ALL_ROLES.every(
      p => JSON.stringify(projector.sectionsFor([p])) === JSON.stringify(portalSectionsFor([p])),
    ),
  );
  // E a régua da assinatura NÃO mudou: quem não assinava continua não assinando.
  check(
    'a régua da ASSINATURA segue intacta — FLEET_MANAGER e DRIVER não assinam',
    sectionsForRoles([RESPONSIBLE_ROLE.FLEET_MANAGER]).length === 0 &&
      sectionsForRoles([RESPONSIBLE_ROLE.DRIVER]).length === 0,
  );
  check(
    'e devolve o recorte junto do dado, para a tela esconder a aba',
    ALL_ROLES.every(p => {
      const v = projector.projectBudget(LINHA_CRUA, [p], ESCOPO) as any;
      return JSON.stringify(v.sections) === JSON.stringify(SECOES_PORTAL_ESPERADAS[p]);
    }),
  );
  check('linha nula => null, sem explodir', projector.projectBudget(null, ['COMMERCIAL'], ESCOPO) === null);
}

console.log('\nO CABEÇALHO nunca é recortado — nem para quem não vê seção nenhuma');
{
  const motorista = projector.projectBudget(LINHA_CRUA, [RESPONSIBLE_ROLE.DRIVER], ESCOPO) as any;
  check('número do orçamento', motorista.budgetNumber === 812);
  check('status', motorista.status === 'PENDING');
  check('datas', motorista.createdAt instanceof Date && motorista.expiresAt instanceof Date);
  check('e a contagem de veículos', motorista.vehicleCount === 2);
  check(
    'mas NÃO o total (isso é PRICING)',
    motorista.pricing === undefined && !('total' in motorista),
  );
  check(
    'nem o vendedor da Ankaa',
    !('commercialUserId' in motorista) && !('commercialUser' in motorista),
  );
  // O motorista ACOMPANHA (capacidade `TRACK`), então o veículo sai com a
  // identidade e o implemento (a seção `VEHICLE`, PLANO §7.4) — para ele saber
  // de que caminhão se fala — e o andamento. Não sai `layout`: arte não é
  // assunto dele, e ela circula antes de estar aprovada.
  check(
    'o veículo sai com identidade, implemento e andamento — e NADA de arte',
    JSON.stringify(Object.keys(motorista.vehicles[0]).sort()) ===
      JSON.stringify(['forecastDate', 'id', 'identity', 'implement', 'name', 'progress', 'status']),
    Object.keys(motorista.vehicles[0]).join(','),
  );
  check(
    'e nenhum grupo de dinheiro chega até ele',
    motorista.pricing === undefined && motorista.payment === undefined,
  );
}

console.log('\nO BLOCO `implement` (PLANO §7.4) — as 4 faces, a porta e o projeto');
{
  const v = (projector.projectBudget(LINHA_CRUA, [RESPONSIBLE_ROLE.COMMERCIAL], ESCOPO) as any).vehicles[0];
  check(
    'as quatro faces por nome, em metros (chave `back`, nunca `rear`)',
    JSON.stringify(Object.keys(v.implement?.measures ?? {})) === JSON.stringify(['left', 'right', 'back', 'front']) &&
      v.implement.measures.front?.height === 2.5 &&
      v.implement.measures.left?.height === 2.7 &&
      v.implement.measures.back === null,
    JSON.stringify(v.implement?.measures),
  );
  check(
    'a porta traseira, com 0 portinhola como dado (não como "nada")',
    JSON.stringify(v.implement?.rearDoor) === JSON.stringify({ leaves: 'BIPARTITE', barCount: 3, hatchCount: 0 }),
    JSON.stringify(v.implement?.rearDoor),
  );
  check(
    'o projeto do implemento sai sem o caminho do disco',
    v.implement?.projectFiles?.length === 1 && !('path' in v.implement.projectFiles[0]),
    JSON.stringify(v.implement?.projectFiles),
  );
  check(
    'tipo e categoria saíram da identidade (estão no implemento)',
    v.implement?.type === 'BAU' && v.implement?.category === 'TRUCK' && !('category' in v.identity) && !('measures' in v.identity),
    JSON.stringify(Object.keys(v.identity ?? {})),
  );
}

console.log('\nMARKETING — vê a arte e a placa, e NÃO vê o preço');
{
  const v = projector.projectBudget(LINHA_CRUA, [RESPONSIBLE_ROLE.MARKETING], ESCOPO) as any;
  check('tem layout do orçamento', v.layout?.files?.length === 1);
  check(
    'tem a identidade do veículo (VEHICLE é injetada em todo recorte não-vazio)',
    v.vehicles[0].identity?.plate === 'ABC1D23',
  );
  check('tem as cores de pintura', v.vehicles[0].layout?.generalPainting?.hex === '#FFFFFF');
  check('⛔ NÃO tem pricing', v.pricing === undefined);
  check('⛔ NÃO tem a lista de serviços', v.services === undefined);
  check('⛔ NÃO tem pagamento', v.payment === undefined);
  // ⚠️ Pelo VALOR, e nas DUAS formas. A verificação antiga era
  // `!JSON.stringify(v).includes('2000.00')` e virou tautologia no dia em que o
  // dinheiro passou a sair como número: `2000` não contém `'2000.00'`, e o
  // vazamento passaria verde.
  const folhas = allValues(v);
  check(
    '⛔ e o total não sai, nem como número nem como string',
    !folhas.some(x => x === 2000 || x === '2000.00'),
  );
  check(
    '⛔ nem o valor de nenhum serviço',
    !folhas.some(x => x === 700 || x === '700.00' || x === 300 || x === '300.00'),
  );
}

console.log('\nFINANCEIRO — vê tudo menos a arte');
{
  const v = projector.projectBudget(LINHA_CRUA, [RESPONSIBLE_ROLE.FINANCIAL], ESCOPO) as any;
  check(
    'tem pricing com subtotal e total — como NÚMERO',
    v.pricing?.total === 2000 && v.pricing?.subtotal === 1000,
    `total=${JSON.stringify(v.pricing?.total)} subtotal=${JSON.stringify(v.pricing?.subtotal)}`,
  );
  // ⛔ O DEFEITO QUE ESTAS LINHAS CODIFICAVAM. Até 20/09 elas AFIRMAVAM a string
  // (`=== '2000.00'`) e passavam verdes enquanto o portal publicava
  // `pricing: { total: "74100" }`. O web declara `number | null` e guarda com
  // `typeof === "number"`: os 118 orçamentos da lista mostravam travessão, e o
  // vendedor era convidado a pré-aprovar SEM VER O PREÇO.
  check(
    'e o tipo é mesmo `number` nos dois',
    typeof v.pricing?.total === 'number' && typeof v.pricing?.subtotal === 'number',
    `${typeof v.pricing?.total}/${typeof v.pricing?.subtotal}`,
  );
  {
    const parcela = v.payment?.payers?.[0]?.installments?.[0];
    check(
      'a parcela, o já pago e o boleto também são números',
      parcela?.amount === 1000 &&
        parcela?.paidAmount === 250.5 &&
        parcela?.bankSlip?.amount === 1000,
      `amount=${JSON.stringify(parcela?.amount)} paidAmount=${JSON.stringify(parcela?.paidAmount)} slip=${JSON.stringify(parcela?.bankSlip?.amount)}`,
    );
  }
  check(
    'tem parcelas e boleto',
    v.payment?.payers?.[0]?.installments?.[0]?.bankSlip?.digitableLine === '00190...',
  );
  check('tem NFS-e', v.payment?.nfse?.[0]?.nfseNumber === 4421);
  check(
    '⛔ e SÓ as DELE: a nota do outro pagador não sai',
    !v.payment.nfse.some((n: any) => n.id === 'nfse-do-outro'),
    v.payment.nfse.map((n: any) => n.id).join(','),
  );
  check('tem garantia', v.guarantee?.years === 5);
  check('⛔ NÃO tem layout no orçamento', v.layout === undefined);
  check('⛔ NÃO tem layout no veículo', v.vehicles[0].layout === undefined);
  check('⛔ e o arquivo de arte não aparece em lugar nenhum', !JSON.stringify(v).includes('f-ok'));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n⛔ AS NFS-e SÃO RECORTADAS DENTRO DO PROJETOR, não no `select` de quem chama');
// ─────────────────────────────────────────────────────────────────────────────
{
  const ibipora = projector.projectBudget(LINHA_CRUA, [RESPONSIBLE_ROLE.FINANCIAL], {
    customerId: 'cust-ibipora',
  }) as any;
  const rko = projector.projectBudget(LINHA_CRUA, [RESPONSIBLE_ROLE.FINANCIAL], {
    customerId: 'cust-rko',
  }) as any;

  const ids = (v: any) => (v.payment?.nfse ?? []).map((n: any) => n.id).sort().join(',');

  check(
    'a Ibiporã recebe a dela — a do pagador E a órfã, que só a FATURA ancora',
    ids(ibipora) === 'nfse-1,nfse-orfa',
    ids(ibipora),
  );
  check(
    '⛔ e NÃO recebe a da RKO',
    !ids(ibipora).includes('nfse-do-outro'),
    ids(ibipora),
  );
  check(
    'a RKO recebe só a dela — o MESMO objeto cru, recorte oposto',
    ids(rko) === 'nfse-do-outro',
    ids(rko),
  );

  // ⛔ A METADE QUE `customerConfigId` SOZINHO PERDERIA. `SetNull`: reverter o
  // faturamento apaga o vínculo com o pagador, e a nota — que continua viva na
  // prefeitura — sumiria da tela de quem a pagou.
  check(
    'a nota órfã de pagador sobrevive pela `invoice.customerId` (NOT NULL)',
    (ibipora.payment.nfse as any[]).some(n => n.id === 'nfse-orfa'),
  );

  // ⛔ FALHA FECHADO. Chamador sem escopo, ou nota cujo `select` não trouxe o
  // dono, não recebe NENHUMA nota — nunca TODAS. Uma nota a menos é um chamado;
  // uma nota a mais é o documento fiscal de outra empresa na mão de um terceiro.
  const semEscopo = projector.projectBudget(
    LINHA_CRUA,
    [RESPONSIBLE_ROLE.FINANCIAL],
    undefined as any,
  ) as any;
  check('sem escopo => nenhuma nota, jamais todas', (semEscopo.payment?.nfse ?? []).length === 0);

  const semDono = projector.projectBudget(
    {
      ...LINHA_CRUA,
      nfseDocuments: [{ id: 'nfse-sem-dono', nfseNumber: 1, status: 'EMITIDA', createdAt: null }],
    },
    [RESPONSIBLE_ROLE.FINANCIAL],
    ESCOPO,
  ) as any;
  check(
    'nota sem `customerConfig` nem `invoice` no select => cortada',
    (semDono.payment?.nfse ?? []).length === 0,
  );

  // E o DONO é usado para DECIDIR, nunca copiado para a saída.
  check(
    '⛔ o dono da nota não aparece na resposta',
    !('customerConfig' in (ibipora.payment.nfse[0] ?? {})) &&
      !('invoice' in (ibipora.payment.nfse[0] ?? {})),
    Object.keys(ibipora.payment.nfse[0] ?? {}).join(','),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nAS ETIQUETAS DE VEÍCULO na LISTA — para o web parar de buscar 300 veículos');
// ─────────────────────────────────────────────────────────────────────────────
{
  const comercial = projector.projectBudget(LINHA_CRUA, [RESPONSIBLE_ROLE.COMMERCIAL], ESCOPO) as any;
  check('existem', Array.isArray(comercial.vehicleChips));
  check('uma por veículo', comercial.vehicleChips.length === LINHA_CRUA.tasks.length);
  check(
    'e são exatamente `taskId`, `serialNumber` e `plate`',
    JSON.stringify(Object.keys(comercial.vehicleChips[0]).sort()) ===
      JSON.stringify(['plate', 'serialNumber', 'taskId']),
    Object.keys(comercial.vehicleChips[0]).join(','),
  );
  check(
    'com os valores que o cliente procura no telefone',
    comercial.vehicleChips[0].serialNumber === 'ABC-123456' &&
      comercial.vehicleChips[0].plate === 'ABC1D23' &&
      comercial.vehicleChips[0].taskId === 'task-1',
  );

  // ⛔ MESMA RÉGUA DO RESTO. Etiqueta é identidade do veículo — sem `VEHICLE`,
  // nem `identity` nem etiqueta. Um atalho de lista que ignorasse a seção
  // entregaria placa e chassi por uma porta que o projetor fechou na outra.
  for (const papel of ALL_ROLES) {
    const v = projector.projectBudget(LINHA_CRUA, [papel], ESCOPO) as any;
    const temSecao = SECOES_PORTAL_ESPERADAS[papel].includes('VEHICLE');
    if (temSecao !== (v.vehicleChips !== undefined)) {
      check(`${papel}: etiqueta segue a seção VEHICLE`, false);
      break;
    }
  }
  check('toda etiqueta segue a seção VEHICLE', true);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nA PREVISÃO no topo do veículo — e o prazo INTERNO em lugar nenhum');
// ─────────────────────────────────────────────────────────────────────────────
{
  const comercial = projector.projectBudget(LINHA_CRUA, [RESPONSIBLE_ROLE.COMMERCIAL], ESCOPO) as any;
  const veiculo = comercial.vehicles[0];
  check('`forecastDate` sai no TOPO do veículo (a coluna da lista da frota)', veiculo.forecastDate instanceof Date);
  check(
    'e é a MESMA data de `progress.forecastDate` — uma verdade, dois lugares',
    +veiculo.forecastDate === +veiculo.progress.forecastDate,
  );
  check(
    '⛔ e NUNCA `Task.term`, que é o compromisso interno',
    !JSON.stringify(comercial).includes('term"') && !('term' in veiculo),
  );

  // Sem `DELIVERY` não há previsão — o mesmo portão de `progress`.
  const financeiroVeDelivery = SECOES_PORTAL_ESPERADAS[RESPONSIBLE_ROLE.FINANCIAL].includes('DELIVERY');
  check('o portão é o de DELIVERY, e não um atalho', financeiroVeDelivery);
  const semDelivery = ALL_ROLES.filter(p => !SECOES_PORTAL_ESPERADAS[p].includes('DELIVERY'));
  check(
    'quem não tem DELIVERY não recebe previsão nenhuma',
    semDelivery.every(p => {
      const v = projector.projectBudget(LINHA_CRUA, [p], ESCOPO) as any;
      return v.vehicles.every((x: any) => x.forecastDate === undefined);
    }),
    semDelivery.join(','),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nO MOTIVO DA DECISÃO volta — senão ninguém lê por que o colega recusou');
// ─────────────────────────────────────────────────────────────────────────────
{
  const comRecusa = {
    ...LINHA_CRUA,
    request: {
      ...LINHA_CRUA.request,
      refusedAt: new Date('2026-09-12T12:00:00Z'),
      decisionNote: 'A altura do baú está errada: são 2,70 m e não 2,40 m.',
    },
  };
  for (const papel of ALL_ROLES) {
    const v = projector.projectBudget(comRecusa, [papel], ESCOPO) as any;
    if (v.request?.decisionNote !== 'A altura do baú está errada: são 2,70 m e não 2,40 m.') {
      check(`${papel} lê o motivo da recusa`, false, JSON.stringify(v.request));
      break;
    }
  }
  check('todo papel lê o motivo da decisão (foi o cliente quem escreveu)', true);
  check(
    'e a data da recusa vem junto, senão a nota fica sem contexto',
    (projector.projectBudget(comRecusa, [RESPONSIBLE_ROLE.COMMERCIAL], ESCOPO) as any).request
      .refusedAt instanceof Date,
  );
}

console.log('\nSERVIÇOS ≠ PREÇOS — a lista sai sem valor');
{
  const v = projector.projectBudget(LINHA_CRUA, [RESPONSIBLE_ROLE.COMMERCIAL], ESCOPO) as any;
  check(
    'SERVICES tem descrição e observação',
    v.services[0].description === 'Pintura geral' &&
      v.services[0].observation === '(faturamento ibiporã)',
  );
  check(
    '⛔ e NÃO tem `amount` — senão SERVICES apagaria PRICING na prática',
    !('amount' in v.services[0]),
    Object.keys(v.services[0]).join(','),
  );
  check(
    'PRICING é quem carrega o valor por item — e em NÚMERO',
    v.pricing.items[0].amount === 700 && v.pricing.items[1].amount === 300,
    `${JSON.stringify(v.pricing.items[0].amount)}/${JSON.stringify(v.pricing.items[1].amount)}`,
  );
}

console.log('\nAS ORDENS DE SERVIÇO — nenhuma COMERCIAL vai para o cliente');
{
  const v = projector.projectBudget(LINHA_CRUA, [RESPONSIBLE_ROLE.COMMERCIAL], ESCOPO) as any;
  const etapas = v.vehicles[0].progress.steps;
  check('só as de PRODUÇÃO saem', etapas.length === 2, `${etapas.length}`);
  check('⛔ "Contraproposta" não sai', !JSON.stringify(v).includes('Contraproposta'));
  check('⛔ "Tratar Reclamação" não sai', !JSON.stringify(v).includes('Tratar Reclamação'));
  check(
    '⛔ nem a de ARTWORK (lista positiva: tipo novo não nasce visível)',
    !etapas.some((e: any) => e.id === 'so-5'),
  );
  check('saem na ordem de `position`', etapas[0].id === 'so-1' && etapas[1].id === 'so-2');
  check(
    'PAUSED é reescrito para IN_PROGRESS (pausa é almoço, não problema)',
    etapas[1].status === 'IN_PROGRESS',
    etapas[1].status,
  );
  check(
    'a etapa tem 5 campos e nenhum a mais',
    JSON.stringify(Object.keys(etapas[0]).sort()) ===
      JSON.stringify(['description', 'finishedAt', 'id', 'startedAt', 'status']),
    Object.keys(etapas[0]).join(','),
  );
  check('previsão sai; prazo interno não', v.vehicles[0].progress.forecastDate instanceof Date);
}

console.log('\nLAYOUT — só o aprovado vira arte');
{
  const v = projector.projectBudget(LINHA_CRUA, [RESPONSIBLE_ROLE.COMMERCIAL], ESCOPO) as any;
  const artes = v.vehicles[0].layout.artworks;
  check('o layout APPROVED sai', artes.length === 1 && artes[0].id === 'f-ok');
  check('⛔ o layout PENDING não sai', !JSON.stringify(v).includes('f-rascunho'));
  check(
    '⛔ e nenhum arquivo leva `path` (a árvore do disco é literal)',
    !JSON.stringify(v).includes('/srv/'),
  );
}

console.log('\n⛔ A VARREDURA — nenhum campo interno sai, para NENHUM dos 9 papéis');
{
  let vazamentos: string[] = [];
  for (const papel of ALL_ROLES) {
    const v = projector.projectBudget(LINHA_CRUA, [papel], ESCOPO);
    const chaves = allKeys(v);
    for (const proibida of PORTAL_NEVER_EXPOSED) {
      if (chaves.has(proibida)) vazamentos.push(`${papel}.${proibida}`);
    }
  }
  check(
    `nenhuma das ${PORTAL_NEVER_EXPOSED.length} chaves proibidas aparece`,
    vazamentos.length === 0,
    vazamentos.join(', '),
  );

  // A subárvore do VEÍCULO tem uma lista mais larga: lá `observation` é texto
  // interno da tarefa, enquanto no orçamento é a observação do SERVIÇO, que o
  // contrato manda mostrar.
  vazamentos = [];
  for (const papel of ALL_ROLES) {
    const v = projector.projectBudget(LINHA_CRUA, [papel], ESCOPO) as any;
    const chaves = allKeys(v.vehicles);
    for (const proibida of PORTAL_NEVER_EXPOSED_ON_VEHICLE) {
      if (chaves.has(proibida)) vazamentos.push(`${papel}.vehicles.${proibida}`);
    }
  }
  check('nem na subárvore do veículo', vazamentos.length === 0, vazamentos.join(', '));

  // E os VALORES, não só os nomes: um campo renomeado continuaria vazando.
  const valoresProibidos: Array<[string, string]> = [
    ['o texto interno da tarefa', 'cliente chato'],
    ['a observação interna', 'observação interna'],
    ['a bonificação', 'FULL'],
    ['o pátio', 'YARD_WAIT'],
    ['o preço da aerografia', '500.00'],
    ['o pintor', 'user-7'],
    ['o motivo do corte', 'WRONG_APPLY'],
    ['o funcionário designado', 'user-9'],
    ['o vendedor da Ankaa', 'Vendedor da Ankaa'],
  ];
  const achados: string[] = [];
  for (const papel of ALL_ROLES) {
    const json = JSON.stringify(projector.projectBudget(LINHA_CRUA, [papel], ESCOPO));
    for (const [nome, agulha] of valoresProibidos) {
      if (json.includes(agulha)) achados.push(`${papel}: ${nome}`);
    }
  }
  check('nem o VALOR de nenhum deles', achados.length === 0, achados.join(', '));

  check(
    'tempo ativo (segundos trabalhados) não sai',
    !ALL_ROLES.some(p => JSON.stringify(projector.projectBudget(LINHA_CRUA, [p], ESCOPO)).includes('7200')),
  );
}

console.log('\nprojectTask — o mesmo recorte, quando o veículo vem sozinho');
{
  const cru = LINHA_CRUA.tasks[0];
  const comercial = projector.projectTask(cru, [RESPONSIBLE_ROLE.COMMERCIAL]) as any;
  const motorista = projector.projectTask(cru, [RESPONSIBLE_ROLE.DRIVER]) as any;
  check(
    'COMERCIAL vê identidade, layout e andamento',
    !!comercial.identity && !!comercial.layout && !!comercial.progress,
  );
  // Antes do conserto de 20/09 o motorista não via NENHUM dos três — e era um
  // portal em branco para quem o desenho deu acompanhamento a fazer.
  check(
    'MOTORISTA vê identidade e andamento, e NÃO vê a arte',
    !!motorista.identity && !!motorista.progress && !motorista.layout,
  );
  check(
    'e o resultado é idêntico ao do veículo dentro do orçamento',
    JSON.stringify(comercial) ===
      JSON.stringify(
        (projector.projectBudget(LINHA_CRUA, [RESPONSIBLE_ROLE.COMMERCIAL], ESCOPO) as any).vehicles[0],
      ),
  );
  check('linha nula => null', projector.projectTask(null, ['COMMERCIAL']) === null);
}

console.log('\nA REQUISIÇÃO volta inteira — é o texto que o próprio cliente escreveu');
{
  for (const papel of ALL_ROLES) {
    const v = projector.projectBudget(LINHA_CRUA, [papel], ESCOPO) as any;
    if (v.request?.briefing !== 'Baú de 14 metros, pintura branca.') {
      check(`${papel} recebe o próprio briefing de volta`, false);
      break;
    }
  }
  check('todo papel recebe o próprio briefing de volta', true);
  const semRequisicao = projector.projectBudget({ ...LINHA_CRUA, request: null }, [
    'COMMERCIAL',
  ], ESCOPO) as any;
  check('orçamento nascido por dentro não tem o grupo', semRequisicao.request === undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n💰 O DINHEIRO SAI COMO NÚMERO — varredura do payload inteiro');
// ─────────────────────────────────────────────────────────────────────────────
{
  /**
   * As chaves que CARREGAM DINHEIRO no payload do portal. Nenhuma delas pode
   * sair como string — o web as declara `number | null` e guarda o valor com
   * `typeof === "number"`, então string não vira travessão por engano: vira
   * travessão SEMPRE, calada, sem erro em lugar nenhum.
   */
  const CHAVES_DE_DINHEIRO = new Set([
    'subtotal',
    'total',
    'amount',
    'paidAmount',
    'totalAmount',
    'discountValue',
    'price',
    'unitPrice',
  ]);

  /**
   * A VARREDURA. Devolve o CAMINHO de cada suspeito, porque "tem string em campo
   * de dinheiro" sem o caminho não conserta nada.
   *
   * Três coisas a acusar, e as três já aconteceram nesta casa:
   *  · `Prisma.Decimal` CRU — o defeito original, `{ "total": "74100" }`;
   *  · string numa chave de dinheiro conhecida — o caminho do `$queryRaw`;
   *  · string com CARA de dinheiro (`/^-?\d+\.\d{2}$/`) em qualquer chave — a
   *    rede para o campo de dinheiro que nasceu com nome novo.
   */
  function varrerDinheiro(node: unknown, caminho: string, achados: string[]): string[] {
    if (node === null || node === undefined) return achados;
    if (Array.isArray(node)) {
      node.forEach((v, i) => varrerDinheiro(v, `${caminho}[${i}]`, achados));
      return achados;
    }
    if (node instanceof Date) return achados;
    if (typeof node === 'object') {
      const candidato = node as { toNumber?: unknown; toFixed?: unknown };
      if (typeof candidato.toNumber === 'function' && typeof candidato.toFixed === 'function') {
        achados.push(`${caminho} = Decimal CRU (${String(node)})`);
        return achados;
      }
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        varrerDinheiro(v, caminho ? `${caminho}.${k}` : k, achados);
      }
      return achados;
    }
    if (typeof node === 'string') {
      const chave = (caminho.split('.').pop() ?? '').replace(/\[\d+\]$/, '');
      if (CHAVES_DE_DINHEIRO.has(chave)) {
        achados.push(`${caminho} = ${JSON.stringify(node)} (string em campo de dinheiro)`);
      } else if (/^-?\d+\.\d{2}$/.test(node)) {
        achados.push(`${caminho} = ${JSON.stringify(node)} (tem cara de dinheiro)`);
      }
    }
    return achados;
  }

  // ⛔ A VARREDURA TEM DENTES? Antes de afirmar que o payload está limpo, provamos
  // que o detector acusa o defeito real. Sem isto, uma varredura escrita errado
  // passaria verde para sempre e ninguém saberia.
  const iscas = varrerDinheiro(
    {
      pricing: { total: new Prisma.Decimal('74100'), subtotal: '74100.00' },
      payment: { payers: [{ installments: [{ amount: '1200.00' }] }] },
    },
    'isca',
    [],
  );
  check(
    'a varredura ACUSA Decimal cru, string em campo de dinheiro e string com cara de dinheiro',
    iscas.length === 3,
    iscas.join(' | '),
  );

  // E agora o payload de verdade, nos 9 papéis — inclusive os que não veem
  // dinheiro nenhum, porque um vazamento por ali é pior que a string.
  const sujeira: string[] = [];
  for (const papel of ALL_ROLES) {
    varrerDinheiro(projector.projectBudget(LINHA_CRUA, [papel], ESCOPO), papel, sujeira);
  }
  check(
    `nenhum campo de dinheiro sai como string em nenhum dos ${ALL_ROLES.length} papéis`,
    sujeira.length === 0,
    sujeira.join(' | '),
  );

  // E o contrário: o dinheiro do papel que O VÊ chegou mesmo, com o valor certo.
  // Uma varredura satisfeita por um payload VAZIO não prova coisa alguma.
  const fin = projector.projectBudget(LINHA_CRUA, [RESPONSIBLE_ROLE.FINANCIAL], ESCOPO) as any;
  const dinheiro = [
    ['pricing.subtotal', fin.pricing?.subtotal, 1000],
    ['pricing.total', fin.pricing?.total, 2000],
    ['pricing.items[0].amount', fin.pricing?.items?.[0]?.amount, 700],
    ['pricing.items[1].amount', fin.pricing?.items?.[1]?.amount, 300],
    ['installments[0].amount', fin.payment?.payers?.[0]?.installments?.[0]?.amount, 1000],
    ['installments[0].paidAmount', fin.payment?.payers?.[0]?.installments?.[0]?.paidAmount, 250.5],
    ['bankSlip.amount', fin.payment?.payers?.[0]?.installments?.[0]?.bankSlip?.amount, 1000],
  ] as const;
  const errados = dinheiro.filter(([, atual, esperado]) => atual !== esperado);
  check(
    `os ${dinheiro.length} campos de dinheiro do FINANCEIRO chegaram com o valor certo`,
    errados.length === 0,
    errados.map(([nome, atual]) => `${nome}=${JSON.stringify(atual)}`).join(', '),
  );

  // `null`/`undefined` viram `null`, e NÃO `0`. Um orçamento sem preço lançado
  // mostraria "R$ 0,00" — que é um preço, e é o preço errado.
  const semPreco = projector.projectBudget(
    {
      ...LINHA_CRUA,
      subtotal: null,
      total: undefined,
      services: [{ id: 'svc-x', description: 'Sem valor', amount: null, position: 0 }],
      customerConfigs: [
        {
          ...LINHA_CRUA.customerConfigs[0],
          installments: [
            { id: 'i-x', number: 1, amount: null, paidAmount: undefined, bankSlip: null },
          ],
        },
      ],
    },
    [RESPONSIBLE_ROLE.FINANCIAL],
    ESCOPO,
  ) as any;
  check(
    'ausência vira `null`, nunca `0`',
    semPreco.pricing.subtotal === null &&
      semPreco.pricing.total === null &&
      semPreco.pricing.items[0].amount === null &&
      semPreco.payment.payers[0].installments[0].amount === null &&
      semPreco.payment.payers[0].installments[0].paidAmount === null,
    JSON.stringify(semPreco.pricing),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n⛔ A CONTRADIÇÃO DO CONTRATO — registrada, não escondida');
// ─────────────────────────────────────────────────────────────────────────────
{
  // ── O CONSERTO DO GESTOR DE FROTA E DO MOTORISTA (20/09/2026) ─────────────
  //
  // `sectionsForRoles` devolve `[]` para os dois, e isso está CERTO para a
  // assinatura: vazio significa "este contato NÃO ASSINA", que é o padrão deles.
  // Assinar por padrão seria colher a assinatura de quem provavelmente não tem
  // poderes para obrigar a empresa — a disputa que a declaração de representação
  // existe para enfrentar.
  //
  // Aplicada à TELA, porém, a mesma régua dava um portal EM BRANCO justamente a
  // quem o desenho deu trabalho a fazer: o gestor escreve placa e chassi, e os
  // dois acompanham o serviço. O `PATCH` funcionava e o `GET` vinha vazio.
  //
  // O conserto NÃO foi mexer em `ROLE_DEFAULT_SECTIONS` — isso tornaria o gestor
  // signatário de todo orçamento, porque `createEnvelope` decide quem assina por
  // `sections.length > 0`. Foi DERIVAR: a tela mostra o que você assinaria MAIS
  // o que suas capacidades implicam (`SECTION_IMPLIED_BY_CAPABILITY`).
  check(
    'FLEET_MANAGER escreve a placa…',
    hasCapability([RESPONSIBLE_ROLE.FLEET_MANAGER], C.WRITE_VEHICLE_IDENTITY),
  );
  check(
    '…e AGORA tem a seção VEHICLE para ler o que escreve',
    portalSectionsFor([RESPONSIBLE_ROLE.FLEET_MANAGER]).includes('VEHICLE'),
  );
  check(
    'DRIVER acompanha, e tem DELIVERY para isso',
    hasCapability([RESPONSIBLE_ROLE.DRIVER], C.TRACK) &&
      portalSectionsFor([RESPONSIBLE_ROLE.DRIVER]).includes('DELIVERY'),
  );
  check(
    'e NENHUM dos dois ganhou dinheiro na tela',
    !portalSectionsFor([RESPONSIBLE_ROLE.FLEET_MANAGER]).includes('PRICING') &&
      !portalSectionsFor([RESPONSIBLE_ROLE.DRIVER]).includes('PRICING') &&
      !portalSectionsFor([RESPONSIBLE_ROLE.DRIVER]).includes('PAYMENT'),
  );

  // ⛔ A GUARDA QUE A DECISÃO DE HOJE TORNOU CRÍTICA.
  //
  // `WRITE_PURCHASE_ORDER` passou a valer para os NOVE papéis (o dono pediu).
  // Enquanto a implicação dela fosse `['VEHICLE', 'PAYMENT']`, essa decisão
  // sobre QUEM DIGITA UM NÚMERO teria entregue, em silêncio, parcelas, boletos
  // e notas fiscais ao MARKETING — que por desenho "vê a arte e não vê o
  // preço" — e ao MOTORISTA. Uma escalada de privilégio sobre documento
  // financeiro, nascida de um pedido de ergonomia.
  //
  // A implicação encolheu para `['VEHICLE']` (é lá que o número mora), e estas
  // três linhas são o que impede alguém de reexpandi-la sem perceber o preço.
  for (const papel of [
    RESPONSIBLE_ROLE.MARKETING,
    RESPONSIBLE_ROLE.DRIVER,
    RESPONSIBLE_ROLE.FLEET_MANAGER,
  ]) {
    check(
      `⛔ ${papel} escreve o pedido e MESMO ASSIM não vê PAYMENT`,
      hasCapability([papel], C.WRITE_PURCHASE_ORDER) &&
        !portalSectionsFor([papel]).includes('PAYMENT'),
      portalSectionsFor([papel]).join(' '),
    );
  }
  // MARKETING pede orçamento e acompanha, então ganhou VEHICLE e DELIVERY — e
  // continua sem ver preço, que é a regra que o papel existe para sustentar.
  check(
    'MARKETING ganhou VEHICLE e DELIVERY, e segue sem PRICING',
    portalSectionsFor([RESPONSIBLE_ROLE.MARKETING]).includes('DELIVERY') &&
      !portalSectionsFor([RESPONSIBLE_ROLE.MARKETING]).includes('PRICING'),
  );
}

console.log(
  `\n${failures === 0 ? '✓ TODAS as verificações passaram' : `✗ ${failures} falha(s)`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
