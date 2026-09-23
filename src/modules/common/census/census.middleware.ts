/**
 * G3 — o middleware do censo (registrado para todas as rotas em `app.module.ts`).
 *
 * Duas etapas, porque as duas metades do pedido ficam prontas em momentos
 * diferentes:
 *   1. AO CHEGAR: lê a versão do app (`req.appVersion`, G13), a identidade do
 *      cliente, e os caminhos da query string e do corpo JSON — antes que pipe
 *      ou interceptor mexam neles;
 *   2. AO TERMINAR (`finish`): a rota já casou, então `req.route.path` dá o
 *      PADRÃO (`/tasks/:id`, nunca a URL com o id), e o multer já montou o corpo
 *      multipart (os nomes de campo e de arquivo).
 * Forma nova neste processo vira UMA linha `[CENSO] {json}` no log.
 *
 * Não muda resposta nem status, e nada daqui pode derrubar o pedido: qualquer
 * erro do censo é engolido. Pedido que não casou rota (404, varredura de robô)
 * e OPTIONS/HEAD ficam de fora.
 */
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { parseAppVersion } from './app-version';
import {
  CENSUS_LOG_PREFIX,
  bodyPaths,
  censusClient,
  censusRegistry,
  queryPaths,
  type CensusClient,
} from './census-shape';

const logger = new Logger('Censo');

function isMultipart(req: Request): boolean {
  return /^multipart\//i.test(String(req.headers['content-type'] ?? ''));
}

/** `GET /tasks/:id` a partir da rota que o Express casou; `null` sem rota. */
export function routePattern(req: Request): string | null {
  const route = (req as Request & { route?: { path?: unknown } }).route;
  if (!route || route.path === undefined) return null;
  const path = typeof route.path === 'string' ? route.path : String(route.path);
  return `${req.method} ${req.baseUrl ?? ''}${path}`;
}

/** Nomes de campo dos arquivos que o multer leu (`single`, `array` ou `fields`). */
function fileFields(req: Request): string[] {
  const r = req as Request & {
    file?: { fieldname?: string };
    files?: { fieldname?: string }[] | Record<string, { fieldname?: string }[]>;
  };
  const out: string[] = [];
  if (r.file?.fieldname) out.push(r.file.fieldname);
  if (Array.isArray(r.files)) {
    for (const f of r.files) if (f?.fieldname) out.push(f.fieldname);
  } else if (r.files && typeof r.files === 'object') {
    out.push(...Object.keys(r.files));
  }
  return out;
}

@Injectable()
export class CensusMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    let early: { client: CensusClient; consulta: string[]; corpo: string[] | null } | null = null;
    try {
      req.appVersion = parseAppVersion(req.headers['x-app-version']);
      if (req.method !== 'OPTIONS' && req.method !== 'HEAD') {
        early = {
          client: censusClient(req.headers, req.appVersion?.raw ?? null),
          consulta: queryPaths(req.query),
          // multipart só existe depois do multer, na etapa 2
          corpo: isMultipart(req) ? null : bodyPaths(req.body),
        };
      }
    } catch {
      early = null;
    }

    if (early) {
      const seen = early;
      res.once('finish', () => {
        try {
          const rota = routePattern(req);
          if (!rota) return;
          const corpo =
            seen.corpo ?? bodyPaths(req.body, { multipart: true, fileFields: fileFields(req) });
          const novo = censusRegistry.record({
            rota,
            ...seen.client,
            consulta: seen.consulta,
            corpo,
          });
          if (novo) logger.log(`${CENSUS_LOG_PREFIX} ${JSON.stringify(novo)}`);
        } catch {
          // o censo é só leitura: nunca derruba nem atrasa o pedido
        }
      });
    }
    next();
  }
}
