/**
 * O CONTRATO dos templates da Cloud API, conferido sem rede.
 *
 * `npm run test:whatsapp-templates` confere o catálogo contra a MEta — e por
 * isso só roda onde há credencial, que não é a máquina de desenvolvimento nem o
 * CI. O que sobra sem rede é a metade do contrato que mora no nosso lado: quantas
 * variáveis cada construtor envia, em que ordem, e se o valor que vai nelas
 * sobrevive às regras de envio da Meta.
 *
 * NÃO É REDUNDANTE COM O `tsc`. Trocar `budgetNumber` por `signerName` numa
 * lista de `bodyParams` é uma troca de `string` por `string`: compila, e produz
 * uma mensagem que diz o número do orçamento onde deveria dizer o nome do
 * cliente, já entregue, impossível de recolher.
 *
 * Rodar: npx tsx tests/signature-whatsapp-templates.test.ts
 */

import {
  SIGNATURE_WHATSAPP_TEMPLATE_NAMES,
  ankaaCountersignTemplate,
  collectionPausedTemplate,
  expiredTemplate,
  invitationTemplate,
  otpTemplate,
  refusedTemplate,
  reminderTemplate,
  voidedInternalTemplate,
  voidedTemplate,
  type SignatureWhatsAppTemplate,
} from '../src/modules/common/signature/signature-whatsapp-templates';
import { customerSideCompletedAt } from '../src/modules/common/signature/signature-reminder-cadence';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** As regras que a Meta aplica no ENVIO — e que recusam a mensagem inteira. */
function assertParamsSaneis(rotulo: string, t: SignatureWhatsAppTemplate) {
  check(`${rotulo}: idioma pt_BR`, t.language === 'pt_BR', t.language);
  check(`${rotulo}: tem nome`, !!t.name, t.name);
  for (const [i, p] of t.bodyParams.entries()) {
    check(`${rotulo}: {{${i + 1}}} não é vazio`, p.trim().length > 0, JSON.stringify(p));
    check(
      `${rotulo}: {{${i + 1}}} sem quebra de linha, tabulação ou corrida de espaços`,
      !/[\n\r\t]/.test(p) && !/ {2}/.test(p),
      JSON.stringify(p),
    );
  }
}

// ---------------------------------------------------------------------------
console.log('\nOs três templates acrescentados em 17/09');
{
  const pausada = collectionPausedTemplate({
    signerName: 'Ana Paula Ferreira',
    budgetNumber: 1459,
    refusedByName: 'Kennedy de Campos Teixeira',
  });
  check(
    'coleta pausada: nome do template',
    pausada.name === SIGNATURE_WHATSAPP_TEMPLATE_NAMES.COLLECTION_PAUSED,
    pausada.name,
  );
  check('coleta pausada: 3 variáveis', pausada.bodyParams.length === 3);
  check('coleta pausada: {{1}} é o PRIMEIRO nome de quem recebe', pausada.bodyParams[0] === 'Ana');
  check('coleta pausada: {{2}} é o orçamento', pausada.bodyParams[1] === '1459');
  check(
    'coleta pausada: {{3}} é o nome COMPLETO de quem recusou',
    pausada.bodyParams[2] === 'Kennedy de Campos Teixeira',
  );
  check('coleta pausada: sem botão', !pausada.urlButtonParam && !pausada.otpButtonParam);
  assertParamsSaneis('coleta pausada', pausada);

  const contra = ankaaCountersignTemplate({ signerName: 'Sergio Rodrigues', budgetNumber: 1459 });
  check(
    'contra-assinatura: nome do template',
    contra.name === SIGNATURE_WHATSAPP_TEMPLATE_NAMES.ANKAA_COUNTERSIGN,
    contra.name,
  );
  check('contra-assinatura: 2 variáveis', contra.bodyParams.length === 2);
  check('contra-assinatura: {{1}} primeiro nome', contra.bodyParams[0] === 'Sergio');
  check('contra-assinatura: {{2}} orçamento', contra.bodyParams[1] === '1459');
  // Sem botão de propósito: a tela exige login, e um botão para ela só produz
  // uma ida ao login sem contexto. Ver a nota no catálogo.
  check('contra-assinatura: sem botão', !contra.urlButtonParam && !contra.otpButtonParam);
  assertParamsSaneis('contra-assinatura', contra);

  const anulada = voidedInternalTemplate({
    signerName: 'Sergio Rodrigues',
    budgetNumber: 1459,
    reason: 'O valor foi corrigido.',
  });
  check(
    'anulada (interno): nome do template',
    anulada.name === SIGNATURE_WHATSAPP_TEMPLATE_NAMES.VOIDED_INTERNAL,
    anulada.name,
  );
  check('anulada (interno): 3 variáveis', anulada.bodyParams.length === 3);
  check('anulada (interno): {{3}} é o motivo', anulada.bodyParams[2] === 'O valor foi corrigido.');
  check(
    'anulada (interno) é um template DIFERENTE do do cliente',
    anulada.name !== SIGNATURE_WHATSAPP_TEMPLATE_NAMES.VOIDED,
  );
  assertParamsSaneis('anulada (interno)', anulada);
}

// ---------------------------------------------------------------------------
console.log('\nO motivo é texto que o cliente digitou — e a Meta recusa no ENVIO');
{
  const sujo = voidedInternalTemplate({
    signerName: 'Sergio',
    budgetNumber: 1459,
    reason: '  O preço\n  subiu\tmuito   mesmo  ',
  });
  check(
    'quebra de linha, tabulação e corrida de espaços são achatadas',
    sujo.bodyParams[2] === 'O preço subiu muito mesmo',
    JSON.stringify(sujo.bodyParams[2]),
  );

  const longo = voidedInternalTemplate({
    signerName: 'Sergio',
    budgetNumber: 1459,
    reason: 'palavra '.repeat(200),
  });
  check('motivo longo é cortado', longo.bodyParams[2].length <= 320, `${longo.bodyParams[2].length}`);
  check('e o corte é sinalizado', longo.bodyParams[2].endsWith('…'), longo.bodyParams[2].slice(-12));
  check('e não parte palavra no meio', !/palavr…$/.test(longo.bodyParams[2]));
}

// ---------------------------------------------------------------------------
console.log('\nNomes do catálogo são únicos — dois construtores no mesmo template mentem');
{
  const nomes = Object.values(SIGNATURE_WHATSAPP_TEMPLATE_NAMES);
  check('sem nome repetido', new Set(nomes).size === nomes.length, nomes.join(', '));
  check(
    'todo nome é minúsculo com _ (a Meta recusa maiúscula e hífen)',
    nomes.every(n => /^[a-z0-9_]+$/.test(n)),
    nomes.join(', '),
  );
}

// ---------------------------------------------------------------------------
console.log('\nOs construtores antigos não mudaram de forma');
{
  assertParamsSaneis(
    'convite',
    invitationTemplate({
      signerName: 'Ana Paula',
      budgetNumber: 1459,
      deadlineDate: '18/09/2026',
      accessToken: 'tok',
    }),
  );
  assertParamsSaneis('otp', otpTemplate({ code: '482913' }));
  assertParamsSaneis(
    'lembrete',
    reminderTemplate({
      signerName: 'Ana Paula',
      budgetNumber: 1459,
      deadlineDate: '18/09/2026',
      accessToken: 'tok',
    }),
  );
  assertParamsSaneis('vencido', expiredTemplate({ signerName: 'Ana', budgetNumber: 1459 }));
  assertParamsSaneis('anulada', voidedTemplate({ signerName: 'Ana', budgetNumber: 1459 }));
  assertParamsSaneis(
    'recusa',
    refusedTemplate({ refusedByName: 'Ana Paula', budgetNumber: 1459, reason: 'Preço alto.' }),
  );
}

// ---------------------------------------------------------------------------
console.log('\nÂncora da cobrança da contra-assinatura (grupo 1)');
{
  const d = (iso: string) => new Date(iso);
  const SIGNED = 'SIGNED';

  check(
    'sem ninguém do cliente, não há âncora',
    customerSideCompletedAt([{ orderGroup: 1, status: 'PENDING', signedAt: null }]) === null,
  );
  check(
    'com um responsável pendente, não há âncora',
    customerSideCompletedAt([
      { orderGroup: 0, status: SIGNED, signedAt: d('2026-09-10T12:00:00Z') },
      { orderGroup: 0, status: 'PENDING', signedAt: null },
      { orderGroup: 1, status: 'PENDING', signedAt: null },
    ]) === null,
  );
  check(
    'todos assinados: a âncora é a assinatura MAIS RECENTE',
    customerSideCompletedAt([
      { orderGroup: 0, status: SIGNED, signedAt: d('2026-09-10T12:00:00Z') },
      { orderGroup: 0, status: SIGNED, signedAt: d('2026-09-14T08:30:00Z') },
      { orderGroup: 1, status: 'PENDING', signedAt: null },
    ])?.toISOString() === '2026-09-14T08:30:00.000Z',
  );
  check(
    'uma recusa do cliente derruba a âncora (não há o que contra-assinar)',
    customerSideCompletedAt([
      { orderGroup: 0, status: SIGNED, signedAt: d('2026-09-10T12:00:00Z') },
      { orderGroup: 0, status: 'REFUSED', signedAt: null },
    ]) === null,
  );
  check(
    'assinado sem carimbo de data não vira âncora',
    customerSideCompletedAt([{ orderGroup: 0, status: SIGNED, signedAt: null }]) === null,
  );
}

console.log('');
if (failures) {
  console.error(`❌ ${failures} verificação(ões) falharam.`);
  process.exit(1);
}
console.log('✅ Templates e âncora da cobrança: todas as verificações passaram.');
