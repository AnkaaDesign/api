// thirteenth-calculation.service.spec.ts
//
// Golden-value tests for the 13º salário (gratificação natalina) engine.
// Expected values were produced by running the exact tax-table math in Node
// (2025 progressive INSS + IRRF brackets, no redutor) and captured below.
// If the tax tables change, regenerate the expected values.

import { ThirteenthCalculationService } from './thirteenth-calculation.service';

describe('ThirteenthCalculationService', () => {
  let service: ThirteenthCalculationService;

  beforeEach(() => {
    service = new ThirteenthCalculationService();
  });

  // ==========================================================================
  // Avos — regra dos ≥15 dias (Lei 4.090/62 art. 1º §2º)
  // ==========================================================================
  describe('computeAvos (≥15-day rule)', () => {
    it('gives 12 avos for a full calendar year of work', () => {
      expect(
        service.computeAvos({
          admissionDate: new Date(2020, 0, 1),
          year: 2025,
          referenceDate: new Date(2025, 11, 31),
        }),
      ).toBe(12);
    });

    it('counts a month when exactly 15 days are worked (admission Jun 16 → 15 days in June)', () => {
      // June 16..30 inclusive = 15 days → June counts; Jun..Dec = 7 months.
      expect(
        service.computeAvos({
          admissionDate: new Date(2025, 5, 16),
          year: 2025,
          referenceDate: new Date(2025, 11, 31),
        }),
      ).toBe(7);
    });

    it('does NOT count a month with only 14 days worked (admission Jun 17 → 14 days in June)', () => {
      // June 17..30 inclusive = 14 days → June dropped; Jul..Dec = 6 months.
      expect(
        service.computeAvos({
          admissionDate: new Date(2025, 5, 17),
          year: 2025,
          referenceDate: new Date(2025, 11, 31),
        }),
      ).toBe(6);
    });

    it('counts exactly 1 avo when the only month worked has ≥15 days (admission Dec 17)', () => {
      // Dec 17..31 inclusive = 15 days → 1 avo.
      expect(
        service.computeAvos({
          admissionDate: new Date(2025, 11, 17),
          year: 2025,
          referenceDate: new Date(2025, 11, 31),
        }),
      ).toBe(1);
    });

    it('gives 0 avos when the only worked month has <15 days (admission Dec 18)', () => {
      // Dec 18..31 inclusive = 14 days → 0.
      expect(
        service.computeAvos({
          admissionDate: new Date(2025, 11, 18),
          year: 2025,
          referenceDate: new Date(2025, 11, 31),
        }),
      ).toBe(0);
    });

    it('treats a null admission date as present since Jan 1 (replica of termination thirteenthMonths)', () => {
      // Faithful replication of TerminationCalculationService.thirteenthMonths:
      // a null start date means the period begins at year-start ⇒ full year.
      // (The SERVICE layer separately skips users whose current contract has no
      // admissionDate; eligibility is decided there, not in this pure helper.)
      expect(service.computeAvos({ admissionDate: null, year: 2025 })).toBe(12);
    });

    it('defaults the reference date to Dec 31 of the year (no referenceDate ⇒ full year)', () => {
      expect(service.computeAvos({ admissionDate: new Date(2020, 0, 1), year: 2025 })).toBe(12);
    });
  });

  // ==========================================================================
  // Parcelas — 1ª (50%, sem descontos) e 2ª (base EXCLUSIVA do 13º)
  // ==========================================================================
  describe('computeInstallments', () => {
    it('1ª parcela = 50% do valor cheio, SEM descontos', () => {
      const r = service.computeInstallments({
        baseRemuneration: 6000,
        avos: 12,
        dependentsCount: 0,
        allowSimplifiedDeduction: true,
        year: 2025,
      });
      // Valor cheio = 6000/12 × 12 = 6000; 1ª = 50% = 3000, sem INSS/IRRF nela.
      expect(r.fullEntitlement).toBe(6000);
      expect(r.firstInstallment).toBe(3000);
      // A 1ª parcela é exatamente metade do bruto, independentemente de impostos.
      expect(r.firstInstallment).toBeCloseTo(r.fullEntitlement * 0.5, 2);
    });

    it('2ª parcela é tributada na base EXCLUSIVA do 13º (hand calc, tabelas 2025)', () => {
      const r = service.computeInstallments({
        baseRemuneration: 6000,
        avos: 12,
        dependentsCount: 0,
        allowSimplifiedDeduction: true,
        year: 2025,
      });
      // Hand calc (2025, base exclusiva = valor cheio 6000):
      //   INSS progressivo = 113.85 + 114.8292 + 167.634 + 253.2838 = 649.597 → 649.60
      //   IRRF: base = 6000 − 607.20 (simplificado) = 5392.80? não — desconto
      //         simplificado SUBSTITUI as deduções legais e usa o INSS quando maior:
      //         legal = INSS 649.60 > simplificado 607.20 ⇒ usa legal ⇒
      //         taxable = 6000 − 649.60 = 5350.40
      //         faixa 27.5%: 5350.40 × 0.275 − 908.73 = 562.626 → 562.63
      //   2ª bruta = 3000; 2ª líquida = 3000 − 649.60 − 562.63 = 1787.77
      expect(r.inss).toBe(649.6);
      expect(r.irrf).toBe(562.63);
      expect(r.secondInstallmentGross).toBe(3000);
      expect(r.secondInstallment).toBe(1787.77);
    });

    it('a base EXCLUSIVA usa o valor cheio do ANO, não a 2ª parcela isolada', () => {
      // Sanidade: dobrar a base mantém a proporção e os impostos crescem sobre o
      // valor cheio (não sobre os 50% da 2ª parcela).
      const r = service.computeInstallments({
        baseRemuneration: 6000,
        avos: 12,
        dependentsCount: 0,
        allowSimplifiedDeduction: true,
        year: 2025,
      });
      // Se o INSS incidisse só sobre a 2ª parcela (3000), seria muito menor que
      // 649.60 — confirma incidência sobre a base exclusiva (6000).
      expect(r.inss).toBeGreaterThan(500);
    });

    it('proporciona pelo número de avos (meio ano ⇒ metade do valor cheio)', () => {
      const r = service.computeInstallments({
        baseRemuneration: 6000,
        avos: 6,
        dependentsCount: 0,
        allowSimplifiedDeduction: true,
        year: 2025,
      });
      // 6000/12 × 6 = 3000
      expect(r.fullEntitlement).toBe(3000);
      expect(r.firstInstallment).toBe(1500);
      expect(r.secondInstallmentGross).toBe(1500);
    });

    it('zera tudo quando avos = 0', () => {
      const r = service.computeInstallments({
        baseRemuneration: 6000,
        avos: 0,
        dependentsCount: 0,
        allowSimplifiedDeduction: true,
        year: 2025,
      });
      expect(r.fullEntitlement).toBe(0);
      expect(r.firstInstallment).toBe(0);
      expect(r.secondInstallment).toBe(0);
      expect(r.inss).toBe(0);
      expect(r.irrf).toBe(0);
    });
  });
});
