/**
 * O TAMANHO É DO ORÇAMENTO — as medidas do implemento, replicadas aos irmãos.
 *
 * Decisão do dono (23/09/2026): mesmo orçamento ⇒ mesmo tamanho. O preço de um
 * orçamento é UM por veículo justamente porque os N caminhões são o mesmo
 * implemento; o que pode variar entre eles é a PINTURA (o layout aprovado, que
 * passou a poder ser por veículo), não a medida. Quando a Logística mede um dos
 * caminhões, os demais do mesmo orçamento recebem as MESMAS medidas — sem isso,
 * a produção abria o segundo caminhão e o encontrava sem medida nenhuma, ou com
 * uma de outra visita.
 *
 * POR CÓPIA, NUNCA COMPARTILHANDO A LINHA
 *   Cada irmão ganha uma linha `ImplementMeasure` nova (mesma altura, mesmas
 *   seções, mesma foto). Compartilhar a linha amarraria os caminhões para sempre:
 *   um veículo pode sair do orçamento amanhã, e editar a medida dele não pode
 *   mexer na dos que ficaram. A escrita passa pelo escritor único
 *   (`implement-measure-writer.ts`, modo `replace`), que é quem decide o que
 *   acontece com a linha anterior do irmão.
 *
 *   A foto é o MESMO `File` (é a foto do implemento, que é o mesmo): nenhuma
 *   rota apaga o arquivo da foto ao apagar a medida, então compartilhá-lo não
 *   cria o risco que compartilhar a linha criaria.
 *
 * O QUE REPLICA E O QUE NÃO
 *   - criação e atualização de um lado replicam;
 *   - EXCLUSÃO NÃO replica — tirar a medida de um caminhão é quase sempre
 *     corrigir aquele caminhão, e apagar a dos irmãos por tabela seria destruir
 *     trabalho medido;
 *   - só o lado que DIFERE é escrito: o irmão que já tem exatamente a mesma
 *     medida não ganha linha nova nem entrada na trilha (é o que torna a rotina
 *     idempotente, e é o que faz a gravação em lote não se replicar em cascata);
 *   - todo irmão tem implemento (DD1); se um faltasse (defeito de dado), ele é
 *     pulado e o log diz qual — esta rotina não cria implemento.
 *
 * Mesma transação da escrita de origem: ou a medida existe nos N caminhões, ou
 * em nenhum.
 */
import { Logger } from '@nestjs/common';
import { sortQuoteTasks } from './quote-tasks';
import { vehicleLabel } from './quote-layout-coverage';
import {
  FACES,
  FACE_FK,
  FACE_REL,
  setFace,
  type ImplementFace,
} from '../modules/production/implement-measure/implement-measure-writer';

const logger = new Logger('ImplementMeasureReplication');

interface MeasureRow {
  id: string;
  height: number;
  photoId: string | null;
  sections: Array<{ width: number; isDoor: boolean; doorHeight: number | null; position: number }>;
}

const MEASURE_SELECT = {
  select: {
    id: true,
    height: true,
    photoId: true,
    sections: {
      orderBy: { position: 'asc' as const },
      select: { width: true, isDoor: true, doorHeight: true, position: true },
    },
  },
};

const IMPLEMENT_MEASURES_SELECT = {
  select: {
    id: true,
    plate: true,
    ...Object.fromEntries(FACES.map(face => [FACE_FK[face], true])),
    ...Object.fromEntries(FACES.map(face => [FACE_REL[face], MEASURE_SELECT])),
  },
};

/** A identidade de uma medida — o que precisa ser igual para "o irmão já tem a mesma". */
function measureKey(m: MeasureRow | null | undefined): string {
  if (!m) return '∅';
  return JSON.stringify({
    h: Number(m.height),
    p: m.photoId ?? null,
    s: [...(m.sections ?? [])]
      .sort((a, b) => a.position - b.position)
      .map(s => [
        Number(s.width),
        !!s.isDoor,
        s.doorHeight == null ? null : Number(s.doorHeight),
        s.position,
      ]),
  });
}

/** O mesmo recorte que `TaskService` grava no campo `implementMeasures` da trilha. */
export function formatMeasureForChangelog(m: MeasureRow | null | undefined) {
  if (!m) return null;
  const sections = m.sections ?? [];
  return {
    id: m.id ?? null,
    height: m.height || 0,
    totalWidth: sections.reduce((sum, s) => sum + (s.width || 0), 0),
    doorCount: sections.filter(s => s.isDoor).length,
    sectionCount: sections.length,
    sections: sections.map(s => ({
      width: s.width,
      isDoor: s.isDoor,
      doorHeight: s.doorHeight,
      position: s.position,
    })),
  };
}

export interface ReplicationLogEntry {
  taskId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
}

export interface ReplicationResult {
  /** Lados escritos nos irmãos: `taskId` → lados. */
  replicated: Array<{ taskId: string; side: ImplementFace; implementMeasureId: string }>;
  /** Irmãos pulados, com o motivo (sem caminhão, por exemplo). */
  skipped: Array<{ taskId: string; side: ImplementFace; reason: string }>;
}

type Tx = any;

/**
 * Replica os lados `sides` do caminhão de `sourceTaskId` para os demais veículos
 * do mesmo orçamento.
 *
 * @param logChange  Quem grava a trilha — o `ChangeLogService.logChange` do
 *   chamador, já com a transação. Recebe UMA entrada por (irmão × lado), no
 *   campo `implementMeasures` da TAREFA irmã (o mesmo campo que a edição de
 *   tarefa usa), com o motivo "Medidas replicadas do veículo 39088 (mesmo
 *   orçamento)".
 */
export async function replicateImplementMeasuresToQuoteSiblings(
  tx: Tx,
  params: {
    sourceTaskId: string;
    sides?: readonly ImplementFace[];
    logChange: (entry: ReplicationLogEntry) => Promise<unknown>;
  },
): Promise<ReplicationResult> {
  const result: ReplicationResult = { replicated: [], skipped: [] };
  const sides = [...new Set(params.sides ?? FACES)];
  if (sides.length === 0) return result;

  const source = await tx.task.findUnique({
    where: { id: params.sourceTaskId },
    select: {
      id: true,
      quoteId: true,
      implement: IMPLEMENT_MEASURES_SELECT,
    },
  });
  if (!source?.quoteId || !source.implement) return result;

  const quoteTasks: Array<{
    id: string;
    createdAt: Date;
    serialNumber: string | null;
    implement: any;
  }> = await tx.task.findMany({
    where: { quoteId: source.quoteId },
    select: {
      id: true,
      createdAt: true,
      serialNumber: true,
      implement: IMPLEMENT_MEASURES_SELECT,
    },
  });
  if (quoteTasks.length < 2) return result;

  const ordered = sortQuoteTasks(quoteTasks);
  const sourceIndex = ordered.findIndex(t => t.id === source.id);
  const sourceLabel = vehicleLabel(ordered[sourceIndex] as any, sourceIndex);
  const reason = `Medidas replicadas do veículo ${sourceLabel} (mesmo orçamento)`;

  for (const side of sides) {
    const origin: MeasureRow | null = source.implement[FACE_REL[side]] ?? null;
    // Exclusão não replica — e um lado sem medida na origem não tem o que copiar.
    if (!origin) continue;
    const originKey = measureKey(origin);

    for (const sibling of ordered) {
      if (sibling.id === source.id) continue;
      // DD1: toda tarefa tem implemento. O ramo que criava o caminhão do irmão
      // "se faltasse" saiu (seria uma segunda fonte de criação sem `spot`).
      const implement = sibling.implement;
      if (!implement) {
        result.skipped.push({ taskId: sibling.id, side, reason: 'tarefa sem implemento' });
        logger.error(
          `[Medidas] Irmão ${sibling.id} do orçamento ${source.quoteId} sem implemento: ` +
            `medida ${side} do veículo ${sourceLabel} NÃO replicada.`,
        );
        continue;
      }

      const current: MeasureRow | null = implement[FACE_REL[side]] ?? null;
      // Só o lado que difere. Linha compartilhada com a origem também conta como
      // "já tem" — é a mesma medida.
      if (current && (current.id === origin.id || measureKey(current) === originKey)) continue;

      // Linha NOVA no irmão (mesma altura, mesmas seções, mesma foto); a anterior
      // sai quando mais ninguém a usa e nenhuma análise de pintura a aponta — a
      // regra é a do escritor único, não uma faxina própria.
      const written = await setFace(
        tx,
        implement.id,
        side,
        {
          height: origin.height,
          photoId: origin.photoId ?? null,
          sections: (origin.sections ?? []).map(s => ({
            width: s.width,
            isDoor: s.isDoor,
            doorHeight: s.doorHeight,
            position: s.position,
          })),
        },
        { mode: 'replace' },
      );
      const copy: MeasureRow = written.after as unknown as MeasureRow;
      implement[FACE_REL[side]] = copy;
      implement[FACE_FK[side]] = copy.id;

      await params.logChange({
        taskId: sibling.id,
        field: 'implementMeasures',
        oldValue: { [FACE_FK[side]]: formatMeasureForChangelog(current) },
        newValue: { [FACE_FK[side]]: formatMeasureForChangelog(copy) },
        reason,
      });
      result.replicated.push({ taskId: sibling.id, side, implementMeasureId: copy.id });
    }
  }

  if (result.replicated.length > 0) {
    logger.log(
      `[Medidas] Orçamento ${source.quoteId}: ${result.replicated.length} lado(s) replicado(s) ` +
        `do veículo ${sourceLabel} para ${new Set(result.replicated.map(r => r.taskId)).size} irmão(s).`,
    );
  }
  return result;
}
