/**
 * O GRAFO DE INJECAO INTEIRO SOBE COM A GUARDA GLOBAL DO PORTAL.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * `ResponsibleAuthGuard` virou `APP_GUARD`. Uma guarda global e' instanciada
 * pelo Nest no boot e arrasta a arvore de dependencias dela inteira
 * (`ResponsibleAuthService` -> `PrismaService`, `ResponsibleAuthChallengeService`,
 * `AuthOtpDeliveryService` -> `WhatsAppCloudSender` + `EmailService`). Se
 * qualquer aresta dessa arvore nao resolver — provider faltando, ciclo entre
 * modulos, `forwardRef` esquecido —, o Nest NAO SOBE. E quando a API nao sobe,
 * nao e' o portal do cliente que cai: e' o login de todo mundo, funcionario
 * incluido.
 *
 * `tsc` nao ve nada disso. Injecao do Nest e' resolvida em tempo de execucao, no
 * boot, e o unico jeito de provar que funciona e' montar o grafo.
 *
 * Tambem confere o espelho das duas guardas globais: as duas precisam existir e
 * se dividir pelo MESMO metadado, senao alguma requisicao passa sem que nenhuma
 * decida.
 *
 * `npm run test:portal-cliente:boot`
 */
process.env.RESPONSIBLE_OTP_PEPPER =
  process.env.RESPONSIBLE_OTP_PEPPER || 'teste-de-boot-com-mais-de-32-caracteres-para-o-portal';

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';

let falhas = 0;
const check = (nome: string, ok: boolean, detalhe?: string) => {
  console.log(ok ? `  ✓ ${nome}` : `  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
};

async function main(): Promise<void> {
  console.log('\nO AppModule inteiro resolve com a guarda global do portal');

  const { AppModule } = await import('../src/app.module');
  const { ResponsibleAuthGuard } = await import(
    '../src/modules/people/responsible-auth/responsible-auth.guard'
  );
  const { AuthGuard } = await import('../src/modules/common/auth/auth.guard');

  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  try {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    check('o grafo de injecao resolve de ponta a ponta', true);
  } catch (error) {
    check('o grafo de injecao resolve de ponta a ponta', false, (error as Error).message);
    console.log(`\n✗ ${falhas} verificacao(oes) falharam\n`);
    process.exit(1);
  }

  // As duas guardas globais existem, e sao DUAS. Uma so significa que um dos
  // dois sujeitos ficou sem quem o autentique.
  const guardas = moduleRef.get<unknown[]>(APP_GUARD, { strict: false });
  const lista = Array.isArray(guardas) ? guardas : [guardas];
  const nomes = lista.map(g => (g as object)?.constructor?.name).filter(Boolean);

  check(
    'AuthGuard esta registrada como guarda global',
    nomes.includes('AuthGuard'),
    `encontradas: ${nomes.join(', ')}`,
  );
  check(
    'ResponsibleAuthGuard esta registrada como guarda global',
    nomes.includes('ResponsibleAuthGuard'),
    `encontradas: ${nomes.join(', ')}`,
  );

  // A guarda do portal resolve de verdade (nao e' um stub), e o servico de
  // sessao que ela usa tambem.
  const guardaPortal = moduleRef.get(ResponsibleAuthGuard, { strict: false });
  check('ResponsibleAuthGuard e instanciavel', Boolean(guardaPortal));
  check(
    'ResponsibleAuthGuard implementa canActivate',
    typeof (guardaPortal as { canActivate?: unknown })?.canActivate === 'function',
  );

  const guardaFuncionario = moduleRef.get(AuthGuard, { strict: false });
  check('AuthGuard continua instanciavel', Boolean(guardaFuncionario));

  // ───────────────────────────────────────────────────────────────────────────
  // O CENARIO CATASTROFICO
  //
  // A guarda do portal agora roda em TODA requisicao. Se ela recusar uma rota
  // que nao e' do portal — em vez de ceder —, toda rota de FUNCIONARIO passa a
  // responder 401. Nao e' o portal que cai: e' o sistema inteiro, e o sintoma
  // ("ninguem consegue usar nada") nao aponta para ca.
  //
  // O espelho tem de valer nos dois sentidos, e e' isto que se prova aqui.
  const contextoFalso = (marcado: boolean, req: Record<string, unknown> = {}) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ method: 'GET', headers: {}, ...req }) }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      getType: () => 'http',
      // O reflector real le metadado do handler/classe; aqui injetamos a
      // resposta dele direto, que e' a unica coisa que a guarda consulta.
      __marcado: marcado,
    }) as never;

  const reflectorFalso = {
    getAllAndOverride: (chave: string, alvos: unknown[]) => {
      void alvos;
      return chave === 'isResponsibleRoute' ? marcaAtual : undefined;
    },
    getAllAndMerge: () => [],
  };

  let marcaAtual = false;
  const { ResponsibleAuthGuard: Guarda } = await import(
    '../src/modules/people/responsible-auth/responsible-auth.guard'
  );
  const guardaIsolada = new Guarda(reflectorFalso as never, {
    resolveSession: async () => null,
    touchSession: async () => undefined,
  } as never);

  marcaAtual = false;
  let cedeuParaFuncionario = false;
  try {
    cedeuParaFuncionario = (await guardaIsolada.canActivate(contextoFalso(false))) === true;
  } catch (error) {
    cedeuParaFuncionario = false;
    check(
      'rota SEM a marca do portal: a guarda CEDE (nao recusa)',
      false,
      `lancou "${(error as Error).message}" — como guarda GLOBAL isso derruba TODA rota de funcionario`,
    );
  }
  if (cedeuParaFuncionario) {
    check('rota SEM a marca do portal: a guarda CEDE (nao recusa)', true);
  }

  marcaAtual = true;
  let recusouSemToken = false;
  try {
    await guardaIsolada.canActivate(contextoFalso(true));
  } catch {
    recusouSemToken = true;
  }
  check('rota COM a marca do portal e SEM token: a guarda RECUSA', recusouSemToken);

  marcaAtual = true;
  let recusouTokenInvalido = false;
  try {
    await guardaIsolada.canActivate(
      contextoFalso(true, { headers: { authorization: 'Bearer token-que-nao-existe' } }),
    );
  } catch {
    recusouTokenInvalido = true;
  }
  check(
    'rota COM a marca e token sem sessao no banco: a guarda RECUSA',
    recusouTokenInvalido,
  );

  await moduleRef.close();

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
