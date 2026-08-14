/**
 * Guarda do diff do orçamento — o que o cliente e o operador leem quando uma
 * coleta de assinaturas é invalidada.
 *
 * O bug que originou este módulo: a invalidação relatava "Alteração em: valor
 * total (12000.00 → 13500.00), serviços, desconto." Nem o signatário que teve a
 * assinatura anulada nem o operador conseguiam descobrir QUAL serviço mudou, se
 * um item entrou ou saiu, ou de quanto para quanto foi o desconto.
 *
 * O que este arquivo protege é a leitura, não o hash. A decisão de invalidar
 * continua sendo por `materialHash` (ver `QuoteSnapshotService`); aqui se
 * verifica que a EXPLICAÇÃO dessa decisão é fiel e legível:
 *
 *  · um preço alterado não pode virar "removido + incluído";
 *  · uma correção de grafia não pode ser reportada como alteração material —
 *    foi assim que o orçamento nº 590 perdeu uma assinatura válida;
 *  · inclusão e remoção precisam sair com o nome do serviço e o valor.
 *
 * Rodar: pnpm tsx tests/quote-diff.test.ts
 */

import {
  describeQuoteChanges,
  diffQuoteSnapshots,
  type QuoteChange,
} from '../src/modules/common/signature/services/quote-diff';
import {
  QuoteSnapshotService,
  type QuoteSnapshot,
} from '../src/modules/common/signature/services/quote-snapshot.service';

// O serviço só toca no Prisma nos métodos que carregam o orçamento; projeção e
// hash são puros, então um construtor vazio basta para exercitá-los.
const snapshots = new QuoteSnapshotService(null as never);

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function baseSnapshot(): QuoteSnapshot {
  return {
    schemaVersion: 2,
    budgetNumber: 590,
    issuedAt: '2026-07-01T12:00:00.000Z',
    expiresAt: '2026-08-01T12:00:00.000Z',
    customer: {
      id: 'cust-1',
      corporateName: 'Transportes Andrade LTDA',
      fantasyName: 'Andrade',
      document: '13636938000144',
    },
    task: { id: 'task-1', name: 'Baú 14m', serialNumber: 'SN-1' },
    truck: { plate: 'ABC1D23', chassisNumber: '9BW', category: 'CARRETA', implementType: 'BAU' },
    services: [
      { description: 'Pintura completa do baú', amount: '12000.00', observation: null, position: 0 },
      { description: 'Aplicação de faixas', amount: '1800.00', observation: 'Vinil 3M', position: 1 },
    ],
    subtotal: '13800.00',
    total: '13800.00',
    discount: { type: 'NONE', value: null, reference: null },
    paymentCondition: '30/60 dias',
    customPaymentText: null,
    guaranteeYears: 3,
    customGuaranteeText: null,
    customForecastDays: 15,
    simultaneousTasks: 1,
    layoutFileIds: ['file-a'],
    signers: [
      { responsibleId: 'resp-1', name: 'Paulo Cvarvalho', phoneDigits: '5543999992403', emailNormalized: 'paulo@transportes.com.br', roles: ['COMMERCIAL'] },
    ],
    commercialUserId: 'user-1',
  };
}

/** Clona fundo o bastante para os testes mexerem sem contaminar o vizinho. */
function clone(s: QuoteSnapshot): QuoteSnapshot {
  return JSON.parse(JSON.stringify(s)) as QuoteSnapshot;
}

function find(changes: QuoteChange[], key: string): QuoteChange | undefined {
  return changes.find(c => c.key === key || c.key.startsWith(`${key}:`));
}

console.log('\nquote-diff — leitura das alterações do orçamento\n');

// ---------------------------------------------------------------------------
console.log('Nada mudou');
{
  const changes = diffQuoteSnapshots(baseSnapshot(), baseSnapshot());
  check('snapshots idênticos não produzem linha alguma', changes.length === 0, `${changes.length}`);
}

// ---------------------------------------------------------------------------
console.log('\nPreço de um serviço');
{
  const after = clone(baseSnapshot());
  after.services[0].amount = '13500.00';
  after.subtotal = '15300.00';
  after.total = '15300.00';
  const changes = diffQuoteSnapshots(baseSnapshot(), after);

  const price = find(changes, 'service:amount');
  check('sai como alteração de preço, não como troca de item', !!price, JSON.stringify(changes.map(c => c.key)));
  check('nomeia o serviço', price?.subject === 'Pintura completa do baú', price?.subject ?? 'null');
  check(
    'traz antes e depois em reais',
    price?.before?.includes('12.000,00') === true && price?.after?.includes('13.500,00') === true,
    `${price?.before} → ${price?.after}`,
  );
  check('calcula a variação com sinal', price?.amountDelta === 1500, String(price?.amountDelta));
  check('é material', price?.severity === 'MATERIAL');
  check('reporta o total junto', !!find(changes, 'total'));
  check(
    'nenhuma linha de inclusão ou remoção',
    !changes.some(c => c.kind === 'ADDED' || c.kind === 'REMOVED'),
  );
}

// ---------------------------------------------------------------------------
console.log('\nServiço incluído e serviço removido');
{
  const after = clone(baseSnapshot());
  after.services = [
    after.services[0],
    { description: 'Adesivagem da cabine', amount: '900.00', observation: null, position: 1 },
  ];
  after.subtotal = '12900.00';
  after.total = '12900.00';
  const changes = diffQuoteSnapshots(baseSnapshot(), after);

  const added = changes.find(c => c.kind === 'ADDED' && c.group === 'SERVICES');
  const removed = changes.find(c => c.kind === 'REMOVED' && c.group === 'SERVICES');
  check('inclusão nomeada com o valor', added?.subject === 'Adesivagem da cabine' && added?.after?.includes('900,00') === true);
  check('inclusão soma no delta', added?.amountDelta === 900, String(added?.amountDelta));
  check('remoção nomeada com o valor', removed?.subject === 'Aplicação de faixas' && removed?.before?.includes('1.800,00') === true);
  check('remoção subtrai no delta', removed?.amountDelta === -1800, String(removed?.amountDelta));
  check(
    'a reordenação mecânica não é reportada junto',
    !changes.some(c => c.key === 'service:order'),
  );
}

// ---------------------------------------------------------------------------
console.log('\nServiço reescrito — parecido o bastante para ser o mesmo');
{
  const after = clone(baseSnapshot());
  after.services[0].description = 'Pintura completa do baú e do chassi';
  after.services[0].amount = '13000.00';
  after.subtotal = '14800.00';
  after.total = '14800.00';
  const changes = diffQuoteSnapshots(baseSnapshot(), after);

  check(
    'não vira remoção + inclusão',
    !changes.some(c => c.group === 'SERVICES' && c.kind !== 'CHANGED'),
    JSON.stringify(changes.map(c => `${c.kind}:${c.key}`)),
  );
  check('reporta a descrição nova', find(changes, 'service:description')?.after?.includes('chassi') === true);
  check('e o preço junto', find(changes, 'service:amount')?.amountDelta === 1000);
}

// ---------------------------------------------------------------------------
console.log('\nDesconto');
{
  const after = clone(baseSnapshot());
  after.discount = { type: 'PERCENTAGE', value: '10.00', reference: 'Cliente fiel' };
  after.total = '12420.00';
  const changes = diffQuoteSnapshots(baseSnapshot(), after);

  const discount = find(changes, 'discount');
  check('sai em uma linha só', !!discount);
  check('antes legível', discount?.before === 'Sem desconto', discount?.before ?? 'null');
  check('depois com percentual e motivo', discount?.after === '10% · Cliente fiel', discount?.after ?? 'null');
  check('é material', discount?.severity === 'MATERIAL');
}

// ---------------------------------------------------------------------------
console.log('\nCorreção de grafia — o caso do orçamento nº 590');
{
  const after = clone(baseSnapshot());
  after.signers[0].name = 'Paulo Carvalho';
  const changes = diffQuoteSnapshots(baseSnapshot(), after);

  check('produz exatamente uma linha', changes.length === 1, String(changes.length));
  check('classificada como cosmética', changes[0]?.severity === 'COSMETIC', changes[0]?.severity);
  check(
    'nenhuma alteração material — a assinatura sobrevive',
    !changes.some(c => c.severity === 'MATERIAL'),
  );
}

// ---------------------------------------------------------------------------
console.log('\nChassi preenchido depois da assinatura');
{
  // O caso real: implemento 0 km, sem chassi na emissão do orçamento. O número
  // é registrado semanas depois, quando o veículo chega — e derrubava a coleta.
  const before = clone(baseSnapshot());
  before.truck!.chassisNumber = null;
  const after = clone(before);
  after.truck!.chassisNumber = '93KP0Y1C1TE216711';
  const changes = diffQuoteSnapshots(before, after);
  const chassis = find(changes, 'truckChassis');

  check('aparece na lista', !!chassis);
  check('classificado como cosmético', chassis?.severity === 'COSMETIC', chassis?.severity);
  check('nenhuma alteração material', !changes.some(c => c.severity === 'MATERIAL'));

  // O que de fato decide a invalidação é o hash, não a lista acima.
  check(
    'o recorte material não se move',
    snapshots.materialHash(before) === snapshots.materialHash(after),
  );
  check(
    'envelope congelado sob a v2 sobrevive ao preenchimento',
    snapshots.matchesFrozenTerms(after, snapshots.materialHash(before, 2), before) === 2,
  );

  // A placa continua sendo o identificador material do objeto do contrato.
  const otherTruck = clone(after);
  otherTruck.truck!.plate = 'XYZ9K88';
  check(
    'trocar a placa continua derrubando',
    find(diffQuoteSnapshots(before, otherTruck), 'truckPlate')?.severity === 'MATERIAL' &&
      snapshots.matchesFrozenTerms(otherTruck, snapshots.materialHash(before, 2), before) === null,
  );

  // A tolerância vale só para o chassi: qualquer outra diferença no recorte
  // legado tem de continuar derrubando mesmo com o congelado em mãos.
  const repriced = clone(after);
  repriced.total = '13500.00';
  check(
    'preço alterado junto com o chassi ainda derruba',
    snapshots.matchesFrozenTerms(repriced, snapshots.materialHash(before, 2), before) === null,
  );
}

// ---------------------------------------------------------------------------
console.log('\nPlaca: preencher não derruba, trocar derruba');
{
  // Implemento 0 km é orçado e assinado sem placa — ela chega quando o veículo
  // fica pronto. Mesma história do chassi, mas a placa continua no recorte
  // material, então a assimetria vive na comparação, não na projeção.
  const semPlaca = clone(baseSnapshot());
  semPlaca.truck!.plate = null;
  const emplacado = clone(semPlaca);
  emplacado.truck!.plate = 'ABC1D23';

  const fillIn = find(diffQuoteSnapshots(semPlaca, emplacado), 'truckPlate');
  check('preenchimento aparece na lista', !!fillIn);
  check('preenchimento é cosmético', fillIn?.severity === 'COSMETIC', fillIn?.severity);
  check(
    'emplacar não derruba a coleta',
    snapshots.matchesFrozenTerms(emplacado, snapshots.materialHash(semPlaca), semPlaca) !== null,
  );

  // Sem o congelado em mãos a comparação é estrita — nenhum chamador passa a
  // depender da tolerância por acidente.
  check(
    'sem baseline a comparação continua estrita',
    snapshots.matchesFrozenTerms(emplacado, snapshots.materialHash(semPlaca)) === null,
  );

  // A outra metade da regra: havia placa congelada, então ela tem de bater.
  const trocada = clone(emplacado);
  trocada.truck!.plate = 'XYZ9K88';
  const swap = find(diffQuoteSnapshots(emplacado, trocada), 'truckPlate');
  check('troca de placa é material', swap?.severity === 'MATERIAL', swap?.severity);
  check(
    'troca de placa derruba mesmo com o congelado em mãos',
    snapshots.matchesFrozenTerms(trocada, snapshots.materialHash(emplacado), emplacado) === null,
  );

  // Apagar a placa não é cadastro tardio — é o campo saindo do documento.
  const apagada = clone(emplacado);
  apagada.truck!.plate = null;
  check(
    'apagar a placa continua material',
    find(diffQuoteSnapshots(emplacado, apagada), 'truckPlate')?.severity === 'MATERIAL',
  );
  check(
    'apagar a placa derruba',
    snapshots.matchesFrozenTerms(apagada, snapshots.materialHash(emplacado), emplacado) === null,
  );

  // Preencher a placa junto com uma alteração real não pode servir de carona.
  const comDesconto = clone(emplacado);
  comDesconto.discount = { type: 'PERCENTAGE', value: '10.00', reference: 'Cliente fiel' };
  check(
    'desconto novo junto com o emplacamento ainda derruba',
    snapshots.matchesFrozenTerms(comDesconto, snapshots.materialHash(semPlaca), semPlaca) === null,
  );
}

// ---------------------------------------------------------------------------
console.log('\nResponsável entra e sai');
{
  const after = clone(baseSnapshot());
  after.signers = [
    { responsibleId: 'resp-2', name: 'Marina Alves', phoneDigits: '5543999991111', emailNormalized: 'marina@transportes.com.br', roles: ['ADMIN'] },
  ];
  const changes = diffQuoteSnapshots(baseSnapshot(), after);

  check('remoção nomeada', changes.some(c => c.kind === 'REMOVED' && c.subject === 'Paulo Cvarvalho'));
  check('inclusão nomeada', changes.some(c => c.kind === 'ADDED' && c.subject === 'Marina Alves'));
  check(
    'ambas materiais — quem assina o documento mudou',
    changes.filter(c => c.group === 'SIGNERS').every(c => c.severity === 'MATERIAL'),
  );
}

// ---------------------------------------------------------------------------
console.log('\nCanal do código: e-mail é material, telefone não é mais');
{
  // O e-mail passou a ser o canal do OTP. Trocá-lo no meio da coleta manda o
  // código para outra caixa, e isso tem de derrubar as assinaturas.
  const afterEmail = clone(baseSnapshot());
  afterEmail.signers[0].emailNormalized = 'outra.pessoa@gmail.com';
  const emailChanges = diffQuoteSnapshots(baseSnapshot(), afterEmail);
  const email = find(emailChanges, 'signer:email');
  check('e-mail é material', email?.severity === 'MATERIAL');
  check('e-mail sai mascarado', email?.after?.includes('*') === true, email?.after ?? 'null');
  check('não vaza o endereço inteiro', email?.after !== 'outra.pessoa@gmail.com');

  // O telefone deixou de receber o código quando a cerimônia migrou. Continua
  // sendo identidade do contato, mas corrigi-lo não pode custar uma assinatura.
  const afterPhone = clone(baseSnapshot());
  afterPhone.signers[0].phoneDigits = '5543988887777';
  const phoneChanges = diffQuoteSnapshots(baseSnapshot(), afterPhone);
  const phone = find(phoneChanges, 'signer:phone');
  check('telefone é cosmético', phone?.severity === 'COSMETIC');
  check('telefone sai mascarado', phone?.after?.includes('*') === true, phone?.after ?? 'null');
}

// ---------------------------------------------------------------------------
console.log('\nGarantia, prazo e validade');
{
  const after = clone(baseSnapshot());
  after.guaranteeYears = 1;
  after.customForecastDays = 30;
  after.expiresAt = '2026-09-01T12:00:00.000Z';
  const changes = diffQuoteSnapshots(baseSnapshot(), after);

  check('garantia em anos', find(changes, 'guaranteeYears')?.before === '3 anos');
  check('singular correto', find(changes, 'guaranteeYears')?.after === '1 ano');
  check('prazo em dias', find(changes, 'customForecastDays')?.after === '30 dias');
  check(
    'validade como data pt-BR',
    /^\d{2}\/\d{2}\/\d{4}$/.test(find(changes, 'expiresAt')?.after ?? ''),
    find(changes, 'expiresAt')?.after ?? 'null',
  );
}

// ---------------------------------------------------------------------------
console.log('\nEspaço em branco não é alteração');
{
  const after = clone(baseSnapshot());
  after.services[0].description = '  Pintura   completa do baú ';
  after.paymentCondition = '30/60 dias ';
  const changes = diffQuoteSnapshots(baseSnapshot(), after);
  check('nenhuma linha', changes.length === 0, JSON.stringify(changes.map(c => c.key)));
}

// ---------------------------------------------------------------------------
console.log('\nSnapshot antigo, sem os campos novos');
{
  const legacy = clone(baseSnapshot());
  delete (legacy as Partial<QuoteSnapshot>).services;
  delete (legacy as Partial<QuoteSnapshot>).signers;
  delete (legacy as Partial<QuoteSnapshot>).layoutFileIds;
  let threw = false;
  try {
    diffQuoteSnapshots(legacy, baseSnapshot());
  } catch {
    threw = true;
  }
  check('não explode — a lista é informativa, nunca pode derrubar a página', !threw);
}

// ---------------------------------------------------------------------------
console.log('\nSignatário congelado antes da v2 não inventa troca de e-mail');
{
  // Forma real de um snapshot anterior à migração de canal: tem `phoneDigits`,
  // não tem `emailNormalized`. Lido como "" e comparado com o endereço atual,
  // rendia uma linha "E-mail do responsável" MATERIAL em todo envelope antigo —
  // dizendo ao cliente que o e-mail dele mudou quando ninguém tocou nele.
  const before = clone(baseSnapshot());
  delete (before.signers[0] as Partial<(typeof before.signers)[0]>).emailNormalized;

  const after = clone(baseSnapshot());
  after.services[0].amount = '520.00'; // uma mudança REAL para o diff ter o que dizer

  const changes = diffQuoteSnapshots(before, after);
  check('nenhuma linha de e-mail', find(changes, 'signer:email') === undefined);
  check('a mudança real continua sendo relatada', changes.some(c => c.group === 'SERVICES'));

  // E quando os dois lados TÊM o campo, a troca real segue material.
  const b2 = clone(baseSnapshot());
  const a2 = clone(baseSnapshot());
  a2.signers[0].emailNormalized = 'outro@dominio.com.br';
  check('troca real ainda é material', find(diffQuoteSnapshots(b2, a2), 'signer:email')?.severity === 'MATERIAL');
}

// ---------------------------------------------------------------------------
console.log('\nFrase de resumo');
{
  const after = clone(baseSnapshot());
  after.services[0].amount = '13500.00';
  after.total = '15300.00';
  after.subtotal = '15300.00';
  const reason = describeQuoteChanges(
    diffQuoteSnapshots(baseSnapshot(), after).filter(c => c.severity === 'MATERIAL'),
  );
  check('nomeia o serviço em vez de dizer só "serviços"', reason.includes('Pintura completa do baú'), reason);
  check('mostra o valor', reason.includes('13.500,00'), reason);
  check('termina em ponto', reason.endsWith('.'), reason);
}

console.log(
  failures === 0 ? '\n✅ Todas as verificações passaram.\n' : `\n❌ ${failures} verificação(ões) falharam.\n`,
);
process.exit(failures === 0 ? 0 : 1);
