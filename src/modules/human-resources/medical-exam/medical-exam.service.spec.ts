// medical-exam.service.spec.ts
// Unit tests for Part E medical-exam logic:
//   - FIT_WITH_RESTRICTIONS apt gating (isExamResultApt)
//   - periodic auto-followup: periodicity resolution (exam → Position → default)
//     and the next-exam scheduling date math.
//
// DB-touching paths use a minimal mocked PrismaTransaction.

import { MedicalExamService, isExamResultApt } from './medical-exam.service';
import { MEDICAL_EXAM_RESULT, MEDICAL_EXAM_TYPE, MEDICAL_EXAM_STATUS } from '@constants';

describe('MedicalExamService — Part E', () => {
  describe('isExamResultApt (apto unless UNFIT)', () => {
    it('FIT is apt', () => {
      expect(isExamResultApt(MEDICAL_EXAM_RESULT.FIT)).toBe(true);
    });
    it('FIT_WITH_RESTRICTIONS is conditionally apt', () => {
      expect(isExamResultApt(MEDICAL_EXAM_RESULT.FIT_WITH_RESTRICTIONS)).toBe(true);
    });
    it('PENDING is treated as apt (not yet unfit)', () => {
      expect(isExamResultApt(MEDICAL_EXAM_RESULT.PENDING)).toBe(true);
    });
    it('UNFIT is NOT apt', () => {
      expect(isExamResultApt(MEDICAL_EXAM_RESULT.UNFIT)).toBe(false);
    });
  });

  describe('periodic auto-followup', () => {
    let service: MedicalExamService;
    const changeLog = { logChange: jest.fn(), logChangeBatch: jest.fn() };

    beforeEach(() => {
      service = new MedicalExamService(null as any, changeLog as any, null as any);
      changeLog.logChange.mockReset();
    });

    const makeTx = (positionMonths: number | null, existingNext = false) => ({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          position: { examPeriodicityMonths: positionMonths },
        }),
      },
      medicalExam: {
        findFirst: jest.fn().mockResolvedValue(existingNext ? { id: 'existing' } : null),
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'new', ...data })),
      },
    });

    it('resolves the exam-level periodicity first', async () => {
      const tx = makeTx(24);
      const months = await (service as any).resolvePeriodicityMonths(tx, 'u1', 6);
      expect(months).toBe(6);
    });

    it("falls back to the Position's examPeriodicityMonths", async () => {
      const tx = makeTx(24);
      const months = await (service as any).resolvePeriodicityMonths(tx, 'u1', null);
      expect(months).toBe(24);
    });

    it('falls back to the 12-month legal default when nothing is set', async () => {
      const tx = makeTx(null);
      const months = await (service as any).resolvePeriodicityMonths(tx, 'u1', null);
      expect(months).toBe(12);
    });

    it('schedules the next PERIODIC exam at examDate + periodicity months', async () => {
      const tx = makeTx(null); // → 12-month default
      const examDate = new Date(2026, 0, 15);
      const created = await (service as any).scheduleNextPeriodicExam(
        tx,
        { id: 'cur', userId: 'u1', examDate, periodicityMonths: null },
        'actor',
      );
      expect(created).toBe(true);
      expect(tx.medicalExam.create).toHaveBeenCalledTimes(1);
      const arg = tx.medicalExam.create.mock.calls[0][0].data;
      expect(arg.type).toBe(MEDICAL_EXAM_TYPE.PERIODIC);
      expect(arg.status).toBe(MEDICAL_EXAM_STATUS.SCHEDULED);
      expect(arg.periodicityMonths).toBe(12);
      const scheduled = arg.scheduledAt as Date;
      expect(scheduled.getFullYear()).toBe(2027);
      expect(scheduled.getMonth()).toBe(0);
      expect(scheduled.getDate()).toBe(15);
    });

    it('is idempotent: skips when a future PERIODIC exam is already scheduled', async () => {
      const tx = makeTx(12, /* existingNext */ true);
      const created = await (service as any).scheduleNextPeriodicExam(
        tx,
        { id: 'cur', userId: 'u1', examDate: new Date(2026, 0, 15), periodicityMonths: 12 },
        'actor',
      );
      expect(created).toBe(false);
      expect(tx.medicalExam.create).not.toHaveBeenCalled();
    });
  });
});
