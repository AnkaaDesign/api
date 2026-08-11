// bonus-absence.service.ts
//
// AFASTAMENTO MÉDICO como segundo fator de peso na bonificação.
//
// POR QUE EXISTE
// --------------
// A proporcionalidade temporal (`BonusEligibilityService`) responde "quanto do
// período esta pessoa esteve CONTRATADA". Ela não responde "quanto do período
// esta pessoa esteve DISPONÍVEL". Alguém contratado o mês inteiro mas afastado
// por atestado o mês inteiro entrava no divisor B1 com peso 1,0 — segurando o
// denominador para cima e derrubando o bônus de todos os outros — e saía com
// R$ 0,00 por causa do desconto de falta. O custo do afastamento era rateado
// entre os colegas.
//
// Caso real (período 8/2026): um colaborador com dois ATEST consecutivos
// (29/04→28/07 e 29/07→29/10) cobria 22 dos 22 dias úteis do período e ainda
// pesava 1,0000 no divisor de 14,1820.
//
// A REGRA (com franquia de 40%)
// -----------------------------
//     a      = dias_afastados / dias_úteis_ELEGÍVEIS da pessoa
//     fator  = a <= 0,40  ?  1          (franquia: ausência normal não pune ninguém)
//                          :  1 - a     (acima da franquia, conta o que sobrou)
//
// A franquia é o ponto todo: quem faltou 38% NÃO está afastado e continua
// contando 1,0. Quem faltou 52% conta 0,48. Quem faltou 100% conta 0 e some da
// lista, como quem nunca foi elegível.
//
// O fator MULTIPLICA o peso temporal — os dois se compõem. Quem foi desligado
// no dia 8 (peso 0,1364) e estava afastado em metade dos seus dias elegíveis
// fica com 0,1364 × 0,50.
//
// O DENOMINADOR SÃO OS DIAS ELEGÍVEIS, não os dias do período. Sem isso a
// composição contaria a mesma ausência duas vezes: alguém elegível só 3 dias
// nunca poderia "faltar 50% do período", e o fator ficaria preso em 1 para
// quem mais precisa dele.
//
// DUAS FONTES, AS DUAS NECESSÁRIAS
// --------------------------------
// Foi verificado em produção que o Secullum registra atestado de duas formas
// diferentes conforme a duração, e nenhuma sozinha cobre os dois casos:
//
//   • MULTI-DIA → `/FuncionariosAfastamentos`, um registro com faixa de datas
//     e `JustificativaId` (ATEST = 1). É assim que o afastamento longo aparece.
//   • DIA ÚNICO → NÃO gera afastamento; aparece só como abono por dia no
//     `/Calculos` (o mesmo sinal que já alimenta o desconto "Faltas - Atestado").
//
// FÉRIAS NÃO CONTAM. O próprio Ankaa empurra férias para o Secullum como
// afastamento (`secullum-vacation-sync`), então sem o filtro por justificativa
// um mês de férias zeraria o peso da pessoa. Férias é direito adquirido, não
// indisponibilidade — e o mesmo vale para folga, compensação e treinamento.
//
// FAIL-SAFE: Secullum fora do ar ⇒ fator 1 para todo mundo (o comportamento de
// antes desta regra) e `available: false`. Quem GRAVA precisa se recusar a
// gravar nesse estado — persistir fator 1 por indisponibilidade é exatamente o
// erro que a regra existe para corrigir, só que congelado na folha.

import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@modules/common/cache/cache.service';
import { SecullumService } from '@modules/integrations/secullum/secullum.service';
import { SecullumBonusIntegrationService } from './secullum-bonus-integration.service';
import { isBrazilianBusinessDayLocal } from '../../../utils/brazilian-holidays.util';

// ============================================================
// Política — quais justificativas do Secullum são afastamento médico
// ============================================================

/**
 * Justificativas que TIRAM a pessoa da disponibilidade (doença / INSS /
 * acidente). Verificado contra `/Justificativas` em 11/08/2026: o Secullum
 * desta empresa tem UM único código médico — não existe código separado para
 * INSS ou acidente de trabalho, o afastamento longo é lançado como ATEST mesmo
 * (o caso real tinha ATEST de 29/07 a 29/10).
 *
 * Se o DP criar um código novo (ex.: "INSS", "ACIDENTE"), ele precisa entrar
 * AQUI. Enquanto não entrar, `resolvePeriodAbsence` emite um WARN sempre que
 * uma justificativa desconhecida cobrir mais que a franquia — é o alarme que
 * impede a regra de silenciosamente parar de valer.
 */
const MEDICAL_JUSTIFICATION_IDS = new Set<number>([
  1, // ATEST — Atestado Médico
]);

/**
 * Justificativas conhecidas que NÃO são afastamento médico. Existem para duas
 * coisas: silenciar o WARN de código desconhecido, e suprimir o abono do
 * `/Calculos` num dia coberto por elas (um dia de férias não pode virar
 * "atestado" só porque o Secullum abonou a carga).
 *
 * Note ATEST DE ÓBITO (11), DECLARAÇÃO (5) e LICENÇA PATERNIDADE (9): são
 * ausências justificadas e legítimas, mas não são indisponibilidade por
 * doença — e nenhuma delas chega perto da franquia de 40% (são de 1 a 5 dias).
 * Ficam de fora da regra de propósito.
 */
const NON_MEDICAL_JUSTIFICATION_IDS = new Set<number>([
  2, // FÉRIAS
  3, // FALTA I — Falta sem Justificativa (já vira desconto, não é afastamento)
  4, // ESQ — Esqueceu
  5, // DECL — Declaração
  6, // TREIN — Treinamento
  7, // Cadastr
  8, // FOLGA
  9, // LIC PAT — Licença Paternidade
  10, // DISP — Dispensa
  11, // AT OBTO — Atestado de Óbito
  12, // COMPENS — Compensado
  13, // FALTA 2
]);

/**
 * Franquia. Ausência médica até este ponto NÃO reduz o peso: falta acontece, e
 * quem faltou 38% do período não está afastado. Passando daqui, o peso vira
 * exatamente o que sobrou (`1 - fração`).
 */
export const MEDICAL_ABSENCE_THRESHOLD = 0.4;

/** Abaixo disto o dia não conta nem como meio dia de afastamento. */
const MIN_DAY_PROPORTION = 0.25;

// ============================================================
// Tipos
// ============================================================

export interface AbsenceCoverage {
  userId: string;
  /** Dias-equivalentes de afastamento médico dentro da janela elegível. */
  absentDays: number;
  /** Dias úteis elegíveis da pessoa (denominador). */
  eligibleDays: number;
  /** `absentDays / eligibleDays` em [0, 1]. */
  fraction: number;
  /** 1 quando `fraction <= 0,40`; senão `1 - fraction`. Em [0, 1]. */
  factor: number;
  /** Quantos dias vieram de cada fonte — só para diagnóstico/UI. */
  fromAfastamento: number;
  fromAtestadoDiario: number;
  /** Faixas médicas que tocaram a janela, para exibição ("ATEST 29/07→29/10"). */
  ranges: Array<{ start: string; end: string; label: string }>;
  /** `false` quando não deu para medir esta pessoa (sem Secullum ou erro). */
  measured: boolean;
}

export interface PeriodAbsence {
  /**
   * `false` = falha de SERVIÇO (breaker aberto, auth, rede). Todo mundo sai com
   * fator 1 e quem grava precisa se recusar a gravar.
   */
  available: boolean;
  error?: string;
  /** Usuários que falharam individualmente (o serviço está de pé). */
  failedUsers: string[];
  byUserId: Map<string, AbsenceCoverage>;
}

export interface AbsenceInputUser {
  userId: string;
  userName: string;
  secullumEmployeeId: number | null;
  /** Primeiro e último dia elegível dentro do período. */
  eligibleFrom: Date | null;
  eligibleUntil: Date | null;
  /** Dias úteis elegíveis, como a elegibilidade temporal os contou. */
  eligibleDays: number;
}

// ============================================================
// Helpers puros
// ============================================================

const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;
const round2 = (v: number): number => Math.round(v * 100) / 100;

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Dias ÚTEIS (Mon–Fri menos feriados nacionais) dentro de [start, end], como
 * chaves 'YYYY-MM-DD'. Mesma definição de dia útil que
 * `countBrazilianBusinessDaysInRange` usa, para que numerador e denominador da
 * fração nunca discordem sobre quantos dias existem.
 */
function businessDayKeys(start: Date, end: Date): string[] {
  if (end < start) return [];
  const keys: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const stop = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  for (let i = 0; i < 400 && cursor <= stop; i++) {
    if (isBrazilianBusinessDayLocal(cursor)) keys.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

/**
 * Fator a partir da fração, com a franquia. Exportado porque é a regra em si —
 * o teste unitário exercita esta função diretamente, sem Secullum no caminho.
 */
export function absenceFactorFor(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction <= MEDICAL_ABSENCE_THRESHOLD) return 1;
  return round4(Math.max(0, 1 - Math.min(1, fraction)));
}

// ============================================================
// Serviço
// ============================================================

@Injectable()
export class BonusAbsenceService {
  private readonly logger = new Logger(BonusAbsenceService.name);

  /**
   * Frescor do resultado por pessoa. Alinhado com a janela "fresh" do cache SWR
   * do cálculo live (30 min) para que a tela não misture uma elegibilidade nova
   * com uma cobertura de afastamento velha.
   */
  private readonly CACHE_TTL_SEC = 30 * 60;
  private static readonly CACHE_VERSION = 'v1';

  constructor(
    private readonly secullumService: SecullumService,
    private readonly secullumBonusIntegrationService: SecullumBonusIntegrationService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Cobertura de afastamento médico de cada usuário dentro da SUA janela
   * elegível no período.
   *
   * `opts.skipCache` existe para o caminho que GRAVA: gravar é ato
   * autoritativo, e persistir uma cobertura de até 30 min atrás congelaria na
   * folha um fator que já mudou — o mesmo motivo pelo qual
   * `calculateAndSaveBonuses` não lê o cache SWR do cálculo live.
   */
  async resolvePeriodAbsence(
    users: AbsenceInputUser[],
    opts?: { skipCache?: boolean },
  ): Promise<PeriodAbsence> {
    const byUserId = new Map<string, AbsenceCoverage>();
    const failedUsers: string[] = [];

    if (users.length === 0) {
      return { available: true, failedUsers, byUserId };
    }

    // Sonda de disponibilidade: uma chamada barata que distingue "Secullum fora
    // do ar" (todo mundo sem medição, gravação proibida) de "esta pessoa deu
    // erro" (só ela sem medição). Sem isso, uma queda do serviço viraria
    // silenciosamente "ninguém está afastado".
    try {
      const probe = await this.secullumService.getEmployees();
      if (!probe.success) {
        return this.unavailable(
          users,
          byUserId,
          'Secullum indisponível (sonda de funcionários retornou insucesso).',
        );
      }
    } catch (err) {
      return this.unavailable(
        users,
        byUserId,
        `Secullum indisponível: ${(err as Error)?.message ?? err}`,
      );
    }

    for (const user of users) {
      try {
        const coverage = await this.resolveForUser(user, opts?.skipCache === true);
        byUserId.set(user.userId, coverage);
      } catch (err) {
        failedUsers.push(user.userId);
        this.logger.warn(
          `[afastamento] falha ao medir ${user.userName} (${user.userId}): ` +
            `${(err as Error)?.message ?? err} — tratado como NÃO afastado (fator 1).`,
        );
        byUserId.set(user.userId, this.unmeasured(user));
      }
    }

    // Todos falharem é sinal de serviço, não de dado.
    if (failedUsers.length === users.length) {
      return this.unavailable(
        users,
        byUserId,
        `Todos os ${users.length} usuários falharam na medição de afastamento.`,
      );
    }

    const afastados = [...byUserId.values()].filter(c => c.factor < 1);
    if (afastados.length > 0) {
      this.logger.log(
        `[afastamento] ${afastados.length} pessoa(s) acima da franquia de ` +
          `${Math.round(MEDICAL_ABSENCE_THRESHOLD * 100)}%: ` +
          afastados
            .map(
              c =>
                `${users.find(u => u.userId === c.userId)?.userName ?? c.userId} ` +
                `${c.absentDays}/${c.eligibleDays} dias (${Math.round(c.fraction * 100)}% → fator ${c.factor})`,
            )
            .join('; '),
      );
    }

    return { available: true, failedUsers, byUserId };
  }

  // ----------------------------------------------------------
  // Interno
  // ----------------------------------------------------------

  private unavailable(
    users: AbsenceInputUser[],
    byUserId: Map<string, AbsenceCoverage>,
    error: string,
  ): PeriodAbsence {
    this.logger.error(
      `[afastamento] ${error} Todos os pesos ficam sem o fator de afastamento — ` +
        'a gravação do período deve ser recusada.',
    );
    for (const u of users) byUserId.set(u.userId, this.unmeasured(u));
    return { available: false, error, failedUsers: [], byUserId };
  }

  /** Cobertura neutra: não mede, não pune. */
  private unmeasured(user: AbsenceInputUser): AbsenceCoverage {
    return {
      userId: user.userId,
      absentDays: 0,
      eligibleDays: user.eligibleDays,
      fraction: 0,
      factor: 1,
      fromAfastamento: 0,
      fromAtestadoDiario: 0,
      ranges: [],
      measured: false,
    };
  }

  private async resolveForUser(
    user: AbsenceInputUser,
    skipCache: boolean,
  ): Promise<AbsenceCoverage> {
    // Sem vínculo no ponto eletrônico não há como medir. Mesma política que a
    // elegibilidade já aplica ao desconto de falta e ao extra de assiduidade:
    // sem apuração de ponto, nenhum dos dois incide. Fail-OPEN de propósito —
    // é exatamente quem foi desligado (o desligamento apaga o vínculo Secullum)
    // e quem esta regra não deve atingir.
    if (
      user.secullumEmployeeId == null ||
      user.eligibleFrom == null ||
      user.eligibleUntil == null ||
      user.eligibleDays <= 0
    ) {
      return this.unmeasured(user);
    }

    const from = user.eligibleFrom;
    const until = user.eligibleUntil;
    const startStr = dayKey(from);
    const endStr = dayKey(until);

    const cacheKey =
      `bonus:absence:${BonusAbsenceService.CACHE_VERSION}:` +
      `${user.secullumEmployeeId}:${startStr}:${endStr}`;

    if (!skipCache) {
      const cached = await this.cacheService.getObject<AbsenceCoverage>(cacheKey).catch(() => null);
      // O userId não entra na chave (a chave é do FUNCIONÁRIO no Secullum), então
      // reescreve-se o campo antes de devolver.
      if (cached) return { ...cached, userId: user.userId, eligibleDays: user.eligibleDays };
    }

    const eligibleKeys = businessDayKeys(from, until);
    const eligibleSet = new Set(eligibleKeys);

    // Proporção de afastamento médico por dia (0..1). Dia só entra se for dia
    // útil DENTRO da janela elegível.
    const medicalByDay = new Map<string, number>();
    /** Dias cobertos por justificativa reconhecidamente NÃO-médica. */
    const nonMedicalDays = new Set<string>();
    const ranges: AbsenceCoverage['ranges'] = [];

    // ---- Fonte 1: /FuncionariosAfastamentos (multi-dia) -------------------
    const absencesRes = await this.secullumService.getAbsencesByEmployee(user.secullumEmployeeId);
    if (!absencesRes.success) {
      throw new Error(absencesRes.message || 'Falha ao carregar afastamentos');
    }

    for (const a of absencesRes.data ?? []) {
      const ini = new Date(a.Inicio);
      const fim = new Date(a.Fim);
      if (isNaN(ini.getTime()) || isNaN(fim.getTime())) continue;
      if (fim < from || ini > until) continue;

      const clipFrom = ini > from ? ini : from;
      const clipUntil = fim < until ? fim : until;
      const covered = businessDayKeys(clipFrom, clipUntil).filter(k => eligibleSet.has(k));
      if (covered.length === 0) continue;

      const label = (a.JustificativaDescricao || a.Motivo || `just ${a.JustificativaId}`).trim();

      if (this.isMedical(a.JustificativaId, a.JustificativaDescricao)) {
        for (const k of covered) medicalByDay.set(k, 1);
        ranges.push({ start: dayKey(clipFrom), end: dayKey(clipUntil), label });
        continue;
      }

      for (const k of covered) nonMedicalDays.add(k);

      // Código que ninguém mapeou cobrindo mais que a franquia: pode ser um
      // "INSS"/"ACIDENTE" novo que o DP criou. Silêncio aqui seria a regra
      // parando de valer sem ninguém perceber.
      if (
        !NON_MEDICAL_JUSTIFICATION_IDS.has(a.JustificativaId) &&
        covered.length / eligibleKeys.length > MEDICAL_ABSENCE_THRESHOLD
      ) {
        this.logger.warn(
          `[afastamento] justificativa DESCONHECIDA id=${a.JustificativaId} ("${label}") cobre ` +
            `${covered.length}/${eligibleKeys.length} dias úteis de ${user.userName}. ` +
            'Não está classificada como médica nem como não-médica — se for doença/INSS/acidente, ' +
            'adicione o id em MEDICAL_JUSTIFICATION_IDS (bonus-absence.service.ts).',
        );
      }
    }

    const fromAfastamento = round2([...medicalByDay.values()].reduce((s, v) => s + v, 0));

    // ---- Fonte 2: abono por dia do /Calculos (atestado de 1 dia) ----------
    // O atestado de um dia só NÃO gera registro em /FuncionariosAfastamentos —
    // verificado em produção. Sem esta fonte, uma sequência de atestados
    // avulsos passando de 40% ficaria invisível para a regra.
    const { perDayAbono, dailyCargaHours } =
      await this.secullumBonusIntegrationService.getPerDayAbono(
        user.secullumEmployeeId,
        startStr,
        endStr,
      );
    const carga = dailyCargaHours > 0 ? dailyCargaHours : 8;

    for (const [key, hours] of perDayAbono.entries()) {
      if (!eligibleSet.has(key)) continue;
      // Dia de férias/folga/compensação abonado não é afastamento médico.
      if (nonMedicalDays.has(key)) continue;
      const proportion = Math.min(1, hours / carga);
      if (proportion < MIN_DAY_PROPORTION) continue;
      const prev = medicalByDay.get(key) ?? 0;
      if (proportion > prev) medicalByDay.set(key, proportion);
    }

    const absentDays = round2([...medicalByDay.values()].reduce((s, v) => s + v, 0));
    // O denominador é o que a elegibilidade contou, não o que este método
    // enumerou — divergir dela faria a fração não bater com o peso exibido.
    const denominator = user.eligibleDays > 0 ? user.eligibleDays : eligibleKeys.length;
    const fraction = denominator > 0 ? round4(Math.min(1, absentDays / denominator)) : 0;

    const coverage: AbsenceCoverage = {
      userId: user.userId,
      absentDays,
      eligibleDays: denominator,
      fraction,
      factor: absenceFactorFor(fraction),
      fromAfastamento,
      fromAtestadoDiario: round2(Math.max(0, absentDays - fromAfastamento)),
      ranges,
      measured: true,
    };

    await this.cacheService
      .setObject(cacheKey, coverage, this.CACHE_TTL_SEC)
      .catch(err =>
        this.logger.warn(
          `[afastamento] falha ao gravar cache ${cacheKey}: ${(err as Error)?.message ?? err}`,
        ),
      );

    return coverage;
  }

  /**
   * Id manda; a descrição é rede de segurança para o dia em que os ids mudarem
   * (troca de base do Secullum). "ÓBITO" contém "ATEST" na forma longa
   * ("Atestado de Óbito"), por isso a exclusão explícita.
   */
  private isMedical(justificativaId: number, descricao?: string): boolean {
    if (MEDICAL_JUSTIFICATION_IDS.has(justificativaId)) return true;
    if (NON_MEDICAL_JUSTIFICATION_IDS.has(justificativaId)) return false;
    const d = (descricao ?? '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    if (!d) return false;
    if (d.includes('OBITO')) return false;
    return d.includes('ATEST') || d.includes('INSS') || d.includes('ACIDENTE');
  }

  /** Invalida a medição de um funcionário (todas as janelas). */
  async invalidateForEmployee(secullumEmployeeId: number): Promise<void> {
    await this.cacheService
      .clearPattern(`bonus:absence:${BonusAbsenceService.CACHE_VERSION}:${secullumEmployeeId}:*`)
      .catch(err =>
        this.logger.warn(
          `[afastamento] falha ao invalidar cache do funcionário ${secullumEmployeeId}: ` +
            `${(err as Error)?.message ?? err}`,
        ),
      );
  }

  /** Invalida a medição de todo mundo — usado junto com o cache do cálculo live. */
  async invalidateAll(): Promise<void> {
    await this.cacheService
      .clearPattern(`bonus:absence:${BonusAbsenceService.CACHE_VERSION}:*`)
      .catch(err =>
        this.logger.warn(
          `[afastamento] falha ao invalidar cache: ${(err as Error)?.message ?? err}`,
        ),
      );
  }
}
