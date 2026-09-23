import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { OrderService } from '@modules/inventory/order/order.service';
import { ORDER_STATUS } from '@/constants/enums';
import type { OrderCreateFormData } from '@/schemas/order';

import { componentDemand, packageLabelOf } from './paint-component-math';

/**
 * Do VOLUME DE TINTA para o PEDIDO DE COMPRA.
 *
 * O planejador de disponibilidade já responde "dá para produzir?"; o que
 * faltava era o passo seguinte, que é o único que resolve o problema quando a
 * resposta é não: comprar. Quem compra não quer escolher item nenhum — a
 * fórmula já sabe quais são e em que proporção. O operador diz a TINTA e o
 * VOLUME, e o resto é conta.
 *
 * Duas entradas, e elas fazem a MESMA conta de propósito: `buildPlan` é o que a
 * tela mostra antes de confirmar e `createOrder` é o que grava. O plano não é
 * enviado de volta pelo cliente — o servidor recalcula a partir dos mesmos
 * parâmetros, senão a quantidade gravada seria a que o navegador quis, e não a
 * que a fórmula pede.
 */

/** O que entra no pedido: a fórmula inteira, ou só o que falta no estoque. */
export const PAINT_PURCHASE_MODE = {
  FULL: 'FULL',
  MISSING: 'MISSING',
} as const;
export type PaintPurchaseMode = (typeof PAINT_PURCHASE_MODE)[keyof typeof PAINT_PURCHASE_MODE];

export const paintPurchasePlanSchema = z.object({
  paintId: z.string().uuid({ message: 'Tinta inválida' }),
  volumeLiters: z
    .number({ invalid_type_error: 'Volume inválido' })
    .positive('Volume deve ser positivo')
    .max(10000, 'Volume máximo é 10.000 L'),
  mode: z
    .enum([PAINT_PURCHASE_MODE.FULL, PAINT_PURCHASE_MODE.MISSING])
    .default(PAINT_PURCHASE_MODE.FULL),
});
export type PaintPurchasePlanInput = z.infer<typeof paintPurchasePlanSchema>;

export const paintPurchaseOrderSchema = paintPurchasePlanSchema.extend({
  description: z
    .string()
    .min(1, 'Descrição é obrigatória')
    .max(500, 'Descrição deve ter no máximo 500 caracteres'),
  supplierId: z.string().uuid({ message: 'Fornecedor inválido' }).nullable().optional(),
  forecast: z.coerce.date({ invalid_type_error: 'Data de previsão inválida' }).nullable().optional(),
  notes: z.string().max(2000, 'Observação muito longa').nullable().optional(),
});
export type PaintPurchaseOrderInput = z.infer<typeof paintPurchaseOrderSchema>;

export interface PaintPurchasePlanItem {
  itemId: string;
  itemName: string;
  uniCode: string | null;
  /** proporção do componente na fórmula, em porcento */
  ratio: number;
  requiredGrams: number;
  requiredUnits: number | null;
  availableUnits: number;
  missingUnits: number | null;
  /** o que vai para o pedido, já arredondado conforme a opção */
  quantity: number;
  /** o que é UMA unidade deste item ("3,6 L · 4,2 kg") */
  packageLabel: string | null;
  unitPrice: number;
  totalPrice: number;
  supplierId: string | null;
  supplierName: string | null;
  /** sem medida de peso não há conversão para unidade — fica de fora do pedido */
  measured: boolean;
  /** entra no pedido (quantidade > 0 e com medida) */
  included: boolean;
}

export interface PaintPurchasePlan {
  paint: {
    id: string;
    name: string;
    hex: string;
    code: string | null;
    finish: string;
    typeName: string | null;
    brandName: string | null;
  };
  volumeLiters: number;
  mode: PaintPurchaseMode;
  items: PaintPurchasePlanItem[];
  totals: {
    /** quantos componentes entram no pedido */
    itemCount: number;
    totalUnits: number;
    totalPrice: number;
  };
  /** Só quando TODOS os componentes do pedido vêm do mesmo fornecedor. */
  suggestedSupplierId: string | null;
  suggestedSupplierName: string | null;
  /** Fornecedores distintos entre os componentes incluídos. */
  supplierCount: number;
  suggestedDescription: string;
  warnings: string[];
}

@Injectable()
export class PaintPurchaseService {
  private readonly logger = new Logger(PaintPurchaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
  ) {}

  /** O que o pedido levaria — a mesma conta que `createOrder` grava. */
  async buildPlan(input: PaintPurchasePlanInput): Promise<PaintPurchasePlan> {
    const paint = await this.prisma.paint.findUnique({
      where: { id: input.paintId },
      include: {
        paintType: { select: { name: true } },
        paintBrand: { select: { name: true } },
        formulas: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          include: {
            components: {
              include: {
                item: {
                  include: {
                    measures: true,
                    supplier: { select: { id: true, fantasyName: true, corporateName: true } },
                    prices: { orderBy: { createdAt: 'desc' }, take: 1 },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!paint) throw new NotFoundException('Tinta não encontrada.');

    const formula = paint.formulas[0];
    if (!formula || !formula.components?.length) {
      throw new BadRequestException('Esta tinta não possui fórmula cadastrada.');
    }

    const density = Number(formula.density) || 1.0;
    const volumeMl = input.volumeLiters * 1000;
    const warnings: string[] = [];

    const items: PaintPurchasePlanItem[] = [];
    for (const component of formula.components) {
      const item = component.item;
      if (!item) continue;

      const demand = componentDemand(component.ratio, volumeMl, density, item.measures);
      const availableUnits = item.quantity ?? 0;
      const missingUnits =
        demand.requiredUnits == null ? null : Math.max(0, demand.requiredUnits - availableUnits);

      const wanted =
        input.mode === PAINT_PURCHASE_MODE.MISSING ? (missingUnits ?? 0) : (demand.requiredUnits ?? 0);
      const quantity = demand.measured ? this.wholePackages(wanted) : 0;

      const unitPrice = item.prices?.[0]?.value ?? 0;
      const supplierName = item.supplier?.fantasyName ?? item.supplier?.corporateName ?? null;

      if (!demand.measured) {
        warnings.push(
          `"${item.name}" não tem medida de peso cadastrada e ficou de fora — cadastre a medida ou adicione o item ao pedido manualmente.`,
        );
      } else if (unitPrice <= 0) {
        warnings.push(`"${item.name}" está sem preço cadastrado e entrará por R$ 0,00.`);
      }

      items.push({
        itemId: item.id,
        itemName: item.name,
        uniCode: item.uniCode ?? null,
        ratio: component.ratio,
        requiredGrams: demand.requiredGrams,
        requiredUnits: demand.requiredUnits,
        availableUnits,
        missingUnits,
        quantity,
        packageLabel: packageLabelOf(item.measures),
        unitPrice,
        totalPrice: quantity * unitPrice,
        supplierId: item.supplierId ?? null,
        supplierName,
        measured: demand.measured,
        included: quantity > 0,
      });
    }

    // A ordem é a da conferência: o que entra no pedido primeiro, e dentro dele
    // o que pesa mais na fórmula.
    items.sort((a, b) => Number(b.included) - Number(a.included) || b.ratio - a.ratio);

    const included = items.filter(i => i.included);
    const supplierIds = [...new Set(included.map(i => i.supplierId).filter((s): s is string => !!s))];
    const everyIncludedHasSupplier = included.length > 0 && included.every(i => i.supplierId);
    const unanimousSupplier = everyIncludedHasSupplier && supplierIds.length === 1;

    return {
      paint: {
        id: paint.id,
        name: paint.name,
        hex: paint.hex,
        code: paint.code ?? null,
        finish: paint.finish,
        typeName: paint.paintType?.name ?? null,
        brandName: paint.paintBrand?.name ?? null,
      },
      volumeLiters: input.volumeLiters,
      mode: input.mode,
      items,
      totals: {
        itemCount: included.length,
        totalUnits: included.reduce((sum, i) => sum + i.quantity, 0),
        totalPrice: included.reduce((sum, i) => sum + i.totalPrice, 0),
      },
      suggestedSupplierId: unanimousSupplier ? supplierIds[0] : null,
      suggestedSupplierName: unanimousSupplier
        ? (included.find(i => i.supplierId === supplierIds[0])?.supplierName ?? null)
        : null,
      supplierCount: supplierIds.length,
      suggestedDescription: this.describe(paint.name, input.volumeLiters, input.mode),
      warnings,
    };
  }

  /** Cria o pedido com os componentes que a fórmula pede. */
  async createOrder(input: PaintPurchaseOrderInput, userId: string) {
    const plan = await this.buildPlan(input);
    const included = plan.items.filter(i => i.included);

    if (included.length === 0) {
      throw new BadRequestException(
        input.mode === PAINT_PURCHASE_MODE.MISSING
          ? 'Nada a pedir: o estoque já cobre todos os componentes deste volume.'
          : 'Nenhum componente desta fórmula pode ser pedido — verifique as medidas dos itens.',
      );
    }

    // ICMS/IPI saem do cadastro do item, como no pedido automático.
    const taxes = await this.prisma.item.findMany({
      where: { id: { in: included.map(i => i.itemId) } },
      select: { id: true, icms: true, ipi: true },
    });
    const taxMap = new Map(taxes.map(t => [t.id, t]));

    const data: OrderCreateFormData = {
      description: input.description.trim() || plan.suggestedDescription,
      status: ORDER_STATUS.CREATED,
      supplierId: input.supplierId ?? undefined,
      forecast: input.forecast ?? undefined,
      notes: input.notes?.trim() ? input.notes.trim() : undefined,
      items: included.map(line => ({
        itemId: line.itemId,
        orderedQuantity: line.quantity,
        price: line.unitPrice,
        icms: taxMap.get(line.itemId)?.icms ?? 0,
        ipi: taxMap.get(line.itemId)?.ipi ?? 0,
      })),
    };

    this.logger.log(
      `Pedido de componentes: tinta ${plan.paint.name}, ${input.volumeLiters} L, ${included.length} itens (${input.mode}).`,
    );

    return this.orderService.create(data, undefined, userId);
  }

  /**
   * Embalagem é INTEIRA, sempre: não se compra 1,4 galão, e não há caso em que
   * pedir a fração sirva — por isso não é opção.
   *
   * A folga de 1e-6 existe porque a conta vem de uma divisão em ponto
   * flutuante: sem ela, uma demanda de exatamente 2 unidades vira 3 quando o
   * resultado cai em 2,0000000001.
   */
  private wholePackages(units: number): number {
    if (units <= 0) return 0;
    return Math.max(1, Math.ceil(units - 1e-6));
  }

  private describe(paintName: string, volumeLiters: number, mode: PaintPurchaseMode): string {
    const volume = volumeLiters.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    const suffix = mode === PAINT_PURCHASE_MODE.MISSING ? ' (reposição)' : '';
    return `Componentes · ${paintName} · ${volume} L${suffix}`.slice(0, 500);
  }
}
