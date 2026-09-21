/**
 * A REQUISIÇÃO COMPLETA — e as MEDIDAS, que é onde o dado se perde.
 *
 * O dono reparou que a primeira corrida não preencheu medida nenhuma, e é
 * justamente ali que mora a conversão mais fácil de errar do fluxo inteiro:
 *
 *   ⚠️ O FORMULÁRIO FALA EM CENTÍMETROS, O BANCO GUARDA METROS.
 *   `medidaParaPrisma()` divide por 100 numa borda só. Um esquecimento aqui não
 *   dá erro: dá um implemento de 240 METROS de altura, que atravessa o
 *   orçamento, o layout e a nota sem ninguém tropeçar — até alguém olhar o
 *   desenho.
 *
 * O cenário manda as três faces com valores DIFERENTES e PRÓXIMOS entre si
 * (240 e 245 de altura, larguras de 620/615/248) de propósito: valores redondos
 * e iguais deixariam passar uma troca de lado por outro, que é o segundo erro
 * mais provável depois da escala. Uma das faces leva PORTA, que é o único
 * campo com regra própria ("a porta não pode ser mais alta que o implemento").
 */
import { prisma, CONTATOS } from '../helpers/env';
import { abreNavegador, novaAba } from '../helpers/navegador';
import { sessaoDoPortal, apiPortal } from '../helpers/ui';
import { check, phase, scenario, report, info } from '../../e2e-ui/helpers/harness';

const CM = {
  esquerda: { height: 240, sections: [{ width: 620 }, { width: 180, isDoor: true, doorHeight: 210 }] },
  direita: { height: 240, sections: [{ width: 615 }, { width: 185 }] },
  traseira: { height: 245, sections: [{ width: 248 }] },
};

/** O que o banco DEVE ter, em metros. Escrito à mão de propósito: derivar a
 *  expectativa da mesma divisão que se quer testar não prova nada. */
const METROS = {
  esquerda: { height: 2.4, widths: [6.2, 1.8], doorHeight: 2.1 },
  direita: { height: 2.4, widths: [6.15, 1.85], doorHeight: null },
  traseira: { height: 2.45, widths: [2.48], doorHeight: null },
};

const perto = (a: number | null | undefined, b: number | null, eps = 0.0001) =>
  a === null || a === undefined ? b === null : b !== null && Math.abs(a - b) < eps;

async function main() {
  const browser = await abreNavegador();
  const page = await novaAba(browser);

  phase('REQUISIÇÃO COM MEDIDAS — centímetros na tela, metros no banco');

  const token = await sessaoDoPortal(
    page,
    CONTATOS.comercialCompras.fone,
    CONTATOS.comercialCompras.nome,
  );

  const clientes = await apiPortal(token, '/cliente/me/clientes?take=5');
  const cliente = (clientes.body?.data ?? [])[0];
  if (!cliente) {
    check('o contato alcança ao menos um cliente', false);
    await browser.close();
    await prisma.$disconnect();
    return report();
  }

  // ── A FAXINA DA CORRIDA ANTERIOR ─────────────────────────────────────────
  //
  // Esta bateria CRIA orçamento de verdade, e roda-se de novo a cada conserto.
  // Sem isto o acervo local ganharia um orçamento órfão por execução — e o
  // primeiro efeito colateral apareceria na própria bateria: a lista do portal
  // é ordenada por estado e recência, e dez requisições de teste empurrariam
  // para baixo justamente o que outro cenário procura no topo.
  //
  // Apaga só o que ESTE arquivo cria (série `MED…`), e só isso.
  const antigos = await prisma.budget.findMany({
    where: { tasks: { some: { serialNumber: { startsWith: 'MED' } } } },
    select: { id: true, budgetNumber: true },
  });
  for (const velho of antigos) {
    await prisma.budget.delete({ where: { id: velho.id } }).catch(() => {
      // Um orçamento que já andou no fluxo (tem fatura, nota ou coleta) recusa
      // ser apagado, e está CERTO que recuse. Deixa passar: o cenário cria o
      // seu com série nova e não depende de o acervo estar vazio.
    });
  }
  if (antigos.length) info(`faxina: ${antigos.length} orçamento(s) de corrida anterior`);

  const carimbo = Date.now().toString().slice(-7);
  const series = [`MED${carimbo}A`, `MED${carimbo}B`];
  let budgetId = '';

  await scenario('abrir requisição de 2 veículos com as três faces medidas', page, async () => {
    const r = await apiPortal(token, '/cliente/me/orcamentos', {
      method: 'POST',
      body: {
        customerId: cliente.id,
        briefing:
          'Pintura geral e logomarca nas laterais. As medidas do implemento vão nas três faces, ' +
          'com porta na face do motorista.',
        logoName: 'Bateria de Medidas',
        veiculos: series.map(serialNumber => ({ serialNumber, medidas: CM })),
      },
    });
    check(
      'POST /cliente/me/orcamentos aceita as medidas',
      r.status === 200 || r.status === 201,
      `status=${r.status} · ${r.body?.message ?? JSON.stringify(r.body).slice(0, 200)}`,
    );
    budgetId = r.body?.data?.budgetId ?? '';
    check('o recibo traz o orçamento criado', !!budgetId, `budgetNumber=${r.body?.data?.budgetNumber}`);
    if (r.body?.data?.budgetNumber) info(`orçamento ${r.body.data.budgetNumber}`);
  });

  await scenario('o banco guardou METROS, face a face', page, async () => {
    if (!budgetId) return check('há orçamento para conferir', false);

    const tarefas = await prisma.task.findMany({
      where: { quoteId: budgetId },
      select: {
        serialNumber: true,
        truck: {
          select: {
            leftSideMeasure: { select: { height: true, sections: { select: { width: true, isDoor: true, doorHeight: true, position: true }, orderBy: { position: 'asc' } } } },
            rightSideMeasure: { select: { height: true, sections: { select: { width: true, isDoor: true, doorHeight: true, position: true }, orderBy: { position: 'asc' } } } },
            backSideMeasure: { select: { height: true, sections: { select: { width: true, isDoor: true, doorHeight: true, position: true }, orderBy: { position: 'asc' } } } },
          },
        },
      },
      orderBy: { serialNumber: 'asc' },
    });

    check('as duas tarefas nasceram', tarefas.length === 2, `${tarefas.length} tarefa(s)`);

    for (const t of tarefas) {
      const faces = [
        ['esquerda', t.truck?.leftSideMeasure, METROS.esquerda] as const,
        ['direita', t.truck?.rightSideMeasure, METROS.direita] as const,
        ['traseira', t.truck?.backSideMeasure, METROS.traseira] as const,
      ];
      for (const [nome, medida, esperado] of faces) {
        check(
          `${t.serialNumber} · ${nome}: a face existe`,
          !!medida,
          medida ? '' : 'a coluna do Truck ficou nula',
        );
        if (!medida) continue;
        check(
          `${t.serialNumber} · ${nome}: altura ${esperado.height} m (e NÃO ${esperado.height * 100})`,
          perto(medida.height, esperado.height),
          `gravado=${medida.height}`,
        );
        const larguras = medida.sections.map(s => s.width);
        check(
          `${t.serialNumber} · ${nome}: ${esperado.widths.length} seção(ões) em metros`,
          larguras.length === esperado.widths.length &&
            esperado.widths.every((w, i) => perto(larguras[i], w)),
          `gravado=[${larguras.join(', ')}] esperado=[${esperado.widths.join(', ')}]`,
        );
        check(
          `${t.serialNumber} · ${nome}: as posições são 0..n na ordem enviada`,
          medida.sections.every((s, i) => s.position === i),
          `posições=[${medida.sections.map(s => s.position).join(', ')}]`,
        );
        const porta = medida.sections.find(s => s.isDoor);
        check(
          `${t.serialNumber} · ${nome}: a porta ${esperado.doorHeight ? `tem ${esperado.doorHeight} m` : 'não existe'}`,
          esperado.doorHeight ? perto(porta?.doorHeight, esperado.doorHeight) : !porta,
          `porta=${porta ? porta.doorHeight : '(nenhuma)'}`,
        );
      }
    }
  });

  await scenario('a medida VOLTA para o cliente, em centímetros', page, async () => {
    if (!budgetId) return check('há orçamento para conferir', false);
    const det = await apiPortal(token, `/cliente/me/orcamentos/${budgetId}`);
    const veiculo = (det.body?.data?.vehicles ?? [])[0];
    check('o detalhe do orçamento devolve os veículos', !!veiculo, `status=${det.status}`);
    if (!veiculo) return;

    const porTaskId = await apiPortal(token, `/cliente/me/veiculos/${veiculo.id}`);
    // As medidas moram em `identity`, com as demais coisas da seção `VEHICLE`.
    const m = porTaskId.body?.data?.identity?.measures;
    check(
      'GET /cliente/me/veiculos/:taskId devolve identity.measures',
      !!m,
      m ? '' : `chaves de data=${Object.keys(porTaskId.body?.data ?? {}).join(', ')}`,
    );
    if (!m) return;

    // ⚠️ EM METROS, e é decisão explícita do projetor: a conversão para
    // centímetros é da BORDA (o formulário divide ao enviar e multiplica ao
    // exibir), para que o portal não tenha unidade diferente do resto do
    // sistema no mesmo campo. Esta asserção existe para que a decisão não seja
    // desfeita por engano — e para que, se for desfeita de propósito, seja aqui
    // que se descubra.
    check(
      'a esquerda volta em METROS (2.4), como o banco guarda',
      m.left?.height === 2.4,
      `recebido=${m.left?.height}`,
    );
    check(
      'as três faces voltam, e a porta junto',
      m.left?.sections?.length === 2 &&
        m.right?.sections?.length === 2 &&
        m.back?.sections?.length === 1 &&
        m.left?.sections?.some((x: any) => x.isDoor),
      `esq=${m.left?.sections?.length} dir=${m.right?.sections?.length} tras=${m.back?.sections?.length}`,
    );
  });

  await scenario('a medida APARECE na tela do veículo', page, async () => {
    if (!budgetId) return check('há orçamento para conferir', false);
    const det = await apiPortal(token, `/cliente/me/orcamentos/${budgetId}`);
    const veiculo = (det.body?.data?.vehicles ?? [])[0];
    if (!veiculo) return check('há veículo para abrir', false);

    const { WEB } = await import('../helpers/env');
    await page.goto(`${WEB}/cliente/painel/veiculos/${veiculo.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const { texto } = await import('../helpers/ui');
    const tela = await texto(page, 'main');

    // ⛔ O DADO QUE ENTRA E NÃO VOLTA. O cliente desenha as três faces no
    // assistente, o servidor as entrega de volta em `identity.measures` — e
    // nenhuma tela do portal as desenhava. Medida é o dado que ele mais
    // trabalha para informar; não devolvê-lo é pedir que ele confie de memória.
    check(
      'a tela do veículo menciona as medidas do implemento',
      /medida/i.test(tela),
      `a tela não fala em medidas. Começo: ${tela.slice(0, 160)}`,
    );
    check(
      'e mostra a altura informada (2,40 m)',
      /2[.,]40?\s*m/i.test(tela),
      'não achei a altura na tela',
    );
  });

  await browser.close();
  await prisma.$disconnect();
  return report();
}

main().then(n => process.exit(n > 0 ? 1 : 0));
