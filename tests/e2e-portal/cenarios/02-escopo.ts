/**
 * O ESCOPO DO CONTATO — o que ele pode APONTAR, e não só o que a lista oferece.
 *
 * A pergunta deste cenário é a que o dono fez com estas palavras: "tentando
 * selecionar um cliente que nao esta conectado ao responsavel".
 *
 * ⛔ E ela tem DUAS metades, que é o ponto:
 *
 *   1. o COMBOBOX oferece só os clientes do alcance — isso sempre funcionou,
 *      porque `GET /cliente/me/clientes` é escopado desde que nasceu;
 *   2. a API aceita o que receber — e isto NÃO funcionava. `resolverCliente` e
 *      `resolverPagador` resolviam o id com `findUnique` cru, sem escopo
 *      nenhum. Quem mandasse o `customerId` de qualquer empresa da base criava
 *      um orçamento em nome dela, e podia elegê-la como PAGADORA — e o pagador
 *      é a âncora do dinheiro (`BudgetPayer.customerId` → `Invoice.customerId`,
 *      NOT NULL, é o nome que a NFS-e cita).
 *
 * LISTA NÃO É GUARDA. Este arquivo existe para que ninguém volte a confiar numa.
 */
import { prisma, CONTATOS, WEB } from '../helpers/env';
import { abreNavegador, novaAba } from '../helpers/navegador';
import { sessaoDoPortal, apiPortal, abreCombo, opcoes, pausa, texto } from '../helpers/ui';
import { check, phase, scenario, report, info } from '../../e2e-ui/helpers/harness';

async function main() {
  const browser = await abreNavegador();
  const page = await novaAba(browser);

  phase('ESCOPO — o cliente que o contato NÃO alcança');

  const token = await sessaoDoPortal(page, CONTATOS.vendedor.fone, CONTATOS.vendedor.nome);

  // ── Quem o servidor diz que este contato alcança ──────────────────────────
  const lista = await apiPortal(token, '/cliente/me/clientes?take=100');
  const alcancaveis: string[] = (lista.body?.data ?? []).map((c: any) => c.id);
  check(
    'GET /cliente/me/clientes responde e devolve um alcance NÃO vazio',
    lista.status === 200 && alcancaveis.length > 0,
    `status=${lista.status} · ${alcancaveis.length} cliente(s)`,
  );

  // ⚠️ Um alcance que fosse a base inteira passaria em todos os testes abaixo
  // sem provar nada. Esta é a asserção que impede o teste de se autoenganar.
  const totalDeClientes = await prisma.customer.count();
  check(
    'o alcance é um RECORTE, não o cadastro inteiro',
    alcancaveis.length < totalDeClientes,
    `${alcancaveis.length} alcançáveis de ${totalDeClientes} clientes`,
  );

  // ── Um cliente DE VERDADE que está fora do alcance ────────────────────────
  const foraDoAlcance = await prisma.customer.findFirst({
    where: { id: { notIn: alcancaveis } },
    select: { id: true, fantasyName: true },
  });
  if (!foraDoAlcance) {
    check('há cliente fora do alcance para testar', false, 'todos os clientes estão no alcance');
    await browser.close();
    return report();
  }
  info(`fora do alcance: ${foraDoAlcance.fantasyName} (${foraDoAlcance.id.slice(0, 8)}…)`);

  const veiculo = {
    serialNumber: `ESCOPO-${Date.now().toString().slice(-8)}`,
  };

  // ── 1. O CLIENTE DO SERVIÇO fora do alcance ──────────────────────────────
  await scenario('requisição nomeando cliente fora do alcance', page, async () => {
    const r = await apiPortal(token, '/cliente/me/orcamentos', {
      method: 'POST',
      body: {
        customerId: foraDoAlcance.id,
        briefing: 'Tentativa de apontar cliente fora do alcance.',
        veiculos: [veiculo],
      },
    });
    check(
      'POST /cliente/me/orcamentos RECUSA cliente fora do alcance',
      r.status === 404,
      `status=${r.status} · ${r.body?.message ?? '(sem mensagem)'}`,
    );
    // ⚠️ 404 e NÃO 403, pela doutrina do contrato: a existência de um cadastro
    // que este contato não alcança não é informação dele.
    check(
      'a recusa é 404 (não revela que o cadastro existe)',
      r.status === 404 && !/permiss|autoriz|403/i.test(String(r.body?.message ?? '')),
      `mensagem="${r.body?.message ?? ''}"`,
    );
  });

  // ── 2. O PAGADOR fora do alcance — a âncora do dinheiro ──────────────────
  await scenario('requisição elegendo pagador fora do alcance', page, async () => {
    const meu = alcancaveis[0];
    const r = await apiPortal(token, '/cliente/me/orcamentos', {
      method: 'POST',
      body: {
        customerId: meu,
        faturarParaCustomerId: foraDoAlcance.id,
        briefing: 'Tentativa de eleger pagador fora do alcance.',
        veiculos: [{ serialNumber: `${veiculo.serialNumber}-P` }],
      },
    });
    check(
      'POST recusa PAGADOR fora do alcance',
      r.status === 404,
      `status=${r.status} · ${r.body?.message ?? '(sem mensagem)'}`,
    );
    // Prova material: nenhum orçamento nasceu com aquele pagador nesta corrida.
    const vazou = await prisma.budgetPayer.count({
      where: { customerId: foraDoAlcance.id, createdAt: { gte: new Date(Date.now() - 120_000) } },
    });
    check('nenhum BudgetPayer nasceu para o cliente fora do alcance', vazou === 0, `${vazou} linha(s)`);
  });

  // ── 3. A TELA oferece só o alcance ───────────────────────────────────────
  await scenario('o combobox da tela não oferece o cliente fora do alcance', page, async () => {
    await page.goto(`${WEB}/cliente/painel/solicitar`, { waitUntil: 'networkidle' });
    await pausa(page, 2500);
    await abreCombo(page, /Selecione ou cadastre o cliente/i);
    const primeiras = await opcoes(page);
    check(
      'o combobox abre com opções',
      primeiras.length > 0,
      `${primeiras.length} opção(ões)`,
    );
    await page.keyboard.type(foraDoAlcance.fantasyName.slice(0, 12), { delay: 40 });
    await pausa(page, 1600);
    const achadas = await opcoes(page);
    const ofereceu = achadas.some(o => o.includes(foraDoAlcance.fantasyName.slice(0, 12)));
    check(
      'buscar pelo nome do cliente fora do alcance NÃO o oferece',
      !ofereceu,
      ofereceu ? `ofereceu: ${achadas.join(' | ')}` : `nenhuma das ${achadas.length} opções o cita`,
    );
  });

  await browser.close();
  await prisma.$disconnect();
  return report();
}

main().then(n => process.exit(n > 0 ? 1 : 0));
