// leave.service.spec.ts
// Pure unit tests for the afastamento leave-derived computations (Part E):
//   - the >30 (NOT ≥30) return-exam threshold
//   - the 15-day employer / 16th-day INSS payroll split
//
// Only pure methods are exercised; prisma/changelog/file deps are unused by them,
// so the service is constructed with nulls (mirrors the lightweight HR golden specs).

import { LeaveService } from './leave.service';
import { LEAVE_TYPE } from '@constants';

describe('LeaveService — pure afastamento logic', () => {
  let service: LeaveService;

  beforeEach(() => {
    service = new LeaveService(null as any, null as any, null as any);
  });

  const daysAfter = (start: Date, days: number) => {
    const d = new Date(start);
    d.setDate(d.getDate() + days);
    return d;
  };

  describe('computeReturnExamRequired (>30 days, not >=30)', () => {
    const start = new Date(2026, 0, 1);
    const callRule = (type: string, end: Date, provided?: boolean) =>
      (service as any).computeReturnExamRequired(type, start, null, end, provided) as boolean;

    it('does NOT require a return exam at exactly 30 days (boundary)', () => {
      // end - start === exactly 30 days → must be false (the bug was `>= 30`)
      expect(callRule(LEAVE_TYPE.ILLNESS_INSS, daysAfter(start, 30))).toBe(false);
    });

    it('requires a return exam at 31 days (just over the threshold)', () => {
      expect(callRule(LEAVE_TYPE.ILLNESS_INSS, daysAfter(start, 31))).toBe(true);
    });

    it('requires a return exam for a long WORK_ACCIDENT leave', () => {
      expect(callRule(LEAVE_TYPE.WORK_ACCIDENT, daysAfter(start, 90))).toBe(true);
    });

    it('does not apply the rule to non-INSS leave types', () => {
      expect(callRule(LEAVE_TYPE.MATERNITY, daysAfter(start, 120))).toBe(false);
    });

    it('preserves a manual true even when the rule does not fire (no silent overwrite)', () => {
      expect(callRule(LEAVE_TYPE.ILLNESS_INSS, daysAfter(start, 10), true)).toBe(true);
    });

    it('the legal rule raises the flag even if a manual false was provided (compliance floor)', () => {
      expect(callRule(LEAVE_TYPE.ILLNESS_INSS, daysAfter(start, 60), false)).toBe(true);
    });
  });

  describe('computeLeavePayrollSplit (15-day employer / 16th-day INSS)', () => {
    const start = new Date(2026, 0, 1);

    it('splits a 40-day ILLNESS_INSS leave as 15 employer / 25 INSS', () => {
      const r = service.computeLeavePayrollSplit({
        type: LEAVE_TYPE.ILLNESS_INSS,
        startDate: start,
        actualEndDate: daysAfter(start, 39), // inclusive → 40 days
      });
      expect(r.totalDays).toBe(40);
      expect(r.employerPaidDays).toBe(15);
      expect(r.inssDays).toBe(25);
    });

    it('a short (10-day) INSS leave is fully employer-paid, 0 INSS', () => {
      const r = service.computeLeavePayrollSplit({
        type: LEAVE_TYPE.WORK_ACCIDENT,
        startDate: start,
        actualEndDate: daysAfter(start, 9), // 10 days
      });
      expect(r.totalDays).toBe(10);
      expect(r.employerPaidDays).toBe(10);
      expect(r.inssDays).toBe(0);
    });

    it('exactly 15 days → 15 employer / 0 INSS (16th day is the INSS hand-off)', () => {
      const r = service.computeLeavePayrollSplit({
        type: LEAVE_TYPE.ILLNESS_INSS,
        startDate: start,
        actualEndDate: daysAfter(start, 14), // 15 days
      });
      expect(r.employerPaidDays).toBe(15);
      expect(r.inssDays).toBe(0);
    });

    it('non-INSS leave (e.g. maternity) has no employer/INSS split', () => {
      const r = service.computeLeavePayrollSplit({
        type: LEAVE_TYPE.MATERNITY,
        startDate: start,
        actualEndDate: daysAfter(start, 119), // 120 days
      });
      expect(r.totalDays).toBe(120);
      expect(r.employerPaidDays).toBe(120);
      expect(r.inssDays).toBe(0);
    });

    it('falls back to expectedEndDate when actualEndDate is absent', () => {
      const r = service.computeLeavePayrollSplit({
        type: LEAVE_TYPE.ILLNESS_INSS,
        startDate: start,
        expectedEndDate: daysAfter(start, 19), // 20 days
        actualEndDate: null,
      });
      expect(r.totalDays).toBe(20);
      expect(r.employerPaidDays).toBe(15);
      expect(r.inssDays).toBe(5);
    });
  });
});
