/**
 * CONTAS DE DEMONSTRAÇÃO DO PORTAL DO RESPONSÁVEL
 *
 * Cria cinco contatos, um por PERFIL DE PAPEL, para que o portal possa ser
 * exercitado de verdade — a graça da feature é justamente que cada papel vê e
 * faz coisas diferentes, e isso não se avalia com um login só.
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
import { PrismaClient, ResponsibleRole } from '@prisma/client';

const prisma = new PrismaClient();

/** Furgões Ibiporã — `PINNED_CUSTOMERS.IBIPORA`. Ela PAGA e raramente é dona. */
const IBIPORA = '93dfbeb1-aec0-4829-a297-6a2f09fcfe08';

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
      'O caso principal. Abre requisição, PRÉ-APROVA e assina o documento inteiro. ' +
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
      'PAPEL ÚNICO Compras — só assina COM número de pedido. É o portão que o dono ' +
      'pediu, e é preciso que seja o único papel para ele morder.',
  },
  {
    phone: '43999000003',
    name: 'Comercial e Compras Demo (Furgões)',
    email: `comercial-compras${SUFIXO}`,
    roles: [ResponsibleRole.COMMERCIAL, ResponsibleRole.PURCHASING],
    empresa: IBIPORA,
    porque:
      'O CONTROLE do portão acima: acumula Compras com Comercial e por isso NÃO é ' +
      'barrado. Serve para provar que a regra é "papel único", não "tem Compras".',
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
    porque: 'Vê a ARTE e não vê o PREÇO. Abre requisição sem nunca saber quanto custa.',
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
  await prisma.responsible.deleteMany({ where: { id: { in: ids } } });
  console.log(`✓ ${alvos.length} contato(s) de demonstração removido(s).`);
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

  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('ENTRE EM  /cliente/entrar  COM O TELEFONE OU O E-MAIL:\n');
  for (const p of PERFIS) {
    const empresa = p.empresa === IBIPORA ? 'Furgões Ibiporã' : 'Marquespan';
    console.log(`  ${p.phone}   ${p.email}`);
    console.log(`    ${p.name}  ·  ${p.roles.join(' + ')}  ·  ${empresa}`);
    console.log(`    ${p.porque}\n`);
  }
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
