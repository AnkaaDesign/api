/**
 * AS FACES DO IMPLEMENTO — a lista única da API.
 *
 * Cada face tem, no máximo, UMA medida corrente (`ImplementMeasure`), apontada
 * por uma coluna própria do caminhão (`leftSideMeasureId`, …). O mapa face →
 * coluna mora no escritor único de medida
 * (`modules/production/implement-measure/implement-measure-writer.ts`); tudo
 * que percorre "os lados" percorre ESTA lista, para que a face nova (a frente,
 * no P11) entre num lugar só.
 *
 * ⚠️ Na API, `left` = Motorista, `right` = Sapo, `back` = Traseira
 * (`implement-measure.service.ts`, `task-field-tracker.service.ts`). A geometria
 * 3D do estúdio usa a convenção oposta para `right`; não misture as duas.
 */
export const IMPLEMENT_FACES = ['left', 'right', 'back'] as const;

export type ImplementFace = (typeof IMPLEMENT_FACES)[number];

export function isImplementFace(value: unknown): value is ImplementFace {
  return typeof value === 'string' && (IMPLEMENT_FACES as readonly string[]).includes(value);
}
