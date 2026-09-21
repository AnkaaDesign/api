/**
 * O ESCOPO DO PORTAL — quais LINHAS um contato de cliente pode ver.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * Escopo frouxo não devolve erro. Devolve DADO — o dado de outra empresa — e a
 * consulta parece estar funcionando. As três formas exatas em que isso acontece
 * neste repositório estão verificadas abaixo:
 *
 *   1. `Responsible.companyId` é NULLABLE. Um `where` montado sem guarda vira
 *      `WHERE customerId IS NULL`, que no Postgres NÃO é "nada": é "todos os
 *      órfãos". O contato sem empresa receberia a lista dos orçamentos de todo
 *      mundo que também está sem empresa.
 *
 *   2. No Prisma, `{ customerId: undefined }` não é "nenhum cliente" — é "sem
 *      filtro", e a cláusula inteira DESAPARECE. É a mesma família do defeito já
 *      registrado neste repositório: `{ AND: [{ OR: [] }] }` devolve A TABELA,
 *      porque o `OR` vazio evapora aninhado.
 *
 *   3. `customerConfigs: true` num include devolve o cadastro fiscal, as
 *      parcelas, os boletos e as notas de TODOS os pagadores.
 *      `GET /budgets/public/:id` erra exatamente isso hoje.
 *
 * Nada aqui toca no banco: o que se verifica é a FORMA do objeto de `where` —
 * que todo ramo exista, que nenhum esteja vazio e que nenhum id seja nulo ou
 * indefinido. É o mesmo método de `test:responsible-otp`.
 *
 * `npm run test:portal-escopo`
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { PortalScopeService } from '../src/modules/people/portal/portal-scope.service';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function threw(fn: () => unknown): { ok: boolean; name: string; message: string } {
  try {
    fn();
    return { ok: false, name: '', message: '' };
  } catch (e: any) {
    return { ok: true, name: e?.constructor?.name ?? '', message: e?.message ?? '' };
  }
}

/** Todos os caminhos folha do objeto, como `a.b[0].c = valor`. */
function leaves(node: unknown, path = ''): Array<{ path: string; value: unknown }> {
  if (Array.isArray(node)) {
    return node.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  }
  if (node && typeof node === 'object') {
    const entries = Object.entries(node as Record<string, unknown>);
    if (!entries.length) return [{ path, value: node }];
    return entries.flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  return [{ path, value: node }];
}

const scope = new PortalScopeService();

const COMPANY = 'c0mpany-uuid-ibipora';
const RESPONSIBLE = 'resp-uuid-fulano';
const principal = { id: RESPONSIBLE, companyId: COMPANY };

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nA GUARDA — responsável sem empresa é RECUSADO antes do `where`');
// ─────────────────────────────────────────────────────────────────────────────
{
  const semEmpresa = threw(() => scope.assertScoped({ id: RESPONSIBLE, companyId: null }));
  check('companyId nulo => lança', semEmpresa.ok);
  check(
    'e é ForbiddenException (403), não 401',
    semEmpresa.name === 'ForbiddenException',
    semEmpresa.name,
  );

  check(
    'companyId string vazia => lança',
    threw(() => scope.assertScoped({ id: RESPONSIBLE, companyId: '' })).ok,
  );
  check(
    'companyId só com espaço => lança (o `.trim()` é parte da guarda)',
    threw(() => scope.assertScoped({ id: RESPONSIBLE, companyId: '   ' })).ok,
  );
  check(
    'companyId undefined => lança',
    threw(() => scope.assertScoped({ id: RESPONSIBLE } as any)).ok,
  );
  check('principal ausente => lança', threw(() => scope.assertScoped(null)).ok);
  check(
    'principal sem id => lança',
    threw(() => scope.assertScoped({ id: '', companyId: COMPANY })).ok,
  );

  const ok = scope.assertScoped(principal);
  check(
    'com os dois ids, devolve o par',
    ok.companyId === COMPANY && ok.responsibleId === RESPONSIBLE,
  );
  check(
    'e devolve APARADO (espaço à volta do id não vira id diferente)',
    scope.assertScoped({ id: ` ${RESPONSIBLE} `, companyId: ` ${COMPANY} ` }).companyId === COMPANY,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nA guarda é INESCAPÁVEL — todo `where` passa por ela');
// ─────────────────────────────────────────────────────────────────────────────
{
  // O defeito de verdade não é esquecer a guarda uma vez: é montar o `where`
  // SEM ela e o resultado parecer certo. Por isso nenhum destes métodos aceita
  // um principal sem empresa — a recusa não é do chamador.
  const orfao = { id: RESPONSIBLE, companyId: null };
  check('budgetScopeWhere recusa órfão', threw(() => scope.budgetScopeWhere(orfao)).ok);
  check('taskScopeWhere recusa órfão', threw(() => scope.taskScopeWhere(orfao)).ok);
  check(
    'commercialTaskScopeWhere recusa órfão',
    threw(() => scope.commercialTaskScopeWhere(orfao)).ok,
  );
  check('payerScopeSelect recusa órfão', threw(() => scope.payerScopeSelect(orfao)).ok);
  check('invoiceScopeWhere recusa órfão', threw(() => scope.invoiceScopeWhere(orfao)).ok);

  // E a trava estrutural: o corpo de cada método CHAMA `assertScoped`. Sem
  // isto, um método novo nasceria sem guarda e passaria em todos os testes
  // acima, que só olham os métodos que já existem.
  const fonte = readFileSync(
    join(__dirname, '../src/modules/people/portal/portal-scope.service.ts'),
    'utf8',
  );
  for (const metodo of [
    'budgetScopeWhere',
    'taskScopeWhere',
    'commercialTaskScopeWhere',
    'payerScopeSelect',
    'invoiceScopeWhere',
  ]) {
    const inicio = fonte.indexOf(`  ${metodo}(`);
    const corpo = inicio >= 0 ? fonte.slice(inicio, fonte.indexOf('\n  }', inicio)) : '';
    check(
      `${metodo} chama this.assertScoped no próprio corpo`,
      corpo.includes('this.assertScoped('),
    );
  }
  // E nenhum deles lê `principal.companyId` direto depois da guarda: o valor
  // usado tem de ser o do par devolvido, que o compilador sabe ser `string`.
  check(
    'nenhum método usa `principal.companyId` no `where`',
    !/companyId:\s*principal\.companyId/.test(fonte),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nbudgetScopeWhere — os TRÊS caminhos, em união');
// ─────────────────────────────────────────────────────────────────────────────
{
  const where = scope.budgetScopeWhere(principal) as any;
  const ramos: any[] = where.OR ?? [];

  check('é um OR (união), não um AND (interseção)', Array.isArray(where.OR) && !('AND' in where));
  check('tem exatamente 3 ramos', ramos.length === 3, `${ramos.length}`);
  check(
    '⛔ o OR NUNCA é vazio — `{ OR: [] }` aninhado evapora e devolve a tabela',
    ramos.length > 0,
  );
  check(
    'nenhum ramo é `{}`',
    ramos.every(r => Object.keys(r ?? {}).length > 0),
  );

  // (a) minha empresa PAGA — o caso Furgões 259-262: dois clientes, UM Billing.
  check(
    '(a) paga: billings.some.customerConfigs.some.customerId',
    ramos[0]?.billings?.some?.customerConfigs?.some?.customerId === COMPANY,
  );
  check(
    '(a) a âncora é o PAGADOR do Billing, não `Budget.customerConfigs` (lista depreciada)',
    'billings' in (ramos[0] ?? {}) && !('customerConfigs' in (ramos[0] ?? {})),
  );

  // (b) minha empresa é DONA do veículo.
  check('(b) dona: tasks.some.customerId', ramos[1]?.tasks?.some?.customerId === COMPANY);

  // (c) EU sou contato do veículo — o único caminho PESSOAL, e o que faz a
  // intermediação da Furgões funcionar quando o caminhão é da RKO.
  check(
    '(c) contato: tasks.some.responsibles.some.id === responsibleId',
    ramos[2]?.tasks?.some?.responsibles?.some?.id === RESPONSIBLE,
  );
  check(
    '(c) usa o id do RESPONSÁVEL, não o da empresa',
    ramos[2]?.tasks?.some?.responsibles?.some?.id !== COMPANY,
  );

  // A varredura que pega o defeito de verdade.
  const folhas = leaves(where);
  const indefinidas = folhas.filter(f => f.value === undefined);
  const nulas = folhas.filter(f => f.value === null);
  check(
    '⛔ NENHUMA folha é `undefined` (no Prisma isso é "sem filtro")',
    indefinidas.length === 0,
    indefinidas.map(f => f.path).join(', '),
  );
  check(
    '⛔ NENHUMA folha é `null` (isso vira `IS NULL` = todos os órfãos)',
    nulas.length === 0,
    nulas.map(f => f.path).join(', '),
  );
  check(
    'toda folha é um dos dois ids conhecidos',
    folhas.every(f => f.value === COMPANY || f.value === RESPONSIBLE),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\ntaskScopeWhere — as mesmas três ideias, um nível abaixo');
// ─────────────────────────────────────────────────────────────────────────────
{
  const where = scope.taskScopeWhere(principal) as any;
  const ramos: any[] = where.OR ?? [];

  check('é um OR com 3 ramos', Array.isArray(where.OR) && ramos.length === 3, `${ramos.length}`);

  check(
    '(a) paga por ESTE veículo: billingEntry.is.billing.customerConfigs.some.customerId',
    ramos[0]?.billingEntry?.is?.billing?.customerConfigs?.some?.customerId === COMPANY,
  );
  check(
    '(a) usa `is` e não `some` — `Task.billingEntry` é de-UM (`BillingTask.@@unique([taskId])`)',
    'is' in (ramos[0]?.billingEntry ?? {}) && !('some' in (ramos[0]?.billingEntry ?? {})),
  );
  check('(b) o veículo é da minha empresa: customerId', ramos[1]?.customerId === COMPANY);
  check(
    '(c) eu sou contato DESTE veículo: responsibles.some.id',
    ramos[2]?.responsibles?.some?.id === RESPONSIBLE,
  );

  const folhas = leaves(where);
  check(
    'nenhuma folha indefinida',
    folhas.every(f => f.value !== undefined),
  );
  check(
    'nenhuma folha nula',
    folhas.every(f => f.value !== null),
  );
  check(
    'nenhum ramo é `{}`',
    ramos.every(r => Object.keys(r ?? {}).length > 0),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\ncommercialTaskScopeWhere — (a) e (b), SEM o (c): o corte do PEDIDO DE COMPRA');
// ─────────────────────────────────────────────────────────────────────────────
//
// ⛔ LER NÃO É ESCREVER. O caminho (c) — "eu sou contato deste veículo" — é
// PESSOAL: `Task.responsibles` é m:n e NADA confere contra `Task.customerId`. É
// legítimo para LER (é a única modelagem de intermediação que existe), e é
// perigoso para ESCREVER o pedido de compra: um contato pendurado por cadastro
// num caminhão de terceiro carimbaria nele o pedido da empresa dele, e o
// `@@unique([customerId, number])` não perceberia — o pedido está certo, errado
// está o vínculo.
//
// ⚠️ E o corte estreito NÃO pode ser `task.customerId === companyId`: era isso
// que recusava o caso Furgões (a Ibiporã emite, o caminhão é da RKO).
{
  const estreito = scope.commercialTaskScopeWhere(principal) as any;
  const amplo = scope.taskScopeWhere(principal) as any;
  const ramos: any[] = estreito.OR ?? [];

  check('é um OR com 2 ramos', Array.isArray(estreito.OR) && ramos.length === 2, `${ramos.length}`);
  check(
    '(a) é EXATAMENTE o mesmo ramo do corte amplo — uma expressão, não duas',
    JSON.stringify(ramos[0]) === JSON.stringify((amplo.OR ?? [])[0]),
  );
  check(
    '(b) também',
    JSON.stringify(ramos[1]) === JSON.stringify((amplo.OR ?? [])[1]),
  );
  check(
    '⛔ e o (c) NÃO está aqui — nenhuma menção a `responsibles`',
    !JSON.stringify(estreito).includes('responsibles'),
    JSON.stringify(estreito),
  );
  check(
    'o corte de LEITURA segue com os três (ler não é escrever)',
    JSON.stringify(amplo).includes('responsibles'),
  );

  const folhas = leaves(estreito);
  check(
    'nenhuma folha indefinida ou nula',
    folhas.every(f => f.value !== undefined && f.value !== null),
  );
  check(
    'nenhum ramo é `{}`',
    ramos.every(r => Object.keys(r ?? {}).length > 0),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\npayerScopeSelect — o fragmento que todo include de pagador espalha');
// ─────────────────────────────────────────────────────────────────────────────
{
  const frag = scope.payerScopeSelect(principal) as any;
  check('devolve `{ where: … }` (espalhável)', 'where' in frag);
  check('o corte é por customerId', frag.where?.customerId === COMPANY);
  check('e só por ele', Object.keys(frag.where).length === 1, Object.keys(frag.where).join(','));
  check(
    'customerId não é nulo nem indefinido',
    typeof frag.where.customerId === 'string' && frag.where.customerId.length > 0,
  );

  // O uso pretendido: espalhar ANTES do select, de modo que quem escrever
  // `customerConfigs: { select: … }` sem o fragmento produza um objeto
  // visivelmente diferente deste.
  const include = { customerConfigs: { ...frag, select: { id: true } } } as any;
  check(
    'espalhado, produz `customerConfigs.where.customerId`',
    include.customerConfigs.where.customerId === COMPANY,
  );
  check(
    '⛔ e NUNCA `customerConfigs: true` — a forma que vaza o cadastro fiscal de todos os pagadores',
    include.customerConfigs !== true,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\ninvoiceScopeWhere — a âncora do dinheiro é Invoice.customerId');
// ─────────────────────────────────────────────────────────────────────────────
{
  const where = scope.invoiceScopeWhere(principal) as any;
  check('corta por customerId', where.customerId === COMPANY);
  check(
    '⛔ NÃO por `customerConfigId` — coluna opcional que fica órfã numa reversão',
    !('customerConfigId' in where),
  );
  check('sem nenhuma outra chave', Object.keys(where).length === 1);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nDOIS CONTATOS DIFERENTES NUNCA PRODUZEM O MESMO `where`');
// ─────────────────────────────────────────────────────────────────────────────
{
  const a = scope.budgetScopeWhere({ id: 'resp-A', companyId: 'empresa-A' });
  const b = scope.budgetScopeWhere({ id: 'resp-B', companyId: 'empresa-B' });
  check('empresas diferentes => `where` diferentes', JSON.stringify(a) !== JSON.stringify(b));
  check(
    'o id de A não aparece no `where` de B',
    !JSON.stringify(b).includes('resp-A') && !JSON.stringify(b).includes('empresa-A'),
  );

  // Mesma empresa, contatos diferentes: os caminhos (a) e (b) coincidem — é o
  // que faz dois contatos da mesma empresa verem o mesmo. O (c) diverge, e é
  // ele que acrescenta o veículo intermediado a UM deles.
  const c1 = scope.budgetScopeWhere({ id: 'resp-1', companyId: COMPANY }) as any;
  const c2 = scope.budgetScopeWhere({ id: 'resp-2', companyId: COMPANY }) as any;
  check(
    'mesma empresa: (a) e (b) são idênticos',
    JSON.stringify(c1.OR.slice(0, 2)) === JSON.stringify(c2.OR.slice(0, 2)),
  );
  check(
    'mesma empresa: (c) é PESSOAL e diverge',
    JSON.stringify(c1.OR[2]) !== JSON.stringify(c2.OR[2]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nO PRINCIPAL VEM DE `request.responsible` — nunca de `request.user`');
// ─────────────────────────────────────────────────────────────────────────────
{
  const dir = join(__dirname, '../src/modules/people/portal');
  for (const nome of [
    'portal-scope.service.ts',
    'portal-projection.service.ts',
    'portal-roles.decorator.ts',
    'portal-capabilities.ts',
    'portal.module.ts',
  ]) {
    const fonte = readFileSync(join(dir, nome), 'utf8');
    // `request.user` é lido por `@UserId()` (827 pontos), pelo
    // `UserContextInterceptor`, pelo `MoneyRedactionInterceptor` e pelo
    // changelog. Um contato de cliente ali vira id gravado em FK de `User` —
    // 46 delas NOT NULL.
    const linhasComUser = fonte
      .split('\n')
      .filter(
        l =>
          /request\??\.user\b/.test(l) &&
          !l.trimStart().startsWith('//') &&
          !l.trimStart().startsWith('*'),
      );
    check(`${nome} não lê request.user`, linhasComUser.length === 0, linhasComUser.join(' | '));
    check(`${nome} não usa @UserId()`, !/@UserId\s*\(/.test(fonte));
  }
}

console.log(
  `\n${failures === 0 ? '✓ TODAS as verificações passaram' : `✗ ${failures} falha(s)`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
