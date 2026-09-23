/**
 * A DISCRIMINAÇÃO DA NFS-e MULTIVEÍCULO.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * No DANFSe nacional não há tabela de itens impressa: o quadro "Descrição do
 * Serviço" é TUDO o que o cliente e o fiscal leem. Uma fatura de quatro
 * caminhões saía com uma frase corrida ("Referente aos serviços executados em 4
 * veículos (séries 78000 a 78003).") e quem recebia a nota não sabia qual placa
 * estava sendo cobrada.
 *
 * As propriedades travadas aqui:
 *
 *   1. a nota de UM veículo não mudou — é o formato de todas as já emitidas;
 *   2. a de N veículos lista cada um, com série, placa e chassi;
 *   3. quando os N não cabem no teto de 11 linhas, a LISTA colapsa — nunca a
 *      lista de serviços, que é o que sustenta a nota perante o fisco;
 *   4. pedidos de compra divergentes vão veículo a veículo (o pedido mora na
 *      TAREFA), e iguais vão uma vez no cabeçalho;
 *   5. nenhuma linha passa de 255 caracteres e nenhum texto passa de 11 linhas.
 *
 * Rodar: `npx tsx tests/nfse-discriminacao.test.ts`
 */
import {
  DISCRIMINACAO_MAX_CHARS,
  DISCRIMINACAO_MAX_LINES,
  buildDiscriminacao,
} from '../src/modules/integrations/nfse/nfse-discriminacao';

let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const categoryLabels = { RIGID: 'Toco', TRUCK: 'Truck' };
const implementLabels = { REFRIGERATED: 'Refrigerado', DRY_CARGO: 'Carga seca' };

const vehicle = (n: number, extra: Record<string, unknown> = {}) => ({
  serialNumber: `7800${n}`,
  plate: `TES1T0${n + 1}`,
  chassisNumber: `9BM97902 6CS00662${n}`,
  category: 'RIGID',
  implementType: 'REFRIGERATED',
  ...extra,
});

const base = {
  budgetNumber: 984,
  services: ['Logomarca Lateral', 'Aerografia Traseira'],
  categoryLabels,
  implementLabels,
};

console.log('\n1. A nota de UM veículo não mudou');
{
  const text = buildDiscriminacao({
    ...base,
    orderNumber: '4000000',
    vehicles: [vehicle(0)],
  });
  const lines = text.split('\n');
  check('cabeçalho traz o pedido', lines[0] === 'Pedido: 4000000', lines[0]);
  check(
    'a frase do veículo é a de sempre',
    lines[1] ===
      'Referente aos serviços executados no veículo Toco Refrigerado de n série: 78000, ' +
        'placa: TES1T01, chassi: 9BM97902 6CS006620.',
    lines[1],
  );
  check('os serviços vêm sem rótulo, como sempre', lines[2] === 'Logomarca Lateral, Aerografia Traseira', lines[2]);
  check('não inventa linha de orçamento', lines.length === 3, String(lines.length));
}

console.log('\n2. Quatro veículos: um por linha, com série, placa e chassi');
{
  const text = buildDiscriminacao({
    ...base,
    orderNumber: '4000000',
    vehicles: [0, 1, 2, 3].map(n => vehicle(n)),
  });
  const lines = text.split('\n');
  check('identificação junta pedido e orçamento', lines[0] === 'Pedido: 4000000 - Orçamento nº 984', lines[0]);
  check('serviços rotulados', lines[1] === 'Serviços: Logomarca Lateral, Aerografia Traseira', lines[1]);
  check('título com contagem e tipo', lines[2] === 'Veículos (4) - Toco Refrigerado:', lines[2]);
  check(
    'primeiro veículo por extenso',
    lines[3] === '1) Série 78000 - Placa TES1T01 - Chassi 9BM97902 6CS006620',
    lines[3],
  );
  check('os quatro estão lá', lines.length === 7 && lines[6].startsWith('4)'), lines.join(' | '));
  check('sem pedido repetido por veículo', !lines[3].includes('Pedido'), lines[3]);
}

console.log('\n3. Tipos diferentes: o tipo sai do título e entra na linha');
{
  const text = buildDiscriminacao({
    ...base,
    orderNumber: '4000000',
    vehicles: [vehicle(0), vehicle(1, { category: 'TRUCK', implementType: 'DRY_CARGO' })],
  });
  const lines = text.split('\n');
  check('título sem tipo', lines[2] === 'Veículos (2):', lines[2]);
  check('linha 1 nomeia o tipo', lines[3].startsWith('1) Toco Refrigerado - Série'), lines[3]);
  check('linha 2 nomeia o outro tipo', lines[4].startsWith('2) Truck Carga seca - Série'), lines[4]);
}

console.log('\n4. Pedidos divergentes vão veículo a veículo');
{
  const text = buildDiscriminacao({
    ...base,
    orderNumber: '4000000, 4000001',
    vehicles: [vehicle(0, { orderNumber: '4000000' }), vehicle(1, { orderNumber: '4000001' })],
  });
  const lines = text.split('\n');
  check('cabeçalho não repete os pedidos', lines[0] === 'Orçamento nº 984', lines[0]);
  check('cada veículo com o seu pedido', lines[3].endsWith('Pedido 4000000') && lines[4].endsWith('Pedido 4000001'), lines.join(' | '));
}

console.log('\n5. Muitos veículos: colapsa a LISTA, nunca os serviços');
{
  const vehicles = Array.from({ length: 60 }, (_, i) => ({
    serialNumber: String(78000 + i),
    plate: `AAA${i}`,
    chassisNumber: null,
    category: 'RIGID',
    implementType: 'REFRIGERATED',
  }));
  const text = buildDiscriminacao({ ...base, orderNumber: '4000000', vehicles });
  const lines = text.split('\n');
  check('cabe no teto', lines.length <= DISCRIMINACAO_MAX_LINES, String(lines.length));
  check('serviços preservados', lines[1] === 'Serviços: Logomarca Lateral, Aerografia Traseira', lines[1]);
  check(
    'resumo com contagem, tipo e faixa',
    lines[2] === 'Referente aos serviços executados em 60 veículos Toco Refrigerado (séries 78000 a 78059).',
    lines[2],
  );
}

console.log('\n6. Descrição explícita substitui o corpo, nunca a identificação');
{
  const text = buildDiscriminacao({
    ...base,
    orderNumber: '4000000',
    description: 'Serviço combinado em reunião.',
    vehicles: [vehicle(0), vehicle(1)],
  });
  const lines = text.split('\n');
  check('pedido sobrevive', lines[0] === 'Pedido: 4000000 - Orçamento nº 984', lines[0]);
  check('corpo é a descrição', lines[1] === 'Serviço combinado em reunião.', lines[1]);
  check('veículos continuam listados', lines[2] === 'Veículos (2) - Toco Refrigerado:', lines[2]);
}

console.log('\n7. Sem veículo identificado: recuo para a OS');
{
  const text = buildDiscriminacao({
    ...base,
    orderNumber: '',
    vehicles: [],
    fallbackLabel: 'Ref. OS 78000',
  });
  check('usa o rótulo de recuo', text.split('\n')[0] === 'Ref. OS 78000', text);
}

console.log('\n8. Tetos: 11 linhas de 255 caracteres, sempre');
{
  const longService = 'X'.repeat(400);
  const text = buildDiscriminacao({
    ...base,
    orderNumber: '9'.repeat(300),
    services: [longService, longService, longService, longService],
    vehicles: [0, 1, 2, 3, 4, 5].map(n => vehicle(n, { chassisNumber: 'C'.repeat(300) })),
  });
  const lines = text.split('\n');
  check('nunca passa de 11 linhas', lines.length <= DISCRIMINACAO_MAX_LINES, String(lines.length));
  check(
    'nenhuma linha passa de 255 caracteres',
    lines.every(l => l.length <= DISCRIMINACAO_MAX_CHARS),
    String(Math.max(...lines.map(l => l.length))),
  );
}

console.log('\n9. Sem mapas passados: as palavras são as da NFS-e da tarefa (D-18)');
{
  // O perfil `nfseTask` da fonte única — NÃO o da tela ("Isoplastic",
  // "Carroceria"). Quem chamar o módulo sem mapas não pode mudar a nota.
  const text = buildDiscriminacao({
    budgetNumber: 984,
    services: ['Logomarca Lateral'],
    orderNumber: '',
    vehicles: [
      vehicle(0, { category: 'TRUCK', implementType: 'INSULATED' }),
      vehicle(1, { category: 'RIGID', implementType: 'FLATBED' }),
      vehicle(2, { category: 'BITRUCK', implementType: 'DRY_CARGO' }),
    ],
  });
  const lines = text.split('\n');
  check('Isotérmico', lines[3] === '1) Truck Isotérmico - Série 78000 - Placa TES1T01 - Chassi 9BM97902 6CS006620', lines[3]);
  check('Prancha/Plataforma', lines[4].startsWith('2) Toco Prancha/Plataforma - Série 78001'), lines[4]);
  check('Carga seca, com s minúsculo', lines[5].startsWith('3) Bitruck Carga seca - Série 78002'), lines[5]);
}

console.log(failures === 0 ? '\n✅ discriminação da NFS-e íntegra\n' : `\n❌ ${failures} falha(s)\n`);
process.exit(failures === 0 ? 0 : 1);
