/**
 * P31 — o portão de versão do app (426 Upgrade Required).
 *
 * A release do implemento muda nomes e formas que o app instalado manda
 * (`truck`, `layouts` na tarefa, o grafo antigo do orçamento). Um app velho que
 * continuasse falando com a API nova não "funcionaria pior": gravaria dado no
 * formato errado ou mostraria tela vazia. A saída é recusar a versão inteira com
 * 426 — o app da branch já tem a tela bloqueante "Atualize o app" para isso
 * (`UpgradeRequiredGate`, `lib/core/network/app_version_interceptor.dart`).
 *
 * QUEM É O APP (e só ele é barrado):
 *   · `X-App-Platform: android | ios` — o app Flutter da branch, que manda
 *     `X-App-Version` em todo pedido;
 *   · User-Agent `Dart/…` sem cabeçalho de versão — o app Flutter INSTALADO hoje
 *     (1.4.3+26, da `main`), que ainda não manda versão nenhuma. É exatamente
 *     ele que o portão existe para parar.
 *
 * QUEM NÃO É BARRADO:
 *   · o web (`X-Client: web@<build>`) e os navegadores (portal, páginas
 *     públicas): sobem junto com a API, não há versão velha deles no ar;
 *   · o AnkaaAero (`X-App-Platform: ankaa-aero`): é instalado por cabo nos
 *     iPads, sem loja e sem OTA — uma recusa o deixaria inutilizável até alguém
 *     plugar o cabo. A build nova dele é instalada ANTES do deploy (PLANO §6.7);
 *   · webhooks e scripts (Meta, Sicredi, curl, node): não são o app.
 *
 * O QUE CONTINUA ABERTO para o app barrado: `/install/*` e `/version` — é por
 * eles que a tela "Atualize o app" descobre a versão nova e baixa o instalador.
 *
 * Desligado quando `MIN_MOBILE_APP_VERSION` está vazio: o portão só liga no
 * deploy da release, quando a build nova já está publicada.
 *
 * Puro (sem Nest, sem Express) para ser lido e testado sem subir a aplicação;
 * quem responde é `AppVersionGateMiddleware`.
 */
import { compareAppVersion, type AppVersion } from './app-version';
import { uaFamily } from './census-shape';

/** Os sistemas que o app Flutter manda em `X-App-Platform`. */
const FLUTTER_PLATFORMS = new Set(['android', 'ios']);

/** Prefixos que ficam abertos para o app barrado: é por eles que ele se atualiza. */
const UPGRADE_PATHS = [/^\/install(\/|$|\?)/, /^\/version(\/|$|\?)/];

/**
 * Uma interface só (e não união discriminada): sem `strictNullChecks` o tsc do
 * repo não estreita pelo `allow`.
 */
export interface AppVersionGateVerdict {
  allow: boolean;
  /** `OUTDATED`: abaixo da mínima; `MISSING`: app sem cabeçalho de versão; `INVALID`: cabeçalho ilegível */
  reason: 'OUTDATED' | 'MISSING' | 'INVALID' | null;
  minimum: string | null;
  received: string | null;
}

const ALLOW: AppVersionGateVerdict = { allow: true, reason: null, minimum: null, received: null };

export interface AppVersionGateInput {
  /** A versão mínima (`MIN_MOBILE_APP_VERSION` já lido); `null` = portão desligado. */
  minimum: AppVersion | null;
  /** `req.appVersion` (o censo já leu); `null` quando ausente ou ilegível. */
  appVersion: AppVersion | null;
  headers: Record<string, string | string[] | undefined>;
  /** O caminho do pedido (`req.originalUrl`). */
  path: string;
}

function headerValue(value: string | string[] | undefined): string | null {
  const v = (Array.isArray(value) ? value[0] : value)?.trim();
  return v ? v : null;
}

/** O pedido veio do app Flutter (o da branch ou o instalado hoje)? */
export function isFlutterAppRequest(headers: AppVersionGateInput['headers']): boolean {
  const platform = headerValue(headers['x-app-platform'])?.toLowerCase() ?? null;
  if (platform !== null) return FLUTTER_PLATFORMS.has(platform);
  if (headerValue(headers['x-client']) !== null) return false;
  return uaFamily(headers['user-agent']) === 'Dart';
}

export function appVersionGate(input: AppVersionGateInput): AppVersionGateVerdict {
  const { minimum, appVersion, headers, path } = input;
  if (!minimum) return ALLOW;
  if (UPGRADE_PATHS.some(re => re.test(path))) return ALLOW;
  if (!isFlutterAppRequest(headers)) return ALLOW;

  const header = headerValue(headers['x-app-version']);
  if (!appVersion) {
    return {
      allow: false,
      reason: header === null ? 'MISSING' : 'INVALID',
      minimum: minimum.raw,
      received: header,
    };
  }
  if (compareAppVersion(appVersion, minimum) < 0) {
    return { allow: false, reason: 'OUTDATED', minimum: minimum.raw, received: appVersion.raw };
  }
  return ALLOW;
}

/** 426 Upgrade Required (o `HttpStatus` do Nest não tem a constante). */
export const HTTP_UPGRADE_REQUIRED = 426;

/** A frase que a tela "Atualize o app" mostra. */
export const APP_UPGRADE_REQUIRED_MESSAGE =
  'Esta versão do aplicativo não é mais compatível com o sistema. Atualize o app para continuar.';
