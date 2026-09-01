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
  ALWAYS_SECTIONS,
  TOGGLEABLE_SECTIONS,
  FULL_SECTIONS,
  ROLE_DEFAULT_SECTIONS,
  canonicalSections,
  describeSections,
  isFullSections,
  sectionsForRoles,
  variantFilenameSuffix,
  variantKeyOf,
  withAlwaysSections,
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
// A identificação do veículo entra AQUI mesmo o padrão do marketing sendo só a
// arte: ela é o endereço do serviço, e um recorte sem ela não diz de que
// trabalho fala.
equal('MARKETING recebe a arte E a identificação do veículo', sectionsForRoles(['MARKETING']), [
  'VEHICLE',
  'LAYOUT',
]);
for (const role of ['FLEET_MANAGER', 'DRIVER']) {
  equal(`${role} não assina por padrão`, sectionsForRoles([role]), []);
}
// O vazio é preservado vazio — injetar a obrigatória num recorte que não assina
// faria o motorista assinar todo orçamento.
equal('o recorte vazio continua vazio', withAlwaysSections([]), []);
equal(
  'toda seção obrigatória entra num recorte que assina',
  withAlwaysSections(['LAYOUT']),
  ['VEHICLE', 'LAYOUT'],
);
// Quem decide se o contato assina são as RECORTÁVEIS. Um recorte que chega só
// com a obrigatória é o operador tendo desmarcado tudo — e a tela promete que
// isso tira a pessoa da coleta.
equal('só a obrigatória não faz ninguém assinar', withAlwaysSections(['VEHICLE']), []);
for (const always of ALWAYS_SECTIONS) {
  check(
    `a seção obrigatória ${always} não é oferecida como caixa na tela`,
    !TOGGLEABLE_SECTIONS.includes(always),
  );
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
  ['VEHICLE', 'LAYOUT'],
);

equal('rótulo do completo', describeSections([...FULL_SECTIONS]), 'Documento completo');
equal('rótulo do vazio', describeSections([]), 'Somente texto básico');
// As obrigatórias saem do rótulo: elas estão em todo recorte e não distinguem
// nada — "Identificação do veículo, Layout" descreveria o recorte do marketing
// pelo que ele tem em comum com todos os outros.
equal('rótulo do recorte do marketing', describeSections(['VEHICLE', 'LAYOUT']), 'Layout');
check('o completo é reconhecido como completo', isFullSections([...FULL_SECTIONS]));
check('um recorte não é reconhecido como completo', !isFullSections(['LAYOUT']));
// O documento único de sempre tem de continuar chegando com o mesmo nome.
equal('o nome do arquivo da coleta comum não muda', variantFilenameSuffix([...FULL_SECTIONS]), '');
equal(
  'o recorte do financeiro é nomeado pela AUSÊNCIA',
  variantFilenameSuffix(sectionsForRoles(['FINANCIAL'])),
  '-sem-layout',
);
equal(
  'o nome do recorte do marketing ignora a seção obrigatória',
  variantFilenameSuffix(sectionsForRoles(['MARKETING'])),
  '-layout',
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

for (const only of TOGGLEABLE_SECTIONS) {
  const sections = withAlwaysSections([only]);
  const html = htmlFor(sections);
  for (const section of QUOTE_SECTIONS) {
    const expected = sections.includes(section);
    check(
      expected
        ? `o recorte [${only}] traz a seção ${section}`
        : `o recorte [${only}] NÃO traz a seção ${section}`,
      MARKS[section](html) === expected,
    );
  }
  check(
    `o recorte [${only}] traz a identificação do veículo, marcada ou não`,
    MARKS.VEHICLE(html),
  );
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
  // O defeito que motivou tornar o veículo obrigatório: a arte chegava sem
  // dizer de que trabalho ela era.
  check('o recorte do marketing traz a identificação do veículo', html.includes('no veículo'));
  check('o recorte do marketing traz o número de série', html.includes('4821'));
  check('o recorte do marketing preserva o bloco de assinaturas', html.includes('Assinaturas'));
  check('o recorte do marketing preserva o cabeçalho', html.includes('Orçamento Nº 947'));
  check('o recorte do marketing traz a arte', html.includes('class="layout-image"'));
}

{
  // O par que um documento único não conseguia entregar: dizer o que será feito
  // no implemento sem que o preço da obra saia do círculo que precisa dele.
  const html = htmlFor(withAlwaysSections(['SERVICES']));
  check('SERVICES sem PRICING lista o serviço', /Pintura/i.test(html));
  check('SERVICES sem PRICING não imprime a coluna de valor', !html.includes('class="service-amount"'));
  check('SERVICES sem PRICING não imprime os totais', !html.includes('total-row-final'));
  check('SERVICES sem PRICING não vaza valor em dinheiro', !/R\$/.test(html));
}

{
  const html = htmlFor(withAlwaysSections(['PRICING']));
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

/** Coleta EM ANDAMENTO: o comercial ainda não assinou. */
const pendente = ['r-com'];
/** Coleta CONCLUÍDA: ninguém tem assinatura pendente. */
const concluida: string[] = [];

const survives = (after: QuoteSnapshot, pending: readonly string[] = pendente): boolean =>
  snapshots.matchesFrozenTerms(after, frozenHash, frozen, pending) !== null;

// ---- coleta em andamento -------------------------------------------------
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
// O CASO QUE MOTIVOU A REGRA: acrescentar um responsável não pode anular as
// assinaturas já colhidas. Ele não tem linha no documento congelado, e nenhuma
// alteração de cadastro pode lhe dar uma.
check(
  'a coleta sobrevive quando entra um contato que assinaria por padrão',
  survives(snapshotWith([comercial, motorista, outroComercial])),
);

check(
  'a coleta CAI quando o telefone de quem ainda vai assinar muda',
  !survives(snapshotWith([{ ...comercial, phoneDigits: '5543988886666' }, motorista])),
);
check(
  'a coleta CAI quando o e-mail de quem ainda vai assinar muda',
  !survives(snapshotWith([{ ...comercial, emailNormalized: 'outra@xyz.com' }, motorista])),
);
check(
  'a coleta CAI quando quem ainda vai assinar sai da tarefa (linha em branco para sempre)',
  !survives(snapshotWith([motorista])),
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

// ---- coleta concluída ----------------------------------------------------
// Documento selado: nada no elenco pode mais estragar assinatura nenhuma.
check(
  'com tudo assinado, acrescentar um responsável não mexe em nada',
  survives(snapshotWith([comercial, motorista, outroComercial]), concluida),
);
check(
  'com tudo assinado, tirar quem já assinou não mexe em nada',
  survives(snapshotWith([motorista]), concluida),
);
check(
  'com tudo assinado, corrigir o e-mail de quem assinou não mexe em nada',
  survives(snapshotWith([{ ...comercial, emailNormalized: 'outra@xyz.com' }, motorista]), concluida),
);
// Mas o PREÇO continua sendo notícia mesmo depois de assinado — ali o documento
// realmente deixou de refletir o orçamento.
check(
  'com tudo assinado, mudar o preço continua divergindo do documento',
  !survives({ ...frozen, total: '52000.00' }, concluida),
);

// Quem não tem o envelope em mãos não pode tolerar nada.
check(
  'sem o elenco pendente, o comportamento volta a ser o estrito',
  snapshots.matchesFrozenTerms(
    snapshotWith([comercial, motorista, outroMotorista]),
    frozenHash,
    frozen,
  ) === null,
);

// ---- e o que a TELA diz sobre cada caso ----------------------------------
const entryFor = (after: QuoteSnapshot, pending: readonly string[], key: string) =>
  snapshots.changes(frozen, after, { pendingSignerIds: pending }).find(c => c.key.startsWith(key));

{
  const added = entryFor(snapshotWith([comercial, motorista, outroComercial]), concluida, 'signer:added');
  equal('responsável incluído nunca é material', added?.severity, 'COSMETIC');
  equal(
    'e o texto diz o que de fato acontece com ele',
    added?.after,
    'Entrou depois da coleta concluída; não assinou este documento',
  );
}
{
  const added = entryFor(snapshotWith([comercial, motorista, outroComercial]), pendente, 'signer:added');
  equal(
    'na coleta em andamento o texto muda, e continua sem prometer assinatura',
    added?.after,
    'Entrou depois da emissão; não assina esta coleta',
  );
}
{
  const removed = entryFor(snapshotWith([motorista]), pendente, 'signer:removed');
  equal('tirar quem ainda vai assinar é material', removed?.severity, 'MATERIAL');
}
{
  const removed = entryFor(snapshotWith([motorista]), concluida, 'signer:removed');
  equal('tirar quem já assinou não é material', removed?.severity, 'COSMETIC');
  equal(
    'e a tela diz que a assinatura dele continua valendo',
    removed?.after,
    'Saiu da tarefa; a assinatura dele continua valendo',
  );
}

// ===========================================================================
// 5. A QUEM cada recorte é endereçado
// ===========================================================================
//
// Cada recorte é um documento diferente, com signatários diferentes, e o
// "À <fulano>" que abre o orçamento saía de `responsibles[0]` em todos eles: no
// orçamento nº 956 o PDF do Kennedy abria com "À Beatriz" — o documento
// cumprimentava outra pessoa que não quem ia assiná-lo, e o da Beatriz dizia a
// mesma coisa. O vocativo tem de seguir os signatários DAQUELE recorte.

async function verifySalutation(): Promise<void> {
  const { SignatureEnvelopeService } = await import(
    '../src/modules/common/signature/services/signature-envelope.service'
  );

  // `buildRenderInput` é puro em tudo que importa aqui: só toca o `renderer`
  // (para resolver a arte em disco) e o `config` (para a URL de verificação).
  // Os demais colaboradores nunca são alcançados por este caminho.
  const service: any = new (SignatureEnvelopeService as any)(
    null, // prisma
    // Segredos longos e distintos: a auto-checagem do construtor recusa
    // valores curtos ou repetidos e despejaria um bloco de erro no meio da
    // saída deste script, sobre uma configuração que nada aqui usa.
    {
      get: (key: string) =>
        key === 'SIGNATURE_WEB_URL' ? 'https://ankaa.local' : `stub-${key}-${'x'.repeat(40)}`,
    }, // config
    null, // audit
    null, // challenges
    null, // snapshots
    { resolveLayoutImageDataUri: () => null }, // renderer
    null, // assembler
    null, // pades
    null, // filesStorage
    null, // dossiers
  );

  const responsible = (id: string, name: string) => ({ id, name, roles: ['COMMERCIAL'] });
  const quote: any = {
    budgetNumber: 956,
    createdAt: new Date('2026-08-12T12:00:00Z'),
    expiresAt: new Date('2026-09-12T12:00:00Z'),
    subtotal: 48500,
    total: 46075,
    customForecastDays: 20,
    simultaneousTasks: 2,
    guaranteeYears: 2,
    customGuaranteeText: null,
    services: [{ description: 'Pintura', amount: 48500, observation: null }],
    layoutFiles: [],
    customerConfigs: [],
    commercialUserId: null,
    task: {
      serialNumber: '4821',
      customer: { corporateName: 'TRANSPORTES XYZ LTDA', cnpj: '12345678000199' },
      truck: { plate: 'ABB8468', chassisNumber: '9BW1', category: null, implementType: null },
      responsibles: [responsible('r-bia', 'Beatriz'), responsible('r-ken', 'Kennedy')],
    },
  };

  const seed = (id: string, name: string, side: 'ANKAA' | 'CUSTOMER') => ({
    id,
    name,
    subtitle: 'TRANSPORTES XYZ LTDA',
    side,
  });
  const ankaa = seed('ankaa', 'Kennedy Campos', 'ANKAA');

  const contactOf = (seeds: ReturnType<typeof seed>[]): string | null =>
    service.buildRenderInput(quote, seeds, 'COD', null, 'EMAIL', FULL_SECTIONS).contactName;

  equal(
    'o recorte de UM contato é endereçado a ele, não ao primeiro da tarefa',
    contactOf([seed('s1', 'Kennedy', 'CUSTOMER'), ankaa]),
    'Kennedy',
  );
  equal(
    'o recorte da Beatriz é endereçado à Beatriz',
    contactOf([seed('s2', 'Beatriz', 'CUSTOMER'), ankaa]),
    'Beatriz',
  );
  equal(
    'um recorte com dois signatários nomeia os dois',
    contactOf([seed('s1', 'Kennedy', 'CUSTOMER'), seed('s2', 'Beatriz', 'CUSTOMER'), ankaa]),
    'Kennedy e Beatriz',
  );
  equal(
    'com muitos signatários, o vocativo não vira um parágrafo de nomes',
    contactOf([
      seed('s1', 'Ana', 'CUSTOMER'),
      seed('s2', 'Beatriz', 'CUSTOMER'),
      seed('s3', 'Carlos', 'CUSTOMER'),
      seed('s4', 'Daniela', 'CUSTOMER'),
      ankaa,
    ]),
    'Ana, Beatriz e mais 2',
  );
  equal(
    'o recorte que só a Ankaa assina cai no responsável principal da tarefa',
    contactOf([ankaa]),
    'Beatriz',
  );
  // E o veículo continua no recorte, seja qual for o vocativo — é o endereço do
  // serviço.
  const input = service.buildRenderInput(
    quote,
    [seed('s1', 'Kennedy', 'CUSTOMER'), ankaa],
    'COD',
    null,
    'EMAIL',
    sectionsForRoles(['MARKETING']),
  );
  equal('o recorte do marketing leva o número de série', input.serialNumber, '4821');
  equal('o recorte do marketing leva a placa', input.plate, 'ABB8468');
  equal(
    'o recorte do marketing declara só as seções dele',
    input.sections,
    ['VEHICLE', 'LAYOUT'],
  );
}

// ===========================================================================
// 6. Junção dos recortes num arquivo só (a visão do operador)
// ===========================================================================
//
// O que se verifica aqui é o que pode DESTRUIR PROVA em silêncio: o `save()` do
// pdf-lib reescreve o arquivo inteiro, então a junção apaga a assinatura PAdES
// das partes por construção. A defesa tem duas metades, e as duas são medidas
// abaixo: os selados viajam ANEXOS (byte a byte, validáveis), e os widgets de
// assinatura saem das páginas copiadas — sem isso o visualizador anunciaria uma
// assinatura digital que este arquivo não tem.

async function verifyMerge(): Promise<void> {
  const { PDFDocument, PDFName, PDFDict, PDFArray } = await import('pdf-lib');
  const { QuoteAssemblerService } = await import(
    '../src/modules/common/signature/document/quote-assembler.service'
  );

  /** Um PDF de N páginas, uma delas carregando um widget /Sig como um selado real. */
  const makePdf = async (pages: number, withSigWidget = false): Promise<Buffer> => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
    if (withSigWidget) {
      const page = doc.getPage(0);
      const widget = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Sig',
        Rect: [0, 0, 10, 10],
        T: PDFName.of('Signature1'),
      });
      page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(widget)]));
    }
    return Buffer.from(await doc.save({ useObjectStreams: false }));
  };

  const parts = [await makePdf(2, true), await makePdf(1), await makePdf(3, true)];
  const sealed = await makePdf(2, true);

  const merged = await new QuoteAssemblerService().mergeDocuments(
    parts,
    [{ name: 'orcamento-956-assinado.pdf', bytes: sealed, description: 'selado' }],
    'Orçamento nº 956 — todos os recortes',
  );

  const out = await PDFDocument.load(merged, { updateMetadata: false });
  equal('a junção soma as páginas de todos os recortes', out.getPageCount(), 6);
  equal('a junção nomeia o arquivo', out.getTitle(), 'Orçamento nº 956 — todos os recortes');

  // O widget de assinatura NÃO pode sobreviver à cópia: ele faria o
  // visualizador anunciar uma assinatura que este arquivo não carrega.
  let widgets = 0;
  for (const page of out.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = page.node.context.lookupMaybe(annots.get(i), PDFDict);
      if (annot && String(annot.lookup(PDFName.of('FT'))) === '/Sig') widgets++;
    }
  }
  equal('nenhum widget de assinatura sobrevive à cópia', widgets, 0);

  // E o selado viaja INTEIRO, como anexo — é ele que continua valendo.
  const names = out.catalog
    .lookupMaybe(PDFName.of('Names'), PDFDict)
    ?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  check('o recorte selado viaja anexo ao arquivo juntado', !!names);
  check(
    'o anexo é nomeado pelo recorte que ele carrega',
    merged.includes(Buffer.from('orcamento-956-assinado.pdf', 'latin1')),
  );

  // O MESMO merge sem anexo tem de ser MENOR. Comparar contra a soma das partes
  // não serviria: o pdf-lib deduplica objetos, e um arquivo juntado pode ser
  // menor que os pedaços somados sem que nada tenha se perdido. A diferença
  // entre os dois merges, porém, é só o anexo.
  const semAnexo = await new QuoteAssemblerService().mergeDocuments(parts, [], 'x');
  check(
    'os bytes do selado foram de fato embutidos (o anexo pesa)',
    merged.length > semAnexo.length,
  );
}

// ===========================================================================

void verifySalutation()
  .catch(e => {
    failures.push(`vocativo do recorte lançou: ${e instanceof Error ? e.message : String(e)}`);
  })
  .then(verifyMerge)
  .catch(e => {
    failures.push(`junção dos recortes lançou: ${e instanceof Error ? e.message : String(e)}`);
  })
  .then(() => {
    if (failures.length) {
      // eslint-disable-next-line no-console
      console.error(
        `\n❌ ${failures.length} de ${checks} verificações falharam:\n  - ${failures.join('\n  - ')}\n`,
      );
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`✅ recorte do orçamento assinado: ${checks} verificações passaram.`);
  });
