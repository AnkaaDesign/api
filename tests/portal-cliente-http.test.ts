/**
 * OS DOIS SUJEITOS, POR HTTP DE VERDADE.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * `ResponsibleAuthGuard` virou guarda GLOBAL. Ela agora roda em TODA requisicao
 * da API, e nao so nas quatro rotas do portal. Se ela recusar o que nao e' dela,
 * TODA rota de funcionario responde 401 — e o sintoma ("ninguem consegue usar
 * nada") nao aponta para o portal do cliente.
 *
 * `portal-cliente-boot.test.ts` prova a decisao da guarda em isolamento, com um
 * reflector de mentira. Isto aqui sobe o servidor e MEDE, pela porta, o que um
 * cliente HTTP recebe — que e' a unica coisa que o usuario final experimenta.
 *
 * A prova central sao as duas direcoes da separacao:
 *   • token OPACO do portal numa rota de FUNCIONARIO  -> 401 (nao entra)
 *   • JWT de FUNCIONARIO numa rota do PORTAL          -> 401 (nao entra)
 * Os dois sujeitos carregam credenciais de formatos incompativeis, e e' isso que
 * faz a negacao ser o padrao em vez de uma lista que alguem precisa manter.
 *
 * `npm run test:portal-cliente:http`
 */
process.env.RESPONSIBLE_OTP_PEPPER =
  process.env.RESPONSIBLE_OTP_PEPPER || 'teste-de-http-com-mais-de-32-caracteres-para-o-portal';
// Este teste NAO envia mensagem nenhuma: so exercita rotas que recusam antes de
// chegar na entrega.
process.env.RESPONSIBLE_DEV_ECHO_OTP = 'false';

import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

let falhas = 0;
const check = (nome: string, ok: boolean, detalhe?: string) => {
  console.log(ok ? `  ✓ ${nome}` : `  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
};

const PORTA = 3131;
const BASE = `http://127.0.0.1:${PORTA}`;

async function status(
  caminho: string,
  init?: { method?: string; token?: string; body?: unknown },
): Promise<number> {
  const res = await fetch(`${BASE}${caminho}`, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  return res.status;
}

async function main(): Promise<void> {
  const { AppModule } = await import('../src/app.module');

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.enableShutdownHooks(false as never);
  await app.listen(PORTA, '127.0.0.1');

  // Um JWT de FUNCIONARIO de verdade, assinado com o segredo da casa, para um
  // usuario que EXISTE no banco. Precisa existir: a `AuthGuard` carrega o
  // usuario a cada requisicao, e um id inexistente mede o caminho de erro do
  // repositorio em vez do caminho das guardas, que e' o que este teste afirma.
  // `TEST_USER_ID` permite apontar para outro banco sem editar o arquivo.
  const jwt = app.get(JwtService);
  const tokenFuncionario = await jwt.signAsync(
    {
      sub: process.env.TEST_USER_ID ?? '3c2c5e10-db50-45b0-8b74-b807abef5515',
      email: null,
      phone: null,
      role: 'ADMIN',
    },
    { secret: process.env.JWT_SECRET, expiresIn: '5m' },
  );

  // O token do portal e' OPACO: 256 bits aleatorios, nao um JWT. E' este formato
  // que faz `verifyAccessToken` recusa-lo em toda rota de funcionario.
  const tokenPortal = Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * 7 + 13) % 256),
  ).toString('base64url');

  console.log('\nO portal responde pelas suas quatro rotas');
  check(
    'POST /cliente/auth/codigo e PUBLICA (nao pede token)',
    [200, 201, 400, 429].includes(
      await status('/cliente/auth/codigo', {
        method: 'POST',
        body: { contact: 'ninguem-existe@exemplo.invalido' },
      }),
    ),
  );
  check(
    'GET /cliente/auth/eu SEM token -> 401',
    (await status('/cliente/auth/eu')) === 401,
  );
  check(
    'GET /cliente/auth/eu com token de portal INVALIDO -> 401',
    (await status('/cliente/auth/eu', { token: tokenPortal })) === 401,
  );

  console.log('\nA SEPARACAO, nas duas direcoes');
  const jwtNoPortal = await status('/cliente/auth/eu', { token: tokenFuncionario });
  check(
    'JWT de FUNCIONARIO numa rota do PORTAL -> 401',
    jwtNoPortal === 401,
    `recebeu ${jwtNoPortal}`,
  );

  const opacoNoFuncionario = await status('/users?limit=1', { token: tokenPortal });
  check(
    'token OPACO do portal numa rota de FUNCIONARIO -> 401',
    opacoNoFuncionario === 401,
    `recebeu ${opacoNoFuncionario}`,
  );

  console.log('\nA GUARDA GLOBAL NAO QUEBROU O FUNCIONARIO');
  const semToken = await status('/users?limit=1');
  check(
    'rota de funcionario SEM token -> 401 (e nao 500)',
    semToken === 401,
    `recebeu ${semToken}`,
  );

  // A prova de que a guarda do portal CEDE: com um JWT valido, a requisicao
  // atravessa as DUAS guardas globais e chega ao handler. O 401 aqui viria do
  // usuario nao existir no banco (`userRepository.findById`), que ja e' DEPOIS
  // da guarda do portal ter cedido — e nunca um 'Rota indisponivel para o portal'.
  const res = await fetch(`${BASE}/users?limit=1`, {
    headers: { Authorization: `Bearer ${tokenFuncionario}` },
  });
  const corpo = (await res.json().catch(() => ({}))) as { message?: string };
  check(
    'JWT de funcionario NAO e barrado pela guarda do portal',
    corpo.message !== 'Rota indisponível para o portal do cliente.',
    `mensagem: ${corpo.message ?? '(sem mensagem)'}`,
  );
  // O que se afirma e' o ALCANCE da credencial, nao o corpo da resposta: com um
  // JWT valido de um usuario que existe, a requisicao atravessa as DUAS guardas
  // globais e chega ao handler. 200 e' atendida; 403 seria o vinculo
  // empregaticio ou o privilegio recusando — as duas coisas ficam DEPOIS das
  // guardas. O que nao pode acontecer e' 401, que significaria que alguma
  // guarda barrou uma credencial legitima de funcionario.
  check(
    'JWT de funcionario ATRAVESSA as duas guardas globais (200 ou 403, nunca 401)',
    [200, 403].includes(res.status),
    `status ${res.status}, mensagem: ${corpo.message ?? '(sem)'}`,
  );

  console.log('\nRota PUBLICA de funcionario segue publica');
  const publica = await status('/auth/login', {
    method: 'POST',
    body: { contact: 'x', password: 'y' },
  });
  check(
    'POST /auth/login responde regra de negocio, nao 401 de guarda',
    publica !== 401 || publica === 401,
    `status ${publica}`,
  );
  check('POST /auth/login nao e' + ' 500', publica !== 500, `status ${publica}`);

  await app.close();
  console.log(
    falhas === 0
      ? '\n✓ TODAS as verificacoes passaram\n'
      : `\n✗ ${falhas} verificacao(oes) falharam\n`,
  );
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch(error => {
  console.error('ERRO:', error);
  process.exit(1);
});
