/**
 * G1 — contadores das chaves de consulta que a API recebe e o Prisma não
 * conhece. Em memória, por processo: é para o log e para o teste; o censo de
 * verdade (rota × chave × versão do app, persistido) é o G3, no P06.
 *
 * Três contadores:
 *   - `deprecated`: chave da tabela `DEPRECATED_QUERY_KEYS` usada (traduzida ou
 *     descartada);
 *   - `dropped`: chave que o schema zod da rota DESCARTOU calado (modo relatório
 *     da Fase A: não recusa, só conta e loga — o censo decide antes de virar 400);
 *   - `rejected`: chave inventada que chegaria ao Prisma e virou 400 nomeado.
 */
import { Logger } from '@nestjs/common';

export type QueryKeyEventKind = 'deprecated' | 'dropped' | 'rejected';

const logger = new Logger('ConsultaG1');
const counters = new Map<string, number>();

/**
 * O caminho vem do CLIENTE (chaves que ele mandou): sem teto, um usuário
 * autenticado mandando includes aleatórios faria o mapa crescer sem fim e
 * geraria uma linha de log por chave nova. Passado o teto de entradas, tudo o
 * que é novo cai num balde só por espécie e modelo; o caminho é cortado.
 */
export const MAX_QUERY_KEY_COUNTERS = 2000;
export const MAX_QUERY_KEY_PATH = 200;
export const OVERFLOW_PATH = '(outros)';

/** `kind|Model.clause|caminho` → quantas vezes */
export function recordQueryKeyEvent(
  kind: QueryKeyEventKind,
  model: string,
  path: string,
  detail?: string,
): void {
  const cut = path.length > MAX_QUERY_KEY_PATH ? `${path.slice(0, MAX_QUERY_KEY_PATH)}…` : path;
  let k = `${kind}|${model.slice(0, 64)}|${cut}`;
  if (!counters.has(k) && counters.size >= MAX_QUERY_KEY_COUNTERS) {
    k = `${kind}|${model.slice(0, 64)}|${OVERFLOW_PATH}`;
    detail = undefined;
  }
  if (detail && detail.length > 300) detail = `${detail.slice(0, 300)}…`;
  const n = (counters.get(k) ?? 0) + 1;
  counters.set(k, n);
  // Loga a primeira ocorrência e depois a cada 100: o bastante para achar no
  // log sem inundá-lo com a mesma tela aberta o dia inteiro.
  if (n === 1 || n % 100 === 0) {
    const shown = k.slice(k.indexOf('|', k.indexOf('|') + 1) + 1);
    const msg = `[${kind}] ${model.slice(0, 64)} ${shown}${detail ? ` — ${detail}` : ''} (×${n})`;
    if (kind === 'rejected') logger.warn(msg);
    else logger.log(msg);
  }
}

export function queryKeyCounters(): Record<string, number> {
  return Object.fromEntries(counters);
}

export function resetQueryKeyCounters(): void {
  counters.clear();
}
