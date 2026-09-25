/**
 * "PARA EMITIR FALTA…" NO PORTAL — o `emission` do P14 dito ao cliente
 * (integração do par [P14 ∥ P13b]).
 *
 * `npm run test:portal-emissao`
 *
 *   · a tradução é por CÓDIGO do portão, nunca pela frase interna (que cita
 *     cadastro de pagador e validade — o checklist do comercial);
 *   · sem faixa quando já há documento (AWAITING_*, SIGNED, SIGNED_OFFLINE) ou
 *     quando a bola é da Ankaa (REQUESTED, PENDING);
 *   · com banco: `PortalReadService.getBudget` devolve `emission` no detalhe.
 */
process.env.TZ = 'America/Sao_Paulo';

import { readFileSync } from 'fs';
import { join } from 'path';
import { portalEmissionOf } from '../src/modules/people/portal/portal-emission';

let failures = 0;
let passes = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const em = (codes: string[]) => ({
  ready: codes.length === 0,
  blockers: codes.map(code => ({ code: code as any, message: `interno: ${code} com cadastro de pagador` })),
});

async function main() {
  console.log('\nA tabela (pura)');
  const a = portalEmissionOf(em(['VALUE_NOT_APPROVED', 'ARTWORK_PENDING']), { status: 'IN_NEGOTIATION', signatureStatus: 'NOT_ISSUED' });
  check(
    'valor e arte faltando: duas frases de cliente, na ordem',
    JSON.stringify(a?.missing) === JSON.stringify(['a aprovação do valor', 'a arte aprovada de cada veículo']),
    JSON.stringify(a),
  );
  check('a faixa pronta', a?.label === 'Para emitir falta: a aprovação do valor; a arte aprovada de cada veículo.');
  check('a frase INTERNA nunca vaza', !JSON.stringify(a).includes('pagador'));
  const b = portalEmissionOf(em(['TWO_PAYERS', 'VALIDITY_EXPIRED', 'RESPONSIBLES']), { status: 'APPROVED', signatureStatus: 'NOT_ISSUED' });
  check('os três da Ankaa viram UMA frase', b?.missing.length === 1 && /Ankaa/.test(b.missing[0]), JSON.stringify(b));
  const c = portalEmissionOf(em([]), { status: 'APPROVED', signatureStatus: 'INVALIDATED' });
  check('nada faltando: pronto, sem faixa', c?.ready === true && c.label === null && c.missing.length === 0);
  for (const s of ['AWAITING_CUSTOMER', 'AWAITING_ANKAA', 'SIGNED', 'SIGNED_OFFLINE']) {
    check(`já há documento (${s}): sem faixa`, portalEmissionOf(em(['ENVELOPE_LIVE']), { status: 'APPROVED', signatureStatus: s }) === null);
  }
  for (const s of ['REQUESTED', 'PENDING', 'CANCELLED', 'EXPIRED']) {
    check(`bola com a Ankaa (${s}): sem faixa`, portalEmissionOf(em(['VALUE_NOT_APPROVED']), { status: s, signatureStatus: 'NOT_ISSUED' }) === null);
  }
  check(
    'E3 sozinho não vira "falta" (a coleta é da tela de Assinaturas)',
    portalEmissionOf(em(['ENVELOPE_LIVE']), { status: 'APPROVED', signatureStatus: 'REFUSED' })?.missing.length === 0,
  );

  console.log('\nA ligação (fonte)');
  const src = readFileSync(join(__dirname, '..', 'src', 'modules/people/portal/portal-read.service.ts'), 'utf8');
  const detalhe = src.slice(src.indexOf('async getBudget('), src.indexOf('private budgetSelect('));
  check('getBudget chama emissionOf do P14', /emissionOf\(this\.prisma, id\)/.test(detalhe));
  check('e traduz por portalEmissionOf', /portalEmissionOf\(/.test(detalhe));
  check('o select do orçamento traz signatureStatus', /signatureStatus: true/.test(src));

  console.log(
    `\n${failures === 0 ? `✅ emissão no portal: ${passes} verificações passaram.` : `❌ ${failures} verificação(ões) falharam (${passes} passaram).`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('❌ O teste estourou:', e?.message ?? e);
  process.exit(1);
});
