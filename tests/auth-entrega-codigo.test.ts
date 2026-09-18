/**
 * QUANDO NENHUM CANAL ENTREGA, A RESPOSTA NAO PODE DIZER QUE DEU CERTO.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * `requestPasswordReset` devolvia `{ success: true, message: 'Erro ao enviar
 * codigo...' }` — um contrato que se contradiz dentro da mesma resposta. O
 * cliente ramifica por `success`, entao ele AVANCAVA para a tela de digitar o
 * codigo e a pessoa ficava esperando um codigo que nunca saiu. O primeiro
 * acesso, irmao deste fluxo e no mesmo arquivo, ja lancava
 * `ServiceUnavailableException` e explicava por que no comentario. Os dois
 * discordavam.
 *
 * POR QUE ISTO VIROU URGENTE
 * A Twilio saiu do codigo em 18/09 e a perna do TELEFONE do OTP virou WhatsApp
 * oficial. Antes, quem nao tinha e-mail ainda recebia SMS. Agora, quem nao tem
 * WhatsApp naquele numero E nao tem e-mail no cadastro cai exatamente neste
 * ramo — que era o ramo que mentia.
 *
 * POR QUE O TESTE E' ESTRUTURAL
 * Exercitar o ramo de verdade exigiria um `User` de teste com setor, cargo e
 * contrato (o cadastro de funcionario tem dependencia dura em varios modelos) e
 * um canal de entrega quebrado de proposito. O repo ja resolve esta classe de
 * assercao lendo o FONTE — `responsible-auth-otp.test.ts` prova assim a forma
 * do SQL e que o codigo nunca e' logado. Aqui vale o mesmo: o que se afirma e'
 * uma propriedade do TEXTO do ramo terminal, e ela e' verificavel sem banco.
 *
 * `npm run test:auth-entrega`
 */
import { readFileSync } from 'fs';
import { join } from 'path';

let falhas = 0;
const check = (nome: string, ok: boolean, detalhe?: string) => {
  console.log(ok ? `  ✓ ${nome}` : `  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
};

const fonte = readFileSync(
  join(__dirname, '..', 'src', 'modules', 'common', 'auth', 'auth.service.ts'),
  'utf8',
);

/**
 * Recorta o trecho que vai de uma chamada a `dispatchCode` ate o fim do
 * encadeamento de respostas — que e' onde mora a decisao "o que eu devolvo
 * quando nada foi entregue".
 */
function ramoDeEntrega(marcador: string): string {
  const inicio = fonte.indexOf(marcador);
  if (inicio === -1) throw new Error(`Marcador nao encontrado no fonte: ${marcador}`);
  // Ate o fechamento do metodo: a primeira linha que fecha no nivel do metodo.
  const resto = fonte.slice(inicio);
  const fim = resto.indexOf('\n  }\n');
  return resto.slice(0, fim === -1 ? 4000 : fim);
}

function main(): void {
  console.log('\nOs dois fluxos de codigo do FUNCIONARIO tratam falha total igual');

  const recuperacao = ramoDeEntrega("purpose: 'password reset'");
  const primeiroAcesso = ramoDeEntrega("purpose: 'first access'");

  for (const [nome, trecho] of [
    ['recuperação de senha', recuperacao],
    ['primeiro acesso', primeiroAcesso],
  ] as const) {
    check(
      `${nome}: o ramo terminal LANÇA em vez de responder`,
      /throw new ServiceUnavailableException/.test(trecho),
      'nenhum `throw new ServiceUnavailableException` no trecho',
    );
    check(
      `${nome}: nenhum \`success: true\` acompanhado de mensagem de erro`,
      !/success:\s*true,\s*\n\s*message:\s*['"`][^'"`]*[Ee]rro/.test(trecho),
      'ainda existe um `success: true` com mensagem de erro',
    );
  }

  console.log('\nA perna do TELEFONE nao e mais SMS');
  check(
    'nenhuma referência viva a `SmsService` no serviço de autenticação',
    !/\bthis\.smsService\b|private readonly smsService/.test(fonte),
  );
  check(
    'a perna do telefone chama o serviço de entrega de OTP',
    /this\.authOtp\.deliverVia\(\s*'WHATSAPP'/.test(fonte),
  );
  check(
    'o módulo `sms` foi removido da árvore',
    (() => {
      try {
        readFileSync(join(__dirname, '..', 'src', 'modules', 'common', 'sms', 'sms.service.ts'));
        return false;
      } catch {
        return true;
      }
    })(),
  );

  console.log('\nO CÓDIGO nunca entra no log do caminho de falha');
  // O `VerificationService` do funcionario imprime o codigo esperado ate em
  // `warn` — e' um dos quatro defeitos que o desqualificam para autenticacao.
  // O caminho novo nao pode repetir isso.
  const logsDeFalha = fonte.match(/this\.logger\.(error|warn)\([^)]*\)/g) ?? [];
  check(
    'nenhum log de erro interpola a variável do código',
    !logsDeFalha.some(l => /\$\{code\}|\$\{resetCode\}|\$\{accessCode\}/.test(l)),
    logsDeFalha.filter(l => /\$\{code\}|\$\{resetCode\}|\$\{accessCode\}/.test(l)).join(' | '),
  );

  console.log(
    falhas === 0
      ? '\n✓ TODAS as verificacoes passaram\n'
      : `\n✗ ${falhas} verificacao(oes) falharam\n`,
  );
  process.exit(falhas === 0 ? 0 : 1);
}

main();
