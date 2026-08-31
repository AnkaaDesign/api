/**
 * Template HTML do orçamento — renderizado no SERVIDOR.
 *
 * Substitui, para efeito de documento assinado, o `window.print()` do web. Três
 * diferenças de comportamento que são correções, não regressões:
 *
 * 1. **Fonte embutida.** O template do web pede `'Segoe UI', Tahoma, Geneva,
 *    Verdana` — fontes que não existem no container e, no caso da Segoe UI, são
 *    proprietárias da Microsoft. O mesmo documento paginava diferente por SO.
 *    Aqui a Inter vai embutida como data-URI: mesmo byte em qualquer host.
 *
 * 2. **Validade como DATA ABSOLUTA.** O template do web imprime "Validade: N
 *    dias", recalculado contra `new Date()` a cada render, e vira um "Vencido"
 *    vermelho em negrito que re-flui o layout quando N chega a zero. Ou seja, o
 *    conteúdo do documento mudava sozinho todo dia. Aqui imprime-se
 *    "Válido até DD/MM/AAAA", que é imutável — e de quebra resolve a discussão de
 *    proposta entre presentes/ausentes do CC art. 428.
 *
 * 3. **Slots de assinatura marcados.** Cada signatário ganha um
 *    `[data-signature-slot]` vazio; o renderizador mede o retângulo de cada um no
 *    navegador e grava em `SignatureEnvelope.anchors`. É assim que o selo é
 *    carimbado exatamente acima da linha correta, sem re-renderizar o documento.
 *
 * Nada aqui depende do relógio: todas as datas vêm do snapshot.
 */

import { COMPANY, BRAND_COLORS } from '@/config/company';
import {
  composeDiscountLabel,
  escapeHtml,
  formatCurrencyBRL,
  formatDateBR,
  formatGuaranteeHtml,
  implementTypeLabel,
  serviceLineText,
  truckCategoryLabel,
} from './quote-text';

/**
 * Margens da @page, em mm. Exportadas porque o montador precisa delas para
 * converter as âncoras (medidas relativas à CAIXA DE CONTEÚDO) em coordenadas de
 * página do PDF. Mantenha em sincronia com a regra @page do template.
 */
export const PAGE_MARGINS_MM = { top: 10, right: 15, bottom: 12, left: 15 } as const;

/** Conversão CSS px → ponto PDF: 96dpi → 72dpi. */
export const PX_TO_PT = 72 / 96;

export function mmToPt(mm: number): number {
  return (mm / 25.4) * 72;
}

/**
 * Os campos de identidade do veículo que podem chegar DEPOIS da assinatura.
 *
 * Implemento 0 km é orçado enquanto ainda está em fabricação: a placa chega em
 * média 3,5 dias depois do cadastro do veículo e o chassi 23 (medido no
 * histórico de alterações — 243 dos 250 toques no chassi são preenchimento de
 * campo vazio, não troca de valor). O documento, porém, é congelado no envio
 * para assinatura e não pode ser re-renderizado: o hash dos bytes é o que liga
 * a trilha de OTP a um documento, e reescrever a frase ainda reflui o parágrafo
 * e desloca as âncoras dos selos, que são coordenadas absolutas.
 *
 * Então o espaço é RESERVADO na emissão, com a largura do maior valor possível,
 * e o dado é carimbado nele quando chega — a mesma mecânica do selo de
 * assinatura, que também é medido aqui e desenhado depois.
 */
export type LateSlotKey = 'serialNumber' | 'plate' | 'chassis';

/**
 * Largura reservada, em `ch`, por campo.
 *
 * É o número de caracteres do MAIOR valor possível, não o do texto do
 * marcador: se a caixa coubesse apenas "a registrar", um chassi de 17 dígitos
 * teria de ser espremido a 60% do corpo do texto para caber depois. Chassi tem
 * 17 caracteres por norma; placa tem 7 (Mercosul) ou 8 (padrão antigo com
 * hífen); o maior número de série em uso tem 5 dígitos, e 8 dá folga.
 */
const LATE_SLOT_WIDTH_CH: Record<LateSlotKey, number> = {
  serialNumber: 8,
  plate: 8,
  chassis: 17,
};

/**
 * O marcador é VISÍVEL de propósito.
 *
 * "a registrar" é o que torna o preenchimento posterior honesto: quem assina vê
 * que ali falta um dado, do mesmo modo que vê uma linha de assinatura ainda em
 * branco e não estranha que apareça uma assinatura nela depois. Um espaço mudo
 * que um dia ganhasse conteúdo faria o documento afirmar algo que ninguém leu.
 */
function lateSlotHtml(key: LateSlotKey): string {
  return `<span class="late-slot" data-late-slot="${key}" style="min-width:${LATE_SLOT_WIDTH_CH[key]}ch">a registrar</span>`;
}

/**
 * Um dado do veículo já cadastrado — mesmo traço da lacuna, mas preenchido.
 *
 * O tracejado vale para TODOS os campos do veículo, e não só para os que ainda
 * estão vazios: a frase passa a ser um formulário de identificação com campos
 * de mesma natureza, uns preenchidos e outros não. Sem isso, o dado carimbado
 * depois seria o único sublinhado da frase — o remendo se anunciaria pela
 * formatação, em vez de pela trilha, que é onde a informação de fato mora.
 */
function vehicleValueHtml(value: string): string {
  return `<span class="vehicle-value">${escapeHtml(value)}</span>`;
}

export interface QuoteHtmlSignerSlot {
  /** EnvelopeSigner.id — vira o valor de data-signature-slot. */
  id: string;
  name: string;
  /** "Diretor Comercial" para o lado Ankaa; cargo informado para o cliente. */
  subtitle: string;
  /** Lado Ankaa recebe destaque discreto para diferenciar do cliente. */
  side: 'ANKAA' | 'CUSTOMER';
}

export interface QuoteHtmlInput {
  budgetNumber: number;
  issuedAt: Date;
  expiresAt: Date;

  corporateName: string | null;
  customerDocumentFormatted: string | null;
  contactName: string | null;

  serialNumber: string | null;
  plate: string | null;
  chassisNumber: string | null;
  /**
   * Aceita o valor CRU do enum (`SEMI_TRAILER_2_AXLES`) ou o rótulo já
   * resolvido. O builder mapeia com `@constants/enum-labels` — ver
   * `truckCategoryLabel()`. Até esta correção o enum cru ia direto para o
   * documento assinado.
   */
  truckCategoryLabel: string | null;
  truckImplementLabel: string | null;

  services: Array<{ description: string; amount: number; observation: string | null }>;
  subtotal: number;
  total: number;
  /**
   * Forma LEGADA do rótulo de desconto (`"5%"` ou a própria referência).
   * Preferir `discountPercent` + `discountReference`, que produzem
   * `Desconto (5%) — ESPECIAL` como a página pública e o Dossiê.
   */
  discountLabel: string | null;
  /** Percentual quando o desconto é `PERCENTAGE`. */
  discountPercent?: number | null;
  /** Motivo do desconto (`TaskQuoteCustomerConfig.discountReference`). */
  discountReference?: string | null;
  discountAmount: number;

  deliveryDays: number | null;
  simultaneousTasks: number | null;
  paymentText: string;
  guaranteeText: string;

  /** data:image/... das imagens de layout já resolvidas em disco. */
  layoutImages: string[];
  logoDataUri: string | null;
  fontDataUri: string | null;

  signers: QuoteHtmlSignerSlot[];

  /** Cláusula de aceitação do meio eletrônico impressa no corpo do documento. */
  acceptanceClause: string;
  verificationCode: string;
  verificationUrl: string;
}

/**
 * As duas partes do documento sao renderizadas SEPARADAMENTE e depois unidas com
 * pdf-lib.
 *
 * Motivo: com as duas paginas no mesmo HTML, o `break-before: page` da pagina de
 * assinaturas interagia com a altura da pagina de conteudo e o Chromium emitia
 * uma folha em branco entre elas. O layout paginado do Chromium nao coincide com
 * o layout continuo mensuravel via getBoundingClientRect, entao o problema nao
 * era diagnosticavel nem contornavel de forma confiavel por CSS. Renderizando
 * cada parte isoladamente nao existe interacao de quebra: o conteudo ocupa
 * exatamente as folhas de que precisa, a pagina de assinaturas ocupa uma, e a
 * uniao e deterministica.
 */
export type QuoteHtmlPart = 'content' | 'signatures' | 'fused';

export function buildQuoteHtml(data: QuoteHtmlInput, part: QuoteHtmlPart = 'content'): string {
  // Numeração 1., 2., 3.… e descrição em Title Case com a observação na mesma
  // linha — as três coisas do gerador de referência
  // (`web/src/utils/budget-pdf-generator.ts:530-551`) que faltavam aqui. Sem o
  // número, o cliente não tem como apontar "o item 4" ao contestar; e a
  // observação numa sub-linha cinza fazia o mesmo serviço parecer dois.
  const servicesHtml = data.services
    .map(
      (s, index) => `
      <div class="service-row">
        <div class="service-desc"><span class="service-index">${index + 1}</span> - ${escapeHtml(
          serviceLineText(s),
        )}</div>
        <div class="service-amount">${formatCurrencyBRL(s.amount)}</div>
      </div>`,
    )
    .join('');

  const discountLabel = composeDiscountLabel({
    percent: data.discountPercent ?? null,
    reference: data.discountReference ?? null,
    legacy: data.discountLabel,
  });

  const totalsHtml = `
    <div class="totals">
      ${
        data.discountAmount > 0
          ? `<div class="total-row">
               <span class="total-label">Subtotal</span>
               <span class="total-value">${formatCurrencyBRL(data.subtotal)}</span>
             </div>
             <div class="total-row total-row-discount">
               <span class="total-label">${escapeHtml(discountLabel)}</span>
               <span class="total-value">- ${formatCurrencyBRL(data.discountAmount)}</span>
             </div>`
          : ''
      }
      <div class="total-row total-row-final">
        <span class="total-label">Total</span>
        <span class="total-value">${formatCurrencyBRL(data.total)}</span>
      </div>
    </div>`;

  // Rótulo humano, não o enum cru. Ver `truckCategoryLabel()` em quote-text.ts.
  const categoryLabel = truckCategoryLabel(data.truckCategoryLabel);
  const implementLabel = implementTypeLabel(data.truckImplementLabel);

  const identity: Array<{ key: LateSlotKey; label: string; value: string | null }> = [
    { key: 'serialNumber', label: 'nº série', value: data.serialNumber },
    { key: 'plate', label: 'placa', value: data.plate },
    { key: 'chassis', label: 'chassi', value: data.chassisNumber },
  ];

  // Só se fala do veículo quando existe veículo. Sem isto, um orçamento sem
  // caminhão nenhum ganharia três lacunas a preencher e uma frase sobre um
  // objeto que não existe.
  const hasVehicle =
    identity.some(f => !!f.value) || !!categoryLabel || !!implementLabel;

  const vehicleParts: string[] = [];
  if (hasVehicle) {
    // Série, placa e chassi saem SEMPRE — com valor, ou com o espaço reservado
    // para ele. Ver `.late-slot` no CSS: é o que permite carimbar o dado que
    // chega semanas depois sem re-renderizar o documento congelado.
    for (const field of identity) {
      vehicleParts.push(
        field.value
          ? ` ${field.label}: ${vehicleValueHtml(field.value)}`
          : ` ${field.label}: ${lateSlotHtml(field.key)}`,
      );
    }
    // Categoria e implemento não ganham lacuna: são classificação, não
    // identidade, e já estão preenchidos na emissão. Ausentes, simplesmente não
    // aparecem, como antes. Levam o mesmo traço dos demais só para a frase ler
    // como um bloco só.
    if (categoryLabel) vehicleParts.push(` categoria: ${vehicleValueHtml(categoryLabel)}`);
    if (implementLabel) vehicleParts.push(` implemento: ${vehicleValueHtml(implementLabel)}`);
  }
  const vehicleText = vehicleParts.length ? ` no veículo${vehicleParts.join(',')}` : '';

  const companyIntro =
    data.corporateName && data.corporateName !== 'Cliente'
      ? ` para a <strong>${escapeHtml(data.corporateName)}</strong>${
          data.customerDocumentFormatted ? ` (${escapeHtml(data.customerDocumentFormatted)})` : ''
        },`
      : '';

  const headerBlock = `
    <header class="header">
      ${data.logoDataUri ? `<img src="${data.logoDataUri}" alt="Ankaa Design" class="logo" />` : '<div class="logo-fallback">ANKAA DESIGN</div>'}
      <div class="header-right">
        <div class="budget-number">Orçamento Nº ${data.budgetNumber}</div>
        <div class="header-info">
          <span class="header-info-label">Emissão:</span> ${formatDateBR(data.issuedAt)}<br />
          <span class="header-info-label">Válido até:</span> ${formatDateBR(data.expiresAt)}
        </div>
      </div>
    </header>
    <div class="header-line"></div>`;

  // Idêntico ao rodapé da página pública do orçamento
  // (web/src/pages/public/budget/[id].tsx): endereço acentuado, telefone com
  // DDD entre parênteses e a URL completa com https — os três divergiam.
  const footerPhone = COMPANY.phone.startsWith('(')
    ? COMPANY.phone
    : COMPANY.phone.replace(/^(\d{2})\s/, '($1) ');

  const footerBlock = `
    <footer class="footer">
      <div class="footer-company">${COMPANY.name}</div>
      <div class="footer-info">
        ${escapeHtml(COMPANY.address)}<br />
        <span class="footer-link">${escapeHtml(footerPhone)}</span><br />
        <span class="footer-link">${escapeHtml(COMPANY.websiteUrl)}</span>
      </div>
    </footer>`;

  // O layout ia SO para a folha de assinaturas. Quando o orcamento cabe em uma
  // folha o render usa o caminho fundido, que nao tem essa folha — e o layout
  // sumia do documento assinado em silencio, embora a pagina publica o exibisse.
  const layoutHtml = data.layoutImages.length
    ? `<section class="layout-section">
         <h2 class="section-title-green">Layout</h2>
         <div class="layout-grid">
           ${data.layoutImages.map(src => `<img src="${src}" class="layout-image" alt="Layout" />`).join('')}
         </div>
       </section>`
    : '';

  // Ate 3 signatarios cabem confortavelmente em 2 colunas. A partir de 4, duas
  // colunas empilham 3 fileiras e o bloco come a folha inteira — 3 colunas com
  // caixas menores mantem o mesmo bloco em 2 fileiras.
  const gridClass = data.signers.length > 3 ? 'signature-grid cols-3' : 'signature-grid';

  const layoutInContent = part === 'fused' ? layoutHtml : '';
  const layoutInSignatures = part === 'signatures' ? layoutHtml : '';

  const signersHtml = data.signers
    .map(
      s => `
      <div class="signature-box">
        <div class="signature-seal-area"
             data-signature-slot="${escapeHtml(s.id)}"
             data-signer-side="${s.side}"></div>
        <div class="signature-line">
          <div class="signature-name">${escapeHtml(s.name)}</div>
          <div class="signature-title">${escapeHtml(s.subtitle)}</div>
        </div>
      </div>`,
    )
    .join('');

  const fontFace = data.fontDataUri
    ? `@font-face {
         font-family: 'InterEmbedded';
         src: url('${data.fontDataUri}') format('truetype');
         font-weight: 100 900;
         font-style: normal;
         font-display: block;
       }`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Orçamento Nº ${data.budgetNumber}</title>
<style>
  ${fontFace}

  :root {
    --green: ${BRAND_COLORS.primaryGreen};
    --text: ${BRAND_COLORS.textDark};
    --gray: ${BRAND_COLORS.textGray};
    /* Ajustados pelo renderizador quando o conteudo excede a pagina.
       A classe .page tem overflow:hidden — sem o loop de ajuste, excesso de
       conteudo seria CLIPADO em silencio, o que num documento assinado
       significaria perder uma linha de assinatura sem qualquer sinal. */
    --service-size: 10pt;
    --logo-height: 14mm;
    --block-gap: 5mm;
    --seal-height: 26mm;
    --sig-row-gap: 6mm;
    --layout-max-h: 105mm;
    /* Altura-alvo da folha. Só é definida (por JS) quando o ajustador conclui
       que o documento cabe em UMA folha; em documentos multi-folha esticar o
       container reintroduz páginas fantasma. */
    --sheet-fill: 0mm;
  }

  /* Margens na @page, não em padding do elemento: assim TODA página gerada pela
     paginação natural recebe as mesmas margens. Com padding no elemento, só a
     primeira página teria margem e as seguintes correriam até a borda física. */
  @page { size: A4; margin: 10mm 15mm 12mm 15mm; }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    font-family: 'InterEmbedded', sans-serif;
    color: var(--text);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Página de conteúdo: altura MÍNIMA de uma folha útil, mas livre para crescer.
     Um orçamento com muitos serviços simplesmente pagina — é o comportamento
     correto para um documento que alguém vai assinar. A alternativa (altura fixa
     + overflow:hidden) encolhia até a ilegibilidade e, passando disso, CLIPAVA
     linhas em silêncio. */
  .page {
    /* 180mm = 210 (A4) - 15 - 15, a caixa util que a @page reserva. Estava em
       160mm, largura de uma folha com margens de 25mm que a @page nao usa: os
       20mm que sobravam viravam margem DIREITA (a caixa e alinhada a esquerda),
       e o corpo do orcamento saia mais estreito que a pagina de assinaturas, que
       ja usava 180mm. */
    width: 180mm;
    min-height: var(--sheet-fill);
    /* Sem min-height: a pagina de conteudo tem exatamente a altura do conteudo.
       Forcar 269mm (a folha util) somava a altura do rodape e estourava a folha
       por alguns pixels, gerando uma pagina fantasma so com o rodape. O preco e
       que num orcamento curto o rodape acompanha o conteudo em vez de ficar
       colado no pe da folha — diferenca cosmetica, sem efeito no documento. */
    display: flex;
    flex-direction: column;
    position: relative;
  }

  /* Página de assinaturas: altura FIXA e sempre a última. A geometria precisa ser
     exata porque é dela que saem as âncoras dos selos; e por ser a última, seu
     índice no PDF é simplesmente (total de páginas - 1), o que dispensa
     rastrear quantas páginas o conteúdo consumiu. */
  .page-signatures {
    width: 180mm;
    height: 274mm;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
    break-before: page;
  }

  .header { display: flex; justify-content: space-between; align-items: flex-start; }
  /* 14mm e o valor do gerador de referencia (logoHeight.default,
     web/src/utils/budget-pdf-generator.ts:136). Estava fixo em 22mm — 57% maior
     que o padrao da empresa, o que dominava o cabecalho. Vira variavel porque o
     ajustador pode encolhe-lo ate 10mm (o mesmo piso da referencia) antes de
     deixar o documento paginar. */
  .logo { height: var(--logo-height); object-fit: contain; }
  .logo-fallback { font-size: 16pt; font-weight: 700; color: var(--green); letter-spacing: .5px; }
  .header-right { text-align: right; }
  .budget-number { font-size: 12pt; font-weight: 700; color: var(--green); }
  .header-info { font-size: 8.5pt; color: var(--gray); line-height: 1.5; margin-top: 1mm; }
  .header-info-label { font-weight: 600; color: var(--text); }
  .header-line { height: 2px; background: var(--green); margin-top: 3mm; }

  /* Conteúdo do orçamento: cresce livremente e pagina. */
  .page-content { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding-top: 5mm; }

  /* Conteúdo da página de assinaturas: altura limitada de verdade.
     min-height:0 é obrigatório, não cosmético — um item flex tem
     min-height:auto por padrão, o que o deixa CRESCER além do pai em vez de ser
     limitado por flex:1. Sem isso, clientHeight acompanharia o conteúdo,
     scrollHeight nunca o superaria, o detector de overflow ficaria cego e o
     excesso seria clipado em silêncio — fazendo sumir uma linha de assinatura
     de um documento assinado. */
  /* As faixas ::before/::after transformam o vão de ~137mm (51% da folha) numa
     margem equilibrada em cima e embaixo do bloco, em vez de um buraco. */
  .signatures-content::before,
  .signatures-content::after { content: ''; flex: 1 1 0; }
  .signatures-section { flex: 0 0 auto; }
  .signatures-content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding-top: 5mm;
  }
  /* flex, não height. Esta é a mecânica do gerador de referência
     (web/src/utils/budget-pdf-generator.ts): a sobra vertical é distribuída
     ENTRE as seções, de modo que um orçamento curto preencha a folha em vez de
     acumular um vão único acima do rodapé. Trocar isto por uma altura fixa foi
     o que produziu o buraco de ~68mm relatado. */
  /* max-height e essencial: flex 1-1-0 sozinho distribui TODA a sobra, e com
     poucos serviços isso abre vãos enormes entre as seções. O teto mantém o
     ritmo sem transformar folga em buraco. */
  .page-content-gap {
    flex: 1 1 0;
    min-height: var(--block-gap);
    max-height: calc(var(--block-gap) * 2.2);
  }

  /* Alinhado à ESQUERDA e sublinhado, como o gerador de referência
     (web/src/utils/budget-pdf-generator.ts). Nada neste documento é centralizado. */
  .document-title {
    font-size: 13pt; font-weight: 700; color: var(--green);
    text-align: left; text-decoration: underline; text-underline-offset: 2px;
    margin-bottom: 4mm;
  }

  .customer-name { font-size: 10.5pt; font-weight: 600; margin-bottom: 2mm; }
  .intro-text { font-size: 9.5pt; line-height: 1.55; text-align: justify; }

  /* Campos do veículo — ver LateSlotKey e JS_MEASURE_LATE_SLOTS.
     TODOS levam o mesmo filete, preenchidos ou não: a frase lê como uma linha
     de formulário, e o dado carimbado depois não se denuncia pela formatação.
     Filete CONTÍNUO, não pontilhado: no corpo de 9,5pt o tracejado sai com
     ponto de menos de meio ponto e o rasterizador o entrega ondulado, com os
     pontos caindo em pixels diferentes ao longo da linha.
     O inline-block é o que garante um retângulo medível e uma largura própria:
     um span normal em texto justificado pode ser partido em duas linhas pelo
     Chromium, e aí não existe UM retângulo onde carimbar. A largura da lacuna
     vem do style inline (o maior valor possível daquele campo), então o carimbo
     cabe sem espremer e sem empurrar o texto seguinte. */
  .vehicle-value,
  .late-slot {
    display: inline-block;
    /* Mais apertado que a entrelinha do parágrafo (1,55) para o filete ficar
       logo abaixo do texto, e não boiando no vão da linha. Continua maior que a
       caixa de conteúdo da fonte (~1,2em), então o retângulo medido cobre o
       marcador inteiro — é ele que o carimbo apaga. */
    line-height: 1.3;
    border-bottom: 1px solid var(--gray);
  }

  .vehicle-value { font-weight: 700; }

  .late-slot {
    text-align: center;
    font-style: italic;
    font-weight: 400;
    color: var(--gray);
    /* Corpo IGUAL ao do texto ao redor, de propósito: a unidade ch é relativa à
       fonte do próprio elemento, então encolher o marcador encolheria na mesma
       proporção o espaço reservado — e o carimbo, que sai no corpo do texto, não
       caberia mais. O que distingue a lacuna do dado é o itálico cinza, não o
       tamanho. */
    font-size: 1em;
  }

  /* Sem regua sob o titulo: a unica divisoria horizontal do documento e a do
     cabecalho (e a do rodape, que a espelha). Titulos de secao se distinguem
     pelo peso e pela cor. */
  .section-title-green {
    font-size: 11pt; font-weight: 700; color: var(--green);
    margin-bottom: 2.5mm;
  }

  .service-row {
    display: flex; justify-content: space-between; gap: 6mm;
    font-size: var(--service-size); line-height: 1.45;
    padding: 1.1mm 0; border-bottom: .5px dotted #ccc;
    break-inside: avoid;
  }
  /* A ultima linha nao leva pontilhado: logo abaixo dela vem a regua do bloco de
     totais (verde no Total, cinza no Subtotal quando ha desconto), e as duas
     empilhadas liam como um erro de impressao. */
  .service-row:last-child { border-bottom: none; }
  .service-desc { flex: 1; }
  /* tabular-nums para que 9 e 10 alinhem a coluna do texto num orcamento longo. */
  .service-index { font-variant-numeric: tabular-nums; }
  .service-amount { font-weight: 600; white-space: nowrap; }

  /* Largura TOTAL, como .totals-section do gerador de referencia
     (web/src/utils/budget-pdf-generator.ts): o rotulo cai na margem esquerda e o
     valor na direita, na mesma grade das linhas de servico logo acima. A versao
     anterior usava margin-left:auto + width:fit-content, o que fazia o bloco
     flutuar como ilha desalinhada do resto do documento. Largura total tambem
     resolve por construcao o rotulo longo "Desconto (5%) - ESPECIAL". */
  /* break-inside: avoid porque num orcamento que pagina o Subtotal e o Desconto
     ficavam no pe de uma folha e o Total sozinho no topo da seguinte — o numero
     que o cliente confere separado do que o justifica. */
  .totals { margin-top: 3mm; padding-left: 4mm; break-inside: avoid; }
  .total-row { display: flex; justify-content: space-between; gap: 6mm; font-size: 9.5pt; padding: .8mm 0; }
  /* Valor em vermelho e rotulo em cor normal, como o gerador de referencia
     (.discount-value em web/src/utils/budget-pdf-generator.ts). */
  .total-row-discount .total-value { color: #c00; }
  .total-row-final {
    border-top: 1.5px solid var(--green); margin-top: 1mm; padding-top: 1.5mm;
    font-size: 11.5pt; font-weight: 700; color: var(--green);
  }

  /* Titulo e corpo do bloco andam juntos: "Condicoes de pagamento" orfao no pe
     de uma folha, com o texto na seguinte, e um defeito de leitura num
     documento contratual. */
  .terms-section { break-inside: avoid; }
  .terms-title { font-size: 10pt; font-weight: 700; color: var(--green); margin-bottom: 1mm; }
  .terms-content { font-size: 9pt; line-height: 1.5; text-align: justify; }

  .acceptance-clause {
    margin-top: 6mm; font-size: 7pt; line-height: 1.45; color: var(--gray);
    border-top: .5px solid #ddd; padding-top: 2mm; text-align: justify;
    break-inside: avoid;
  }
  /* Empurra o rodapé para o fim da folha quando o conteúdo é curto, e deixa que
     ele simplesmente siga o conteúdo quando o orçamento pagina. */
  .footer-spacer { flex: 1 1 auto; min-height: 4mm; }

  .layout-section { margin-bottom: 6mm; }
  .layout-grid { display: flex; flex-direction: column; gap: 4mm; align-items: center; }
  .layout-image { max-width: 100%; max-height: var(--layout-max-h); object-fit: contain; }

  /* Folha de assinaturas COM layout: a sobra vertical vai para a imagem em vez de
     virar margem. As faixas ::before/::after existem para centralizar o bloco
     quando a folha tem so as assinaturas; com uma imagem de layout elas
     competiam pelo mesmo espaco livre (todas com flex-grow 1), e a imagem
     ficava presa em --layout-max-h com um vao enorme em volta.

     min-height: 0 em cada nivel e OBRIGATORIO: sem ele o item flex nao encolhe
     abaixo do conteudo, a altura percentual da imagem nao resolve e o detector
     de overflow do renderizador fica cego. */
  /* Nada acima: o layout comeca logo abaixo do cabecalho. Abaixo, uma faixa FIXA
     de 8mm — com flex 0 as assinaturas encostavam na regua do rodape. */
  .signatures-content.has-layout::before { flex: 0 0 0; }
  .signatures-content.has-layout::after { flex: 0 0 14mm; }
  .signatures-content.has-layout .layout-section {
    flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;
  }
  /* flex-start: a imagem encosta no titulo "Layout". Centralizada, a sobra da
     proporcao virava vao acima E abaixo dela. */
  .signatures-content.has-layout .layout-grid {
    flex: 1 1 auto; min-height: 0; justify-content: flex-start;
  }
  /* Sem o teto de --layout-max-h aqui: quem limita e o espaco que sobra depois do
     cabecalho, do bloco de assinaturas e do rodape. */
  .signatures-content.has-layout .layout-image { max-height: 100%; }

  .signatures-title {
    font-size: 11pt; font-weight: 700; color: var(--green); text-align: left;
    margin-bottom: 5mm;
  }
  .signature-grid {
    display: flex; flex-wrap: wrap; gap: var(--sig-row-gap) 8mm;
    /* center, não space-between: com 3 signatários o terceiro ficava órfão
       encostado à esquerda. */
    justify-content: center;
  }
  .signature-box { width: calc(50% - 4mm); break-inside: avoid; }
  /* 3 colunas: a grade tem gap horizontal de 8mm, entao sao 2 vaos = 16mm
     divididos pelas 3 caixas. Nome e cargo encolhem junto, senao o cargo
     ("Diretor de Operacoes — TRANSPORTES XYZ LTDA") quebra em tres linhas. */
  .signature-grid.cols-3 .signature-box { width: calc(33.333% - 5.34mm); }
  .signature-grid.cols-3 .signature-name { font-size: 8pt; }
  .signature-grid.cols-3 .signature-title { font-size: 6.5pt; line-height: 1.3; }
  /* Área reservada ao selo. Fica VAZIA no original.pdf — é o retângulo que o
     renderizador mede e que o montador carimba depois. */
  .signature-seal-area { height: var(--seal-height); }
  .signature-line { border-top: .8px solid var(--text); padding-top: 1.5mm; text-align: center; }
  .signature-name { font-size: 9pt; font-weight: 600; }
  .signature-title { font-size: 7.5pt; color: var(--gray); }

  /* Rodape em fluxo, no fim de cada parte.
     Foi tentado position:fixed para repeti-lo em todas as folhas, mas isso exige
     reservar espaco no pe de cada folha via padding, e esse padding empurrava o
     conteudo alguns pixels alem da folha — gerando uma pagina em branco contendo
     so o rodape repetido. Em fluxo o comportamento e previsivel: num orcamento
     que pagina, o rodape aparece ao fim do conteudo. */
  .footer {
    margin-top: 0;
    flex: 0 0 auto;
    /* Espelha a regua do cabecalho (.header-line): 2px verde. O documento passa
       a ter exatamente duas divisorias, uma abrindo e outra fechando a folha. */
    border-top: 2px solid var(--green); padding-top: 2.5mm; text-align: left;
    break-inside: avoid;
  }
  .footer-company { font-size: 10pt; font-weight: 700; color: var(--green); }
  .footer-info { font-size: 8.5pt; color: var(--gray); line-height: 1.5; }
  .footer-link { color: var(--green); }
</style>
</head>
<body>

${part === 'content' || part === 'fused' ? `
<div class="page" id="page-1">
  ${headerBlock}
  <div class="page-content" id="page-1-content">
    <h1 class="document-title">ORÇAMENTO</h1>

    <div class="customer-section">
      ${data.contactName ? `<div class="customer-name">À ${escapeHtml(data.contactName)}</div>` : ''}
      <p class="intro-text">Conforme solicitado, apresentamos nossa proposta de preço${companyIntro} para execução dos serviços abaixo descriminados${vehicleText}.</p>
    </div>

    <div class="page-content-gap"></div>

    <section class="services-section">
      <h2 class="section-title-green">Serviços</h2>
      <div class="services-list">${servicesHtml}</div>
      ${totalsHtml}
    </section>

    ${
      data.deliveryDays
        ? `<div class="page-content-gap"></div>
           <section class="terms-section">
             <h2 class="terms-title">Prazo de entrega</h2>
             <p class="terms-content">O prazo de entrega é de ${data.deliveryDays} dias úteis a partir da data de liberação.${
               data.simultaneousTasks && data.simultaneousTasks > 1
                 ? ` Neste período, ${data.simultaneousTasks} tarefas poderão ser produzidas simultaneamente.`
                 : ''
             }</p>
           </section>`
        : ''
    }

    ${
      data.paymentText
        ? `<div class="page-content-gap"></div>
           <section class="terms-section">
             <h2 class="terms-title">Condições de pagamento</h2>
             <p class="terms-content">${escapeHtml(data.paymentText)}</p>
           </section>`
        : ''
    }

    ${
      data.guaranteeText
        ? `<div class="page-content-gap"></div>
           <section class="terms-section">
             <h2 class="terms-title">Garantias</h2>
             <p class="terms-content">${formatGuaranteeHtml(data.guaranteeText)}</p>
           </section>`
        : ''
    }

    ${layoutInContent}

    ${
      part === 'fused'
        ? `<div class="page-content-gap"></div>
    <section class="signatures-section">
      <h2 class="signatures-title">Assinaturas</h2>
      <div class="${gridClass}">${signersHtml}</div>
    </section>`
        : ''
    }
    <div class="footer-spacer"></div>
  </div>
  ${footerBlock}
</div>
` : `
<div class="page-signatures" id="page-signatures">
  ${headerBlock}
  <div class="signatures-content${layoutInSignatures ? ' has-layout' : ''}" id="signatures-content">
    ${layoutInSignatures}
    <section class="signatures-section">
      <h2 class="signatures-title">Assinaturas</h2>
      <div class="${gridClass}">${signersHtml}</div>
    </section>
  </div>
  ${footerBlock}
</div>
`}

</body>
</html>`;
}
