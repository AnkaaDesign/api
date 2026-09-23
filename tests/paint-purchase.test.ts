/**
 * Guarda do PEDIDO DE COMPONENTES — do volume de tinta para o pedido.
 *
 * Três coisas quebram em silêncio aqui, e é contra elas que o arquivo existe:
 *
 *  1. **A conversão grama → unidade.** A fórmula raciocina em VOLUME e em
 *     porcentagem; o estoque e o pedido raciocinam em UNIDADE (a lata). Entre
 *     as duas moram as medidas do item, e um item cadastrado em quilo vale mil
 *     vezes o mesmo número em grama. Errar aqui não dá erro nenhum: dá um
 *     pedido de 3 latas onde eram 3 mil.
 *
 *  2. **O arredondamento.** Embalagem é SEMPRE inteira — não é opção. Mas a
 *     demanda vem de uma divisão em ponto flutuante, e sem folga uma
 *     necessidade de exatamente 2 unidades vira 3: uma lata a mais em todo
 *     pedido que fechar redondo.
 *
 *  3. **O formato do pedido.** O que este serviço monta passa pelo
 *     `orderCreateSchema` como qualquer outro pedido. Um campo a mais que o zod
 *     não conhece é APAGADO em silêncio (o schema não é strict) e um campo
 *     obrigatório a menos derruba a rota com 400. O teste valida o payload
 *     contra o schema de verdade, não contra uma expectativa escrita à mão.
 *
 * Rodar: npx tsx tests/paint-purchase.test.ts
 */

import { componentDemand, packageLabelOf } from '../src/modules/paint/paint-component-math';
import { PaintPurchaseService } from '../src/modules/paint/paint-purchase.service';
import { orderCreateSchema } from '../src/schemas/order';

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const close = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- a conta ---

console.log('\nconversão da fórmula para o estoque');
{
  // Galão de 3,6 L que pesa 3,6 kg: densidade 1 g/ml.
  const gallon = [
    { measureType: 'VOLUME', unit: 'LITER', value: 3.6 },
    { measureType: 'WEIGHT', unit: 'KILOGRAM', value: 3.6 },
  ];
  // 50% de 20 L = 10 L = 10.000 ml × 1 g/ml = 10.000 g = 2,777 galões.
  const d = componentDemand(50, 20_000, 1, gallon);
  check('10 L de um componente de densidade 1 pesam 10 kg', close(d.requiredGrams, 10_000, 1));
  check('e cabem em 2,78 galões de 3,6 kg', close(d.requiredUnits ?? 0, 10_000 / 3600));
  check('o quilo do cadastro vira grama', d.weightPerUnitGrams === 3600);
  check('rótulo da embalagem', packageLabelOf(gallon) === '3,6 L · 3,6 kg');

  // Item sem medida de VOLUME: a densidade da fórmula é o recurso.
  const weightOnly = [{ measureType: 'WEIGHT', unit: 'GRAM', value: 900 }];
  const f = componentDemand(10, 20_000, 1.4, weightOnly);
  check('sem volume, vale a densidade da fórmula', close(f.requiredGrams, 2000 * 1.4, 1));
  check('e a unidade sai do peso da embalagem', close(f.requiredUnits ?? 0, 2800 / 900));

  // Item sem medida de PESO: não há unidade, logo não há o que pedir.
  const unmeasured = componentDemand(10, 20_000, 1, [
    { measureType: 'VOLUME', unit: 'LITER', value: 5 },
  ]);
  check('sem peso não há unidade', unmeasured.requiredUnits === null && !unmeasured.measured);
}

// ------------------------------------------------------------- o plano ------

/** Fórmula de mentira, com o mesmo formato que o Prisma devolve. */
function fakePaint(components: Array<{ ratio: number; item: any }>) {
  return {
    id: 'p1',
    name: 'Azul de Teste',
    hex: '#0000ff',
    code: 'AZ1',
    finish: 'SOLID',
    paintType: { name: 'Poliéster' },
    paintBrand: { name: 'Farben' },
    formulas: [{ id: 'f1', density: 1, components }],
  };
}

// Ids de verdade: o `orderCreateSchema` exige uuid no item, e é contra ele que
// o payload é validado no fim deste arquivo.
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_S = '33333333-3333-4333-8333-333333333333';

const gallonMeasures = [
  { measureType: 'VOLUME', unit: 'LITER', value: 3.6 },
  { measureType: 'WEIGHT', unit: 'KILOGRAM', value: 3.6 },
];

function fakeItem(over: Partial<any> = {}) {
  return {
    id: over.id ?? ID_A,
    name: over.name ?? 'Componente',
    uniCode: over.uniCode ?? 'UC1',
    quantity: over.quantity ?? 0,
    supplierId: over.supplierId ?? ID_S,
    supplier: over.supplier ?? { id: ID_S, fantasyName: 'Farben', corporateName: null },
    measures: over.measures ?? gallonMeasures,
    prices: over.prices ?? [{ value: 100 }],
    icms: over.icms ?? 0,
    ipi: over.ipi ?? 0,
  };
}

function serviceWith(paint: any, captured: { data?: any } = {}) {
  const prisma = {
    paint: { findUnique: async () => paint },
    item: {
      findMany: async ({ where }: any) =>
        (where.id.in as string[]).map(id => ({ id, icms: 12, ipi: 5 })),
    },
  };
  const orderService = {
    create: async (data: any) => {
      captured.data = data;
      return { success: true, message: 'ok', data: { id: 'o1' } };
    },
  };
  return new PaintPurchaseService(prisma as any, orderService as any);
}

async function main() {
  console.log('\nplano de compra');
  {
    // 20 L: 50% de um componente com 10 galões em estoque, 50% de outro com zero.
    const paint = fakePaint([
      { ratio: 50, item: fakeItem({ id: ID_A, name: 'Clear', quantity: 10 }) },
      { ratio: 50, item: fakeItem({ id: ID_B, name: 'Azul', quantity: 0 }) },
    ]);
    const svc = serviceWith(paint);

    const full = await svc.buildPlan({
      paintId: '44444444-4444-4444-8444-444444444444',
      volumeLiters: 20,
      mode: 'FULL',
    });
    check('fórmula inteira pede os dois componentes', full.totals.itemCount === 2);
    check(
      '2,78 galões viram 3 (embalagem inteira)',
      full.items.every(i => i.quantity === 3),
      full.items.map(i => `${i.itemName}=${i.quantity}`).join(' '),
    );
    check('fornecedor unânime é sugerido', full.suggestedSupplierId === ID_S);
    check('descrição traz tinta e volume', full.suggestedDescription === 'Componentes · Azul de Teste · 20 L');

    const missing = await svc.buildPlan({
      paintId: '44444444-4444-4444-8444-444444444444',
      volumeLiters: 20,
      mode: 'MISSING',
    });
    check('só o que falta deixa o componente com estoque de fora', missing.totals.itemCount === 1);
    check('e pede 3 do que está zerado', missing.items.find(i => i.itemId === ID_B)?.quantity === 3);

  }

  console.log('\narredondamento não inventa embalagem');
  {
    // 3,6 kg por galão × 2 galões = 7.200 g. A 1 g/ml isso é 7,2 L de componente;
    // com o componente valendo 100% da fórmula, 7,2 L de tinta pedem 2 galões
    // REDONDOS — e é aqui que o ponto flutuante empurrava para 3.
    const paint = fakePaint([{ ratio: 100, item: fakeItem({ quantity: 0 }) }]);
    const svc = serviceWith(paint);
    const plan = await svc.buildPlan({
      paintId: '44444444-4444-4444-8444-444444444444',
      volumeLiters: 7.2,
      mode: 'FULL',
    });
    check('2 unidades exatas continuam 2', plan.items[0].quantity === 2, String(plan.items[0].quantity));
  }

  console.log('\nitem sem medida de peso');
  {
    const paint = fakePaint([
      { ratio: 60, item: fakeItem({ id: ID_A, quantity: 0 }) },
      {
        ratio: 40,
        item: fakeItem({
          id: 'b',
          name: 'Sem medida',
          quantity: 0,
          measures: [{ measureType: 'VOLUME', unit: 'LITER', value: 5 }],
        }),
      },
    ]);
    const svc = serviceWith(paint);
    const plan = await svc.buildPlan({
      paintId: '44444444-4444-4444-8444-444444444444',
      volumeLiters: 20,
      mode: 'FULL',
    });
    check('fica de fora do pedido', plan.totals.itemCount === 1);
    check('e é dito em voz alta', plan.warnings.some(w => w.includes('Sem medida')));
  }

  // ------------------------------------------------------- o pedido gravado ---

  console.log('\no pedido que chega ao OrderService');
  {
    const paint = fakePaint([
      { ratio: 50, item: fakeItem({ id: ID_A, name: 'Clear', quantity: 0 }) },
      { ratio: 50, item: fakeItem({ id: ID_B, name: 'Azul', quantity: 0 }) },
    ]);
    const captured: { data?: any } = {};
    const svc = serviceWith(paint, captured);

    await svc.createOrder(
      {
        paintId: '44444444-4444-4444-8444-444444444444',
        volumeLiters: 20,
        mode: 'FULL',
        description: 'Pedido de teste',
        supplierId: null,
        forecast: null,
        notes: '  ',
      },
      'user-1',
    );

    const data = captured.data;
    check('dois itens', data?.items?.length === 2);
    check('quantidade em UNIDADES, não em gramas', data.items.every((i: any) => i.orderedQuantity === 3));
    check('preço do item entra na linha', data.items.every((i: any) => i.price === 100));
    check('ICMS/IPI vêm do cadastro do item', data.items.every((i: any) => i.icms === 12 && i.ipi === 5));
    check('observação em branco não vira string vazia', data.notes === undefined);
    check('status nasce CREATED', data.status === 'CREATED');

    // O portão de verdade: o payload passa pelo schema da rota de pedido?
    const parsed = orderCreateSchema.safeParse(data);
    check(
      'payload aceito pelo orderCreateSchema',
      parsed.success,
      parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3)),
    );
    if (parsed.success) {
      check(
        'e o schema não apagou os itens pelo caminho',
        parsed.data.items?.length === 2 && parsed.data.items[0].orderedQuantity === 3,
      );
    }
  }

  console.log('\nnada a pedir');
  {
    const paint = fakePaint([{ ratio: 100, item: fakeItem({ quantity: 999 }) }]);
    const svc = serviceWith(paint);
    let message = '';
    try {
      await svc.createOrder(
        {
          paintId: '44444444-4444-4444-8444-444444444444',
          volumeLiters: 20,
          mode: 'MISSING',
          description: 'x',
        },
        'user-1',
      );
    } catch (e: any) {
      message = e?.message ?? '';
    }
    check('estoque cobrindo tudo recusa o pedido', message.includes('Nada a pedir'), message);
  }

}

main()
  .then(() => {
    console.log(failures === 0 ? '\nTUDO CERTO\n' : `\n${failures} FALHA(S)\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
