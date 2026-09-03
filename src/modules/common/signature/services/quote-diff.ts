/**
 * O que mudou no orçamento, item a item — em linguagem de gente.
 *
 * POR QUE ISTO EXISTE
 * ------------------------------------------------------------------------
 * A invalidação por alteração material já funcionava (ver `QuoteSnapshotService`
 * e `onQuoteContentChanged`), mas o que sobrava dela era uma frase:
 *
 *     "Alteração em: valor total (12000.00 → 13500.00), serviços, desconto."
 *
 * "serviços" pode ser um preço que subiu, um item que entrou, um item que saiu ou
 * uma descrição reescrita — e nenhum dos quatro é a mesma conversa com o cliente.
 * O signatário que teve a assinatura anulada recebia esse texto por e-mail e o
 * operador via a mesma linha na tela; nenhum dos dois tinha como responder à única
 * pergunta que importa: **o que mudou, exatamente?**
 *
 * Este módulo transforma a comparação de dois snapshots numa LISTA ESTRUTURADA:
 * cada linha tem um assunto (o serviço, o responsável), um antes e um depois já
 * formatados em pt-BR, e a variação em dinheiro quando existe. É o mesmo dado que
 * alimenta a tela interna, a página pública do orçamento, a cerimônia de
 * assinatura e o e-mail de invalidação — uma fonte só, três superfícies.
 *
 * FORMATAÇÃO NO SERVIDOR, DE PROPÓSITO
 * ------------------------------------------------------------------------
 * `before`/`after` saem daqui prontos para exibir ("R$ 13.500,00", "3 anos",
 * "10% · Cliente fiel"). Quatro consumidores (web interno, web público, Flutter,
 * e-mail) formatando dinheiro e data cada um do seu jeito significa quatro
 * chances de o cliente ver um valor diferente do que o outro canal mostrou. O
 * único número cru que viaja é `amountDelta`, e ele existe só para a interface
 * escolher a cor e o sinal.
 *
 * SEVERIDADE ≠ ORDEM DE LEITURA
 * ------------------------------------------------------------------------
 * `severity` repete a regra que já decide invalidação (MATERIAL derruba
 * assinaturas, COSMETIC só registra). `group` decide a ORDEM em que a lista é
 * lida: serviços primeiro, depois totais, depois condições. É a ordem em que um
 * humano confere um orçamento, e é diferente da ordem em que o hash é calculado.
 */

import type {
  QuoteSnapshot,
  QuoteSnapshotSigner,
  QuoteSnapshotVehicle,
} from './quote-snapshot.service';
import { formatCurrencyBRL } from '../document/quote-text';
import { maskEmail, maskPhone, onlyDigits } from '../utils/identity';

// =============================================================================
// TIPOS — espelhados em web/src/api-client/signature.ts e no Dart
// =============================================================================

/** MATERIAL derruba assinaturas coletadas. COSMETIC apenas consta na trilha. */
export type QuoteChangeSeverity = 'MATERIAL' | 'COSMETIC';

export type QuoteChangeKind = 'ADDED' | 'REMOVED' | 'CHANGED';

/** Ordem de leitura da lista, não ordem de cálculo. */
export type QuoteChangeGroup =
  | 'SERVICES'
  | 'TOTALS'
  | 'PAYMENT'
  | 'GUARANTEE'
  | 'SCHEDULE'
  | 'VALIDITY'
  | 'LAYOUT'
  | 'PARTIES'
  | 'VEHICLE'
  | 'SIGNERS'
  | 'DOCUMENT';

export interface QuoteChange {
  /** Estável e único na lista — chave de renderização e de deduplicação. */
  key: string;
  severity: QuoteChangeSeverity;
  kind: QuoteChangeKind;
  group: QuoteChangeGroup;
  /** O campo. "Preço do serviço", "Valor total", "Responsável incluído". */
  label: string;
  /** A quem o campo pertence: o serviço, o responsável. Null em campos únicos. */
  subject: string | null;
  /** Já formatado para exibição. Null quando não havia valor. */
  before: string | null;
  after: string | null;
  /**
   * Variação em reais, com sinal. Presente APENAS onde a variação é dinheiro de
   * verdade — preço de serviço, subtotal, total, item incluído/removido. A
   * interface usa para colorir e para escrever "+R$ 1.500,00".
   */
  amountDelta?: number;
}

/** Peso de exibição de cada grupo. Menor vem antes. */
const GROUP_ORDER: Record<QuoteChangeGroup, number> = {
  SERVICES: 0,
  TOTALS: 1,
  PAYMENT: 2,
  GUARANTEE: 3,
  SCHEDULE: 4,
  VALIDITY: 5,
  LAYOUT: 6,
  PARTIES: 7,
  VEHICLE: 8,
  SIGNERS: 9,
  DOCUMENT: 10,
};

export const QUOTE_CHANGE_GROUP_LABELS: Record<QuoteChangeGroup, string> = {
  SERVICES: 'Serviços',
  TOTALS: 'Valores',
  PAYMENT: 'Pagamento',
  GUARANTEE: 'Garantia',
  SCHEDULE: 'Prazo',
  VALIDITY: 'Validade',
  LAYOUT: 'Layout',
  PARTIES: 'Contratante',
  VEHICLE: 'Veículo',
  SIGNERS: 'Responsáveis',
  DOCUMENT: 'Documento',
};

// =============================================================================
// NORMALIZAÇÃO
// =============================================================================

/**
 * Texto livre normalizado para COMPARAÇÃO — nunca para exibição.
 *
 * Espaço no fim de uma descrição de serviço, espaço duplo no meio, um \r\n que
 * virou \n: nada disso muda o que o cliente leu, mas todos mudam o sha256. Sem
 * isto, salvar o formulário sem editar nada podia invalidar a coleta.
 *
 * Mora aqui, e não no snapshot, porque o snapshot é quem importa esta função —
 * inverter a dependência é o que mantém `quote-diff` livre de qualquer import de
 * runtime vindo de `quote-snapshot.service` (lá o import é só de tipos).
 */
export function normText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length ? collapsed : null;
}

/**
 * Chave de pareamento de serviços: sem acento, sem caixa, sem pontuação solta.
 *
 * "Pintura do baú" e "PINTURA DO BAU" são o MESMO item com a grafia mexida — se
 * o pareamento fosse por igualdade exata, uma correção de acento apareceria como
 * "um serviço removido + um serviço incluído", que é a pior leitura possível de
 * uma alteração cosmética.
 */
function foldKey(value: string | null): string {
  return (normText(value) ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function money(value: string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function brl(value: string | null | undefined): string {
  return formatCurrencyBRL(money(value));
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function formatDocument(digits: string | null | undefined): string | null {
  const d = onlyDigits(digits);
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return d || null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Percentual sem casas decimais mortas: 10.00 → "10%", 7.50 → "7,5%".
 *
 * O snapshot guarda dinheiro como string de 2 casas para o hash ser estável, mas
 * "10,00%" na tela parece precisão que não existe.
 */
function formatPercent(value: string | null): string {
  const n = money(value);
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '').replace('.', ',');
  return `${text}%`;
}

function formatDiscount(d: QuoteSnapshot['discount']): string {
  const reference = normText(d.reference);
  if (d.type === 'NONE' || d.value === null) return reference ? `Sem desconto · ${reference}` : 'Sem desconto';
  const base = d.type === 'PERCENTAGE' ? formatPercent(d.value) : brl(d.value);
  return reference ? `${base} · ${reference}` : base;
}

// =============================================================================
// DIFF
// =============================================================================

interface SnapshotService {
  description: string;
  amount: string;
  observation: string | null;
  position: number;
}

interface ServicePair {
  before: SnapshotService;
  after: SnapshotService;
}

/** Palavras significativas de uma descrição. Preposições ficam de fora. */
function tokens(value: string): Set<string> {
  return new Set(
    foldKey(value)
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 2),
  );
}

/** Coeficiente de Dice sobre as palavras: 0 = nada em comum, 1 = idênticas. */
function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/**
 * Limiar de "é a mesma linha, reescrita".
 *
 * 1/3 das palavras em comum. "Pintura do baú" → "Pintura completa do baú" passa
 * (0,8); "Aplicação de faixas" → "Adesivagem da cabine" não passa (0), e é
 * exatamente o que deve acontecer: aquilo foi um item trocado por outro, não um
 * item renomeado.
 */
const SAME_LINE_THRESHOLD = 1 / 3;

/**
 * Pareia os serviços dos dois snapshots, da evidência mais forte para a mais
 * fraca.
 *
 * Não há id estável para ancorar: `TaskQuoteService.id` existe no banco, mas o
 * snapshot não o guarda de propósito (ids internos não são exibidos, e gravá-los
 * faria um `set()` do Prisma que recria as linhas parecer troca de conteúdo).
 * Então o pareamento é heurístico:
 *
 *   1. mesma descrição       → é o mesmo item; mudou preço e/ou observação;
 *   2. descrição parecida    → a linha foi reescrita (melhor par primeiro);
 *   3. mesmo preço E posição → renomeada por completo, mas no mesmo lugar e
 *                              pelo mesmo valor.
 *
 * O que não parear em nenhuma delas é genuinamente inclusão ou remoção — e essa
 * é a decisão que mais importa aqui. Um pareamento frouxo (por posição, ou
 * "o que sobrou na ordem") faz um serviço trocado por outro ser reportado como
 * "descrição alterada de X para Y" — uma frase que descreve mal o que houve e
 * esconde do cliente que um item saiu do orçamento e outro entrou.
 */
function pairServices(before: SnapshotService[], after: SnapshotService[]) {
  const pairs: ServicePair[] = [];
  const leftB = [...before];
  const leftA = [...after];

  const take = (bi: number, ai: number) => {
    pairs.push({ before: leftB[bi], after: leftA[ai] });
    leftB.splice(bi, 1);
    leftA.splice(ai, 1);
  };

  // 1 — descrição idêntica (ignorando acento, caixa e espaço).
  for (let i = 0; i < leftB.length; i++) {
    const j = leftA.findIndex(a => foldKey(a.description) === foldKey(leftB[i].description));
    if (j === -1) continue;
    take(i, j);
    i--;
  }

  // 2 — descrição parecida, do par mais parecido para o menos. Guloso pelo
  // MELHOR par (não pelo primeiro): com três linhas semelhantes, casar na ordem
  // de leitura embaralharia quem virou quem.
  for (;;) {
    let best = { score: SAME_LINE_THRESHOLD, bi: -1, ai: -1 };
    for (let i = 0; i < leftB.length; i++) {
      for (let j = 0; j < leftA.length; j++) {
        const score = similarity(leftB[i].description, leftA[j].description);
        if (score >= best.score) best = { score, bi: i, ai: j };
      }
    }
    if (best.bi === -1) break;
    take(best.bi, best.ai);
  }

  // 3 — mesmo valor E mesma posição.
  for (let i = 0; i < leftB.length; i++) {
    const j = leftA.findIndex(
      a => money(a.amount) === money(leftB[i].amount) && a.position === leftB[i].position,
    );
    if (j === -1) continue;
    take(i, j);
    i--;
  }

  return { pairs, removed: leftB, added: leftA };
}

function diffServices(before: QuoteSnapshot, after: QuoteSnapshot): QuoteChange[] {
  const { pairs, removed, added } = pairServices(before.services, after.services);
  const out: QuoteChange[] = [];

  removed.forEach((s, i) => {
    out.push({
      key: `service:removed:${i}:${foldKey(s.description)}`,
      severity: 'MATERIAL',
      kind: 'REMOVED',
      group: 'SERVICES',
      label: 'Serviço removido',
      subject: normText(s.description),
      before: brl(s.amount),
      after: null,
      amountDelta: -money(s.amount),
    });
  });

  added.forEach((s, i) => {
    out.push({
      key: `service:added:${i}:${foldKey(s.description)}`,
      severity: 'MATERIAL',
      kind: 'ADDED',
      group: 'SERVICES',
      label: 'Serviço incluído',
      subject: normText(s.description),
      before: null,
      after: brl(s.amount),
      amountDelta: money(s.amount),
    });
  });

  pairs.forEach((p, i) => {
    const subject = normText(p.after.description);
    const id = foldKey(p.after.description) || String(i);

    if (money(p.before.amount) !== money(p.after.amount)) {
      out.push({
        key: `service:amount:${i}:${id}`,
        severity: 'MATERIAL',
        kind: 'CHANGED',
        group: 'SERVICES',
        label: 'Preço do serviço',
        subject,
        before: brl(p.before.amount),
        after: brl(p.after.amount),
        amountDelta: money(p.after.amount) - money(p.before.amount),
      });
    }

    if (foldKey(p.before.description) !== foldKey(p.after.description)) {
      out.push({
        key: `service:description:${i}:${id}`,
        severity: 'MATERIAL',
        kind: 'CHANGED',
        group: 'SERVICES',
        label: 'Descrição do serviço',
        subject,
        before: normText(p.before.description),
        after: normText(p.after.description),
      });
    }

    if (normText(p.before.observation) !== normText(p.after.observation)) {
      out.push({
        key: `service:observation:${i}:${id}`,
        severity: 'MATERIAL',
        kind: 'CHANGED',
        group: 'SERVICES',
        label: 'Observação do serviço',
        subject,
        before: normText(p.before.observation),
        after: normText(p.after.observation),
      });
    }
  });

  // Reordenação só é notícia quando NADA entrou nem saiu: incluir um serviço no
  // meio da lista empurra a posição de todos os seguintes, e reportar isso como
  // "a ordem mudou" enterraria a informação que interessa sob ruído mecânico.
  const reordered =
    !added.length && !removed.length && pairs.some(p => p.before.position !== p.after.position);
  if (reordered) {
    out.push({
      key: 'service:order',
      severity: 'MATERIAL',
      kind: 'CHANGED',
      group: 'SERVICES',
      label: 'Ordem dos serviços',
      subject: null,
      before: before.services.map(s => normText(s.description)).filter(Boolean).join(' · '),
      after: after.services.map(s => normText(s.description)).filter(Boolean).join(' · '),
    });
  }

  return out;
}

function signerMap(signers: QuoteSnapshotSigner[]) {
  return new Map(signers.map(s => [s.responsibleId, s]));
}

function diffSigners(
  before: QuoteSnapshot,
  after: QuoteSnapshot,
  options: QuoteDiffOptions = {},
): QuoteChange[] {
  const out: QuoteChange[] = [];
  const b = signerMap(before.signers);
  const a = signerMap(after.signers);

  /**
   * Uma mudança neste contato pode estragar uma assinatura AINDA NÃO COLHIDA?
   *
   * Sem a lista (chamador sem envelope em mãos) responde `true` para todo mundo,
   * que é o comportamento estrito de antes.
   */
  const pending = options.pendingSignerIds;
  const canStrand = (id: string): boolean => !pending || pending.includes(id);

  for (const [id, prev] of b) {
    const next = a.get(id);
    if (!next) {
      // Quem AINDA NÃO assinou deixa uma linha em branco que a coleta nunca vai
      // conseguir preencher: o envelope fica preso para sempre, e é por isso que
      // esse caso derruba. Quem já assinou não deixa buraco nenhum — o ato está
      // colhido e o documento é imutável.
      const strands = canStrand(id);
      out.push({
        key: `signer:removed:${id}`,
        severity: strands ? 'MATERIAL' : 'COSMETIC',
        kind: 'REMOVED',
        group: 'SIGNERS',
        label: 'Responsável removido',
        subject: normText(prev.name),
        before: strands ? 'Assinava o documento' : 'Já havia assinado',
        after: strands ? null : 'Saiu da tarefa; a assinatura dele continua valendo',
      });
      continue;
    }
    // O E-MAIL é o canal do código de assinatura. Trocá-lo no meio de uma coleta
    // redireciona a prova de autoria para outra caixa, então é MATERIAL — é o
    // mesmo critério que o recorte material v2 usa para derrubar o envelope.
    //
    // AUSÊNCIA NÃO É MUDANÇA. `emailNormalized` só passou a existir na v2 do
    // snapshot; todo envelope congelado antes disso não tem a chave. Ler o
    // `undefined` como "" e comparar com o endereço real relatava uma troca de
    // e-mail que nunca aconteceu — em TODOS os envelopes anteriores à migração
    // de canal, e bem no texto que explica ao cliente por que a assinatura dele
    // foi anulada. Só compara quando os dois lados de fato carregam o campo.
    const prevEmail = (prev.emailNormalized ?? '').trim().toLowerCase();
    const nextEmail = (next.emailNormalized ?? '').trim().toLowerCase();
    const bothHaveEmailField =
      prev.emailNormalized !== undefined && next.emailNormalized !== undefined;
    if (bothHaveEmailField && prevEmail !== nextEmail) {
      out.push({
        key: `signer:email:${id}`,
        // Só enquanto a assinatura DELE está pendente. Depois de colhida, o
        // contato do ato ficou congelado na evidência do signatário e corrigir o
        // cadastro não alcança mais nada.
        severity: canStrand(id) ? 'MATERIAL' : 'COSMETIC',
        kind: 'CHANGED',
        group: 'SIGNERS',
        label: 'E-mail do responsável',
        subject: normText(next.name),
        before: prevEmail ? maskEmail(prevEmail) : null,
        after: nextEmail ? maskEmail(nextEmail) : null,
      });
    }
    // O telefone deixou de ser o canal do OTP quando a cerimônia migrou para
    // e-mail. Continua sendo identidade do contato e sai impresso no selo, mas
    // corrigi-lo não pode mais custar uma assinatura já colhida — mantê-lo
    // MATERIAL derrubaria envelopes por uma correção de cadastro inócua.
    if (onlyDigits(prev.phoneDigits) !== onlyDigits(next.phoneDigits)) {
      out.push({
        key: `signer:phone:${id}`,
        severity: 'COSMETIC',
        kind: 'CHANGED',
        group: 'SIGNERS',
        label: 'Telefone do responsável',
        subject: normText(next.name),
        before: prev.phoneDigits ? maskPhone(prev.phoneDigits) : null,
        after: next.phoneDigits ? maskPhone(next.phoneDigits) : null,
      });
    }
    if (normText(prev.name) !== normText(next.name)) {
      out.push({
        key: `signer:name:${id}`,
        severity: 'COSMETIC',
        kind: 'CHANGED',
        group: 'SIGNERS',
        label: 'Nome do responsável',
        subject: normText(next.name),
        before: normText(prev.name),
        after: normText(next.name),
      });
    }
    if (prev.roles.join('|') !== next.roles.join('|')) {
      out.push({
        key: `signer:roles:${id}`,
        severity: 'COSMETIC',
        kind: 'CHANGED',
        group: 'SIGNERS',
        label: 'Função do responsável',
        subject: normText(next.name),
        before: prev.roles.join(', ') || null,
        after: next.roles.join(', ') || null,
      });
    }
  }

  for (const [id, next] of a) {
    if (b.has(id)) continue;
    // NUNCA MATERIAL, e "Passa a assinar o documento" era falso das duas formas.
    //
    // O documento foi congelado sem este contato: ele não tem linha de
    // assinatura nele, e nenhuma alteração de cadastro pode lhe dar uma. Em
    // coleta concluída então é ainda mais claro — o PDF está selado. Enquanto
    // isso, tratar a inclusão como material anulava as assinaturas JÁ COLHIDAS
    // de todo mundo por causa de um contato acrescentado à tarefa, que é o
    // oposto do que a inclusão significa.
    //
    // Quem precisa que ele assine reemite a coleta; o texto abaixo diz isso.
    const closed = !!options.pendingSignerIds && options.pendingSignerIds.length === 0;
    out.push({
      key: `signer:added:${id}`,
      severity: 'COSMETIC',
      kind: 'ADDED',
      group: 'SIGNERS',
      label: 'Responsável incluído',
      subject: normText(next.name),
      before: null,
      after: closed
        ? 'Entrou depois da coleta concluída; não assinou este documento'
        : 'Entrou depois da emissão; não assina esta coleta',
    });
  }

  return out;
}

/** Preenche o que um snapshot antigo pode não ter. Nunca muta a entrada. */
function withDefaults(s: QuoteSnapshot): QuoteSnapshot {
  return {
    ...s,
    services: Array.isArray(s?.services) ? s.services : [],
    signers: Array.isArray(s?.signers) ? s.signers : [],
    layoutFileIds: Array.isArray(s?.layoutFileIds) ? s.layoutFileIds : [],
    discount: s?.discount ?? { type: 'NONE', value: null, reference: null },
  };
}

/**
 * As diferenças de VEÍCULO, pareadas por tarefa.
 *
 * O QUE MUDOU E POR QUÊ
 *   Havia quatro comparações escalares (placa, chassi, categoria, implemento) e
 *   duas de tarefa (nome, número de série), todas sobre um veículo só. Um
 *   orçamento passou a poder cobrir sessenta, e com isso a comparação por
 *   posição deixou de servir: excluir o caminhão 12 desloca os quarenta e oito
 *   seguintes, e comparar por índice confrontaria a placa do 13 com a congelada
 *   do 12 — quarenta e oito "a placa mudou" em veículos que ninguém tocou, e a
 *   exclusão, que é a mudança real, invisível.
 *
 *   O pareamento é por `taskId`, que é imutável e existe nos dois lados (nos
 *   snapshots v1/v2 ele vem de `task.id`, por `snapshotVehicles`).
 *
 * GRAVIDADES
 *   · Veículo ACRESCENTADO ou REMOVIDO é MATERIAL. Não é uma questão de opinião:
 *     muda o total (o "× N" do documento) e muda o objeto do contrato. Quem
 *     assinou por três caminhões não assinou por quatro.
 *   · Nos veículos pareados as gravidades são as que sempre foram: placa
 *     material na TROCA e cosmética no preenchimento (cadastro tardio); chassi,
 *     categoria, implemento, nome e série cosméticos.
 *
 * O `subject` só é preenchido quando há mais de um veículo em jogo. Com um só,
 * "Placa do veículo" já é inequívoco, e acrescentar "(nº 39239)" ali mudaria o
 * texto de toda tela e todo e-mail dos orçamentos de um veículo — que são a
 * esmagadora maioria — sem informar nada.
 */
function diffVehicles(before: QuoteSnapshot, after: QuoteSnapshot): QuoteChange[] {
  const out: QuoteChange[] = [];
  const beforeList = snapshotVehicles(before);
  const afterList = snapshotVehicles(after);

  const beforeByTask = new Map(beforeList.map(v => [v.taskId, v]));
  const afterByTask = new Map(afterList.map(v => [v.taskId, v]));
  const multi = beforeList.length > 1 || afterList.length > 1;

  /** Como o veículo se apresenta numa linha de diff. */
  const describe = (v: QuoteSnapshotVehicle): string =>
    [
      v.serialNumber ? `nº ${v.serialNumber}` : null,
      v.plate,
      // Chassi só entra quando não há série nem placa: é longo, e nesse caso é a
      // única coisa que identifica o veículo.
      !v.serialNumber && !v.plate ? v.chassisNumber : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'sem identificação';

  // REMOVIDOS na ordem do congelado, ACRESCENTADOS na ordem do atual: é a ordem
  // em que o leitor viu (ou verá) o documento.
  for (const v of beforeList) {
    if (afterByTask.has(v.taskId)) continue;
    out.push({
      key: `vehicleRemoved:${v.taskId}`,
      severity: 'MATERIAL',
      kind: 'REMOVED',
      group: 'VEHICLE',
      label: 'Veículo retirado do orçamento',
      subject: describe(v),
      before: describe(v),
      after: null,
    });
  }
  for (const v of afterList) {
    if (beforeByTask.has(v.taskId)) continue;
    out.push({
      key: `vehicleAdded:${v.taskId}`,
      severity: 'MATERIAL',
      kind: 'ADDED',
      group: 'VEHICLE',
      label: 'Veículo acrescentado ao orçamento',
      subject: describe(v),
      before: null,
      after: describe(v),
    });
  }

  for (const nowV of afterList) {
    const wasV = beforeByTask.get(nowV.taskId);
    if (!wasV) continue;
    // O assunto sai do estado ATUAL quando ele identifica, e do congelado quando
    // o atual ainda está em branco — um veículo cuja série só chegou depois seria
    // rotulado "sem identificação" na própria linha que anuncia a série.
    const subject = multi ? (describe(nowV) || describe(wasV)) : null;

    scalar(out, {
      key: `truckPlate:${nowV.taskId}`,
      severity: 'MATERIAL',
      // CADASTRO TARDIO: implemento 0 km sai da fábrica sem emplacar e é orçado
      // assim — a placa chega depois, junto com o chassi. Preencher o que estava
      // em branco é completar o cadastro do mesmo veículo, não trocar de
      // veículo, e não pode custar assinatura. Trocar ABC1D23 por XYZ9K88
      // continua derrubando.
      cosmeticOnFillIn: true,
      group: 'VEHICLE',
      label: 'Placa do veículo',
      subject,
      before: normText(wasV.plate),
      after: normText(nowV.plate),
    });
    // O chassi é CADASTRO, não condição comercial. Na prática ele quase nunca
    // existe na hora do orçamento — implemento 0 km ainda em fabricação — e é
    // preenchido semanas depois, quando o veículo chega. Tratá-lo como material
    // fazia esse preenchimento derrubar uma coleta inteira (ou marcar um
    // orçamento já assinado como "mudou"), que é o mesmo erro do nº 590 com
    // outro campo: o veículo é o mesmo, a proposta é a mesma, ninguém teria
    // motivo para reconsiderar a assinatura. Quem identifica materialmente o
    // objeto do contrato é a PLACA, logo acima.
    scalar(out, {
      key: `truckChassis:${nowV.taskId}`,
      severity: 'COSMETIC',
      group: 'VEHICLE',
      label: 'Chassi',
      subject,
      before: normText(wasV.chassisNumber),
      after: normText(nowV.chassisNumber),
    });
    scalar(out, {
      key: `truckCategory:${nowV.taskId}`,
      severity: 'COSMETIC',
      group: 'VEHICLE',
      label: 'Categoria do veículo',
      subject,
      before: normText(wasV.category),
      after: normText(nowV.category),
    });
    scalar(out, {
      key: `truckImplement:${nowV.taskId}`,
      severity: 'COSMETIC',
      group: 'VEHICLE',
      label: 'Tipo de implemento',
      subject,
      before: normText(wasV.implementType),
      after: normText(nowV.implementType),
    });
    scalar(out, {
      key: `taskSerialNumber:${nowV.taskId}`,
      severity: 'COSMETIC',
      group: 'VEHICLE',
      label: 'Número de série',
      subject,
      before: normText(wasV.serialNumber),
      after: normText(nowV.serialNumber),
    });
    scalar(out, {
      key: `taskName:${nowV.taskId}`,
      severity: 'COSMETIC',
      group: 'DOCUMENT',
      label: 'Nome da tarefa',
      subject,
      before: normText(wasV.taskName),
      after: normText(nowV.taskName),
    });
  }

  return out;
}

/**
 * Os veículos de um snapshot, seja ele v3+ ou v1/v2.
 *
 * É a ÚNICA porta de entrada. O snapshot v1/v2 guarda `task` e `truck` no
 * singular; o v3+ guarda `vehicles`. Espalhar esse `if` pelo diff, pela
 * tolerância de cadastro tardio e pela projeção material seria três lugares para
 * a compatibilidade quebrar em silêncio quando alguém esquecesse um deles.
 */
export function snapshotVehicles(s: QuoteSnapshot | null | undefined): QuoteSnapshotVehicle[] {
  if (!s) return [];
  if (Array.isArray(s.vehicles)) return s.vehicles;
  if (!s.task && !s.truck) return [];
  return [
    {
      taskId: s.task?.id ?? '',
      taskName: s.task?.name ?? null,
      serialNumber: s.task?.serialNumber ?? null,
      plate: s.truck?.plate ?? null,
      chassisNumber: s.truck?.chassisNumber ?? null,
      category: s.truck?.category ?? null,
      implementType: s.truck?.implementType ?? null,
    },
  ];
}

/**
 * Rótulo do modo de faturamento, em português.
 *
 * Formatado AQUI, no servidor, como todo `before`/`after` do diff: é o que
 * garante que a tela do web, o app Flutter e o e-mail de invalidação digam a
 * mesma coisa sobre a mesma mudança.
 */
function billingSplitLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === 'PER_TASK') return 'Uma fatura por veículo';
  if (value === 'JOINT') return 'Fatura única para todos os veículos';
  return value;
}

/** Campo escalar: só entra na lista quando de fato mudou. */
function scalar(
  out: QuoteChange[],
  spec: {
    key: string;
    severity: QuoteChangeSeverity;
    group: QuoteChangeGroup;
    label: string;
    subject?: string | null;
    before: string | null;
    after: string | null;
    amountDelta?: number;
    /**
     * CADASTRO TARDIO: preencher um campo que estava VAZIO na assinatura sai
     * como cosmético, mesmo o campo sendo material. Completar o cadastro não é
     * mudar a proposta — trocar um valor por OUTRO continua sendo, e continua
     * derrubando.
     */
    cosmeticOnFillIn?: boolean;
  },
): void {
  if (spec.before === spec.after) return;
  out.push({
    key: spec.key,
    severity: spec.cosmeticOnFillIn && spec.before === null ? 'COSMETIC' : spec.severity,
    kind: 'CHANGED',
    group: spec.group,
    label: spec.label,
    subject: spec.subject ?? null,
    before: spec.before,
    after: spec.after,
    ...(spec.amountDelta !== undefined ? { amountDelta: spec.amountDelta } : {}),
  });
}

/**
 * A lista completa de diferenças entre dois recortes canônicos do orçamento.
 *
 * Comparação por VALOR NORMALIZADO, campo a campo — nunca por `JSON.stringify`
 * dos objetos inteiros. O snapshot anterior volta do JSONB do Postgres com a
 * ordem das chaves alterada, e uma comparação sensível à ordem apontaria
 * "cliente, veículo, responsáveis" como alterados quando só o preço mudou.
 */
export interface QuoteDiffOptions {
  /**
   * `Responsible.id` dos signatários deste envelope que AINDA NÃO ASSINARAM.
   *
   * É a lista que decide a gravidade das mudanças de elenco, e ela responde à
   * única pergunta que importa: esta alteração pode estragar uma assinatura que
   * ainda não foi colhida? Só nesse caso ela é MATERIAL.
   *
   *  · tirar da tarefa alguém que ainda tem uma linha em branco no documento
   *    deixa a coleta sem como concluir — isso é material;
   *  · tirar alguém que JÁ assinou não muda nada: a assinatura está colhida e o
   *    documento é imutável;
   *  · acrescentar um responsável nunca é material — ele não está no documento
   *    congelado e não assina esta coleta, aconteça o que acontecer.
   *
   * Omitida, o comportamento é o estrito de antes (inclusão e remoção materiais)
   * — que é o certo para quem não tem o envelope em mãos e não pode saber.
   */
  pendingSignerIds?: readonly string[] | null;
}

export function diffQuoteSnapshots(
  beforeRaw: QuoteSnapshot,
  afterRaw: QuoteSnapshot,
  options: QuoteDiffOptions = {},
): QuoteChange[] {
  // Snapshots congelados por versões anteriores do formato podem não ter todos
  // os campos (`schemaVersion` existe exatamente porque o recorte cresce). Um
  // `undefined.map` aqui derrubaria a página pública de um orçamento antigo — e
  // esta lista é informativa, nunca pode ser o que quebra a tela.
  const before = withDefaults(beforeRaw);
  const after = withDefaults(afterRaw);
  const out: QuoteChange[] = [];

  out.push(...diffServices(before, after));


  // ---- Valores ------------------------------------------------------------
  scalar(out, {
    key: 'subtotal',
    severity: 'MATERIAL',
    group: 'TOTALS',
    label: 'Subtotal',
    before: brl(before.subtotal),
    after: brl(after.subtotal),
    amountDelta: money(after.subtotal) - money(before.subtotal),
  });
  scalar(out, {
    key: 'total',
    severity: 'MATERIAL',
    group: 'TOTALS',
    label: 'Valor total',
    before: brl(before.total),
    after: brl(after.total),
    amountDelta: money(after.total) - money(before.total),
  });

  // ---- Pagamento ----------------------------------------------------------
  // Desconto sai como UMA linha ("10% · Cliente fiel"): tipo, valor e motivo são
  // um dado só para quem lê, e três linhas separadas para um desconto que mudou
  // de 5% fixo para 10% percentual seriam um quebra-cabeça.
  scalar(out, {
    key: 'discount',
    severity: 'MATERIAL',
    group: 'PAYMENT',
    label: 'Desconto',
    before: formatDiscount(before.discount),
    after: formatDiscount(after.discount),
  });
  scalar(out, {
    key: 'paymentCondition',
    severity: 'MATERIAL',
    group: 'PAYMENT',
    label: 'Condição de pagamento',
    before: normText(before.paymentCondition),
    after: normText(after.paymentCondition),
  });
  scalar(out, {
    key: 'customPaymentText',
    severity: 'MATERIAL',
    group: 'PAYMENT',
    label: 'Texto de pagamento',
    before: normText(before.customPaymentText),
    after: normText(after.customPaymentText),
  });
  // JUNTO OU SEPARADO é material, e não é uma sutileza. Nos sessenta caminhões do
  // Marquespan, `JOINT` é uma fatura de R$ 730.224,00 em quatro parcelas de
  // R$ 182.556,00; `PER_TASK` são sessenta faturas de R$ 12.170,40, sessenta
  // notas fiscais e duzentos e quarenta boletos de R$ 3.042,60. São obrigações
  // diferentes, com prazos diferentes, e a frase impressa no documento muda
  // junto — quem assinou uma não assinou a outra.
  //
  // Sai só quando um dos lados existe: snapshot congelado antes desta feature
  // não tem a chave, e comparar `undefined` com `'JOINT'` marcaria como alterado
  // todo orçamento anterior a ela.
  if (before.billingSplit || after.billingSplit) {
    scalar(out, {
      key: 'billingSplit',
      severity: 'MATERIAL',
      group: 'PAYMENT',
      label: 'Forma de faturamento',
      before: billingSplitLabel(before.billingSplit),
      after: billingSplitLabel(after.billingSplit),
    });
  }

  // ---- Garantia -----------------------------------------------------------
  scalar(out, {
    key: 'guaranteeYears',
    severity: 'MATERIAL',
    group: 'GUARANTEE',
    label: 'Garantia',
    before: before.guaranteeYears ? plural(before.guaranteeYears, 'ano', 'anos') : null,
    after: after.guaranteeYears ? plural(after.guaranteeYears, 'ano', 'anos') : null,
  });
  scalar(out, {
    key: 'customGuaranteeText',
    severity: 'MATERIAL',
    group: 'GUARANTEE',
    label: 'Texto da garantia',
    before: normText(before.customGuaranteeText),
    after: normText(after.customGuaranteeText),
  });

  // ---- Prazo --------------------------------------------------------------
  scalar(out, {
    key: 'customForecastDays',
    severity: 'MATERIAL',
    group: 'SCHEDULE',
    label: 'Prazo de entrega',
    before: before.customForecastDays ? plural(before.customForecastDays, 'dia', 'dias') : null,
    after: after.customForecastDays ? plural(after.customForecastDays, 'dia', 'dias') : null,
  });
  scalar(out, {
    key: 'simultaneousTasks',
    severity: 'MATERIAL',
    group: 'SCHEDULE',
    label: 'Veículos simultâneos',
    before: before.simultaneousTasks ? String(before.simultaneousTasks) : null,
    after: after.simultaneousTasks ? String(after.simultaneousTasks) : null,
  });

  // ---- Validade -----------------------------------------------------------
  scalar(out, {
    key: 'expiresAt',
    severity: 'MATERIAL',
    group: 'VALIDITY',
    label: 'Validade da proposta',
    before: formatDate(before.expiresAt),
    after: formatDate(after.expiresAt),
  });

  // ---- Layout -------------------------------------------------------------
  // Ids de arquivo não dizem nada a ninguém; o que o leitor precisa saber é que
  // a imagem impressa no orçamento não é mais a mesma. A contagem dá a dimensão
  // (uma virou duas) sem prometer um nome de arquivo que não temos aqui.
  const layoutBefore = [...before.layoutFileIds].sort().join('|');
  const layoutAfter = [...after.layoutFileIds].sort().join('|');
  if (layoutBefore !== layoutAfter) {
    out.push({
      key: 'layout',
      severity: 'MATERIAL',
      kind: 'CHANGED',
      group: 'LAYOUT',
      label: 'Layout aprovado',
      subject: null,
      before: before.layoutFileIds.length
        ? plural(before.layoutFileIds.length, 'imagem', 'imagens')
        : 'Sem layout',
      after: after.layoutFileIds.length
        ? plural(after.layoutFileIds.length, 'imagem', 'imagens')
        : 'Sem layout',
    });
  }

  // ---- Contratante --------------------------------------------------------
  scalar(out, {
    key: 'customerDocument',
    severity: 'MATERIAL',
    group: 'PARTIES',
    label: 'CNPJ/CPF do contratante',
    before: formatDocument(before.customer?.document),
    after: formatDocument(after.customer?.document),
  });
  scalar(out, {
    key: 'customerCorporateName',
    severity: 'COSMETIC',
    group: 'PARTIES',
    label: 'Razão social',
    before: normText(before.customer?.corporateName),
    after: normText(after.customer?.corporateName),
  });
  scalar(out, {
    key: 'customerFantasyName',
    severity: 'COSMETIC',
    group: 'PARTIES',
    label: 'Nome fantasia',
    before: normText(before.customer?.fantasyName),
    after: normText(after.customer?.fantasyName),
  });

  // ---- Veículos -----------------------------------------------------------
  out.push(...diffVehicles(before, after));

  // ---- Responsáveis -------------------------------------------------------
  out.push(...diffSigners(before, after, options));

  // ---- Documento (cosmético) ----------------------------------------------
  // Só o id do vendedor viaja no snapshot, e um UUID na tela não informa nada —
  // por isso esta linha não tem antes/depois. Quem precisa do nome tem a trilha.
  if ((before.commercialUserId ?? null) !== (after.commercialUserId ?? null)) {
    out.push({
      key: 'commercialUser',
      severity: 'COSMETIC',
      kind: 'CHANGED',
      group: 'DOCUMENT',
      label: 'Vendedor responsável',
      subject: null,
      before: null,
      after: null,
    });
  }

  return out.sort((x, y) => GROUP_ORDER[x.group] - GROUP_ORDER[y.group]);
}

// =============================================================================
// TEXTO
// =============================================================================

/** Uma linha legível de uma diferença. Usada no e-mail e no motivo gravado. */
export function describeQuoteChange(change: QuoteChange): string {
  const subject = change.subject ? ` "${change.subject}"` : '';
  if (change.kind === 'ADDED') return `${change.label}${subject}${change.after ? ` (${change.after})` : ''}`;
  if (change.kind === 'REMOVED') return `${change.label}${subject}${change.before ? ` (${change.before})` : ''}`;
  const before = change.before ?? 'vazio';
  const after = change.after ?? 'vazio';
  if (change.before === null && change.after === null) return `${change.label}${subject}`;
  return `${change.label}${subject} (${before} → ${after})`;
}

/**
 * O motivo em uma frase, para o e-mail de invalidação e para
 * `SignatureEnvelope.invalidatedReason`.
 *
 * Limitado a `max` itens: a frase inteira aparece dentro de um parágrafo de
 * e-mail e num aviso de uma linha na tela. A lista completa e detalhada vive na
 * interface, que é onde há espaço para ela.
 */
export function describeQuoteChanges(changes: QuoteChange[], max = 4): string {
  if (!changes.length) return 'Alteração material no orçamento.';
  const head = changes.slice(0, max).map(describeQuoteChange);
  const rest = changes.length - head.length;
  const tail = rest > 0 ? `, e mais ${plural(rest, 'alteração', 'alterações')}` : '';
  return `Alteração em: ${head.join(', ')}${tail}.`;
}
