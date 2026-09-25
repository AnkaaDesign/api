/**
 * QUANDO DOIS ORÇAMENTOS PODEM VIRAR UM.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * A união apaga orçamentos. Uma regra frouxa não devolve um erro: ela apaga o
 * orçamento errado, e o que se perde é o número que o cliente tem no e-mail, a
 * lista de serviços que ele aprovou, ou a fatura que já saiu sobre ele.
 *
 * As regras são puras exatamente para caberem aqui — sem banco, sem Prisma, sem
 * data de hoje. A prévia (que a tela consulta antes de desenhar o botão) e a
 * execução (que escreve) chamam a MESMA função, então um teste que passa aqui
 * vale para as duas: não existe um caminho em que a tela promete e o servidor
 * recusa.
 *
 * `npm run test:quote-merge`
 */

import { judgeMerge, type MergeCandidate } from '../src/utils/budget-merge-rules';
import { quoteValidityEnd } from '../src/utils/budget-validity';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const base = (over: Partial<MergeCandidate> = {}): MergeCandidate => ({
  id: over.id ?? `q-${over.budgetNumber ?? 1}`,
  budgetNumber: 1,
  status: 'PENDING',
  billingSplit: 'JOINT',
  expiresAt: new Date('2026-10-16T12:00:00Z'),
  guaranteeYears: 5,
  customGuaranteeText: null,
  customForecastDays: null,
  layoutFileIds: ['f1'],
  services: [
    { description: 'Logomarca Laterais', amount: 4545 },
    { description: 'Logomarca Traseira', amount: 1285 },
  ],
  customerConfigs: [
    {
      customerId: 'c1',
      discountType: 'PERCENTAGE',
      discountValue: 12,
      paymentCondition: 'INSTALLMENTS_4',
      customPaymentText: null,
      paymentConfig: { type: 'INSTALLMENTS', installmentCount: 4, method: 'PIX' },
      billingFrozen: false,
      hasLiveMoney: false,
    },
  ],
  taskIds: ['t1'],
  signatureProtected: false,
  ...over,
});

const codes = (c: MergeCandidate[]) => judgeMerge(c).blockers.map(b => b.code);

console.log('\nO caso normal — quatro irmãos idênticos');
{
  const cs = [4, 2, 3, 1].map(n => base({ budgetNumber: n, id: `q${n}`, taskIds: [`t${n}`] }));
  const v = judgeMerge(cs);
  check('não bloqueia', v.blockers.length === 0, JSON.stringify(v.blockers));
  check('sobrevive o MENOR número', v.survivor?.budgetNumber === 1, String(v.survivor?.budgetNumber));
  check('absorve os outros três em ordem', JSON.stringify(v.absorbed.map(a => a.budgetNumber)) === '[2,3,4]');
  check('o resultado cobre 4 veículos', v.vehicleCount === 4, String(v.vehicleCount));
  check(
    'avisa que três números somem',
    v.warnings.some(w => w.code === 'NUMBERS_BURNED'),
  );
}

console.log('\nUm orçamento só não é uma união');
{
  const v = judgeMerge([base({ budgetNumber: 7 })]);
  check('bloqueia', v.blockers.map(b => b.code).join() === 'SINGLE_QUOTE');
  check('a frase nomeia o número', v.blockers[0].message.includes('nº 7'));
  check('lista vazia também bloqueia', judgeMerge([]).blockers[0].code === 'SINGLE_QUOTE');
}

console.log('\nO que BLOQUEIA — a união destruiria algo');
{
  const a = base({ budgetNumber: 1, id: 'a' });
  check(
    'lista de serviços diferente',
    codes([a, base({ budgetNumber: 2, id: 'b', services: [{ description: 'Pintura Teto', amount: 650 }] })]).includes(
      'SERVICES',
    ),
  );
  check(
    'MESMO serviço com PREÇO diferente',
    codes([
      a,
      base({
        budgetNumber: 2,
        id: 'b',
        services: [
          { description: 'Logomarca Laterais', amount: 4545 },
          { description: 'Logomarca Traseira', amount: 9999 },
        ],
      }),
    ]).includes('SERVICES'),
  );
  check(
    'cliente diferente diz CUSTOMERS, não TERMS',
    codes([
      a,
      base({
        budgetNumber: 2,
        id: 'b',
        customerConfigs: [{ ...a.customerConfigs[0], customerId: 'c2' }],
      }),
    ]).includes('CUSTOMERS'),
  );
  check(
    'mesmo cliente com desconto diferente diz TERMS',
    codes([
      a,
      base({
        budgetNumber: 2,
        id: 'b',
        customerConfigs: [{ ...a.customerConfigs[0], discountValue: 5 }],
      }),
    ]).includes('TERMS'),
  );
  check(
    'condição de pagamento diferente diz TERMS',
    codes([
      a,
      base({
        budgetNumber: 2,
        id: 'b',
        customerConfigs: [{ ...a.customerConfigs[0], paymentCondition: 'CASH' }],
      }),
    ]).includes('TERMS'),
  );
  check(
    'faturamento aprovado',
    codes([
      a,
      base({
        budgetNumber: 2,
        id: 'b',
        customerConfigs: [{ ...a.customerConfigs[0], billingFrozen: true }],
      }),
    ]).includes('BILLING_FROZEN'),
  );
  check(
    'dinheiro vivo sem cobrança congelada',
    codes([
      a,
      base({
        budgetNumber: 2,
        id: 'b',
        customerConfigs: [{ ...a.customerConfigs[0], hasLiveMoney: true }],
      }),
    ]).includes('LIVE_MONEY'),
  );
  check(
    'assinatura coletada no ABSORVIDO',
    codes([a, base({ budgetNumber: 2, id: 'b', signatureProtected: true })]).includes('SIGNATURE'),
  );
  check(
    'assinatura no SOBREVIVENTE não bloqueia',
    !codes([base({ budgetNumber: 1, id: 'a', signatureProtected: true }), base({ budgetNumber: 2, id: 'b' })]).includes(
      'SIGNATURE',
    ),
  );
  check('orçamento cancelado', codes([a, base({ budgetNumber: 2, id: 'b', status: 'CANCELLED' })]).includes('CANCELLED'));
  check(
    'faturamento em lotes livres',
    codes([a, base({ budgetNumber: 2, id: 'b', billingSplit: 'CUSTOM' })]).includes('CUSTOM_SPLIT'),
  );
}

console.log('\nO que NÃO bloqueia — a união apenas decide');
{
  const a = base({ budgetNumber: 1, id: 'a' });
  check(
    'ORDEM dos serviços é cosmética',
    codes([
      a,
      base({
        budgetNumber: 2,
        id: 'b',
        services: [
          { description: 'Logomarca Traseira', amount: 1285 },
          { description: 'Logomarca Laterais', amount: 4545 },
        ],
      }),
    ]).length === 0,
  );
  check(
    'acento, caixa e espaço dobrado na descrição',
    codes([
      a,
      base({
        budgetNumber: 2,
        id: 'b',
        services: [
          { description: 'LOGOMARCA  LATERAIS', amount: 4545 },
          { description: 'logomarca traseira', amount: 1285 },
        ],
      }),
    ]).length === 0,
  );
  {
    // ⚠️ A REGRA QUE MAIS TENTA BLOQUEAR, e que NÃO PODE: o pedido de compra é
    // do VEÍCULO desde `20260909170000`, e uma frota comprada em pedidos
    // diferentes é o caso NORMAL. Bloquear por ele recusaria quase todo grupo.
    // (O número não é sequer campo do candidato — esta verificação existe para
    // que ninguém o acrescente sem ler isto.)
    check('nº do pedido de compra não é campo da regra', !('orderNumber' in base()));
  }
  {
    const v = judgeMerge([
      base({ budgetNumber: 1, id: 'a', expiresAt: new Date('2026-10-16T12:00:00Z') }),
      base({ budgetNumber: 2, id: 'b', expiresAt: new Date('2026-12-01T12:00:00Z') }),
    ]);
    check('validade diferente não bloqueia', v.blockers.length === 0);
    // A validade RECOMEÇA no dia da união (quem avisa é o serviço, porque
    // depende de hoje). Herdar a mais distante deu ao nº 421 uma validade
    // vencida havia três meses.
    check('a regra não escolhe validade', !v.warnings.some(w => w.code === 'EXPIRES_AT'));
  }
  {
    const v = judgeMerge([
      base({ budgetNumber: 1, id: 'a', status: 'PENDING' }),
      base({ budgetNumber: 2, id: 'b', status: 'SIGNED' }),
    ]);
    check('status misto só AVISA', v.blockers.length === 0);
    check('e avisa que volta para pendente', v.warnings.some(w => w.code === 'STATUS_RESET'));
  }
  {
    const v = judgeMerge([
      base({ budgetNumber: 1, id: 'a', layoutFileIds: ['f1'] }),
      base({ budgetNumber: 2, id: 'b', layoutFileIds: ['f9'] }),
    ]);
    check('layout diferente só AVISA', v.blockers.length === 0);
    check('e diz de quem é o que prevalece', v.warnings.some(w => w.code === 'LAYOUT' && w.message.includes('nº 1')));
  }
  {
    const v = judgeMerge([
      base({ budgetNumber: 1, id: 'a', guaranteeYears: 5 }),
      base({ budgetNumber: 2, id: 'b', guaranteeYears: 10 }),
    ]);
    check('garantia diferente só AVISA', v.blockers.length === 0);
    check('e diz de quem prevalece', v.warnings.some(w => w.code === 'TERMS_FALLBACK'));
  }
}

console.log('\nO grupo real de trinta (nº 448–480 em produção)');
{
  const cs = Array.from({ length: 30 }, (_, i) =>
    base({ budgetNumber: 448 + i, id: `q${448 + i}`, taskIds: [`t${448 + i}`] }),
  );
  const v = judgeMerge(cs);
  check('não bloqueia', v.blockers.length === 0, JSON.stringify(v.blockers.map(b => b.code)));
  check('sobrevive o 448', v.survivor?.budgetNumber === 448);
  check('absorve 29', v.absorbed.length === 29);
  check('cobre 30 veículos', v.vehicleCount === 30);
}

console.log('\nUm orçamento JÁ simplificado absorve mais um (nº 421 + 430 + 475, Marquespan)');
{
  // PER_TASK: uma linha de pagador por veículo, todas iguais.
  const payer = base().customerConfigs[0];
  const unido = base({
    budgetNumber: 421,
    billingSplit: 'PER_TASK',
    taskIds: Array.from({ length: 28 }, (_, i) => `t${i}`),
    customerConfigs: Array.from({ length: 28 }, () => ({ ...payer })),
  });
  const v = judgeMerge([unido, base({ budgetNumber: 430 }), base({ budgetNumber: 475 })]);
  check('termos iguais repetidos por veículo não bloqueiam', v.blockers.length === 0, JSON.stringify(v.blockers));
  check('o resultado cobre 30 veículos', v.vehicleCount === 30, String(v.vehicleCount));

  const outro = base({
    budgetNumber: 430,
    customerConfigs: [{ ...payer, discountValue: 10 }],
  });
  check('desconto diferente ainda bloqueia', codes([unido, outro]).includes('TERMS'));
}

console.log('\nA validade recomeça hoje, no fim do dia de São Paulo');
{
  // 22:30 de 25/09 em SP já é 26/09 em UTC — o dia que conta é o de SP.
  const agora = new Date('2026-09-26T01:30:00Z');
  const fim = quoteValidityEnd(30, agora);
  check('30 dias a partir de 25/09 (SP) = fim de 25/10 (SP)', fim.toISOString() === '2026-10-26T02:59:59.999Z', fim.toISOString());
  const manha = quoteValidityEnd(15, new Date('2026-09-25T12:00:00Z'));
  check('15 dias a partir de 25/09 = fim de 10/10', manha.toISOString() === '2026-10-11T02:59:59.999Z', manha.toISOString());
}

console.log(`\n${failures === 0 ? '✓ TODAS as verificações passaram' : `✗ ${failures} falha(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
