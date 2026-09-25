/**
 * "DE QUEM É A VEZ" — e as duas telas que não podem se contradizer.
 *
 * O DEFEITO QUE ORIGINOU ESTE ARQUIVO, com o print do dono na mão: a lista de
 * orçamentos mostrava 18 linhas "Aguardando Assinatura · Com você", e a tela de
 * Assinaturas dizia "Nada para assinar". As duas do mesmo produto, uma ao lado
 * da outra no menu, dizendo coisas opostas — e a que mentia era a mais visível.
 *
 * A causa era uma dedução que parecia segura: a coluna "Esperando" derivava só
 * do ESTADO (`PENDING` ⇒ "Com você"). Ela errava de duas maneiras somadas:
 *
 *   1. "aguardando a assinatura dos responsáveis" não quer dizer ESTE
 *      responsável — quem já assinou continuava lendo "Com você";
 *   2. um orçamento pode estar em `PENDING` sem coleta nenhuma emitida. No
 *      acervo do dono eram 18 de 18.
 *
 * ⛔ A ASSERÇÃO QUE IMPORTA É A ÚLTIMA: o conjunto de orçamentos que a lista diz
 * estarem esperando por mim tem de ser EXATAMENTE o conjunto que a tela de
 * Assinaturas oferece. Não "parecido": o mesmo. Enquanto as duas respostas
 * vierem de perguntas diferentes, elas vão divergir de novo.
 */
import { prisma, CONTATOS } from '../helpers/env';
import { abreNavegador, novaAba } from '../helpers/navegador';
import { sessaoDoPortal, apiPortal } from '../helpers/ui';
import { check, phase, scenario, report, info } from '../../e2e-ui/helpers/harness';

/**
 * Monta UMA pendência real: requisição nova, o contato convocado, coleta
 * emitida. É montagem declarada — o objeto do teste é a CONCORDÂNCIA entre as
 * duas telas, não o caminho de emissão (esse é o cenário 03).
 */
async function montarPendencia(
  token: string,
): Promise<{ budgetId: string; budgetNumber: number } | null> {
  const { FUNCIONARIOS, SENHA_INTERNA, API } = await import('../helpers/env');

  // Faxina da corrida anterior — este cenário CRIA orçamento.
  const velhos = await prisma.budget.findMany({
    where: { tasks: { some: { implement: { serialNumber: { startsWith: 'ESPERA' } } } } },
    select: { id: true },
  });
  for (const v of velhos) {
    await prisma.budget.delete({ where: { id: v.id } }).catch(() => {
      // Orçamento que já andou no fluxo recusa ser apagado, e está certo.
    });
  }

  const clientes = await apiPortal(token, '/cliente/me/clientes?take=100');
  const minhaEmpresa = (
    await prisma.responsible.findUnique({
      where: { phone: CONTATOS.vendedor.fone },
      select: { companyId: true },
    })
  )?.companyId;
  const lista = clientes.body?.data ?? [];
  const cliente = lista.find((c: any) => c.id === minhaEmpresa) ?? lista[0];
  if (!cliente) return null;

  const criada = await apiPortal(token, '/cliente/me/orcamentos', {
    method: 'POST',
    body: {
      customerId: cliente.id,
      briefing: 'Caso de apoio: uma assinatura pendente de verdade.',
      veiculos: [{ serialNumber: `ESPERA${Date.now().toString().slice(-6)}` }],
    },
  });
  const budgetId: string = criada.body?.data?.budgetId ?? '';
  const budgetNumber: number = criada.body?.data?.budgetNumber ?? 0;
  if (!budgetId) return null;

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

  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contact: FUNCIONARIOS.comercial, password: SENHA_INTERNA }),
  });
  const lj: any = await login.json();
  const interno = lj?.data?.token ?? lj?.token;
  if (!interno) return null;

  await fetch(`${API}/signature-envelopes/quote/${budgetId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${interno}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ portalSession: true }),
  });

  return { budgetId, budgetNumber };
}

async function main() {
  const browser = await abreNavegador();
  const page = await novaAba(browser);

  phase('A VERDADE SOBRE A ESPERA — a lista e as assinaturas concordam');

  const token = await sessaoDoPortal(page, CONTATOS.vendedor.fone, CONTATOS.vendedor.nome);

  // ── UM CASO DE VERDADE, para a igualdade não passar vazia contra vazia ────
  //
  // ⛔ A asserção central deste arquivo é "os dois conjuntos são o MESMO". Com
  // nenhuma assinatura pendente, ela compara ∅ com ∅ e PASSA — inclusive com o
  // código quebrado. Um teste que só pode passar não testa nada. Então o
  // cenário monta uma pendência real e exige que ela apareça nos DOIS lados.
  const pendenciaReal = await montarPendencia(token);
  check(
    'há uma assinatura pendente de verdade (senão a igualdade seria vazia)',
    !!pendenciaReal,
    pendenciaReal ? `orçamento ${pendenciaReal.budgetNumber}` : 'não consegui montar o caso',
  );

  // Todas as páginas da lista: a contradição do dono aparecia na primeira, mas
  // um teste que só olha a primeira página prova menos do que parece.
  const orcamentos: any[] = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const r = await apiPortal(token, `/cliente/me/orcamentos?page=${pagina}&take=100`);
    const lote = r.body?.data ?? [];
    orcamentos.push(...lote);
    if (lote.length < 100) break;
  }
  check('a lista responde', orcamentos.length > 0, `${orcamentos.length} orçamento(s)`);
  info(`${orcamentos.length} orçamentos no escopo`);

  await scenario('todo orçamento traz o FATO da assinatura, não a dedução', page, async () => {
    const semFato = orcamentos.filter(b => !b.signature || typeof b.signature.emitted !== 'boolean');
    check(
      'todos trazem `signature: { emitted, awaitingMe }`',
      semFato.length === 0,
      `${semFato.length} sem o campo (ex.: ${semFato.slice(0, 3).map(b => b.budgetNumber).join(', ')})`,
    );
  });

  await scenario('⛔ os dois conjuntos são o MESMO', page, async () => {
    const assinaturas = await apiPortal(token, '/cliente/me/assinaturas');
    const itens: any[] = assinaturas.body?.data ?? [];

    // O que a tela de ASSINATURAS oferece.
    const ofereceParaAssinar = new Set(
      itens.map(i => i.envelope?.budgetId).filter(Boolean) as string[],
    );
    // O que a LISTA afirma estar esperando por mim.
    const listaDizQueEspera = new Set(
      orcamentos.filter(b => b.signature?.awaitingMe).map(b => b.id),
    );

    const soNaLista = [...listaDizQueEspera].filter(id => !ofereceParaAssinar.has(id));
    const soNasAssinaturas = [...ofereceParaAssinar].filter(id => !listaDizQueEspera.has(id));

    info(`lista: ${listaDizQueEspera.size} · assinaturas: ${ofereceParaAssinar.size}`);
    check(
      '⛔ a comparação NÃO é vazia contra vazia',
      ofereceParaAssinar.size > 0 && listaDizQueEspera.size > 0,
      `lista=${listaDizQueEspera.size} assinaturas=${ofereceParaAssinar.size}`,
    );
    if (pendenciaReal) {
      check(
        'e o caso montado aparece nos DOIS lados',
        ofereceParaAssinar.has(pendenciaReal.budgetId) &&
          listaDizQueEspera.has(pendenciaReal.budgetId),
        `assinaturas=${ofereceParaAssinar.has(pendenciaReal.budgetId)} lista=${listaDizQueEspera.has(pendenciaReal.budgetId)}`,
      );
    }
    check(
      'a lista não promete assinatura que a tela de Assinaturas não oferece',
      soNaLista.length === 0,
      soNaLista.length
        ? `${soNaLista.length} prometido(s) e não oferecido(s): ` +
          orcamentos.filter(b => soNaLista.includes(b.id)).map(b => b.budgetNumber).join(', ')
        : '',
    );
    check(
      'e não esconde assinatura que a tela de Assinaturas oferece',
      soNasAssinaturas.length === 0,
      `${soNasAssinaturas.length} oferecido(s) e não prometido(s)`,
    );
  });

  await scenario('PENDING sem coleta emitida NÃO diz "Com você"', page, async () => {
    const pendentes = orcamentos.filter(b => b.status === 'PENDING');
    check('há orçamentos em PENDING para conferir', pendentes.length > 0, `${pendentes.length}`);
    if (!pendentes.length) return;

    // A prova material vem do BANCO, não do mesmo payload que está sendo testado:
    // um campo errado nos dois lugares passaria por si mesmo.
    const semEnvelopeNoBanco = await prisma.budget.findMany({
      where: {
        id: { in: pendentes.map(b => b.id) },
        signatureEnvelopes: { none: { status: { in: ['RUNNING', 'COMPLETED'] as any } } },
      },
      select: { id: true, budgetNumber: true },
    });
    info(`${semEnvelopeNoBanco.length} de ${pendentes.length} em PENDING sem coleta emitida`);

    const mentindo = semEnvelopeNoBanco.filter(
      b => pendentes.find(p => p.id === b.id)?.signature?.emitted !== false,
    );
    check(
      'o payload concorda com o banco sobre "foi emitido?"',
      mentindo.length === 0,
      mentindo.map(b => b.budgetNumber).join(', '),
    );
    const prometendo = semEnvelopeNoBanco.filter(
      b => pendentes.find(p => p.id === b.id)?.signature?.awaitingMe === true,
    );
    check(
      '⛔ e NENHUM deles é anunciado como esperando por mim',
      prometendo.length === 0,
      prometendo.map(b => b.budgetNumber).join(', '),
    );
  });

  await scenario('a TELA mostra a mesma coisa que o payload', page, async () => {
    const { WEB } = await import('../helpers/env');
    const { texto } = await import('../helpers/ui');
    await page.goto(`${WEB}/cliente/painel/orcamentos`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3500);

    const celulas = await page.evaluate(() =>
      [...document.querySelectorAll('tbody tr')].map(tr => {
        const c = [...tr.querySelectorAll('td')].map(x => (x.textContent || '').trim());
        return { numero: c[0], estado: c[2], esperando: c[3] };
      }),
    );
    check('a tabela desenhou linhas', celulas.length > 0, `${celulas.length} linha(s)`);

    const mentiras = celulas.filter(l => {
      if (!/Aguardando Assinatura/i.test(l.estado ?? '')) return false;
      const b = orcamentos.find(o => String(o.budgetNumber) === l.numero);
      return b && !b.signature?.awaitingMe && /Com você/i.test(l.esperando ?? '');
    });
    check(
      '⛔ nenhuma linha diz "Com você" sem haver assinatura minha pendente',
      mentiras.length === 0,
      mentiras.map(l => l.numero).join(', '),
    );
  });

  await browser.close();
  await prisma.$disconnect();
  return report();
}

main().then(n => process.exit(n > 0 ? 1 : 0));
