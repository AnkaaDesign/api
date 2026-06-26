// vacation-calculation.service.spec.ts
//
// Pure-function tests for the férias engine (no DB, no Nest context).
// Legal references: CLT 130 (escala de dias), 134 §1º (fracionamento, Reforma
// 2017), 137 (dobro), 142 §5º/§6º (média de variáveis), 143 (abono pecuniário).

import { VacationCalculationService } from './vacation-calculation.service';

const service = new VacationCalculationService();

describe('VacationCalculationService', () => {
  // -----------------------------------------------------------------------
  // Art. 130 — escala de dias por faltas injustificadas
  // -----------------------------------------------------------------------
  describe('entitledDaysForAbsences (art. 130)', () => {
    it('0–5 faltas → 30 dias', () => {
      expect(service.entitledDaysForAbsences(0)).toBe(30);
      expect(service.entitledDaysForAbsences(5)).toBe(30);
    });
    it('6–14 faltas → 24 dias', () => {
      expect(service.entitledDaysForAbsences(6)).toBe(24);
      expect(service.entitledDaysForAbsences(14)).toBe(24);
    });
    it('15–23 faltas → 18 dias', () => {
      expect(service.entitledDaysForAbsences(15)).toBe(18);
      expect(service.entitledDaysForAbsences(23)).toBe(18);
    });
    it('24–32 faltas → 12 dias', () => {
      expect(service.entitledDaysForAbsences(24)).toBe(12);
      expect(service.entitledDaysForAbsences(32)).toBe(12);
    });
    it('>32 faltas → 0 dias', () => {
      expect(service.entitledDaysForAbsences(33)).toBe(0);
      expect(service.entitledDaysForAbsences(100)).toBe(0);
    });
    it('negativos tratados como 0', () => {
      expect(service.entitledDaysForAbsences(-3)).toBe(30);
    });
  });

  // -----------------------------------------------------------------------
  // Período aquisitivo / concessivo a partir da admissão do vínculo atual
  // -----------------------------------------------------------------------
  describe('computeAcquisitivePeriod', () => {
    it('deriva o aquisitivo corrente do aniversário da admissão', () => {
      const admission = new Date(2024, 2, 10); // 2024-03-10
      const reference = new Date(2026, 5, 13); // 2026-06-13
      const { acquisitiveStart, acquisitiveEnd, concessiveEnd } = service.computeAcquisitivePeriod(
        admission,
        reference,
      );
      expect(acquisitiveStart.getFullYear()).toBe(2026);
      expect(acquisitiveStart.getMonth()).toBe(2); // março
      expect(acquisitiveStart.getDate()).toBe(10);
      // fim = +1 ano −1 dia → 2027-03-09
      expect(acquisitiveEnd.getFullYear()).toBe(2027);
      expect(acquisitiveEnd.getMonth()).toBe(2);
      expect(acquisitiveEnd.getDate()).toBe(9);
      // concessivo = fim do aquisitivo + 12 meses
      expect(concessiveEnd.getFullYear()).toBe(2028);
    });

    it('readmitido: usa a admissão do vínculo (não o legado)', () => {
      const admission = new Date(2025, 0, 6); // readmissão 2025-01-06
      const reference = new Date(2026, 5, 13);
      const { acquisitiveStart } = service.computeAcquisitivePeriod(admission, reference);
      expect(acquisitiveStart.getFullYear()).toBe(2026);
      expect(acquisitiveStart.getMonth()).toBe(0);
      expect(acquisitiveStart.getDate()).toBe(6);
    });
  });

  // -----------------------------------------------------------------------
  // Art. 137 — dobro
  // -----------------------------------------------------------------------
  describe('isDoubleOwed (art. 137)', () => {
    it('false quando dentro do concessivo', () => {
      expect(service.isDoubleOwed(new Date(2027, 0, 1), new Date(2026, 5, 13))).toBe(false);
    });
    it('true quando após o concessivo', () => {
      expect(service.isDoubleOwed(new Date(2026, 0, 1), new Date(2026, 5, 13))).toBe(true);
    });
    it('false quando concessivo nulo', () => {
      expect(service.isDoubleOwed(null, new Date())).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Média de variáveis (CLT 142 §5º/§6º)
  // -----------------------------------------------------------------------
  describe('computeVariableAverage', () => {
    it('média mensal de HE + adicional noturno + adicionais + bonificação', () => {
      const samples = [
        { overtimeAmount: 300, nightDifferentialAmount: 0, habitualAdditionalsAmount: 0, bonificationAmount: 0 },
        { overtimeAmount: 0, nightDifferentialAmount: 100, habitualAdditionalsAmount: 50, bonificationAmount: 50 },
        { overtimeAmount: 0, nightDifferentialAmount: 0, habitualAdditionalsAmount: 0, bonificationAmount: 0 },
      ];
      // total = 300 + 200 = 500; / 3 meses = 166,67
      expect(service.computeVariableAverage(samples)).toBe(166.67);
    });
    it('0 quando sem amostras', () => {
      expect(service.computeVariableAverage([])).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Fracionamento (Reforma 2017 — CLT 134 §1º)
  // -----------------------------------------------------------------------
  describe('validateFracionamento (CLT 134 §1º)', () => {
    const d = (m: number) => new Date(2026, m, 1);

    it('período único válido', () => {
      const r = service.validateFracionamento([{ startDate: d(0), days: 30 }], 30);
      expect(r.valid).toBe(true);
    });
    it('rejeita mais de 3 períodos', () => {
      const r = service.validateFracionamento(
        [
          { startDate: d(0), days: 14 },
          { startDate: d(2), days: 6 },
          { startDate: d(4), days: 5 },
          { startDate: d(6), days: 5 },
        ],
        30,
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some(e => /3 períodos/.test(e))).toBe(true);
    });
    it('exige um período ≥ 14 dias quando fracionado', () => {
      const r = service.validateFracionamento(
        [
          { startDate: d(0), days: 10 },
          { startDate: d(2), days: 10 },
          { startDate: d(4), days: 10 },
        ],
        30,
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some(e => /14 dias/.test(e))).toBe(true);
    });
    it('rejeita período menor que 5 dias (além do ≥14)', () => {
      const r = service.validateFracionamento(
        [
          { startDate: d(0), days: 14 },
          { startDate: d(2), days: 13 },
          { startDate: d(4), days: 3 },
        ],
        30,
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some(e => /5 dias/.test(e))).toBe(true);
    });
    it('fracionamento válido: 14 + 10 + 6', () => {
      const r = service.validateFracionamento(
        [
          { startDate: d(0), days: 14 },
          { startDate: d(2), days: 10 },
          { startDate: d(4), days: 6 },
        ],
        30,
      );
      expect(r.valid).toBe(true);
      expect(r.totalDays).toBe(30);
    });
    it('rejeita soma de dias acima do direito', () => {
      const r = service.validateFracionamento(
        [
          { startDate: d(0), days: 20 },
          { startDate: d(2), days: 14 },
        ],
        30,
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some(e => /excede/.test(e))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Recibo — férias + 1/3 + abono + dobro + INSS/IRRF
  // -----------------------------------------------------------------------
  describe('buildRecibo', () => {
    const ids = { vacationId: 'v1', userId: 'u1' };

    it('férias integrais 30 dias: 1/3 = base/3 e abono zero', () => {
      const r = service.buildRecibo(
        {
          baseSalary: 3000,
          variableAverage: 0,
          entitledDays: 30,
          abonoPecuniarioDays: 0,
          isDouble: false,
          dependentsCount: 0,
          allowSimplifiedDeduction: true,
          year: 2026,
        },
        ids,
      );
      expect(r.baseRemuneration).toBe(3000);
      expect(r.vacationDays).toBe(30);
      // férias = 3000/30*30 = 3000; 1/3 = 1000
      expect(r.lines.find(l => l.label === 'Férias')?.amount).toBe(3000);
      expect(r.oneThird).toBe(1000);
      expect(r.abonoAmount).toBe(0);
      // base tributável = 3000 + 1000 = 4000
      expect(r.taxableBase).toBe(4000);
      expect(r.inss).toBeGreaterThan(0);
    });

    it('média de variáveis integra a base', () => {
      const r = service.buildRecibo(
        {
          baseSalary: 3000,
          variableAverage: 600,
          entitledDays: 30,
          abonoPecuniarioDays: 0,
          isDouble: false,
          dependentsCount: 0,
          allowSimplifiedDeduction: true,
          year: 2026,
        },
        ids,
      );
      expect(r.baseRemuneration).toBe(3600);
      expect(r.lines.find(l => l.label === 'Férias')?.amount).toBe(3600);
      expect(r.oneThird).toBe(1200);
    });

    it('abono pecuniário (10 dias) é isento e reduz dias gozados', () => {
      const r = service.buildRecibo(
        {
          baseSalary: 3000,
          variableAverage: 0,
          entitledDays: 30,
          abonoPecuniarioDays: 10,
          isDouble: false,
          dependentsCount: 0,
          allowSimplifiedDeduction: true,
          year: 2026,
        },
        ids,
      );
      expect(r.vacationDays).toBe(20);
      // abono = 3000/30*10 = 1000; 1/3 abono = 333,33
      expect(r.abonoAmount).toBe(1000);
      expect(r.abonoOneThird).toBe(333.33);
      // férias gozadas = 3000/30*20 = 2000; 1/3 = 666,67
      expect(r.lines.find(l => l.label === 'Férias')?.amount).toBe(2000);
      expect(r.oneThird).toBe(666.67);
      // base tributável = férias + 1/3 = 2000 + 666,67 (abono EXCLUÍDO)
      expect(r.taxableBase).toBe(2666.67);
    });

    it('limita abono a 10 dias (art. 143)', () => {
      const r = service.buildRecibo(
        {
          baseSalary: 3000,
          variableAverage: 0,
          entitledDays: 30,
          abonoPecuniarioDays: 15,
          isDouble: false,
          dependentsCount: 0,
          allowSimplifiedDeduction: true,
          year: 2026,
        },
        ids,
      );
      expect(r.abonoPecuniarioDays).toBe(10);
      expect(r.vacationDays).toBe(20);
    });

    it('férias em dobro (art. 137) duplica férias e 1/3', () => {
      const single = service.buildRecibo(
        {
          baseSalary: 3000,
          variableAverage: 0,
          entitledDays: 30,
          abonoPecuniarioDays: 0,
          isDouble: false,
          dependentsCount: 0,
          allowSimplifiedDeduction: true,
          year: 2026,
        },
        ids,
      );
      const double = service.buildRecibo(
        {
          baseSalary: 3000,
          variableAverage: 0,
          entitledDays: 30,
          abonoPecuniarioDays: 0,
          isDouble: true,
          dependentsCount: 0,
          allowSimplifiedDeduction: true,
          year: 2026,
        },
        ids,
      );
      const dFerias = double.lines.find(l => /Férias/.test(l.label))?.amount;
      const sFerias = single.lines.find(l => /Férias/.test(l.label))?.amount;
      expect(dFerias).toBe((sFerias as number) * 2);
      expect(double.oneThird).toBe(single.oneThird * 2);
      expect(double.taxableBase).toBe(8000); // 6000 + 2000
    });

    it('INSS sobre base própria (férias + 1/3) — caso hand-calc 2026', () => {
      // base = 3000 + 1000 = 4000 (tabela INSS 2026 progressiva)
      // faixa1 0–1621 @7,5% = 121,575
      // faixa2 1621,01–2902,84 @9% = (2902,84-1621)*9% = 115,3656
      // faixa3 2902,85–4354,27 @12% sobre (4000-2902,84) = 1097,16*12% = 131,6592
      // total ≈ 121,58 + 115,37 + 131,66 = 368,60 (arred.)
      const r = service.buildRecibo(
        {
          baseSalary: 3000,
          variableAverage: 0,
          entitledDays: 30,
          abonoPecuniarioDays: 0,
          isDouble: false,
          dependentsCount: 0,
          allowSimplifiedDeduction: true,
          year: 2026,
        },
        ids,
      );
      expect(r.taxableBase).toBe(4000);
      expect(r.inss).toBeCloseTo(368.6, 1);
      // net = earnings(3000+1000) − inss − irrf
      expect(r.net).toBe(r.earnings - r.discounts);
    });

    // soldThird: atalho para abono pecuniário de 1/3 (art. 143).
    it('soldThird=true sem dias explícitos assume 1/3 (10 dias) como abono', () => {
      const r = service.buildRecibo(
        {
          baseSalary: 3000,
          variableAverage: 0,
          entitledDays: 30,
          abonoPecuniarioDays: 0,
          soldThird: true,
          isDouble: false,
          dependentsCount: 0,
          allowSimplifiedDeduction: true,
          year: 2026,
        },
        ids,
      );
      expect(r.abonoPecuniarioDays).toBe(10); // floor(30/3) = 10
      expect(r.vacationDays).toBe(20);
      expect(r.abonoAmount).toBe(1000);
    });

    it('soldThird ignorado quando abonoPecuniarioDays explícito (>0) prevalece', () => {
      const r = service.buildRecibo(
        {
          baseSalary: 3000,
          variableAverage: 0,
          entitledDays: 30,
          abonoPecuniarioDays: 5,
          soldThird: true,
          isDouble: false,
          dependentsCount: 0,
          allowSimplifiedDeduction: true,
          year: 2026,
        },
        ids,
      );
      expect(r.abonoPecuniarioDays).toBe(5);
      expect(r.vacationDays).toBe(25);
    });

    it('soldThird respeita o teto de 1/3 para direito reduzido (art. 130)', () => {
      const r = service.buildRecibo(
        {
          baseSalary: 3000,
          variableAverage: 0,
          entitledDays: 18, // 15–23 faltas
          abonoPecuniarioDays: 0,
          soldThird: true,
          isDouble: false,
          dependentsCount: 0,
          allowSimplifiedDeduction: true,
          year: 2026,
        },
        ids,
      );
      expect(r.abonoPecuniarioDays).toBe(6); // floor(18/3) = 6
      expect(r.vacationDays).toBe(12);
    });
  });

  // -----------------------------------------------------------------------
  // Sobreposição de períodos de gozo
  // -----------------------------------------------------------------------
  describe('detectPeriodOverlap', () => {
    const day = (m: number, d: number) => new Date(2026, m, d);

    it('períodos disjuntos não se sobrepõem', () => {
      const r = service.detectPeriodOverlap(
        [{ startDate: day(0, 1), days: 10 }], // 01–10 jan
        [{ startDate: day(0, 20), days: 10 }], // 20–29 jan
      );
      expect(r.overlaps).toBe(false);
    });

    it('detecta sobreposição parcial', () => {
      const r = service.detectPeriodOverlap(
        [{ startDate: day(0, 1), days: 15 }], // 01–15 jan
        [{ startDate: day(0, 10), days: 10 }], // 10–19 jan
      );
      expect(r.overlaps).toBe(true);
      expect(r.candidate?.days).toBe(15);
    });

    it('limites inclusivos: fim de um = início do outro sobrepõe', () => {
      const r = service.detectPeriodOverlap(
        [{ startDate: day(0, 1), days: 10 }], // 01–10 jan
        [{ startDate: day(0, 10), days: 5 }], // 10–14 jan
      );
      expect(r.overlaps).toBe(true);
    });

    it('lista de existentes vazia nunca sobrepõe', () => {
      const r = service.detectPeriodOverlap([{ startDate: day(0, 1), days: 10 }], []);
      expect(r.overlaps).toBe(false);
    });
  });

  describe('periodEndDate', () => {
    it('fim inclusivo = início + (dias − 1)', () => {
      const end = service.periodEndDate(new Date(2026, 0, 1), 30);
      expect(end.getDate()).toBe(30);
      expect(end.getMonth()).toBe(0);
    });
  });
});
