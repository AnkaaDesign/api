/**
 * P31 — O PORTÃO DE VERSÃO DO APP (426).
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * No deploy da release do implemento, o app Flutter instalado (1.4.3+26, que
 * nem manda versão) passaria a gravar `truck`/`layouts` numa API que não os
 * conhece. O portão o recusa com 426 — e SÓ ele:
 *
 *   A. o predicado puro: desligado sem mínima; app abaixo, sem cabeçalho e com
 *      cabeçalho ilegível → 426; igual ou acima → passa; web, navegador,
 *      AnkaaAero, webhook e curl → passam; `/install` e `/version` abertos;
 *   B. de ponta a ponta num app Nest: o status é 426 de verdade, com a frase
 *      que a tela "Atualize o app" mostra, e a rota nem roda.
 *
 * Rodar: `npm run test:app-version-gate` (sem banco).
 */
import 'reflect-metadata';
import {
  Controller,
  Get,
  Logger,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { parseAppVersion } from '../src/modules/common/census/app-version';
import {
  APP_UPGRADE_REQUIRED_MESSAGE,
  appVersionGate,
  isFlutterAppRequest,
} from '../src/modules/common/census/app-version-gate';
import { CensusMiddleware } from '../src/modules/common/census/census.middleware';

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

const MIN = parseAppVersion('1.4.4+27');
const DART_UA = 'Dart/3.5 (dart:io)';

function verdict(headers: Record<string, string>, path = '/tasks/1', minimum = MIN) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return appVersionGate({
    minimum,
    appVersion: parseAppVersion(lower['x-app-version']),
    headers: lower,
    path,
  });
}

function parteA(): void {
  console.log('\nA. o predicado');
  check('sem mínima configurada, ninguém é barrado', verdict({ 'User-Agent': DART_UA }, '/tasks', null).allow);

  const velho = verdict({ 'X-App-Version': '1.4.3+26', 'X-App-Platform': 'android' });
  check('app abaixo da mínima → 426 OUTDATED', !velho.allow && velho.reason === 'OUTDATED', JSON.stringify(velho));
  check(
    'build menor na mesma versão → 426',
    !verdict({ 'X-App-Version': '1.4.4+26', 'X-App-Platform': 'ios' }).allow,
  );
  check('igual à mínima → passa', verdict({ 'X-App-Version': '1.4.4+27', 'X-App-Platform': 'ios' }).allow);
  check('acima da mínima → passa', verdict({ 'X-App-Version': '1.5.0+30', 'X-App-Platform': 'android' }).allow);

  const instalado = verdict({ 'User-Agent': DART_UA });
  check(
    'o app instalado hoje (Dart, sem cabeçalho de versão) → 426 MISSING',
    !instalado.allow && instalado.reason === 'MISSING' && instalado.received === null,
    JSON.stringify(instalado),
  );
  const lixo = verdict({ 'X-App-Version': 'abc', 'X-App-Platform': 'android' });
  check('cabeçalho ilegível → 426 INVALID', !lixo.allow && lixo.reason === 'INVALID', JSON.stringify(lixo));

  check('web (X-Client) passa', verdict({ 'X-Client': 'web@abc123', 'User-Agent': 'Mozilla/5.0 Chrome/129' }).allow);
  check('navegador (portal, página pública) passa', verdict({ 'User-Agent': 'Mozilla/5.0 Safari/605' }).allow);
  check(
    'AnkaaAero passa (instalado por cabo, sem OTA)',
    verdict({ 'X-App-Version': '0.1.0+2', 'X-App-Platform': 'ankaa-aero', 'User-Agent': 'AnkaaAero/2 CFNetwork' })
      .allow,
  );
  check('webhook/curl passa', verdict({ 'User-Agent': 'curl/8.0' }).allow);
  check('sem cabeçalho nenhum passa (não é o app)', verdict({}).allow);

  check('/install/version fica aberto para o app barrado', verdict({ 'User-Agent': DART_UA }, '/install/version').allow);
  check('/install/apk fica aberto', verdict({ 'User-Agent': DART_UA }, '/install/apk?x=1').allow);
  check('/version fica aberto', verdict({ 'User-Agent': DART_UA }, '/version').allow);
  check('/installments NÃO é /install', !verdict({ 'User-Agent': DART_UA }, '/installments').allow);
  // A sonda de conectividade e os BYTES de arquivo ficam abertos: o app pede
  // imagem por fora do Dio (sem X-App-Version), e o `/ping` usa um Dio próprio.
  check('/ping fica aberto (sonda de rede do app)', verdict({ 'User-Agent': DART_UA }, '/ping').allow);
  check('/files/serve/:id fica aberto (imagens)', verdict({ 'User-Agent': DART_UA }, '/files/serve/abc-123').allow);
  check(
    '/files/thumbnail/:id?size= fica aberto (miniaturas)',
    verdict({ 'User-Agent': DART_UA }, '/files/thumbnail/abc-123?size=small').allow,
  );
  check('/files/:id/download fica aberto', verdict({ 'User-Agent': DART_UA }, '/files/abc-123/download').allow);
  check('/files (lista) continua barrado', !verdict({ 'User-Agent': DART_UA }, '/files').allow);
  check('/files/:id (metadados) continua barrado', !verdict({ 'User-Agent': DART_UA }, '/files/abc-123').allow);
  check('/pingado NÃO é /ping', !verdict({ 'User-Agent': DART_UA }, '/pingado').allow);

  check('isFlutterAppRequest: plataforma manda (android)', isFlutterAppRequest({ 'x-app-platform': 'android' }));
  check('isFlutterAppRequest: Dart sem plataforma', isFlutterAppRequest({ 'user-agent': DART_UA }));
  check(
    'isFlutterAppRequest: X-Client vence o UA Dart',
    !isFlutterAppRequest({ 'user-agent': DART_UA, 'x-client': 'web@1' }),
  );
}

@Controller('gate-teste')
class GateTesteController {
  static hits = 0;
  @Get()
  get() {
    GateTesteController.hits++;
    return { ok: true };
  }
}

@Controller('install')
class InstallTesteController {
  @Get('version')
  version() {
    return { version: '1.4.4+27' };
  }
}

async function parteB(): Promise<void> {
  console.log('\nB. de ponta a ponta (Nest + Express)');
  process.env.MIN_MOBILE_APP_VERSION = '1.4.4+27';
  // Importado DEPOIS da env: a mínima é lida na construção do middleware.
  const { AppVersionGateMiddleware } = await import(
    '../src/modules/common/census/app-version-gate.middleware'
  );

  @Module({ controllers: [GateTesteController, InstallTesteController] })
  class GateTesteModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
      consumer.apply(CensusMiddleware).forRoutes('*');
      consumer.apply(AppVersionGateMiddleware).forRoutes('*');
    }
  }

  const app = await NestFactory.create(GateTesteModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  try {
    const barrado = await fetch(`${base}/gate-teste`, {
      headers: { 'X-App-Version': '1.4.3+26', 'X-App-Platform': 'android' },
    });
    const corpo = (await barrado.json()) as Record<string, unknown>;
    check('app velho recebe 426', barrado.status === 426, String(barrado.status));
    check('com a frase da tela "Atualize o app"', corpo.message === APP_UPGRADE_REQUIRED_MESSAGE, JSON.stringify(corpo));
    check('e a mínima no corpo', corpo.minimumVersion === '1.4.4+27', JSON.stringify(corpo));
    check('a rota não rodou', GateTesteController.hits === 0, String(GateTesteController.hits));

    const novo = await fetch(`${base}/gate-teste`, {
      headers: { 'X-App-Version': '1.4.4+27', 'X-App-Platform': 'android' },
    });
    check('app novo passa (200)', novo.status === 200, String(novo.status));

    const web = await fetch(`${base}/gate-teste`, { headers: { 'X-Client': 'web@1' } });
    check('web passa (200)', web.status === 200, String(web.status));

    const instalar = await fetch(`${base}/install/version`, { headers: { 'User-Agent': DART_UA } });
    check('o app barrado ainda lê /install/version (200)', instalar.status === 200, String(instalar.status));
  } finally {
    await app.close();
  }
}

async function main(): Promise<void> {
  Logger.overrideLogger(false);
  parteA();
  await parteB();
  console.log(failures ? `\n✗ ${failures} verificação(ões) falharam\n` : '\n✓ portão de versão: tudo verde\n');
  process.exit(failures ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
