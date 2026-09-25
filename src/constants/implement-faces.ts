/**
 * AS FACES DO IMPLEMENTO — a lista única da API.
 *
 * Cada face tem, no máximo, UMA medida corrente (`ImplementMeasure`), apontada
 * por uma coluna própria do implemento (`leftSideMeasureId`, …). O mapa face →
 * coluna mora no escritor único de medida
 * (`modules/production/implement-measure/implement-measure-writer.ts`); tudo
 * que percorre "os lados" percorre ESTA lista: a frente (P11b, R5) entrou aqui
 * e o `satisfies Record<ImplementFace, …>` de cada mapa apontou o resto.
 *
 * ⚠️ Na API, `left` = Motorista, `right` = Sapo, `back` = Traseira, `front` =
 * Frente (`implement-measure.service.ts`, `task-field-tracker.service.ts`). A
 * geometria 3D do estúdio usa a convenção oposta para `right`; não misture as duas.
 */
export const IMPLEMENT_FACES = ['left', 'right', 'back', 'front'] as const;

export type ImplementFace = (typeof IMPLEMENT_FACES)[number];

export function isImplementFace(value: unknown): value is ImplementFace {
  return typeof value === 'string' && (IMPLEMENT_FACES as readonly string[]).includes(value);
}

/**
 * O nome de cada face para GENTE (avisos, histórico, mensagens da API). A lista
 * única: um mapa local esquecido chamaria a frente de "Traseira".
 */
export const IMPLEMENT_FACE_LABELS = {
  left: 'Motorista',
  right: 'Sapo',
  back: 'Traseira',
  front: 'Frente',
} as const satisfies Record<ImplementFace, string>;

/**
 * As faces cuja medida leva FOTO: a traseira (a porta) e a frente. As laterais
 * são desenhadas pelas seções; foto nelas nunca foi pedida.
 */
export const IMPLEMENT_FACES_WITH_PHOTO: readonly ImplementFace[] = ['back', 'front'];

/**
 * A porta traseira do implemento (R5, DD4): as colunas que a tarefa e o
 * `PUT /implements/:id` gravam, a trilha acompanha e o aviso anuncia. `null`
 * apaga; ausente não mexe.
 */
export const IMPLEMENT_REAR_DOOR_FIELDS = ['rearDoorLeaves', 'rearDoorBarCount', 'rearDoorHatchCount'] as const;
