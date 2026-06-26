// user-benefit-installment.service.spec.ts
// Part H — convênio installment advance (LOAN/ADVANCE persistent-discount semantics).

import { UserBenefitService } from './user-benefit.service';
import { BENEFIT_ENROLLMENT_STATUS } from '../../../constants';

const changeLog = { logChange: jest.fn().mockResolvedValue(undefined) };

function buildService(prisma: any): UserBenefitService {
  return new UserBenefitService(prisma, changeLog as any, {} as any);
}

function prismaWith(record: any) {
  const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...record, ...data }));
  const findUnique = jest.fn().mockResolvedValue(record);
  return {
    prisma: { userBenefit: { findUnique, update } } as any,
    update,
    findUnique,
  };
}

describe('UserBenefitService.advanceInstallment', () => {
  beforeEach(() => changeLog.logChange.mockClear());

  it('advances currentInstallment by one mid-plan', async () => {
    const { prisma, update } = prismaWith({
      id: 'ub1',
      status: BENEFIT_ENROLLMENT_STATUS.ACTIVE,
      totalInstallments: 6,
      currentInstallment: 2,
      endDate: null,
    });
    const service = buildService(prisma);

    const result = await service.advanceInstallment('ub1', undefined, prisma as any);

    expect(result.currentInstallment).toBe(3);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentInstallment: 3 } }),
    );
    expect(result.status).toBe(BENEFIT_ENROLLMENT_STATUS.ACTIVE);
  });

  it('defaults a null currentInstallment to 1 and advances to 2', async () => {
    const { prisma } = prismaWith({
      id: 'ub1',
      status: BENEFIT_ENROLLMENT_STATUS.ACTIVE,
      totalInstallments: 3,
      currentInstallment: null,
      endDate: null,
    });
    const service = buildService(prisma);
    const result = await service.advanceInstallment('ub1', undefined, prisma as any);
    expect(result.currentInstallment).toBe(2);
  });

  it('terminates the enrollment when the last installment is reached', async () => {
    const { prisma, update } = prismaWith({
      id: 'ub1',
      status: BENEFIT_ENROLLMENT_STATUS.ACTIVE,
      totalInstallments: 6,
      currentInstallment: 6,
      endDate: null,
    });
    const service = buildService(prisma);

    const result = await service.advanceInstallment('ub1', undefined, prisma as any);

    expect(result.status).toBe(BENEFIT_ENROLLMENT_STATUS.TERMINATED);
    expect(result.currentInstallment).toBe(6); // stays clamped at total
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe(BENEFIT_ENROLLMENT_STATUS.TERMINATED);
    expect(data.endDate).toBeInstanceOf(Date);
  });

  it('is a no-op for non-installment enrollments (totalInstallments null)', async () => {
    const { prisma, update } = prismaWith({
      id: 'ub1',
      status: BENEFIT_ENROLLMENT_STATUS.ACTIVE,
      totalInstallments: null,
      currentInstallment: null,
      endDate: null,
    });
    const service = buildService(prisma);
    const result = await service.advanceInstallment('ub1', undefined, prisma as any);
    expect(update).not.toHaveBeenCalled();
    expect(result.status).toBe(BENEFIT_ENROLLMENT_STATUS.ACTIVE);
  });

  it('is a no-op for already-terminated enrollments', async () => {
    const { prisma, update } = prismaWith({
      id: 'ub1',
      status: BENEFIT_ENROLLMENT_STATUS.TERMINATED,
      totalInstallments: 6,
      currentInstallment: 6,
      endDate: new Date(),
    });
    const service = buildService(prisma);
    await service.advanceInstallment('ub1', undefined, prisma as any);
    expect(update).not.toHaveBeenCalled();
  });
});
