/**
 * A REGRA DE COMO UMA FATURA SE PAGA — sem banco e sem rede.
 *
 * Existiam CINCO derivações de `Invoice.status` / `Invoice.paidAmount` espalhadas
 * (webhook do Sicredi, conciliação por recebível, conciliação por tarefa,
 * agendador de boletos, `InvoiceService`), e TRÊS delas decidiam o estado
 * comparando DINHEIRO com `Invoice.totalAmount`:
 *
 *     Σ pago >= totalAmount ? 'PAID' : Σ pago > 0 ? 'PARTIALLY_PAID' : 'ACTIVE'
 *
 * `Invoice.totalAmount` é um retrato CONGELADO de `config.total` no instante da
 * emissão. Ele não acompanha renegociação, desconto na baixa, parcela removida
 * nem parcela cancelada — e assim que a soma das parcelas deixa de bater com o
 * retrato, a fatura NUNCA MAIS chega a `PAID`.
 *
 * Isso não é hipótese. Em produção (17/09/2026) cinco faturas vivas estavam
 * exatamente assim, com TODAS as suas parcelas `PAID`:
 *
 *   · orçamento 47 — R$ 10.000,00 pagos contra `totalAmount` R$ 12.594,80
 *   · orçamento 70 — R$ 16.187,50 pagos contra `totalAmount` R$ 16.500,00
 *
 * Este arquivo protege a regra que as substituiu: a pergunta é sobre ESTADO DE
 * PARCELA, nunca sobre o cabeçalho.
 *
 * Rodar: npx tsx tests/invoice-payment-state.test.ts
 */
import { deriveInvoicePaymentState } from '../src/modules/financial/invoice/invoice-payment-state';

let ok = 0;
let fail = 0;
function check(nome: string, real: unknown, esperado: unknown) {
  if (real === esperado) {
    ok++;
    console.log(`[  ok  ] ${nome}`);
  } else {
    fail++;
    console.log(`[ FAIL ] ${nome} — esperado ${String(esperado)}, veio ${String(real)}`);
  }
}

const parcela = (status: string, paidAmount: number) => ({ status, paidAmount });

// ── O DEFEITO QUE ORIGINOU TUDO ───────────────────────────────────────────────

{
  // Orçamento 47, como está em produção: cinco parcelas viraram duas na
  // renegociação, as duas foram pagas, e o cabeçalho ficou com o valor antigo.
  const r = deriveInvoicePaymentState([parcela('PAID', 5000), parcela('PAID', 5000)]);
  check('renegociado e quitado → PAID (não PARTIALLY_PAID)', r.status, 'PAID');
  check('  …com Σ das parcelas, não o cabeçalho', r.paidAmount.toNumber(), 10000);
}

{
  // Orçamento 70: desconto de R$ 312,50 no fechamento.
  const r = deriveInvoicePaymentState([parcela('PAID', 16187.5)]);
  check('pago com desconto → PAID', r.status, 'PAID');
  check('  …paidAmount é o que entrou', r.paidAmount.toNumber(), 16187.5);
}

// ── PARCELA CANCELADA NÃO É RECEITA DESTA FATURA ─────────────────────────────

{
  // As cópias por dinheiro somavam a cancelada junto e inflavam o `paidAmount`.
  const r = deriveInvoicePaymentState([
    parcela('PAID', 1000),
    { status: 'CANCELLED', paidAmount: 700 },
  ]);
  check('cancelada não entra na soma', r.paidAmount.toNumber(), 1000);
  check('cancelada não impede a liquidação', r.status, 'PAID');
}

{
  // A guarda do `every` sobre lista vazia: sem ela, uma fatura cujas parcelas
  // foram TODAS canceladas se declararia paga.
  const r = deriveInvoicePaymentState([
    { status: 'CANCELLED', paidAmount: 0 },
    { status: 'CANCELLED', paidAmount: 0 },
  ]);
  check('todas canceladas → ACTIVE, nunca PAID', r.status, 'ACTIVE');
  check('  …e zero recebido', r.paidAmount.toNumber(), 0);
}

// ── ESTADOS INTERMEDIÁRIOS ───────────────────────────────────────────────────

{
  const r = deriveInvoicePaymentState([parcela('PAID', 5000), parcela('PENDING', 0)]);
  check('uma paga de duas → PARTIALLY_PAID', r.status, 'PARTIALLY_PAID');
}

{
  // Subpagamento de boleto: o dinheiro entrou na parcela sem liquidá-la.
  const r = deriveInvoicePaymentState([parcela('ACTIVE', 300)]);
  check('pagamento parcial em parcela aberta → PARTIALLY_PAID', r.status, 'PARTIALLY_PAID');
  check('  …e o valor é contado', r.paidAmount.toNumber(), 300);
}

{
  const r = deriveInvoicePaymentState([parcela('PENDING', 0), parcela('OVERDUE', 0)]);
  check('nada recebido → ACTIVE', r.status, 'ACTIVE');
  check('  …paidAmount zero', r.paidAmount.toNumber(), 0);
}

{
  const r = deriveInvoicePaymentState([]);
  check('fatura sem parcela nenhuma → ACTIVE', r.status, 'ACTIVE');
  check('  …paidAmount zero', r.paidAmount.toNumber(), 0);
}

// ── NULO É ZERO, NÃO NaN ─────────────────────────────────────────────────────

{
  const r = deriveInvoicePaymentState([
    { status: 'PAID', paidAmount: null },
    { status: 'PAID', paidAmount: 10 },
  ]);
  check('paidAmount nulo conta como zero', r.paidAmount.toNumber(), 10);
  check('  …e o estado ainda é o das parcelas', r.status, 'PAID');
}

console.log(
  fail === 0
    ? `\n✅ ${ok} verificação(ões) passaram.\n`
    : `\n❌ ${fail} de ${ok + fail} verificação(ões) falharam.\n`,
);
process.exit(fail === 0 ? 0 : 1);
