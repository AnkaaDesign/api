/**
 * Guarda do primeiro acesso — a cerimônia que transforma um cadastro feito pelo
 * RH (senha NULA, verified false) em uma conta que o colaborador usa.
 *
 * O que este arquivo protege, em uma frase cada:
 *  · só entra quem ainda NÃO tem conta utilizável — uma conta ativa não pode ser
 *    tomada por quem apenas conhece o e-mail (isso é "esqueci minha senha", e lá
 *    a senha antiga continua valendo até o fim da cerimônia);
 *  · o código erra → nada muda, e o código continua valendo para a próxima
 *    tentativa (errar de dedo não pode custar um novo e-mail);
 *  · o código certo é gasto na hora, mas senha e `verified` só se movem no
 *    último passo, juntos — cerimônia abandonada no meio não deixa ninguém
 *    verificado sem senha;
 *  · o setup token NÃO é um token de acesso. Ele é assinado com outro segredo
 *    justamente porque o AuthGuard confia em qualquer JWT feito com JWT_SECRET:
 *    se compartilhassem o segredo, o bilhete de "defina sua senha" abriria todo
 *    endpoint sem @Roles;
 *  · usar o mesmo bilhete duas vezes não sobrescreve a senha recém-escolhida;
 *  · um código de redefinição de senha não conclui um primeiro acesso (só esta
 *    cerimônia marca a conta como verificada).
 *
 * Sem banco e sem servidor: o AuthService é instanciado com dublês, que é o que
 * permite testar as regras sem subir a aplicação inteira.
 *
 * Rodar: pnpm test:first-access
 */
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/modules/common/auth/auth.service';
import { CONTRACT_STATUS, VERIFICATION_TYPE } from '../src/constants';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Captura a mensagem de erro de uma promise que DEVE falhar. */
async function rejects(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

type FakeUser = Record<string, any>;

interface Harness {
  auth: AuthService;
  users: Map<string, FakeUser>;
  emails: Array<{ to: string; code: string }>;
  smsMessages: Array<{ to: string; body: string }>;
  jwt: JwtService;
}

/**
 * Monta um AuthService com dublês. Só as dependências que o primeiro acesso
 * realmente usa têm comportamento; o resto existe para o construtor.
 */
function makeHarness(seed: FakeUser[]): Harness {
  const users = new Map<string, FakeUser>();
  for (const u of seed) users.set(u.id, { ...u });

  const emails: Array<{ to: string; code: string }> = [];
  const smsMessages: Array<{ to: string; body: string }> = [];

  const usersRepository: any = {
    findMany: async ({ where }: any) => {
      const conditions: Array<{ email?: string; phone?: string }> = where?.OR ?? [];
      const found = [...users.values()].find(u =>
        conditions.some(
          c =>
            (c.email !== undefined && c.email === u.email) ||
            (c.phone !== undefined && c.phone === u.phone),
        ),
      );
      if (!found) return { data: [] };
      // O client do Prisma OMITE `password` globalmente: só
      // findByIdWithCredentials devolve a coluna. O dublê tem que mentir do
      // mesmo jeito, senão o teste aprova um código que, em produção, lê
      // `password: undefined` e deixa uma conta ativa refazer a ativação.
      const { password: _omitido, sessionToken: _tambem, ...semCredenciais } = found;
      return { data: [semCredenciais] };
    },
    findByIdWithCredentials: async (id: string) => {
      const u = users.get(id);
      return u ? { ...u } : null;
    },
    update: async (id: string, data: Record<string, any>) => {
      const u = users.get(id)!;
      for (const [k, v] of Object.entries(data)) {
        // `undefined` é como o serviço diz "limpa este campo" ao Prisma.
        u[k] = v === undefined ? null : v;
      }
      return { ...u };
    },
  };

  const jwt = new JwtService({ secret: process.env.JWT_SECRET });

  const emailService: any = {
    createBaseEmailData: (userName: string) => ({ companyName: 'Ankaa', userName }),
    sendFirstAccessCode: async (to: string, data: any) => {
      emails.push({ to, code: data.accessCode });
      return { success: true, messageId: 'fake' };
    },
    // A cerimônia de redefinição aparece aqui só para provar que as duas não se
    // misturam — mas precisa entregar, senão o teste mede o fallback de SMS.
    sendPasswordResetCode: async (to: string, data: any) => {
      emails.push({ to, code: data.resetCode });
      return { success: true, messageId: 'fake' };
    },
  };

  const smsService: any = {
    sendSms: async (to: string, body: string) => {
      smsMessages.push({ to, body });
    },
  };

  const auth = new AuthService(
    usersRepository,
    {} as any, // sectorRepository
    {} as any, // sectorService
    { hash: async (p: string) => `hashed:${p}`, compare: async () => true } as any,
    jwt,
    { logChange: async () => undefined } as any,
    {} as any, // verificationService
    smsService,
    emailService,
    { refreshToken: { create: async () => ({}) } } as any, // prisma
  );

  return { auth, users, emails, smsMessages, jwt };
}

const NEW_HIRE: FakeUser = {
  id: 'user-1',
  name: 'Colaborador Novo',
  email: 'novo@ankaa.com',
  phone: '+5511999990001',
  password: null,
  verified: false,
  requirePasswordChange: false,
  verificationCode: null,
  verificationExpiresAt: null,
  verificationType: null,
  currentContractStatus: CONTRACT_STATUS.ACTIVE,
  sector: { id: 's1', name: 'Produção', privileges: 'BASIC' },
  ledSector: null,
};

const ACTIVE_USER: FakeUser = {
  ...NEW_HIRE,
  id: 'user-2',
  email: 'ativo@ankaa.com',
  phone: '+5511999990002',
  password: 'hashed:jaTenhoSenha',
  verified: true,
};

const DISMISSED_USER: FakeUser = {
  ...NEW_HIRE,
  id: 'user-3',
  email: 'demitido@ankaa.com',
  phone: '+5511999990003',
  currentContractStatus: CONTRACT_STATUS.TERMINATED,
};

// O runner transpila para CJS, onde `await` de topo não existe — por isso as
// verificações moram dentro de main().
async function main() {
  // ---------------------------------------------------------------------------
  console.log('\nPasso 1 — pedir o código');
  {
    const h = makeHarness([NEW_HIRE, ACTIVE_USER, DISMISSED_USER]);

    const desconhecido = await h.auth.requestFirstAccess('ninguem@ankaa.com');
    check('contato inexistente responde igual a um existente', desconhecido.success === true);
    check('e não envia nada', h.emails.length === 0);

    const ok = await h.auth.requestFirstAccess(NEW_HIRE.email);
    const user = h.users.get(NEW_HIRE.id)!;
    check('recém-cadastrado recebe o código', ok.success === true && h.emails.length === 1);
    check('código de 6 dígitos gravado', /^\d{6}$/.test(user.verificationCode ?? ''));
    check('e-mail leva exatamente esse código', h.emails[0].code === user.verificationCode);
    check(
      'marcado como FIRST_ACCESS, não como redefinição',
      user.verificationType === VERIFICATION_TYPE.FIRST_ACCESS,
    );
    check('senha e verified intocados neste passo', user.password === null && user.verified === false);

    const ativo = await rejects(h.auth.requestFirstAccess(ACTIVE_USER.email));
    check('conta já ativa é recusada com instrução', !!ativo?.includes('já está ativa'), ativo ?? '');

    const demitido = await rejects(h.auth.requestFirstAccess(DISMISSED_USER.email));
    check('conta inativa é recusada', !!demitido?.includes('inativa'), demitido ?? '');
  }

  // ---------------------------------------------------------------------------
  console.log('\nQuando o código não sai, ninguém avança de tela');
  {
    // Um cadastro sem e-mail nem telefone válidos não tem por onde receber.
    const semContato = {...NEW_HIRE, id: 'user-4', email: 'sem.canal@ankaa.com', phone: null};
    const h = makeHarness([semContato]);
    // Derruba o único canal possível.
    (h.auth as any).emailService = null;
    const erro = await rejects(
      (async () => {
        const original = (h.auth as any).sendFirstAccessEmail.bind(h.auth);
        (h.auth as any).sendFirstAccessEmail = async () => {
          throw new Error('SMTP fora do ar');
        };
        try {
          return await h.auth.requestFirstAccess(semContato.email);
        } finally {
          (h.auth as any).sendFirstAccessEmail = original;
        }
      })(),
    );
    check('falha de entrega vira erro, não 200 silencioso', !!erro?.includes('Não foi possível enviar'), erro ?? '');
  }

  // ---------------------------------------------------------------------------
  console.log('\nPasso 2 — validar o código');
  {
    const h = makeHarness([NEW_HIRE]);
    await h.auth.requestFirstAccess(NEW_HIRE.email);
    const codigo = h.users.get(NEW_HIRE.id)!.verificationCode as string;

    const errado = await rejects(h.auth.verifyFirstAccessCode(NEW_HIRE.email, '000000'));
    check('código errado é recusado', !!errado?.includes('inválido'), errado ?? '');
    check(
      'e o código válido sobrevive à tentativa errada',
      h.users.get(NEW_HIRE.id)!.verificationCode === codigo,
    );

    const semPedido = await rejects(h.auth.verifyFirstAccessCode('ninguem@ankaa.com', codigo));
    check('contato inexistente não vira oráculo de código', !!semPedido, semPedido ?? '');

    // Expira o código no relógio do registro, sem esperar 10 minutos.
    h.users.get(NEW_HIRE.id)!.verificationExpiresAt = new Date(Date.now() - 1000);
    const expirado = await rejects(h.auth.verifyFirstAccessCode(NEW_HIRE.email, codigo));
    check('código expirado é recusado', !!expirado?.includes('expirado'), expirado ?? '');

    h.users.get(NEW_HIRE.id)!.verificationExpiresAt = new Date(Date.now() + 60_000);
    const ok = await h.auth.verifyFirstAccessCode(NEW_HIRE.email, codigo);
    const user = h.users.get(NEW_HIRE.id)!;
    check('código certo devolve o setup token', typeof ok.data?.setupToken === 'string');
    check('código é gasto na hora', user.verificationCode === null);
    check(
      'mas a conta ainda não mudou (cerimônia abandonada não deixa rastro)',
      user.password === null && user.verified === false,
    );

    const reuso = await rejects(h.auth.verifyFirstAccessCode(NEW_HIRE.email, codigo));
    check('o mesmo código não vale duas vezes', !!reuso, reuso ?? '');
  }

  // ---------------------------------------------------------------------------
  console.log('\nPasso 3 — definir a senha e entrar');
  {
    const h = makeHarness([NEW_HIRE]);
    await h.auth.requestFirstAccess(NEW_HIRE.email);
    const codigo = h.users.get(NEW_HIRE.id)!.verificationCode as string;
    const { data } = await h.auth.verifyFirstAccessCode(NEW_HIRE.email, codigo);
    const setupToken = data.setupToken as string;

    const sessao = await h.auth.completeFirstAccess(setupToken, 'senhaNova123');
    const user = h.users.get(NEW_HIRE.id)!;
    check('senha gravada com hash', user.password === 'hashed:senhaNova123');
    check('conta ativada', user.verified === true);
    check('sem exigência de troca de senha logo na entrada', user.requirePasswordChange === false);
    check(
      'já devolve sessão pronta (token + refresh)',
      typeof sessao.data?.token === 'string' && typeof sessao.data?.refreshToken === 'string',
    );
    check(
      'o usuário devolvido descreve a conta DEPOIS da ativação',
      sessao.data?.user?.verified === true && sessao.data?.user?.requirePasswordChange === false,
    );

    const replay = await rejects(h.auth.completeFirstAccess(setupToken, 'outraSenha456'));
    check('o mesmo bilhete não troca a senha de novo', !!replay?.includes('já está ativa'), replay ?? '');
    check('e a senha escolhida continua de pé', h.users.get(NEW_HIRE.id)!.password === 'hashed:senhaNova123');
  }

  // ---------------------------------------------------------------------------
  console.log('\nO setup token não é um token de acesso');
  {
    const h = makeHarness([NEW_HIRE]);
    await h.auth.requestFirstAccess(NEW_HIRE.email);
    const codigo = h.users.get(NEW_HIRE.id)!.verificationCode as string;
    const { data } = await h.auth.verifyFirstAccessCode(NEW_HIRE.email, codigo);

    // É EXATAMENTE isto que o AuthGuard faz com o header Authorization.
    let aceitoComoAcesso = false;
    try {
      await h.jwt.verifyAsync(data.setupToken, { secret: process.env.JWT_SECRET });
      aceitoComoAcesso = true;
    } catch {
      aceitoComoAcesso = false;
    }
    check('o AuthGuard não aceitaria o setup token como bearer', !aceitoComoAcesso);

    // E o caminho inverso: um token de acesso comum não serve para definir senha.
    const acessoComum = await h.jwt.signAsync(
      { sub: NEW_HIRE.id },
      { secret: process.env.JWT_SECRET },
    );
    const recusado = await rejects(h.auth.completeFirstAccess(acessoComum, 'tentativa123'));
    check('token de acesso comum não define senha', !!recusado, recusado ?? '');

    // Assinado com o segredo certo, mas sem o propósito: também não.
    const semProposito = await h.jwt.signAsync(
      { sub: NEW_HIRE.id },
      { secret: `${process.env.JWT_SECRET}::first-access` },
    );
    const semPropositoErro = await rejects(h.auth.completeFirstAccess(semProposito, 'tentativa123'));
    check('sem purpose=FIRST_ACCESS o bilhete não vale', !!semPropositoErro, semPropositoErro ?? '');
  }

  // ---------------------------------------------------------------------------
  console.log('\nAs duas cerimônias não se misturam');
  {
    const h = makeHarness([NEW_HIRE]);
    await h.auth.requestPasswordReset(NEW_HIRE.email);
    const user = h.users.get(NEW_HIRE.id)!;
    check(
      'redefinição grava seu próprio tipo',
      user.verificationType === VERIFICATION_TYPE.PASSWORD_RESET,
    );

    const cruzado = await rejects(
      h.auth.verifyFirstAccessCode(NEW_HIRE.email, user.verificationCode as string),
    );
    check(
      'código de redefinição não conclui um primeiro acesso',
      !!cruzado?.includes('primeiro acesso'),
      cruzado ?? '',
    );
    check('e a conta segue não verificada', h.users.get(NEW_HIRE.id)!.verified === false);
  }

  console.log(
    failures === 0
      ? '\n✅ Todas as verificações passaram.\n'
      : `\n❌ ${failures} verificação(ões) falharam.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
