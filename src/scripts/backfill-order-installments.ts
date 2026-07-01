/**
 * backfill-order-installments.ts
 * ---------------------------------------------------------------------------
 * Seeds the uniform per-tranche reconciliation anchor for legacy orders: every
 * non-cancelled Order must carry >= 1 OrderInstallment (single-payment = 1 parcela
 * = whole order; boleto Nx = N parcelas), mirroring the receivables
 * Invoice→Installment model. Historically parcelas were only generated for
 * BANK_SLIP with N > 1, so OrderInstallment was empty for every other order.
 *
 * For each order with ZERO installments and status != CANCELLED it generates the
 * schedule via OrderService.generateInstallmentsForOrder (same centavo/remainder
 * semantics as the live paths), then MIRRORS the parcela statuses to the order's
 * EXISTING paymentStatus so the rollup stays consistent:
 *   - PAID           → all parcelas PAID (stamped from the order's paidAt/paidById);
 *   - PARTIALLY_PAID → left PENDING (no per-parcela split is known — rare/none);
 *   - AWAITING / PENDING → left PENDING (order status unchanged).
 * It deliberately does NOT recompute the order rollup FROM the fresh (all-PENDING)
 * schedule — that would wrongly downgrade an already-PAID order to AWAITING_PAYMENT
 * and would strip the ADMIN-gated PENDING pre-payable state. Mirroring keeps both
 * sides consistent without touching the order's payment status.
 *
 * Idempotent: orders that already have any installment are skipped, so re-running
 * only backfills orders still missing a schedule.
 *
 * Run in dev:
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     src/scripts/backfill-order-installments.ts
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { OrderInstallmentStatus, OrderPaymentStatus, OrderStatus } from '@prisma/client';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { OrderService } from '../modules/inventory/order/order.service';

/** Order payable total (mirrors OrderService.computeOrderPayableTotal). */
function computeTotal(order: {
  freight?: number | null;
  discount?: number | null;
  totalOverride?: number | null;
  items: Array<{ orderedQuantity: number; price: number; icms?: number | null; ipi?: number | null }>;
}): number {
  if (order.totalOverride != null) {
    return Math.max(0, Math.round(order.totalOverride * 100) / 100);
  }
  let itemsTotal = 0;
  let goodsSubtotal = 0;
  for (const item of order.items) {
    const subtotal = item.orderedQuantity * item.price;
    goodsSubtotal += subtotal;
    itemsTotal += subtotal * (1 + (item.icms || 0) / 100 + (item.ipi || 0) / 100);
  }
  const discount = order.discount || 0;
  const discountAmount = discount > 0 ? goodsSubtotal * (discount / 100) : 0;
  const total = itemsTotal - discountAmount + (order.freight || 0);
  return Math.max(0, Math.round(total * 100) / 100);
}

async function main(): Promise<void> {
  const logger = new Logger('OrderInstallmentBackfill');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const prisma = app.get(PrismaService);
    const orderService = app.get(OrderService);

    const orders = await prisma.order.findMany({
      where: {
        status: { not: OrderStatus.CANCELLED },
        installments: { none: {} },
      },
      select: {
        id: true,
        paymentStatus: true,
        paidAt: true,
        paidById: true,
        installmentCount: true,
        paymentDueDays: true,
        paymentFirstDueDate: true,
        createdAt: true,
        freight: true,
        discount: true,
        totalOverride: true,
        items: { select: { orderedQuantity: true, price: true, icms: true, ipi: true } },
      },
    });

    logger.log(`Found ${orders.length} order(s) with no installments.`);

    let processed = 0;
    let paidMirrored = 0;
    let installmentsCreated = 0;

    for (const order of orders) {
      const count = order.installmentCount || 1;
      const total = computeTotal(order);

      await prisma.$transaction(async tx => {
        await orderService.generateInstallmentsForOrder(tx, order.id, {
          total,
          count,
          intervalDays: order.paymentDueDays ?? null,
          firstDueDate: order.paymentFirstDueDate ?? null,
          from: order.createdAt ?? undefined,
        });

        // Mirror the parcela status to the order's existing paymentStatus.
        if (order.paymentStatus === OrderPaymentStatus.PAID) {
          await tx.orderInstallment.updateMany({
            where: { orderId: order.id },
            data: {
              status: OrderInstallmentStatus.PAID,
              paidAt: order.paidAt ?? new Date(),
              paidById: order.paidById ?? null,
            },
          });
          paidMirrored += 1;
        }
        // AWAITING_PAYMENT / PENDING / PARTIALLY_PAID → parcelas stay PENDING (created
        // by generateInstallmentsForOrder); the order's paymentStatus is left as-is.

        const n = await tx.orderInstallment.count({ where: { orderId: order.id } });
        installmentsCreated += n;
      });

      processed += 1;
    }

    const totalInstallments = await prisma.orderInstallment.count();

    logger.log(
      `Done. orders processed=${processed} (PAID-mirrored=${paidMirrored}), ` +
        `installments created this run=${installmentsCreated}, ` +
        `OrderInstallment total now=${totalInstallments}.`,
    );
  } catch (err) {
    logger.error(`Backfill failed: ${err instanceof Error ? err.stack : err}`);
    exitCode = 1;
  } finally {
    await app.close();
    process.exitCode = exitCode;
  }
}

void main();
