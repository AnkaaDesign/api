/**
 * G13 (lado da API, só leitura) — a versão do app que fez o pedido.
 *
 * O app Flutter manda `X-App-Version: 1.4.1+24` (versão + número do build, de
 * `package_info`) e `X-App-Patch` (o patch do Shorebird). O censo (G3) põe
 * `req.appVersion` no pedido para que quem conta por versão (o contador do
 * alias do P11a, o G1) não tenha de refazer o parse. Aqui NÃO há portão: o 426
 * para versão velha ou pedido sem cabeçalho é do P31 (R-C).
 *
 * O cabeçalho vem do cliente: qualquer coisa fora do formato vira `null`, nunca
 * exceção, e nada do texto cru sai daqui sem ter passado pelo formato.
 */

export interface AppVersion {
  /** `1.4.1+24` normalizado (sem espaços); `1.4.1` quando não veio build */
  raw: string;
  major: number;
  minor: number;
  patch: number;
  /** o número depois do `+`; `null` quando o cabeçalho não trouxe */
  build: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Versão do app lida de `X-App-Version` pelo censo (G3). `null` quando o
       * pedido não trouxe o cabeçalho ou trouxe lixo (o web e o `AnkaaAero` não
       * mandam); `undefined` só antes do middleware do censo rodar.
       */
      appVersion?: AppVersion | null;
    }
  }
}

/** `1.4.1`, `1.4.1+24`, `v1.4.1` (o `v` é tolerado); três partes numéricas. */
const APP_VERSION = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:\+(\d{1,9}))?$/;

export function parseAppVersion(header: string | string[] | undefined | null): AppVersion | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 32) return null;
  const m = APP_VERSION.exec(trimmed);
  if (!m) return null;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const build = m[4] !== undefined ? Number(m[4]) : null;
  return {
    raw: `${major}.${minor}.${patch}${build !== null ? `+${build}` : ''}`,
    major,
    minor,
    patch,
    build,
  };
}

/**
 * Ordem de versão (major, minor, patch; o build desempata só quando os dois
 * têm). Negativo: `a` é mais velha. Para o portão do P31 e para o contador.
 */
export function compareAppVersion(a: AppVersion, b: AppVersion): number {
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    (a.build !== null && b.build !== null ? a.build - b.build : 0)
  );
}
