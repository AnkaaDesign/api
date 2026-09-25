/**
 * CONTAS DE DEMONSTRAÇÃO DO PORTAL DO RESPONSÁVEL
 *
 * Cria cinco contatos, um por PERFIL DE PAPEL, para que o portal possa ser
 * exercitado de verdade — a graça da feature é justamente que cada papel vê e
 * faz coisas diferentes, e isso não se avalia com um login só.
 *
 * E UM CENÁRIO para eles exercitarem (P13b): um orçamento da Marquespan que a
 * Furgões PAGA, em "Aguardando aprovação do cliente" (VALOR PARA APROVAR), com
 * dois veículos cuja ARTE está pendente — o mesmo arquivo nos dois, para o lote
 * "Aprovar para os 2 veículos". Quem faz o quê nele:
 *   · Vendedor (Furgões, pagadora) — aprova o valor E a arte (escopo comercial,
 *     caminho do pagador);
 *   · Marketing (Marquespan, dona) — aprova a arte e não vê o preço;
 *   · Compras (Furgões) — vê a arte e NÃO a decide (DD5);
 *   · Gestor de Frota (Marquespan) — não vê arte nenhuma.
 *
 * Idempotente: roda quantas vezes quiser. `--limpar` apaga tudo que ele criou.
 *
 *   pnpm demo:portal
 *   pnpm demo:portal --limpar
 *
 * ⚠️ Os telefones são da faixa 43 9 9900-000X, inexistentes de propósito.
 * NENHUMA mensagem sai: com `RESPONSIBLE_DEV_ECHO_OTP=true` o código de acesso
 * é escrito no LOG DA API (nunca na resposta HTTP — o código é guardado como
 * HMAC e é irrecuperável do banco, por desenho).
 *
 * ⚠️ NÃO rode isto contra produção. O guard abaixo recusa `NODE_ENV=production`.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { PrismaClient, ResponsibleRole } from '@prisma/client';

const prisma = new PrismaClient();

/** Furgões Ibiporã — `PINNED_CUSTOMERS.IBIPORA`. Ela PAGA e raramente é dona. */
const IBIPORA = '93dfbeb1-aec0-4829-a297-6a2f09fcfe08';
/** Marquespan — a DONA dos veículos do cenário. */
const MARQUESPAN = '1d55f1e9-d0c8-4102-bcd9-e45980caf65d';

/**
 * A marca do cenário: nome das tarefas, `logoName` da requisição e prefixo do
 * arquivo da arte. É por ela que `--limpar` acha o que apagar — nada do acervo
 * real tem este nome.
 */
const CENARIO = 'DEMO PORTAL';

/** Um PNG de 1×1 de verdade: a arte precisa de bytes (o hash é tirado no ato da decisão). */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const SUFIXO = '@portal.teste';

type Perfil = {
  phone: string;
  name: string;
  email: string;
  roles: ResponsibleRole[];
  empresa: string | null;
  porque: string;
};

const PERFIS: Perfil[] = [
  {
    phone: '43999000001',
    name: 'Vendedor Demo (Furgões)',
    email: `vendedor${SUFIXO}`,
    roles: [ResponsibleRole.SELLER],
    empresa: IBIPORA,
    porque:
      'O caso principal. Abre requisição, APROVA O VALOR E A ARTE e assina o documento inteiro. ' +
      'Na Furgões, que PAGA 118 orçamentos e é dona de 7 — é este contraste que o ' +
      'escopo por pagador existe para resolver.',
  },
  {
    phone: '43999000002',
    name: 'Compras Demo (Furgões)',
    email: `compras${SUFIXO}`,
    roles: [ResponsibleRole.PURCHASING],
    empresa: IBIPORA,
    porque:
      'Tem o papel Compras: informa o nº do pedido de cada veículo NA PRÓPRIA cerimônia ' +
      'de assinatura, e sem ele não assina (DD12). Vê a arte e NÃO a aprova (DD5).',
  },
  {
    phone: '43999000003',
    name: 'Comercial e Compras Demo (Furgões)',
    email: `comercial-compras${SUFIXO}`,
    roles: [ResponsibleRole.COMMERCIAL, ResponsibleRole.PURCHASING],
    empresa: IBIPORA,
    porque:
      'Acumula Compras com Comercial: pela DD12 também informa o pedido na cerimônia ' +
      '(a regra é "tem Compras", não mais "só Compras") — e, pelo Comercial, aprova o ' +
      'valor e a arte. É a UNIÃO dos papéis, nunca a interseção.',
  },
  {
    phone: '43999000004',
    name: 'Gestor de Frota Demo (Marquespan)',
    email: `frota${SUFIXO}`,
    roles: [ResponsibleRole.FLEET_MANAGER],
    empresa: '1d55f1e9-d0c8-4102-bcd9-e45980caf65d',
    porque:
      'O recorte mais estreito que ENXERGA algo: veículo e andamento, ZERO dinheiro. ' +
      'Na assinatura ele não assina nada — é a divergência entre as duas réguas.',
  },
  {
    phone: '43999000005',
    name: 'Marketing Demo (Marquespan)',
    email: `marketing${SUFIXO}`,
    roles: [ResponsibleRole.MARKETING],
    empresa: '1d55f1e9-d0c8-4102-bcd9-e45980caf65d',
    porque:
      'Vê e APROVA a ARTE (é a dona natural dela, D-09) e não vê o PREÇO. Abre requisição ' +
      'sem nunca saber quanto custa.',
  },
];

async function limpar(): Promise<void> {
  const alvos = await prisma.responsible.findMany({
    where: { email: { endsWith: SUFIXO } },
    select: { id: true, name: true },
  });
  if (!alvos.length) {
    console.log('Nada a limpar.');
    return;
  }
  const ids = alvos.map(a => a.id);

  // O CENÁRIO primeiro: as tarefas dele apontam para o orçamento
  // (`Task.quoteId` sem cascata), e o implemento e a arte caem com a tarefa.
  const tarefas = await prisma.task.deleteMany({ where: { name: { startsWith: CENARIO } } });
  if (tarefas.count) console.log(`  ${tarefas.count} veículo(s) do cenário apagado(s) (implemento e arte juntos).`);

  // ORDEM IMPORTA. `BudgetRequest.requestedByResponsibleId` é RESTRICT de
  // propósito: apagar um contato não pode apagar o pedido que originou um
  // contrato. Então as requisições de demonstração saem primeiro — e com elas
  // os orçamentos que nasceram delas, que sem a requisição não são nada.
  const reqs = await prisma.budgetRequest.findMany({
    where: { requestedByResponsibleId: { in: ids } },
    select: { budgetId: true },
  });
  if (reqs.length) {
    await prisma.budget.deleteMany({ where: { id: { in: reqs.map(r => r.budgetId) } } });
    console.log(`  ${reqs.length} orçamento(s) de demonstração apagado(s) (a requisição cascateia).`);
  }
  // A arte já caiu com o implemento; o arquivo dela fica protegido pelo gatilho
  // de exclusão de `File` até ninguém mais apontar para ele.
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_referenced_file_delete = 'on'`);
    await tx.file.deleteMany({ where: { originalName: { startsWith: CENARIO } } });
  });
  await prisma.responsible.deleteMany({ where: { id: { in: ids } } });
  console.log(`✓ ${alvos.length} contato(s) de demonstração removido(s).`);
}

/**
 * O CENÁRIO DO P13b: valor para aprovar e arte pendente em dois veículos.
 *
 * Escreve direto no banco, e não pelo `ImplementLayoutService`, porque este
 * script é um `PrismaClient` solto (sem Nest) — mas escreve o que o serviço
 * escreveria ao ENVIAR a arte: `PENDING_APPROVAL`, `sentAt` e a linha de trilha
 * `INTERNAL`. O aviso ao contato NÃO sai (o cenário é para abrir o portal, não
 * para mandar mensagem).
 */
async function semearCenario(): Promise<void> {
  const [ibipora, marquespan] = await Promise.all([
    prisma.customer.findUnique({ where: { id: IBIPORA }, select: { id: true } }),
    prisma.customer.findUnique({ where: { id: MARQUESPAN }, select: { id: true } }),
  ]);
  const vendedor = await prisma.responsible.findUnique({ where: { phone: '43999000001' } });
  const marketing = await prisma.responsible.findUnique({ where: { phone: '43999000005' } });
  if (!ibipora || !marquespan || !vendedor || !marketing) {
    console.log('… cenário de arte pulado: este banco não tem a Furgões e a Marquespan.');
    return;
  }
  const existente = await prisma.budgetRequest.findFirst({
    where: { requestedByResponsibleId: vendedor.id, logoName: CENARIO },
    select: { budget: { select: { budgetNumber: true } } },
  });
  if (existente) {
    console.log(`↻ cenário já existe  orçamento nº ${existente.budget.budgetNumber}`);
    return;
  }

  const dir = resolve('.tmp', 'demo-portal');
  mkdirSync(dir, { recursive: true });
  const caminho = join(dir, 'arte-demo.png');
  writeFileSync(caminho, PNG_1X1);
  const arquivo = await prisma.file.create({
    data: {
      filename: 'arte-demo.png',
      originalName: `${CENARIO} arte.png`,
      mimetype: 'image/png',
      path: caminho,
      size: PNG_1X1.length,
    },
  });

  const ultimo = await prisma.budget.aggregate({ _max: { budgetNumber: true } });
  const orcamento = await prisma.budget.create({
    data: {
      budgetNumber: (ultimo._max.budgetNumber ?? 0) + 1,
      // "Aguardando aprovação do cliente": é aqui que o VALOR espera o portal.
      status: 'IN_NEGOTIATION' as any,
      subtotal: 14820,
      total: 14820,
      expiresAt: new Date(Date.now() + 30 * 86400000),
      services: {
        create: [
          { description: 'Pintura geral do baú', amount: 11000, position: 0 },
          { description: 'Logomarca nas laterais', amount: 3820, position: 1 },
        ],
      },
      request: {
        create: {
          requestedByResponsibleId: vendedor.id,
          briefing: 'Dois baús novos com a pintura da frota e a logomarca nas duas laterais.',
          logoName: CENARIO,
        },
      },
    },
  });

  const veiculos = [];
  for (const n of [1, 2]) {
    const tarefa = await prisma.task.create({
      data: {
        name: `${CENARIO} ${n}`,
        customerId: MARQUESPAN,
        quoteId: orcamento.id,
        status: 'PREPARATION' as any,
        statusOrder: 1,
        implement: { create: { serialNumber: `DEMO-PORTAL-${n}`, spot: null } },
        responsibles: { connect: [{ id: marketing.id }] },
      },
      include: { implement: true },
    });
    await prisma.layout.create({
      data: {
        fileId: arquivo.id,
        implementId: tarefa.implement!.id,
        status: 'PENDING_APPROVAL' as any,
        version: 1,
        sentAt: new Date(),
        decisions: { create: { toStatus: 'PENDING_APPROVAL' as any, source: 'INTERNAL' as any } },
      },
    });
    veiculos.push(tarefa.id);
  }

  // A Furgões PAGA os dois: é o que a põe no escopo comercial (aprova valor e arte).
  await prisma.billing.create({
    data: {
      quoteId: orcamento.id,
      tasks: { create: veiculos.map(taskId => ({ taskId })) },
      customerConfigs: {
        create: [{ quoteId: orcamento.id, customerId: IBIPORA, subtotal: 14820, total: 14820 }],
      },
    },
  });

  console.log(
    `+ cenário criado     orçamento nº ${orcamento.budgetNumber}: valor para aprovar e a arte ` +
      'pendente em 2 veículos (o mesmo arquivo)',
  );
}

async function semear(): Promise<void> {
  for (const perfil of PERFIS) {
    const existente = await prisma.responsible.findUnique({ where: { phone: perfil.phone } });
    const dados = {
      name: perfil.name,
      email: perfil.email,
      roles: perfil.roles,
      companyId: perfil.empresa,
      isActive: true,
    };

    if (existente) {
      await prisma.responsible.update({ where: { id: existente.id }, data: dados });
      console.log(`↻ atualizado  ${perfil.name}`);
    } else {
      await prisma.responsible.create({ data: { phone: perfil.phone, ...dados } });
      console.log(`+ criado      ${perfil.name}`);
    }
  }
}

(async () => {
  if (process.env.NODE_ENV === 'production') {
    console.error('⛔ Recusado: NODE_ENV=production.');
    process.exit(1);
  }

  const deveLimpar = process.argv.includes('--limpar');
  if (deveLimpar) {
    await limpar();
    await prisma.$disconnect();
    return;
  }

  await semear();
  await semearCenario();

  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('ENTRE EM  /cliente/entrar  COM O TELEFONE OU O E-MAIL:\n');
  for (const p of PERFIS) {
    const empresa = p.empresa === IBIPORA ? 'Furgões Ibiporã' : 'Marquespan';
    console.log(`  ${p.phone}   ${p.email}`);
    console.log(`    ${p.name}  ·  ${p.roles.join(' + ')}  ·  ${empresa}`);
    console.log(`    ${p.porque}\n`);
  }
  console.log(`O CENÁRIO "${CENARIO}": no Início, "Valores para aprovar" e "Arte esperando a sua`);
  console.log('aprovação"; no orçamento, "Aprovar para os 2 veículos". Entre como o Vendedor, o');
  console.log('Marketing e o Compras e compare.\n');
  console.log('O CÓDIGO sai no LOG DA API, assim:');
  console.log('  [DEV] Código de acesso de <nome> (<destino mascarado>): 123456');
  console.log('  — NENHUMA mensagem é enviada.');
  console.log('─────────────────────────────────────────────────────────────');

  await prisma.$disconnect();
})().catch(async e => {
  console.error('ERRO:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
