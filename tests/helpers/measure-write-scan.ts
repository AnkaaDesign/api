/**
 * G15 — A FORMA DA FONTE: ninguém fora do escritor único grava medida.
 *
 * Varre `src/`, `scripts/` e `prisma/` pelo AST do TypeScript (não por regex de
 * linha) e acusa, fora de `implement-measure-writer.ts`:
 *
 *   1. `implementMeasure(Section).create/update/delete…(` — por ponto ou por
 *      colchete (`tx['implementMeasure'].delete`);
 *   2. uma chave de face (`leftSideMeasure`, `rightSideMeasureId`… e `front…`,
 *      a face do P11) num objeto que ESCREVE: dentro do `data`/`create`/
 *      `update`/`upsert`/`connectOrCreate` de uma chamada de escrita, inclusive
 *      aninhado (`task.create({ data: { truck: { create: { leftSideMeasure:
 *      { create } } } } })`) — é o defeito que o P04 corrigiu: copiar a FK
 *      compartilha a linha;
 *   3. uma chave de face cujo VALOR é uma operação aninhada do Prisma
 *      (`rightSideMeasure: { connect }`, `backSideMeasure: { create }`), onde
 *      quer que o objeto esteja montado (variável que depois vira `data`);
 *   4. atribuição a uma coluna de face (`x.leftSideMeasureId = …`,
 *      `x['backSideMeasure'] = …`);
 *   5. chave COMPUTADA (`data: { [campo]: v }`) na escrita do caminhão/
 *      implemento que não esteja no `else` de um `if` que já desviou as faces
 *      pelo `FACE_FK[…]` (a reversão pelo histórico, task.service.ts);
 *   6. SQL cru (`$executeRaw…`) que cita coluna de face.
 *
 * O que NÃO é escrita: `select`/`include`/`where`/`orderBy`… (leitura),
 * `z.object` (schema), objeto de resposta. Esses não entram, por construção.
 */
import * as ts from 'typescript';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

export const FACE_KEY = /^(left|right|back|front)SideMeasure(Id)?$/;
const READ_KEYS = new Set([
  'select',
  'include',
  'where',
  'orderBy',
  'omit',
  'cursor',
  'distinct',
  'having',
  '_count',
]);
const WRITE_KEYS = new Set(['data', 'create', 'update', 'upsert', 'connectOrCreate', 'createMany']);
const WRITE_METHODS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert']);
const NESTED_OPS = new Set([
  'create',
  'connect',
  'connectOrCreate',
  'disconnect',
  'set',
  'upsert',
  'update',
  'delete',
]);
const MEASURE_WRITE =
  /(\.|\[['"`])implementMeasure(Section)?(['"`]\])?\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
const RAW_FACE =
  /\$executeRaw(Unsafe)?\s*(`|\()[\s\S]{0,600}?(left|right|back|front)_?[Ss]ide_?[Mm]easure/;

export interface MeasureWriteHit {
  file: string;
  line: number;
  rule: string;
  text: string;
}

const nameOf = (n: ts.PropertyName | ts.Expression): string | undefined =>
  ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
    ? n.text
    : undefined;

/** O nome do método chamado: `tx.truck.update(…)` → `update`. */
const methodOf = (call: ts.CallExpression): string | undefined => {
  const e = call.expression;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isElementAccessExpression(e)) return nameOf(e.argumentExpression);
  return undefined;
};

/**
 * Sobe do objeto literal pela cadeia objeto → propriedade → objeto… e diz se a
 * chave está numa escrita. Para na primeira chave de leitura (é leitura) ou de
 * escrita (é escrita); chegando a uma chamada de escrita, é escrita.
 */
function inWriteContext(node: ts.Node): boolean {
  let p: ts.Node | undefined = node.parent;
  while (p) {
    if (ts.isPropertyAssignment(p)) {
      const k = nameOf(p.name);
      if (k && READ_KEYS.has(k)) return false;
      if (k && WRITE_KEYS.has(k)) return true;
    } else if (ts.isCallExpression(p)) {
      const m = methodOf(p);
      return !!m && WRITE_METHODS.has(m);
    } else if (
      !ts.isObjectLiteralExpression(p) &&
      !ts.isParenthesizedExpression(p) &&
      !ts.isAsExpression(p) &&
      !ts.isSatisfiesExpression(p) &&
      !ts.isConditionalExpression(p) &&
      !ts.isBinaryExpression(p) &&
      !ts.isSpreadAssignment(p) &&
      !ts.isArrayLiteralExpression(p)
    ) {
      return false;
    }
    p = p.parent;
  }
  return false;
}

/** A escrita de chave computada está no `else` de um `if (… FACE_FK[…] …)`? */
function guardedByFaceFk(node: ts.Node): boolean {
  let child: ts.Node = node;
  let p: ts.Node | undefined = node.parent;
  while (p && !ts.isFunctionLike(p)) {
    if (
      ts.isIfStatement(p) &&
      p.elseStatement === child &&
      /FACE_FK\[/.test(p.expression.getText())
    ) {
      return true;
    }
    child = p;
    p = p.parent;
  }
  return false;
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      if (n === 'node_modules' || n === 'dist' || n === 'migrations' || n.startsWith('.')) continue;
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js|cjs|mjs)$/.test(n) && !n.endsWith('.d.ts')) out.push(p);
    }
  };
  for (const d of ['src', 'scripts', 'prisma']) if (existsSync(join(root, d))) walk(join(root, d));
  return out;
}

export function scanMeasureWrites(apiRoot: string): MeasureWriteHit[] {
  const hits: MeasureWriteHit[] = [];
  for (const file of listFiles(apiRoot)) {
    if (file.endsWith('implement-measure-writer.ts')) continue;
    hits.push(...scanMeasureWriteSource(relative(apiRoot, file), readFileSync(file, 'utf8')));
  }
  return hits;
}

/** Varre UM arquivo (o teste usa para provar que a varredura pega o que promete). */
export function scanMeasureWriteSource(rel: string, text: string): MeasureWriteHit[] {
  const hits: MeasureWriteHit[] = [];
  {
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
    const add = (node: ts.Node, rule: string) =>
      hits.push({
        file: rel,
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        rule,
        text: node.getText().replace(/\s+/g, ' ').slice(0, 100),
      });

    const visit = (node: ts.Node) => {
      // 1. escrita direta no modelo da medida
      if (ts.isCallExpression(node) && MEASURE_WRITE.test(node.expression.getText() + '(')) {
        add(node, 'escrita direta em implementMeasure');
      }
      // 2 e 3. chave de face num objeto
      if (
        (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
        ts.isObjectLiteralExpression(node.parent)
      ) {
        const k = nameOf(node.name);
        if (k && FACE_KEY.test(k)) {
          const value = ts.isPropertyAssignment(node) ? node.initializer : undefined;
          const nestedOp =
            value &&
            ts.isObjectLiteralExpression(value) &&
            value.properties.some(pp => {
              const n = pp.name && nameOf(pp.name as ts.PropertyName);
              return !!n && NESTED_OPS.has(n);
            });
          if (nestedOp) add(node, 'operação aninhada do Prisma numa face');
          else if (inWriteContext(node)) add(node, 'coluna/relação de face numa escrita');
        }
      }
      // 4. atribuição a coluna de face
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ((ts.isPropertyAccessExpression(node.left) && FACE_KEY.test(node.left.name.text)) ||
          (ts.isElementAccessExpression(node.left) &&
            FACE_KEY.test(nameOf(node.left.argumentExpression) ?? '')))
      ) {
        add(node, 'atribuição a coluna de face');
      }
      // 5. chave computada na escrita do caminhão/implemento
      if (ts.isComputedPropertyName(node) && ts.isPropertyAssignment(node.parent)) {
        const obj = node.parent.parent;
        const holder = obj.parent;
        if (
          ts.isPropertyAssignment(holder) &&
          nameOf(holder.name) === 'data' &&
          ts.isObjectLiteralExpression(holder.parent) &&
          ts.isCallExpression(holder.parent.parent)
        ) {
          const call = holder.parent.parent;
          const callee = call.expression.getText();
          if (
            /(^|\.)(truck|implement)\s*\.\s*(create|createMany|update|updateMany|upsert)$/.test(
              callee,
            ) &&
            !guardedByFaceFk(call)
          ) {
            add(node.parent, 'chave computada na escrita do caminhão sem desviar as faces');
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    // 6. SQL cru que cita coluna de face
    const raw = text.match(RAW_FACE);
    if (raw && raw.index !== undefined) {
      hits.push({
        file: rel,
        line: text.slice(0, raw.index).split('\n').length,
        rule: 'SQL cru com coluna de face',
        text: raw[0].replace(/\s+/g, ' ').slice(0, 100),
      });
    }
  }
  return hits;
}
