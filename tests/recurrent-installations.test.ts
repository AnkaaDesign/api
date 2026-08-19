/**
 * Guarda do roteamento de débitos para INSTALAÇÕES faturadas e do portão de
 * identidade do credor nas contas recorrentes.
 *
 * O caso que originou este arquivo: o extrato de 2026-08 mostrava três débitos
 * "DEBITO CONVENIOS-SAMAEIB" no mesmo dia, um por matrícula do SAMAE, e apenas UM
 * aparecia como "Aguardando nota" — os outros dois ficavam em "Sem vínculo". A
 * conta recorrente materializava UMA ocorrência por competência, então só o
 * primeiro débito do mês encontrava obrigação; os demais fechavam pela categoria.
 * O mesmo acontecia com as três UCs da COPEL, todo mês.
 *
 * Duas regras nascem daí, e as duas são fáceis de quebrar por descuido:
 *
 *  1. O código da instalação é comparado como TOKEN INTEIRO, em dígitos e sem
 *     zeros à esquerda. Nunca como substring — o memo carrega o CNPJ do credor ao
 *     lado do código, e uma busca por substring casaria "113942" dentro de
 *     qualquer número maior, roteando o débito para a instalação errada. Um
 *     vínculo errado é pior que nenhum: pinta a linha de verde enquanto a
 *     obrigação real daquele hidrômetro segue aberta e invisível.
 *
 *  2. O credor do débito precisa ser o credor da conta — por documento OU por
 *     nome. Antes o sweep escolhia candidatos só por CATEGORIA, e uma categoria
 *     costuma ter vários credores ("Aluguel" tem dois proprietários, "Energia
 *     Elétrica" tem COPEL e a cooperativa), então a primeira conta do laço
 *     absorvia o débito que ordenasse primeiro. Foi assim que a ocorrência de
 *     "Aluguel - Marcos Antonio Pelisson" foi liquidada com o PIX do Sandro.
 *     O nome é aceito porque o documento cadastrado às vezes é simplesmente o
 *     errado — "Diária - Limpeza" guarda o CNPJ da própria Ankaa no lugar do CPF
 *     da diarista, e um portão só-por-documento cortaria 7 meses de conciliação
 *     correta.
 *
 * Rodar: pnpm tsx tests/recurrent-installations.test.ts
 */

import {
  RecurrentPayableService,
  codeKey,
  textHasInstallationCode,
} from '../src/modules/financial/recurrent-payable/recurrent-payable.service';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// O portão de identidade é puro (não toca no banco), então uma instância nua
// basta — é a mesma função que o sweep chama.
const svc = new RecurrentPayableService(null as never, null as never);
const identityMatches = (
  payable: { payeeCnpj?: string | null; payeeCpf?: string | null; payeeName?: string | null; name?: string },
  cnpj: string | null,
  name?: string | null,
): boolean =>
  (svc as unknown as {
    identityMatches: (p: unknown, c: string | null, n?: string | null) => boolean;
  }).identityMatches({ payeeCnpj: null, payeeCpf: null, payeeName: null, name: '', ...payable }, cnpj, name);

// Memos reais do extrato do Sicredi.
const SAMAE_MATRIZ = 'DEBITO CONVENIOS-SAMAEIB   ID 00113942 SAMAE IBIPORA 78079639000100';
const SAMAE_GALPAO = 'DEBITO CONVENIOS-SAMAEIB   ID 00257657 SAMAE IBIPORA 78079639000100';
const COPEL_UC = 'DEBITO CONVENIOS-COPEL     ID 0000107981068 COPEL DISTRIBUICAO 04368898000106';

console.log('\ncodeKey — forma canônica do código');
{
  check('dígitos apenas', codeKey('ID-00113942') === '113942');
  check('zeros à esquerda somem', codeKey('00113942') === codeKey('113942'));
  check('vazio quando não há dígito', codeKey('MATRIZ') === '');
  check('null é vazio', codeKey(null) === '');
}

console.log('\ntextHasInstallationCode — casamento por token, nunca por substring');
{
  check('acha a matrícula no memo', textHasInstallationCode(SAMAE_MATRIZ, '00113942'));
  check('acha com zeros a menos no cadastro', textHasInstallationCode(SAMAE_MATRIZ, '113942'));
  check('acha a UC longa da COPEL', textHasInstallationCode(COPEL_UC, '0000107981068'));

  check(
    'NÃO casa a matrícula de outro hidrômetro',
    !textHasInstallationCode(SAMAE_MATRIZ, '00257657'),
  );
  check(
    'NÃO casa um pedaço do CNPJ do credor',
    // "790" existe dentro de 78079639000100; como token inteiro, não.
    !textHasInstallationCode(SAMAE_GALPAO, '790'),
  );
  check(
    'NÃO casa prefixo de um código maior',
    // 0000107981068 contém "10798"; substring casaria, token não.
    !textHasInstallationCode(COPEL_UC, '10798'),
  );
  check(
    'NÃO casa sufixo de um código maior',
    !textHasInstallationCode(COPEL_UC, '981068'),
  );
  check('código sem dígitos nunca casa', !textHasInstallationCode(SAMAE_MATRIZ, 'MATRIZ'));
  check('memo vazio nunca casa', !textHasInstallationCode(null, '00113942'));
}

console.log('\nidentityMatches — o débito foi pago ao credor da conta?');
{
  check(
    'CPF confere',
    identityMatches({ payeeCpf: '33034206968' }, '33034206968', 'MARCOS ANTONIO PELISSON'),
  );
  check(
    'CNPJ confere mesmo formatado no cadastro',
    identityMatches({ payeeCnpj: '78.079.639/0001-00' }, '78079639000100', 'SAMAE IBIPORA'),
  );

  check(
    'REJEITA o PIX do outro proprietário (Marcos × Sandro)',
    !identityMatches(
      { payeeCpf: '33034206968', payeeName: 'MARCOS ANTONIO PELISSON' },
      '70564949949',
      'PAGAMENTO PIX-PIX_DEB SANDRO FURLAN BOCHI',
    ),
  );
  check(
    'REJEITA débito da Telefônica numa conta da Claro',
    !identityMatches(
      { payeeCnpj: '40432544000147', payeeName: 'CLARO S/A' },
      '02558157000162',
      'PAGAMENTO PIX-PIX_DEB TELEFONICA BRASIL S A',
    ),
  );
  check(
    'REJEITA débito da COPEL numa conta da cooperativa',
    !identityMatches(
      { payeeCnpj: '35710362000150', payeeName: 'Monte Sião Coop. de Energia' },
      '04368898000106',
      'DEBITO CONVENIOS-COPEL ID COPEL DISTRIBUICAO',
    ),
  );

  // O nome resgata a conta cujo documento cadastrado está errado.
  check(
    'ACEITA por nome quando o documento cadastrado é o errado (Diária - Limpeza)',
    identityMatches(
      { payeeCnpj: '13636938000144', payeeName: 'Laide Ferreira Thomaz' },
      '02043512943',
      'PAGAMENTO PIX-PIX_DEB Laide Ferreira Thomaz',
    ),
  );
  check(
    'nome parecido mas de outra pessoa não resgata',
    !identityMatches(
      { payeeCnpj: '13636938000144', payeeName: 'Laide Ferreira Thomaz' },
      '02043512943',
      'PAGAMENTO PIX-PIX_DEB JOSE CARLOS DA SILVA',
    ),
  );

  // O portão é de mão única: falta de informação nunca bloqueia, só desacordo.
  check('conta sem documento cadastrado passa', identityMatches({}, '33034206968', 'QUALQUER UM'));
  check(
    'débito sem contraparte no OFX passa',
    identityMatches({ payeeCpf: '33034206968' }, null, null),
  );
}

console.log(
  failures === 0 ? '\n✅ Todas as verificações passaram.\n' : `\n❌ ${failures} verificação(ões) falharam.\n`,
);
process.exit(failures === 0 ? 0 : 1);
