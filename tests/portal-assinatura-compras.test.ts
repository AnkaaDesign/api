/**
 * O PORTÃO DO PEDIDO DE COMPRA E AS TRÊS CERIMÔNIAS DE ASSINATURA.
 *
 * `npm run test:portal-assinatura-compras`
 *
 * TSX PURO, SEM BANCO — a régua desta branch, no estilo de `test:responsible-otp`.
 * As três unidades que este arquivo percorre foram EXTRAÍDAS para arquivos sem
 * dependência nenhuma justamente para poderem ser percorridas:
 * `purchase-order-gate.ts`, `ceremony-kind.ts` e `signature.constants.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OS DOIS DEFEITOS QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. **`roles.includes(PURCHASING)` no lugar de `roles.length === 1`.**
 *    As duas expressões são quase idênticas de ler e opostas de efeito: a
 *    primeira barra o contato que acumula Compras com Comercial — quem recebe o
 *    documento inteiro e aprova o negócio —, travando a aprovação de um
 *    orçamento na pessoa errada. A tabela-verdade abaixo fixa as duas metades.
 *
 * 2. **Um valor novo de `SignatureAuthMethod` caindo em `OTP` por omissão.**
 *    `ceremonyKindOf` era um ternário de uma linha com QUATRO dependentes
 *    (`assertOtpCeremony`, `resendInvitation`, `noticeChannelOf`,
 *    `getPublicState.canSign`). Um método de SESSÃO tratado como OTP é um
 *    signatário assinando pelo link público sem código — uma capability de
 *    obrigar a empresa viajando por e-mail. O teste percorre TODO valor do enum
 *    e falha quando um deles não tem expectativa declarada aqui: acrescentar um
 *    valor passa a exigir uma decisão escrita.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { ResponsibleRole, SignatureAuthMethod } from '@prisma/client';
import {
  isSolePurchasingContact,
  purchaseOrderGateVerdict,
  taskHasPurchaseOrder,
  PURCHASE_ORDER_REQUIRED_MESSAGE,
} from '../src/modules/common/signature/purchase-order-gate';
import {
  ceremonyKindOfAuthMethod,
  isSessionCeremony,
} from '../src/modules/common/signature/ceremony-kind';
import {
  commercialTaskLink,
  commercialTaskWhereForCustomer,
  PortalScopeService,
} from '../src/modules/people/portal/portal-scope.service';
import { portalRefuseSchema } from '../src/schemas/signature';
import {
  acceptanceClauseFor,
  declarationKeysFor,
  declarationsFor,
  DECLARATION_KEYS,
  INTERNAL_DECLARATION_KEYS,
  PORTAL_DECLARATION_KEYS,
  AUTH_METHOD_LABELS,
  type CeremonyKind,
} from '../src/modules/common/signature/signature.constants';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const SRC = (rel: string) => readFileSync(join(__dirname, '..', 'src', rel), 'utf8');

/**
 * O CÓDIGO, sem os comentários.
 *
 * Existe porque duas das verificações abaixo perguntam "esta palavra NÃO
 * aparece" — e este repositório comenta muito, inclusive para dizer por que uma
 * palavra está ausente. Sem a limpeza, o comentário que explica a ausência de
 * `PRODUCTION_MANAGER` faz a asserção sobre `PRODUCTION_MANAGER` falhar: o teste
 * reprovaria justamente o arquivo que documenta a regra que ele fixa.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Um veículo COM pedido e um SEM, para a tabela-verdade. */
const comPedido = { id: 't1', label: '1001', customerOrderNumber: '8842' };
const semPedido = { id: 't2', label: '1002', customerOrderNumber: null };
const comFkSoh = { id: 't3', label: '1003', purchaseOrderId: 'po-1' };

// =============================================================================
console.log('\nO TESTE É LITERALMENTE `roles.length === 1 && roles[0] === PURCHASING`');
// =============================================================================
{
  check(
    'Compras sozinho É o caso da regra',
    isSolePurchasingContact([ResponsibleRole.PURCHASING]),
  );
  check(
    'Compras + Comercial NÃO é',
    !isSolePurchasingContact([ResponsibleRole.PURCHASING, ResponsibleRole.COMMERCIAL]),
  );
  check(
    'a ORDEM não muda nada (Comercial + Compras)',
    !isSolePurchasingContact([ResponsibleRole.COMMERCIAL, ResponsibleRole.PURCHASING]),
  );
  check('Comercial sozinho não é', !isSolePurchasingContact([ResponsibleRole.COMMERCIAL]));
  check('lista vazia não é', !isSolePurchasingContact([]));
  check('nulo não é, e não estoura', !isSolePurchasingContact(null));
  check('indefinido não é, e não estoura', !isSolePurchasingContact(undefined));

  // ⚠️ A ARMADILHA CENTRAL, escrita como asserção: `includes` e `length === 1`
  // divergem exatamente no acúmulo, que é o caso que o dono mandou NÃO barrar.
  const acumulado = [ResponsibleRole.PURCHASING, ResponsibleRole.COMMERCIAL];
  check(
    '`includes(PURCHASING)` daria o veredito ERRADO no acúmulo',
    acumulado.includes(ResponsibleRole.PURCHASING) && !isSolePurchasingContact(acumulado),
    'se esta linha falhar, alguém trocou a expressão pela parecida',
  );

  const fonte = SRC('modules/common/signature/purchase-order-gate.ts');
  check(
    'a fonte escreve `list.length === 1`, não `includes`',
    /list\.length === 1 && list\[0\] === ResponsibleRole\.PURCHASING/.test(fonte),
  );
}

// =============================================================================
console.log('\nA TABELA-VERDADE DO PORTÃO');
// =============================================================================
{
  const veredito = (roles: ResponsibleRole[], vehicles: any[]) =>
    purchaseOrderGateVerdict({ roles, vehicles });

  // ── Compras SOZINHO ──────────────────────────────────────────────────────
  const barrado = veredito([ResponsibleRole.PURCHASING], [semPedido]);
  check('Compras sozinho, SEM número → BARRADO', barrado.blocked);
  check(
    'e a mensagem é exatamente a do dono',
    barrado.message === 'Informe o número do pedido de compra antes de assinar.',
    JSON.stringify(barrado.message),
  );
  check(
    'a constante exportada carrega a MESMA frase',
    PURCHASE_ORDER_REQUIRED_MESSAGE === 'Informe o número do pedido de compra antes de assinar.',
  );
  check('e o veredito nomeia QUAL veículo faltou', barrado.missing.length === 1 && barrado.missing[0].id === 't2');

  check(
    'Compras sozinho, COM número → passa',
    !veredito([ResponsibleRole.PURCHASING], [comPedido]).blocked,
  );
  check(
    'Compras sozinho, com a FK nova e sem a coluna legada → passa',
    !veredito([ResponsibleRole.PURCHASING], [comFkSoh]).blocked,
    'a escrita dupla é de mão dupla: os caminhos antigos deixam a FK nula',
  );

  // ⚠️ TODOS os veículos, não "algum".
  const misto = veredito([ResponsibleRole.PURCHASING], [comPedido, semPedido]);
  check('Compras sozinho, 1 de 2 veículos sem número → BARRADO', misto.blocked);
  check('e só o veículo sem número entra em `missing`', misto.missing.length === 1);

  check(
    'número em branco não conta como número',
    veredito([ResponsibleRole.PURCHASING], [{ id: 't4', customerOrderNumber: '   ' }]).blocked,
  );
  check(
    'string vazia não conta como número',
    veredito([ResponsibleRole.PURCHASING], [{ id: 't5', customerOrderNumber: '' }]).blocked,
  );
  check(
    'envelope SEM veículo não barra (não há entrega a cobrir)',
    !veredito([ResponsibleRole.PURCHASING], []).blocked,
  );

  // ── Compras ACUMULADO — as quatro funções que o contrato nomeia ──────────
  for (const par of [
    ResponsibleRole.COMMERCIAL,
    ResponsibleRole.SELLER,
    ResponsibleRole.REPRESENTATIVE,
    ResponsibleRole.COORDINATOR,
  ]) {
    check(
      `Compras + ${par}, SEM número → NÃO é barrado`,
      !veredito([ResponsibleRole.PURCHASING, par], [semPedido]).blocked,
    );
  }

  // ── Qualquer outro acúmulo também escapa: a regra é sobre CARDINALIDADE ──
  for (const par of [
    ResponsibleRole.FINANCIAL,
    ResponsibleRole.MARKETING,
    ResponsibleRole.FLEET_MANAGER,
    ResponsibleRole.DRIVER,
  ]) {
    check(
      `Compras + ${par}, SEM número → NÃO é barrado (length > 1)`,
      !veredito([ResponsibleRole.PURCHASING, par], [semPedido]).blocked,
    );
  }

  // ── Quem NÃO é Compras nunca é barrado, tenha número ou não ─────────────
  for (const papel of Object.values(ResponsibleRole).filter(
    r => r !== ResponsibleRole.PURCHASING,
  )) {
    check(
      `${papel} sozinho, SEM número → NÃO é barrado`,
      !veredito([papel as ResponsibleRole], [semPedido]).blocked,
    );
  }
  check('sem papel nenhum → não é barrado', !veredito([], [semPedido]).blocked);

  // ── ⛔ O BECO SEM SAÍDA, FECHADO — quem não pode emitir não é cobrado ────
  //
  // `POST /cliente/me/pedidos` exige (a) PAGADOR ∨ (b) DONO; o caminho pessoal
  // "sou contato desta tarefa" não autoriza ato comercial. Mas a EMISSÃO
  // convoca todo `Task.responsibles`, sem conferir empresa. Cruzadas, as duas
  // regras produziam uma pessoa convocada a assinar, barrada por falta do
  // pedido, e recusada no único endereço que o criaria — presa, e sem que nada
  // pudesse desatolá-la.
  const semPedidoDeOutraEmpresa = { ...semPedido, canIssuePurchaseOrder: false };
  const semPedidoMeu = { ...semPedido, canIssuePurchaseOrder: true };

  check(
    'Compras sozinho, veículo que ele NÃO pode emitir → NÃO é barrado',
    !veredito([ResponsibleRole.PURCHASING], [semPedidoDeOutraEmpresa]).blocked,
  );
  check(
    '⛔ mas o caso normal continua barrado (a regra do dono, intacta)',
    veredito([ResponsibleRole.PURCHASING], [semPedidoMeu]).blocked,
  );
  check(
    'misto: cobra o que é DELE e ignora o que não é',
    veredito([ResponsibleRole.PURCHASING], [semPedidoDeOutraEmpresa, semPedidoMeu]).blocked,
  );
  check(
    'e a lista de faltantes cita SÓ o veículo dele',
    veredito([ResponsibleRole.PURCHASING], [semPedidoDeOutraEmpresa, semPedidoMeu]).missing
      .length === 1,
  );
  check(
    'todos de outra empresa → nada a cobrar, nada a barrar',
    !veredito([ResponsibleRole.PURCHASING], [semPedidoDeOutraEmpresa, semPedidoDeOutraEmpresa])
      .blocked,
  );
  check(
    // ⛔ O PADRÃO É "PODE", e é a regra de segurança da interface: um `select`
    // incompleto NÃO pode desligar o portão em silêncio. Só um `false`
    // explícito, calculado com o dado na mão, relaxa a cobrança.
    '⚠️ campo AUSENTE conta como "pode emitir" — o portão continua mordendo',
    veredito([ResponsibleRole.PURCHASING], [semPedido]).blocked,
  );

  // ── O predicado de "tem pedido", isolado ────────────────────────────────
  check('tem pedido: pela FK nova', taskHasPurchaseOrder({ purchaseOrderId: 'po-1' }));
  check('tem pedido: pela coluna legada', taskHasPurchaseOrder({ customerOrderNumber: '8842' }));
  check('não tem: os dois vazios', !taskHasPurchaseOrder({}));
  check('não tem: espaços em branco', !taskHasPurchaseOrder({ customerOrderNumber: '  ' }));
}

// =============================================================================
console.log('\n`ceremonyKindOf` — TODO valor de SignatureAuthMethod, sem exceção');
// =============================================================================
{
  /**
   * A expectativa, valor a valor. É esta tabela que torna um enum novo um ERRO
   * DE TESTE em vez de um comportamento silencioso: o laço abaixo exige que
   * TODO valor do enum apareça aqui.
   */
  const ESPERADO: Record<string, CeremonyKind> = {
    EMAIL_OTP: 'OTP',
    WHATSAPP_OTP: 'OTP',
    SMS_OTP: 'OTP',
    INTERNAL_SESSION: 'INTERNAL',
    RESPONSIBLE_SESSION: 'PORTAL',
  };

  const valores = Object.values(SignatureAuthMethod) as string[];
  check(
    'a tabela deste teste cobre o enum INTEIRO',
    valores.every(v => v in ESPERADO),
    `sem expectativa: ${valores.filter(v => !(v in ESPERADO)).join(', ') || '—'}`,
  );
  check(
    'e não sobra expectativa para valor que não existe mais',
    Object.keys(ESPERADO).every(k => valores.includes(k)),
    `sobrando: ${Object.keys(ESPERADO).filter(k => !valores.includes(k)).join(', ') || '—'}`,
  );

  for (const valor of valores) {
    const esperado = ESPERADO[valor];
    check(`${valor} → ${esperado}`, ceremonyKindOfAuthMethod(valor) === esperado);
  }

  // ⛔ O ERRO QUE MATA: o contato do cliente virar lado ANKAA.
  check(
    'RESPONSIBLE_SESSION NÃO é INTERNAL',
    ceremonyKindOfAuthMethod(SignatureAuthMethod.RESPONSIBLE_SESSION) !== 'INTERNAL',
    'INTERNAL faz os quatro dependentes tratarem o contato do cliente como lado Ankaa',
  );
  // ⛔ E o erro simétrico: a sessão do portal cair no `else` e virar OTP.
  check(
    'RESPONSIBLE_SESSION NÃO é OTP',
    ceremonyKindOfAuthMethod(SignatureAuthMethod.RESPONSIBLE_SESSION) !== 'OTP',
    'OTP deixaria o signatário de sessão assinar pelo link público, sem código',
  );

  check('as DUAS sessões dispensam código', isSessionCeremony(SignatureAuthMethod.INTERNAL_SESSION) && isSessionCeremony(SignatureAuthMethod.RESPONSIBLE_SESSION));
  check('nenhum OTP dispensa', !isSessionCeremony(SignatureAuthMethod.EMAIL_OTP) && !isSessionCeremony(SignatureAuthMethod.WHATSAPP_OTP) && !isSessionCeremony(SignatureAuthMethod.SMS_OTP));

  // Método desconhecido e ausência caem em OTP — e isso é DELIBERADO: toda linha
  // antiga do banco é OTP, e o `default` da coluna é `EMAIL_OTP`.
  check('valor desconhecido cai em OTP', ceremonyKindOfAuthMethod('QUALQUER_COISA') === 'OTP');
  check('nulo cai em OTP', ceremonyKindOfAuthMethod(null) === 'OTP');

  // O rótulo do selo existe para o valor novo. Sem ele, o PDF imprimiria o nome
  // cru do enum no lugar do método que autenticou aquela pessoa.
  for (const valor of valores) {
    check(`${valor} tem rótulo no selo`, typeof AUTH_METHOD_LABELS[valor] === 'string' && AUTH_METHOD_LABELS[valor].length > 0);
  }
}

// =============================================================================
console.log('\nOS QUATRO DEPENDENTES tratam PORTAL explicitamente');
// =============================================================================
{
  const svc = SRC('modules/common/signature/services/signature-envelope.service.ts');

  check(
    "assertOtpCeremony sai só quando é OTP (`if (kind === 'OTP') return;`)",
    /assertOtpCeremony[\s\S]{0,400}?if \(kind === 'OTP'\) return;/.test(svc),
    "escrito como `!== 'INTERNAL'`, o signatário de PORTAL passaria direto",
  );
  check(
    'assertOtpCeremony tem ramo PRÓPRIO para o portal',
    /assertOtpCeremony[\s\S]{0,900}?if \(kind === 'PORTAL'\)[\s\S]{0,400}?Portal do Cliente/.test(svc),
  );
  check(
    "getPublicState decide canSign por `kind === 'OTP'`",
    /canSign:\s*\n?\s*kind === 'OTP' \? this\.canSignNow/.test(svc),
    "pela negativa, a página abriria o formulário de código para quem não tem desafio",
  );
  check(
    'noticeChannelOf ignora TODA sessão, não só a interna',
    /noticeChannelOf[\s\S]{0,900}?!this\.isSessionCeremony\(s\.authMethod\)/.test(svc),
    'RESPONSIBLE_SESSION mascararia o canal de uma coleta mista',
  );
  check(
    'existe UM só lugar que resolve o canal de um signatário',
    /private deliveryChannelFor\([\s\S]{0,400}?this\.isSessionCeremony\(signer\.authMethod\)\s*\n?\s*\? this\.noticeChannelOf\(siblings\)\s*\n?\s*: channelForAuthMethod\(signer\.authMethod\)/.test(
      svc,
    ),
  );
  check(
    'resendInvitation passa por ele',
    /resendInvitation[\s\S]{0,4000}?const channel = this\.deliveryChannelFor\(signer, signer\.envelope\.signers\)/.test(
      svc,
    ),
  );
  check(
    'e NENHUM caminho de mensagem chama `channelForAuthMethod` cru no signatário',
    (semComentarios(svc).match(/const channel = channelForAuthMethod\(/g) ?? []).length === 0,
    'seis caminhos de mensagem; um ternário repetido em seis lugares envelhece num deles',
  );
}

// =============================================================================
console.log('\nA CLÁUSULA DE ACEITAÇÃO tem variante — e a escolha é na EMISSÃO');
// =============================================================================
{
  const otpEmail = acceptanceClauseFor('EMAIL');
  const otpZap = acceptanceClauseFor('WHATSAPP');
  const portal = acceptanceClauseFor('EMAIL', 'PORTAL');

  check('o padrão continua sendo o texto do OTP', otpEmail === acceptanceClauseFor('EMAIL', 'OTP'));
  check(
    'o texto do OTP não mudou: CONTRATANTE por código',
    otpEmail.includes('mediante autenticação do CONTRATANTE por código de uso único'),
  );
  check('e o canal continua governando o OTP', otpZap.includes('por WhatsApp') && otpEmail.includes('e-mail cadastrado'));

  // ⛔ O BLOQUEADOR JURÍDICO: a frase congelada no PDF não pode descrever um
  // método que não foi o usado (MP 2.200-2, art. 10 §2º).
  check(
    'a variante do portal NÃO diz que o CONTRATANTE se autentica por código',
    !portal.includes('mediante autenticação do CONTRATANTE por código de uso único'),
  );
  check(
    'ela diz SESSÃO do Portal do Cliente',
    portal.includes('mediante autenticação do CONTRATANTE em sessão identificada do Portal do Cliente'),
  );
  check(
    'e continua descrevendo a sessão da CONTRATADA (essa nunca muda)',
    portal.includes('autenticação da CONTRATADA em sessão identificada de sua própria plataforma'),
  );
  check(
    'a variante do portal NÃO depende do canal da coleta',
    acceptanceClauseFor('EMAIL', 'PORTAL') === acceptanceClauseFor('WHATSAPP', 'PORTAL'),
    'o código do LOGIN do portal segue outra configuração — citar o canal da coleta mentiria',
  );
  check('a base legal continua na frase', portal.includes('MP') || portal.includes('Medida Provisória'));
  check(
    'a escolha é congelada na EMISSÃO (o serviço passa a cerimônia aos dois pontos)',
    /acceptanceClause: acceptanceClauseFor\(channel, customerCeremony\)/.test(
      SRC('modules/common/signature/services/signature-envelope.service.ts'),
    ) &&
      /acceptanceClause: acceptanceClauseFor\(channel, customerCeremony\),\n\s*verificationCode/.test(
        SRC('modules/common/signature/services/signature-envelope.service.ts'),
      ),
    'a coluna do envelope e o texto IMPRESSO têm de sair da mesma variável',
  );
}

// =============================================================================
console.log('\nAS DECLARAÇÕES DO PORTAL: sai `identity`, FICA `authority`');
// =============================================================================
{
  const portal = declarationKeysFor('PORTAL');

  check('o portal NÃO colhe `identity`', !portal.includes('identity'));
  check(
    '⛔ o portal COLHE `authority`',
    portal.includes('authority'),
    'a disputa provável em B2B é poderes de representação, não identidade (CC art. 118)',
  );
  check('e colhe `reviewed` e `method`', portal.includes('reviewed') && portal.includes('method'));
  check('são TRÊS', portal.length === 3);
  check('a lista exportada bate com a função', PORTAL_DECLARATION_KEYS.join(',') === portal.join(','));

  check('o caminho do OTP continua com as quatro', declarationKeysFor('OTP').join(',') === DECLARATION_KEYS.join(','));
  check('o caminho interno continua com as duas', declarationKeysFor('INTERNAL').join(',') === INTERNAL_DECLARATION_KEYS.join(','));
  check(
    'o interno larga `authority` e o portal NÃO',
    !INTERNAL_DECLARATION_KEYS.includes('authority') && PORTAL_DECLARATION_KEYS.includes('authority'),
    'do lado da Ankaa os poderes vêm do vínculo empregatício; do lado do cliente, de lugar nenhum',
  );

  const textos = declarationsFor({ channel: 'EMAIL', kind: 'PORTAL' });
  check('os textos batem com as chaves', textos.map(d => d.key).join(',') === portal.join(','));
  check(
    'nenhum texto do portal promete código de uso único',
    textos.every(d => !d.template.includes('código de uso único')),
  );
  check(
    'o `method` do portal nomeia a sessão do portal',
    textos.find(d => d.key === 'method')!.template.includes('Portal do Cliente'),
  );
  check(
    'o `authority` do portal é o MESMO texto do caminho do cliente',
    textos.find(d => d.key === 'authority')!.template ===
      declarationsFor({ channel: 'EMAIL', kind: 'OTP' }).find(d => d.key === 'authority')!.template,
  );

  // O recorte continua governando `reviewed`: quem não recebeu PRICING não
  // declara valor nenhum — nem no portal.
  const semPreco = declarationsFor({ channel: 'EMAIL', kind: 'PORTAL', showsTotal: false });
  check(
    'sem a seção de preço, `reviewed` não cita o total',
    !semPreco.find(d => d.key === 'reviewed')!.template.includes('{total}'),
  );
}

// =============================================================================
console.log('\nO ATO NO PORTAL: sem desafio, resolvido por `{ id, responsibleId }`');
// =============================================================================
{
  const svc = SRC('modules/common/signature/services/signature-envelope.service.ts');
  const corpo = svc.slice(
    svc.indexOf('async signByPortalSession'),
    svc.indexOf('Troca QUEM contra-assina numa coleta ainda em andamento'),
  );
  check('o método existe', corpo.length > 500);

  check(
    'o signatário é resolvido pelo PAR, não por id + `if`',
    /where: \{ id: args\.signerId, responsibleId: args\.responsible\.id \}/.test(corpo),
    'um findUnique por id + conferência responderia "existe" e "é seu" de formas diferentes',
  );
  check(
    'NENHUM desafio é emitido ou verificado',
    !/this\.challenges\./.test(corpo),
    'assinatura por sessão não cria SigningChallenge',
  );
  check(
    'coleta emitida por código é RECUSADA (espelho de countersign)',
    /if \(this\.ceremonyKindOf\(signer\.authMethod\) !== 'PORTAL'\)/.test(corpo),
  );
  check('usa a MESMA porta de todos os atos', /await this\.assertSignable\(env, signer\)/.test(corpo));
  check(
    'reconfere o FRESCOR no instante do ato',
    /this\.snapshots\.buildForQuote\(env\.quoteId\)/.test(corpo) &&
      /onQuoteContentChanged\(env\.quoteId, null\)/.test(corpo),
  );
  check(
    'a evidência é selada com HMAC, como nos outros dois caminhos',
    /const evidenceHash = sha256Hex\(evidence\)/.test(corpo) &&
      /createHmac\('sha256', pepper\)\.update\(evidenceHash\)/.test(corpo),
  );
  check(
    'o portão do pedido de compra roda ANTES de qualquer escrita',
    corpo.indexOf('purchaseOrderGateVerdict') > 0 &&
      corpo.indexOf('purchaseOrderGateVerdict') < corpo.indexOf('envelopeSigner.update'),
  );
  check(
    'e devolve 403 (ForbiddenException), não 400',
    /throw new ForbiddenException\(gate\.message/.test(corpo),
  );
  check(
    'a evidência grava a SESSÃO, que é o que prova a identidade deste ato',
    /portalSessionId: args\.responsible\.sessionId/.test(corpo),
  );
  check(
    '⛔ nenhum `@UserId()` / `request.user` no CÓDIGO do controlador do portal',
    !/@UserId\(\)|request\.user/.test(
      semComentarios(SRC('modules/common/signature/portal-signature.controller.ts')),
    ),
    '827 pontos leem request.user e gravam em 46 FKs NOT NULL de User',
  );
}

// =============================================================================
console.log('\nA ESCRITA DUPLA do número do pedido');
// =============================================================================
{
  const po = SRC('modules/production/purchase-order/purchase-order.service.ts');
  check(
    'as duas colunas são escritas no MESMO update',
    /purchaseOrderId: po\.id,[\s\S]{0,600}?customerOrderNumber: number,/.test(po),
    'metade aplicada faz a nota sair sem o pedido que o cliente exige',
  );
  check('e dentro de uma transação', /\$transaction\(async tx =>/.test(po));
  check(
    'o portal nunca aceita `customerId` do corpo',
    !/customerId/.test(SRC('schemas/purchase-order.ts').split('portalPurchaseOrderCreateSchema')[1].split('}')[0]),
  );
  check(
    'a audiência interna é ADMIN + FINANCEIRO + COMERCIAL, sem gerente de produção',
    !/PRODUCTION_MANAGER/.test(
      semComentarios(SRC('modules/production/purchase-order/purchase-order.controller.ts')),
    ),
    'removido dessa audiência em 17/09/2026 — esta rota não o devolve',
  );
  check(
    'o comentário morto de `BudgetPayer.orderNumber` foi corrigido',
    !/`BudgetPayer\.orderNumber` é obrigatório/.test(SRC('config/company.ts')),
  );
}

// =============================================================================
console.log('\n⛔ O ESCOPO DO PEDIDO DE COMPRA — O CASO FURGÕES');
// =============================================================================
//
// A FURGÕES IBIPORÃ EMITE O PEDIDO E O CAMINHÃO É DA RKO. Está em dado de
// produção: orçamentos 259–262, DOIS clientes (Ibiporã Implementos + RKO
// Alimentos), UM faturamento, transcrito na migration `20260917150100`.
//
// O predicado errado erra de um lado cada vez, e os dois erros são caros:
//
//   · `task.customerId === responsible.companyId` RECUSA o caso principal — o
//     Compras da Furgões não liga o pedido dela a caminhão NENHUM, e a feature
//     nasce morta no cenário que a justifica;
//   · `taskScopeWhere` INTEIRO aceita demais — o caminho (c), "eu sou contato
//     deste veículo", é PESSOAL, atravessa empresas de propósito e não carrega
//     laço comercial nenhum. `Task.responsibles` é m:n e NADA confere contra
//     `Task.customerId`.
//
// O certo é (a) PAGADOR **ou** (b) DONO. Os dois sentidos ficam fixados abaixo.
{
  const IBIPORA = 'cust-ibipora';
  const RKO = 'cust-rko';
  const CONTATO = 'resp-compras-ibipora';

  /** O caminhão da RKO que a Ibiporã PAGA — o caso 259–262. */
  const implementoDaRkoPagoPelaIbipora = {
    id: 't-rko',
    customerId: RKO,
    billingEntry: { billing: { customerConfigs: [{ customerId: IBIPORA }] } },
  };

  /** Um caminhão da própria Ibiporã. */
  const implementoDaIbipora = {
    id: 't-ibi',
    customerId: IBIPORA,
    billingEntry: { billing: { customerConfigs: [] } },
  };

  /**
   * ⛔ O caminhão de um TERCEIRO em que este contato está pendurado por
   * cadastro — e que a empresa dele não paga. É o caminho (c), e é o que NÃO
   * pode autorizar um pedido de compra.
   */
  const implementoDeTerceiroOndeSouContato = {
    id: 't-terceiro',
    customerId: 'cust-outro',
    billingEntry: { billing: { customerConfigs: [] } },
  };

  // ── O PREDICADO, nos dois sentidos ──────────────────────────────────────
  check(
    '⛔ PAGADOR-mas-não-dono é PERMITIDO (o caso Furgões)',
    commercialTaskLink(implementoDaRkoPagoPelaIbipora, IBIPORA) === 'PAYER',
    'se esta linha falhar, o Compras da Furgões voltou a não conseguir lançar pedido nenhum',
  );
  check('DONO é permitido', commercialTaskLink(implementoDaIbipora, IBIPORA) === 'OWNER');
  check(
    '⛔ CONTATO-apenas é RECUSADO',
    commercialTaskLink(implementoDeTerceiroOndeSouContato, IBIPORA) === null,
    'ser contato de um veículo não cria conta entre as duas empresas',
  );

  // A regra é do VÍNCULO, não da pessoa: o mesmo caminhão, perguntado do lado
  // da RKO, é dela por posse.
  check(
    'e o mesmo caminhão é da RKO por posse',
    commercialTaskLink(implementoDaRkoPagoPelaIbipora, RKO) === 'OWNER',
  );

  // ── AS BORDAS QUE DEVOLVERIAM "SIM" POR ACIDENTE ────────────────────────
  check(
    'empresa vazia nunca casa (nem com tarefa órfã)',
    commercialTaskLink({ id: 'x', customerId: null }, null) === null &&
      commercialTaskLink({ id: 'x', customerId: null }, '') === null &&
      commercialTaskLink({ id: 'x', customerId: null }, undefined) === null,
    '`undefined === undefined` viraria "é dono" — `Task.customerId` é nullable',
  );
  check(
    'sem `billingEntry` no select, o caminho do pagador FALHA FECHADO',
    commercialTaskLink({ id: 't', customerId: RKO }, IBIPORA) === null,
    'na dúvida recusa: aceitar transformaria um select incompleto em pedido no veículo errado',
  );
  check('linha nula não estoura', commercialTaskLink(null, IBIPORA) === null);

  // ── O `where` e o predicado dizem A MESMA COISA ─────────────────────────
  const where: any = commercialTaskWhereForCustomer(IBIPORA);
  check('o `where` tem DOIS ramos, e só dois', where.OR?.length === 2);
  check(
    'ramo (a): o pagador do faturamento que cobre o veículo',
    where.OR[0]?.billingEntry?.is?.billing?.customerConfigs?.some?.customerId === IBIPORA,
  );
  check('ramo (b): o dono do veículo', where.OR[1]?.customerId === IBIPORA);
  check(
    '⛔ e NENHUM ramo `responsibles` — o caminho (c) não entra aqui',
    !JSON.stringify(where).includes('responsibles'),
    JSON.stringify(where),
  );

  // ── O SERVIÇO usa o corte estreito, e o AMPLO segue existindo para ler ──
  const scope = new PortalScopeService();
  const estreito = JSON.stringify(scope.commercialTaskScopeWhere({ id: CONTATO, companyId: IBIPORA } as any));
  const amplo = JSON.stringify(scope.taskScopeWhere({ id: CONTATO, companyId: IBIPORA } as any));
  check('o corte de LEITURA continua com os três caminhos', amplo.includes('responsibles'));
  check('o de PEDIDO DE COMPRA tem só dois', !estreito.includes('responsibles'));
  check(
    'contato sem empresa é recusado ANTES do `where`',
    (() => {
      try {
        scope.commercialTaskScopeWhere({ id: CONTATO, companyId: null } as any);
        return false;
      } catch {
        return true;
      }
    })(),
  );

  const po = SRC('modules/production/purchase-order/purchase-order.service.ts');
  check(
    'o portal escopa o pedido por `commercialTaskScopeWhere`',
    /taskScope: this\.scope\.commercialTaskScopeWhere\(principal\)/.test(po),
  );
  check(
    '⛔ e a conferência pós-carga NÃO é mais a igualdade de cliente',
    !/t\.customerId && t\.customerId !== args\.customerId/.test(semComentarios(po)),
    'era essa linha que recusava o caminhão da RKO ao Compras da Furgões',
  );
  check(
    'ela passou a ser `commercialTaskLink`',
    /commercialTaskLink\(t, args\.customerId\) === null/.test(po),
  );
  check(
    'e o `select` carrega o pagador recortado (`where: { customerId }`), nunca a lista toda',
    /customerConfigs: \{ where: \{ customerId \}, select: \{ customerId: true \} \}/.test(po),
  );
  check(
    '⛔ `PurchaseOrder.customerId` continua sendo a empresa de QUEM EMITE',
    /customerId: companyId,\n\s*number: dto\?\.number/.test(po),
    'o pedido é de quem o emite — é esse nome que a NFS-e cita',
  );
}

// =============================================================================
console.log('\nA RECUSA PELO PORTAL: o "não" pelo MESMO canal do "sim"');
// =============================================================================
//
// ⛔ O DEFEITO QUE ESTE BLOCO IMPEDE: o portal ganhar o ato de ACEITAR e não o
// de RECUSAR. A cerimônia pública tem `POST /assinatura/publico/:token/recusar`
// desde que a recusa deixou de ser anônima; enquanto o portal não tinha
// equivalente, o contato do cliente entrava e só encontrava o botão de assinar.
// Num instrumento isso não é economia de tela: a recusa é ato jurídico do mesmo
// peso que a aceitação (CC art. 431), e um canal que só registra o "sim"
// empurra o "não" para o telefone — onde ele não vira evidência de nada.
//
// E a segunda armadilha, mais cara: escrever a recusa do portal como um SEGUNDO
// caminho. As transições de estado e a trilha de uma recusa são as de um ato
// jurídico; duas cópias divergem no primeiro conserto, e a que ficar para trás
// vai ser a que um advogado lê. O reuso é fixado abaixo por CONTAGEM.
{
  const svc = SRC('modules/common/signature/services/signature-envelope.service.ts');
  const semC = semComentarios(svc);
  const corpo = svc.slice(
    svc.indexOf('async refuseByPortalSession'),
    svc.indexOf('Troca QUEM contra-assina numa coleta ainda em andamento'),
  );

  check('o método existe', corpo.length > 500);

  // ── A RESOLUÇÃO DO SIGNATÁRIO — o coração da autorização desta rota ──────
  check(
    '⛔ o signatário é resolvido pelo PAR `{ id, responsibleId }`, no `where`',
    /where: \{ id: args\.signerId, responsibleId: args\.responsible\.id \}/.test(corpo),
    'id + `if` de conferência responderia "existe" e "é seu" de formas diferentes — um oráculo de ids',
  );
  check(
    'e NÃO há `findUnique` por id seguido de conferência',
    !/findUnique\(\{\s*where: \{ id: args\.signerId \}/.test(corpo) &&
      !/signer\.responsibleId !== /.test(semComentarios(corpo)),
  );
  check(
    'o `signerId` que não é meu responde NÃO EXISTE (404), não 403',
    /throw new NotFoundException\(/.test(corpo),
    'um 403 confirmaria que o id existe — que é a informação que não se dá',
  );

  // ── A MESMA CERIMÔNIA, A MESMA PORTA ────────────────────────────────────
  check('NENHUM desafio é emitido ou verificado', !/this\.challenges\./.test(corpo));
  check(
    'coleta emitida por CÓDIGO é recusada aqui (espelho de `signByPortalSession`)',
    /if \(this\.ceremonyKindOf\(signer\.authMethod\) !== 'PORTAL'\)/.test(corpo),
    'a cerimônia é escolhida na emissão e não se converte depois',
  );
  check(
    'usa a MESMA porta do ato de assinar',
    /await this\.assertSignable\(env, signer\)/.test(corpo),
    'um "recusar" que funcionasse onde "assinar" não funciona seria uma segunda régua',
  );
  check(
    'o motivo vazio é barrado no SERVIÇO, não só no zod da borda',
    /const reason = \(args\.reason \?\? ''\)\.trim\(\)/.test(corpo) &&
      /throw new BadRequestException\('Informe o motivo da recusa\.'\)/.test(corpo),
  );
  check(
    'a SESSÃO do portal entra na trilha como a prova deste ato',
    /portalSessionId: args\.responsible\.sessionId/.test(corpo) &&
      /responsibleId: args\.responsible\.id/.test(corpo),
    'onde o caminho do código grava `challengeId`, este grava a sessão',
  );
  check(
    '⛔ nada de `@UserId()` / `request.user` no serviço desta rota',
    !/@UserId\(\)|request\.user/.test(semComentarios(corpo)),
  );

  // ── ⛔ REUSO, E NÃO UMA SEGUNDA CÓPIA DA RECUSA ──────────────────────────
  check(
    'o ato é DELEGADO a `applyRefusal`',
    /await this\.applyRefusal\(\{/.test(semComentarios(corpo)),
  );
  check(
    'e a recusa por CÓDIGO chama o MESMO método — duas chamadas, uma implementação',
    (semC.match(/this\.applyRefusal\(\{/g) ?? []).length === 2,
  );
  check(
    'a transição para REFUSED é escrita UMA só vez no arquivo inteiro',
    (semC.match(/status: EnvelopeSignerStatus\.REFUSED,\n\s*refusedAt:/g) ?? []).length === 1,
    'duplicá-la é como as duas recusas passam a divergir',
  );
  check(
    'a contagem de quem AINDA PODE assinar também (declaração + uso)',
    (semC.match(/aindaPodemAssinar/g) ?? []).length === 2,
  );
  check(
    'e os dois avisos (comercial e colegas) saem de um lugar só',
    (semC.match(/notifyRefusalToAnkaa\(/g) ?? []).length === 2 &&
      (semC.match(/notifyRefusalToPeers\(/g) ?? []).length === 2,
    'definição + UMA chamada cada',
  );
  check(
    '⛔ a recusa continua NÃO derrubando a assinatura dos outros',
    /notIn: \[\s*EnvelopeSignerStatus\.REFUSED,/.test(semC) &&
      !/status: EnvelopeSignerStatus\.VOIDED[\s\S]{0,200}applyRefusal/.test(semC),
    'o envelope só morre quando não sobra NINGUÉM do lado do cliente — tests/signature-refusal.test.ts',
  );
  check(
    'o envelope só vira REFUSED quando ninguém mais pode assinar',
    /if \(aindaPodemAssinar === 0\)/.test(semC),
  );

  // ── A ROTA ──────────────────────────────────────────────────────────────
  const ctrl = SRC('modules/common/signature/portal-signature.controller.ts');
  check(
    "a rota é `POST /cliente/me/assinaturas/:signerId/recusar`",
    /@Controller\('cliente\/me\/assinaturas'\)/.test(ctrl) &&
      /@Post\(':signerId\/recusar'\)/.test(ctrl),
  );
  check(
    'e é `@ResponsibleOnly()` — marcar a rota É guardá-la',
    /@Post\(':signerId\/recusar'\)\n\s*@ResponsibleOnly\(\)/.test(ctrl),
  );
  check(
    'o ator é `@CurrentResponsible()`, nunca `@UserId()`',
    /@CurrentResponsible\(\) responsible: ResponsiblePrincipal/.test(
      ctrl.slice(ctrl.indexOf("@Post(':signerId/recusar')")),
    ),
  );
  check(
    'o corpo passa pelo zod da borda',
    /ZodValidationPipe\(portalRefuseSchema\)/.test(ctrl),
  );

  // ── O CORPO `{ motivo }` ────────────────────────────────────────────────
  const aparado = portalRefuseSchema.safeParse({ motivo: '  preço acima do aprovado  ' });
  check(
    'o motivo é aparado',
    aparado.success && aparado.data.motivo === 'preço acima do aprovado',
  );
  check('motivo só de espaços é recusado', !portalRefuseSchema.safeParse({ motivo: '   ' }).success);
  check('corpo sem motivo é recusado', !portalRefuseSchema.safeParse({}).success);
  check('2000 caracteres passam', portalRefuseSchema.safeParse({ motivo: 'x'.repeat(2000) }).success);
  check(
    '2001 não',
    !portalRefuseSchema.safeParse({ motivo: 'x'.repeat(2001) }).success,
  );
  check(
    '⛔ `{ reason }` em vez de `{ motivo }` é NOMEADO, não descartado em silêncio',
    (() => {
      const r = portalRefuseSchema.safeParse({ reason: 'não quero' } as any);
      return !r.success && JSON.stringify(r.error.issues).includes('reason');
    })(),
    'sem `.strict()` o corpo chegaria vazio e o erro acusaria o campo CERTO de estar faltando',
  );
}

// =============================================================================
console.log('\nA CLÁUSULA CONGELADA VIAJA COM A PENDÊNCIA');
// =============================================================================
//
// A cláusula de aceite é IMPRESSA no PDF e diz como aquela pessoa se autentica.
// Se a lista de pendências não a carrega, o diálogo do portal exibe um texto que
// ele mesmo compôs — verdadeiro, talvez, mas não o que o documento congelou. E é
// o congelamento o ponto inteiro: por isso a coluna é LIDA, nunca recomposta.
{
  const svc = SRC('modules/common/signature/services/signature-envelope.service.ts');
  const lista = svc.slice(
    svc.indexOf('async listPendingForResponsible'),
    svc.indexOf('async signByPortalSession'),
  );
  check('a pendência existe', lista.length > 500);
  check(
    '⛔ e carrega `SignatureEnvelope.acceptanceClause`',
    /acceptanceClause: env\.acceptanceClause/.test(lista),
    'sem ela a tela mostra palavras diferentes das que o PDF congelou',
  );
  check(
    'a cláusula é LIDA da coluna, nunca recomposta na leitura',
    !/acceptanceClauseFor\(/.test(semComentarios(lista)),
    '`acceptanceClauseFor` é da EMISSÃO; chamá-la aqui desfaria o congelamento',
  );
  check(
    'e o texto declarado também vem do servidor, não do navegador',
    /declaracoes:/.test(lista) && /this\.renderDeclarationsFor\(\{/.test(lista),
  );
}

// =============================================================================
console.log('\nA PARCELA PAGA PELA METADE EXISTE');
// =============================================================================
//
// `paidAt` sozinho obriga a tela a derivar o pago como `paidAt ? amount : null`,
// e a parcela quitada parcialmente desaparece: ou vira paga por inteiro (some
// com o saldo devedor), ou vira intocada (ignora o dinheiro que já entrou).
// `Installment.paidAmount` existe e é do PRÓPRIO PAGADOR que está lendo.
{
  const read = SRC('modules/people/portal/portal-read.service.ts');
  const proj = SRC('modules/people/portal/portal-projection.service.ts');

  const selectDoOrcamento = read.slice(
    read.indexOf('if (verPagamento) {'),
    read.indexOf('select.nfseDocuments'),
  );
  check(
    'o `select` das parcelas DO ORÇAMENTO pede o valor pago',
    /paidAmount: true/.test(selectDoOrcamento) && /paidAt: true/.test(selectDoOrcamento),
  );
  check(
    '⛔ e o pagador continua recortado no `select` (`payerScopeSelect`)',
    /\.\.\.this\.scope\.payerScopeSelect\(principal\)/.test(selectDoOrcamento),
    'um `customerConfigs` sem o `where` do pagador entrega a parcela do outro cliente',
  );
  check(
    'o PROJETOR copia o valor pago (o `select` sozinho não basta)',
    // ⚠️ A ASSERÇÃO MEDE A INTENÇÃO, NÃO A LETRA. Ela exigia o texto exato
    // `paidAmount: i.paidAmount ?? null` e reprovou quando o campo passou a
    // sair por `toPortalNumber(i.paidAmount)` — uma melhoria, não um defeito.
    // Um teste que fixa a grafia de uma linha cobra refatoração em vez de
    // comportamento, e treina quem o lê a ignorá-lo. O que importa é que o
    // projetor NOMEIE o campo a partir da linha: é isso que impede a chave de
    // sumir em silêncio.
    /paidAmount:\s*(?:toPortalNumber\()?i\.paidAmount/.test(proj),
    'o projetor copia o que ele nomeia; chave nova não declarada some em silêncio',
  );
  check(
    'e o tipo da linha e o da vista declaram os dois campos',
    // A linha crua chega como `unknown` (é `Decimal` do Prisma); a VISTA
    // declara `number | null` desde que o dinheiro do portal passou a sair
    // como número — e é essa declaração que faz o compilador cobrar quem
    // esquecer a conversão num campo novo.
    /paidAmount\?: unknown;/.test(proj) && /paidAmount: number \| null;/.test(proj),
  );
  check(
    'a lista de COBRANÇAS traz o valor pago da parcela E o da fatura',
    /paidAmount: p\.paidAmount/.test(read) && /paidAmount: inv\.paidAmount/.test(read),
    '`Invoice.paidAmount` ao lado de `totalAmount` — os dois lados do mesmo saldo',
  );
}

console.log(`\n${failures === 0 ? '✓ TODAS as verificações passaram' : `✗ ${failures} falha(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
