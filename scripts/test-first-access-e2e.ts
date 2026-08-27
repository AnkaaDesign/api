/**
 * Prova da fiação: a cerimônia de primeiro acesso rodando por HTTP, contra a API
 * local e o banco local — rotas, guard, zod e serviço juntos.
 *
 * O teste de unidade (tests/first-access.test.ts) cobre as REGRAS; este cobre o
 * que unidade nenhuma pega: se os três endpoints existem, se são públicos (o
 * colaborador ainda não consegue logar), se o zod aceita o corpo, e se a sessão
 * devolvida no fim realmente vale — a prova final é chamar /auth/me com ela.
 *
 * Cria um usuário descartável no banco local e o apaga no fim, aconteça o que
 * acontecer.
 *
 * Rodar (com `pnpm dev` de pé): pnpm exec tsx scripts/test-first-access-e2e.ts
 */
import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL || `http://localhost:${process.env.PORT || 3030}`;
const EMAIL = 'primeiro.acesso.teste@ankaa.local';
const SENHA = 'senhaDoTeste123';

const prisma = new PrismaClient();
let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main() {
  let userId: string | null = null;

  try {
    // Sobrou algo de uma rodada anterior? Some com ele antes de recriar.
    await prisma.user.deleteMany({ where: { email: EMAIL } });

    const created = await prisma.user.create({
      data: {
        name: 'Teste Primeiro Acesso',
        email: EMAIL,
        // Exatamente o estado em que o RH deixa um cadastro novo:
        password: null,
        verified: false,
      },
      select: { id: true },
    });
    userId = created.id;
    console.log(`\nUsuário de teste criado (${userId})`);

    console.log('\nPasso 1 — POST /auth/first-access/request');
    const req = await post('/auth/first-access/request', { contact: EMAIL });
    check('endpoint é público (não exige token)', req.status === 200, `HTTP ${req.status}`);
    const afterRequest = await prisma.user.findUnique({ where: { id: userId } });
    const codigo = afterRequest?.verificationCode ?? '';
    check('código de 6 dígitos gravado', /^\d{6}$/.test(codigo), codigo);
    check(
      'gravado como FIRST_ACCESS',
      afterRequest?.verificationType === 'FIRST_ACCESS',
      String(afterRequest?.verificationType),
    );

    console.log('\nPasso 2 — POST /auth/first-access/verify');
    const errado = await post('/auth/first-access/verify', { contact: EMAIL, code: '000000' });
    check('código errado devolve 400', errado.status === 400, `HTTP ${errado.status}`);

    const curto = await post('/auth/first-access/verify', { contact: EMAIL, code: '123' });
    check('zod recusa código fora do formato', curto.status === 400, `HTTP ${curto.status}`);

    const ver = await post('/auth/first-access/verify', { contact: EMAIL, code: codigo });
    check('código certo devolve 200', ver.status === 200, `HTTP ${ver.status}`);
    const setupToken = ver.json?.data?.setupToken ?? '';
    check('veio o setup token', typeof setupToken === 'string' && setupToken.length > 0);
    const afterVerify = await prisma.user.findUnique({ where: { id: userId } });
    check('código foi gasto', afterVerify?.verificationCode === null);
    check(
      'conta ainda intocada antes do último passo',
      afterVerify?.password === null && afterVerify?.verified === false,
    );

    console.log('\nO setup token não abre a aplicação');
    const meComSetup = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${setupToken}` },
    });
    check('/auth/me recusa o setup token', meComSetup.status === 401, `HTTP ${meComSetup.status}`);

    console.log('\nPasso 3 — POST /auth/first-access/complete');
    const divergente = await post('/auth/first-access/complete', {
      setupToken,
      password: SENHA,
      confirmPassword: 'outraCoisa123',
    });
    check('zod recusa senhas diferentes', divergente.status === 400, `HTTP ${divergente.status}`);

    const done = await post('/auth/first-access/complete', {
      setupToken,
      password: SENHA,
      confirmPassword: SENHA,
    });
    check('ativação devolve 200', done.status === 200, `HTTP ${done.status}`);
    const token = done.json?.data?.token ?? '';
    check('veio sessão pronta', typeof token === 'string' && token.length > 0);
    check('veio refresh token', typeof done.json?.data?.refreshToken === 'string');
    check('usuário devolvido já verificado', done.json?.data?.user?.verified === true);

    const afterComplete = await prisma.user.findUnique({ where: { id: userId } });
    check('senha gravada com hash bcrypt', /^\$2[aby]\$/.test(afterComplete?.password ?? ''));
    check('conta verificada no banco', afterComplete?.verified === true);

    console.log('\nA sessão devolvida realmente vale');
    const me = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    check('/auth/me aceita o token da ativação', me.status === 200, `HTTP ${me.status}`);

    const replay = await post('/auth/first-access/complete', {
      setupToken,
      password: 'tentativaDeReplay1',
      confirmPassword: 'tentativaDeReplay1',
    });
    check('replay do mesmo bilhete é recusado', replay.status >= 400, `HTTP ${replay.status}`);

    console.log('\nE o login normal passa a funcionar');
    const login = await post('/auth/login', { contact: EMAIL, password: SENHA });
    check('login com a senha criada devolve 200', login.status === 200, `HTTP ${login.status}`);

    const jaAtivo = await post('/auth/first-access/request', { contact: EMAIL });
    check(
      'conta já ativa não repete o primeiro acesso',
      jaAtivo.status === 400,
      `HTTP ${jaAtivo.status}: ${jaAtivo.json?.message ?? ''}`,
    );
  } finally {
    if (userId) {
      await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.changeLog.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: userId } }).catch((e) => {
        failures++;
        console.error(`  ✗ falha ao apagar o usuário de teste ${userId}: ${e.message}`);
      });
      console.log('\nUsuário de teste removido');
    }
    await prisma.$disconnect();
  }

  console.log(
    failures === 0
      ? '\n✅ A cerimônia de primeiro acesso funciona ponta a ponta.\n'
      : `\n❌ ${failures} verificação(ões) falharam.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\n💥 Erro não tratado:', e);
  process.exit(1);
});
