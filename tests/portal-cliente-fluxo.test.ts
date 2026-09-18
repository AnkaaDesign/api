/**
 * O FLUXO DO PORTAL, PELA PORTA, COMO O NAVEGADOR FAZ.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * `GET /cliente/auth/eu` e' a UNICA fonte da sessao depois de um F5, e o web
 * passou a consumir dele a forma inteira (`id`, `name`, `email`, `phone`,
 * `roles`, `companyId`, `companyName`). Esse contrato NAO e' verificavel por
 * `tsc`: os dois repositorios nao compartilham pacote — `api/pnpm-workspace.yaml`
 * declara a API como pacote unico e o `web/package.json` nao tem nenhuma
 * dependencia `workspace:`. Um campo que suma daqui compila dos dois lados e
 * aparece como cabecalho vazio no portal do cliente.
 *
 * As outras suites param antes disto de proposito:
 *   • `responsible-auth-otp`      — criptografia e FORMA do SQL, sem banco;
 *   • `portal-cliente-auth-db`    — o banco, chamando os servicos direto;
 *   • `portal-cliente-boot`       — o grafo de injecao e a decisao das guardas;
 *   • `portal-cliente-http`       — a separacao entre os dois sujeitos.
 * Nenhuma delas atravessa `pedir codigo -> entrar -> eu -> sair` pelo HTTP com o
 * codigo que realmente saiu. E' o que falta, e e' o que o cliente vive.
 *
 * O codigo e' capturado do eco de DEV porque ele e' guardado como HMAC e e'
 * IRRECUPERAVEL do banco, por desenho. NENHUMA mensagem e' enviada: o eco
 * retorna antes da entrega.
 *
 * Cria e apaga o proprio contato de teste. NAO toca em cadastro existente — o
 * `Customer` e' apenas LIDO, para que `companyName` tenha o que devolver.
 *
 * `npm run test:portal-cliente:fluxo`
 */
process.env.NODE_ENV = 'development';
process.env.RESPONSIBLE_OTP_PEPPER =
  process.env.RESPONSIBLE_OTP_PEPPER || 'teste-de-fluxo-com-mais-de-32-caracteres-portal';
// Ecoa o codigo no log em vez de enviar. Duas travas no servico: so fora de
// producao E com esta flag. E' o unico jeito de um teste saber o codigo.
process.env.RESPONSIBLE_DEV_ECHO_OTP = 'true';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

// Subir o `AppModule` acorda integracoes que, nesta maquina, nao tem com quem
// falar (Baileys, Redis, certificado ICP). Elas reclamam de forma ASSINCRONA e
// uma rejeicao solta derrubaria o processo levando o resultado junto.
process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

let falhas = 0;
const check = (nome: string, ok: boolean, detalhe?: string) => {
  console.log(ok ? `  ✓ ${nome}` : `  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
};

const PORTA = 3133;
const BASE = `http://127.0.0.1:${PORTA}`;

const TELEFONE = '43999000111';
const EMAIL = 'redteam-portal@exemplo.invalido';
const NOME = 'Contato de Teste do Red Team';

/** O ultimo codigo que o eco de DEV imprimiu. */
let codigoEcoado: string | null = null;

/**
 * Intercepta o eco ANTES de o Nest subir.
 *
 * Patch em `Logger.prototype.warn`, e nao um logger customizado na aplicacao,
 * porque o nivel de log configurado no `NestFactory` filtraria `warn` antes de
 * chegar a qualquer lugar que eu pudesse ler.
 */
const warnOriginal = Logger.prototype.warn;
Logger.prototype.warn = function patched(this: Logger, ...args: unknown[]) {
  const texto = args.map(a => (typeof a === 'string' ? a : '')).join(' ');
  const achado = /\[DEV\] Código de acesso de .*?: (\d{6}) —/.exec(texto);
  if (achado) codigoEcoado = achado[1];
  return (warnOriginal as (...a: unknown[]) => void).apply(this, args as never);
} as typeof Logger.prototype.warn;

interface Resposta {
  status: number;
  body: Record<string, unknown>;
}

async function pedir(
  caminho: string,
  init?: { method?: string; token?: string; body?: unknown },
): Promise<Resposta> {
  const res = await fetch(`${BASE}${caminho}`, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

async function main(): Promise<void> {
  const { AppModule } = await import('../src/app.module');
  const { PrismaService } = await import('../src/modules/common/prisma/prisma.service');

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.listen(PORTA, '127.0.0.1');

  const prisma = app.get(PrismaService);

  let responsibleId: string | null = null;

  try {
    // ── fixture ──────────────────────────────────────────────────────────────
    // `fantasyName` e' NOT NULL neste modelo — filtrar por `{ not: null }` e'
    // erro de validacao do Prisma, nao consulta vazia.
    const customer = await prisma.customer.findFirst({
      where: { fantasyName: { not: '' } },
      select: { id: true, fantasyName: true },
    });
    if (!customer) throw new Error('Nenhum Customer com fantasyName no banco local.');

    // Limpeza defensiva: uma execucao anterior interrompida pode ter deixado a
    // ficha para tras, e `phone` e' unico.
    await prisma.responsible.deleteMany({ where: { phone: TELEFONE } });

    const criado = await prisma.responsible.create({
      data: {
        name: NOME,
        phone: TELEFONE,
        email: EMAIL,
        roles: ['COMMERCIAL'],
        companyId: customer.id,
        isActive: true,
      },
      select: { id: true },
    });
    responsibleId = criado.id;

    // ── passo 1: pedir o codigo pelo TELEFONE ────────────────────────────────
    console.log('\nPasso 1 — pedir o código pelo telefone');
    codigoEcoado = null;
    const pedido = await pedir('/cliente/auth/codigo', {
      method: 'POST',
      body: { contact: TELEFONE },
    });
    check('a rota aceita o pedido', [200, 201].includes(pedido.status), `status ${pedido.status}`);
    check('devolve challengeId', typeof pedido.body.challengeId === 'string');
    check('o canal do telefone é WHATSAPP', pedido.body.channel === 'WHATSAPP',
      `veio ${String(pedido.body.channel)}`);
    check('devolve o destino mascarado', typeof pedido.body.destinationMask === 'string');
    check(
      'a máscara NÃO contém o telefone inteiro',
      !String(pedido.body.destinationMask ?? '').includes(TELEFONE),
      String(pedido.body.destinationMask),
    );
    check('o código saiu pelo eco de DEV', codigoEcoado !== null);

    // ── passo 2: entrar ──────────────────────────────────────────────────────
    console.log('\nPasso 2 — trocar o código por uma sessão');
    const entrada = await pedir('/cliente/auth/entrar', {
      method: 'POST',
      body: {
        contact: TELEFONE,
        challengeId: pedido.body.challengeId,
        code: codigoEcoado,
      },
    });
    check('entra', [200, 201].includes(entrada.status), `status ${entrada.status}`);
    const token = entrada.body.token as string | undefined;
    check('devolve token de sessão', typeof token === 'string' && token.length > 20);

    // ── passo 3: O CONTRATO do /eu, campo a campo ────────────────────────────
    console.log('\nPasso 3 — GET /eu devolve a forma INTEIRA (o contrato do F5)');
    const eu = await pedir('/cliente/auth/eu', { token });
    check('responde 200', eu.status === 200, `status ${eu.status}`);
    for (const campo of ['id', 'name', 'email', 'phone', 'roles', 'companyId', 'companyName']) {
      check(`\`${campo}\` presente na resposta`, campo in eu.body, `chaves: ${Object.keys(eu.body).join(', ')}`);
    }
    check('`companyName` NÃO é null — é ele que o cabeçalho do portal mostra',
      eu.body.companyName !== null && eu.body.companyName !== undefined,
      `veio ${JSON.stringify(eu.body.companyName)}`);
    check('`companyName` é o do cliente do cadastro',
      eu.body.companyName === customer.fantasyName,
      `esperado ${customer.fantasyName}, veio ${String(eu.body.companyName)}`);
    check('`email` e `phone` vêm preenchidos',
      eu.body.email === EMAIL && eu.body.phone === TELEFONE);
    check('`roles` é lista', Array.isArray(eu.body.roles));
    check('a resposta NÃO carrega o token nem hash de sessão',
      !('token' in eu.body) && !('tokenHash' in eu.body) && !('sessionId' in eu.body),
      `chaves: ${Object.keys(eu.body).join(', ')}`);

    // A MESMA forma que `entrar` devolve. Se as duas divergirem, o portal
    // mostra uma coisa ao entrar e outra depois do F5.
    const chavesEntrar = Object.keys((entrada.body.responsible ?? {}) as object).sort();
    const chavesEu = Object.keys(eu.body).sort();
    check('`/eu` e `entrar` devolvem exatamente as MESMAS chaves',
      JSON.stringify(chavesEntrar) === JSON.stringify(chavesEu),
      `entrar: [${chavesEntrar.join(', ')}] · eu: [${chavesEu.join(', ')}]`);

    // ── passo 4: o mesmo contato pelo E-MAIL muda o canal ────────────────────
    console.log('\nPasso 4 — o mesmo contato pelo e-mail troca o canal');
    // O cooldown de 120s e' POR CONTATO e barraria este segundo pedido. Apagar
    // os desafios DESTA ficha de teste limpa a janela sem afrouxar nada no
    // servico — o que se afirma aqui e' a escolha de canal, nao o cooldown (esse
    // ja tem teste proprio em `portal-cliente-auth-db`).
    await prisma.responsibleAuthChallenge.deleteMany({ where: { responsibleId } });
    codigoEcoado = null;
    const porEmail = await pedir('/cliente/auth/codigo', {
      method: 'POST',
      body: { contact: EMAIL },
    });
    check('aceita o pedido por e-mail', [200, 201].includes(porEmail.status), `status ${porEmail.status}`);
    check('o canal do e-mail é EMAIL', porEmail.body.channel === 'EMAIL',
      `veio ${String(porEmail.body.channel)}`);
    check('a máscara do e-mail não expõe o endereço inteiro',
      !String(porEmail.body.destinationMask ?? '').includes(EMAIL),
      String(porEmail.body.destinationMask));

    // ── passo 5: sair revoga NA HORA ─────────────────────────────────────────
    console.log('\nPasso 5 — sair revoga na hora');
    const saida = await pedir('/cliente/auth/sair', { method: 'POST', token });
    check('sair responde 204', saida.status === 204, `status ${saida.status}`);
    const depois = await pedir('/cliente/auth/eu', { token });
    check('o MESMO token deixa de valer na requisição seguinte', depois.status === 401,
      `status ${depois.status}`);

    // ── passo 6: troca de telefone derruba sessao viva ───────────────────────
    console.log('\nPasso 6 — trocar o telefone derruba a sessão viva (canal mudou de dono)');
    await prisma.responsibleAuthChallenge.deleteMany({ where: { responsibleId } });
    codigoEcoado = null;
    const p2 = await pedir('/cliente/auth/codigo', { method: 'POST', body: { contact: TELEFONE } });
    const e2 = await pedir('/cliente/auth/entrar', {
      method: 'POST',
      body: { contact: TELEFONE, challengeId: p2.body.challengeId, code: codigoEcoado },
    });
    const token2 = e2.body.token as string;
    check('sessão nova vale', (await pedir('/cliente/auth/eu', { token: token2 })).status === 200);

    const { ResponsibleService } = await import(
      '../src/modules/people/responsible/responsible.service'
    );
    const service = app.get(ResponsibleService);

    // O OUTRO SENTIDO, e ele importa tanto quanto: o app usa `useEditForm`, que
    // envia SO os campos alterados. Um update parcial que nao toca no canal NAO
    // pode derrubar sessao — se derrubasse, editar o NOME de um contato
    // deslogaria a pessoa do portal, e o suporte nunca ligaria uma coisa a
    // outra.
    await service.update(responsibleId, { name: `${NOME} (editado)` } as never);
    check('editar só o NOME não derruba a sessão',
      (await pedir('/cliente/auth/eu', { token: token2 })).status === 200);

    // Mandar o MESMO telefone também não é troca de dono.
    await service.update(responsibleId, { phone: TELEFONE } as never);
    check('regravar o MESMO telefone não derruba a sessão',
      (await pedir('/cliente/auth/eu', { token: token2 })).status === 200);

    await service.update(responsibleId, { phone: '43999000222' } as never);
    check('depois de trocar o telefone, a sessão MORRE',
      (await pedir('/cliente/auth/eu', { token: token2 })).status === 401);
  } finally {
    // Cada passo do encerramento e' tolerante A FALHA, e isso NAO e' zelo
    // decorativo: `app.close()` derruba Baileys e Redis juntos, e nesta maquina
    // o Redis do Baileys morre com "Connection is closed". Um `throw` aqui
    // SUBSTITUI o erro que realmente aconteceu dentro do `try` — foi assim que
    // a primeira versao deste arquivo reportou um erro de Redis no lugar do
    // defeito de verdade, e eu perdi tempo procurando no lugar errado.
    const tolerante = async (o_que: string, f: () => Promise<unknown>) => {
      try {
        await f();
      } catch (error) {
        console.error(`  (limpeza) falha ao ${o_que}: ${(error as Error).message}`);
      }
    };

    if (responsibleId) {
      const id = responsibleId;
      await tolerante('apagar desafios', () =>
        prisma.responsibleAuthChallenge.deleteMany({ where: { responsibleId: id } }),
      );
      await tolerante('apagar sessões', () =>
        prisma.responsibleSession.deleteMany({ where: { responsibleId: id } }),
      );
    }
    await tolerante('apagar a ficha de teste', () =>
      prisma.responsible.deleteMany({ where: { phone: { in: [TELEFONE, '43999000222'] } } }),
    );
    await tolerante('fechar a aplicação', () => app.close());
  }

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
