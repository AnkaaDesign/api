/**
 * JANELA BILÍNGUE DO IMPLEMENTO — o ESPELHO DA RESPOSTA e o CONTADOR (PLANO §5.4, P11a).
 *
 * Por dentro a API só fala `implement`. Os três clientes instalados (web em
 * produção, app 1.4.1, `AnkaaAero`) leem `task.truck` (com `implementType`).
 * Então, em cada objeto da resposta que tem `implement`, este interceptor põe
 * `truck` = CÓPIA PROFUNDA E IGUAL do `implement` (os mesmos includes
 * aninhados, inclusive as medidas por face — revisão da Fase A, F9) com
 * `implementType = type` a mais. As inversas renomeadas (`implements*Side`,
 * `implementVinPlates`) ganham o nome velho do mesmo jeito.
 *
 * QUANDO espelha: o pedido trouxe uma chave velha (`truck`…) OU não disse
 * `implement` em lugar nenhum. O segundo caso é o include PADRÃO do servidor
 * (`GET /tasks/in-preparation`, bônus, painel…): o cliente velho não pediu
 * `truck`, mas lê `truck` — e na janela todo cliente instalado é velho. Quem
 * pede `implement` (o web e o app novos, Fase C) recebe só `implement`.
 *
 * O CONTADOR: cada chave velha, por rota × versão do app (`req.appVersion`, do
 * censo G3), conta e loga (a primeira vez e a cada 100). A R-D (P32) só remove
 * a janela quando o contador zerar por 14 dias.
 *
 * EXPIRA: 2027-03-31 (sai com a R-D).
 */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, map } from 'rxjs';
import { detectLegacyImplementKeys } from './legacy-implement-keys';

const logger = new Logger('JanelaImplemento');

/** Nome novo → nome velho, nos objetos da resposta. */
const MIRRORED_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['implement', 'truck'],
  ['implementsLeftSide', 'trucksLeftSide'],
  ['implementsRightSide', 'trucksRightSide'],
  ['implementsBackSide', 'trucksBackSide'],
  ['implementVinPlates', 'truckVinPlates'],
];

const MAX_DEPTH = 14;
const MAX_NODES = 400_000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** A cópia que o cliente velho lê: o implemento + `implementType`. */
function legacyImplementCopy(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  return 'type' in value ? { ...value, implementType: value.type } : { ...value };
}

function legacyCopy(newKey: string, value: unknown): unknown {
  if (newKey !== 'implement') {
    return Array.isArray(value) ? value.map(legacyImplementCopy) : value;
  }
  return legacyImplementCopy(value);
}

/**
 * Espelha no lugar (os objetos saem do Prisma novos a cada pedido). Primeiro
 * desce, depois acrescenta o nome velho: a cópia rasa compartilha os filhos já
 * espelhados, então `truck` e `implement` saem iguais em profundidade.
 */
export function mirrorLegacyImplementKeys(root: unknown): unknown {
  let visited = 0;
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || ++visited > MAX_NODES) return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v, depth + 1);
      return;
    }
    if (!isPlainObject(node)) return;
    for (const v of Object.values(node)) walk(v, depth + 1);
    for (const [newKey, oldKey] of MIRRORED_KEYS) {
      if (newKey in node && !(oldKey in node)) {
        node[oldKey] = legacyCopy(newKey, node[newKey]);
      }
    }
  };
  walk(root, 0);
  return root;
}

// ─── contador ────────────────────────────────────────────────────────────────

const counters = new Map<string, number>();
const MAX_COUNTERS = 2000;

/** `rota|chave|versão` → usos. Em memória, por processo (o censo G3 persiste). */
export function recordLegacyImplementUse(route: string, key: string, version: string): void {
  let k = `${route.slice(0, 120)}|${key}|${version.slice(0, 32)}`;
  if (!counters.has(k) && counters.size >= MAX_COUNTERS) k = `(outros)|${key}|${version.slice(0, 32)}`;
  const n = (counters.get(k) ?? 0) + 1;
  counters.set(k, n);
  if (n === 1 || n % 100 === 0) {
    logger.log(`[legado] ${k} (×${n}) — chave velha do implemento traduzida`);
  }
}

export function legacyImplementCounters(): Record<string, number> {
  return Object.fromEntries(counters);
}

export function resetLegacyImplementCounters(): void {
  counters.clear();
}

function routeOf(req: Request): string {
  const route = (req as Request & { route?: { path?: unknown } }).route;
  const path = route?.path !== undefined ? String(route.path) : req.path;
  return `${req.method} ${req.baseUrl ?? ''}${path}`;
}

function clientVersion(req: Request): string {
  if (req.appVersion?.raw) return `app ${req.appVersion.raw}`;
  const client = req.headers['x-client'];
  if (typeof client === 'string' && client.trim()) return client.trim().slice(0, 32);
  const ua = String(req.headers['user-agent'] ?? '');
  if (/AnkaaAero/i.test(ua)) return 'AnkaaAero';
  return 'sem-versão';
}

@Injectable()
export class ImplementLegacyMirrorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      map(body => {
        let mirror = true;
        try {
          // o corpo só conta nas rotas de tarefa (outro corpo pode ter uma chave
          // `truck` que não é o implemento: preferência salva, por exemplo)
          const taskWrite = /^\/(api\/)?tasks(\/|$)/.test(req.path ?? '') && req.method !== 'GET';
          const { legacy, mentionsNew } = detectLegacyImplementKeys(
            req.query,
            taskWrite ? req.body : undefined,
          );
          if (legacy.length > 0) {
            const route = routeOf(req);
            const version = clientVersion(req);
            for (const key of legacy) recordLegacyImplementUse(route, key, version);
          }
          mirror = legacy.length > 0 || !mentionsNew;
        } catch {
          mirror = true;
        }
        return mirror ? mirrorLegacyImplementKeys(body) : body;
      }),
    );
  }
}
