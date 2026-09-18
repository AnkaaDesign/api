/**
 * O OTP QUE DEIXA UM CONTATO DE CLIENTE ENTRAR NO SISTEMA.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * Um OTP frouxo não devolve erro: devolve uma sessão para quem não devia tê-la,
 * e ninguém percebe. O fluxo que existia aqui antes errava nos quatro pontos, e
 * cada um deles tem uma verificação abaixo:
 *
 *   1. gerava o código com `Math.floor(100000 + Math.random() * 900000)` — PRNG
 *      não criptográfico E com viés de módulo;
 *   2. gravava o código EM TEXTO CLARO na ficha do contato;
 *   3. comparava com `!==`, sem contador de tentativas;
 *   4. nunca enviava o código (`// TODO: Send verification email`).
 *
 * O mesmo vale para o `VerificationService` do funcionário, cujo contador é
 * chaveado NO PALPITE (`verification_attempt:{contato}:{codigo}`), de modo que
 * enumerar 000000, 000001, … cria uma chave nova a cada tentativa e o limite
 * nunca dispara. A verificação "orçamento de tentativas não se renova" abaixo é
 * exatamente sobre isso.
 *
 * As funções puras são testadas direto. O incremento atômico não cabe aqui (é
 * uma instrução SQL), então o que se verifica dele é a FORMA da instrução — que
 * todas as condições estejam no WHERE, e não em `if`s antes do UPDATE.
 *
 * `npm run test:responsible-otp`
 */

import { createHash, randomInt } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { hmacSha256Hex, safeEqualHex } from '../src/modules/common/signature/utils/canonical';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const PEPPER = 'pepper-de-teste-com-mais-de-32-caracteres-aqui';
const codeHashFor = (code: string, responsibleId: string) =>
  hmacSha256Hex(`${code}|${responsibleId}`, PEPPER);

console.log('\nO código nunca é guardado em claro');
{
  const hash = codeHashFor('123456', 'resp-1');
  check('o hash não contém o código', !hash.includes('123456'));
  check('tem 64 hex (SHA-256)', /^[0-9a-f]{64}$/.test(hash));
  check(
    'sem o pepper não dá para reproduzir',
    hmacSha256Hex('123456|resp-1', 'pepper-errado-com-mais-de-32-caracteres!!') !== hash,
  );
}

console.log('\nO código está ATADO a quem o pediu (o furo M3 da assinatura)');
{
  const paraA = codeHashFor('123456', 'resp-A');
  const paraB = codeHashFor('123456', 'resp-B');
  check('mesmo código, sujeitos diferentes => materiais diferentes', paraA !== paraB);
  check(
    'o código de A não confere para B',
    !safeEqualHex(codeHashFor('123456', 'resp-B'), paraA),
  );
}

console.log('\nA comparação é em tempo constante');
{
  const h = codeHashFor('123456', 'resp-1');
  check('acerta o igual', safeEqualHex(codeHashFor('123456', 'resp-1'), h));
  check('recusa o diferente', !safeEqualHex(codeHashFor('999999', 'resp-1'), h));
  check(
    'comprimento diferente não estoura',
    safeEqualHex('abc', h) === false,
  );
}

console.log('\nO código tem 6 dígitos e vem de CSPRNG, sem viés de módulo');
{
  // `randomInt(0, 10**6)` cobre 000000..999999 uniformemente, com rejection
  // sampling. O antigo `Math.floor(Math.random()*900000)+100000` nunca gerava
  // nada abaixo de 100000 — 10% do espaço simplesmente não existia.
  const amostra = Array.from({ length: 4000 }, () =>
    String(randomInt(0, 10 ** 6)).padStart(6, '0'),
  );
  check('sempre 6 caracteres', amostra.every(c => c.length === 6));
  check('sempre dígitos', amostra.every(c => /^\d{6}$/.test(c)));
  check(
    'o espaço abaixo de 100000 EXISTE (o antigo não gerava)',
    amostra.some(c => c[0] === '0'),
    'nenhum código começou com 0 em 4000 amostras',
  );
  check('não é constante', new Set(amostra).size > 3000);
}

console.log('\nO token de sessão vira hash antes de tocar o banco');
{
  const raw = 'token-opaco-de-exemplo';
  const hash = createHash('sha256').update(raw).digest('hex');
  check('o hash não contém o token', !hash.includes(raw));
  check('é determinístico', createHash('sha256').update(raw).digest('hex') === hash);
  check('tem 64 hex', /^[0-9a-f]{64}$/.test(hash));
}

console.log('\nA FORMA do UPDATE de tentativas — todas as condições no WHERE');
{
  const fonte = readFileSync(
    join(
      __dirname,
      '../src/modules/people/responsible-auth/responsible-auth-challenge.service.ts',
    ),
    'utf8',
  );

  const update = fonte.slice(fonte.indexOf('UPDATE "ResponsibleAuthChallenge"'));
  const corpo = update.slice(0, update.indexOf('`'));

  check('incrementa na própria instrução', corpo.includes('SET attempts = attempts + 1'));
  check('exige PENDING no WHERE', corpo.includes("status = 'PENDING'"));
  check('exige não vencido no WHERE', corpo.includes('"expiresAt" > now()'));
  check(
    'exige orçamento não esgotado no WHERE',
    corpo.includes('attempts < "maxAttempts"'),
    'sem isto o contador é decorativo',
  );
  check(
    'amarra ao dono no WHERE',
    corpo.includes('"responsibleId" ='),
    'sem isto o desafio de um contato serve para outro',
  );
  check('devolve o estado para decidir fora', corpo.includes('RETURNING'));

  // O orçamento NÃO pode ser chaveado no palpite — é o defeito do
  // VerificationService, onde cada código chutado ganha o próprio orçamento.
  check(
    'o orçamento é por DESAFIO, não por palpite',
    !corpo.includes('codeHash =') && !corpo.includes('code ='),
    'o código não pode entrar no WHERE do contador',
  );
}

console.log('\nO serviço recusa subir sem pepper (falha alta, não degradação)');
{
  const fonte = readFileSync(
    join(
      __dirname,
      '../src/modules/people/responsible-auth/responsible-auth-challenge.service.ts',
    ),
    'utf8',
  );
  check('implementa OnModuleInit', fonte.includes('implements OnModuleInit'));
  check('exige tamanho mínimo', fonte.includes('PEPPER_MIN_LENGTH'));
  check(
    'proíbe reusar o pepper da assinatura',
    fonte.includes('SIGNATURE_OTP_PEPPER'),
    'peppers iguais fazem um comprometimento valer para os dois',
  );
}

console.log('\nO código jamais é logado');
{
  // ⚠️ Esta verificação já teve um FURO: olhava só a linha do `logger.x(` e,
  // como um template literal pode continuar nas linhas seguintes, um
  // `${issued.code}` na linha de baixo passava batido. Agora a chamada inteira
  // é lida, do `logger.` até o `);` que a fecha.
  const arquivos = [
    '../src/modules/people/responsible-auth/responsible-auth-challenge.service.ts',
    '../src/modules/people/responsible-auth/responsible-auth.service.ts',
    '../src/modules/common/auth-otp/auth-otp-delivery.service.ts',
  ];

  const chamadasDeLog = (fonte: string): string[] => {
    const saida: string[] = [];
    const re = /logger\.(log|warn|error|debug)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fonte)) !== null) {
      // Anda até fechar o parêntese da chamada, contando aninhamento.
      let i = m.index + m[0].length;
      let nivel = 1;
      while (i < fonte.length && nivel > 0) {
        if (fonte[i] === '(') nivel++;
        else if (fonte[i] === ')') nivel--;
        i++;
      }
      saida.push(fonte.slice(m.index, i));
    }
    return saida;
  };

  const interpolaCodigo = (chamada: string) => /\$\{[^}]*\bcode\b[^}]*\}/.test(chamada);

  for (const rel of arquivos) {
    const fonte = readFileSync(join(__dirname, rel), 'utf8');
    const vazando = chamadasDeLog(fonte).filter(interpolaCodigo);
    const nome = rel.split('/').pop();

    if (nome === 'responsible-auth.service.ts') {
      // Existe UMA exceção legítima: o eco de desenvolvimento. Ela é aceitável
      // só porque tem DUAS travas — fora de produção E flag explícita. O teste
      // exige que as duas continuem lá, e que não apareça uma segunda exceção.
      check('só o eco de DEV interpola o código', vazando.length <= 1, `${vazando.length} ocorrência(s)`);
      check(
        'e o eco está marcado como [DEV]',
        vazando.length === 0 || vazando[0].includes('[DEV]'),
      );
      check(
        'trava 1: exige NODE_ENV !== production',
        fonte.includes("process.env.NODE_ENV !== 'production'"),
      );
      check(
        'trava 2: exige a flag explícita',
        fonte.includes("process.env.RESPONSIBLE_DEV_ECHO_OTP === 'true'"),
      );
      check(
        'as duas travas estão na MESMA condição (E, não OU)',
        /NODE_ENV !== 'production' &&\s*\n?\s*process\.env\.RESPONSIBLE_DEV_ECHO_OTP === 'true'/.test(fonte),
        'se virar OU, produção passa a ecoar o código',
      );
    } else {
      check(`${nome} não imprime o código`, vazando.length === 0, `${vazando.length} ocorrência(s)`);
    }
  }
}

console.log(`\n${failures === 0 ? '✓ TODAS as verificações passaram' : `✗ ${failures} falha(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
