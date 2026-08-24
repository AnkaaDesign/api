/**
 * O cargo que o envelope publica cabe no que o próprio envio aceita.
 *
 * `registryCargo` não é digitado por ninguém: o envelope o monta com
 * `formatResponsibleRoles(Responsible.roles)`, que junta TODAS as funções do
 * contato com ", ". Um responsável com as nove funções do cadastro rende 113
 * caracteres, e `signatureRequestCodeSchema` recusa acima de 100 — a api
 * devolvia ao cliente um valor que ela mesma rejeitaria na requisição
 * seguinte. O signatário via "Dados do corpo da requisição inválidos" numa
 * tela onde não havia UM campo digitado por ele para corrigir.
 *
 * O corte tem de cair numa fronteira de função: este texto entra na declaração
 * de poderes de representação que o signatário aceita, e "…Gestor de Frota,
 * Motor" não é um cargo que alguém possa declarar.
 *
 * Rodar: pnpm tsx tests/signature-cargo.test.ts
 */

import { fitCargo } from '../src/modules/common/signature/utils/identity';
import { SIGNATURE_CARGO_MAX_LENGTH, signatureRequestCodeSchema } from '../src/schemas/signature';
import { formatResponsibleRoles, RESPONSIBLE_ROLE } from '../src/constants/enums';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const ALL_ROLES = Object.values(RESPONSIBLE_ROLE);

// ---------------------------------------------------------------------------
console.log('\nContato com todas as funções do cadastro');
{
  const joined = formatResponsibleRoles(ALL_ROLES);
  check(
    'o valor cru passa do teto (é o bug)',
    joined.length > SIGNATURE_CARGO_MAX_LENGTH,
    `${joined.length} caracteres`,
  );

  const fitted = fitCargo(joined);
  check('o valor publicado cabe', fitted.length <= SIGNATURE_CARGO_MAX_LENGTH, fitted);
  check('não corta no meio de uma função', joined.slice(fitted.length).startsWith(','), fitted);
  check('não termina em vírgula', !fitted.endsWith(','), fitted);

  // O que fecha o ciclo: o cargo publicado tem de sobreviver ao schema que o
  // cliente vai atravessar ao devolvê-lo.
  const parsed = signatureRequestCodeSchema.safeParse({
    cpf: '11144477735',
    cargo: fitted,
    contactConfirm: '9140',
  });
  check('o envio com esse cargo é aceito', parsed.success, JSON.stringify(parsed.error?.issues));

  const rejected = signatureRequestCodeSchema.safeParse({
    cpf: '11144477735',
    cargo: joined,
    contactConfirm: '9140',
  });
  check('e o valor cru seria recusado', !rejected.success);
}

// ---------------------------------------------------------------------------
console.log('\nCasos que não devem mudar');
{
  check('cargo curto passa intacto', fitCargo('Gestor de Frota') === 'Gestor de Frota');
  check('espaços das pontas somem', fitCargo('  Motorista  ') === 'Motorista');
  check('vazio continua vazio', fitCargo(null) === '');
  // Sem vírgula nenhuma, cai no último espaço em vez de partir a palavra.
  const long = 'Coordenador '.repeat(20).trim();
  const cut = fitCargo(long);
  check('sem vírgula, corta no espaço', cut.endsWith('Coordenador'), cut);
  check('e ainda cabe', cut.length <= SIGNATURE_CARGO_MAX_LENGTH, `${cut.length}`);
}

console.log(
  failures === 0 ? '\n✅ Todas as verificações passaram.\n' : `\n❌ ${failures} verificação(ões) falharam.\n`,
);
process.exit(failures === 0 ? 0 : 1);
