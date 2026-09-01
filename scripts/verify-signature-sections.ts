/**
 * Verificação do RECORTE do orçamento assinado.
 *
 * Usage: npx tsx scripts/verify-signature-sections.ts
 * Sai 0 se tudo confere, 1 na primeira divergência.
 *
 * POR QUE ISTO EXISTE
 *   Um erro aqui não aparece como falha. Um vazamento de preço para o contato de
 *   marketing sai como um PDF bonito, correto e assinado — e só é notado quando o
 *   cliente comenta o valor com quem não deveria sabê-lo. As três garantias
 *   abaixo, portanto, são fixadas por execução e não por leitura de código:
 *
 *     1. a CHAVE do recorte completo, que a migração 20260901123000 grava como
 *        literal — divergir dela faria a próxima emissão criar um segundo
 *        recorte completo e derrubar o índice parcial `one_full_per_envelope`;
 *     2. o PADRÃO de cada função, que decide quem recebe o quê quando o operador
 *        não mexe em nada na tela de envio;
 *     3. o TEMPLATE: cada seção some do HTML quando o recorte não a inclui, e
 *        nenhum valor em dinheiro sobrevive num recorte sem preço;
 *     4. a TOLERÂNCIA a quem não assina: cadastrar o motorista da entrega não
 *        pode anular a assinatura que o comercial do cliente já deu.
 *
 * Sem DI e sem banco: tudo aqui é função pura. `QuoteSnapshotService` recebe
 * `null` no lugar do Prisma porque nenhum dos métodos exercitados o toca.
 */

import { buildQuoteHtml, type QuoteHtmlInput } from '../src/modules/common/signature/document/quote-html.builder';
import {
  QUOTE_SECTIONS,
  FULL_SECTIONS,
  ROLE_DEFAULT_SECTIONS,
  canonicalSections,
  describeSections,
  isFullSections,
  sectionsForRoles,
  variantFilenameSuffix,
  variantKeyOf,
  type QuoteSection,
} from '../src/modules/common/signature/quote-sections';
import { RESPONSIBLE_ROLE } from '../src/constants/enums';
import {
  QuoteSnapshotService,
  type QuoteSnapshot,
} from '../src/modules/common/signature/services/quote-snapshot.service';

const failures: string[] = [];
let checks = 0;

function check(label: string, condition: boolean): void {
  checks++;
  if (!condition) failures.push(label);
}

function equal(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n      esperado ${e}\n      obtido   ${a}`);
}

// ===========================================================================
// 1. Chave do recorte
// ===========================================================================

// Se esta linha mudar, a migração `20260901123000_signature_document_variants`
// tem de mudar junto — senão os envelopes migrados ficam com uma chave que o
// código nunca reproduz.
equal(
  'a chave do recorte completo reproduz o literal da migração de backfill',
  variantKeyOf([...FULL_SECTIONS]),
  'VEHICLE+SERVICES+PRICING+DELIVERY+PAYMENT+GUARANTEE+LAYOUT',
);
equal(
  'a chave não depende da ordem em que as seções foram marcadas na tela',
  variantKeyOf(canonicalSections(['LAYOUT', 'VEHICLE'])),
  variantKeyOf(canonicalSections(['VEHICLE', 'LAYOUT'])),
);
// A chave entra num índice único e num nome de arquivo; string vazia some nos dois.
equal('o conjunto vazio vira "BASE", nunca string vazia', variantKeyOf([]), 'BASE');
equal(
  'a canonicalização descarta seção desconhecida e duplicata, e reordena',
  canonicalSections(['LAYOUT', 'PRICING', 'LAYOUT', 'FOO', 'VEHICLE']),
  ['VEHICLE', 'PRICING', 'LAYOUT'],
);

// ===========================================================================
// 2. Recorte padrão por função
// ===========================================================================

for (const role of Object.values(RESPONSIBLE_ROLE)) {
  check(`a função ${role} tem recorte padrão declarado`, !!ROLE_DEFAULT_SECTIONS[role]);
}
for (const role of ['COMMERCIAL', 'SELLER', 'REPRESENTATIVE', 'COORDINATOR', 'PURCHASING']) {
  equal(`${role} recebe o documento inteiro`, sectionsForRoles([role]), [...FULL_SECTIONS]);
}
equal('FINANCEIRO recebe tudo menos o layout', sectionsForRoles(['FINANCIAL']), [
  'VEHICLE',
  'SERVICES',
  'PRICING',
  'DELIVERY',
  'PAYMENT',
  'GUARANTEE',
]);
equal('MARKETING recebe só o layout', sectionsForRoles(['MARKETING']), ['LAYOUT']);
for (const role of ['FLEET_MANAGER', 'DRIVER']) {
  equal(`${role} não assina por padrão`, sectionsForRoles([role]), []);
}
equal(
  'as funções somam em UNIÃO: financeiro + marketing dá o documento inteiro',
  sectionsForRoles(['FINANCIAL', 'MARKETING']),
  [...FULL_SECTIONS],
);
// A migração converteu OWNER em COMMERCIAL + MARKETING + FINANCIAL +
// FLEET_MANAGER; a união tem de devolver tudo, senão o ex-proprietário passou a
// receber menos do que recebia.
equal(
  'o ex-proprietário migrado continua recebendo o documento inteiro',
  sectionsForRoles(['COMMERCIAL', 'MARKETING', 'FINANCIAL', 'FLEET_MANAGER']),
  [...FULL_SECTIONS],
);
equal(
  'uma função que não assina não acrescenta nada à união',
  sectionsForRoles(['FLEET_MANAGER', 'MARKETING']),
  ['LAYOUT'],
);

equal('rótulo do completo', describeSections([...FULL_SECTIONS]), 'Documento completo');
equal('rótulo do vazio', describeSections([]), 'Somente texto básico');
equal('rótulo do recorte do marketing', describeSections(['LAYOUT']), 'Layout');
check('o completo é reconhecido como completo', isFullSections([...FULL_SECTIONS]));
check('um recorte não é reconhecido como completo', !isFullSections(['LAYOUT']));
// O documento único de sempre tem de continuar chegando com o mesmo nome.
equal('o nome do arquivo da coleta comum não muda', variantFilenameSuffix([...FULL_SECTIONS]), '');
equal(
  'o recorte do financeiro é nomeado pela AUSÊNCIA',
  variantFilenameSuffix(sectionsForRoles(['FINANCIAL'])),
  '-sem-layout',
);

// ===========================================================================
// 3. Gating do template
// ===========================================================================

/**
 * Só o CORPO do documento.
 *
 * O `<style>` declara `.layout-section`, `.service-amount` e `.totals` em TODO
 * recorte — procurar a classe no arquivo inteiro encontraria a REGRA DE CSS em
 * vez do conteúdo, e a verificação passaria a afirmar o contrário do que quer.
 */
const bodyOf = (html: string): string => html.slice(html.indexOf('</style>'));

const htmlFor = (sections: readonly QuoteSection[]): string =>
  bodyOf(
    buildQuoteHtml(
      {
        sections,
        budgetNumber: 947,
        issuedAt: new Date('2026-08-12T12:00:00Z'),
        expiresAt: new Date('2026-09-12T12:00:00Z'),
        corporateName: 'TRANSPORTES XYZ LTDA',
        customerDocumentFormatted: '12.345.678/0001-99',
        contactName: 'Ana',
        serialNumber: '4821',
        plate: null,
        chassisNumber: null,
        truckCategoryLabel: 'SEMI_TRAILER_2_AXLES',
        truckImplementLabel: 'BAU',
        services: [{ description: 'Pintura completa', amount: 48500, observation: 'com adesivo' }],
        subtotal: 48500,
        total: 46075,
        discountLabel: null,
        discountPercent: 5,
        discountReference: 'ESPECIAL',
        discountAmount: 2425,
        deliveryDays: 20,
        simultaneousTasks: 2,
        paymentText: 'À vista com 5% de desconto.',
        guaranteeText: '2 anos contra descascamento.',
        layoutImages: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='],
        logoDataUri: null,
        fontDataUri: null,
        signers: [{ id: 's1', name: 'Ana', subtitle: 'XYZ', side: 'CUSTOMER' }],
        acceptanceClause: 'CLAUSULA DE ACEITACAO',
        verificationCode: 'ABC-123',
        verificationUrl: 'https://x/v/ABC-123',
      } satisfies QuoteHtmlInput,
      'fused',
    ),
  );

/** Marcadores de CONTEÚDO, um por seção — nunca de estilo. */
const MARKS: Record<QuoteSection, (html: string) => boolean> = {
  VEHICLE: h => h.includes('no veículo'),
  SERVICES: h => /Pintura Completa|Pintura completa/.test(h),
  PRICING: h => h.includes('total-row-final'),
  DELIVERY: h => h.includes('Prazo de entrega'),
  PAYMENT: h => h.includes('Condições de pagamento'),
  GUARANTEE: h => h.includes('Garantias'),
  LAYOUT: h => h.includes('class="layout-image"'),
};

{
  const html = htmlFor(FULL_SECTIONS);
  for (const section of QUOTE_SECTIONS) {
    check(`o documento completo traz a seção ${section}`, MARKS[section](html));
  }
}

for (const only of QUOTE_SECTIONS) {
  const html = htmlFor([only]);
  for (const section of QUOTE_SECTIONS) {
    const present = MARKS[section](html);
    check(
      section === only
        ? `o recorte [${only}] traz a seção ${section}`
        : `o recorte [${only}] NÃO traz a seção ${section}`,
      present === (section === only),
    );
  }
}

{
  // A razão de o recorte existir. Um "R$" aqui é o vazamento que o recurso
  // inteiro existe para impedir.
  const html = htmlFor(sectionsForRoles(['MARKETING']));
  check('o recorte do marketing não contém "R$"', !/R\$/.test(html));
  check('o recorte do marketing não contém o subtotal', !html.includes('48.500'));
  check('o recorte do marketing não contém o total', !html.includes('46.075'));
  // O que NUNCA é recortado — sem isso o arquivo deixa de ser assinável. A
  // cláusula de aceitação e o código de verificação não são procurados aqui de
  // propósito: eles não vêm do template, são carimbados no PDF pelo montador
  // (`stampSeals` / `stampPlainFooter`), que roda por documento e portanto já
  // alcança todos os recortes.
  check('o recorte do marketing preserva o destinatário', html.includes('À Ana'));
  check('o recorte do marketing preserva o bloco de assinaturas', html.includes('Assinaturas'));
  check('o recorte do marketing preserva o cabeçalho', html.includes('Orçamento Nº 947'));
  check('o recorte do marketing traz a arte', html.includes('class="layout-image"'));
}

{
  // O par que um documento único não conseguia entregar: dizer o que será feito
  // no implemento sem que o preço da obra saia do círculo que precisa dele.
  const html = htmlFor(['SERVICES']);
  check('SERVICES sem PRICING lista o serviço', /Pintura/i.test(html));
  check('SERVICES sem PRICING não imprime a coluna de valor', !html.includes('class="service-amount"'));
  check('SERVICES sem PRICING não imprime os totais', !html.includes('total-row-final'));
  check('SERVICES sem PRICING não vaza valor em dinheiro', !/R\$/.test(html));
}

{
  const html = htmlFor(['PRICING']);
  check('PRICING sem SERVICES mostra o total', html.includes('total-row-final'));
  check('PRICING sem SERVICES não lista os serviços', !/Pintura/i.test(html));
}

{
  const html = htmlFor(sectionsForRoles(['FINANCIAL']));
  check('o recorte do financeiro não contém a arte', !html.includes('class="layout-image"'));
  check('o recorte do financeiro traz os totais', html.includes('total-row-final'));
  check('o recorte do financeiro traz o pagamento', html.includes('Condições de pagamento'));
}

// ===========================================================================
// 4. Tolerância a quem NÃO assina
// ===========================================================================

const snapshots = new QuoteSnapshotService(null as never);

const snapshotWith = (signers: QuoteSnapshot['signers']): QuoteSnapshot => ({
  schemaVersion: 2,
  budgetNumber: 947,
  issuedAt: '2026-08-12T12:00:00.000Z',
  expiresAt: '2026-09-12T12:00:00.000Z',
  customer: {
    id: 'cust-1',
    corporateName: 'TRANSPORTES XYZ',
    fantasyName: null,
    document: '12345678000199',
  },
  task: { id: 'task-1', name: 'Baú', serialNumber: '4821' },
  truck: {
    plate: 'ABB8468',
    chassisNumber: '9BW1',
    category: 'SEMI_TRAILER_2_AXLES',
    implementType: 'BAU',
  },
  services: [{ description: 'Pintura', amount: '48500.00', observation: null, position: 0 }],
  subtotal: '48500.00',
  total: '48500.00',
  discount: { type: 'NONE', value: null, reference: null },
  paymentCondition: 'CASH_5',
  customPaymentText: null,
  guaranteeYears: 2,
  customGuaranteeText: null,
  customForecastDays: 20,
  simultaneousTasks: 1,
  layoutFileIds: ['file-1'],
  signers,
  commercialUserId: 'user-1',
});

const comercial = {
  responsibleId: 'r-com',
  name: 'Ana',
  phoneDigits: '5543999990001',
  emailNormalized: 'ana@xyz.com',
  roles: ['COMMERCIAL'],
};
const motorista = {
  responsibleId: 'r-mot',
  name: 'Zé',
  phoneDigits: '5543999990002',
  emailNormalized: 'ze@xyz.com',
  roles: ['DRIVER'],
};
const outroMotorista = { ...motorista, responsibleId: 'r-mot2', name: 'Ivo' };
const outroComercial = { ...comercial, responsibleId: 'r-com2', name: 'Bia' };

const frozen = snapshotWith([comercial, motorista]);
const frozenHash = snapshots.materialHash(frozen);
/** Só o comercial assina esta coleta; o motorista está na tarefa e não assina. */
const signing = ['r-com'];

const survives = (after: QuoteSnapshot): boolean =>
  snapshots.matchesFrozenTerms(after, frozenHash, frozen, signing) !== null;

check('a coleta sobrevive quando nada mudou', survives(frozen));
check(
  'a coleta sobrevive quando a logística cadastra outro motorista',
  survives(snapshotWith([comercial, motorista, outroMotorista])),
);
check('a coleta sobrevive quando o motorista sai da tarefa', survives(snapshotWith([comercial])));
check(
  'a coleta sobrevive quando o telefone do motorista é corrigido',
  survives(snapshotWith([comercial, { ...motorista, phoneDigits: '5543988887777' }])),
);

check(
  'a coleta CAI quando o telefone de quem assina muda (o código iria para outro lugar)',
  !survives(snapshotWith([{ ...comercial, phoneDigits: '5543988886666' }, motorista])),
);
check(
  'a coleta CAI quando o e-mail de quem assina muda',
  !survives(snapshotWith([{ ...comercial, emailNormalized: 'outra@xyz.com' }, motorista])),
);
check(
  'a coleta CAI quando quem assina sai da tarefa (some uma linha de assinatura)',
  !survives(snapshotWith([motorista])),
);
check(
  'a coleta CAI quando entra um contato que assinaria por padrão',
  !survives(snapshotWith([comercial, motorista, outroComercial])),
);
check('a coleta CAI quando o preço muda', !survives({ ...frozen, total: '52000.00' }));
check(
  'a coleta CAI quando um serviço é renomeado',
  !survives({
    ...frozen,
    services: [
      { description: 'Pintura completa', amount: '48500.00', observation: null, position: 0 },
    ],
  }),
);
// Quem não tem o envelope em mãos não pode tolerar nada.
check(
  'sem o elenco de signatários, o comportamento volta a ser o estrito',
  snapshots.matchesFrozenTerms(
    snapshotWith([comercial, motorista, outroMotorista]),
    frozenHash,
    frozen,
  ) === null,
);

// ===========================================================================

if (failures.length) {
  // eslint-disable-next-line no-console
  console.error(`\n❌ ${failures.length} de ${checks} verificações falharam:\n  - ${failures.join('\n  - ')}\n`);
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log(`✅ recorte do orçamento assinado: ${checks} verificações passaram.`);
