/**
 * O Nº DO PEDIDO DE COMPRA NA ASSINATURA (DD12) — a tabela-verdade, de ponta a ponta.
 *
 * O dono enunciou a regra assim: "tente aprovar como compras sem ter numero de
 * pedido, e com outros responsaveis sem ter numero de pedido, deveria bloquear
 * apenas a assinatura do compras, que deve preencher o numero de pedido antes
 * de assinar".
 *
 * A regra PURA já tem teste sem banco (`tests/portal-assinatura-compras.test.ts`).
 * O que ESTE arquivo prova é o que faltava: que ela chega inteira até a ponta —
 * a listagem ANUNCIA a exigência (`orderNumber`), o `POST .../assinar` RECUSA
 * com 400 e a frase da `main` quando falta o número, quem TEM Compras (mesmo
 * acumulando) é cobrado, quem não tem não é, e informar o número NO PRÓPRIO ATO
 * (ou pelo pedido do portal) abre o caminho. DD12: vale a regra da `main`.
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
import { ORDER_NUMBER_REQUIRED_MESSAGE } from '@modules/common/signature/order-number-gate';

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

const corpoDeAssinatura = (
  item: any,
  cargo: string,
  orderNumbers?: Array<{ taskId: string; value: string }>,
) => ({
  cpf: '111.444.777-35',
  cargo,
  declarations: (item.declaracoes ?? []).map((d: any) => d.key),
  clientTimestamp: new Date().toISOString(),
  geo: null,
  ...(orderNumbers ? { orderNumbers } : {}),
});

async function main() {
  const browser = await abreNavegador();

  phase('PORTÃO DO PEDIDO DE COMPRA');

  // ── FAXINA DA CORRIDA ANTERIOR ──────────────────────────────────────────
  const velhos = await prisma.budget.findMany({
    where: { tasks: { some: { implement: { serialNumber: { startsWith: 'PCGATE' } } } } },
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

  // A arte aprovada de cada veículo — a emissão a exige.
  const arquivo = await prisma.file.findFirst({
    where: { mimetype: { startsWith: 'image/' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (arquivo) {
    // A arte é do IMPLEMENTO (R2): aprovada em cada veículo do orçamento.
    for (const implement of await prisma.implement.findMany({
      where: { task: { quoteId: budgetId } },
      select: { id: true },
    })) {
      await prisma.layout.upsert({
        where: { implementId_fileId: { implementId: implement.id, fileId: arquivo.id } },
        create: { implementId: implement.id, fileId: arquivo.id, status: 'APPROVED' },
        update: { status: 'APPROVED' },
      });
    }
  }
  info('montagem: 3 contatos convocados, arte aprovada nos implementos, nenhum pedido de compra');

  // O VALOR APROVADO (E1, Modelo C): a emissão só sai com ele. Em nome do
  // cliente, pela rota interna, com nota — é montagem, não o objeto do teste.
  const internoValor = await tokenInterno(FUNCIONARIOS.comercial);
  await apiInterna(internoValor, `/budgets/${budgetId}`, {
    method: 'PUT',
    body: { services: [{ description: 'Caso do portão', amount: 100 }] },
  });
  const valor = await apiInterna(internoValor, `/budgets/${budgetId}/value-approval`, {
    method: 'PUT',
    body: { note: 'Montagem da bateria do pedido de compra.' },
  });
  check('o valor é aprovado em nome do cliente (montagem)', valor.status === 200, `status=${valor.status}`);

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

  // ⛔ A EMISSÃO MOVE O EIXO DA ASSINATURA, e NÃO o valor (D-28, D-29): o
  // orçamento segue APROVADO (valor aprovado) e a assinatura passa a
  // AGUARDANDO O CLIENTE no mesmo commit do envelope.
  const depoisDaEmissao = await prisma.budget.findUnique({
    where: { id: budgetId },
    select: { status: true, signatureStatus: true },
  });
  check('o valor continua APROVADO', depoisDaEmissao?.status === 'APPROVED', `status=${depoisDaEmissao?.status}`);
  check(
    'e o eixo passa a AWAITING_CUSTOMER junto',
    depoisDaEmissao?.signatureStatus === 'AWAITING_CUSTOMER',
    `signatureStatus=${depoisDaEmissao?.signatureStatus}`,
  );

  // ── QUEM TEM COMPRAS: anunciado e barrado sem número ──────────────────
  const pgCompras = await novaAba(browser);
  const tkCompras = await sessaoDoPortal(pgCompras, CONTATOS.compras.fone, CONTATOS.compras.nome);

  let itemCompras: any = null;
  await scenario('Compras: a listagem ANUNCIA a exigência do número', pgCompras, async () => {
    itemCompras = doOrcamento(await apiPortal(tkCompras, '/cliente/me/assinaturas'), budgetId);
    check('Compras foi convocado e a assinatura está pendente', !!itemCompras);
    if (!itemCompras) return;
    check(
      'orderNumber.required = true (o veículo não tem pedido)',
      itemCompras.orderNumber?.required === true,
      JSON.stringify(itemCompras.orderNumber),
    );
    check(
      'e lista o veículo, com o teto do número',
      (itemCompras.orderNumber?.vehicles ?? []).length === tarefas.length &&
        typeof itemCompras.orderNumber?.maxLength === 'number',
    );
  });

  await scenario('Compras: assinar SEM número é recusado com 400', pgCompras, async () => {
    if (!itemCompras) return check('há signatário de Compras para tentar assinar', false);
    const r = await apiPortal(tkCompras, `/cliente/me/assinaturas/${itemCompras.signerId}/assinar`, {
      method: 'POST',
      body: corpoDeAssinatura(itemCompras, 'Compras'),
    });
    check('a assinatura é RECUSADA com 400 (não 403)', r.status === 400, `status=${r.status}`);
    check(
      'com a frase da main',
      String(r.body?.message ?? '').includes(ORDER_NUMBER_REQUIRED_MESSAGE) ||
        String(r.body?.message ?? '').includes('Informe o nº do pedido de compra'),
      `mensagem="${r.body?.message}"`,
    );
    const assinou = itemCompras.signerId
      ? await prisma.envelopeSigner.count({
          where: { id: itemCompras.signerId, status: 'SIGNED' as any },
        })
      : -1;
    check('e NADA foi assinado no banco', assinou === 0, `${assinou} assinatura(s)`);
  });

  // ── OS DOIS CONTROLES ───────────────────────────────────────────────────
  await scenario('quem ACUMULA Compras com Comercial TAMBÉM é cobrado (DD12)', pgAutor, async () => {
    const meu = doOrcamento(await apiPortal(tkAutor, '/cliente/me/assinaturas'), budgetId);
    check('o acumulador foi convocado', !!meu);
    if (!meu) return;
    check(
      'orderNumber.required = true — a regra é TER Compras, não SÓ Compras',
      meu.orderNumber?.required === true,
      JSON.stringify(meu.orderNumber),
    );
  });

  const pgVendedor = await novaAba(browser);
  await scenario('Vendedor: o MESMO documento sem pedido NÃO o barra', pgVendedor, async () => {
    const tkVendedor = await sessaoDoPortal(
      pgVendedor,
      CONTATOS.vendedor.fone,
      CONTATOS.vendedor.nome,
    );
    const meu = doOrcamento(await apiPortal(tkVendedor, '/cliente/me/assinaturas'), budgetId);
    check('o Vendedor foi convocado para este documento', !!meu);
    if (!meu) return;
    check('orderNumber = null para o Vendedor (não está sujeito)', meu.orderNumber === null);
    const r = await apiPortal(tkVendedor, `/cliente/me/assinaturas/${meu.signerId}/assinar`, {
      method: 'POST',
      body: corpoDeAssinatura(meu, 'Vendedor'),
    });
    check('e a assinatura dele é aceita', r.status === 200 || r.status === 201, `status=${r.status}`);
  });

  // ── O DESTRAVE: o número informado NO ATO ───────────────────────────────
  await scenario('Compras informa o número ao assinar e assina', pgCompras, async () => {
    const meu = doOrcamento(await apiPortal(tkCompras, '/cliente/me/assinaturas'), budgetId);
    if (!meu) {
      check('Compras ainda tem a assinatura pendente', false);
      return;
    }
    const numero = `PC-${Date.now().toString().slice(-7)}`;
    const r = await apiPortal(tkCompras, `/cliente/me/assinaturas/${meu.signerId}/assinar`, {
      method: 'POST',
      body: corpoDeAssinatura(
        meu,
        'Compras',
        tarefas.map(t => ({ taskId: t.id, value: numero })),
      ),
    });
    check('e o Compras ASSINA', r.status === 200 || r.status === 201,
      `status=${r.status} · ${r.body?.message ?? ''}`);
    const gravado = await prisma.task.findFirst({
      where: { id: tarefas[0].id },
      select: { customerOrderNumber: true },
    });
    check('o número informado foi gravado na tarefa', gravado?.customerOrderNumber === numero);
  });

  await browser.close();
  await prisma.$disconnect();
  return report();
}

main().then(n => process.exit(n > 0 ? 1 : 0));
