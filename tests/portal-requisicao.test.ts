/**
 * A REQUISIÇÃO DE ORÇAMENTO DO PORTAL — a borda, sem banco.
 *
 * O QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * Cada bloco abaixo corresponde a um defeito que o caminho interno TEM hoje e
 * que a porta nova não pode herdar:
 *
 *   1. CLIENTE SEM DOCUMENTO. `customerQuickCreateSchema` pula o `.refine` de
 *      "CNPJ ou CPF" que o `customerCreateSchema` tem, e
 *      `CustomerService.quickCreate` ainda grava `cpf: null` FIXO. Um cliente
 *      assim entra no cadastro e trava a NFS-e semanas depois, com o veículo
 *      pronto. Aqui o documento é exigido NA PORTA — e o CPF existe.
 *
 *   2. SÉRIE NUMÉRICA. O caminho de FAIXA da criação interna é
 *      `z.number().int().positive()` e não sabe dizer `ABC-123456`.
 *
 *   3. CENTÍMETRO GRAVADO COMO METRO. O banco guarda metros
 *      (`ImplementMeasure.height`, `ImplementMeasureSection.width`); o cliente
 *      mede em centímetros. Uma conversão esquecida faz um baú de 2,50 m virar
 *      um de 250 m, e nada no banco recusa — os dois são `Float`.
 *
 *   4. PRODUTO CARTESIANO. `Implement.serialNumber` e `Implement.plate` são `@unique`
 *      GLOBAIS, e o formulário interno emite N placas × 1 série. O erro certo é
 *      um 400 NOMEANDO a série culpada, não "Unique constraint failed on the
 *      fields: (`serialNumber`)".
 *
 * O teste é PURO: nenhum banco, nenhum Nest, nenhuma rede. O que não é função
 * pura (as escritas do serviço) é verificado pela FORMA do código-fonte — o
 * mesmo recurso que `responsible-auth-otp.test.ts` usa para o incremento
 * atômico.
 *
 * `npm run test:portal-requisicao`
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { PortalRequestService } from '../src/modules/people/portal/portal-request.service';
import { PortalScopeService } from '../src/modules/people/portal/portal-scope.service';
import {
  ALTURA_MAXIMA_CM,
  CENTIMETROS_POR_METRO,
  LADO_DA_FACE,
  LADOS_DO_PORTAL,
  portaParaPrisma,
  LARGURA_MAXIMA_CM,
  MAXIMO_BASE_FILES,
  MAXIMO_VEICULOS,
  PAYLOAD_INVALIDO_MENSAGEM,
  portalRequisicaoCorpoSchema,
  centimetrosParaMetros,
  colisoesNoPayload,
  descreverColisao,
  medidaParaPrisma,
  portalMedidaLadoSchema,
  portalNovaTintaSchema,
  portalNovoClienteSchema,
  portalRequisicaoSchema,
  portalVeiculoSchema,
} from '../src/schemas/portal-request';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Todas as mensagens de erro de um `safeParse`, concatenadas. */
const motivos = (resultado: { success: boolean; error?: any }): string =>
  resultado.success ? '' : resultado.error.issues.map((i: any) => i.message).join(' | ');

const CNPJ_VALIDO = '11222333000181';
const CPF_VALIDO = '52998224725';
const CHASSI_VALIDO = '9BWZZZ377VT004251';
const UUID = (n: number) => `1111111${n}-1111-4111-8111-111111111111`;

/** O menor corpo aceitável, para sobrepor campo a campo nos casos. */
const requisicaoBase = (extra: Record<string, unknown> = {}) => ({
  customerId: UUID(1),
  briefing: 'Baú de 14 paletes, logomarca nas laterais.',
  veiculos: [{ serialNumber: '1001' }],
  ...extra,
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n1. O DOCUMENTO É EXIGIDO NA PORTA (o refine que /customers/quick pula)');
// ═══════════════════════════════════════════════════════════════════════════
{
  const semDocumento = portalNovoClienteSchema.safeParse({ fantasyName: 'Transportes Aurora' });
  check(
    'cliente novo SEM CNPJ e SEM CPF é RECUSADO',
    !semDocumento.success,
    'aceitou um cliente que travaria a NFS-e',
  );
  check(
    'e a recusa diz o que fazer',
    !semDocumento.success && /CNPJ ou CPF/i.test(motivos(semDocumento)),
    motivos(semDocumento),
  );

  const comCnpj = portalNovoClienteSchema.safeParse({
    fantasyName: 'Transportes Aurora',
    cnpj: CNPJ_VALIDO,
  });
  check('só CNPJ basta', comCnpj.success, motivos(comCnpj));

  const comCpf = portalNovoClienteSchema.safeParse({
    fantasyName: 'João Motorista ME',
    cpf: CPF_VALIDO,
  });
  check(
    'só CPF basta — e o CPF EXISTE aqui (quickCreate grava `cpf: null` fixo)',
    comCpf.success,
    motivos(comCpf),
  );
  check(
    'o CPF sobrevive à validação (não é descartado)',
    comCpf.success && (comCpf.data as any).cpf === CPF_VALIDO,
    comCpf.success ? String((comCpf.data as any).cpf) : motivos(comCpf),
  );

  const cnpjInvalido = portalNovoClienteSchema.safeParse({
    fantasyName: 'Fantasma Ltda',
    cnpj: '11111111111111',
  });
  check('CNPJ com dígito verificador errado é recusado', !cnpjInvalido.success);

  const cpfInvalido = portalNovoClienteSchema.safeParse({
    fantasyName: 'Fantasma',
    cpf: '11111111111',
  });
  check('CPF com dígito verificador errado é recusado', !cpfInvalido.success);

  const mascarado = portalNovoClienteSchema.safeParse({
    fantasyName: 'Aurora',
    cnpj: '11.222.333/0001-81',
  });
  check(
    'o documento é guardado em DÍGITOS, não com a máscara que o cliente digitou',
    mascarado.success && (mascarado.data as any).cnpj === CNPJ_VALIDO,
    mascarado.success ? String((mascarado.data as any).cnpj) : motivos(mascarado),
  );

  const vazio = portalNovoClienteSchema.safeParse({
    fantasyName: 'Aurora',
    cnpj: '',
    cpf: CPF_VALIDO,
  });
  check(
    'string vazia do FormData não conta como documento informado',
    vazio.success && (vazio.data as any).cnpj === null,
    vazio.success ? String((vazio.data as any).cnpj) : motivos(vazio),
  );

  const semNome = portalNovoClienteSchema.safeParse({ cnpj: CNPJ_VALIDO });
  check('nome fantasia continua obrigatório', !semNome.success);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n2. SÉRIE É TEXTO (o caminho de faixa é z.number() e não diz ABC-123456)');
// ═══════════════════════════════════════════════════════════════════════════
{
  const texto = portalVeiculoSchema.safeParse({ serialNumber: 'ABC-123456' });
  check('série alfanumérica com hífen é ACEITA', texto.success, motivos(texto));

  const minuscula = portalVeiculoSchema.safeParse({ serialNumber: 'abc-123456' });
  check(
    'minúscula é normalizada para MAIÚSCULA (o regex interno recusa minúscula)',
    minuscula.success && (minuscula.data as any).serialNumber === 'ABC-123456',
    minuscula.success ? String((minuscula.data as any).serialNumber) : motivos(minuscula),
  );

  const espacos = portalVeiculoSchema.safeParse({ serialNumber: '  1001  ' });
  check(
    'espaços em volta são aparados',
    espacos.success && (espacos.data as any).serialNumber === '1001',
    espacos.success ? JSON.stringify((espacos.data as any).serialNumber) : motivos(espacos),
  );

  const numerica = portalVeiculoSchema.safeParse({ serialNumber: '1005' });
  check('série puramente numérica continua valendo', numerica.success, motivos(numerica));

  const suja = portalVeiculoSchema.safeParse({ serialNumber: 'ABC 123/456' });
  check('caractere fora de [A-Z0-9-] é recusado', !suja.success);

  const vazia = portalVeiculoSchema.safeParse({ serialNumber: '' });
  check(
    'série vazia vira null (e NULL não colide com NULL no índice único)',
    vazia.success && (vazia.data as any).serialNumber === null,
    vazia.success ? String((vazia.data as any).serialNumber) : motivos(vazia),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n3. PLACA E CHASSI — as mesmas réguas do cadastro interno');
// ═══════════════════════════════════════════════════════════════════════════
{
  const antiga = portalVeiculoSchema.safeParse({ plate: 'ABC-1234' });
  check(
    'placa antiga com hífen é limpa para ABC1234',
    antiga.success && (antiga.data as any).plate === 'ABC1234',
    antiga.success ? String((antiga.data as any).plate) : motivos(antiga),
  );

  const mercosul = portalVeiculoSchema.safeParse({ plate: 'abc1d23' });
  check(
    'placa Mercosul minúscula é normalizada',
    mercosul.success && (mercosul.data as any).plate === 'ABC1D23',
    mercosul.success ? String((mercosul.data as any).plate) : motivos(mercosul),
  );

  check('placa curta é recusada', !portalVeiculoSchema.safeParse({ plate: 'AB123' }).success);

  const chassi = portalVeiculoSchema.safeParse({ chassisNumber: ` ${CHASSI_VALIDO.toLowerCase()} ` });
  check(
    'chassi é limpo e normalizado para maiúscula',
    chassi.success && (chassi.data as any).chassisNumber === CHASSI_VALIDO,
    chassi.success ? String((chassi.data as any).chassisNumber) : motivos(chassi),
  );

  const comI = portalVeiculoSchema.safeParse({ chassisNumber: '9BWZZZ377VT00425I' });
  check('chassi com letra proibida (I/O/Q) é recusado', !comI.success);

  const curto = portalVeiculoSchema.safeParse({ chassisNumber: '9BWZZZ377VT0042' });
  check('chassi com menos de 17 caracteres é recusado', !curto.success);

  const semNada = portalVeiculoSchema.safeParse({});
  check(
    'veículo ainda sem identidade é ACEITO (frota nova, placa ainda não emitida)',
    semNada.success,
    motivos(semNada),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n4. MEDIDAS: CENTÍMETRO NA BORDA, METRO NO BANCO');
// ═══════════════════════════════════════════════════════════════════════════
{
  check('a constante é 100', CENTIMETROS_POR_METRO === 100, String(CENTIMETROS_POR_METRO));
  check('250 cm = 2,5 m', centimetrosParaMetros(250) === 2.5, String(centimetrosParaMetros(250)));
  check('1 cm = 0,01 m', centimetrosParaMetros(1) === 0.01, String(centimetrosParaMetros(1)));
  check(
    '247 cm = 2,47 m EXATOS (247/100 em ponto flutuante dá 2.4699999999999998)',
    centimetrosParaMetros(247) === 2.47,
    String(centimetrosParaMetros(247)),
  );
  check(
    '1000 cm = 10 m — o teto que o schema interno declara em metros',
    centimetrosParaMetros(ALTURA_MAXIMA_CM) === 10,
    String(centimetrosParaMetros(ALTURA_MAXIMA_CM)),
  );
  check(
    '2000 cm = 20 m — idem para a largura de seção',
    centimetrosParaMetros(LARGURA_MAXIMA_CM) === 20,
    String(centimetrosParaMetros(LARGURA_MAXIMA_CM)),
  );
  check(
    'o décimo de milímetro sobrevive (333,3 cm = 3,333 m)',
    centimetrosParaMetros(333.3) === 3.333,
    String(centimetrosParaMetros(333.3)),
  );

  const lado = portalMedidaLadoSchema.parse({
    height: 250,
    sections: [
      { width: 800 },
      { width: 120, isDoor: true, doorHeight: 200 },
      { width: 460 },
    ],
  });
  const gravado = medidaParaPrisma(lado);

  check('a altura vai em metros', gravado.height === 2.5, String(gravado.height));
  check(
    'as larguras vão em metros',
    JSON.stringify(gravado.sections.map(s => s.width)) === JSON.stringify([8, 1.2, 4.6]),
    JSON.stringify(gravado.sections.map(s => s.width)),
  );
  check(
    'a altura da porta vai em metros',
    gravado.sections[1].doorHeight === 2,
    String(gravado.sections[1].doorHeight),
  );
  check(
    'seção que NÃO é porta grava doorHeight null (porta que não existe não tem altura)',
    gravado.sections[0].doorHeight === null && gravado.sections[2].doorHeight === null,
  );
  check(
    'a posição vem do índice quando o formulário não numera',
    JSON.stringify(gravado.sections.map(s => s.position)) === JSON.stringify([0, 1, 2]),
    JSON.stringify(gravado.sections.map(s => s.position)),
  );
  check(
    'NENHUM valor gravado é maior que o teto em METROS do schema interno',
    gravado.height <= 10 && gravado.sections.every(s => s.width <= 20),
  );

  const posicaoExplicita = medidaParaPrisma(
    portalMedidaLadoSchema.parse({
      height: 250,
      sections: [{ width: 100, position: 5 }, { width: 100 }],
    }),
  );
  check(
    'posição explícita é respeitada',
    posicaoExplicita.sections[0].position === 5 && posicaoExplicita.sections[1].position === 1,
    JSON.stringify(posicaoExplicita.sections.map(s => s.position)),
  );

  const altaDemais = portalMedidaLadoSchema.safeParse({
    height: ALTURA_MAXIMA_CM + 1,
    sections: [{ width: 100 }],
  });
  check('altura acima de 1000 cm (10 m) é recusada NA BORDA', !altaDemais.success);

  const largaDemais = portalMedidaLadoSchema.safeParse({
    height: 250,
    sections: [{ width: LARGURA_MAXIMA_CM + 1 }],
  });
  check('largura acima de 2000 cm (20 m) é recusada NA BORDA', !largaDemais.success);

  const emMetros = portalMedidaLadoSchema.safeParse({ height: 2.5, sections: [{ width: 8 }] });
  check(
    'um valor JÁ em metros passa (2,5 cm é uma medida possível) — por isso o campo se chama cm e a unidade é documentada, não adivinhada',
    emMetros.success,
    motivos(emMetros),
  );

  const portaSemAltura = portalMedidaLadoSchema.safeParse({
    height: 250,
    sections: [{ width: 120, isDoor: true }],
  });
  check('seção marcada como porta SEM altura é recusada', !portaSemAltura.success);

  const portaAltaDemais = portalMedidaLadoSchema.safeParse({
    height: 250,
    sections: [{ width: 120, isDoor: true, doorHeight: 300 }],
  });
  check('porta mais alta que o implemento é recusada', !portaAltaDemais.success);

  const semSecao = portalMedidaLadoSchema.safeParse({ height: 250, sections: [] });
  check('lado sem nenhuma seção é recusado', !semSecao.success);

  const demaisSecoes = portalMedidaLadoSchema.safeParse({
    height: 250,
    sections: Array.from({ length: 11 }, () => ({ width: 100 })),
  });
  check('mais de 10 seções é recusado (o mesmo teto do schema interno)', !demaisSecoes.success);

  const quatroLados = portalVeiculoSchema.safeParse({
    serialNumber: '1001',
    medidas: {
      esquerda: { height: 250, sections: [{ width: 800 }] },
      direita: { height: 250, sections: [{ width: 800 }] },
      traseira: { height: 250, sections: [{ width: 250 }] },
      frente: { height: 250, sections: [{ width: 250 }] },
    },
  });
  check(
    'os QUATRO lados (esquerda/direita/traseira/frente) são aceitos',
    quatroLados.success,
    motivos(quatroLados),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n5. AS COLISÕES DE UNICIDADE — o produto cartesiano, pego antes de escrever');
// ═══════════════════════════════════════════════════════════════════════════
{
  // O QUE O FORMULÁRIO INTERNO PRODUZ: 3 placas × 1 série.
  const cartesiano = [
    { serialNumber: '1001', plate: 'ABC1234' },
    { serialNumber: '1001', plate: 'DEF5678' },
    { serialNumber: '1001', plate: 'GHI9012' },
  ];
  const c1 = colisoesNoPayload(cartesiano);
  check('N placas com a MESMA série é detectado', c1.length === 1, JSON.stringify(c1));
  check('e é a SÉRIE que é apontada', c1[0]?.field === 'serialNumber' && c1[0]?.value === '1001');
  check(
    'com TODOS os índices envolvidos, para o formulário marcar as linhas',
    JSON.stringify(c1[0]?.vehicleIndexes) === JSON.stringify([0, 1, 2]),
    JSON.stringify(c1[0]?.vehicleIndexes),
  );
  check(
    'a frase NOMEIA o valor (e não "Unique constraint failed on the fields")',
    descreverColisao(c1[0]).includes('1001') && !/constraint/i.test(descreverColisao(c1[0])),
    descreverColisao(c1[0]),
  );
  check(
    'e enumera as linhas do FORMULÁRIO (1-based), não os índices do array',
    descreverColisao(c1[0]).includes('veículos 1, 2 e 3'),
    descreverColisao(c1[0]),
  );

  // O OUTRO SENTIDO: 1 placa × N séries.
  const c2 = colisoesNoPayload([
    { serialNumber: '1001', plate: 'ABC1234' },
    { serialNumber: '1002', plate: 'ABC1234' },
  ]);
  check('N séries com a MESMA placa é detectado', c2.length === 1 && c2[0].field === 'plate');

  // OS DOIS AO MESMO TEMPO — as duas colisões voltam juntas.
  const c3 = colisoesNoPayload([
    { serialNumber: '1001', plate: 'ABC1234' },
    { serialNumber: '1001', plate: 'ABC1234' },
  ]);
  check(
    'série E placa repetidas devolvem AS DUAS colisões (não a primeira)',
    c3.length === 2 && new Set(c3.map(c => c.field)).size === 2,
    JSON.stringify(c3.map(c => c.field)),
  );

  const limpo = colisoesNoPayload([
    { serialNumber: '1001', plate: 'ABC1234' },
    { serialNumber: '1002', plate: 'DEF5678' },
  ]);
  check('tuplas distintas não colidem', limpo.length === 0, JSON.stringify(limpo));

  const nulos = colisoesNoPayload([
    { serialNumber: null, plate: null },
    { serialNumber: null, plate: null },
    {},
  ]);
  check(
    'NULL não colide com NULL (é o que o índice único do Postgres faz)',
    nulos.length === 0,
    JSON.stringify(nulos),
  );

  const vaziosNaoColidem = colisoesNoPayload([{ serialNumber: '' }, { serialNumber: '' }]);
  check('string vazia também não colide', vaziosNaoColidem.length === 0);

  check(
    'o escopo separa "repetido no envio" de "já existe no banco"',
    c1[0].scope === 'payload' &&
      descreverColisao({
        field: 'plate',
        value: 'ABC1234',
        scope: 'database',
        vehicleIndexes: [0],
      }).includes('já está cadastrado'),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n6. O CORPO INTEIRO — o que a rota aceita e o que ela recusa');
// ═══════════════════════════════════════════════════════════════════════════
{
  const minimo = portalRequisicaoSchema.safeParse(requisicaoBase());
  check('o corpo mínimo (cliente + briefing + 1 veículo) passa', minimo.success, motivos(minimo));

  const semBriefing = portalRequisicaoSchema.safeParse(requisicaoBase({ briefing: '   ' }));
  check('briefing em branco é recusado', !semBriefing.success);

  const semVeiculo = portalRequisicaoSchema.safeParse(requisicaoBase({ veiculos: [] }));
  check('requisição sem veículo é recusada', !semVeiculo.success);

  const veiculosDemais = portalRequisicaoSchema.safeParse(
    requisicaoBase({
      veiculos: Array.from({ length: MAXIMO_VEICULOS + 1 }, (_, i) => ({ serialNumber: `S${i}` })),
    }),
  );
  check(`mais de ${MAXIMO_VEICULOS} veículos é recusado`, !veiculosDemais.success);

  const doisClientes = portalRequisicaoSchema.safeParse(
    requisicaoBase({ novoCliente: { fantasyName: 'Aurora', cnpj: CNPJ_VALIDO } }),
  );
  check('cliente existente E cliente novo ao mesmo tempo é recusado', !doisClientes.success);

  const nenhumCliente = portalRequisicaoSchema.safeParse({
    briefing: 'x',
    veiculos: [{ serialNumber: '1' }],
  });
  check('nenhum dos dois é recusado', !nenhumCliente.success);

  const soNovoCliente = portalRequisicaoSchema.safeParse({
    novoCliente: { fantasyName: 'Aurora', cnpj: CNPJ_VALIDO },
    briefing: 'Baú novo',
    veiculos: [{ serialNumber: '1' }],
  });
  check('só cliente novo passa', soNovoCliente.success, motivos(soNovoCliente));

  const clienteNovoSemDoc = portalRequisicaoSchema.safeParse({
    novoCliente: { fantasyName: 'Aurora' },
    briefing: 'Baú novo',
    veiculos: [{ serialNumber: '1' }],
  });
  check(
    'o refine do documento vale DENTRO do corpo completo, não só isolado',
    !clienteNovoSemDoc.success,
    motivos(clienteNovoSemDoc),
  );

  const duasTintas = portalRequisicaoSchema.safeParse(
    requisicaoBase({
      paintId: UUID(2),
      novaTinta: { name: 'Azul', hex: '#0044AA', finish: 'SOLID', paintTypeId: UUID(3) },
    }),
  );
  check('tinta existente E tinta nova ao mesmo tempo é recusado', !duasTintas.success);

  const semTinta = portalRequisicaoSchema.safeParse(requisicaoBase());
  check('nenhuma tinta é legítimo (a cor pode vir depois)', semTinta.success, motivos(semTinta));

  const faturarPara = portalRequisicaoSchema.safeParse(
    requisicaoBase({ faturarParaCustomerId: UUID(4) }),
  );
  check('"faturar para" é aceito quando informado', faturarPara.success, motivos(faturarPara));
  check(
    '"faturar para" AUSENTE também passa — com cliente novo o id ainda não existe',
    minimo.success && (minimo.data as any).faturarParaCustomerId === undefined,
  );

  const idInvalido = portalRequisicaoSchema.safeParse(requisicaoBase({ customerId: 'nao-e-uuid' }));
  check('customerId que não é UUID é recusado', !idInvalido.success);

  const logo = portalRequisicaoSchema.safeParse(requisicaoBase({ logoName: 'Aurora Transportes' }));
  check(
    'logoName chega ao BudgetRequest',
    logo.success && (logo.data as any).logoName === 'Aurora Transportes',
    logo.success ? String((logo.data as any).logoName) : motivos(logo),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n7. A TINTA NOVA — o mínimo de POST /paints');
// ═══════════════════════════════════════════════════════════════════════════
{
  const ok = portalNovaTintaSchema.safeParse({
    name: 'Azul Aurora',
    hex: '#0044AA',
    finish: 'SOLID',
    paintTypeId: UUID(3),
  });
  check('{ name, hex, finish, paintTypeId } basta', ok.success, motivos(ok));

  check(
    'hex sem # é recusado',
    !portalNovaTintaSchema.safeParse({
      name: 'X',
      hex: '0044AA',
      finish: 'SOLID',
      paintTypeId: UUID(3),
    }).success,
  );
  check(
    'acabamento fora de PAINT_FINISH é recusado',
    !portalNovaTintaSchema.safeParse({
      name: 'X',
      hex: '#0044AA',
      finish: 'FOSQUINHO',
      paintTypeId: UUID(3),
    }).success,
  );
  check(
    'paintTypeId que não é UUID é recusado',
    !portalNovaTintaSchema.safeParse({
      name: 'X',
      hex: '#0044AA',
      finish: 'SOLID',
      paintTypeId: 'tipo-1',
    }).success,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n8. MULTIPART: o corpo chega como STRING, e o schema o desserializa sozinho');
// ═══════════════════════════════════════════════════════════════════════════
{
  // É assim que `web/src/utils/form-data-helper.ts` serializa: array de objetos
  // vira UMA string JSON, `null` vira a string 'null'.
  const comoFormData = portalRequisicaoSchema.safeParse({
    customerId: UUID(1),
    briefing: 'Baú de 14 paletes',
    logoName: 'null',
    veiculos: JSON.stringify([
      { serialNumber: '1001', plate: 'ABC-1234', medidas: { esquerda: { height: 250, sections: [{ width: 800 }] } } },
    ]),
  });
  check('`veiculos` como string JSON é aceito', comoFormData.success, motivos(comoFormData));
  check(
    'e vira array de verdade, já normalizado',
    comoFormData.success &&
      Array.isArray((comoFormData.data as any).veiculos) &&
      (comoFormData.data as any).veiculos[0].plate === 'ABC1234',
    comoFormData.success ? JSON.stringify((comoFormData.data as any).veiculos) : '',
  );
  check(
    "a string 'null' do FormData vira null de verdade",
    comoFormData.success && (comoFormData.data as any).logoName === null,
  );

  const tintaComoString = portalRequisicaoSchema.safeParse(
    requisicaoBase({
      novaTinta: JSON.stringify({
        name: 'Azul',
        hex: '#0044AA',
        finish: 'SOLID',
        paintTypeId: UUID(3),
      }),
    }),
  );
  check(
    '`novaTinta` como string JSON também é aceito',
    tintaComoString.success && (tintaComoString.data as any).novaTinta?.name === 'Azul',
    motivos(tintaComoString),
  );

  const numeroComoString = portalVeiculoSchema.safeParse({
    serialNumber: '1001',
    medidas: { traseira: { height: '250', sections: [{ width: '250,5' }] } },
  });
  check(
    'número que chegou como string (inclusive com vírgula decimal) é convertido',
    numeroComoString.success &&
      (numeroComoString.data as any).medidas.traseira.sections[0].width === 250.5,
    motivos(numeroComoString),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n9. A FORMA DO SERVIÇO — o que não é função pura, mas tem de ser verdade');
// ═══════════════════════════════════════════════════════════════════════════
{
  const raiz = join(__dirname, '..');

  /**
   * AS ASSERÇÕES OLHAM O CÓDIGO, NÃO OS COMENTÁRIOS.
   *
   * Os dois arquivos EXPLICAM as armadilhas que evitam — e por isso citam
   * `createTasksFromSerialRange`, `@UserId` e `@UseGuards` em prosa. Sem tirar
   * os comentários, a verificação "não usa X" encontraria a própria explicação
   * de por que X não é usado e reprovaria o arquivo correto. As linhas são
   * preservadas para que as asserções de indentação continuem valendo.
   */
  const semComentarios = (fonte: string): string =>
    fonte
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map(linha => linha.replace(/(^|\s)\/\/.*$/, '$1'))
      .join('\n');

  const servico = semComentarios(
    readFileSync(join(raiz, 'src/modules/people/portal/portal-request.service.ts'), 'utf8'),
  );
  const controller = semComentarios(
    readFileSync(join(raiz, 'src/modules/people/portal/portal-request.controller.ts'), 'utf8'),
  );

  // ── Armadilha 5: o caminho de faixa DESCARTA os arquivos ────────────────
  check(
    'o serviço NÃO reusa o caminho de faixa de série (que declara `files` e nunca os usa)',
    !/createTasksFromSerialRange|serialNumberFrom/.test(servico),
  );
  check(
    'e conecta os `baseFiles` explicitamente',
    /baseFiles:\s*\{\s*connect/.test(servico),
  );

  // ── Armadilha 4: `implement.plate`, nunca `plate` no topo ───────────────
  const criacaoDaTarefa = servico.slice(
    servico.indexOf('tx.task.create'),
    servico.indexOf('const implementId'),
  );
  check(
    'a tarefa nasce com `implement: { create: { plate ... } }` (W4, DD1)',
    /implement:\s*\{\s*\n?\s*create:\s*\{[\s\S]*?plate:/.test(criacaoDaTarefa),
  );
  check(
    'e a SÉRIE nasce no implemento, com `spot: null` explícito (W4, DD1)',
    /implement:\s*\{\s*\n?\s*create:\s*\{[\s\S]*?serialNumber:[\s\S]*?spot:\s*null/.test(criacaoDaTarefa) &&
      !/^\s{8}serialNumber:/m.test(criacaoDaTarefa),
  );
  check(
    'e NUNCA com `plate` no topo do objeto da tarefa (some em silêncio: nada é .strict())',
    !/^\s{8}plate:/m.test(criacaoDaTarefa),
  );

  // ── A regra do portal: nunca o sujeito errado ───────────────────────────
  check(
    'o serviço não usa @UserId() nem request.user',
    !/@UserId|request\.user\b/.test(servico),
  );
  check(
    'toda auditoria vai com userId: null (id de responsável não existe em User)',
    /userId:\s*null/.test(servico) && !/userId:\s*principal\.id/.test(servico),
  );
  check(
    'e a autoria fica em triggeredById, que não tem FK',
    /triggeredById:\s*(principal|contexto\.principal)\.id/.test(servico),
  );

  // ── companyId é NULLABLE ────────────────────────────────────────────────
  check(
    'responsável sem empresa é recusado antes de qualquer consulta',
    /if\s*\(!principal\.companyId\)/.test(servico) && /ForbiddenException/.test(servico),
  );

  // ── O pagador passa pelo funil único ────────────────────────────────────
  check(
    'o pagador nasce por reconcileQuoteCustomerConfigs (que cria o Billing NOT NULL)',
    /reconcileQuoteCustomerConfigs\(/.test(servico),
  );
  check(
    'e nunca por um tx.budgetPayer.create à mão',
    !/budgetPayer\.create/.test(servico),
  );

  // ── statusOrder: 0 é proibido ───────────────────────────────────────────
  check(
    'o statusOrder vem do mapa, nunca de um literal (0 viraria 1 em silêncio no CREATE)',
    /statusOrder:\s*TASK_QUOTE_STATUS_ORDER\[/.test(servico),
  );
  check(
    'e o orçamento nasce em REQUESTED, sem serviço e sem valor',
    /status:\s*TASK_QUOTE_STATUS\.REQUESTED/.test(servico) &&
      /subtotal:\s*0/.test(servico) &&
      /total:\s*0/.test(servico) &&
      !/services:\s*\{/.test(servico),
  );

  // ── O erro de unicidade é NOMEADO, e o P2002 nunca vaza ─────────────────
  check(
    'o P2002 do Prisma é traduzido, não propagado',
    /P2002/.test(servico) && /conflicts:/.test(servico),
  );

  // ── O controller ────────────────────────────────────────────────────────
  check(
    'a rota é POST /cliente/me/orcamentos (plural — a pública engole o singular)',
    /@Controller\('cliente\/me'\)/.test(controller) && /@Post\('orcamentos'\)/.test(controller),
  );
  check(
    'marcada com @ResponsibleOnly() — marcar a rota É guardá-la',
    /@ResponsibleOnly\(\)/.test(controller),
  );
  check(
    'sem @UseGuards escrito à mão (a guarda de capacidade vem com o decorador)',
    !/@UseGuards/.test(controller),
  );
  check(
    'o portão da AÇÃO é @PortalCapability(REQUEST_BUDGET)',
    /@PortalCapability\(PORTAL_CAPABILITY\.REQUEST_BUDGET\)/.test(controller),
  );
  check(
    'e NÃO empilha @ResponsibleRoles — os dois gravam RESPONSIBLE_ROLES_KEY e um sobrescreveria o outro em silêncio',
    !/@ResponsibleRoles\(/.test(controller),
  );

  // A capacidade tem de PROJETAR exatamente a linha REQUEST_BUDGET do contrato
  // §2.1 — senão o portão diz uma coisa e libera outra.
  const { PORTAL_CAPABILITY, ROLE_CAPABILITIES } = require('../src/modules/people/portal/portal-capabilities');
  const abremRequisicao = Object.entries(ROLE_CAPABILITIES)
    .filter(([, caps]) => (caps as string[]).includes(PORTAL_CAPABILITY.REQUEST_BUDGET))
    .map(([papel]) => papel)
    .sort();
  check(
    'REQUEST_BUDGET é de COMMERCIAL, SELLER, REPRESENTATIVE, COORDINATOR e MARKETING',
    JSON.stringify(abremRequisicao) ===
      JSON.stringify(['COMMERCIAL', 'COORDINATOR', 'MARKETING', 'REPRESENTATIVE', 'SELLER']),
    JSON.stringify(abremRequisicao),
  );
  check(
    'e NÃO de PURCHASING, FINANCIAL, FLEET_MANAGER nem DRIVER',
    !abremRequisicao.some(p =>
      ['PURCHASING', 'FINANCIAL', 'FLEET_MANAGER', 'DRIVER'].includes(p),
    ),
  );
  check(
    `o campo de arquivo é 'baseFiles', com teto de ${MAXIMO_BASE_FILES}`,
    /name:\s*'baseFiles',\s*maxCount:\s*MAXIMO_BASE_FILES/.test(controller) &&
      MAXIMO_BASE_FILES === 30,
  );
  check(
    'o principal vem de @CurrentResponsible(), nunca de @UserId()',
    /@CurrentResponsible\(\)/.test(controller) && !/@UserId/.test(controller),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n10. ⛔ O CORPO INTEIRO NUM CAMPO SÓ — o `payload` que o web manda');
// ═══════════════════════════════════════════════════════════════════════════
//
// O DESENCONTRO QUE ESTE BLOCO FECHA. Este schema nasceu esperando cada campo
// composto como a SUA PRÓPRIA string JSON (a convenção de
// `web/src/utils/form-data-helper.ts`). O portal do web faz outra coisa, e três
// pacotes já compilam contra ela: `api-client/portal.ts` → `multipart()` manda
// UM campo chamado `payload` com o corpo todo dentro, mais N `baseFiles`. A
// razão é boa — o corpo tem objeto aninhado e lista (`veiculos[].medidas`), e
// multipart não transporta isso sem uma convenção de colchetes que o Nest não
// desmonta sozinho.
//
// A borda passou a aceitar AS DUAS FORMAS, e o teste fixa as duas.
{
  const corpo = {
    customerId: UUID(1),
    briefing: 'Baú de 14 paletes, logomarca nas laterais.',
    logoName: 'Aurora Transportes',
    veiculos: [
      {
        serialNumber: '1001',
        plate: 'ABC-1234',
        medidas: { esquerda: { height: 250, sections: [{ width: 800 }] } },
      },
    ],
  };

  const puro = portalRequisicaoSchema.safeParse(corpo);
  const empacotado = portalRequisicaoSchema.safeParse({ payload: JSON.stringify(corpo) });

  check('corpo JSON puro continua passando', puro.success, motivos(puro));
  check('`payload` com o corpo inteiro em string JSON é aceito', empacotado.success, motivos(empacotado));
  check(
    '⛔ e as DUAS formas produzem EXATAMENTE o mesmo objeto',
    puro.success &&
      empacotado.success &&
      JSON.stringify(puro.data) === JSON.stringify(empacotado.data),
    empacotado.success ? JSON.stringify(empacotado.data) : '',
  );
  check(
    'as normalizações valem dentro do `payload` (a placa perde o hífen)',
    empacotado.success && (empacotado.data as any).veiculos[0].plate === 'ABC1234',
  );
  check(
    'e a conversão centímetro→metro também',
    empacotado.success &&
      medidaParaPrisma((empacotado.data as any).veiculos[0].medidas.esquerda).height === 2.5,
  );

  // ⚠️ O PIPE DESSERIALIZA ANTES DE NÓS. `ZodValidationPipe.transform` roda
  // `fixArrays` no corpo, e `fixArrays` transforma toda string que seja JSON
  // válido em objeto — então, PELA ROTA, `payload` chega aqui já desserializado.
  // Tratar só a string faria a rota e este teste discordarem em silêncio.
  const comoOPipeEntrega = portalRequisicaoSchema.safeParse({ payload: corpo });
  check(
    '`payload` já desserializado (como o ZodValidationPipe o entrega) também é aceito',
    comoOPipeEntrega.success,
    motivos(comoOPipeEntrega),
  );

  // ── O contrato de ERRO segue INTACTO dentro do envelope ─────────────────
  const semBriefingNoPayload = portalRequisicaoSchema.safeParse({
    payload: JSON.stringify({ ...corpo, briefing: '   ' }),
  });
  check('o que era recusado continua recusado dentro do `payload`', !semBriefingNoPayload.success);
  check(
    'e o erro aponta o CAMPO, não o envelope',
    !semBriefingNoPayload.success &&
      semBriefingNoPayload.error.issues.some((i: any) => i.path.includes('briefing')),
    !semBriefingNoPayload.success ? JSON.stringify(semBriefingNoPayload.error.issues) : '',
  );

  const clienteNovoSemDocNoPayload = portalRequisicaoSchema.safeParse({
    payload: JSON.stringify({
      novoCliente: { fantasyName: 'Aurora' },
      briefing: 'Baú novo',
      veiculos: [{ serialNumber: '1' }],
    }),
  });
  check(
    'o refine do documento vale dentro do `payload`',
    !clienteNovoSemDocNoPayload.success,
    motivos(clienteNovoSemDocNoPayload),
  );

  // ── JSON QUEBRADO É ERRO NOMEADO, não "briefing é obrigatório" ──────────
  const quebrado = portalRequisicaoSchema.safeParse({ payload: '{ isto nao e json' });
  check('`payload` ilegível é recusado', !quebrado.success);
  check(
    'com UM erro, no campo `payload`, e não um por campo que estava dentro dele',
    !quebrado.success &&
      quebrado.error.issues.length === 1 &&
      quebrado.error.issues[0].path.join('.') === 'payload',
    !quebrado.success ? JSON.stringify(quebrado.error.issues) : '',
  );
  check(
    'e a mensagem é a do envelope',
    !quebrado.success && quebrado.error.issues[0].message === PAYLOAD_INVALIDO_MENSAGEM,
  );

  // ── A FORMA ANTIGA (campo a campo) NÃO FOI QUEBRADA ─────────────────────
  const campoACampo = portalRequisicaoSchema.safeParse({
    customerId: UUID(1),
    briefing: 'Baú de 14 paletes',
    veiculos: JSON.stringify([{ serialNumber: '1001' }]),
  });
  check('o multipart campo-a-campo continua válido', campoACampo.success, motivos(campoACampo));

  // ── O schema segue TESTÁVEL SEM O PIPE ──────────────────────────────────
  //
  // É a propriedade de que este arquivo inteiro depende para rodar sem banco e
  // sem Nest: o desembrulho é um `preprocess` DENTRO do schema, não um passo do
  // pipe. Se migrar para o pipe, tudo aqui passa a testar outra coisa.
  const fonteDoSchema = readFileSync(join(__dirname, '..', 'src/schemas/portal-request.ts'), 'utf8');
  check(
    'o desembrulho mora no SCHEMA (z.preprocess), não no pipe',
    /z\.preprocess\(\s*\n?\s*desempacotarPayload/.test(fonteDoSchema),
  );
  check(
    'e o corpo cru continua exportado, para que as duas formas possam ser comparadas',
    typeof portalRequisicaoCorpoSchema?.safeParse === 'function' &&
      portalRequisicaoCorpoSchema.safeParse(corpo).success,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n11. "FATURAR PARA" — opcional na API, sempre enviado pelo web');
// ═══════════════════════════════════════════════════════════════════════════
//
// O DESENCONTRO: o contrato §5 declara `faturarParaCustomerId` OBRIGATÓRIO, e
// com `novoCliente` ele é IMPOSSÍVEL de preencher — o cliente ainda não tem id
// quando o formulário é enviado. A API o tornou opcional (ausente = o pagador É
// o dono dos veículos); o assistente do web continua mandando sempre. As duas
// formas têm de passar, e a ausência tem de resolver para o cliente CRIADO.
{
  const comCampo = portalRequisicaoSchema.safeParse(
    requisicaoBase({ faturarParaCustomerId: UUID(4) }),
  );
  check('PRESENTE (o que o web manda) é aceito', comCampo.success, motivos(comCampo));
  check(
    'e chega ao serviço com o valor que veio',
    comCampo.success && (comCampo.data as any).faturarParaCustomerId === UUID(4),
  );

  const semCampo = portalRequisicaoSchema.safeParse(requisicaoBase());
  check('AUSENTE é aceito', semCampo.success, motivos(semCampo));
  check(
    'e chega como `undefined` — não como string vazia',
    semCampo.success && (semCampo.data as any).faturarParaCustomerId === undefined,
  );

  // O multipart manda `''` quando o combobox ficou vazio; `'null'` é a outra
  // convenção de `form-data-helper.ts`. As duas viram ausência, e não um uuid
  // inválido que recusaria a requisição inteira.
  for (const vazio of ['', '   ', 'null']) {
    const r = portalRequisicaoSchema.safeParse(
      requisicaoBase({ faturarParaCustomerId: vazio }),
    );
    if (!r.success || (r.data as any).faturarParaCustomerId !== undefined) {
      check(`"${vazio}" vira ausência`, false, motivos(r));
      break;
    }
  }
  check('"" , "   " e "null" viram ausência', true);

  check(
    'e um valor que não é UUID continua sendo recusado',
    !portalRequisicaoSchema.safeParse(requisicaoBase({ faturarParaCustomerId: 'nao-e-uuid' }))
      .success,
  );

  // ── COM `novoCliente`, A AUSÊNCIA RESOLVE PARA O CLIENTE RECÉM-CRIADO ───
  const clienteNovoSemFaturarPara = portalRequisicaoSchema.safeParse({
    novoCliente: { fantasyName: 'Aurora Transportes', cnpj: CNPJ_VALIDO },
    briefing: 'Baú de 14 paletes',
    veiculos: [{ serialNumber: '1001' }],
  });
  check(
    'cliente NOVO sem "faturar para" passa — é o caso que torna o campo opcional',
    clienteNovoSemFaturarPara.success,
    motivos(clienteNovoSemFaturarPara),
  );
  check(
    'e nem poderia ser diferente: o id do cliente novo não existe no envio',
    clienteNovoSemFaturarPara.success &&
      (clienteNovoSemFaturarPara.data as any).faturarParaCustomerId === undefined &&
      (clienteNovoSemFaturarPara.data as any).novoCliente?.fantasyName === 'Aurora Transportes',
  );

  // A resolução não é função pura — é do serviço. A FORMA dela fica fixada aqui.
  const servico = readFileSync(
    join(__dirname, '..', 'src/modules/people/portal/portal-request.service.ts'),
    'utf8',
  );
  check(
    'ausente => o pagador É o dono dos veículos (`return customerId`)',
    /if \(!dados\.faturarParaCustomerId\) return customerId;/.test(servico),
  );
  check(
    'e `customerId` é o id do cliente RESOLVIDO — criado OU reaproveitado (§12 exercita)',
    /const \{ customerId, customerName, customerCreated, customerReused \} =\s*\n?\s*await this\.resolverCliente\(/.test(
      servico,
    ),
  );
  check(
    'a resolução acontece DEPOIS de o cliente existir (senão o pagador seria nulo)',
    servico.indexOf('await this.resolverCliente(') < servico.indexOf('await this.resolverPagador('),
  );
  check(
    // ⛔ `findFirst` COM O ALCANCE, nunca `findUnique` pelo id cru. O pagador é
    // a ÂNCORA DO DINHEIRO (`BudgetPayer.customerId` → `Invoice.customerId`):
    // com o `findUnique` que havia aqui, um contato elegia QUALQUER empresa da
    // base como pagadora de um orçamento, sem nenhum laço com ela.
    'presente e DIFERENTE do dono => o pagador é conferido CONTRA O ALCANCE',
    /tx\.customer\.findFirst\(\{[\s\S]{0,200}?id: dados\.faturarParaCustomerId[\s\S]{0,120}?this\.scope\.customerScopeWhere\(principal\)/.test(
      servico,
    ) && /O cliente escolhido para faturamento não existe\./.test(servico),
  );
  check(
    'e é ELE que vira o único BudgetPayer do orçamento',
    /\[\{ customerId: faturarParaCustomerId, taskIds \}\]/.test(servico),
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
//
// O DEFEITO QUE ESTE BLOCO IMPEDE
// ─────────────────────────────────────────────────────────────────────────────
// Até 20/09 o serviço recusava com 400 — "O CNPJ … já está cadastrado." — quem
// digitasse o documento de um cadastro existente. Era um BECO: o vendedor
// conhece a empresa, digita o CNPJ dela, e a porta fecha sem dizer por onde
// seguir, porque o cadastro pode estar FORA do escopo dele e nem a lista do
// combobox o encontra. O que ele faz a seguir é mudar uma letra do nome e
// criar um SEGUNDO cadastro da MESMA empresa — que parte o faturamento em dois
// e é a razão de `POST /customers/merge` existir nesta base.
//
// ⚠️ E não há revelação nova nisso: o 400 antigo JÁ DIZIA que o CNPJ estava
// cadastrado. Reaproveitar troca uma porta fechada por um caminho; não é uma
// consulta de documento a mais. Por isso NÃO existe rota nova de busca.
//
// As quatro coisas que têm de ser verdade ao mesmo tempo:
//   a) casar por DÍGITOS **e** por documento FORMATADO (o cadastro tem as duas
//      grafias: `customerCreateSchema` nunca limpou o documento);
//   b) valer para CNPJ **e** CPF;
//   c) NÃO escrever NADA no cadastro encontrado — ele é o registro-mestre da
//      Ankaa e quem abre a requisição não é dono dele;
//   d) o nome fantasia colidindo SEM documento casado continua sendo 400 —
//      `Customer.fantasyName` é `@unique` e duas empresas diferentes com o
//      mesmo nome de fachada é conflito de verdade.
//
// Aqui o serviço é exercitado DE VERDADE, com um `prisma` de mentira, como
// `test:portal-identificacao` faz. Não é a forma da fonte: é o comportamento.
async function reaproveitamentoDoCadastro() {
  console.log('\n12. ⛔ O DOCUMENTO QUE JÁ EXISTE NÃO É ERRO — É O MESMO CLIENTE (armadilha 6)');

  const CNPJ_DIGITOS = '51865240000190';
  const CNPJ_MASCARA = '51.865.240/0001-90';
  const CPF_DIGITOS = CPF_VALIDO;
  const CPF_MASCARA = '529.982.247-25';

  const PRINCIPAL = { id: UUID(9), name: 'Vendedor da Ibiporã', companyId: UUID(8) } as any;

  /** Uma cláusula do `where` casa com a linha quando TODO campo dela bate. */
  const casa = (linha: any, clausula: any): boolean =>
    Object.entries(clausula).every(([campo, valor]) => linha?.[campo] === valor);

  /** `{ OR: [...] }` ou cláusula solta — as duas formas que o serviço monta. */
  const acha = (cadastro: any[], where: any) => {
    // `AND` é a forma NOVA: `resolverCliente` e `resolverPagador` conferem o id
    // JUNTO com o alcance do contato. Sem entender `AND`, o dublê não acharia
    // nada e o teste reprovaria por incompetência dele, não por defeito.
    if (Array.isArray(where?.AND)) {
      return cadastro.find(linha => where.AND.every((c: any) => acha([linha], c))) ?? null;
    }
    const clausulas = Array.isArray(where?.OR) ? where.OR : [where];
    return cadastro.find(linha => clausulas.some((c: any) => casa(linha, c))) ?? null;
  };

  /** O que o `tx` fez, para as asserções de AUSÊNCIA de escrita. */
  interface Diario {
    criados: any[];
    atualizados: any[];
    logs: any[];
    /** Toda vez que o serviço consultou o ALCANCE do contato. */
    escopos: any[];
  }

  const txDeMentira = (cadastro: any[], diario: Diario) =>
    ({
      customer: {
        findUnique: async ({ where }: any) =>
          cadastro.find(linha => linha.id === where?.id) ?? null,
        findFirst: async ({ where }: any) => acha(cadastro, where),
        create: async ({ data }: any) => {
          diario.criados.push(data);
          return { id: 'cliente-novo', fantasyName: data.fantasyName };
        },
        // ⛔ SENTINELA. O cadastro encontrado NÃO pode ser tocado; se algum dia
        // alguém "melhorar" o reaproveitamento sincronizando o endereço
        // digitado, é aqui que a melhoria aparece.
        update: async ({ where, data }: any) => {
          diario.atualizados.push({ where, data });
          return { id: where?.id };
        },
      },
    }) as any;

  const servicoCom = (diario: Diario) => {
    const servico: any = new (PortalRequestService as any)(
      null, // `prisma` — nenhum destes caminhos abre transação própria
      { logChange: async (entrada: any) => void diario.logs.push(entrada) },
      null, // `fileService`
      null, // `paintService`
      null, // `notifications` — o aviso ao comercial é depois do commit
      // `scope` — devolve `{}` (não recorta nada) e REGISTRA a chamada. O
      // recorte de verdade é medido de ponta a ponta em
      // `tests/e2e-portal/cenarios/02-escopo.ts`, com um cliente real fora do
      // alcance; o que importa AQUI é que o serviço tenha consultado o escopo,
      // e não que o dublê saiba avaliá-lo.
      { customerScopeWhere: (p: any) => void diario.escopos.push(p) || {} },
    );
    // O `Logger` do Nest escreveria no meio da saída do teste.
    servico.logger = { log: () => {}, error: () => {} };
    return servico;
  };

  /** Resolve o cliente e devolve ou o resultado, ou o erro, nunca os dois. */
  const resolver = async (cadastro: any[], dados: any) => {
    const diario: Diario = { criados: [], atualizados: [], logs: [], escopos: [] };
    const servico = servicoCom(diario);
    try {
      const saida = await servico.resolverCliente(txDeMentira(cadastro, diario), PRINCIPAL, dados);
      return { saida, erro: null as any, diario };
    } catch (e: any) {
      return { saida: null as any, erro: e, diario };
    }
  };

  const CARRELLII = { id: 'c-carrellii', fantasyName: 'Carrellii Implementos Rodoviarios' };
  const novoCliente = (extra: Record<string, unknown>) => ({
    novoCliente: { fantasyName: 'Carrelli Implementos', ...extra },
  });

  // ── a) CNPJ EM DÍGITOS ──────────────────────────────────────────────────
  {
    const { saida, erro, diario } = await resolver(
      [{ ...CARRELLII, cnpj: CNPJ_DIGITOS }],
      novoCliente({ cnpj: CNPJ_DIGITOS }),
    );
    check('CNPJ em dígitos que já existe REAPROVEITA, não recusa', !erro, String(erro?.message));
    check('e devolve o id do cadastro que já existia', saida?.customerId === CARRELLII.id);
    check('com `customerCreated: false`', saida?.customerCreated === false);
    check('⛔ e NADA foi criado', diario.criados.length === 0);
    check('⛔ nem atualizado — o cadastro é o registro-mestre da Ankaa', diario.atualizados.length === 0);
    check(
      'o recibo diz por qual documento casou e como o cadastro se chama',
      saida?.customerReused?.matchedBy === 'cnpj' &&
        saida?.customerReused?.fantasyName === CARRELLII.fantasyName &&
        saida?.customerReused?.document === CNPJ_MASCARA,
      JSON.stringify(saida?.customerReused),
    );
    check(
      'e guarda o nome DIGITADO, porque ele difere do cadastrado (a tela cita os dois)',
      saida?.customerReused?.typedFantasyName === 'Carrelli Implementos',
    );
    check(
      'o `customerName` do recibo é o do CADASTRO, não o digitado',
      saida?.customerName === CARRELLII.fantasyName,
    );
  }

  // ── b) CNPJ GRAVADO COM MÁSCARA, digitado em dígitos ────────────────────
  //
  // ⚠️ ESTA É A METADE FÁCIL DE PERDER. `customerCreateSchema` nunca limpou o
  // documento, então o cadastro tem `12.345.678/0001-90` ao lado de
  // `12345678000190` — e a unicidade da coluna não vê os dois como iguais.
  {
    const { saida, erro, diario } = await resolver(
      [{ ...CARRELLII, cnpj: CNPJ_MASCARA }],
      novoCliente({ cnpj: CNPJ_DIGITOS }),
    );
    check(
      '⚠️ CNPJ gravado COM MÁSCARA também casa (o zod entrega dígitos)',
      !erro && saida?.customerId === CARRELLII.id,
      String(erro?.message),
    );
    check('e também não cria nada', diario.criados.length === 0);
  }

  // ── c) CPF, nas duas grafias ────────────────────────────────────────────
  {
    const pessoa = { id: 'c-joao', fantasyName: 'João Motorista ME' };
    const digitos = await resolver(
      [{ ...pessoa, cpf: CPF_DIGITOS }],
      { novoCliente: { fantasyName: 'Joao Motorista', cpf: CPF_DIGITOS } },
    );
    check(
      'CPF em dígitos reaproveita (pessoa física é cliente como qualquer outro)',
      !digitos.erro && digitos.saida?.customerId === pessoa.id,
      String(digitos.erro?.message),
    );
    check(
      'e o recibo diz CPF, com o documento formatado',
      digitos.saida?.customerReused?.matchedBy === 'cpf' &&
        digitos.saida?.customerReused?.document === CPF_MASCARA,
      JSON.stringify(digitos.saida?.customerReused),
    );

    const mascarado = await resolver(
      [{ ...pessoa, cpf: CPF_MASCARA }],
      { novoCliente: { fantasyName: 'Joao Motorista', cpf: CPF_DIGITOS } },
    );
    check(
      'CPF gravado COM MÁSCARA também casa',
      !mascarado.erro && mascarado.saida?.customerId === pessoa.id,
      String(mascarado.erro?.message),
    );
  }

  // ── d) SEM CASAR, CRIA — o caminho que já existia segue de pé ───────────
  {
    const { saida, erro, diario } = await resolver(
      [{ ...CARRELLII, cnpj: '11222333000181' }],
      novoCliente({ cnpj: CNPJ_DIGITOS }),
    );
    check('documento que NÃO casa continua criando o cliente', !erro && saida?.customerCreated === true, String(erro?.message));
    check('exatamente um cliente criado', diario.criados.length === 1);
    check(
      'com o documento em DÍGITOS e o nome digitado',
      diario.criados[0]?.cnpj === CNPJ_DIGITOS &&
        diario.criados[0]?.fantasyName === 'Carrelli Implementos',
      JSON.stringify(diario.criados[0]),
    );
    check('e `customerReused` é null quando nasceu cadastro novo', saida?.customerReused === null);
    check(
      'a criação é auditada com userId: null (id de responsável não existe em User)',
      diario.logs.length === 1 && diario.logs[0]?.userId === null &&
        diario.logs[0]?.triggeredById === PRINCIPAL.id,
      JSON.stringify(diario.logs[0]),
    );
  }

  // ── e) NOME COLIDINDO **SEM** DOCUMENTO CASADO SEGUE SENDO 400 ──────────
  //
  // `Customer.fantasyName` é `@unique`. Duas empresas diferentes com o mesmo
  // nome de fachada é conflito de verdade: criar é impossível, e reaproveitar
  // amarraria a requisição ao CNPJ ERRADO.
  {
    const { saida, erro, diario } = await resolver(
      [{ id: 'c-outra', fantasyName: 'Carrelli Implementos', cnpj: '11222333000181' }],
      novoCliente({ cnpj: CNPJ_DIGITOS }),
    );
    check('nome fantasia repetido SEM documento casado continua sendo recusa', !!erro && !saida);
    check('com 400, não 500', (erro?.getStatus?.() ?? erro?.status) === 400, String(erro?.getStatus?.()));
    const corpo = erro?.getResponse?.() ?? {};
    const frase = String(corpo?.message ?? '');
    check('a recusa cita o nome que colidiu', /Carrelli Implementos/.test(frase), frase);
    check(
      'e diz o que fazer, pelos DOIS lados (corrigir o documento, ou diferenciar o nome)',
      /CNPJ\/CPF/.test(frase) && /nome fantasia/.test(frase),
      frase,
    );
    check('e nada foi criado', diario.criados.length === 0);
  }

  // ── f) NOME COLIDINDO **COM** DOCUMENTO CASADO: reaproveita, não recusa ──
  //
  // ⚠️ É O CASO NORMAL, e a ordem das duas checagens no serviço é o que o
  // separa do anterior: quem digita o mesmo nome e o mesmo CNPJ do cadastro
  // existente está, obviamente, falando do mesmo cliente. Se a checagem de nome
  // rodasse primeiro, a armadilha 6 nasceria morta.
  {
    const { saida, erro } = await resolver(
      [{ id: 'c-mesma', fantasyName: 'Carrelli Implementos', cnpj: CNPJ_DIGITOS }],
      novoCliente({ cnpj: CNPJ_DIGITOS }),
    );
    check(
      '⚠️ mesmo NOME e mesmo CNPJ reaproveita (a checagem do documento vem ANTES)',
      !erro && saida?.customerId === 'c-mesma',
      String(erro?.message),
    );
    check(
      'e não sobra "você digitou outro nome" para a tela mostrar',
      saida?.customerReused?.typedFantasyName === null,
    );
  }

  // ── g) O PAGADOR CAI NO CADASTRO REAPROVEITADO ──────────────────────────
  //
  // "`faturarParaCustomerId` ausente ⇒ o pagador é o dono do veículo" só é
  // verdade se "o dono" for lido DEPOIS da resolução. Antes dela não existe id
  // nenhum — e um id velho aqui faria o `BudgetPayer` (e a NFS-e) apontarem
  // para o cadastro errado.
  {
    const diario: Diario = { criados: [], atualizados: [], logs: [], escopos: [] };
    const servico = servicoCom(diario);
    const cadastro = [
      { ...CARRELLII, cnpj: CNPJ_DIGITOS },
      { id: 'c-terceiro', fantasyName: 'Furgões Ibiporã', cnpj: '11222333000181' },
    ];
    const tx = txDeMentira(cadastro, diario);

    const semPagador = novoCliente({ cnpj: CNPJ_DIGITOS });
    const resolvido = await servico.resolverCliente(tx, PRINCIPAL, semPagador);
    const pagador = await servico.resolverPagador(tx, PRINCIPAL, semPagador, resolvido.customerId);
    check(
      '"faturar para" AUSENTE resolve para o id REAPROVEITADO',
      pagador === CARRELLII.id,
      `${pagador} !== ${CARRELLII.id}`,
    );

    const comPagador = { ...semPagador, faturarParaCustomerId: 'c-terceiro' };
    const resolvido2 = await servico.resolverCliente(tx, PRINCIPAL, comPagador);
    const pagador2 = await servico.resolverPagador(tx, PRINCIPAL, comPagador, resolvido2.customerId);
    check(
      'e "faturar para" PRESENTE continua mandando (o dono é um, o pagador é outro)',
      pagador2 === 'c-terceiro',
      String(pagador2),
    );
  }

  // ── h) ESCOLHER NA LISTA NÃO É REAPROVEITAR ─────────────────────────────
  {
    const { saida, erro } = await resolver(
      [{ ...CARRELLII, cnpj: CNPJ_DIGITOS }],
      { customerId: CARRELLII.id },
    );
    check(
      'cliente escolhido na lista não vira aviso de reaproveitamento',
      !erro && saida?.customerReused === null && saida?.customerCreated === false,
      String(erro?.message),
    );
  }

  // ── i) A FRASE DO RECIBO ────────────────────────────────────────────────
  //
  // O interceptor do web toasta a `message` de toda escrita que dá certo. Se o
  // reaproveitamento ficasse só em `data`, a única pista de que o nome mudou
  // dependeria de a tela lembrar de desenhá-la.
  {
    const servico = servicoCom({ criados: [], atualizados: [], logs: [], escopos: [] });
    const semReuso = servico.mensagemDoRecibo({ budgetNumber: 1234, customerReused: null });
    check('sem reaproveitamento, a frase é a de sempre', /orçamento 1234/.test(semReuso), semReuso);
    check('e não inventa segunda oração', !/já estava cadastrado/.test(semReuso), semReuso);

    const comReuso = servico.mensagemDoRecibo({
      budgetNumber: 1234,
      customerReused: {
        id: CARRELLII.id,
        fantasyName: CARRELLII.fantasyName,
        matchedBy: 'cnpj',
        document: CNPJ_MASCARA,
        typedFantasyName: 'Carrelli Implementos',
      },
    });
    check(
      'com reaproveitamento, a frase cita o documento E o nome do cadastro',
      comReuso.includes(CNPJ_MASCARA) && comReuso.includes(CARRELLII.fantasyName),
      comReuso,
    );
    check(
      'e afirma que NADA foi alterado no cadastro',
      /nada foi alterado/i.test(comReuso),
      comReuso,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
//
// O DEFEITO QUE ESTE BLOCO IMPEDE
// ─────────────────────────────────────────────────────────────────────────────
// `responsibles: { connect: { id } }` na criação da tarefa é UMA LINHA, e é a
// única coisa que faz a requisição — e o CLIENTE dela — continuarem visíveis
// para quem a abriu. Apagá-la não quebra teste nenhum, não muda o status HTTP e
// não aparece na tela de quem testa com um contato cuja empresa por acaso É a
// dona do veículo. Some semanas depois, no caso Furgões: a Ibiporã abre a
// requisição, o caminhão é da RKO, e o contato perde de vista o que ele mesmo
// pediu.
//
// A CADEIA INTEIRA, e é por isso que os três elos estão no mesmo bloco:
//
//   `responsibles.connect`  →  `taskScopeWhere` caminho (c)  →  `listCustomers`
//
// O terceiro elo é o que fecha o pedido do dono: um cliente REAPROVEITADO (§12)
// pode estar fora do escopo de quem o apontou, e é o vínculo da tarefa — não o
// cadastro — que o traz para a lista dele daí em diante.
async function vinculoDoRequisitante() {
  console.log('\n13. ⛔ O REQUISITANTE VIRA CONTATO DO VEÍCULO — o vínculo que sustenta tudo');

  const RESPONSAVEL = UUID(9);
  const EMPRESA_DO_CONTATO = UUID(8);
  const DONO_DO_IMPLEMENTO = UUID(7);
  const ORCAMENTO = UUID(6);

  let criacaoDaTarefa: any = null;
  const tx: any = {
    task: {
      create: async ({ data }: any) => {
        criacaoDaTarefa = data;
        return {
          id: 'task-1',
          implement: { id: 'implement-1', serialNumber: data.implement?.create?.serialNumber ?? null },
        };
      },
    },
  };

  const servico: any = new (PortalRequestService as any)(null, null, null, null, null, null);
  servico.logger = { log: () => {}, error: () => {} };

  const criado = await servico.criarVeiculo(tx, {
    indice: 0,
    veiculo: { serialNumber: '1001', plate: 'ABC1D23' },
    budgetId: ORCAMENTO,
    // ⚠️ O DONO DO CAMINHÃO NÃO É A EMPRESA DO CONTATO. É o caso Furgões, e é
    // justamente nele que o vínculo pessoal é a ÚNICA coisa que sustenta a
    // visibilidade.
    customerId: DONO_DO_IMPLEMENTO,
    customerName: 'RKO Transportes',
    paintId: null,
    responsibleId: RESPONSAVEL,
  });

  check('a tarefa nasceu', criado?.taskId === 'task-1');
  check(
    '⛔ e o REQUISITANTE ficou conectado a ela (`responsibles.connect`)',
    criacaoDaTarefa?.responsibles?.connect?.id === RESPONSAVEL,
    JSON.stringify(criacaoDaTarefa?.responsibles),
  );
  check(
    'sem que isso mexa no DONO do veículo — são eixos diferentes',
    criacaoDaTarefa?.customer?.connect?.id === DONO_DO_IMPLEMENTO,
    JSON.stringify(criacaoDaTarefa?.customer),
  );
  check(
    'e a tarefa entra no orçamento da requisição',
    criacaoDaTarefa?.quote?.connect?.id === ORCAMENTO,
  );

  // ── ELO 2: o escopo de LEITURA tem o caminho (c) ────────────────────────
  const escopo: any = new PortalScopeService();
  const where = escopo.taskScopeWhere({ id: RESPONSAVEL, companyId: EMPRESA_DO_CONTATO } as any);
  const caminhos = (where?.OR ?? []) as any[];
  check(
    'o escopo de leitura tem o caminho (c) "eu sou contato deste veículo"',
    caminhos.some(c => c?.responsibles?.some?.id === RESPONSAVEL),
    JSON.stringify(where),
  );
  check(
    '⚠️ e ele NÃO confere contra o dono do veículo — é o que atravessa empresas',
    caminhos.some(c => c?.responsibles?.some?.id === RESPONSAVEL && !('customerId' in c)),
    JSON.stringify(where),
  );

  // ── ELO 3: o ALCANCE DE CLIENTE, e o fato de haver UM só ────────────────
  //
  // O predicado morava embutido em `listCustomers`, e por isso decidia apenas o
  // que o COMBOBOX oferecia — a requisição resolvia cliente e pagador com um
  // `findUnique` pelo id cru. Lista não é guarda: quem mandasse o `customerId`
  // de qualquer empresa da base criava orçamento em nome dela e podia elegê-la
  // como PAGADORA, que é a âncora do dinheiro. Ele passou a morar em
  // `PortalScopeService.customerScopeWhere`, e estas asserções exigem as duas
  // metades: que o predicado exista lá, e que o catálogo o USE em vez de ter
  // uma segunda cópia — duas cópias divergiriam no primeiro conserto.
  const fonteDoEscopo = readFileSync(
    join(__dirname, '..', 'src/modules/people/portal/portal-scope.service.ts'),
    'utf8',
  );
  const catalogo = readFileSync(
    join(__dirname, '..', 'src/modules/people/portal/portal-catalog.service.ts'),
    'utf8',
  );
  check(
    '`customerScopeWhere` alcança o cliente PELAS TAREFAS em escopo',
    /tasks:\s*\{\s*some:\s*this\.taskScopeWhere\(principal\)\s*\}/.test(fonteDoEscopo),
  );
  check(
    'além da própria empresa do contato e dos orçamentos que ela paga',
    /\{\s*id:\s*companyId\s*\}/.test(fonteDoEscopo) &&
      /quoteCustomerConfigs:\s*\{\s*some:\s*\{\s*quote:\s*this\.budgetScopeWhere\(principal\)/.test(
        fonteDoEscopo,
      ),
  );
  check(
    '⛔ e o catálogo CHAMA o predicado, em vez de ter a segunda cópia dele',
    /this\.scope\.customerScopeWhere\(principal\)/.test(catalogo) &&
      !/quoteCustomerConfigs:\s*\{\s*some:\s*\{\s*quote:\s*this\.scope\.budgetScopeWhere/.test(
        catalogo,
      ),
  );
  check(
    '⛔ e a REQUISIÇÃO também o chama — nos DOIS pontos (cliente e pagador)',
    (
      readFileSync(
        join(__dirname, '..', 'src/modules/people/portal/portal-request.service.ts'),
        'utf8',
      ).match(/this\.scope\.customerScopeWhere\(principal\)/g) ?? []
    ).length >= 2,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 14. AS QUATRO FACES E A PORTA TRASEIRA (P13a) — o veículo nasce inteiro
// ═══════════════════════════════════════════════════════════════════════════
//
// A frente e a porta existem no banco e na LEITURA do portal desde o P11b; até
// aqui a requisição não tinha como mandá-las, e o implemento nascia com três
// faces e porta nenhuma. Aqui o serviço é exercitado DE VERDADE (`criarVeiculo`
// + o escritor único de medida) sobre uma transação de mentira que registra o
// que seria gravado — o mesmo recurso dos blocos 12 e 13. A prova contra o
// BANCO do mesmo `criarVeiculo` está em `test:portal-identificacao`
// (`contraOBanco`), que roda numa transação desfeita.
async function quatroFacesEPorta() {
  console.log('\n14. AS QUATRO FACES E A PORTA TRASEIRA — o implemento nasce com série, `spot: null`, frente e porta');

  const CM = {
    esquerda: { height: 240, sections: [{ width: 620 }, { width: 180, isDoor: true, doorHeight: 210 }] },
    direita: { height: 240, sections: [{ width: 615 }, { width: 185 }] },
    traseira: { height: 245, sections: [{ width: 248 }] },
    frente: { height: 250, sections: [{ width: 246 }] },
  };

  // ── A BORDA ───────────────────────────────────────────────────────────────
  check(
    'LADO_DA_FACE cobre as quatro faces da API, com a frente',
    LADOS_DO_PORTAL.length === 4 && LADO_DA_FACE.front === 'frente' && LADO_DA_FACE.back === 'traseira',
    JSON.stringify(LADOS_DO_PORTAL),
  );
  const inteiro = portalVeiculoSchema.safeParse({
    serialNumber: '1001',
    category: 'TRUCK',
    type: 'DRY_CARGO',
    medidas: CM,
    portaTraseira: { abertura: 'TRIPARTIDA', varoes: 4, portinholas: 6 },
  });
  check('as QUATRO faces + a porta + `type` são aceitos', inteiro.success, motivos(inteiro));

  const nomeVelho = portalVeiculoSchema.safeParse({ serialNumber: '1001', implementType: 'DRY_CARGO' });
  check(
    '⛔ `implementType` (o nome antigo) é RECUSADO e nomeado — DD13; antes sumiria levando o tipo junto',
    !nomeVelho.success && /implementType/.test(JSON.stringify(nomeVelho.error.issues)),
    JSON.stringify(nomeVelho.success ? nomeVelho.data : nomeVelho.error.issues),
  );
  const ladoErrado = portalVeiculoSchema.safeParse({ serialNumber: '1001', medidas: { frontal: CM.frente } });
  check(
    '⛔ lado com o nome errado (`frontal`) é RECUSADO e nomeado',
    !ladoErrado.success && /frontal/.test(JSON.stringify(ladoErrado.error.issues)),
  );
  for (const [rotulo, porta] of [
    ['varões 5', { varoes: 5 }],
    ['portinholas 7', { portinholas: 7 }],
    ['abertura QUADRIPARTIDA', { abertura: 'QUADRIPARTIDA' }],
    ['chave desconhecida', { folhas: 'BIPARTIDA' }],
  ] as Array<[string, Record<string, unknown>]>) {
    const r = portalVeiculoSchema.safeParse({ serialNumber: '1001', portaTraseira: porta });
    check(`porta traseira fora da faixa na requisição — ${rotulo} → recusada`, !r.success);
  }
  check(
    'a abertura vira o enum do banco (TRIPARTIDA → TRIPARTITE)',
    portaParaPrisma({ abertura: 'TRIPARTIDA', varoes: 4, portinholas: 6 }).rearDoorLeaves === 'TRIPARTITE',
  );

  // ── O SERVIÇO, com a transação de mentira ─────────────────────────────────
  let criacao: any = null;
  const medidas: Array<{ id: string; data: any }> = [];
  const apontamentos: Record<string, string | null> = {};
  const tx: any = {
    task: {
      create: async ({ data }: any) => {
        criacao = data;
        return {
          id: 'task-14',
          implement: { id: 'impl-14', serialNumber: data.implement?.create?.serialNumber ?? null },
        };
      },
    },
    implement: {
      // O escritor lê a coluna da face antes de gravar: o implemento acabou de
      // nascer, então toda face está vazia.
      findUnique: async ({ select }: any) => ({
        id: 'impl-14',
        ...Object.fromEntries(Object.keys(select ?? {}).filter(k => k !== 'id').map(k => [k, null])),
      }),
      update: async ({ data }: any) => {
        Object.assign(apontamentos, data);
        return {};
      },
    },
    implementMeasure: {
      create: async ({ data }: any) => {
        const id = `medida-${medidas.length + 1}`;
        medidas.push({ id, data });
        return { id, height: data.height, sections: data.sections?.create ?? [] };
      },
    },
  };

  const servico: any = new (PortalRequestService as any)(null, null, null, null, null, null);
  const criado = await servico.criarVeiculo(tx, {
    indice: 0,
    veiculo: portalVeiculoSchema.parse({
      serialNumber: 'abc-1001',
      category: 'TRUCK',
      type: 'DRY_CARGO',
      medidas: CM,
      portaTraseira: { abertura: 'TRIPARTIDA', varoes: 4, portinholas: 6 },
    }),
    budgetId: UUID(6),
    customerId: UUID(7),
    customerName: 'RKO Transportes',
    paintId: null,
    responsibleId: UUID(9),
  });

  const nascido = criacao?.implement?.create ?? {};
  check(
    'o implemento nasce com a SÉRIE (maiúscula da borda) e `spot: null` explícito',
    nascido.serialNumber === 'ABC-1001' && 'spot' in nascido && nascido.spot === null,
    JSON.stringify(nascido),
  );
  check('e com `type` e categoria', nascido.type === 'DRY_CARGO' && nascido.category === 'TRUCK');
  check(
    'e com a PORTA TRASEIRA já no enum do banco (TRIPARTITE, 4, 6)',
    nascido.rearDoorLeaves === 'TRIPARTITE' && nascido.rearDoorBarCount === 4 && nascido.rearDoorHatchCount === 6,
    JSON.stringify(nascido),
  );
  check(
    'a série NÃO vai no topo da tarefa (DD14: a tarefa não tem a coluna)',
    !('serialNumber' in (criacao ?? {})),
  );
  check(
    'as QUATRO faces passam pelo escritor único (uma linha de medida por face)',
    medidas.length === 4,
    `${medidas.length} medida(s)`,
  );
  check(
    'e a FRENTE aponta a sua linha (`frontSideMeasureId`)',
    ['leftSideMeasureId', 'rightSideMeasureId', 'backSideMeasureId', 'frontSideMeasureId'].every(
      coluna => typeof apontamentos[coluna] === 'string',
    ),
    JSON.stringify(apontamentos),
  );
  const frente = medidas.find(m => m.id === apontamentos.frontSideMeasureId)?.data;
  check(
    'a frente vai em METROS (250 cm → 2,5 m; 246 cm → 2,46 m)',
    frente?.height === 2.5 && frente?.sections?.create?.[0]?.width === 2.46,
    JSON.stringify(frente),
  );
  check(
    'o recibo traz o id da medida das quatro faces, com a chave de borda',
    JSON.stringify(Object.keys(criado?.measureIds ?? {})) ===
      JSON.stringify(['esquerda', 'direita', 'traseira', 'frente']) &&
      criado.measureIds.frente === apontamentos.frontSideMeasureId,
    JSON.stringify(criado?.measureIds),
  );

  // Sem porta nem medida: nada de porta inventada.
  criacao = null;
  await servico.criarVeiculo(
    { ...tx, task: { create: async ({ data }: any) => ((criacao = data), { id: 't', implement: { id: 'i', serialNumber: null } }) } },
    {
      indice: 0,
      veiculo: portalVeiculoSchema.parse({ serialNumber: '1002' }),
      budgetId: UUID(6),
      customerId: UUID(7),
      customerName: 'RKO Transportes',
      paintId: null,
      responsibleId: UUID(9),
    },
  );
  check(
    'veículo sem porta nasce SEM as colunas da porta no `create` (nulas pelo banco, não inventadas)',
    criacao && !('rearDoorLeaves' in criacao.implement.create) && !('rearDoorBarCount' in criacao.implement.create),
    JSON.stringify(criacao?.implement?.create),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ OS BLOCOS 12, 13 E 14 SÃO ASSÍNCRONOS — eles EXERCITAM o serviço com um
// `prisma` de mentira, em vez de inspecionar a fonte. O resumo tem de esperá-los:
// um `process.exit` síncrono aqui embaixo encerraria o processo antes de a
// primeira asserção deles rodar, e o teste passaria sem ter testado nada.
// ═══════════════════════════════════════════════════════════════════════════
void (async () => {
  await reaproveitamentoDoCadastro();
  await vinculoDoRequisitante();
  await quatroFacesEPorta();

  console.log(
    failures === 0
      ? '\n✅ A requisição do portal está de pé: documento exigido na porta, série em texto, centímetro virando metro, colisão nomeada antes de escrever, cadastro que já existe REAPROVEITADO e o requisitante conectado ao veículo.\n'
      : `\n❌ ${failures} verificação(ões) falharam.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
})();
