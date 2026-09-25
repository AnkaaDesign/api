/**
 * G9 — TODA CHAVE DE NOTIFICAÇÃO EMITIDA EXISTE NO SEED.
 *
 * O despacho (`dispatchByConfiguration*`) procura a configuração pela chave; se
 * a chave não está no seed (`prisma/scripts/seed-notification-configs.ts`), a
 * notificação simplesmente NÃO SAI — sem erro, sem log de falha. Renomear um
 * campo (`serialNumber` → `implement.serialNumber`, por exemplo)
 * emudece a notificação em silêncio.
 *
 * O teste lê o código com o compilador do TypeScript (sem executar nada):
 *   - todo primeiro argumento de `dispatchByConfiguration*(…)` em src/ que se
 *     resolve para texto (literal, ternário, variável local com literal,
 *     template com prefixo fixo);
 *   - `task.field.${event.field}` do listener, expandido pelos `TRACKED_FIELDS`
 *     do tracker (as três medidas por lado viram `implement.measures`);
 * e exige cada uma no seed. Chave que não se resolve estaticamente é listada
 * em `DINAMICAS_CONHECIDAS` com o motivo (a lista só encolhe).
 *
 * Rodar: npm run test:notification-keys   (sem banco)
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import * as ts from 'typescript';

const ROOT = join(__dirname, '..');
const SEED = join(ROOT, 'prisma/scripts/seed-notification-configs.ts');

let ok = 0;
let fail = 0;
function check(nome: string, cond: boolean, detalhe = ''): void {
  if (cond) {
    ok++;
    console.log(`[  ok  ] ${nome}`);
  } else {
    fail++;
    console.log(`[ FAIL ] ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

/** Chaves emitidas que ainda não estão no seed. SÓ ENCOLHE. */
const EMITIDAS_SEM_SEED: Record<string, string> = {
  // Achado do P01 (23/09): o tracker rastreia `implement.vinPlateId` e o listener
  // despacha `task.field.implement.vinPlateId`, mas o seed não tem a configuração —
  // trocar a foto da plaqueta NUNCA notificou ninguém. Acrescentar ao seed muda
  // quem recebe notificação em produção: decisão do dono (fica para o reseed do
  // P26 junto com as chaves `implement`).
  'task.field.implement.vinPlateId': 'sem configuração no seed: notificação muda desde sempre',
};

/**
 * Chamadas cujo primeiro argumento este teste não resolve (chave montada por
 * função ou por parâmetro). Chave = `arquivo expressão`. SÓ ENCOLHE: quem
 * tornar uma delas estática (ou a cobrir por teste próprio) tira a linha.
 */
const DINAMICAS_CONHECIDAS: Record<string, string> = {
  'src/modules/common/notification/notification-configuration.controller.ts key':
    'rota de teste/disparo manual: a chave vem do pedido',
  'src/modules/common/scheduler/bonus-cron.service.ts `payroll.finalization.${outcome}`':
    'sufixo por resultado da finalização da folha',
  'src/modules/personnel-department/bonus/bonus.controller.ts `payroll.finalization.${outcome}`':
    'sufixo por resultado da finalização da folha',
  'src/modules/personnel-department/payroll/payroll.controller.ts `payroll.finalization.${outcome}`':
    'sufixo por resultado da finalização da folha',
  'src/modules/integrations/nfse/painter/painter-nfse.scheduler.ts configKey':
    'chave escolhida por resultado da emissão do aerografista',
  'src/modules/integrations/secullum/secullum.service.ts configKey': 'chave por evento do ponto',
  'src/modules/integrations/secullum/user-secullum-sync.service.ts configKey':
    'chave por evento de sincronização do ponto',
  'src/modules/inventory/services/stock-notification.service.ts configKey':
    '`resolveConfigKey(eventType)`',
  'src/modules/production/service-order/service-order.listener.ts configKey':
    '`getTypedConfigKey(base, tipoDaOS)` — uma chave por tipo de OS',
  'src/modules/production/service-order/service-order.listener.ts creatorConfigKey':
    '`getTypedConfigKey` para o criador da OS',
  'src/modules/production/task/task.listener.ts configKey':
    '`getDeadlineConfigKey(dias, horas)` — prazo da tarefa',
  'src/modules/common/notification/airbrushing-quote-notification.service.ts key':
    'helper do aviso direcionado ao aerografista: recebe um valor de ' +
    '`AIRBRUSHING_QUOTE_NOTIFICATION_KEYS`, que o `MAPA[intent.kind]` do mesmo ' +
    'arquivo já confere inteiro contra o seed',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'archive') continue;
      walk(p, out);
    } else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

function seedKeys(): Set<string> {
  const src = readFileSync(SEED, 'utf8');
  const keys = new Set<string>();
  for (const m of src.matchAll(/\bkey:\s*["'`]([^"'`]+)["'`]/g)) keys.add(m[1]);
  return keys;
}

interface Emitida {
  key: string;
  onde: string;
}

/** Os textos possíveis de uma expressão, se todos forem estáticos. */
function resolve(node: ts.Expression, sf: ts.SourceFile, depth = 0): string[] | null {
  if (depth > 6) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) return resolve(node.expression, sf, depth + 1);
  if (ts.isAsExpression(node)) return resolve(node.expression, sf, depth + 1);
  if (ts.isConditionalExpression(node)) {
    const a = resolve(node.whenTrue, sf, depth + 1);
    const b = resolve(node.whenFalse, sf, depth + 1);
    return a && b ? [...a, ...b] : null;
  }
  if (ts.isIdentifier(node)) {
    // variável com inicializador e/ou atribuições estáticas no arquivo
    // (`const configKey = … ? 'a' : 'b'`, `let k; if (…) k = 'a'; else k = 'b'`)
    const fontes: ts.Expression[] = [];
    const visit = (n: ts.Node) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === node.text &&
        n.initializer
      ) {
        fontes.push(n.initializer);
      }
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(n.left) &&
        n.left.text === node.text
      ) {
        fontes.push(n.right);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (fontes.length === 0) return null;
    const out: string[] = [];
    for (const f of fontes) {
      const r = resolve(f, sf, depth + 1);
      if (!r) return null;
      out.push(...r);
    }
    return out;
  }
  if (
    (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)) &&
    ts.isIdentifier(node.expression)
  ) {
    // `MAPA[chave]` com MAPA = objeto literal: todos os valores possíveis;
    // `MAPA.chave`: só o valor daquela propriedade
    const nome = node.expression.text;
    const so = ts.isPropertyAccessExpression(node) ? node.name.text : null;
    let valores: string[] | null = null;
    const visit = (n: ts.Node) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === nome &&
        n.initializer
      ) {
        let init: ts.Expression = n.initializer;
        while (
          ts.isAsExpression(init) ||
          ts.isParenthesizedExpression(init) ||
          ts.isSatisfiesExpression(init)
        ) {
          init = init.expression;
        }
        if (ts.isObjectLiteralExpression(init)) {
          const vs: string[] = [];
          for (const prop of init.properties) {
            if (!ts.isPropertyAssignment(prop)) return;
            if (so !== null && (!ts.isIdentifier(prop.name) || prop.name.text !== so)) continue;
            const r = resolve(prop.initializer, sf, depth + 1);
            if (!r) return;
            vs.push(...r);
          }
          valores = vs;
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return valores;
  }
  return null;
}

function trackedFields(): string[] {
  const file = join(ROOT, 'src/modules/production/task/task-field-tracker.service.ts');
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let fields: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 'TRACKED_FIELDS'
    ) {
      let init = n.initializer;
      while (init && (ts.isAsExpression(init) || ts.isParenthesizedExpression(init))) {
        init = init.expression;
      }
      if (init && ts.isArrayLiteralExpression(init)) {
        fields = init.elements.filter(ts.isStringLiteral).map(e => e.text);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return fields;
}

function main(): void {
  const seed = seedKeys();
  check('o seed tem chaves', seed.size > 50, `${seed.size}`);

  const emitidas: Emitida[] = [];
  const dinamicas: string[] = [];
  let chamadas = 0;

  for (const file of walk(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('dispatchByConfiguration')) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rel = relative(ROOT, file);
    const visit = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text.startsWith('dispatchByConfiguration') &&
        n.arguments.length > 0
      ) {
        chamadas++;
        const arg = n.arguments[0];
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        const onde = `${rel}:${line}`;
        const vals = resolve(arg, sf);
        if (vals) {
          vals.forEach(key => emitidas.push({ key, onde }));
        } else if (ts.isTemplateExpression(arg) && arg.head.text === 'task.field.') {
          // o listener do tracker: uma chave por campo rastreado (o histórico e
          // o evento usam o MESMO nome, `implement.<campo>`)
          for (const f of trackedFields()) {
            const side = /^implement\.(left|right|back)SideMeasureId$/.test(f);
            emitidas.push({ key: `task.field.${side ? 'implement.measures' : f}`, onde });
          }
        } else {
          dinamicas.push(`${rel} ${arg.getText(sf)}`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  check('achou as chamadas de despacho', chamadas > 50, `${chamadas}`);

  const unicas = new Map<string, string>();
  for (const e of emitidas) if (!unicas.has(e.key)) unicas.set(e.key, e.onde);
  console.log(
    `   ${chamadas} chamadas, ${unicas.size} chaves emitidas distintas, ${seed.size} no seed`,
  );

  const faltando = [...unicas.entries()].filter(([k]) => !seed.has(k));
  const novas = faltando.filter(([k]) => !(k in EMITIDAS_SEM_SEED));
  check(
    'toda chave emitida existe no seed',
    novas.length === 0,
    novas.map(([k, o]) => `${k} (${o})`).join('; '),
  );
  const consertadas = Object.keys(EMITIDAS_SEM_SEED).filter(k => seed.has(k) || !unicas.has(k));
  check(
    'EMITIDAS_SEM_SEED não lista chave já consertada (a lista só encolhe)',
    consertadas.length === 0,
    consertadas.join(', '),
  );

  const dinUnicas = [...new Set(dinamicas)];
  const dinNovas = dinUnicas.filter(d => !(d in DINAMICAS_CONHECIDAS));
  check(
    'nenhuma chamada de despacho nova com chave que não se resolve estaticamente',
    dinNovas.length === 0,
    dinNovas.join('; '),
  );
  const dinVelhas = Object.keys(DINAMICAS_CONHECIDAS).filter(d => !dinUnicas.includes(d));
  check(
    'DINAMICAS_CONHECIDAS não lista chamada que já sumiu ou já se resolve (a lista só encolhe)',
    dinVelhas.length === 0,
    dinVelhas.join('; '),
  );

  console.log(`\n${ok} ok, ${fail} falha(s)`);
  if (fail > 0) process.exit(1);
}

main();
