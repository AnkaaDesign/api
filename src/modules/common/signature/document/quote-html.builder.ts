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

import { COMPANY, BRAND_COLORS, BILLING_CONTACT, whatsappLinkFor } from '@/config/company';
import { FULL_SECTIONS, hasSection, type QuoteSection } from '../quote-sections';
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
export type LateSlotKey = 'serialNumber' | 'plate' | 'chassis' | 'orderNumber';

/**
 * Largura reservada, em `ch`, por campo.
 *
 * É o número de caracteres do MAIOR valor possível, não o do texto do
 * marcador: se a caixa coubesse apenas "a registrar", um chassi de 17 dígitos
 * teria de ser espremido a 60% do corpo do texto para caber depois. Chassi tem
 * 17 caracteres por norma; placa tem 7 (Mercosul) ou 8 (padrão antigo com
 * hífen); o maior número de série em uso tem 5 dígitos, e 8 dá folga.
 *
 * O PEDIDO DE COMPRA é texto livre do cliente e não tem norma: 12 cobre o que
 * está em uso com folga. `min-width` e não `width`, aqui como nos outros — um
 * valor maior ainda cabe, só ocupa mais linha do que o reservado.
 */
const LATE_SLOT_WIDTH_CH: Record<LateSlotKey, number> = {
  serialNumber: 8,
  plate: 8,
  chassis: 17,
  orderNumber: 12,
};

/**
 * O marcador é VISÍVEL de propósito.
 *
 * "a registrar" é o que torna o preenchimento posterior honesto: quem assina vê
 * que ali falta um dado, do mesmo modo que vê uma linha de assinatura ainda em
 * branco e não estranha que apareça uma assinatura nela depois. Um espaço mudo
 * que um dia ganhasse conteúdo faria o documento afirmar algo que ninguém leu.
 */
function lateSlotHtml(key: LateSlotKey, taskId: string): string {
  // A chave leva a TAREFA junto. Sem isso, num orçamento de sessenta caminhões as
  // sessenta lacunas de chassi teriam a mesma chave `chassis`, o mapa de âncoras
  // guardaria só a última medida e o chassi do caminhão 3 seria carimbado no
  // espaço reservado do caminhão 60. Ver `lateSlotKey()` em `utils/quote-tasks`.
  return `<span class="late-slot" data-late-slot="${escapeHtml(key)}#${escapeHtml(taskId)}" style="min-width:${LATE_SLOT_WIDTH_CH[key]}ch">a registrar</span>`;
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

/** Um veículo do orçamento — uma linha da tabela de identificação. */
export interface QuoteHtmlVehicle {
  /** `Task.id`. É o que compõe a chave da lacuna de cadastro tardio. */
  taskId: string;
  serialNumber: string | null;
  plate: string | null;
  chassisNumber: string | null;
  /**
   * Aceita o valor CRU do enum (`SEMI_TRAILER_2_AXLES`) ou o rótulo já
   * resolvido. O builder mapeia com `@constants/enum-labels` — ver
   * `truckCategoryLabel()`. Até esta correção o enum cru ia direto para o
   * documento assinado.
   */
  categoryLabel: string | null;
  implementLabel: string | null;
  /**
   * O NÚMERO DO PEDIDO DE COMPRA DO CLIENTE, deste veículo
   * (`Task.customerOrderNumber`).
   *
   * Sai como COLUNA da tabela, e não como linha do quadro do tomador: o pedido
   * identifica a ENTREGA, como a série e a placa, e um orçamento de quatro
   * caminhões comprados em pedidos diferentes não cabe numa linha só.
   */
  orderNumber: string | null;
}

/**
 * O cadastro do tomador como a prefeitura o exige.
 *
 * Todo campo é opcional porque o cadastro real tem buracos, e um quadro que se
 * recusasse a sair por falta da inscrição municipal esconderia justamente o
 * buraco que ele existe para expor. Campo vazio sai como "—".
 */
export interface QuoteHtmlBilling {
  corporateName: string | null;
  /** Já formatado (`13.902.480/0001-28`). O builder não conhece máscara. */
  documentFormatted: string | null;
  stateRegistration: string | null;
  municipalRegistration: string | null;
  /** Linha 1: tipo de logradouro + rua, número e complemento. */
  addressLine: string | null;
  /** Linha 2: bairro, cidade/UF e CEP. */
  addressLocality: string | null;
  /**
   * @deprecated O número do pedido virou COLUNA da tabela de veículos
   * (`QuoteHtmlVehicle.orderNumber`): ele identifica a ENTREGA, e um orçamento
   * de quatro caminhões pode ter quatro pedidos, que numa linha só não cabem.
   *
   * Segue no tipo porque os envelopes CONGELADOS antes desta mudança guardam o
   * campo no snapshot, e o material que os re-renderiza tem de aceitá-lo.
   */
  orderNumber: string | null;
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

/** Uma parcela emitida — o que o boleto ou o Pix daquele mês vai cobrar. */
export interface QuoteHtmlInstallment {
  number: number;
  /** `DD/MM/AAAA`, já no fuso de Brasília. */
  dueDate: string;
  /** Já formatado em BRL: o builder não faz aritmética de dinheiro. */
  amount: string;
  /** Quitada. Sai como uma marca discreta, não como uma coluna a mais. */
  paid: boolean;
}

/**
 * O PLANO DE PAGAMENTO DE UM FATURAMENTO — as parcelas e para onde pagar.
 *
 * Um bloco por cobrança. Com um faturamento (o caso de 722 dos 722 orçamentos em
 * produção) o `label` é nulo e o bloco não se anuncia; com lotes, cada um diz
 * quais veículos cobre, senão as duas tabelas de quatro linhas leriam como uma
 * de oito.
 */
export interface QuoteHtmlPaymentSchedule {
  /** "Veículos 1 a 20", ou nulo quando é o orçamento inteiro. */
  label: string | null;
  installments: QuoteHtmlInstallment[];
  /** A conta Pix que recebe — nula quando a cobrança é por boleto. */
  pix: { key: string; keyKind: string; holder: string } | null;
}

export interface QuoteHtmlInput {
  budgetNumber: number;
  issuedAt: Date;
  expiresAt: Date;

  corporateName: string | null;
  customerDocumentFormatted: string | null;
  contactName: string | null;

  /**
   * OS VEÍCULOS do orçamento, na ordem canônica — um por tarefa.
   *
   * Era um veículo só, escrito em prosa dentro do parágrafo de abertura
   * ("…no veículo nº série: 39239, placa: a registrar, chassi: 953677…"). Virou
   * lista por duas razões que se somam: a prosa não escala para sessenta
   * caminhões, e mesmo com um só ela alinhava mal — as lacunas "a registrar"
   * apareciam no meio da frase, em posições diferentes a cada orçamento, quando
   * o que o leitor faz com elas é CONFERIR campo a campo.
   */
  vehicles: QuoteHtmlVehicle[];

  services: Array<{ description: string; amount: number; observation: string | null }>;
  /**
   * Subtotal, desconto e total são SEMPRE POR VEÍCULO.
   *
   * Num orçamento de um veículo — que é a esmagadora maioria — isto é
   * exatamente o que sempre foi, e o documento sai idêntico. Com N veículos o
   * builder é quem multiplica: exibe o valor unitário, a linha "× N" e o total
   * geral. Passar o total já multiplicado faria a lista de serviços (unitária)
   * não fechar com o total logo abaixo dela.
   */
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
  /** Motivo do desconto (`BudgetPayer.discountReference`). */
  discountReference?: string | null;
  discountAmount: number;

  deliveryDays: number | null;
  simultaneousTasks: number | null;
  paymentText: string;
  /**
   * O QUADRO DO TOMADOR, conferível linha a linha.
   *
   * A seção que era "Condições de pagamento" passou a se chamar "Faturamento" e
   * abre com este quadro; a frase das parcelas continua logo abaixo dele. O
   * motivo é operacional e caro: a NFS-e é emitida na Elotech com a razão
   * social, o CNPJ, as inscrições e o endereço EXATOS do cadastro, e um dado
   * errado só aparece depois da nota autorizada — quando corrigir custa cancelar
   * e substituir, com a prefeitura no meio. Pôr o cadastro no documento que o
   * cliente assina transforma a conferência em parte da aprovação.
   *
   * Nulo quando não há cliente de faturamento resolvido; a seção então cai para
   * só a frase das parcelas, como antes.
   */
  billing: QuoteHtmlBilling | null;

  /**
   * AS PARCELAS EMITIDAS, com data e valor — e a conta que as recebe.
   *
   * Vazio (ou ausente) na esmagadora maioria dos caminhos, e é assim que tem de
   * ser: só o CORPO LEGÍVEL do dossiê o preenche. Ver `buildRenderInput`.
   *
   * ⚠️ NUNCA vai para o documento SELADO. As parcelas não entram no hash do
   * snapshot (`quote-snapshot.service.ts`), então imprimi-las no PDF assinado
   * poria no papel um dado que pode mudar sem que a assinatura sequer perceba —
   * e o dossiê, que é montado agora, tem exatamente a propriedade oposta: ele
   * mostra o estado de hoje, e é onde a informação é verdadeira.
   */
  paymentSchedule?: QuoteHtmlPaymentSchedule[];
  guaranteeText: string;

  /** data:image/... das imagens de layout já resolvidas em disco. */
  layoutImages: string[];
  logoDataUri: string | null;
  fontDataUri: string | null;

  signers: QuoteHtmlSignerSlot[];

  /**
   * Como os signatários se distribuem pelas FOLHAS de assinatura.
   *
   * A folha de assinaturas tem altura fixa — é dela que saem as âncoras dos
   * selos, e um bloco que transborda clipa uma linha inteira sem sinal nenhum.
   * Enquanto havia uma folha só, "não coube" só podia virar recusa: era o
   * `BadRequestException` que dizia ao operador para tirar responsáveis da
   * coleta. Não há razão para esse limite existir — assinar é o ato de uma
   * pessoa, e quantas pessoas assinam é decisão do cliente, não do papel.
   *
   * Então quando não cabe, o bloco SE PARTE: o renderizador mede, reduz quantos
   * cabem por folha e repete. Cada grupo vira uma `.page-signatures` própria,
   * com cabeçalho e rodapé, e cada âncora carrega a folha em que foi medida.
   *
   * Omitido = todos numa folha, que é o caso de sempre.
   */
  signerPages?: QuoteHtmlSignerSlot[][];

  /**
   * A arte vai no CORPO do orçamento, não na folha de assinaturas.
   *
   * O padrão é a folha de assinaturas: com uma arte ela sobra bem, e a folha que
   * já existe passa a carregar o que o cliente está de fato aprovando. Com
   * VÁRIAS artes essa folha divide a mesma sobra entre todas e cada uma vira
   * miniatura — o renderizador mede isso e, abaixo do piso de legibilidade,
   * manda a arte para o corpo, onde ela pagina livremente a 105mm por imagem.
   * Uma folha a mais custa menos que uma arte que ninguém consegue conferir.
   */
  layoutInContent?: boolean;

  /**
   * O RECORTE deste documento: as seções que ele exibe.
   *
   * Omitido significa o documento inteiro — é o que mantém funcionando todo
   * chamador anterior a este recurso (a prévia do orçamento não assinado, o
   * corpo legível do dossiê) sem que nenhum deles precise saber que recortes
   * existem.
   *
   * O que NÃO é recortável não está aqui: cabeçalho, destinatário, cláusula de
   * aceitação, bloco de assinaturas e rodapé saem sempre. Ver `quote-sections.ts`.
   */
  sections?: readonly QuoteSection[];

  /**
   * A TARJA de documento sem valor — "CANCELADO", "FORA DE VALIDADE".
   *
   * Presente = este PDF descreve uma proposta que NÃO está mais de pé, e o papel
   * tem de dizer isso sozinho. Ausente (o caso normal) = nada é impresso.
   *
   * ⚠️ SÓ ALCANÇA O DOCUMENTO SOB DEMANDA. Quem o preenche é
   * `renderQuoteDocument`, cujo único chamador é `renderUnsignedQuoteDocument`;
   * o caminho que CONGELA bytes (`createEnvelope` → `renderer.renderAll`) nunca
   * passa por lá. É deliberado: carimbar um documento já selado mudaria bytes
   * assinados, e um contrato assinado não deixa de ter sido assinado porque a
   * proposta que o originou foi cancelada depois.
   */
  voidLabel?: string | null;

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
  // Sem recorte declarado, o documento é o inteiro. Ver `QuoteHtmlInput.sections`.
  const sections = data.sections ?? FULL_SECTIONS;
  const showServices = hasSection(sections, 'SERVICES');
  const showPricing = hasSection(sections, 'PRICING');
  const showDelivery = hasSection(sections, 'DELIVERY');
  const showPayment = hasSection(sections, 'PAYMENT');
  const showGuarantee = hasSection(sections, 'GUARANTEE');
  const showLayout = hasSection(sections, 'LAYOUT');

  // Quantos veículos este orçamento cobre. É o "× N" do bloco de totais e o que
  // decide entre "no veículo" e "nos veículos" na frase de abertura.
  const vehicleCount = (data.vehicles ?? []).length;

  // Numeração 1., 2., 3.… e descrição em Title Case com a observação na mesma
  // linha — as três coisas do gerador de referência
  // (`web/src/utils/budget-pdf-generator.ts:530-551`) que faltavam aqui. Sem o
  // número, o cliente não tem como apontar "o item 4" ao contestar; e a
  // observação numa sub-linha cinza fazia o mesmo serviço parecer dois.
  //
  // A COLUNA DE VALOR SEGUE `PRICING`, e não `SERVICES`. Os dois são recortes
  // independentes de propósito: o gestor de frota precisa saber o que será feito
  // no implemento sem que o preço da obra saia do círculo que precisa dele, e
  // esse é exatamente o par que um documento único não conseguia entregar. Sem
  // valor a linha ocupa a largura toda — deixar a coluna vazia desenharia um
  // campo em branco, que se lê como preço a combinar.
  const servicesHtml = data.services
    .map(
      (s, index) => `
      <div class="service-row">
        <div class="service-desc${showPricing ? '' : ' service-desc-full'}"><span class="service-index">${index + 1}</span> - ${escapeHtml(
          serviceLineText(s),
        )}</div>
        ${showPricing ? `<div class="service-amount">${formatCurrencyBRL(s.amount)}</div>` : ''}
      </div>`,
    )
    .join('');

  const discountLabel = composeDiscountLabel({
    percent: data.discountPercent ?? null,
    reference: data.discountReference ?? null,
    legacy: data.discountLabel,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TOTAIS — o valor unitário, o "× N" e o total geral
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // `data.subtotal`, `data.discountAmount` e `data.total` são POR VEÍCULO, e a
  // lista de serviços acima também. Num orçamento de um veículo — a esmagadora
  // maioria — nada disso aparece: os rótulos continuam "Subtotal" e "Total", não
  // há linha de multiplicação e o documento sai byte a byte como saía.
  //
  // A partir de dois, os rótulos ganham "por veículo" e o bloco fecha com a
  // multiplicação explícita. A alternativa — só o total geral — obrigaria o
  // cliente a dividir R$ 730.224,00 por sessenta para conferir se o preço
  // combinado por caminhão é o que ele aceitou, que é a única conta que ele de
  // fato quer fazer.
  //
  // O total geral é `total × N` e NÃO um desconto recalculado sobre a soma: é
  // essa a conta que a fatura e o boleto fazem (`recalcQuoteTotals`), e um
  // documento que arredondasse diferente divergiria da cobrança em centavos.
  const multi = vehicleCount > 1;
  const grandTotal = Math.round(data.total * vehicleCount * 100) / 100;

  const totalsHtml = !showPricing
    ? ''
    : `
    <div class="totals">
      ${
        data.discountAmount > 0
          ? `<div class="total-row">
               <span class="total-label">Subtotal${multi ? ' por veículo' : ''}</span>
               <span class="total-value">${formatCurrencyBRL(data.subtotal)}</span>
             </div>
             <div class="total-row total-row-discount">
               <span class="total-label">${escapeHtml(discountLabel)}</span>
               <span class="total-value">- ${formatCurrencyBRL(data.discountAmount)}</span>
             </div>`
          : ''
      }
      <div class="total-row${multi ? ' total-row-unit' : ' total-row-final'}">
        <span class="total-label">Total${multi ? ' por veículo' : ''}</span>
        <span class="total-value">${formatCurrencyBRL(data.total)}</span>
      </div>
      ${
        multi
          ? `<div class="total-row total-row-multiplier">
               <span class="total-label">Veículos</span>
               <span class="total-value">&times; ${vehicleCount}</span>
             </div>
             <div class="total-row total-row-final">
               <span class="total-label">Total geral</span>
               <span class="total-value">${formatCurrencyBRL(grandTotal)}</span>
             </div>`
          : ''
      }
    </div>`;

  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTIFICAÇÃO DO VEÍCULO — tabela, não prosa
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // A frase de abertura terminava enumerando o veículo dentro dela mesma:
  // "…para execução dos serviços abaixo discriminados no veículo nº série:
  // 39239, placa: a registrar, chassi: 953677TGXTR031467, categoria: Truck,
  // implemento: Refrigerado."
  //
  // Isso deixou de funcionar por dois motivos, e o segundo já valia antes do
  // primeiro:
  //
  //   1. Um orçamento pode cobrir SESSENTA veículos. A prosa viraria um
  //      parágrafo de vinte linhas em que ninguém acha nada.
  //   2. Mesmo com um veículo só, o que o leitor FAZ com esses campos é
  //      conferi-los um a um contra o documento do caminhão. Em prosa, as
  //      lacunas "a registrar" caem em posições diferentes a cada orçamento e o
  //      olho precisa varrer a frase para achar o chassi. Em coluna, ele desce.
  //
  // A frase agora termina em "nos veículos:" e a tabela responde.
  const vehicles = data.vehicles ?? [];
  const anyCategory = vehicles.some(v => !!truckCategoryLabel(v.categoryLabel));
  const anyImplement = vehicles.some(v => !!implementTypeLabel(v.implementLabel));

  // Só se fala do veículo quando existe veículo. Sem isto, um orçamento sem
  // caminhão nenhum ganharia uma tabela de lacunas a preencher e uma frase sobre
  // um objeto que não existe.
  //
  // A tabela NÃO é recortável: ela é o endereço do serviço, e um documento que
  // não diz de que trabalho fala não significa nada para quem o recebe — foi o
  // que aconteceu com o primeiro recorte de marketing, que chegou com a arte e
  // sem a série. Por isso ela sai em qualquer recorte, e por isso as LACUNAS de
  // cadastro tardio são medidas em todos: a placa que chega depois pode ser
  // carimbada em qualquer um deles.
  const hasVehicle = vehicles.length > 0;

  // Série, placa e chassi saem SEMPRE — com valor, ou com o espaço reservado
  // para ele. Ver `.late-slot` no CSS: é o que permite carimbar o dado que chega
  // semanas depois sem re-renderizar o documento congelado.
  //
  // Categoria e implemento só ganham coluna se ALGUM veículo os tiver: são
  // classificação, não identidade, e uma coluna inteira de travessões não
  // informa nada. Também não ganham lacuna, porque já estão preenchidos na
  // emissão — o que chega depois é identidade, não classificação.
  //
  // O PEDIDO DE COMPRA sai SEMPRE, com os de identidade, e não com a
  // classificação. Ele é por VEÍCULO — dois caminhões do mesmo orçamento podem
  // ter vindo em pedidos diferentes —, e é por isso que deixou de ser uma linha
  // do quadro do tomador, onde só cabia um número. Sair só quando já está
  // preenchido escondia justamente a coluna que o cliente precisa conferir: o
  // número costuma chegar DEPOIS da emissão, e uma coluna que aparece e
  // desaparece entre duas leituras do mesmo orçamento não se confere.
  const vehicleColumns: Array<{ key: string; label: string }> = [
    { key: 'serialNumber', label: 'Nº de série' },
    { key: 'plate', label: 'Placa' },
    { key: 'chassis', label: 'Chassi' },
    { key: 'orderNumber', label: 'Nº do pedido' },
    ...(anyCategory ? [{ key: 'category', label: 'Categoria' }] : []),
    ...(anyImplement ? [{ key: 'implement', label: 'Implemento' }] : []),
  ];

  const vehicleCell = (v: QuoteHtmlVehicle, column: string): string => {
    switch (column) {
      case 'serialNumber':
        return v.serialNumber
          ? vehicleValueHtml(v.serialNumber)
          : lateSlotHtml('serialNumber', v.taskId);
      case 'plate':
        return v.plate ? vehicleValueHtml(v.plate) : lateSlotHtml('plate', v.taskId);
      case 'chassis':
        return v.chassisNumber
          ? vehicleValueHtml(v.chassisNumber)
          : lateSlotHtml('chassis', v.taskId);
      case 'orderNumber':
        // LACUNA, e não travessão: o número do pedido é identidade do veículo e
        // quase sempre chega DEPOIS da emissão — é o caso do chassi, com outro
        // campo. O travessão dizia "não há"; "a registrar" diz "ainda não
        // chegou", que é a verdade, e reserva o espaço para carimbá-lo sem
        // re-renderizar o documento congelado.
        return (v.orderNumber ?? '').trim()
          ? vehicleValueHtml(v.orderNumber!.trim())
          : lateSlotHtml('orderNumber', v.taskId);
      case 'category':
        return truckCategoryLabel(v.categoryLabel)
          ? vehicleValueHtml(truckCategoryLabel(v.categoryLabel)!)
          : '<span class="vehicle-empty">&mdash;</span>';
      case 'implement':
        return implementTypeLabel(v.implementLabel)
          ? vehicleValueHtml(implementTypeLabel(v.implementLabel)!)
          : '<span class="vehicle-empty">&mdash;</span>';
      default:
        return '';
    }
  };

  // A coluna "#" só aparece a partir de dois veículos. Com um só ela numeraria
  // uma linha, o que é ruído; com sessenta ela é o que permite dizer "o veículo
  // 37" ao telefone.
  const showVehicleIndex = vehicles.length > 1;

  const vehicleTableHtml = !hasVehicle
    ? ''
    : `<table class="vehicle-table">
         <thead>
           <tr>
             ${showVehicleIndex ? '<th class="vehicle-idx">#</th>' : ''}
             ${vehicleColumns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}
           </tr>
         </thead>
         <tbody>
           ${vehicles
             .map(
               (v, i) => `<tr>
             ${showVehicleIndex ? `<td class="vehicle-idx">${i + 1}</td>` : ''}
             ${vehicleColumns.map(c => `<td>${vehicleCell(v, c.key)}</td>`).join('')}
           </tr>`,
             )
             .join('')}
         </tbody>
       </table>`;

  // A frase de abertura só ANUNCIA a tabela; quem identifica é ela.
  const vehicleText = hasVehicle
    ? vehicles.length > 1
      ? ' nos veículos abaixo relacionados'
      : ' no veículo abaixo identificado'
    : '';

  const companyIntro =
    data.corporateName && data.corporateName !== 'Cliente'
      ? ` para a <strong>${escapeHtml(data.corporateName)}</strong>${
          data.customerDocumentFormatted ? ` (${escapeHtml(data.customerDocumentFormatted)})` : ''
        },`
      : '';

  // ═══════════════════════════════════════════════════════════════════════════
  // O QUADRO DO TOMADOR
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // A seção "Condições de pagamento" passou a se chamar "Faturamento" e abre com
  // este quadro. A frase das parcelas NÃO saiu — ela é o acordo de pagamento, e
  // um instrumento que o cliente assina sem ela deixa de dizer quanto e quando
  // se paga. O que mudou é o que vem ANTES dela.
  //
  // Por que o cadastro entra num documento de assinatura: a NFS-e é emitida na
  // Elotech com a razão social, o CNPJ, as inscrições e o endereço exatos do
  // cadastro, e um dado errado só se descobre depois da nota autorizada — quando
  // consertar significa cancelar e substituir, com o fiscal da prefeitura no
  // meio (ver `supersedePreviousNfses`). O cliente é quem sabe o próprio
  // cadastro. Pôr o quadro aqui faz a conferência acontecer na aprovação, que é
  // o único momento em que ela é barata.
  //
  // Campo vazio sai como travessão em vez de sumir: a linha ausente esconderia
  // exatamente o buraco que o quadro existe para expor.
  //
  // CADA LINHA PODE TER DOIS PARES. Razão social, endereço e município são
  // longos e ocupam a largura; as duas inscrições são curtas e ficavam com
  // dois terços da folha em branco à direita de cada uma — duas linhas onde
  // cabia uma, num documento que agora pode ter quatro seções e sessenta
  // veículos disputando a mesma folha.
  //
  // O NÚMERO DO PEDIDO saiu daqui: virou coluna da tabela de veículos, porque
  // ele identifica a ENTREGA e um orçamento de quatro caminhões pode ter quatro
  // pedidos diferentes — que numa linha só não cabem.
  const joinBillingAddress = (a: string | null, b: string | null): string | null => {
    const parts = [a, b].map(p => (p ?? '').trim()).filter(Boolean);
    return parts.length > 0 ? parts.join(' — ') : null;
  };
  const billingRows: Array<Array<[string, string | null]>> = data.billing
    ? [
        [['Razão social', data.billing.corporateName]],
        [['CNPJ / CPF', data.billing.documentFormatted]],
        [
          ['Inscrição estadual', data.billing.stateRegistration],
          ['Inscrição municipal', data.billing.municipalRegistration],
        ],
        // ENDEREÇO NUMA LINHA SÓ. Eram duas — logradouro e depois "Município"
        // com bairro, cidade/UF e CEP —, e nenhuma das duas enchia a largura: o
        // quadro gastava dois renques para dizer um endereço.
        [['Endereço', joinBillingAddress(data.billing.addressLine, data.billing.addressLocality)]],
      ]
    : [];

  const billingCellHtml = ([label, value]: [string, string | null], span: number): string =>
    `<th>${escapeHtml(label)}</th>
     <td${span > 1 ? ` colspan="${span}"` : ''}>${
       value ? escapeHtml(value) : '<span class="billing-empty">&mdash;</span>'
     }</td>`;

  const billingRowsHtml = billingRows
    .map(
      pairs =>
        `<tr>${pairs
          .map(pair => billingCellHtml(pair, pairs.length === 1 ? 3 : 1))
          .join('')}</tr>`,
    )
    .join('');

  // ─────────────────────────────────────────────────────────────────────────
  // AS PARCELAS E A CHAVE PIX
  //
  // Sai só quando `paymentSchedule` vem preenchido, e só o corpo legível do
  // dossiê o preenche. Ver `QuoteHtmlInput.paymentSchedule` para por que isto
  // nunca entra no PDF selado.
  // ─────────────────────────────────────────────────────────────────────────
  const scheduleBlocks = (data.paymentSchedule ?? []).filter(b => b.installments.length > 0);

  const scheduleRowsHtml = (block: QuoteHtmlPaymentSchedule): string => {
    const total = block.installments.length;
    return block.installments
      .map(
        inst => `<tr>
             <td>Parcela ${inst.number}/${total} – vencimento em ${escapeHtml(inst.dueDate)}${
               inst.paid ? ' <span class="schedule-paid">· paga</span>' : ''
             }</td>
             <td class="schedule-amount">${escapeHtml(inst.amount)}</td>
           </tr>`,
      )
      .join('');
  };

  const scheduleHtml = scheduleBlocks
    .map(
      block => `<div class="schedule">
           ${block.label ? `<div class="schedule-label">${escapeHtml(block.label)}</div>` : ''}
           <table class="schedule-table">${scheduleRowsHtml(block)}</table>
         </div>`,
    )
    .join('');

  // UMA CAIXA POR CONTA, não uma por cobrança: com vinte lotes pagos na mesma
  // chave, vinte caixas idênticas seriam ruído. Deduplica pela chave.
  const pixAccounts = scheduleBlocks
    .map(b => b.pix)
    .filter((p): p is NonNullable<QuoteHtmlPaymentSchedule['pix']> => !!p)
    .filter((p, i, all) => all.findIndex(o => o.key === p.key) === i);

  const pixHtml = pixAccounts.length
    ? `<div class="pix-box">
         <div class="pix-title">Pagamento via Pix</div>
         ${pixAccounts
           .map(
             p => `<div class="pix-line">
                  <strong>Chave Pix (${escapeHtml(p.keyKind)}):</strong> <span class="pix-key">${escapeHtml(p.key)}</span><br />
                  <strong>Favorecido:</strong> ${escapeHtml(p.holder)}
                </div>`,
           )
           .join('')}
         <div class="pix-note">
           Ao pagar, informe o orçamento Nº ${data.budgetNumber} na descrição e encaminhe o
           comprovante para o ${escapeHtml(BILLING_CONTACT.role)} – ${escapeHtml(BILLING_CONTACT.name)},
           <a href="${whatsappLinkFor(BILLING_CONTACT.phoneClean)}">${escapeHtml(BILLING_CONTACT.phone)}</a>.
         </div>
       </div>`
    : '';

  // A TARJA, quando o documento não vale mais. Uma folha de um orçamento
  // cancelado saía IDÊNTICA à de um vivo — e o link público é o UUID do
  // orçamento, que circula. Medido em 17/09/2026: 76 orçamentos cancelados e 74
  // pendentes fora da validade servem o documento por este caminho.
  const voidStampHtml = data.voidLabel
    ? `<div class="void-stamp${data.voidLabel.length > 10 ? ' is-long' : ''}">${escapeHtml(
        data.voidLabel,
      )}</div>`
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
  const layoutHtml = showLayout && data.layoutImages.length
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
  //
  // Por FOLHA, e nao pelo total: quando o bloco se parte, a ultima folha pode
  // levar dois signatarios, e espremer esses dois em 3 colunas seria encolher a
  // caixa sem nenhuma folha a ganhar com isso.
  const gridClassFor = (signers: QuoteHtmlSignerSlot[]) =>
    signers.length > 3 ? 'signature-grid cols-3' : 'signature-grid';

  // `layoutInContent` sai no corpo por dois caminhos: na folha fundida (onde o
  // corpo E a folha de assinaturas) e quando o renderizador mediu que a arte nao
  // fica conferivel na folha de assinaturas. Ver `QuoteHtmlInput.layoutInContent`.
  const layoutInContent =
    part === 'fused' || (part === 'content' && data.layoutInContent) ? layoutHtml : '';
  const layoutInSignatures =
    part === 'signatures' && !data.layoutInContent ? layoutHtml : '';

  const signersHtmlFor = (signers: QuoteHtmlSignerSlot[]) =>
    signers
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

  // Uma folha por grupo. Sem `signerPages` é o comportamento de sempre: um
  // grupo com todo mundo, uma folha só.
  const signerSheets: QuoteHtmlSignerSlot[][] =
    data.signerPages?.length ? data.signerPages : [data.signers];

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

  /* ── TABELA DE IDENTIFICACAO DOS VEICULOS ─────────────────────────────────
     Levemente menor que o corpo (8.5pt contra 9pt): a tabela e referencia, nao
     leitura corrida, e com sessenta linhas cada decimo de ponto e uma folha.
     border-collapse para que as reguas horizontais sejam UMA linha e nao duas
     encostadas. */
  .vehicle-table {
    width: 100%; border-collapse: collapse; margin-top: 2.5mm;
    font-size: 8.5pt; line-height: 1.35;
  }
  .vehicle-table th, .vehicle-table td {
    text-align: left; padding: 1.1mm 2mm 1.1mm 0; vertical-align: baseline;
  }
  /* Cabecalho em verde e caixa alta pequena: distingue do dado sem pesar como
     um titulo de secao, que ele nao e. */
  .vehicle-table thead th {
    font-size: 7pt; font-weight: 700; color: var(--green);
    text-transform: uppercase; letter-spacing: .04em;
    border-bottom: 1px solid var(--green); padding-bottom: 1mm;
  }
  .vehicle-table tbody tr { border-bottom: .5px dotted #ccc; }
  .vehicle-table tbody tr:last-child { border-bottom: none; }
  /* A coluna do indice e estreita e nao compete com o dado. tabular-nums para
     que 9 e 10 nao desalinhem a coluna seguinte num orcamento de sessenta. */
  .vehicle-table .vehicle-idx {
    width: 7mm; color: var(--gray); font-variant-numeric: tabular-nums;
    padding-right: 1mm;
  }
  .vehicle-empty { color: var(--gray); }
  /* Uma linha de veiculo nunca se parte entre folhas: metade do chassi no pe de
     uma pagina e metade no topo da outra e ilegivel justamente no campo que o
     leitor esta conferindo caractere a caractere. E o cabecalho se repete em
     toda folha, senao a partir da segunda a tabela vira uma grade de numeros sem
     nome de coluna. */
  .vehicle-table tr { break-inside: avoid; }
  .vehicle-table thead { display: table-header-group; }
  /* A frase "nos veiculos abaixo relacionados:" e a tabela que ela anuncia nao
     se separam: a promessa numa folha e a lista na seguinte deixa o leitor
     procurando o que ja passou. */
  .intro-text { break-after: avoid; }
  /* Com poucos veiculos o bloco inteiro fica junto; com muitos ele PAGINA (e o
     cabecalho da tabela se repete, via table-header-group), porque prende-lo
     custaria uma folha em branco.
     SEM CRASE neste comentario: ele vive dentro de um template literal. */
  .customer-section { break-inside: auto; }

  /* ── QUADRO DO TOMADOR (secao Faturamento) ────────────────────────────────
     Rotulo a esquerda em largura fixa para que os valores alinhem numa coluna
     so — e o alinhamento que torna o quadro conferivel de relance. */
  .billing-table {
    width: 100%; border-collapse: collapse; font-size: 8.5pt; line-height: 1.4;
    margin-bottom: 2.5mm;
    /* O quadro do tomador e conferido linha a linha contra o cadastro da
       prefeitura: parti-lo entre duas folhas e o que faz alguem conferir metade. */
    break-inside: avoid;
  }
  .billing-table th {
    text-align: left; font-weight: 600; color: var(--gray);
    width: 32mm; padding: .8mm 3mm .8mm 0; vertical-align: baseline;
    white-space: nowrap;
  }
  /* O SEGUNDO par de uma linha ganha respiro à esquerda: sem ele o valor da
     inscricao estadual encosta no rotulo da municipal e os dois leem como um
     texto so. */
  .billing-table th + td + th { padding-left: 6mm; }
  .billing-table td { padding: .8mm 0; vertical-align: baseline; }
  .billing-empty { color: var(--gray); }
  /* Um filete separa o quadro da frase das parcelas: sao duas coisas de natureza
     diferente na mesma secao — cadastro a conferir e acordo a cumprir. */
  .terms-content-after-table {
    border-top: .5px solid #ddd; padding-top: 2mm;
  }

  /* AS PARCELAS EMITIDAS. A frase acima diz o ACORDO ("quatro parcelas de
     R$ 5.374,60"); esta tabela diz a DIVIDA ("1/4 vence em 21/09"). Com boleto o
     cliente tinha as datas nos boletos anexados; com Pix nao ha anexo nenhum, e
     o dossie saia sem uma unica data. */
  .schedule { margin-top: 3mm; }
  .schedule-label {
    font-size: 8.5pt; font-weight: 600; color: var(--gray);
    margin-bottom: 1.2mm;
    /* O rotulo do lote nao fica sozinho no pe da folha. */
    break-after: avoid;
  }
  /* A TABELA PODE PARTIR; a LINHA, nao.
     Evitar quebra na tabela inteira era o erro de escala: com quatro parcelas
     ele empurra a secao toda para a folha seguinte, e com sessenta veiculos
     seria impossivel de satisfazer. O que nao pode partir e a LINHA — uma
     parcela com o vencimento numa folha e o valor na outra.
     (Sem crase neste comentario: ele mora num template literal.) */
  .schedule-table {
    width: 100%; border-collapse: collapse;
    font-size: 9pt; line-height: 1.45;
  }
  .schedule-table tr { break-inside: avoid; }
  .schedule-table td { padding: 1.1mm 0; border-bottom: .5px dotted #ccc; }
  .schedule-table td.schedule-amount {
    text-align: right; font-weight: 600; white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .schedule-paid { color: var(--green); font-size: 8pt; font-weight: 600; }

  /* PARA ONDE PAGAR. Sai so quando a forma e Pix: ao lado de um boleto, uma
     chave Pix convida ao pagamento em duplicidade. */
  /* A caixa do Pix e ATOMICA: chave, favorecido e a instrucao do comprovante
     sao uma coisa so, e sao quatro linhas — cabem em qualquer sobra. */
  .pix-box {
    margin-top: 3mm; padding-top: 2mm; border-top: .5px solid #ddd;
    break-inside: avoid;
  }
  .pix-title {
    font-size: 9.5pt; font-weight: 700; color: var(--green); margin-bottom: 1.2mm;
  }
  .pix-line { font-size: 9pt; line-height: 1.5; }
  .pix-line strong { font-weight: 600; }
  .pix-note { font-size: 8.5pt; line-height: 1.5; margin-top: 1.5mm; }
  /* O numero do Faturamento e um LINK de verdade: a ancora sobrevive ao
     printToPDF do Chrome, entao o cliente toca nele e cai na conversa. Sem
     sublinhado e na cor do texto — o documento nao e uma pagina web.
     (E sem CRASE neste comentario: ele mora dentro de um template literal, e uma
     crase aqui fecha a string com um erro a centenas de linhas daqui.) */
  /* O NUMERO NAO PARTE NO MEIO. Sem isto o dossie 0915 saiu com "+55 43 9" no
     fim de uma linha e "8834-9545." no comeco da seguinte — um telefone partido
     nao se le como telefone, e este e clicavel. */
  .pix-note a {
    color: inherit; text-decoration: none; font-weight: 600;
    white-space: nowrap;
  }
  /* Chave e favorecido tambem sao indivisiveis: sao os dois dados que o pagador
     copia para o aplicativo do banco. */
  .pix-line strong + * , .pix-key { white-space: nowrap; }

  /* Sem regua sob o titulo: a unica divisoria horizontal do documento e a do
     cabecalho (e a do rodape, que a espelha). Titulos de secao se distinguem
     pelo peso e pela cor. */
  /* Titulo NUNCA fica sozinho no pe de uma folha: "Servicos" no fim de uma
     pagina com a lista comecando na seguinte e um defeito de leitura que so
     aparece quando o orcamento cresce — e ele cresceu (sessenta veiculos
     ocupam quatro folhas). O break-after abaixo prende o titulo ao que ele
     anuncia. */
  .section-title-green {
    font-size: 11pt; font-weight: 700; color: var(--green);
    margin-bottom: 2.5mm;
    break-after: avoid;
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
  /* Com mais de um veiculo o "Total por veiculo" e um degrau, nao o desfecho:
     leva um filete cinza fino e peso 600, contra o verde grosso e 700 do total
     geral. Sem essa hierarquia os dois numeros liam como concorrentes e o
     cliente conferia o errado. */
  .total-row-unit {
    border-top: .8px solid #bbb; margin-top: 1mm; padding-top: 1.5mm;
    font-weight: 600;
  }
  /* O multiplicador nao e dinheiro e nao deve parecer dinheiro: cinza, sem
     destaque. tabular-nums porque ele fica na mesma coluna dos valores. */
  .total-row-multiplier .total-value {
    color: var(--gray); font-variant-numeric: tabular-nums;
  }
  .total-row-multiplier .total-label { color: var(--gray); }

  /* Sem coluna de valor, a descricao ocupa a largura toda. Ver servicesHtml. */
  .service-desc-full { flex: 1 1 100%; padding-right: 0; }

  /* Titulo e corpo do bloco andam juntos: "Condicoes de pagamento" orfao no pe
     de uma folha, com o texto na seguinte, e um defeito de leitura num
     documento contratual. */
  .terms-section { break-inside: avoid; }
  /* (*) A SECAO DE FATURAMENTO FLUI, e as outras nao.
     Evitar quebra foi escrito para um bloco de tres linhas ("Garantias",
     "Prazo de entrega"), onde manter tudo junto custa nada. A secao Faturamento
     deixou de ser desse tamanho: quadro do tomador + clausula + tabela de
     parcelas + caixa do Pix passam de vinte linhas, e evitar a quebra fazia o
     conjunto inteiro PULAR para a folha seguinte quando nao cabia no que
     restava — deixando dois tercos da folha anterior em branco. Foi o corte
     incoerente que o dono viu no dossie 0915.
     Deixar fluir sem mais nada seria trocar um defeito por outro (tabela partida
     no meio de uma linha, "Favorecido" orfao). Entao a secao flui e os ATOMOS
     abaixo e que sao indivisiveis: o que precisa ser lido junto continua junto,
     o resto acompanha a folha. */
  .terms-section--flow { break-inside: auto; }
  .terms-title {
    font-size: 10pt; font-weight: 700; color: var(--green); margin-bottom: 1mm;
    break-after: avoid;
  }
  /* Duas linhas minimas de cada lado de uma quebra: uma linha solta no pe ou no
     topo de uma folha e o que faz um paragrafo contratual parecer truncado. */
  .terms-content {
    font-size: 9pt; line-height: 1.5; text-align: justify;
    orphans: 2; widows: 2;
  }

  /* Duas cláusulas de pagamento só existem quando o cliente paga em LOTES (uma
     frase por fatura). O seletor irmão garante que o documento de uma fatura
     só — o acervo inteiro — não muda um pixel. */
  .terms-content + .terms-content { margin-top: 2mm; }

  .acceptance-clause {
    margin-top: 6mm; font-size: 7pt; line-height: 1.45; color: var(--gray);
    border-top: .5px solid #ddd; padding-top: 2mm; text-align: justify;
    break-inside: avoid;
  }
  /* Empurra o rodapé para o fim da folha quando o conteúdo é curto, e deixa que
     ele simplesmente siga o conteúdo quando o orçamento pagina. */
  .footer-spacer { flex: 1 1 auto; min-height: 4mm; }

  .layout-section { margin-bottom: 6mm; }

  /* ATENCAO: este bloco de estilo mora DENTRO de um template literal. Crase aqui
     encerra a string e quebra o arquivo com um erro de sintaxe a dezenas de
     linhas de distancia. Sem crase em comentario de CSS. (Ja mordeu duas vezes.)

     Folha FUNDIDA com arte: a sobra vertical vai para a IMAGEM, nao para os vaos.
     E a mesma regra que a folha de assinaturas ja aplicava, e faltava aqui. Sem
     ela um recorte curto (texto basico + arte + assinaturas) saia com tres
     buracos verticais: os .page-content-gap crescem ate 2,2x o --block-gap e
     ficavam com a sobra toda, enquanto a arte — que e o que o cliente esta
     aprovando — permanecia presa no teto de --layout-max-h.
     flex-grow alto: a arte compete com os vaos pela sobra e leva a maior parte. */
  .page-content.has-layout .layout-section {
    flex: 8 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    margin-bottom: 0;
  }
  .page-content.has-layout .layout-grid { flex: 1 1 auto; min-height: 0; }
  /* O TETO POR IMAGEM (--layout-max-h) NAO e removido aqui, e a diferenca foi
     medida: sem ele, DUAS artes crescem cada uma ate a altura do bloco e a folha
     estoura — o recorte do marketing com 2 artes voltava a paginar, que e
     exatamente o caso que o caminho fundido existe para resolver. A secao cresce
     para recolher a sobra; a imagem, nao. */
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
    flex: 1 1 auto; min-height: 0; justify-content: flex-start; overflow: hidden;
  }
  /* Sem o teto de --layout-max-h aqui: quem limita e o espaco que sobra depois do
     cabecalho, do bloco de assinaturas e do rodape.

     ESSE ESPACO E DIVIDIDO, nao oferecido a cada imagem. max-height:100% dava a
     CADA arte a altura inteira da grade, e como a grade empilha em coluna, N
     artes somavam N vezes o espaco disponivel: a folha transbordava, o detector
     acusava, e o laco de sacrificio nao tinha o que sacrificar — ele encolhe
     --layout-max-h, que este seletor sobrescrevia. O envio entao morria num
     BadRequest culpando o numero de signatarios, que nao tinha nada com isso.
     (Reproduzido: 2 artes e 4 signatarios, recorte completo.)

     flex 1 1 0 reparte a sobra em partes iguais e nunca ultrapassa a grade —
     e o comportamento com UMA arte, que e o caso normal, continua identico: uma
     parte de um e a sobra inteira. object-fit:contain preserva a proporcao
     dentro da caixa que o flex arbitrou.

     E a mesma licao ja anotada em .page-content.has-layout .layout-grid logo
     acima, que aqui faltava aplicar. */
  .signatures-content.has-layout .layout-image {
    flex: 1 1 0;
    min-height: 0;
    max-height: none;
    width: 100%;
  }

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
  /* A TARJA. Diagonal, atras do texto (z-index negativo nao funciona em todo
     motor de impressao, entao ela vem por cima com opacidade baixa e
     pointer-events nenhum). print-color-adjust obriga o Chromium a imprimir a
     cor em vez de descarta-la como "fundo". */
  .void-stamp {
    position: absolute;
    top: 45%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-24deg);
    font-size: 46pt;
    font-weight: 800;
    letter-spacing: 3pt;
    color: #c0392b;
    opacity: 0.16;
    white-space: nowrap;
    border: 3mm solid #c0392b;
    padding: 4mm 10mm;
    border-radius: 3mm;
    pointer-events: none;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* Rotulo longo ("FORA DE VALIDADE" tem 16 caracteres contra 9 de
     "CANCELADO") passaria da largura util e sairia cortado. */
  .void-stamp.is-long { font-size: 30pt; letter-spacing: 2pt; }
</style>
</head>
<body>

${part === 'content' || part === 'fused' ? `
<div class="page" id="page-1">
  ${voidStampHtml}
  ${headerBlock}
  <div class="page-content${layoutInContent ? ' has-layout' : ''}" id="page-1-content">
    <h1 class="document-title">ORÇAMENTO</h1>

    <div class="customer-section">
      ${data.contactName ? `<div class="customer-name">À ${escapeHtml(data.contactName)}</div>` : ''}
      <p class="intro-text">Conforme solicitado, apresentamos nossa proposta de preço${companyIntro} para execução dos serviços abaixo discriminados${vehicleText}${hasVehicle ? ':' : '.'}</p>
      ${vehicleTableHtml}
    </div>

    <div class="page-content-gap"></div>

    ${
      showServices
        ? `<section class="services-section">
      <h2 class="section-title-green">Serviços</h2>
      <div class="services-list">${servicesHtml}</div>
      ${totalsHtml}
    </section>`
        : // PREÇO SEM LISTA DE SERVIÇOS é combinação legítima e tem de sair como
          // bloco próprio: um recorte que mostra o total sem detalhar os itens é
          // o que se manda a quem aprova a despesa e não decide o escopo. Sem
          // este ramo o total desapareceria junto com a lista.
          showPricing
          ? `<section class="services-section">
      <h2 class="section-title-green">Valores</h2>
      ${totalsHtml}
    </section>`
          : ''
    }

    ${
      showDelivery && data.deliveryDays
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
      showGuarantee && data.guaranteeText
        ? `<div class="page-content-gap"></div>
           <section class="terms-section">
             <h2 class="terms-title">Garantias</h2>
             <p class="terms-content">${formatGuaranteeHtml(data.guaranteeText)}</p>
           </section>`
        : ''
    }

    ${
      showPayment && (data.paymentText || billingRowsHtml || scheduleHtml)
        ? `<div class="page-content-gap"></div>
           <section class="terms-section${scheduleHtml || pixHtml ? ' terms-section--flow' : ''}">
             <h2 class="terms-title">Faturamento</h2>
             ${
               billingRowsHtml
                 ? `<table class="billing-table">${billingRowsHtml}</table>`
                 : ''
             }
             ${
               data.paymentText
                 ? // UMA CLÁUSULA POR FATURA. O texto chega com uma linha por
                   // faturamento — é o cliente que paga em LOTES, com K planos de
                   // parcelas no mesmo orçamento, e enfiá-los num parágrafo só os
                   // faria correr emendados na justificação. Com uma linha (o
                   // acervo inteiro, `JOINT` e `PER_TASK`) o HTML é exatamente o
                   // de antes: um `<p>`, as mesmas classes.
                   data.paymentText
                     .split('\n')
                     .map(line => line.trim())
                     .filter(Boolean)
                     .map(
                       (line, i) =>
                         `<p class="terms-content${
                           billingRowsHtml && i === 0 ? ' terms-content-after-table' : ''
                         }">${escapeHtml(line)}</p>`,
                     )
                     .join('')
                 : ''
             }
             ${scheduleHtml}
             ${pixHtml}
           </section>`
        : ''
    }

    ${layoutInContent}

    ${
      part === 'fused'
        ? `<div class="page-content-gap"></div>
    <section class="signatures-section">
      <h2 class="signatures-title">Assinaturas</h2>
      <div class="${gridClassFor(data.signers)}">${signersHtmlFor(data.signers)}</div>
    </section>`
        : ''
    }
    <div class="footer-spacer"></div>
  </div>
  ${footerBlock}
</div>
` : signerSheets
      .map((sheet, index) => {
        // A arte sai na PRIMEIRA folha de assinaturas, e só nela: repeti-la em
        // cada folha faria o documento afirmar N artes onde há uma.
        const layoutHere = index === 0 ? layoutInSignatures : '';
        const suffix = index === 0 ? '' : `-${index + 1}`;
        // O par "2/3" existe para quem recebe o papel: sem ele, uma folha de
        // assinaturas solta não diz se é a única ou se falta gente adiante.
        const counter =
          signerSheets.length > 1 ? ` (folha ${index + 1} de ${signerSheets.length})` : '';
        return `
<div class="page-signatures" id="page-signatures${suffix}">
  ${voidStampHtml}
  ${headerBlock}
  <div class="signatures-content${layoutHere ? ' has-layout' : ''}" id="signatures-content${suffix}">
    ${layoutHere}
    <section class="signatures-section">
      <h2 class="signatures-title">Assinaturas${counter}</h2>
      <div class="${gridClassFor(sheet)}">${signersHtmlFor(sheet)}</div>
    </section>
  </div>
  ${footerBlock}
</div>`;
      })
      .join('\n')}

</body>
</html>`;
}
