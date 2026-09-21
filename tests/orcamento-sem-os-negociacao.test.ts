/**
 * "EM NEGOCIAÇÃO" NÃO É MAIS UMA ORDEM DE SERVIÇO.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * "Em Negociação" nunca foi um estado. Era a `description` — TEXTO LIVRE — de
 * uma `ServiceOrder` com `type = COMMERCIAL`, e essa string comandava a
 * aprovação do orçamento nos DOIS sentidos:
 *
 *   · concluir a O.S.  → `Budget.status` PENDING  → APPROVED
 *   · reabrir a O.S.   → `Budget.status` APPROVED → PENDING
 *
 * A string era comparada em três lugares com três normalizações diferentes
 * (`em-negociacao-sync.ts`, `service-order.service.ts` e, na web, uma comparação
 * sensível a CAIXA e a ACENTO). Das 486 linhas de produção, a comparação da web
 * não reconhecia 20 — "Em Negociacao", "NEGOCIACAO" —, e essas 20 tarefas se
 * comportavam de um jeito enquanto as outras 466 se comportavam de outro.
 *
 * O estado virou dado: `TASK_QUOTE_STATUS.IN_NEGOTIATION`, com tabela de
 * transições. Este teste fixa o desmonte:
 *
 *   1. o módulo de sincronia não existe e ninguém o importa nem o chama;
 *   2. nenhum caminho de ORDEM DE SERVIÇO escreve o status do ORÇAMENTO;
 *   3. a descrição saiu do catálogo de sugestões e dos padrões de tarefa nova —
 *      e SÓ ela: "Enviar Orçamento" (1.703 linhas) continua lá;
 *   4. tarefa com ZERO O.S. comercial passa nos portões (o vazio é satisfeito,
 *      não bloqueado) — a remoção DESTRAVA tarefas, não as trava;
 *   5. `IN_NEGOTIATION` só é escrito pela máquina do orçamento;
 *   6. `POST /budgets/:id/sync-em-negociacao` saiu.
 *
 * E cobre, de carona, o defeito 2 do mesmo pacote: `PUT /budgets/:id/status`
 * descartava o `reason` em silêncio — o controller lia só `status` e o serviço
 * nem recebia o campo, enquanto a web sempre mandou os dois e o diálogo de
 * recusa EXIGE o motivo.
 *
 * Sem banco: metade é função pura, metade é leitura do próprio código-fonte
 * (com os comentários removidos antes, para que uma MENÇÃO histórica não passe
 * por uma CHAMADA viva).
 *
 * `npm run test:orcamento-sem-os-negociacao`
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { SERVICE_ORDER_STATUS, SERVICE_ORDER_TYPE } from '../src/constants/enums';
import * as SERVICE_DESCRIPTIONS from '../src/constants/service-descriptions';
import { areCommercialServiceOrdersComplete } from '../src/utils/task-service-order-sync';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/**
 * Remove comentários de um fonte TypeScript.
 *
 * ⚠️ É a peça que faz este teste valer alguma coisa. O desmonte deixou para
 * trás — de propósito — vários comentários que EXPLICAM o que foi removido, e
 * eles citam tanto o nome das funções (`syncEmNegociacaoForTask`) quanto a
 * própria string ("Em Negociação"). Um grep ingênuo os leria como código vivo e
 * este arquivo ficaria vermelho para sempre, ou — pior — alguém apagaria os
 * comentários para o teste passar.
 *
 * Não é um parser: strings do código que contenham `//` (uma URL, por exemplo)
 * confundiriam a varredura. Por isso as aspas são tratadas primeiro, e o que
 * está dentro delas é preservado.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      listTsFiles(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

const SRC_FILES = listTsFiles(SRC);
const CODE_ONLY = new Map<string, string>(
  SRC_FILES.map(f => [relative(ROOT, f), stripComments(readFileSync(f, 'utf8'))]),
);

function filesMatching(re: RegExp, only?: (path: string) => boolean): string[] {
  const hits: string[] = [];
  for (const [path, code] of CODE_ONLY) {
    if (only && !only(path)) continue;
    if (re.test(code)) hits.push(path);
  }
  return hits;
}

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

function codeOf(relPath: string): string {
  return stripComments(read(relPath));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nO módulo de sincronia não existe mais');
{
  check(
    'src/utils/em-negociacao-sync.ts foi apagado',
    !existsSync(join(SRC, 'utils/em-negociacao-sync.ts')),
  );
  const importers = filesMatching(/from\s+['"][^'"]*em-negociacao-sync['"]/);
  check('nenhum arquivo o importa', importers.length === 0, importers.join(', '));

  // A CHAMADA, não a menção: `syncEmNegociacaoForTask(` com parêntese. Os
  // comentários já saíram acima, mas a distinção é o que torna a regra estável.
  const callers = filesMatching(/\bsyncEmNegociacao\w*\s*\(/);
  check('ninguém mais o chama', callers.length === 0, callers.join(', '));

  const exporters = filesMatching(/export\s+(async\s+)?function\s+(syncEmNegociacao|registerEmNegociacao)/);
  check('nenhum módulo exporta a sincronia', exporters.length === 0, exporters.join(', '));

  const emitterRegs = filesMatching(/registerEmNegociacaoEventEmitter\s*\(/);
  check(
    'o emissor de eventos da sincronia não é mais registrado',
    emitterRegs.length === 0,
    emitterRegs.join(', '),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nA STRING deixou de existir como comparação');
{
  // As três normalizações que existiam, cada uma escrita à mão num lugar.
  //
  // ⚠️ `enum-labels.ts` fica de FORA, e de propósito: lá "Em Negociação" é o
  // RÓTULO do estado novo (`TASK_QUOTE_STATUS.IN_NEGOTIATION`) — a palavra que
  // o dono quis na tela. O que este teste proíbe é a palavra voltar a ser um
  // valor comparado, não a palavra existir.
  const ROTULOS = 'src/constants/enum-labels.ts';
  const LITERAIS = [
    /['"]em negociação['"]/i,
    /['"]em negociacao['"]/i,
    /['"]negociacao['"]/i,
  ];
  for (const re of LITERAIS) {
    const hits = filesMatching(re, p => p !== ROTULOS);
    check(`nenhum literal ${re.source} fora do mapa de rótulos`, hits.length === 0, hits.join(', '));
  }
  check(
    'e o rótulo do ESTADO novo continua sendo "Em Negociação"',
    /\[TASK_QUOTE_STATUS\.IN_NEGOTIATION\]:\s*'Em Negociação'/.test(codeOf(ROTULOS)),
  );

  const soService = codeOf('src/modules/production/service-order/service-order.service.ts');
  check(
    'service-order.service.ts não compara descrição de O.S. com negociação',
    !/negocia/i.test(soService),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nNenhuma ORDEM DE SERVIÇO aprova nem rebaixa orçamento');
{
  const soService = codeOf('src/modules/production/service-order/service-order.service.ts');
  check(
    'budgetApproveOnEmNegociacaoComplete saiu',
    !soService.includes('budgetApproveOnEmNegociacaoComplete'),
  );
  check(
    'budgetRevertOnEmNegociacaoReopen saiu',
    !soService.includes('budgetRevertOnEmNegociacaoReopen'),
  );
  // A forma de ESCRITA (`status: X`), não a de leitura (`=== X`): o arquivo
  // continua CONSULTANDO o status do orçamento nas guardas do dinheiro.
  check(
    'não escreve APPROVED no orçamento',
    !/status:\s*TASK_QUOTE_STATUS\.APPROVED/.test(soService),
  );
  check(
    'não escreve PENDING no orçamento',
    !/status:\s*TASK_QUOTE_STATUS\.PENDING/.test(soService),
  );
  // O cancelamento em cascata CONTINUA — cancelar a última O.S. comercial
  // derruba a tarefa e o orçamento, e isso não é o acoplamento que saiu.
  check(
    'o cancelamento em cascata continua de pé',
    /status:\s*TASK_QUOTE_STATUS\.CANCELLED/.test(soService),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nIN_NEGOTIATION só é escrito pela máquina do orçamento');
{
  const foraDoOrcamento = filesMatching(
    /IN_NEGOTIATION/,
    p =>
      p.startsWith('src/modules/production/service-order/') ||
      p.startsWith('src/modules/production/task/') ||
      p.startsWith('src/utils/'),
  );
  check(
    'ordem de serviço, tarefa e utilitários não mencionam IN_NEGOTIATION',
    foraDoOrcamento.length === 0,
    foraDoOrcamento.join(', '),
  );

  const budgetService = codeOf('src/modules/production/budget/budget.service.ts');
  check(
    'a tabela de transições do orçamento conhece IN_NEGOTIATION',
    /\[TASK_QUOTE_STATUS\.IN_NEGOTIATION\]:\s*\[/.test(budgetService),
  );
  check(
    'IN_NEGOTIATION é destino de alguma transição',
    /TASK_QUOTE_STATUS\.IN_NEGOTIATION,/.test(budgetService),
  );
  check(
    'validateStatusTransition é quem guarda a porta',
    budgetService.includes('this.validateStatusTransition('),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nA rota de reconciliação saiu');
{
  const controller = codeOf('src/modules/production/budget/budget.controller.ts');
  check('sem @Post(:id/sync-em-negociacao)', !controller.includes('sync-em-negociacao'));
  check('sem o método do controller', !/async\s+syncEmNegociacao\s*\(/.test(controller));

  const service = codeOf('src/modules/production/budget/budget.service.ts');
  check('sem o método do serviço', !/async\s+syncEmNegociacao\s*\(/.test(service));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nO catálogo de sugestões perdeu UMA descrição, e só uma');
{
  const normalize = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();

  const comerciais = SERVICE_DESCRIPTIONS.COMMERCIAL_SERVICE_DESCRIPTIONS as readonly string[];
  const negociacao = comerciais.filter(d => normalize(d) === 'em negociacao');
  check('"Em Negociação" saiu da lista comercial', negociacao.length === 0);
  check(
    '"Enviar Orçamento" (1.703 linhas em produção) continua',
    comerciais.includes('Enviar Orçamento'),
  );
  check('a lista comercial não encolheu além disso', comerciais.length === 51, `${comerciais.length}`);

  check(
    'isValidServiceDescription recusa a descrição aposentada',
    SERVICE_DESCRIPTIONS.isValidServiceDescription(
      SERVICE_ORDER_TYPE.COMMERCIAL,
      'Em Negociação',
    ) === false,
  );
  check(
    'e continua aceitando as que ficaram',
    SERVICE_DESCRIPTIONS.isValidServiceDescription(
      SERVICE_ORDER_TYPE.COMMERCIAL,
      'Enviar Orçamento',
    ) === true,
  );

  check(
    'o tipo COMMERCIAL não foi removido',
    SERVICE_ORDER_TYPE.COMMERCIAL === ('COMMERCIAL' as SERVICE_ORDER_TYPE),
  );

  const padroes = SERVICE_DESCRIPTIONS.DEFAULT_TASK_SERVICE_ORDERS as readonly {
    type: SERVICE_ORDER_TYPE;
    description: string;
  }[];
  check(
    'tarefa nova não nasce com O.S. comercial nenhuma',
    padroes.every(so => so.type !== SERVICE_ORDER_TYPE.COMMERCIAL),
  );
  check(
    'os padrões de arte e logística continuam intactos',
    padroes.filter(so => so.type === SERVICE_ORDER_TYPE.ARTWORK).length === 3 &&
      padroes.filter(so => so.type === SERVICE_ORDER_TYPE.LOGISTIC).length === 2,
  );
  check(
    'DEFAULT_TASK_SERVICE_ORDER (singular) saiu — só nomeava a descrição aposentada',
    !('DEFAULT_TASK_SERVICE_ORDER' in SERVICE_DESCRIPTIONS),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nOs portões da tarefa com ZERO O.S. comercial');
{
  type SO = { status: SERVICE_ORDER_STATUS; type: SERVICE_ORDER_TYPE };
  const so = (type: SERVICE_ORDER_TYPE, status: SERVICE_ORDER_STATUS): SO => ({ type, status });

  check(
    'conjunto comercial VAZIO é "concluído" — o portão não trava',
    areCommercialServiceOrdersComplete([]) === true,
  );
  check(
    'só arte pendente: o portão comercial segue satisfeito',
    areCommercialServiceOrdersComplete([
      so(SERVICE_ORDER_TYPE.ARTWORK, SERVICE_ORDER_STATUS.PENDING),
      so(SERVICE_ORDER_TYPE.LOGISTIC, SERVICE_ORDER_STATUS.PENDING),
    ]) === true,
  );
  check(
    'uma O.S. comercial DE VERDADE ainda trava',
    areCommercialServiceOrdersComplete([
      so(SERVICE_ORDER_TYPE.COMMERCIAL, SERVICE_ORDER_STATUS.IN_PROGRESS),
    ]) === false,
  );
  check(
    'comercial CANCELADA não trava',
    areCommercialServiceOrdersComplete([
      so(SERVICE_ORDER_TYPE.COMMERCIAL, SERVICE_ORDER_STATUS.CANCELLED),
    ]) === true,
  );

  // O portão de FINALIZAR a tarefa (`task.service.ts`, ANY → COMPLETED): toda
  // O.S. tem de estar CONCLUÍDA ou CANCELADA. É a réplica pura da regra.
  const bloqueiam = (sos: SO[]) =>
    sos.filter(
      s =>
        s.status !== SERVICE_ORDER_STATUS.COMPLETED &&
        s.status !== SERVICE_ORDER_STATUS.CANCELLED,
    );

  const producaoPronta = [
    so(SERVICE_ORDER_TYPE.ARTWORK, SERVICE_ORDER_STATUS.COMPLETED),
    so(SERVICE_ORDER_TYPE.PRODUCTION, SERVICE_ORDER_STATUS.COMPLETED),
    so(SERVICE_ORDER_TYPE.LOGISTIC, SERVICE_ORDER_STATUS.COMPLETED),
  ];
  const comNegociacaoAberta = [
    ...producaoPronta,
    so(SERVICE_ORDER_TYPE.COMMERCIAL, SERVICE_ORDER_STATUS.IN_PROGRESS),
  ];

  check(
    'ANTES: a negociação aberta impedia finalizar a tarefa',
    bloqueiam(comNegociacaoAberta).length === 1,
  );
  check(
    'DEPOIS: sem a O.S., a mesma tarefa finaliza',
    bloqueiam(producaoPronta).length === 0,
  );
  check(
    'tarefa criada fora da tela (zero O.S.) finaliza',
    bloqueiam([]).length === 0,
  );

  // O portão continua mordendo quem ele deve morder.
  check(
    'uma O.S. de produção pausada ainda impede finalizar',
    bloqueiam([
      ...producaoPronta,
      so(SERVICE_ORDER_TYPE.PRODUCTION, SERVICE_ORDER_STATUS.PAUSED),
    ]).length === 1,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nDefeito 2 — PUT /budgets/:id/status já não engole o motivo');
{
  const controller = codeOf('src/modules/production/budget/budget.controller.ts');
  const updateStatusFonte = controller.slice(
    controller.indexOf('async updateStatus('),
    controller.indexOf('async updateStatus(') + 2000,
  );

  check(
    'o controller LÊ o motivo do corpo',
    /@Body\(\s*['"]reason['"]\s*\)/.test(updateStatusFonte),
  );
  check(
    'e o repassa ao serviço',
    /this\.budgetService\.updateStatus\([\s\S]*?reason/.test(updateStatusFonte),
  );

  const service = codeOf('src/modules/production/budget/budget.service.ts');
  const assinatura = service.slice(
    service.indexOf('async updateStatus('),
    service.indexOf('async updateStatus(') + 200,
  );
  check('updateStatus recebe o motivo', /reason\?:\s*string/.test(assinatura));

  const corpo = service.slice(
    service.indexOf('async updateStatus('),
    service.indexOf('async settleManually('),
  );
  check(
    'o motivo vai para o ChangeLog',
    /logChange\(\{[\s\S]*?reason:\s*motivo/.test(corpo),
  );
  check(
    'a entrada do motivo é do campo status',
    /logChange\(\{[\s\S]*?field:\s*'status'[\s\S]*?reason:\s*motivo/.test(corpo),
  );
  check(
    'cancelar também carrega o motivo do operador',
    /cancelForTaskCancellation\([\s\S]{0,120}reason\?\.trim\(\)\s*\|\|/.test(corpo),
  );

  // A REGRA de normalização, exercida de verdade — e conferida contra o fonte
  // para que a réplica não descole do original.
  const normalizeReason = (r: unknown): string | undefined =>
    typeof r === 'string' && r.trim() ? r.trim() : undefined;

  check(
    'a réplica abaixo é a mesma expressão do controller',
    /typeof reason === 'string' && reason\.trim\(\) \? reason\.trim\(\) : undefined/.test(
      controller,
    ),
  );
  check('ausente vira undefined', normalizeReason(undefined) === undefined);
  check('vazio vira undefined', normalizeReason('') === undefined);
  check('só espaço vira undefined', normalizeReason('   ') === undefined);
  check('motivo real chega aparado', normalizeReason('  preço alto  ') === 'preço alto');
  check('número no corpo é ignorado', normalizeReason(42) === undefined);

  // E a consequência: sem motivo, NENHUMA entrada extra é escrita — a trilha
  // não ganha uma linha vazia por cada mudança de status.
  const escreveEntrada = (r: unknown) => normalizeReason(r) !== undefined;
  check('sem motivo, sem entrada extra na trilha', escreveEntrada('') === false);
  check('com motivo, uma entrada extra na trilha', escreveEntrada('recusado') === true);
}

console.log(`\n${failures === 0 ? '✓ TODAS as verificações passaram' : `✗ ${failures} falha(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
