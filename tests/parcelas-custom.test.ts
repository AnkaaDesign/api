/**
 * `CUSTOM` GERA PARCELA — texto livre é forma de pagamento, não ausência de dívida.
 *
 * `generateInstallmentsFromCondition('CUSTOM', …)` devolvia `[]`, e o efeito
 * atravessava o sistema inteiro: sem parcela não nasce boleto, nada vence, a
 * cascata não tem o que contar — e a cobrança era carimbada de APROVADA sobre
 * dinheiro que ninguém ia cobrar. O mesmo valia para qualquer `paymentConfig.type`
 * fora de `CASH`/`INSTALLMENTS`.
 *
 * O que continua NÃO gerando é valor não positivo, e isso é decisão: boleto e
 * NFS-e de R$ 0,00 são documentos impagáveis na mão do cliente. Quem tem de
 * recusar é a validação da aprovação — e, até lá, o pulo aparece em
 * `skippedConfigs` em vez de ser mudo.
 *
 * Rodar: npx tsx tests/parcelas-custom.test.ts
 */
import { InvoiceGenerationService } from '../src/modules/financial/invoice/invoice-generation.service';

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

// O gerador de parcelas é aritmética de datas pura: não toca Prisma, Sicredi nem
// a cascata, então o serviço pode ser construído com dependências nulas.
const svc = new InvoiceGenerationService(null as any, null as any, null as any, null as any);
const porCondicao = (cond: string | null, total: number, ancora: Date) =>
  (svc as any).generateInstallmentsFromCondition(cond, ancora, total, ancora) as Array<{
    number: number;
    dueDate: Date;
    amount: number;
  }>;
const porConfig = (config: any, total: number, ancora: Date) =>
  (svc as any).generateInstallmentsFromPaymentConfig(config, ancora, total, ancora) as Array<{
    number: number;
    dueDate: Date;
    amount: number;
  }>;

// Âncora bem no futuro para escapar do piso de "hoje + 3 dias úteis", que existe
// para que o boleto seja pagável na data — aqui ele só atrapalharia a leitura.
const ANCORA = new Date(Date.UTC(2027, 0, 11, 12, 0, 0)); // segunda-feira

// ── CUSTOM ───────────────────────────────────────────────────────────────────

{
  const p = porCondicao('CUSTOM', 12345.67, ANCORA);
  check('CUSTOM gera UMA parcela', p.length, 1);
  check('  …no valor TOTAL', p[0]?.amount, 12345.67);
  check('  …numerada como a primeira', p[0]?.number, 1);
  // 11/01 + 5 dias = 16/01/2027, um SÁBADO — e vencimento rola para o próximo
  // dia útil, senão o boleto não é pagável na data que ele mesmo carimba.
  check(
    '  …com vencimento à vista da casa (5 dias, rolado para dia útil)',
    p[0]?.dueDate.toISOString().slice(0, 10),
    '2027-01-18',
  );
}

{
  // `paymentConfig` fora de CASH/INSTALLMENTS caía no mesmo buraco.
  const p = porConfig({ type: 'CUSTOM' }, 8000, ANCORA);
  check('paymentConfig.type desconhecido gera UMA parcela', p.length, 1);
  check('  …no valor total', p[0]?.amount, 8000);
}

// ── O QUE CONTINUA SEM GERAR, DE PROPÓSITO ───────────────────────────────────

{
  check('valor zero não gera parcela', porCondicao('CUSTOM', 0, ANCORA).length, 0);
  check('valor negativo não gera parcela', porCondicao('CASH_5', -10, ANCORA).length, 0);
  check('valor não finito não gera parcela', porCondicao('CASH_5', NaN, ANCORA).length, 0);
  check('condição em branco não gera parcela', porCondicao(null, 1000, ANCORA).length, 0);
  check(
    'valor zero no paymentConfig não gera parcela',
    porConfig({ type: 'CASH' }, 0, ANCORA).length,
    0,
  );
}

// ── AS CONDIÇÕES CONHECIDAS NÃO MUDARAM ──────────────────────────────────────

{
  const p = porCondicao('CASH_5', 1000, ANCORA);
  check('CASH_5 continua com uma parcela', p.length, 1);
  check('  …no valor total', p[0]?.amount, 1000);

  const tres = porCondicao('INSTALLMENTS_3', 1000, ANCORA);
  check('INSTALLMENTS_3 continua com três', tres.length, 3);
  check(
    '  …e a soma fecha no total (o resto vai na última)',
    Number(tres.reduce((s, i) => s + i.amount, 0).toFixed(2)),
    1000,
  );
}

console.log(
  fail === 0
    ? `\n✅ ${ok} verificação(ões) passaram.\n`
    : `\n❌ ${fail} de ${ok + fail} verificação(ões) falharam.\n`,
);
process.exit(fail === 0 ? 0 : 1);
