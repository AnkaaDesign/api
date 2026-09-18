/**
 * O LOGIN DO PORTAL DO CLIENTE, CONTRA BANCO DE VERDADE.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * `responsible-auth-otp.test.ts` prova a criptografia e a FORMA do SQL sem tocar
 * o banco. Isto aqui prova o que só o banco pode dizer: que o incremento de
 * tentativas realmente acontece, que o uso único realmente trava, que a
 * revogação realmente vale na requisição seguinte, e que um contato inexistente
 * é indistinguível de um existente.
 *
 * O único ponto substituído é a ENTREGA — um espião captura o código em vez de
 * enviá-lo. Mandar WhatsApp de teste para o telefone de um cliente real seria
 * inaceitável, e é justamente por isso que a entrega é um serviço separado do
 * desafio: dá para trocar um sem tocar no outro.
 *
 * Cria e apaga o próprio contato de teste. NÃO toca em nenhum cadastro existente.
 *
 * `npm run test:portal-cliente:db`
 */

import { PrismaService } from '../src/modules/common/prisma/prisma.service';
import { ResponsibleAuthChallengeService } from '../src/modules/people/responsible-auth/responsible-auth-challenge.service';
import { ResponsibleAuthService } from '../src/modules/people/responsible-auth/responsible-auth.service';

// O eco de DEV faz `requestCode` retornar ANTES de chamar a entrega — util para
// testar a tela a mao, inutil aqui. Este teste exercita o caminho de PRODUCAO,
// com o espiao no lugar do transporte, entao desliga o eco para si mesmo.
// (Descoberto do jeito dificil: com o eco ligado, o espiao nunca era chamado e o
// teste falhava com "codigo invalido", que e' exatamente o que deveria acontecer.)
process.env.RESPONSIBLE_DEV_ECHO_OTP = 'false';

let falhas = 0;
const check = (nome: string, ok: boolean, detalhe?: string) => {
  console.log(ok ? `  ✓ ${nome}` : `  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
};

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const challenges = new ResponsibleAuthChallengeService(prisma as any);
  challenges.onModuleInit();

  // Espiao de entrega: captura o codigo em vez de enviar.
  let ultimoCodigo = '';
  const delivery: any = {
    whatsappAvailable: true,
    deliverVia: async () => ({ ok: true }),
    deliver: async (_t: any, code: string) => {
      ultimoCodigo = code;
      return { ok: true, channel: 'EMAIL', destinationMask: 'te****@ex.com', providerMessageId: 'spy-1' };
    },
  };

  const auth = new ResponsibleAuthService(prisma as any, challenges, delivery);

  // Cria um contato de teste isolado.
  const marca = `e2e-${Date.now()}`;
  const alvo = await prisma.responsible.create({
    data: {
      name: 'Contato E2E',
      email: `${marca}@exemplo.test`,
      phone: `4899${String(Date.now()).slice(-7)}`,
      roles: ['FINANCIAL'],
      isActive: true,
    },
    select: { id: true, email: true, phone: true },
  });

  try {
    console.log('\nPasso 1 — pedir o codigo');
    const pedido = await auth.requestCode({ contact: alvo.email!, ipAddress: '10.0.0.1', userAgent: 'e2e' });
    check('devolve challengeId', !!pedido.challengeId);
    check('devolve destino mascarado', !!pedido.destinationMask);
    check('o codigo saiu pelo canal (espiao capturou)', /^\d{6}$/.test(ultimoCodigo));

    const gravado = await prisma.responsibleAuthChallenge.findUnique({
      where: { id: pedido.challengeId }, select: { codeHash: true, status: true },
    });
    check('o desafio foi gravado', !!gravado);
    check('o banco NAO guarda o codigo em claro', gravado!.codeHash !== ultimoCodigo && !gravado!.codeHash.includes(ultimoCodigo));

    console.log('\nCodigo errado nao entra, e consome tentativa');
    try {
      await auth.verifyCode({ contact: alvo.email!, challengeId: pedido.challengeId, code: '000000' });
      check('recusa codigo errado', false, 'deixou entrar!');
    } catch (e: any) {
      check('recusa codigo errado', true);
      check('informa tentativas restantes', /tentativa/i.test(e.message), e.message);
    }

    console.log('\nPasso 2 — o codigo certo abre a sessao');
    const sessao = await auth.verifyCode({ contact: alvo.email!, challengeId: pedido.challengeId, code: ultimoCodigo, ipAddress: '10.0.0.1', userAgent: 'e2e' });
    check('devolve token', !!sessao.token && sessao.token.length >= 40);
    check('identifica a pessoa', sessao.responsible.id === alvo.id);
    check('carrega os papeis', sessao.responsible.roles.includes('FINANCIAL' as any));

    const guardado = await prisma.responsibleSession.findFirst({
      where: { responsibleId: alvo.id }, select: { tokenHash: true },
    });
    check('o banco NAO guarda o token em claro', guardado!.tokenHash !== sessao.token);

    console.log('\nO mesmo codigo nao serve duas vezes (uso unico)');
    try {
      await auth.verifyCode({ contact: alvo.email!, challengeId: pedido.challengeId, code: ultimoCodigo });
      check('recusa reuso', false, 'aceitou o mesmo codigo de novo!');
    } catch { check('recusa reuso', true); }

    console.log('\nA sessao resolve, e a revogacao vale na hora');
    const resolvida = await auth.resolveSession(sessao.token);
    check('resolve o portador', resolvida?.responsible.id === alvo.id);
    await auth.logout(sessao.token);
    check('apos sair, nao resolve mais', (await auth.resolveSession(sessao.token)) === null);

    console.log('\nA sessao DESLIZA com o uso, ate o teto absoluto');
    {
      await prisma.responsibleAuthChallenge.deleteMany({ where: { responsibleId: alvo.id } });
      const pd = await auth.requestCode({ contact: alvo.email! });
      const sd = await auth.verifyCode({ contact: alvo.email!, challengeId: pd.challengeId, code: ultimoCodigo });

      const antes = await prisma.responsibleSession.findFirst({
        where: { responsibleId: alvo.id }, orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, expiresAt: true },
      });

      // Finge que o ultimo uso foi ha muito tempo, para passar do throttle de 1h,
      // e que a sessao esta perto de vencer.
      const velho = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await prisma.responsibleSession.update({
        where: { id: antes!.id },
        data: { lastSeenAt: velho, expiresAt: new Date(Date.now() + 60 * 1000) },
      });

      const r = await auth.resolveSession(sd.token);
      check('sessao proxima do vencimento ainda resolve', r !== null);

      await auth.touchSession(antes!.id, null, { createdAt: antes!.createdAt, lastSeenAt: velho });

      const depois = await prisma.responsibleSession.findUnique({
        where: { id: antes!.id }, select: { expiresAt: true },
      });
      const ganhoDias = (depois!.expiresAt.getTime() - Date.now()) / 86400000;
      check('o uso EMPURROU o vencimento para longe', ganhoDias > 50, `ganhou ${ganhoDias.toFixed(1)} dias`);

      // O throttle: usar de novo em seguida NAO deve escrever.
      const marca = depois!.expiresAt.getTime();
      await auth.touchSession(antes!.id, null, { createdAt: antes!.createdAt, lastSeenAt: new Date() });
      const terceiro = await prisma.responsibleSession.findUnique({
        where: { id: antes!.id }, select: { expiresAt: true },
      });
      check('uso logo em seguida NAO gera escrita (throttle de 1h)', terceiro!.expiresAt.getTime() === marca);

      // O teto: uma sessao nascida ha 179 dias so pode ser empurrada ate 180.
      const quaseNoTeto = new Date(Date.now() - 179 * 24 * 60 * 60 * 1000);
      await auth.touchSession(antes!.id, null, { createdAt: quaseNoTeto, lastSeenAt: velho });
      const noTeto = await prisma.responsibleSession.findUnique({
        where: { id: antes!.id }, select: { expiresAt: true },
      });
      const restaDias = (noTeto!.expiresAt.getTime() - Date.now()) / 86400000;
      check(
        'o TETO ABSOLUTO limita o empurrao',
        restaDias > 0 && restaDias < 2,
        `restaram ${restaDias.toFixed(2)} dias (esperado ~1)`,
      );

      // E passado o teto, nao resolve mais, por mais recente que seja o uso.
      await prisma.responsibleSession.update({
        where: { id: antes!.id },
        data: {
          createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          lastSeenAt: new Date(),
        },
      });
      check(
        'passado o teto, a sessao morre mesmo em uso ativo',
        (await auth.resolveSession(sd.token)) === null,
      );

      await auth.logout(sd.token);
    }

    console.log('\nContato inexistente responde IGUAL (anti-enumeracao)');
    const fantasma = await auth.requestCode({ contact: 'nao-existe-nenhum@exemplo.test' });
    check('devolve challengeId de enfeite', !!fantasma.challengeId);
    check('devolve mascara', !!fantasma.destinationMask);
    check('mesma forma de resposta', Object.keys(fantasma).sort().join(',') === Object.keys(pedido).sort().join(','));

    console.log('\nO cooldown de reenvio barra o pedido imediato');
    let barrou = false;
    try {
      await auth.requestCode({ contact: alvo.email! });
    } catch (e: any) {
      barrou = /Aguarde/i.test(e.message);
    }
    check('pedir outro codigo em seguida e recusado', barrou);

    console.log('\nDesativar o cadastro derruba a sessao VIVA na hora');
    // Limpa os desafios para o cooldown nao mascarar o que se quer testar aqui
    // (que e' a desativacao, nao o reenvio). Equivale a "passaram-se 2 minutos".
    await prisma.responsibleAuthChallenge.deleteMany({ where: { responsibleId: alvo.id } });

    // Abre uma sessao NOVA (a anterior foi revogada no logout) e so depois
    // desativa: e' isto que prova que a guarda rele o cadastro a cada
    // requisicao, em vez de confiar no que valia no momento do login.
    const p2 = await auth.requestCode({ contact: alvo.email! });
    const viva = await auth.verifyCode({ contact: alvo.email!, challengeId: p2.challengeId, code: ultimoCodigo });
    check('a sessao nova resolve', (await auth.resolveSession(viva.token)) !== null);

    await prisma.responsible.update({ where: { id: alvo.id }, data: { isActive: false } });
    check(
      'apos desativar, a MESMA sessao deixa de resolver',
      (await auth.resolveSession(viva.token)) === null,
      'a sessao sobreviveu a desativacao do cadastro',
    );
  } finally {
    await prisma.responsibleAuthChallenge.deleteMany({ where: { responsibleId: alvo.id } });
    await prisma.responsibleSession.deleteMany({ where: { responsibleId: alvo.id } });
    await prisma.responsible.delete({ where: { id: alvo.id } });
    await prisma.$disconnect();
  }

  console.log(`\n${falhas === 0 ? '✓ TODAS as verificacoes passaram' : `✗ ${falhas} falha(s)`}\n`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch(e => { console.error('ERRO:', e); process.exit(1); });
