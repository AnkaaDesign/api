// bonus-window-stats.service.ts
//
// SINGLE SOURCE OF TRUTH para os três números de bonificação de cada pessoa:
//
//     tarefas ponderadas da janela  ÷  colaboradores da janela  =  média (B1)
//
// A janela é o recorte do período 26→25 em que a pessoa esteve elegível. Os
// três números fecham na divisão, exatos, em qualquer linha — é isso que
// permite ao RH refazer a conta na mão e defender o valor.
//
// POR QUE ISSO EXISTE
// -------------------
// Até a v3, B1 era UM número do período (total de tarefas ÷ headcount médio),
// igual para todo mundo, prorrateado depois pelos dias trabalhados. Isso conta
// para quem saiu tarefas fechadas DEPOIS de ele sair, e cobra de quem entrou no
// meio a improdutividade de ANTES de ele entrar. No período 26/07→25/08/2026,
// com 7 desligamentos e 2 efetivações num único ciclo, 18 das 49 tarefas
// ponderadas (37%) foram concluídas depois que dois deles já tinham saído.
//
// A v5 mede cada pessoa na janela dela e só nela.
//
// O TEMPO É APLICADO UMA VEZ SÓ — E ELE MORA NO NUMERADOR
// -------------------------------------------------------
// Quem trabalhou 16 dos 22 dias viu menos tarefas serem concluídas: a redução
// pelo tempo JÁ ESTÁ dentro de `windowWeightedTasks`. Por isso o valor NÃO é
// prorrateado de novo pelos dias — `BonusService` multiplica apenas por
// `absenceFactor`, que é o outro eixo (afastamento médico) e não pode sumir
// junto. Multiplicar também por `temporalWeight` aplicaria o tempo duas vezes,
// e a curva de bônus é convexa: o erro não seria proporcional, seria brutal.
//
// AFASTAMENTO FICA FORA DO EIXO DE DIAS, DE PROPÓSITO
// ---------------------------------------------------
// A janela é montada só do VÍNCULO (admissão/efetivação/rescisão). Tirar os
// dias de afastamento daqui TAMBÉM aplicaria o mesmo desconto duas vezes — uma
// encolhendo a janela, outra no `absenceFactor`.
//
// PURO DE PROPÓSITO: sem banco, sem I/O. Os dois caminhos que calculam
// bonificação — `computeLiveBonusesForPeriod` (período inteiro: lista, folha,
// cron) e `calculateLiveBonusData` (um usuário: detalhe e app) — chamam ESTE
// serviço. Eles já foram cálculos duplicados e já divergiram; com B1 variando
// por pessoa, duplicar de novo garantiria a lista e o detalhe discordarem sobre
// a MESMA pessoa.

import { Injectable, Logger } from '@nestjs/common';
import { BONIFICATION_STATUS } from '../../../constants/enums';
import { localDayKey } from '../../../utils/brazilian-holidays.util';
import { roundAverage } from '../../../utils/currency-precision.util';

export interface WindowStatsInput {
  /** Dias úteis do período, em ordem. Vem de `listBrazilianBusinessDaysInRange`. */
  businessDays: Date[];
  /** Tarefas COMPLETED do período. `id` alimenta o recorte da relação `_BonusTasks`. */
  tasks: Array<{ id?: string; finishedAt: Date | string | null; bonification: string | null }>;
  /**
   * Quem participa. DEVE ser exatamente o conjunto que forma o divisor do
   * período (`performanceLevel > 0`), senão o headcount diário e o divisor
   * medem populações diferentes.
   */
  people: Array<{
    userId: string;
    /** Intervalos elegíveis JÁ recortados ao período. */
    intervals: Array<{ start: Date; end: Date }>;
    /** `eligibleDays` da elegibilidade — conferência cruzada. */
    eligibleDays: number;
  }>;
}

export interface PersonWindowStats {
  userId: string;
  /** Dias úteis do período em que a pessoa esteve. */
  windowBusinessDays: number;
  /** Tarefas do período concluídas dentro da janela (todas as bonificações). */
  windowTaskIds: string[];
  windowTaskCount: number;
  /** Ponderadas da janela: cheia 1,0 · parcial 0,5 · suspensa 0,0 · sem bonif. 0,0. */
  windowWeightedTasks: number;
  /** Idem, com SUSPENSA valendo 1,0 — é o numerador da base. */
  windowRawTasks: number;
  /**
   * Colaboradores da janela: `Σ headcount(d) ÷ diasDaJanela`, fracionário.
   *
   * Varia muito por grupo e é o ponto do modelo: quem pegou só o começo do
   * período conviveu com o quadro CHEIO, quem pegou só o fim com o REDUZIDO.
   * Em 08/2026 vai de 16,00 a 11,29, contra 12,50 do período.
   */
  windowDivisor: number;
  /** Soma de pessoa-dias da janela — o numerador de `windowDivisor`. */
  windowPersonDays: number;
  /** B1 desta pessoa: `windowWeightedTasks ÷ windowDivisor`, 2 casas. */
  b1Weighted: number;
  /** B1 da base: `windowRawTasks ÷ windowDivisor`, 2 casas. */
  b1Raw: number;
}

export interface WindowStatsResult {
  byUserId: Map<string, PersonWindowStats>;
  /** Diagnóstico por dia útil — auditoria e log. */
  perDay: Array<{ date: Date; headcount: number; rawTasks: number; weightedTasks: number }>;
  /** Totais do PERÍODO, para exibição ao lado dos números por pessoa. */
  period: {
    rawTasks: number;
    weightedTasks: number;
    taskCount: number;
    /** Tarefas fora de dia útil reancoradas no dia útil anterior. */
    snappedTasks: number;
    /** Dias com produção e nenhum elegível presente — não entram em janela nenhuma. */
    orphanDays: number;
  };
}

function rawWeightOf(bonification: string | null): number {
  if (bonification === BONIFICATION_STATUS.FULL_BONIFICATION) return 1.0;
  if (bonification === BONIFICATION_STATUS.PARTIAL_BONIFICATION) return 0.5;
  // Suspensa conta como cheia na BASE — mesma regra de `calculateRawTaskCount`.
  if (bonification === BONIFICATION_STATUS.SUSPENDED_BONIFICATION) return 1.0;
  return 0;
}

function weightedWeightOf(bonification: string | null): number {
  if (bonification === BONIFICATION_STATUS.FULL_BONIFICATION) return 1.0;
  if (bonification === BONIFICATION_STATUS.PARTIAL_BONIFICATION) return 0.5;
  // Suspensa vale 0 no LÍQUIDO — mesma regra de `calculatePonderedTaskCount`.
  return 0;
}

@Injectable()
export class BonusWindowStatsService {
  private readonly logger = new Logger(BonusWindowStatsService.name);

  compute(input: WindowStatsInput): WindowStatsResult {
    const { businessDays, tasks, people } = input;
    const n = businessDays.length;

    const rawByDay = new Array<number>(n).fill(0);
    const weightedByDay = new Array<number>(n).fill(0);
    const taskIdsByDay: string[][] = Array.from({ length: n }, () => []);

    // ------------------------------------------------------------------
    // 1) Tarefa -> dia útil
    // ------------------------------------------------------------------
    // Um `finishedAt` de sábado, domingo ou feriado não tem dia útil próprio.
    // Descartar a tarefa a tiraria de todas as janelas mas ela continuaria no
    // total do período, então ela é reancorada no dia útil ANTERIOR mais
    // próximo — que é onde o trabalho dela plausivelmente aconteceu. Antes do
    // primeiro dia útil, vai para ele.
    const indexByKey = new Map<string, number>();
    businessDays.forEach((d, i) => indexByKey.set(localDayKey(d), i));

    let snappedTasks = 0;
    for (const t of tasks) {
      if (!t.finishedAt) continue;
      const at = t.finishedAt instanceof Date ? t.finishedAt : new Date(t.finishedAt);
      let idx = indexByKey.get(localDayKey(at));
      if (idx === undefined) {
        snappedTasks++;
        idx = 0;
        for (let i = n - 1; i >= 0; i--) {
          if (businessDays[i] <= at) {
            idx = i;
            break;
          }
        }
      }
      // NO_BONIFICATION pesa 0 nos dois numeradores, mas é tarefa do período: ela
      // entra na LISTA (a tela conta todas) e fica fora das somas.
      if (t.id) taskIdsByDay[idx].push(t.id);
      rawByDay[idx] += rawWeightOf(t.bonification);
      weightedByDay[idx] += weightedWeightOf(t.bonification);
    }

    // ------------------------------------------------------------------
    // 2) Presença por dia
    // ------------------------------------------------------------------
    // Comparação por DIA-CALENDÁRIO local, não por instante: `terminationDate`
    // carrega hora (16:00) e `businessDays[i]` é meia-noite, então comparar
    // instantes cortaria o último dia trabalhado de todo desligado — exatamente
    // o dia a que a pessoa tem direito.
    const presence = new Map<string, boolean[]>();
    const headcount = new Array<number>(n).fill(0);

    for (const p of people) {
      const mask = new Array<boolean>(n).fill(false);
      for (const iv of p.intervals) {
        const from = new Date(iv.start.getFullYear(), iv.start.getMonth(), iv.start.getDate());
        const to = new Date(iv.end.getFullYear(), iv.end.getMonth(), iv.end.getDate());
        for (let i = 0; i < n; i++) {
          if (businessDays[i] >= from && businessDays[i] <= to) mask[i] = true;
        }
      }
      presence.set(p.userId, mask);
      for (let i = 0; i < n; i++) if (mask[i]) headcount[i]++;
    }

    // ------------------------------------------------------------------
    // 3) Os três números de cada pessoa
    // ------------------------------------------------------------------
    const byUserId = new Map<string, PersonWindowStats>();

    for (const p of people) {
      const mask = presence.get(p.userId)!;
      let windowBusinessDays = 0;
      let windowRawTasks = 0;
      let windowWeightedTasks = 0;
      let windowPersonDays = 0;
      const windowTaskIds: string[] = [];

      for (let i = 0; i < n; i++) {
        if (!mask[i]) continue;
        windowBusinessDays++;
        windowRawTasks += rawByDay[i];
        windowWeightedTasks += weightedByDay[i];
        windowPersonDays += headcount[i];
        if (taskIdsByDay[i].length > 0) windowTaskIds.push(...taskIdsByDay[i]);
      }

      const windowDivisor = windowBusinessDays > 0 ? windowPersonDays / windowBusinessDays : 0;

      // Janela sem ninguém elegível é impossível por construção — a própria
      // pessoa está nela —, então `windowDivisor` só é 0 se a janela for vazia,
      // e aí os numeradores também são 0. Sem divisão por zero, e sem fallback
      // para o número do PERÍODO: quem não pegou tarefa nenhuma tem média 0,00,
      // não a média da equipe.
      const b1Weighted = windowDivisor > 0 ? roundAverage(windowWeightedTasks / windowDivisor) : 0;
      const b1Raw = windowDivisor > 0 ? roundAverage(windowRawTasks / windowDivisor) : 0;

      if (windowBusinessDays !== p.eligibleDays) {
        // A janela reconstruída aqui e o `eligibleDays` da elegibilidade
        // discordam. Sempre é bug de um dos dois lados — e como a janela é o
        // numerador e `eligibleDays` alimenta a exibição da proporção, divergir
        // aqui deixa a tela contando uma história e o valor contando outra.
        this.logger.warn(
          `[janela] ${p.userId}: reconstruída com ${windowBusinessDays} dia(s) úteis, ` +
            `mas a elegibilidade diz ${p.eligibleDays}. Verificar intervalos.`,
        );
      }

      byUserId.set(p.userId, {
        userId: p.userId,
        windowBusinessDays,
        windowTaskIds,
        windowTaskCount: windowTaskIds.length,
        windowWeightedTasks,
        windowRawTasks,
        windowDivisor,
        windowPersonDays,
        b1Weighted,
        b1Raw,
      });
    }

    const orphanDays = businessDays.filter(
      (_, i) => headcount[i] === 0 && (rawByDay[i] > 0 || weightedByDay[i] > 0),
    ).length;
    if (orphanDays > 0) {
      this.logger.warn(
        `[janela] ${orphanDays} dia(s) com produção e nenhum elegível presente — ` +
          'essas tarefas não entram na janela de ninguém.',
      );
    }

    return {
      byUserId,
      perDay: businessDays.map((date, i) => ({
        date,
        headcount: headcount[i],
        rawTasks: rawByDay[i],
        weightedTasks: weightedByDay[i],
      })),
      period: {
        rawTasks: rawByDay.reduce((s, v) => s + v, 0),
        weightedTasks: weightedByDay.reduce((s, v) => s + v, 0),
        taskCount: taskIdsByDay.reduce((s, ids) => s + ids.length, 0),
        snappedTasks,
        orphanDays,
      },
    };
  }
}
