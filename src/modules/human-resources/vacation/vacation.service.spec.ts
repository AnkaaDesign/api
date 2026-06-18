// vacation.service.spec.ts
//
// Service-level tests for the robustness guards on the férias engine under the
// COLLAPSED status model (SCHEDULED → PAID, + EXPIRED). "Em gozo" is computed,
// never stored. Covered here: CLT gate on create, soft-delete on delete, the
// atomic PAID transition (lost-update detection), the EXPIRED→PAID exit, and the
// art. 137 payment-past-concessivo block. Prisma is mocked; `$transaction(cb)`
// runs the callback with a mock tx.

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VacationService } from './vacation.service';
import { VacationCalculationService } from './vacation-calculation.service';
import { VACATION_STATUS } from '../../../constants';

// Permissive changelog mock: any method is a no-op jest.fn resolving undefined.
const changeLogMock: any = new Proxy(
  {},
  { get: () => jest.fn().mockResolvedValue(undefined) },
);

function makeTx() {
  return {
    user: { findUnique: jest.fn() },
    payroll: { findMany: jest.fn().mockResolvedValue([]) },
    vacation: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function makeService(tx: any) {
  const prisma: any = {
    $transaction: jest.fn((cb: any) => cb(tx)),
    vacation: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
  };
  const calc = new VacationCalculationService();
  const secullum: any = {
    syncVacation: jest.fn().mockResolvedValue({ success: true }),
    removeVacation: jest.fn().mockResolvedValue({ success: true }),
  };
  const service = new VacationService(prisma, changeLogMock, calc, secullum);
  return { service, prisma, secullum };
}

describe('VacationService — robustness guards', () => {
  describe('create — CLT gate', () => {
    it('rejeita criação de férias para vínculo não-CLT', async () => {
      const tx = makeTx();
      tx.user.findUnique.mockResolvedValue({
        id: 'u1',
        name: 'Fulano',
        currentEmployeeType: 'TERCEIRIZADO',
        currentContractId: 'c1',
        currentContract: { id: 'c1', admissionDate: new Date('2024-03-10') },
        dependents: [],
      });
      const { service } = makeService(tx);

      await expect(
        service.create({ userId: 'u1', days: 30, startDate: new Date('2026-06-01') } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.vacation.create).not.toHaveBeenCalled();
    });

    it('traduz P2002 (corrida no índice único) em mensagem amigável', async () => {
      const tx = makeTx();
      tx.user.findUnique.mockResolvedValue({
        id: 'u1',
        name: 'Fulano',
        currentEmployeeType: 'CLT',
        currentContractId: 'c1',
        currentContract: { id: 'c1', admissionDate: new Date('2024-03-10') },
        dependents: [],
      });
      tx.vacation.create.mockRejectedValue({ code: 'P2002' });
      const { service } = makeService(tx);

      await expect(
        service.create({ userId: 'u1', days: 30, startDate: new Date('2026-06-01') } as any),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/já existe um registro de férias/i),
      });
    });
  });

  describe('delete — soft delete', () => {
    it('marca deletedAt em vez de excluir fisicamente', async () => {
      const tx = makeTx();
      tx.vacation.findUnique.mockResolvedValue({
        id: 'v1',
        status: VACATION_STATUS.SCHEDULED,
        deletedAt: null,
        user: { secullumEmployeeId: null },
      });
      const { service } = makeService(tx);

      await service.delete('v1');
      expect(tx.vacation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
      expect(tx.vacation.delete).not.toHaveBeenCalled();
    });

    it('bloqueia exclusão de férias já pagas', async () => {
      const tx = makeTx();
      tx.vacation.findUnique.mockResolvedValue({
        id: 'v1',
        status: VACATION_STATUS.PAID,
        deletedAt: null,
        user: { secullumEmployeeId: null },
      });
      const { service } = makeService(tx);
      await expect(service.delete('v1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('advance — markPaid (atomic transition)', () => {
    const baseVacation = {
      id: 'v1',
      status: VACATION_STATUS.SCHEDULED,
      deletedAt: null,
      baseRemuneration: 1000,
      isDouble: false,
      paymentDate: null,
      startDate: new Date('2026-01-01'),
      days: 10,
      concessiveEnd: new Date('2030-01-01'),
    };

    it('erro de concorrência quando updateMany não afeta linhas (count=0)', async () => {
      const tx = makeTx();
      tx.vacation.findUnique.mockResolvedValue({ ...baseVacation });
      tx.vacation.updateMany.mockResolvedValue({ count: 0 });
      const { service } = makeService(tx);

      await expect(service.advance('v1', {} as any)).rejects.toMatchObject({
        message: expect.stringMatching(/alterado por outra opera/i),
      });
    });

    it('bloqueia PAID quando o gozo ultrapassa o concessivo e não está em dobro (art. 137)', async () => {
      const tx = makeTx();
      tx.vacation.findUnique.mockResolvedValue({
        ...baseVacation,
        status: VACATION_STATUS.SCHEDULED,
        isDouble: false,
        concessiveEnd: new Date('2026-01-05'), // período 01–10 jan ultrapassa
        startDate: new Date('2026-01-01'),
        days: 10,
      });
      const { service } = makeService(tx);

      await expect(
        service.advance('v1', { status: VACATION_STATUS.PAID } as any),
      ).rejects.toMatchObject({ message: expect.stringMatching(/dobro/i) });
      expect(tx.vacation.updateMany).not.toHaveBeenCalled();
    });

    it('avança SCHEDULED → PAID quando dentro do concessivo', async () => {
      const tx = makeTx();
      tx.vacation.findUnique
        .mockResolvedValueOnce({ ...baseVacation })
        .mockResolvedValueOnce({ ...baseVacation, status: VACATION_STATUS.PAID });
      tx.vacation.updateMany.mockResolvedValue({ count: 1 });
      const { service } = makeService(tx);

      const res = await service.advance('v1', { status: VACATION_STATUS.PAID } as any);
      expect(res.success).toBe(true);
      expect(tx.vacation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'v1', status: VACATION_STATUS.SCHEDULED } }),
      );
    });

    it('avança EXPIRED → PAID (saída do beco-sem-saída)', async () => {
      const tx = makeTx();
      // EXPIRED com gozo dentro do concessivo (não força dobro extra) e já isDouble.
      const expired = {
        ...baseVacation,
        status: VACATION_STATUS.EXPIRED,
        isDouble: true,
        concessiveEnd: new Date('2030-01-01'),
      };
      tx.vacation.findUnique
        .mockResolvedValueOnce({ ...expired })
        .mockResolvedValueOnce({ ...expired, status: VACATION_STATUS.PAID });
      tx.vacation.updateMany.mockResolvedValue({ count: 1 });
      const { service } = makeService(tx);

      const res = await service.advance('v1', { status: VACATION_STATUS.PAID } as any);
      expect(res.success).toBe(true);
      expect(tx.vacation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'v1', status: VACATION_STATUS.EXPIRED } }),
      );
    });

    it('registro soft-deleted é tratado como inexistente', async () => {
      const tx = makeTx();
      tx.vacation.findUnique.mockResolvedValue({ ...baseVacation, deletedAt: new Date() });
      const { service } = makeService(tx);
      await expect(service.advance('v1', {} as any)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
