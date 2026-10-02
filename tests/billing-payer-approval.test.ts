/**
 * A APROVAÇÃO POR PAGADOR, sem banco e sem rede.
 *
 * Dois pagadores sobre o mesmo recorte (RKO paga a logomarca, Ibiporã paga a
 * pintura) deixaram de ser faturados sempre juntos. `isPayerApproved` é quem
 * responde "este pagador já foi faturado?" — para a aprovação saber quem ainda é
 * alvo e para os gates de NFS-e/boleto saberem o que deixar passar.
 */
import { isPayerApproved } from '../src/modules/production/budget/budget.guards';

let ok = 0;
let fail = 0;
function check(nome: string, real: unknown, esperado: unknown) {
  if (real === esperado) {
    ok++;
    console.log(`[  ok  ] ${nome}`);
  } else {
    fail++;
    console.log(`[ FAIL ] ${nome} — esperado ${esperado}, veio ${real}`);
  }
}

const D = new Date('2026-09-30T12:00:00Z');

// 1. Cobrança nova, ninguém faturado.
{
  const billing = { approvedAt: null, status: 'PENDING', customerConfigs: [{ approvedAt: null }, { approvedAt: null }] };
  check('pendente: RKO não faturada', isPayerApproved({ approvedAt: null }, billing), false);
}

// 2. RKO faturada, Ibiporã não — a cobrança TEM aprovação (trava), mas a Ibiporã segue pendente.
{
  const rko = { approvedAt: D };
  const ibi = { approvedAt: null };
  const billing = { approvedAt: D, status: 'APPROVED', customerConfigs: [rko, ibi] };
  check('parcial: RKO faturada', isPayerApproved(rko, billing), true);
  check('parcial: Ibiporã AINDA pendente', isPayerApproved(ibi, billing), false);
}

// 3. Acervo / conciliação: cobrança aprovada sem nenhum pagador carimbado → todos faturados.
{
  const a = { approvedAt: null };
  const b = { approvedAt: null };
  check(
    'acervo com carimbo: todos faturados',
    isPayerApproved(a, { approvedAt: D, status: 'APPROVED', customerConfigs: [a, b] }),
    true,
  );
  check(
    'liquidada por conciliação SEM carimbo (só estado): todos faturados',
    isPayerApproved(b, { approvedAt: null, status: 'SETTLED', customerConfigs: [a, b] }),
    true,
  );
}

// 4. Sem a lista de pagadores do faturamento, a leitura é ESTRITA (só o carimbo próprio).
{
  check(
    'sem customerConfigs: não aprova por tabela',
    isPayerApproved({ approvedAt: null }, { approvedAt: D, status: 'APPROVED' }),
    false,
  );
  check('sem faturamento: só o próprio carimbo', isPayerApproved({ approvedAt: D }, null), true);
}

// 5. Cobrança revertida: nada carimbado, estado PENDENTE → ninguém faturado.
{
  const billing = { approvedAt: null, status: 'PENDING', customerConfigs: [{ approvedAt: null }] };
  check('revertida: pendente', isPayerApproved({ approvedAt: null }, billing), false);
}

console.log(`\n${ok} ok, ${fail} falha(s)`);
if (fail > 0) process.exit(1);
