/**
 * O ESCRITOR ÚNICO DE MEDIDA DO IMPLEMENTO (P04, D-05/D-07 do plano).
 *
 * Havia dez caminhos gravando `ImplementMeasure` (criação e lote de tarefa,
 * edição e lote de edição, reversão pelo histórico, cópia entre tarefas, o
 * módulo `/implement-measure`, a identificação e a requisição do portal, e a
 * réplica aos irmãos do orçamento), cada um com a SUA regra para a linha
 * compartilhada: um copiava antes de editar, outro editava no lugar, outro
 * apagava a linha "órfã" olhando só um dos lados, outro engolia o erro com
 * `.catch()` dentro da transação. Resultado: o cliente corrigia o próprio
 * furgão pelo portal e mudava o de outro cliente.
 *
 * Todos passam por aqui agora, e a regra é UMA:
 *
 *   1. Cada face de cada implemento tem a SUA linha. Nada daqui para frente
 *      compartilha linha: replicar é COPIAR.
 *   2. Editar (`setFace`, modo `patch`) atualiza a própria linha quando mais
 *      ninguém a usa; se outra face — deste ou de outro implemento — aponta para
 *      ela, nasce uma cópia só deste lado (copy-on-write) e a antiga fica com
 *      quem a usa.
 *   3. Apagar a face desconecta e só remove a linha quando NINGUÉM mais a usa
 *      (nenhuma face de nenhum implemento) E nenhuma `PaintingAnalysis` a aponta
 *      — a análise de pintura perdia o vínculo em silêncio (`SetNull`).
 *   4. Nada de `.catch()` dentro da transação: no Postgres, um comando que
 *      falha aborta a transação inteira, e o erro seguinte vira "current
 *      transaction is aborted" longe da causa.
 *
 * O escritor NÃO grava trilha (changelog) nem notificação: cada caminho tem a
 * sua (textos e campos diferentes, que o histórico já mostra) e continua com
 * ela. Por isso toda escrita devolve o ANTES e o DEPOIS da face.
 *
 * Funções puras sobre a transação do chamador, sem Nest — os testes (G15) e o
 * portal as chamam direto.
 *
 * ⚠️ A tabela que carrega as colunas de face ainda se chama como o implemento no
 * Prisma; ela aparece em DOIS pontos deste arquivo (`holderOf` e `HolderKey`),
 * que são o que muda quando o P11 renomear o modelo.
 */
import type { Prisma } from '@prisma/client';
import { IMPLEMENT_FACES, type ImplementFace } from '../../../constants/implement-faces';

export type { ImplementFace } from '../../../constants/implement-faces';

// ═══════════════════════════════════════════════════════════════════════════
// AS FACES E AS COLUNAS
// ═══════════════════════════════════════════════════════════════════════════

export const FACES: readonly ImplementFace[] = IMPLEMENT_FACES;

/** As chaves da tabela que carrega as faces (colunas e relações). */
type HolderKey = keyof Prisma.ImplementSelect;

/** Face → coluna (FK) no implemento. Tipado contra o Prisma: renomear a coluna quebra o `tsc`. */
export const FACE_FK = {
  left: 'leftSideMeasureId',
  right: 'rightSideMeasureId',
  back: 'backSideMeasureId',
} as const satisfies Record<ImplementFace, HolderKey>;

/** Face → relação no implemento (para `select`/`include`). */
export const FACE_REL = {
  left: 'leftSideMeasure',
  right: 'rightSideMeasure',
  back: 'backSideMeasure',
} as const satisfies Record<ImplementFace, HolderKey>;

/** Face → relação inversa em `ImplementMeasure` (quem aponta para a linha por esta face). */
export const FACE_INVERSE = {
  left: 'implementsLeftSide',
  right: 'implementsRightSide',
  back: 'implementsBackSide',
} as const satisfies Record<ImplementFace, keyof Prisma.ImplementMeasureInclude>;

export type FaceFk = (typeof FACE_FK)[ImplementFace];

/**
 * A face a partir de um nome de campo: a coluna (`leftSideMeasureId`), a
 * relação (`leftSideMeasure`), a chave de foto do multipart (`leftSide`) ou a
 * própria face (`left`).
 */
export function faceOf(field: string | null | undefined): ImplementFace | null {
  if (!field) return null;
  for (const face of FACES) {
    if (field.startsWith(face)) return face;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════

/** Tudo de que o escritor precisa da transação do chamador. */
export type MeasureTx = Omit<
  Prisma.TransactionClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Uma seção como os caminhos a recebem (METROS). `position` ausente = índice.
 * (`width` opcional só no tipo: sem `strict`, o `z.infer` dos schemas de medida
 * sai com tudo opcional; a validação é do zod de cada rota.)
 */
export interface MeasureSectionInput {
  width?: number;
  isDoor?: boolean;
  doorHeight?: number | null;
  position?: number | null;
}

/**
 * O que se grava numa face (METROS). Em `patch`, o ausente preserva o que já
 * existe: `height` indefinida mantém a altura, `sections` ausente ou VAZIA
 * mantém as seções (salvar parcial apagava as medidas — o defeito "as medidas
 * sumiram ao salvar"), `photoId` indefinido mantém a foto e `null`/`''` a tira.
 */
export interface MeasureInput {
  height?: number;
  sections?: MeasureSectionInput[] | null;
  photoId?: string | null;
}

export type MeasureWithSections = Prisma.ImplementMeasureGetPayload<{
  include: { sections: true };
}>;

/**
 * `patch`   (padrão) edita a linha da face quando é só dela; se não é, copia
 *           (copy-on-write); sem linha, cria.
 * `replace` sempre grava uma linha NOVA com os dados recebidos e solta a
 *           anterior (é o "substituir" do módulo de medidas, da cópia entre
 *           tarefas e da réplica aos irmãos).
 */
export type FaceWriteMode = 'patch' | 'replace';

export interface FaceWriteResult {
  face: ImplementFace;
  fk: FaceFk;
  /**
   * `unchanged` nada foi escrito · `created` a face não tinha linha ·
   * `updated` a própria linha foi editada no lugar · `forked` a linha era usada
   * por outra face e esta ganhou uma cópia · `replaced` linha nova no lugar da
   * anterior (`replace`, ou anexar uma linha já existente) · `removed` a face
   * ficou sem medida.
   */
  action: 'unchanged' | 'created' | 'updated' | 'forked' | 'replaced' | 'removed';
  previousId: string | null;
  measureId: string | null;
  before: MeasureWithSections | null;
  after: MeasureWithSections | null;
  /** O destino da linha anterior quando a face deixou de apontá-la. */
  previous: 'deleted' | 'kept' | null;
}

const WITH_SECTIONS = {
  sections: { orderBy: { position: 'asc' as const } },
} satisfies Prisma.ImplementMeasureInclude;

// ═══════════════════════════════════════════════════════════════════════════
// LEITURA E CONTAGEM
// ═══════════════════════════════════════════════════════════════════════════

/** O modelo que carrega as colunas de face (o único acesso a ele neste arquivo). */
function holderOf(tx: MeasureTx) {
  return tx.implement;
}

function assertFace(face: ImplementFace): FaceFk {
  const fk = FACE_FK[face];
  if (!fk) throw new Error(`Face de implemento desconhecida: ${String(face)}`);
  return fk;
}

async function readMeasure(tx: MeasureTx, id: string): Promise<MeasureWithSections | null> {
  return tx.implementMeasure.findUnique({ where: { id }, include: WITH_SECTIONS });
}

/** A coluna de face atual de um implemento (lança quando o implemento não existe). */
async function currentFaceId(tx: MeasureTx, holderId: string, face: ImplementFace) {
  const fk = assertFace(face);
  const row = (await holderOf(tx).findUnique({
    where: { id: holderId },
    select: { id: true, [fk]: true },
  })) as Record<string, string | null> | null;
  if (!row) throw new Error(`Implemento ${holderId} não encontrado para gravar a medida (${face}).`);
  return row[fk] ?? null;
}

export interface MeasureReference {
  holderId: string;
  taskId: string;
  face: ImplementFace;
}

/** Toda face (de qualquer implemento) que aponta para a linha, na ordem de `FACES`. */
export async function referencesOf(tx: MeasureTx, measureId: string): Promise<MeasureReference[]> {
  const refs: MeasureReference[] = [];
  for (const face of FACES) {
    const rows = await holderOf(tx).findMany({
      where: { [FACE_FK[face]]: measureId },
      select: { id: true, taskId: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const r of rows) refs.push({ holderId: r.id, taskId: r.taskId, face });
  }
  return refs;
}

async function referenceCount(tx: MeasureTx, measureId: string): Promise<number> {
  let total = 0;
  for (const face of FACES) {
    total += await holderOf(tx).count({ where: { [FACE_FK[face]]: measureId } });
  }
  return total;
}

/**
 * Remove a linha SE ninguém mais a usa (nenhuma face de nenhum implemento) e
 * nenhuma análise de pintura a aponta. Chamar DEPOIS de desconectar a face.
 */
export async function releaseMeasure(
  tx: MeasureTx,
  measureId: string | null | undefined,
): Promise<'deleted' | 'kept' | null> {
  if (!measureId) return null;
  const exists = await tx.implementMeasure.findUnique({
    where: { id: measureId },
    select: { id: true },
  });
  if (!exists) return null;
  const [refs, analyses] = await Promise.all([
    referenceCount(tx, measureId),
    tx.paintingAnalysis.count({ where: { implementMeasureId: measureId } }),
  ]);
  if (refs > 0 || analyses > 0) return 'kept';
  await tx.implementMeasureSection.deleteMany({ where: { implementMeasureId: measureId } });
  await tx.implementMeasure.delete({ where: { id: measureId } });
  return 'deleted';
}

// ═══════════════════════════════════════════════════════════════════════════
// ESCRITA
// ═══════════════════════════════════════════════════════════════════════════

function sectionRows(sections: MeasureSectionInput[] | null | undefined) {
  return (sections ?? []).map((section, index) => ({
    width: section.width,
    isDoor: section.isDoor,
    doorHeight: section.doorHeight,
    position: section.position ?? index,
  })) as Prisma.ImplementMeasureSectionCreateWithoutImplementMeasureInput[];
}

function hasSections(sections: MeasureSectionInput[] | null | undefined): boolean {
  return Array.isArray(sections) && sections.length > 0;
}

/**
 * Cria uma linha de medida SEM implemento (a biblioteca de `POST /implement-measure`)
 * — e é o único `create` de medida do sistema.
 */
export async function createMeasure(
  tx: MeasureTx,
  data: MeasureInput,
): Promise<MeasureWithSections> {
  return tx.implementMeasure.create({
    data: {
      height: data.height as number,
      ...(data.photoId && { photo: { connect: { id: data.photoId } } }),
      sections: { create: sectionRows(data.sections) },
    },
    include: WITH_SECTIONS,
  });
}

/** Os dados de uma linha existente, prontos para virar outra (cópia). */
function inputOf(measure: MeasureWithSections): MeasureInput {
  return {
    height: measure.height,
    photoId: measure.photoId ?? null,
    sections: [...measure.sections]
      .sort((a, b) => a.position - b.position)
      .map(s => ({
        width: s.width,
        isDoor: s.isDoor,
        doorHeight: s.doorHeight,
        position: s.position,
      })),
  };
}

async function pointFace(tx: MeasureTx, holderId: string, fk: FaceFk, measureId: string | null) {
  await holderOf(tx).update({ where: { id: holderId }, data: { [fk]: measureId } });
}

/**
 * Grava (ou apaga, com `null`) a medida de UMA face de um implemento.
 *
 * `undefined` não é aceito aqui: "o lado não veio no pedido" é decisão do
 * chamador (pular), não do escritor.
 */
export async function setFace(
  tx: MeasureTx,
  holderId: string,
  face: ImplementFace,
  data: MeasureInput | null,
  opts: { mode?: FaceWriteMode } = {},
): Promise<FaceWriteResult> {
  const fk = assertFace(face);
  const previousId = await currentFaceId(tx, holderId, face);
  const before = previousId ? await readMeasure(tx, previousId) : null;
  const base = { face, fk, previousId, before };

  // ── apagar a face ──────────────────────────────────────────────────────
  if (data === null) {
    if (!previousId) {
      return { ...base, action: 'unchanged', measureId: null, after: null, previous: null };
    }
    await pointFace(tx, holderId, fk, null);
    const previous = await releaseMeasure(tx, previousId);
    return { ...base, action: 'removed', measureId: null, after: null, previous };
  }

  const mode = opts.mode ?? 'patch';

  // ── editar a própria linha, ou copiar se ela é de mais alguém ──────────
  if (mode === 'patch' && previousId && before) {
    // Outras faces (deste ou de outro implemento) que apontam para a mesma linha.
    const others = (await referenceCount(tx, previousId)) - 1;

    if (others <= 0) {
      const rewrite = hasSections(data.sections);
      if (rewrite) {
        await tx.implementMeasureSection.deleteMany({ where: { implementMeasureId: previousId } });
      }
      const after = await tx.implementMeasure.update({
        where: { id: previousId },
        data: {
          ...(data.height !== undefined && { height: data.height }),
          ...(data.photoId !== undefined && { photoId: data.photoId || null }),
          ...(rewrite && { sections: { create: sectionRows(data.sections) } }),
        },
        include: WITH_SECTIONS,
      });
      return { ...base, action: 'updated', measureId: previousId, after, previous: null };
    }

    // Copy-on-write: o que o pedido não trouxe vem da linha atual.
    const current = inputOf(before);
    const after = await createMeasure(tx, {
      height: data.height !== undefined ? data.height : current.height,
      photoId: data.photoId !== undefined ? data.photoId || null : current.photoId,
      sections: hasSections(data.sections) ? data.sections : current.sections,
    });
    await pointFace(tx, holderId, fk, after.id);
    return { ...base, action: 'forked', measureId: after.id, after, previous: 'kept' };
  }

  // ── linha nova (face vazia, `replace`, ou a linha apontada sumiu) ──────
  const after = await createMeasure(tx, data);
  await pointFace(tx, holderId, fk, after.id);
  const previous = previousId ? await releaseMeasure(tx, previousId) : null;
  return {
    ...base,
    action: previousId ? 'replaced' : 'created',
    measureId: after.id,
    after,
    previous,
  };
}

/**
 * Troca só a FOTO da face (upload multipart de `implementMeasurePhotos.*`).
 * Face sem medida: não há onde pendurar a foto — nada acontece (é o que os
 * caminhos de edição sempre fizeram). Linha usada por outra face: copia.
 */
export async function setFacePhoto(
  tx: MeasureTx,
  holderId: string,
  face: ImplementFace,
  photoId: string,
): Promise<FaceWriteResult | null> {
  const previousId = await currentFaceId(tx, holderId, face);
  if (!previousId) return null;
  return setFace(tx, holderId, face, { photoId });
}

/**
 * Pendura na face uma linha que JÁ existe (atribuir da biblioteca, reverter
 * pelo histórico). Se ninguém a usa, a face passa a apontá-la; se alguma face
 * já a usa, a face ganha uma CÓPIA — é aqui que "atribuir a mesma medida a dois
 * implementos" deixou de amarrá-los para sempre.
 *
 * Devolve `null` quando a linha não existe (o chamador decide o que fazer).
 */
export async function attachMeasure(
  tx: MeasureTx,
  holderId: string,
  face: ImplementFace,
  measureId: string,
): Promise<FaceWriteResult | null> {
  const fk = assertFace(face);
  const previousId = await currentFaceId(tx, holderId, face);
  const before = previousId ? await readMeasure(tx, previousId) : null;
  const base = { face, fk, previousId, before };

  const target = await readMeasure(tx, measureId);
  if (!target) return null;

  if (previousId === measureId) {
    return { ...base, action: 'unchanged', measureId, after: target, previous: null };
  }

  if ((await referenceCount(tx, measureId)) > 0) {
    return setFace(tx, holderId, face, inputOf(target), { mode: 'replace' });
  }

  await pointFace(tx, holderId, fk, measureId);
  const previous = await releaseMeasure(tx, previousId);
  return {
    ...base,
    action: previousId ? 'replaced' : 'created',
    measureId,
    after: target,
    previous,
  };
}

/**
 * Copia as faces de um implemento para outro, cada uma como linha NOVA (cópia
 * entre tarefas). Face vazia na origem não mexe no destino.
 */
export async function cloneFaces(
  tx: MeasureTx,
  fromHolderId: string,
  toHolderId: string,
  faces: readonly ImplementFace[] = FACES,
): Promise<FaceWriteResult[]> {
  const results: FaceWriteResult[] = [];
  for (const face of faces) {
    const sourceId = await currentFaceId(tx, fromHolderId, face);
    const source = sourceId ? await readMeasure(tx, sourceId) : null;
    if (!source) continue;
    results.push(await setFace(tx, toHolderId, face, inputOf(source), { mode: 'replace' }));
  }
  return results;
}

/**
 * Edita uma linha pelo ID (`PUT /implement-measure/:id`) — sem contexto de
 * implemento. A edição vale para toda face que usava a linha (como sempre valeu),
 * mas cada uma termina com a SUA linha: a primeira referência fica com esta, as
 * demais ganham cópias do resultado. Devolve as referências de ANTES, para o
 * chamador replicar aos irmãos de cada implemento.
 */
export async function rewriteMeasure(
  tx: MeasureTx,
  measureId: string,
  data: MeasureInput,
): Promise<{ measure: MeasureWithSections; references: MeasureReference[] }> {
  const references = await referencesOf(tx, measureId);

  if (data.sections) {
    await tx.implementMeasureSection.deleteMany({ where: { implementMeasureId: measureId } });
  }
  const measure = await tx.implementMeasure.update({
    where: { id: measureId },
    data: {
      ...(data.height !== undefined && { height: data.height }),
      ...(data.photoId !== undefined && { photoId: data.photoId || null }),
      ...(data.sections && { sections: { create: sectionRows(data.sections) } }),
    },
    include: WITH_SECTIONS,
  });

  for (const ref of references.slice(1)) {
    await setFace(tx, ref.holderId, ref.face, inputOf(measure), { mode: 'replace' });
  }
  return { measure, references };
}

/**
 * Apaga uma linha pelo ID (`DELETE /implement-measure/:id`). A recusa por uso
 * é do chamador (que tem a mensagem de sempre e o `force`); aqui as faces que
 * ainda a apontem são desconectadas e a linha apontada por uma análise de
 * pintura NUNCA sai.
 */
export async function deleteMeasure(tx: MeasureTx, measureId: string): Promise<void> {
  const refs = await referencesOf(tx, measureId);
  const analyses = await tx.paintingAnalysis.count({ where: { implementMeasureId: measureId } });
  if (analyses > 0) {
    throw new Error(
      `Esta medida está ligada a ${analyses} análise(s) de pintura e não pode ser apagada.`,
    );
  }
  for (const ref of refs) await pointFace(tx, ref.holderId, FACE_FK[ref.face], null);
  await tx.implementMeasureSection.deleteMany({ where: { implementMeasureId: measureId } });
  await tx.implementMeasure.delete({ where: { id: measureId } });
}
