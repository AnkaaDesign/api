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

// `NestFactory`, e nao `Test.createTestingModule`: este repo NAO tem
// `@nestjs/testing` instalado (nem jest — os testes daqui sao scripts `tsx`).
// Montar a aplicacao de verdade prova mais, alias: e' o mesmo caminho de codigo
// que o `main.ts` percorre no boot de producao.
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'fs';
import { join } from 'path';

// Subir o `AppModule` inteiro acorda integracoes que, numa maquina de
// desenvolvimento, nao tem com quem falar: Baileys sem sessao de WhatsApp,
// Redis sem senha, certificado ICP sem a senha de producao. Elas reclamam de
// forma ASSINCRONA, fora de qualquer `await` deste arquivo, e uma rejeicao
// solta derruba o processo levando o resultado do teste junto.
//
// Silenciar aqui e' correto porque este teste nao afirma nada sobre elas — ele
// afirma que o GRAFO resolve e que as rotas existem. Uma falha de injecao
// aparece no `await NestFactory.create`, que esta dentro de um try/catch.
process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

let falhas = 0;
const check = (nome: string, ok: boolean, detalhe?: string) => {
  console.log(ok ? `  ✓ ${nome}` : `  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
};

async function main(): Promise<void> {
  console.log('\nO AppModule inteiro resolve com a guarda global do portal');

  const { AppModule } = await import('../src/app.module');

  // Monta a aplicacao INTEIRA. Uma guarda global arrasta a arvore de
  // dependencias dela no boot, entao se `ResponsibleAuthService`,
  // `AuthOtpDeliveryService` ou qualquer aresta abaixo nao resolver, isto
  // estoura aqui — que e' exatamente onde o `tsc` nao olha.
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  try {
    app = await NestFactory.create(AppModule, { logger: ['error'] });
    await app.init();
    check('o grafo de injecao resolve de ponta a ponta', true);
  } catch (error) {
    check('o grafo de injecao resolve de ponta a ponta', false, (error as Error).message);
    console.log(`\n✗ ${falhas} verificacao(oes) falharam\n`);
    process.exit(1);
  }

  // As QUATRO rotas do portal existem. Uma rota que suma do roteador nao quebra
  // o `tsc` — vira 404 em producao.
  const servidor = app.getHttpAdapter().getInstance();
  const rotas: string[] = [];
  for (const camada of servidor._router?.stack ?? []) {
    if (camada.route) {
      for (const metodo of Object.keys(camada.route.methods)) {
        rotas.push(`${metodo.toUpperCase()} ${camada.route.path}`);
      }
    }
  }
  for (const esperada of [
    'POST /cliente/auth/codigo',
    'POST /cliente/auth/entrar',
    'GET /cliente/auth/eu',
    'POST /cliente/auth/sair',
  ]) {
    check(`rota registrada: ${esperada}`, rotas.includes(esperada));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // A SUPERFICIE `/cliente/me/*` — o mesmo motivo, um degrau acima
  // ─────────────────────────────────────────────────────────────────────────
  //
  // Um controlador que compila e cujo MODULO nao esta em `app.module.ts` nao
  // existe em runtime: `pnpm build` passa, e a rota e' 404. Aconteceu com
  // `PortalRequestModule`, cujo proprio cabecalho registra a linha que faltava
  // na lista de `imports` do `AppModule`.
  //
  // Esta lista e' o contrato §4 mais o que o web ja chama. Cada entrada que
  // desaparecer daqui reprova antes de virar uma tela que degrada em silencio
  // para lista vazia.
  for (const esperada of [
    // Leitura (contrato §4)
    'GET /cliente/me/resumo',
    'GET /cliente/me/orcamentos',
    'GET /cliente/me/orcamentos/:id',
    'GET /cliente/me/veiculos',
    'GET /cliente/me/veiculos/:taskId',
    'GET /cliente/me/cobrancas',
    // A IDENTIFICACAO DO VEICULO — serie, placa, chassi, plaqueta e no do
    // pedido escritos pelo proprio cliente. Foi a ULTIMA rota do §4 a existir:
    // `web/src/api-client/portal.ts` -> `updateVehicleIdentity` ja a chamava e
    // recebia 404, porque o tipo, a tela e o cliente HTTP existiam e o
    // controller nao. E' o sintoma exato que esta lista pega: `tsc` compila um
    // controller cujo modulo nao esta no `AppModule`, e a ausencia so aparece
    // como 404 em producao.
    'PATCH /cliente/me/veiculos/:taskId/identificacao',
    // O PROJETO DO IMPLEMENTO (P13a) — o desenho do furgao, anexado pelo proprio
    // cliente. Mora no MESMO controller da identificacao; se o modulo sair do
    // `AppModule`, as duas somem juntas e esta lista acusa as duas.
    'POST /cliente/me/veiculos/:taskId/projeto',
    // A requisicao e as duas decisoes
    'POST /cliente/me/orcamentos',
    'PUT /cliente/me/orcamentos/:id/aprovar-valor',
    'PUT /cliente/me/orcamentos/:id/recusar',
    // A ARTE DO IMPLEMENTO (P13b) — o cliente aprova, reprova com motivo e
    // aprova em lote ("Aprovar para os N veiculos"). O modulo delas entra no
    // grafo por `PortalReadModule`, e nao por uma linha no `AppModule`: se o
    // import sair de la, as quatro somem juntas e esta lista acusa as quatro.
    'GET /cliente/me/artes',
    'PUT /cliente/me/artes/aprovar',
    'PUT /cliente/me/veiculos/:taskId/artes/:layoutId/aprovar',
    'PUT /cliente/me/veiculos/:taskId/artes/:layoutId/reprovar',
    // O pedido de compra
    'GET /cliente/me/pedidos',
    'POST /cliente/me/pedidos',
    // A assinatura por sessao — e o PDF DO RECORTE deste signatario, que a
    // rota publica do orcamento NAO substitui (ela serve o documento completo).
    'GET /cliente/me/assinaturas',
    'POST /cliente/me/assinaturas/:signerId/assinar',
    // A RECUSA, pelo mesmo canal do "sim". Sem ela o contato do cliente entra
    // no portal e so encontra ACEITAR — e a cerimonia publica tem as duas
    // (`POST /assinatura/publico/:token/recusar`). A assimetria nao se defende
    // num instrumento: o "nao" vira telefonema e some da trilha.
    'POST /cliente/me/assinaturas/:signerId/recusar',
    'GET /cliente/me/assinaturas/:signerId/documento.pdf',
    // Os catalogos do assistente de requisicao
    'GET /cliente/me/clientes',
    'GET /cliente/me/tintas',
    'GET /cliente/me/tipos-de-tinta',
    'POST /cliente/me/tintas',
  ]) {
    check(`rota registrada: ${esperada}`, rotas.includes(esperada));
  }

  // Fechar a aplicacao derruba Baileys e Redis junto, e numa maquina de
  // desenvolvimento (sem sessao de WhatsApp, sem senha de Redis) esses dois
  // rejeitam no desligamento. E' ruido de AMBIENTE, nao defeito do que se testa
  // aqui — e sem este try/catch ele mata o script antes das verificacoes que
  // faltam.
  try {
    await app.close();
  } catch {
    /* ruido de desligamento */
  }

  // As duas guardas globais estao DECLARADAS. Ler o container nao serve aqui:
  // com varios provedores sob o mesmo token `APP_GUARD`, `app.get()` devolve um
  // so, e a ausencia do outro seria indistinguivel de "o `get` escolheu o
  // primeiro". A declaracao e' o que importa, e ela esta no modulo.
  //
  // Uma so das duas significa que um dos dois sujeitos ficou sem quem o
  // autentique — e, se a que sobrar for a do portal, TODA rota de funcionario
  // passa a responder 401.
  const fonte = (caminho: string) => readFileSync(join(__dirname, '..', caminho), 'utf8');
  const moduloFuncionario = fonte('src/modules/common/auth/auth.module.ts');
  const moduloPortal = fonte('src/modules/people/responsible-auth/responsible-auth.module.ts');

  check(
    'AuthGuard esta declarada como guarda global',
    /APP_GUARD/.test(moduloFuncionario) && /AuthGuard/.test(moduloFuncionario),
  );
  check(
    'ResponsibleAuthGuard esta declarada como guarda global',
    /APP_GUARD/.test(moduloPortal) && /ResponsibleAuthGuard/.test(moduloPortal),
  );

  // E o controller do portal nao depende mais de `@UseGuards`: e' a marca que
  // guarda a rota. Um `@UseGuards` reaparecendo ali nao quebra nada, mas indica
  // que alguem voltou a achar que a marca sozinha nao basta — e a proxima rota
  // que essa pessoa escrever sem ele e' a que fica aberta.
  const controllerPortal = fonte(
    'src/modules/people/responsible-auth/responsible-auth.controller.ts',
  );
  check(
    'o controller do portal nao usa @UseGuards (a marca basta)',
    !/@UseGuards\(/.test(controllerPortal),
  );

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
