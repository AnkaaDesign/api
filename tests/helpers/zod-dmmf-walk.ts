/**
 * G4 — cruza o que um schema zod de CONSULTA declara com o DMMF.
 *
 * Percorre as formas `z.object` de include/select/where/orderBy (atravessando
 * lazy, optional, nullable, default, effects, union e intersection) e acusa toda
 * chave declarada que o Prisma não conhece: é o "fantasma" — relação que o zod
 * aceita, o controller repassa e o Prisma recusa com 500 (`cutRequest`,
 * `bonifications`, `customer.tasks.include.budget`…).
 *
 * Também devolve os pontos OPACOS (`z.record`, `z.any`): ali o zod deixa passar
 * qualquer chave, e só o G1 em runtime protege.
 */
import { z } from 'zod';
import { getField, getModelFields } from '../../src/modules/common/query/dmmf-query-validator';
import {
  findDeprecatedQueryKey,
  isComputedQueryKey,
} from '../../src/modules/common/query/deprecated-query-keys';

type Pos = 'include' | 'select' | 'where' | 'orderBy' | 'args';

export interface ZodPhantom {
  model: string;
  key: string;
  path: string;
  pos: Pos;
}

export interface ZodWalkResult {
  phantoms: ZodPhantom[];
  opaque: string[];
}

const LIST_OPS = new Set(['some', 'every', 'none']);
const ONE_OPS = new Set(['is', 'isNot']);

/** As formas `ZodObject` alcançáveis a partir de `s` (e se há ponto opaco). */
function objectShapes(
  s: z.ZodTypeAny,
  seen = new Set<z.ZodTypeAny>(),
): { shapes: Record<string, z.ZodTypeAny>[]; opaque: boolean } {
  if (!s || seen.has(s)) return { shapes: [], opaque: false };
  seen.add(s);
  const def: any = (s as any)._def;
  const t = def?.typeName as string | undefined;
  switch (t) {
    case 'ZodObject':
      return { shapes: [(s as z.AnyZodObject).shape], opaque: false };
    case 'ZodLazy':
      return objectShapes(def.getter(), seen);
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
    case 'ZodBranded':
      return objectShapes(def.innerType ?? def.type, seen);
    case 'ZodEffects':
      return objectShapes(def.schema, seen);
    case 'ZodPipeline':
      return objectShapes(def.in, seen);
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const opts: z.ZodTypeAny[] = Array.isArray(def.options)
        ? def.options
        : [...def.options.values()];
      const all = opts.map(o => objectShapes(o, seen));
      return {
        shapes: all.flatMap(a => a.shapes),
        opaque: all.some(a => a.opaque),
      };
    }
    case 'ZodIntersection': {
      const a = objectShapes(def.left, seen);
      const b = objectShapes(def.right, seen);
      return { shapes: [...a.shapes, ...b.shapes], opaque: a.opaque || b.opaque };
    }
    case 'ZodArray':
      return objectShapes(def.type, seen);
    case 'ZodRecord':
    case 'ZodAny':
    case 'ZodUnknown':
      return { shapes: [], opaque: true };
    default:
      return { shapes: [], opaque: false };
  }
}

export function walkQuerySchema(model: string, schema: z.ZodTypeAny): ZodWalkResult {
  const res: ZodWalkResult = { phantoms: [], opaque: [] };
  // A mesma forma (mesmo modelo, posição e conjunto de chaves) só é percorrida
  // uma vez. Não dá para usar a identidade do schema: `z.lazy(() => z.object…)`
  // recria o objeto a cada chamada, e os selects recursivos (`relatedTasks.select`
  // = o select de Task) e os where com AND/OR nunca fechariam o ciclo.
  const visited = new Set<string>();

  const visit = (m: string, s: z.ZodTypeAny, pos: Pos, path: string, depth: number) => {
    if (depth > 16) return;
    const { shapes, opaque } = objectShapes(s);
    const tag = `${m}|${pos}|${shapes.map(sh => Object.keys(sh).sort().join(',')).join('/')}|${opaque}`;
    if (visited.has(tag)) return;
    visited.add(tag);
    if (opaque) res.opaque.push(`${path} (${m}.${pos})`);
    const fields = getModelFields(m);
    if (!fields) return;
    for (const shape of shapes) {
      for (const [key, sub] of Object.entries(shape)) {
        const p = `${path}.${key}`;
        if (pos === 'args') {
          if (key === 'include') visit(m, sub, 'include', p, depth + 1);
          else if (key === 'select') visit(m, sub, 'select', p, depth + 1);
          else if (key === 'where') visit(m, sub, 'where', p, depth + 1);
          else if (key === 'orderBy') visit(m, sub, 'orderBy', p, depth + 1);
          continue;
        }
        if (key === '_count') continue;
        if (pos === 'where' && ['AND', 'OR', 'NOT'].includes(key)) {
          visit(m, sub, 'where', p, depth + 1);
          continue;
        }
        if (findDeprecatedQueryKey(m, pos, key) || isComputedQueryKey(m, pos, key)) continue;
        const f = getField(m, key);
        if (!f) {
          res.phantoms.push({ model: m, key, path: p, pos });
          continue;
        }
        if (pos === 'include' && f.kind !== 'object') {
          res.phantoms.push({ model: m, key, path: p, pos });
          continue;
        }
        if (f.kind !== 'object') continue;
        if (pos === 'include' || pos === 'select') visit(f.type, sub, 'args', p, depth + 1);
        else if (pos === 'orderBy') {
          if (!f.isList) visit(f.type, sub, 'orderBy', p, depth + 1);
        } else if (pos === 'where') {
          const inner = objectShapes(sub);
          for (const sh of inner.shapes) {
            for (const [op, opSchema] of Object.entries(sh)) {
              if (LIST_OPS.has(op) || ONE_OPS.has(op)) {
                visit(f.type, opSchema, 'where', `${p}.${op}`, depth + 1);
              } else if (!f.isList) {
                // atalho `relacao: { campo: … }`
                visit(f.type, z.object({ [op]: opSchema }), 'where', p, depth + 1);
              }
            }
          }
          if (inner.opaque) res.opaque.push(`${p} (${f.type}.where)`);
        }
      }
    }
  };

  const top = objectShapes(schema);
  for (const shape of top.shapes) {
    for (const clause of ['include', 'select', 'where', 'orderBy'] as const) {
      if (shape[clause]) visit(model, shape[clause], clause, clause, 0);
    }
  }
  return res;
}
