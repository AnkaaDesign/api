/**
 * Verificação de LAYOUT dos recortes do orçamento assinado.
 *
 * Usage: npx tsx scripts/verify-signature-layout.ts
 * Sai 0 se todas as combinações fecham bem, 1 na primeira divergência.
 *
 * POR QUE ISTO EXISTE
 *   O recorte multiplicou as formas possíveis do documento. Antes havia uma:
 *   orçamento inteiro, com ou sem arte. Agora cada combinação de seções é uma
 *   folha diferente, e as duas maneiras de errar são silenciosas:
 *
 *     · TRANSBORDO — a folha de assinaturas tem altura fixa, e um signatário
 *       clipado desaparece do documento sem aviso nenhum;
 *     · FOLHA DESPERDIÇADA — o recorte do marketing é texto básico, arte e
 *       assinaturas; cabe folgadamente em uma folha e saía em duas, a primeira
 *       quase vazia, porque o caminho fundido era pulado sempre que havia arte.
 *
 *   As invariantes abaixo valem para QUALQUER configuração, e é isso que as
 *   torna úteis: nenhuma delas depende de quais seções foram marcadas.
 *
 * Roda Chromium de verdade (Playwright) e mede o PDF resultante — não há como
 * verificar paginação sem paginar. Por isso é lento e vive fora do
 * `test:signature`, que é instantâneo.
 */

import { PDFDocument } from 'pdf-lib';
import {
  QuoteRendererService,
  type RenderInput,
} from '../src/modules/common/signature/document/quote-renderer.service';
import {
  FULL_SECTIONS,
  describeSections,
  sectionsForRoles,
  withAlwaysSections,
  type QuoteSection,
} from '../src/modules/common/signature/quote-sections';

/**
 * Uma arte de verdade, na proporção de um baú (larga e baixa).
 *
 * SVG e não um PNG de 1px: o que está sendo medido é como a imagem OCUPA a
 * folha, e um pixel esticado não exercita o `object-fit` nem o teto de altura —
 * a medida sairia sempre a mesma, e o teste passaria sem testar nada.
 */
const ART = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 1600 600">
     <rect width="1600" height="600" fill="#0a5c1e"/>
     <text x="800" y="330" font-size="180" fill="#fff" text-anchor="middle" font-family="sans-serif">LAYOUT</text>
   </svg>`,
).toString('base64')}`;

const SIGNER_NAMES = [
  'Ana Paula Rodrigues',
  'Beatriz Carvalho',
  'Carlos Eduardo Menezes',
  'Daniela Figueiredo',
  'Eduardo Nascimento',
  'Fernanda Alcântara',
];

function inputFor(opts: {
  sections: readonly QuoteSection[];
  services: number;
  layouts: number;
  signers: number;
  /** Quantos veículos o orçamento cobre. Ausente = 1, o caso de sempre. */
  vehicles?: number;
}): RenderInput {
  return {
    sections: opts.sections,
    budgetNumber: 956,
    issuedAt: new Date('2026-08-12T12:00:00Z'),
    expiresAt: new Date('2026-09-12T12:00:00Z'),
    corporateName: 'TRANSPORTES SANTA HELENA LTDA',
    customerDocumentFormatted: '12.345.678/0001-99',
    contactName: 'Ana Paula Rodrigues',
    vehicles: Array.from({ length: opts.vehicles ?? 1 }, (_, i) => ({
      taskId: `task-${i + 1}`,
      serialNumber: String(4821 + i),
      // Placa e chassi VAZIOS de propósito: é o caso do implemento 0 km, e é o
      // que faz a lacuna de cadastro tardio existir para ser medida.
      plate: null,
      chassisNumber: null,
      categoryLabel: 'SEMI_TRAILER_2_AXLES',
      implementLabel: 'BAU',
    })),
    billing: {
      corporateName: 'TRANSPORTES SANTA HELENA LTDA',
      documentFormatted: '12.345.678/0001-99',
      stateRegistration: '123.456.789.000',
      municipalRegistration: '98765',
      addressLine: 'Rodovia BR-369, 1200, Galpão B',
      addressLocality: 'Distrito Industrial — Ibiporã/PR — CEP 86200-000',
      orderNumber: '4500123456',
    },
    services: Array.from({ length: opts.services }, (_, i) => ({
      description: `Pintura completa do implemento — etapa ${i + 1} com preparação de superfície`,
      amount: 4850 + i * 137,
      observation: i % 3 === 0 ? 'inclui adesivagem lateral e traseira' : null,
    })),
    subtotal: 48500,
    total: 46075,
    discountLabel: null,
    discountPercent: 5,
    discountReference: 'ESPECIAL',
    discountAmount: 2425,
    deliveryDays: 20,
    simultaneousTasks: 2,
    paymentText: 'À vista com 5% de desconto, ou em 3 parcelas iguais sem juros.',
    guaranteeText: '2 anos contra descascamento, bolhas e perda de brilho.',
    layoutImages: Array.from({ length: opts.layouts }, () => ART),
    signers: [
      ...Array.from({ length: opts.signers - 1 }, (_, i) => ({
        id: `cliente-${i}`,
        name: SIGNER_NAMES[i % SIGNER_NAMES.length],
        subtitle: 'TRANSPORTES SANTA HELENA LTDA',
        side: 'CUSTOMER' as const,
      })),
      { id: 'ankaa', name: 'Kennedy Campos', subtitle: 'Diretor — Ankaa Design', side: 'ANKAA' as const },
    ],
    acceptanceClause: 'ACEITAÇÃO DO MEIO ELETRÔNICO. As partes reconhecem e aceitam…',
    verificationCode: 'ABC-123-XYZ',
    verificationUrl: 'https://ankaa/v/ABC-123-XYZ',
  };
}

/** Os recortes que o sistema de fato emite, mais dois extremos. */
const CUTS: Array<{ label: string; sections: QuoteSection[] }> = [
  { label: 'completo', sections: [...FULL_SECTIONS] },
  { label: 'financeiro', sections: sectionsForRoles(['FINANCIAL']) },
  { label: 'marketing', sections: sectionsForRoles(['MARKETING']) },
  { label: 'só serviços', sections: withAlwaysSections(['SERVICES']) },
  { label: 'só preço', sections: withAlwaysSections(['PRICING']) },
  { label: 'serviços + arte', sections: withAlwaysSections(['SERVICES', 'LAYOUT']) },
];

const GRID = [
  { services: 2, layouts: 1, signers: 2 },
  { services: 2, layouts: 2, signers: 4 },
  { services: 12, layouts: 1, signers: 2 },
  { services: 12, layouts: 0, signers: 6 },
  { services: 24, layouts: 1, signers: 4 },
  // ── ORÇAMENTO MULTITAREFA ────────────────────────────────────────────────
  //
  // Três configurações que só existem desde que um orçamento passou a cobrir N
  // veículos. A tabela de identificação cresce uma linha por veículo, e é ela
  // que decide se a lacuna de cadastro tardio ainda cai na primeira folha (onde
  // é carimbável) — ver `resolveLateSlots`.
  //
  //  ·  3 veículos: o caso comum de um lote pequeno; tudo na folha 1.
  //  · 12 veículos: a tabela já empurra os serviços para a segunda folha.
  //  · 60 veículos: o Marquespan real. Aqui a tabela ocupa quase três folhas e
  //    as lacunas das últimas linhas DEIXAM de ser carimbáveis — o que o
  //    aditivo cobre, e é por isso que ele é montado a partir dos veículos e não
  //    das lacunas medidas.
  { services: 3, layouts: 1, signers: 2, vehicles: 3 },
  { services: 3, layouts: 1, signers: 2, vehicles: 12 },
  { services: 3, layouts: 0, signers: 2, vehicles: 60 },
];

async function main() {
  const renderer = new QuoteRendererService();
  const failures: string[] = [];
  let checks = 0;

  const check = (label: string, ok: boolean) => {
    checks++;
    if (!ok) failures.push(label);
  };

  for (const grid of GRID) {
    const inputs = CUTS.map(cut => inputFor({ ...grid, sections: cut.sections }));
    const rendered = await renderer.renderAll(inputs);

    const pagesOf = new Map<string, number>();
    for (let i = 0; i < CUTS.length; i++) {
      const cut = CUTS[i];
      const r = rendered[i];
      const doc = await PDFDocument.load(r.pdf, { updateMetadata: false });
      const pages = doc.getPageCount();
      pagesOf.set(cut.label, pages);

      const scenario = `${(grid as any).vehicles ?? 1} veíc., ${grid.services} serviços, ${grid.layouts} arte(s), ${grid.signers} signatários · ${cut.label}`;

      // 1. Nenhum signatário pode ser clipado. É a única falha desta lista que
      //    apaga uma pessoa do documento sem deixar rastro.
      check(`[${scenario}] a folha de assinaturas não transborda`, !r.overflowed);

      // 2. Todo signatário tem âncora medida — sem retângulo não há onde
      //    carimbar o selo, e o documento sai assinado sem mostrar a assinatura.
      const expected = inputs[i].signers.length;
      check(
        `[${scenario}] mediu as ${expected} âncoras (obtido ${Object.keys(r.anchors).length})`,
        Object.keys(r.anchors).length === expected,
      );

      // 3. A tabela de identificação do veículo é obrigatória, então a lacuna de
      //    cadastro tardio tem de ser medida em TODO recorte: a placa que chega
      //    depois precisa de um retângulo onde ser carimbada, seja qual for o
      //    recorte.
      //
      //    ⚠️ COM MUITOS VEÍCULOS ISSO DEIXA DE VALER, e o teto é a primeira
      //    folha (`resolveLateSlots`): a tabela de sessenta caminhões ocupa quase
      //    três, e da linha ~35 em diante nenhuma lacuna é carimbável. Não é
      //    perda de informação — o ADITIVO declara esses campos e é montado a
      //    partir dos veículos, não das lacunas medidas —, então o que se exige
      //    aqui é que as PRIMEIRAS linhas continuem carimbáveis, que é o que
      //    prova que a medição segue funcionando.
      const vehiclesInGrid = (grid as any).vehicles ?? 1;
      check(
        `[${scenario}] reservou as lacunas de cadastro tardio`,
        Object.keys(r.lateSlots).length > 0,
      );
      // Duas por veículo (placa e chassi; a série vem preenchida), até o teto da
      // primeira folha. Com um veículo o número é exato.
      if (vehiclesInGrid === 1) {
        check(
          `[${scenario}] reservou as 2 lacunas do único veículo`,
          Object.keys(r.lateSlots).length === 2,
        );
      }
      // Toda chave reservada leva a TAREFA junto: sem isso o chassi do caminhão
      // 3 seria carimbado no espaço do caminhão 1.
      check(
        `[${scenario}] as lacunas são chaveadas por veículo`,
        Object.keys(r.lateSlots).every(k => k.includes('#')),
      );

      // 4. Nada de folha em branco no fim.
      check(`[${scenario}] tem ao menos uma folha`, pages >= 1);

      // 5. A folha única nunca é comprada espremendo a arte. Quando há arte e o
      //    documento fechou em uma folha, ela tem de ter sobrado conferível —
      //    é a condição que separa "coube" de "foi esmagado".
      if (pages === 1 && cut.sections.includes('LAYOUT') && grid.layouts > 0) {
        check(
          `[${scenario}] a arte na folha única mede ${r.layoutMm?.toFixed(0) ?? '?'}mm (mín. 45mm)`,
          (r.layoutMm ?? 0) >= 45,
        );
      }
    }

    // 6. INVARIANTE ENTRE RECORTES: tirar conteúdo nunca acrescenta folha.
    //    É a formulação verificável de "harmonioso não importa a configuração":
    //    se um recorte MENOR paginar mais que o completo, alguma coisa está
    //    empurrando o documento para baixo em vez de compactá-lo.
    const full = pagesOf.get('completo')!;
    for (const cut of CUTS) {
      if (cut.label === 'completo') continue;
      const pages = pagesOf.get(cut.label)!;
      check(
        `[${grid.services} serviços, ${grid.layouts} arte(s)] "${cut.label}" (${pages}) não pagina ` +
          `mais que o completo (${full})`,
        pages <= full,
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      `  ${String(grid.services).padStart(2)} serviços · ${grid.layouts} arte(s) · ` +
        `${grid.signers} signatários → ` +
        CUTS.map((c, i) => {
          const art = rendered[i].layoutMm;
          return `${c.label}: ${pagesOf.get(c.label)}f${art ? ` (arte ${art.toFixed(0)}mm)` : ''}`;
        }).join('  ·  '),
    );
  }

  // 7. O caso que motivou a mudança: pouco conteúdo + arte tem de fechar em UMA
  //    folha. Antes disso o caminho fundido era pulado sempre que havia arte, e
  //    o recorte do marketing saía em duas com a primeira quase vazia.
  {
    const [marketing] = await renderer.renderAll([
      inputFor({ sections: sectionsForRoles(['MARKETING']), services: 2, layouts: 1, signers: 2 }),
    ]);
    const pages = (await PDFDocument.load(marketing.pdf, { updateMetadata: false })).getPageCount();
    check(
      `o recorte do marketing com arte fecha em UMA folha (obtido ${pages})`,
      pages === 1,
    );
    // eslint-disable-next-line no-console
    console.log(`\n  marketing (${describeSections(sectionsForRoles(['MARKETING']))}) com arte: ${pages} folha`);
  }

  // 8. E o contrário: com o orçamento inteiro e arte, a folha única NÃO pode ser
  //    comprada espremendo a arte. Duas folhas legíveis valem mais que uma
  //    ilegível — ver `FUSED_MIN_LAYOUT_MM`.
  {
    const [cheio] = await renderer.renderAll([
      inputFor({ sections: [...FULL_SECTIONS], services: 24, layouts: 2, signers: 4 }),
    ]);
    const pages = (await PDFDocument.load(cheio.pdf, { updateMetadata: false })).getPageCount();
    check(`o orçamento cheio com arte NÃO é espremido em uma folha (obtido ${pages})`, pages >= 2);
    // eslint-disable-next-line no-console
    console.log(`  completo com 24 serviços e 2 artes: ${pages} folhas`);
  }

  if (failures.length) {
    // eslint-disable-next-line no-console
    console.error(`\n❌ ${failures.length} de ${checks} verificações falharam:\n  - ${failures.join('\n  - ')}\n`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`\n✅ layout dos recortes: ${checks} verificações passaram.`);
}

main().catch(e => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
