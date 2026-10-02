/**
 * P31 — responde 426 ao app abaixo da versão mínima (ver `app-version-gate.ts`).
 *
 * Registrado DEPOIS do censo em `app.module.ts`: o censo já pôs
 * `req.appVersion`, e a forma recusada continua contada (o censo registra no
 * `finish`, que também acontece para o 426).
 */
import { HttpException, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { parseAppVersion, type AppVersion } from './app-version';
import { APP_UPGRADE_REQUIRED_MESSAGE, HTTP_UPGRADE_REQUIRED, appVersionGate } from './app-version-gate';

@Injectable()
export class AppVersionGateMiddleware implements NestMiddleware {
  private readonly logger = new Logger('AppVersionGate');
  private readonly minimum: AppVersion | null;

  constructor() {
    const configured = process.env.MIN_MOBILE_APP_VERSION?.trim() ?? '';
    this.minimum = configured ? parseAppVersion(configured) : null;
    if (configured && !this.minimum) {
      // `env.validation` já recusa o formato; isto só cobre quem pulou a validação.
      throw new Error(`MIN_MOBILE_APP_VERSION inválida: "${configured}" (use 1.4.4+27)`);
    }
    if (this.minimum) this.logger.log(`App abaixo de ${this.minimum.raw} recebe 426`);
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    if (req.method === 'OPTIONS') return next();
    const verdict = appVersionGate({
      minimum: this.minimum,
      appVersion: req.appVersion ?? parseAppVersion(req.headers['x-app-version']),
      headers: req.headers,
      path: req.originalUrl ?? req.url,
    });
    if (verdict.allow) return next();
    throw new HttpException(
      {
        statusCode: HTTP_UPGRADE_REQUIRED,
        error: 'UPGRADE_REQUIRED',
        message: APP_UPGRADE_REQUIRED_MESSAGE,
        reason: verdict.reason,
        minimumVersion: verdict.minimum,
        receivedVersion: verdict.received,
      },
      HTTP_UPGRADE_REQUIRED,
    );
  }
}
