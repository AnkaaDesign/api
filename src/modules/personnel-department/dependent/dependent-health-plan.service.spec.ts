// dependent-health-plan.service.spec.ts
// Part H — dependent health-plan cost aggregation accessor.

import { DependentService } from './dependent.service';
import { BENEFIT_KIND, BENEFIT_ENROLLMENT_STATUS } from '../../../constants';

function buildService(prisma: any): DependentService {
  return new DependentService(prisma, {} as any);
}

describe('DependentService.getHealthPlanCostForUser', () => {
  it('aggregates titular value + Σ enrolled dependents (= effective cost)', async () => {
    const enrollment = {
      id: 'plan-1',
      userId: 'u1',
      monthlyValue: 250,
      status: BENEFIT_ENROLLMENT_STATUS.ACTIVE,
    };
    const prisma = {
      userBenefit: {
        findFirst: jest.fn().mockResolvedValue(enrollment),
      },
      dependent: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ healthPlanValue: 120 }, { healthPlanValue: 80 }]),
      },
    };

    const service = buildService(prisma);
    const cost = await service.getHealthPlanCostForUser('u1');

    expect(cost.healthPlanBenefitId).toBe('plan-1');
    expect(cost.titularValue).toBe(250);
    expect(cost.dependentsValue).toBe(200);
    expect(cost.dependentsCount).toBe(2);
    expect(cost.totalValue).toBe(450);

    // Asked for the ACTIVE HEALTH_PLAN of the user.
    expect(prisma.userBenefit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u1',
          status: BENEFIT_ENROLLMENT_STATUS.ACTIVE,
          benefit: { kind: BENEFIT_KIND.HEALTH_PLAN },
        }),
      }),
    );
    // Only dependents enrolled into THIS plan are summed.
    expect(prisma.dependent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { healthPlanBenefitId: 'plan-1' } }),
    );
  });

  it('returns zeros (null id) when the user has no active plan', async () => {
    const prisma = {
      userBenefit: { findFirst: jest.fn().mockResolvedValue(null) },
      dependent: { findMany: jest.fn() },
    };
    const service = buildService(prisma);
    const cost = await service.getHealthPlanCostForUser('u1');

    expect(cost).toEqual({
      healthPlanBenefitId: null,
      titularValue: 0,
      dependentsValue: 0,
      dependentsCount: 0,
      totalValue: 0,
    });
    expect(prisma.dependent.findMany).not.toHaveBeenCalled();
  });

  it('treats null/negative dependent values as 0 and resolves the requested plan kind', async () => {
    const prisma = {
      userBenefit: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'dental-1', userId: 'u1', monthlyValue: 40 }),
      },
      dependent: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ healthPlanValue: null }, { healthPlanValue: -10 }, { healthPlanValue: 15 }]),
      },
    };
    const service = buildService(prisma);
    const cost = await service.getHealthPlanCostForUser('u1', BENEFIT_KIND.DENTAL_PLAN);

    expect(cost.titularValue).toBe(40);
    expect(cost.dependentsValue).toBe(15);
    expect(cost.totalValue).toBe(55);
    expect(prisma.userBenefit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ benefit: { kind: BENEFIT_KIND.DENTAL_PLAN } }),
      }),
    );
  });
});
