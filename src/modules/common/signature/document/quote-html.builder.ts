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

  /**
   * `invoiceToName` só é impresso na visão COMPLETA de um faturamento dividido
   * (ver `segments`), onde a mesma folha lista serviços de mais de um pagador e
   * sem a coluna não há como saber qual linha é de quem.
   */
  services: Array<{
    description: string;
    amount: number;
    observation: string | null;
    invoiceToName?: string | null;
  }>;
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
  /** N° do pedido de compra do cliente, quando informado na configuração. */
  orderNumber?: string | null;
  guaranteeText: string;

  /**
   * Faturamento DIVIDIDO visto por inteiro — uma entrada por cliente.
   *
   * Preenchido apenas na visão completa (sem recorte) de um orçamento com duas
   * ou mais configurações; a partir de duas entradas o documento troca a
   * apuração única por uma apuração POR CLIENTE: coluna "Faturar para" nos
   * serviços, subtotal/desconto/total de cada pagador antes do total geral e uma
   * condição de pagamento por pagador.
   *
   * Sem isso o PDF completo imprimia o desconto e a condição de pagamento da
   * PRIMEIRA configuração como se valessem para o orçamento inteiro — o desconto
   * de um cliente aplicado sobre o subtotal dos dois —, enquanto a página
   * pública já separava os totais. Quem baixava o anexo lia números que não
   * existem.
   */
  segments?: Array<{
    customerName: string;
    subtotal: number;
    discountLabel: string | null;
    discountAmount: number;
    total: number;
    paymentText: string;
    orderNumber: string | null;
  }> | null;

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
  // Visão completa de um faturamento dividido: a folha mistura serviços de dois
  // pagadores, então cada linha diz para quem vai e cada cliente tem sua própria
  // apuração. Com um cliente só (ou no recorte) nada disso aparece.
  const split = (data.segments?.length ?? 0) >= 2 ? data.segments! : null;

  const servicesHtml = data.services
    .map(
      (s, index) => `
      <div class="service-row">
        <div class="service-desc"><span class="service-index">${index + 1}</span> - ${escapeHtml(
          serviceLineText(s),
        )}</div>
        ${split ? `<div class="service-customer">${escapeHtml(s.invoiceToName || '—')}</div>` : ''}
        <div class="service-amount">${formatCurrencyBRL(s.amount)}</div>
      </div>`,
    )
    .join('');

  // Cabeçalho da tabela: existe só quando há a coluna do meio. Com duas colunas
  // (serviço e valor) ele não informa nada que a leitura já não dê.
  const servicesHeaderHtml = split
    ? `<div class="service-row service-head">
         <div class="service-desc">Serviço</div>
         <div class="service-customer">Faturar para</div>
         <div class="service-amount">Valor</div>
       </div>`
    : '';

  const discountLabel = composeDiscountLabel({
    percent: data.discountPercent ?? null,
    reference: data.discountReference ?? null,
    legacy: data.discountLabel,
  });

  // Apuração por cliente. Quem não tem desconto sai numa linha só (nome + total),
  // como na página pública; quem tem abre subtotal, desconto e total — sem isso o
  // abatimento de um cliente do faturamento dividido não aparecia em lugar nenhum
  // do documento completo.
  const segmentsTotalsHtml = split
    ? split
        .map(seg =>
          seg.discountAmount > 0
            ? `<div class="segment-block">
                 <div class="segment-name">${escapeHtml(seg.customerName)}</div>
                 <div class="total-row segment-row">
                   <span class="total-label">Subtotal</span>
                   <span class="total-value">${formatCurrencyBRL(seg.subtotal)}</span>
                 </div>
                 <div class="total-row segment-row total-row-discount">
                   <span class="total-label">${escapeHtml(seg.discountLabel ?? 'Desconto')}</span>
                   <span class="total-value">- ${formatCurrencyBRL(seg.discountAmount)}</span>
                 </div>
                 <div class="total-row segment-row segment-row-total">
                   <span class="total-label">Total</span>
                   <span class="total-value">${formatCurrencyBRL(seg.total)}</span>
                 </div>
               </div>`
            : `<div class="segment-block">
                 <div class="total-row segment-row-single">
                   <span class="total-label">${escapeHtml(seg.customerName)}</span>
                   <span class="total-value">${formatCurrencyBRL(seg.total)}</span>
                 </div>
               </div>`,
        )
        .join('')
    : '';

  const totalsHtml = split
    ? `
    <div class="totals">
      ${segmentsTotalsHtml}
      <div class="total-row total-row-final">
        <span class="total-label">Total</span>
        <span class="total-value">${formatCurrencyBRL(data.total)}</span>
      </div>
    </div>`
    : `
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

  // Condições de pagamento: uma por cliente no faturamento dividido — elas
  // divergem justamente por isso (um paga à vista, o outro parcelado), e o
  // documento completo imprimia só a do primeiro. O N° do pedido acompanha a
  // condição do cliente que o informou.
  const orderNumberHtml = (value: string | null | undefined): string =>
    value ? `<p class="terms-note"><strong>N° do Pedido:</strong> ${escapeHtml(value)}</p>` : '';

  const paymentSectionHtml = split
    ? (() => {
        const blocks = split
          .filter(seg => seg.paymentText || seg.orderNumber)
          .map(
            seg => `<div class="payment-block">
                      <div class="payment-customer">${escapeHtml(seg.customerName)}</div>
                      ${seg.paymentText ? `<p class="terms-content">${escapeHtml(seg.paymentText)}</p>` : ''}
                      ${orderNumberHtml(seg.orderNumber)}
                    </div>`,
          )
          .join('');
        return blocks
          ? `<div class="page-content-gap"></div>
             <section class="terms-section">
               <h2 class="terms-title">Condições de pagamento</h2>
               ${blocks}
             </section>`
          : '';
      })()
    : data.paymentText || data.orderNumber
      ? `<div class="page-content-gap"></div>
         <section class="terms-section">
           ${
             data.paymentText
               ? `<h2 class="terms-title">Condições de pagamento</h2>
                  <p class="terms-content">${escapeHtml(data.paymentText)}</p>`
               : ''
           }
           ${orderNumberHtml(data.orderNumber)}
         </section>`
      : '';

  const vehicleParts: string[] = [];
  if (data.serialNumber)
    vehicleParts.push(` nº série: <strong>${escapeHtml(data.serialNumber)}</strong>`);
  if (data.plate) vehicleParts.push(` placa: <strong>${escapeHtml(data.plate)}</strong>`);
  if (data.chassisNumber)
    vehicleParts.push(` chassi: <strong>${escapeHtml(data.chassisNumber)}</strong>`);
  // Rótulo humano, não o enum cru. Ver `truckCategoryLabel()` em quote-text.ts.
  const categoryLabel = truckCategoryLabel(data.truckCategoryLabel);
  const implementLabel = implementTypeLabel(data.truckImplementLabel);
  if (categoryLabel)
    vehicleParts.push(` categoria: <strong>${escapeHtml(categoryLabel)}</strong>`);
  if (implementLabel)
    vehicleParts.push(` implemento: <strong>${escapeHtml(implementLabel)}</strong>`);
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

  /* --- Tabela de 3 colunas (faturamento dividido) ---------------------------
     GRADE, não flexbox. Em flex a coluna do valor tem a largura do CONTEÚDO, e
     no cabeçalho o conteúdo é a palavra "Valor" — mais estreita que
     "R$ 12.950,00". Resultado: a coluna do meio do cabeçalho começava uns 13mm
     à direita da dos itens, e o título "FATURAR PARA" não ficava sobre a sua
     própria coluna. Com grid-template-columns as três faixas são as MESMAS no
     cabeçalho e em toda linha, por construção.
     As larguras também resolvem a legibilidade: a razão social longa
     ("Industria de Carrocerias Metalicas Ibipora LTDA") quebrava em TRÊS linhas
     e cada serviço virava um bloco. Quem quebra tem de ser o nome do cliente —
     por isso a faixa dele é FIXA (48mm — a medida em que a maior razão social do
     cadastro cabe em UMA linha) e num corpo bem menor, e a linha inteira
     encolhe um ponto. Tudo derivado de --service-size, então o ajustador de
     página continua mandando no conjunto.
     Os 7mm de vão antes do valor são deliberados: o nome do pagador é cinza e o
     valor é preto e negrito, e a 4mm os dois liam como uma coisa só. */
  .services-list.split .service-row {
    display: grid;
    grid-template-columns: 1fr 48mm 26mm;
    column-gap: 7mm;
    align-items: start;
    font-size: calc(var(--service-size) - 1pt);
  }
  .service-customer {
    text-align: right; color: var(--gray);
    font-size: calc(var(--service-size) - 2.5pt); line-height: 1.25;
    overflow-wrap: break-word;
  }
  /* Seletor com a mesma força de .services-list.split .service-row, senão
     aquela regra vence e o cabeçalho sai do tamanho do corpo. */
  .services-list.split .service-head {
    font-size: calc(var(--service-size) - 2.5pt); font-weight: 600;
    color: var(--gray); text-transform: uppercase; letter-spacing: .3px;
    border-bottom: .5px solid #ccc; padding-bottom: 1mm;
  }
  .service-head .service-customer { font-size: inherit; }
  /* tabular-nums para que 9 e 10 alinhem a coluna do texto num orcamento longo. */
  .service-index { font-variant-numeric: tabular-nums; }
  /* text-align, não só o justify-content do flex: na GRADE a caixa ocupa a
     faixa inteira, e sem isto os valores (e o título "Valor") ficavam colados à
     esquerda da faixa, em bandeira. */
  .service-amount { font-weight: 600; white-space: nowrap; text-align: right; }

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

  /* Apuração por cliente (faturamento dividido, visão completa). Cada bloco é
     indivisível: subtotal e desconto separados do total do MESMO cliente por uma
     quebra de página seriam ilegíveis. */
  .segment-block { break-inside: avoid; margin-bottom: 2mm; }
  .segment-name { font-size: 9.5pt; font-weight: 600; margin-bottom: .5mm; }
  .segment-row { padding-left: 4mm; font-size: 9pt; }
  .segment-row-total { border-top: .5px solid #ccc; margin-top: .5mm; padding-top: 1mm; font-weight: 600; }
  .segment-row-single { font-size: 9.5pt; }
  .segment-row-single .total-label { font-weight: 600; }

  /* Titulo e corpo do bloco andam juntos: "Condicoes de pagamento" orfao no pe
     de uma folha, com o texto na seguinte, e um defeito de leitura num
     documento contratual. */
  .terms-section { break-inside: avoid; }
  .terms-title { font-size: 10pt; font-weight: 700; color: var(--green); margin-bottom: 1mm; }
  .terms-content { font-size: 9pt; line-height: 1.5; text-align: justify; }
  .terms-note { font-size: 8.5pt; color: var(--gray); margin-top: .8mm; }
  .payment-block { break-inside: avoid; }
  .payment-block + .payment-block { margin-top: 2mm; }
  .payment-customer { font-size: 9pt; font-weight: 600; }

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
      <div class="services-list${split ? ' split' : ''}">${servicesHeaderHtml}${servicesHtml}</div>
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

    ${paymentSectionHtml}

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
