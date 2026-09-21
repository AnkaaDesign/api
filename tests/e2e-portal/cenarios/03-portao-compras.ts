/**
 * O PORTÃO DO PEDIDO DE COMPRA — a tabela-verdade, de ponta a ponta.
 *
 * O dono enunciou a regra assim: "tente aprovar como compras sem ter numero de
 * pedido, e com outros responsaveis sem ter numero de pedido, deveria bloquear
 * apenas a assinatura do compras, que deve preencher o numero de pedido antes
 * de assinar".
 *
 * A regra PURA já tem teste sem banco (`tests/portal-assinatura-compras.test.ts`).
 * O que ESTE arquivo prova é o que faltava: que ela chega inteira até a ponta —
 * a listagem ANUNCIA o veredito, o `POST .../assinar` RECUSA com a mesma frase,
 * quem não é Compras-puro NÃO é barrado, e preencher o número ABRE o caminho.
 *
 * ⛔ ELE MONTA O PRÓPRIO CASO, E ISSO NÃO É LUXO.
 * A primeira versão procurava um orçamento que já existisse. Funcionou uma vez
 * e reprovou na segunda: a listagem `/cliente/me/assinaturas` só devolve o que
 * está PENDENTE, e depois de a corrida anterior assinar, ela voltava vazia —
 * o cenário acusava "0 itens" como se fosse defeito do produto. Uma bateria que
 * só passa em base virgem não serve para o que ela existe: ser repetida a cada
 * conserto.
 *
 * ⚠️ O QUE É MONTAGEM, declarado: criar a requisição, vincular os contatos como
 * responsáveis da tarefa e pendurar um layout aprovado. Nada disso é o objeto
 * do teste. Tudo que é objeto — listar, assinar, emitir pedido — passa pela API
 * de verdade, com sessão de verdade.
 */
import { prisma, CONTATOS, FUNCIONARIOS, SENHA_INTERNA, API } from '../helpers/env';
import { abreNavegador, novaAba } from '../helpers/navegador';
import { sessaoDoPortal, apiPortal } from '../helpers/ui';
import { check, phase, scenario, report, info } from '../../e2e-ui/helpers/harness';
import { PURCHASE_ORDER_REQUIRED_MESSAGE } from '@modules/common/signature/purchase-order-gate';

async function tokenInterno(email: string): Promise<string> {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contact: email, password: SENHA_INTERNA }),
  });
  const j: any = await r.json();
  const token = j?.data?.token ?? j?.token ?? j?.data?.accessToken;
  if (!token) throw new Error(`login interno falhou: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return token;
}

async function apiInterna(token: string, caminho: string, init: { method?: string; body?: any } = {}) {
  const r = await fetch(`${API}${caminho}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  let body: any = null;
  try {
    body = await r.json();
  } catch {
    /* corpo não-JSON */
  }
  return { status: r.status, body };
}

/** Acha o item desta coleta na listagem de um contato. */
const doOrcamento = (resposta: any, budgetId: string) =>
  (resposta.body?.data ?? []).find((i: any) => i.envelope?.budgetId === budgetId);

const corpoDeAssinatura = (item: any, cargo: string) => ({
  cpf: '111.444.777-35',
  cargo,
  declarations: (item.declaracoes ?? []).map((d: any) => d.key),
  clientTimestamp: new Date().toISOString(),
  geo: null,
});

async function main() {
  const browser = await abreNavegador();

  phase('PORTÃO DO PEDIDO DE COMPRA');

  // ── FAXINA DA CORRIDA ANTERIOR ──────────────────────────────────────────
  const velhos = await prisma.budget.findMany({
    where: { tasks: { some: { serialNumber: { startsWith: 'PCGATE' } } } },
    select: { id: true },
  });
  for (const v of velhos) {
    await prisma.budget.delete({ where: { id: v.id } }).catch(() => {
      // Um orçamento que já andou no fluxo recusa ser apagado, e está certo.
    });
  }
  if (velhos.length) info(`faxina: ${velhos.length} caso(s) de corrida anterior`);

  // ── MONTAGEM: a requisição nasce pela API do portal ─────────────────────
  const pgAutor = await novaAba(browser);
  const tkAutor = await sessaoDoPortal(
    pgAutor,
    CONTATOS.comercialCompras.fone,
    CONTATOS.comercialCompras.nome,
  );
  // ⛔ O CLIENTE TEM DE SER A PRÓPRIA EMPRESA DOS CONTATOS, e isso é o cenário,
  // não conveniência de teste.
  //
  // `POST /cliente/me/pedidos` é escopado por (a) PAGADOR ∨ (b) DONO — o
  // caminho pessoal "eu sou contato da tarefa" NÃO autoriza ato comercial, e
  // está certo que não autorize. Se este caso nascesse sob a empresa de um
  // terceiro, o contato de Compras seria convocado a assinar (a emissão chama
  // todo `Task.responsibles`), barrado pelo portão, e RECUSADO no único
  // endereço que criaria o pedido — trancado sem saída. Esse beco é real e está
  // registrado à parte; aqui o que se mede é o portão, e para medi-lo é preciso
  // que a saída exista.
  const clientes = await apiPortal(tkAutor, '/cliente/me/clientes?take=100');
  const lista = clientes.body?.data ?? [];
  const minhaEmpresa = (await prisma.responsible.findUnique({
    where: { phone: CONTATOS.comercialCompras.fone },
    select: { companyId: true },
  }))?.companyId;
  const cliente = lista.find((c: any) => c.id === minhaEmpresa) ?? lista[0];
  if (!cliente) {
    check('o contato alcança um cliente para abrir a requisição', false);
    await browser.close();
    await prisma.$disconnect();
    return report();
  }

  const serie = `PCGATE${Date.now().toString().slice(-6)}`;
  const criada = await apiPortal(tkAutor, '/cliente/me/orcamentos', {
    method: 'POST',
    body: {
      customerId: cliente.id,
      briefing: 'Caso do portão do pedido de compra — montado pela bateria.',
      veiculos: [{ serialNumber: serie }],
    },
  });
  const budgetId: string = criada.body?.data?.budgetId ?? '';
  check(
    'a requisição de apoio nasce',
    !!budgetId,
    `status=${criada.status} · ${criada.body?.message ?? JSON.stringify(criada.body).slice(0, 180)}`,
  );
  if (!budgetId) {
    await browser.close();
    await prisma.$disconnect();
    return report();
  }
  info(`orçamento ${criada.body?.data?.budgetNumber} · série ${serie}`);

  // Os DOIS papéis que a regra separa, mais o acumulador que a controla.
  const contatos = await prisma.responsible.findMany({
    where: { phone: { in: [CONTATOS.compras.fone, CONTATOS.vendedor.fone] } },
    select: { id: true, phone: true },
  });
  const tarefas = await prisma.task.findMany({ where: { quoteId: budgetId }, select: { id: true } });
  await prisma.task.update({
    where: { id: tarefas[0].id },
    data: { responsibles: { connect: contatos.map(c => ({ id: c.id })) } },
  });

  // O layout aprovado — a emissão o exige, e aprová-lo é ato do comercial.
  const arquivo = await prisma.file.findFirst({
    where: { mimetype: { startsWith: 'image/' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (arquivo) {
    await prisma.budget.update({
      where: { id: budgetId },
      data: { layoutFiles: { connect: { id: arquivo.id } } },
    });
  }
  info('montagem: 3 contatos convocados, layout aprovado pendurado, nenhum pedido de compra');

  // ── A EMISSÃO, pela API interna, com cerimônia de SESSÃO ────────────────
  const interno = await tokenInterno(FUNCIONARIOS.comercial);
  const emissao = await apiInterna(interno, `/signature-envelopes/quote/${budgetId}`, {
    method: 'POST',
    // `portalSession: true` escolhe `SignatureAuthMethod.RESPONSIBLE_SESSION`:
    // a credencial é a sessão do portal, não um código de uso único.
    body: { portalSession: true },
  });
  check(
    'o comercial emite o documento para assinatura',
    emissao.status === 200 || emissao.status === 201,
    `status=${emissao.status} · ${emissao.body?.message ?? JSON.stringify(emissao.body?.blockers ?? emissao.body).slice(0, 220)}`,
  );

  // ⛔ A EMISSÃO MOVE O ESTADO, no MESMO commit do envelope.
  //
  // Enquanto não movia, o estado derivava em silêncio: havia NOVE orçamentos em
  // `REQUESTED` com coleta `RUNNING` e assinaturas colhidas, e a tela do
  // comercial — que lê o estado — seguia oferecendo "Enviar para pré-aprovação"
  // para um documento que o cliente já tinha assinado. Pior que a feiura: ao
  // concluir a coleta o fluxo chama `budgetApprove()`, e `REQUESTED → APPROVED`
  // não é aresta do grafo. O documento assinado não teria como virar orçamento
  // aprovado.
  const depoisDaEmissao = await prisma.budget.findUnique({
    where: { id: budgetId },
    select: { status: true, statusOrder: true },
  });
  check(
    '⛔ e o orçamento passa a AGUARDANDO ASSINATURA junto',
    depoisDaEmissao?.status === 'PENDING',
    `status=${depoisDaEmissao?.status}`,
  );
  check(
    'com a ordem da TABELA, não um `|| 1` improvisado',
    depoisDaEmissao?.statusOrder === 6,
    `statusOrder=${depoisDaEmissao?.statusOrder}`,
  );

  // ── COMPRAS-PURO: anunciado e barrado ───────────────────────────────────
  const pgCompras = await novaAba(browser);
  const tkCompras = await sessaoDoPortal(pgCompras, CONTATOS.compras.fone, CONTATOS.compras.nome);

  let itemCompras: any = null;
  await scenario('Compras-puro: a listagem ANUNCIA o portão', pgCompras, async () => {
    itemCompras = doOrcamento(await apiPortal(tkCompras, '/cliente/me/assinaturas'), budgetId);
    check('Compras foi convocado e a assinatura está pendente', !!itemCompras);
    if (!itemCompras) return;
    check(
      'pedidoDeCompra.exigido = true (papel ÚNICO Compras)',
      itemCompras.pedidoDeCompra?.exigido === true,
      JSON.stringify(itemCompras.pedidoDeCompra),
    );
    check(
      'pedidoDeCompra.pendente = true (o veículo não tem número)',
      itemCompras.pedidoDeCompra?.pendente === true,
      JSON.stringify(itemCompras.pedidoDeCompra),
    );
    check(
      'a mensagem é a MESMA constante do servidor, byte a byte',
      itemCompras.pedidoDeCompra?.mensagem === PURCHASE_ORDER_REQUIRED_MESSAGE,
      `recebida="${itemCompras.pedidoDeCompra?.mensagem}"`,
    );
  });

  await scenario('Compras-puro: assinar SEM pedido é recusado com 403', pgCompras, async () => {
    if (!itemCompras) return check('há signatário de Compras para tentar assinar', false);
    const r = await apiPortal(tkCompras, `/cliente/me/assinaturas/${itemCompras.signerId}/assinar`, {
      method: 'POST',
      body: corpoDeAssinatura(itemCompras, 'Compras'),
    });
    check('a assinatura do Compras-puro é RECUSADA', r.status === 403, `status=${r.status}`);
    check(
      'a recusa traz a frase exata do portão',
      String(r.body?.message ?? '').includes(PURCHASE_ORDER_REQUIRED_MESSAGE),
      `mensagem="${r.body?.message}"`,
    );
    // ⚠️ Guarda contra `undefined`: `where: { id: undefined }` faz o Prisma
    // DESCARTAR a chave, e a contagem viraria "todos os assinados da base".
    const assinou = itemCompras.signerId
      ? await prisma.envelopeSigner.count({
          where: { id: itemCompras.signerId, status: 'SIGNED' as any },
        })
      : -1;
    check('e NADA foi assinado no banco', assinou === 0, `${assinou} assinatura(s)`);
  });

  // ── OS DOIS CONTROLES ───────────────────────────────────────────────────
  await scenario('quem ACUMULA Compras com Comercial não é barrado', pgAutor, async () => {
    const meu = doOrcamento(await apiPortal(tkAutor, '/cliente/me/assinaturas'), budgetId);
    check('o acumulador foi convocado', !!meu);
    if (!meu) return;
    // É a diferença entre `roles.length === 1 && roles[0] === PURCHASING` e
    // `roles.includes(PURCHASING)` — e é a regra inteira.
    check(
      'pedidoDeCompra.exigido = false, apesar de ele TER Compras',
      meu.pedidoDeCompra?.exigido === false,
      JSON.stringify(meu.pedidoDeCompra),
    );
  });

  const pgVendedor = await novaAba(browser);
  await scenario('Vendedor: o MESMO documento sem pedido NÃO o barra', pgVendedor, async () => {
    // O login vem para DENTRO do cenário: o teto de 5 desafios por hora por
    // contato é real, e um contato no teto derrubava a bateria inteira aqui,
    // apagando os resultados dos cenários que já tinham passado.
    const tkVendedor = await sessaoDoPortal(
      pgVendedor,
      CONTATOS.vendedor.fone,
      CONTATOS.vendedor.nome,
    );
    const meu = doOrcamento(await apiPortal(tkVendedor, '/cliente/me/assinaturas'), budgetId);
    check('o Vendedor foi convocado para este documento', !!meu);
    if (!meu) return;
    check(
      'pedidoDeCompra.exigido = false para o Vendedor',
      meu.pedidoDeCompra?.exigido === false,
      JSON.stringify(meu.pedidoDeCompra),
    );
    const r = await apiPortal(tkVendedor, `/cliente/me/assinaturas/${meu.signerId}/assinar`, {
      method: 'POST',
      body: corpoDeAssinatura(meu, 'Vendedor'),
    });
    check(
      'o Vendedor NÃO recebe a recusa do pedido de compra',
      !String(r.body?.message ?? '').includes(PURCHASE_ORDER_REQUIRED_MESSAGE),
      `status=${r.status} · mensagem="${r.body?.message}"`,
    );
    check('e a assinatura dele é aceita', r.status === 200 || r.status === 201, `status=${r.status}`);
  });

  // ── O DESTRAVE ──────────────────────────────────────────────────────────
  await scenario('Compras emite o pedido e o portão abre', pgCompras, async () => {
    const numero = `PC-${Date.now().toString().slice(-7)}`;
    const r = await apiPortal(tkCompras, '/cliente/me/pedidos', {
      method: 'POST',
      body: { number: numero, taskIds: tarefas.map(t => t.id) },
    });
    check(
      'POST /cliente/me/pedidos aceita o número',
      r.status === 200 || r.status === 201,
      `status=${r.status} · ${r.body?.message ?? ''}`,
    );

    const meu = doOrcamento(await apiPortal(tkCompras, '/cliente/me/assinaturas'), budgetId);
    check('agora pedidoDeCompra.pendente = false', meu?.pedidoDeCompra?.pendente === false,
      JSON.stringify(meu?.pedidoDeCompra));
    if (!meu) return;

    const r2 = await apiPortal(tkCompras, `/cliente/me/assinaturas/${meu.signerId}/assinar`, {
      method: 'POST',
      body: corpoDeAssinatura(meu, 'Compras'),
    });
    check('e o Compras ASSINA', r2.status === 200 || r2.status === 201,
      `status=${r2.status} · ${r2.body?.message ?? ''}`);
  });

  await browser.close();
  await prisma.$disconnect();
  return report();
}

main().then(n => process.exit(n > 0 ? 1 : 0));
