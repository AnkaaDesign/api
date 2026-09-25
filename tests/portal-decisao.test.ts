/**
 * A PRÉ-APROVAÇÃO DO PORTAL — as duas arestas e o destinatário único.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * São dois, e nenhum dos dois aparece como erro:
 *
 *   1. UMA ARESTA QUE A MÁQUINA NÃO TEM. O portal move o orçamento
 *      `IN_NEGOTIATION → PRE_APPROVED` e `IN_NEGOTIATION → REQUESTED`. Se
 *      alguém tirar uma dessas linhas de `ALLOWED` (ou trocar o destino da
 *      recusa por `CANCELLED`, que é o engano natural), o `tsc` não diz nada: o
 *      tipo é o mesmo, e o que muda é um 400 na cara do cliente — ou, pior, um
 *      orçamento terminal onde deveria haver um pedido de revisão.
 *
 *   2. OS DOIS CARIMBOS DE PÉ AO MESMO TEMPO. O banco tem
 *      `BudgetRequest_decisao_unica` (`preApprovedAt IS NULL OR refusedAt IS
 *      NULL`), e a máquina de estados PERMITE a reversão: pré-aprovado volta a
 *      `IN_NEGOTIATION` e pode ser recusado, e vice-versa. Uma gravação que só
 *      preenchesse a decisão nova deixaria a antiga de pé, e o CHECK viraria 500
 *      exatamente para o cliente que acabou de decidir — com a transação de
 *      negócio revertida junto.
 *
 * E um terceiro, do sistema de notificações, que nasceu no mesmo dia: o CHECK
 * `Notification_exactly_one_recipient` recusa notificação com DOIS
 * destinatários e com NENHUM. `{ userId?, responsibleId? }` como dois campos
 * opcionais deixa os dois estados compilarem; `NotificationRecipient` é união
 * discriminada e os torna inexprimíveis. O teste prova que a conversão para
 * colunas sempre nula exatamente um lado — inclusive no `update`, onde chave
 * ausente significa "não mexa" e seria a forma de acabar com os dois cheios.
 *
 * SEM BANCO, SEM NEST, SEM REDE — o estilo de `test:responsible-otp`. O que é
 * função pura é chamado; o que mora dentro de um serviço com `PrismaService`
 * (a tabela `ALLOWED`, a gravação dos carimbos) é verificado na FORMA DO
 * CÓDIGO-FONTE, que é o que dá para fazer honestamente sem infraestrutura.
 *
 * `npm run test:portal-decisao`
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { TASK_QUOTE_STATUS } from '../src/constants/enums';
import {
  PORTAL_DECISION_TRANSITIONS,
  PORTAL_DECISION_STAMPS,
} from '../src/modules/people/portal/portal-decision-transitions';
import {
  isExactlyOneRecipient,
  recipientColumns,
  recipientOf,
  recipientOrBroadcast,
  responsibleRecipient,
  targetsResponsible,
  userRecipient,
} from '../src/modules/common/notification/notification-recipient';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const src = (rel: string) => readFileSync(join(__dirname, '..', 'src', rel), 'utf8');

/**
 * O CÓDIGO SEM OS COMENTÁRIOS.
 *
 * Este repositório comenta em prosa, e a prosa CITA o que o código não faz —
 * "NENHUM `@UserId()`", "não enfileira `queueNotificationJob`". Um `grep` cru
 * encontra a citação e acusa o arquivo justamente por ele declarar a regra que
 * cumpre. As verificações de FORMA abaixo leem daqui; as de presença de texto
 * (rótulos, chaves de config) leem do original.
 *
 * O tokenizador precisa distinguir `//` de comentário do `//` dentro de uma
 * string — `'/financeiro/orcamento/detalhes/'` não é comentário, e apagar a
 * partir dele comeria o resto da linha.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** O corpo de um método, do nome dele até o marcador que abre o próximo. */
function blocoEntre(source: string, de: string, ate: string): string {
  const inicio = source.indexOf(de);
  if (inicio < 0) return '';
  const fim = source.indexOf(ate, inicio + de.length);
  return source.slice(inicio, fim < 0 ? source.length : fim);
}

const budgetService = src('modules/production/budget/budget.service.ts');
const decisionService = src('modules/people/portal/portal-decision.service.ts');
const decisionController = src('modules/people/portal/portal-decision.controller.ts');
const dispatchService = src('modules/common/notification/notification-dispatch.service.ts');
const portalNotifications = src('modules/common/notification/portal-notification.service.ts');

// As versões sem prosa. Ver `stripComments`.
const decisionServiceCode = stripComments(decisionService);
const decisionControllerCode = stripComments(decisionController);
const dispatchServiceCode = stripComments(dispatchService);

/** O corpo de `ALLOWED[X]`, como texto. É onde a máquina de estados mora. */
function allowedFor(status: string): string {
  const marker = `[TASK_QUOTE_STATUS.${status}]:`;
  const start = budgetService.indexOf(marker);
  if (start < 0) return '';
  const from = budgetService.indexOf('[', start + marker.length);
  if (from < 0) return '';
  // O array termina no primeiro `]` depois da abertura; nenhum valor do enum
  // contém colchete, então não há aninhamento a rastrear.
  const end = budgetService.indexOf(']', from);
  return budgetService.slice(from, end + 1);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nOS PARES — o que a pré-aprovação e a recusa significam');
{
  check(
    'pré-aprovar sai de EM NEGOCIAÇÃO',
    PORTAL_DECISION_TRANSITIONS.APPROVE_VALUE.from === TASK_QUOTE_STATUS.IN_NEGOTIATION,
  );
  check(
    'pré-aprovar chega em PRÉ-APROVADO',
    PORTAL_DECISION_TRANSITIONS.APPROVE_VALUE.to === TASK_QUOTE_STATUS.PRE_APPROVED,
  );
  check(
    'recusar sai de EM NEGOCIAÇÃO',
    PORTAL_DECISION_TRANSITIONS.REFUSE.from === TASK_QUOTE_STATUS.IN_NEGOTIATION,
  );
  check(
    'recusar chega em REQUISIÇÃO — volta para o comercial refazer',
    PORTAL_DECISION_TRANSITIONS.REFUSE.to === TASK_QUOTE_STATUS.REQUESTED,
  );

  // As três negativas que importam, e cada uma é um engano plausível.
  check(
    'recusar NÃO cancela',
    PORTAL_DECISION_TRANSITIONS.REFUSE.to !== TASK_QUOTE_STATUS.CANCELLED,
    'CANCELLED é terminal; quem recusa um preço quer outro preço',
  );
  check(
    'pré-aprovar NÃO aprova',
    PORTAL_DECISION_TRANSITIONS.APPROVE_VALUE.to !== TASK_QUOTE_STATUS.APPROVED,
    'APPROVED destrava a cobrança e exige assinatura',
  );
  check(
    'pré-aprovar NÃO pula para AGUARDANDO ASSINATURA',
    PORTAL_DECISION_TRANSITIONS.APPROVE_VALUE.to !== TASK_QUOTE_STATUS.PENDING,
    'quem lança o envelope é a Ankaa, não o cliente',
  );
  check(
    'as duas saem do MESMO estado',
    PORTAL_DECISION_TRANSITIONS.APPROVE_VALUE.from ===
      PORTAL_DECISION_TRANSITIONS.REFUSE.from,
  );
  check(
    'e chegam em estados DIFERENTES',
    PORTAL_DECISION_TRANSITIONS.APPROVE_VALUE.to !== PORTAL_DECISION_TRANSITIONS.REFUSE.to,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nA MÁQUINA DE ESTADOS autoriza as duas arestas (budget.service.ts)');
{
  const deEmNegociacao = allowedFor('IN_NEGOTIATION');

  check('ALLOWED[IN_NEGOTIATION] existe', deEmNegociacao.length > 0);
  check(
    'IN_NEGOTIATION → PRE_APPROVED está na tabela',
    deEmNegociacao.includes('TASK_QUOTE_STATUS.PRE_APPROVED'),
  );
  check(
    'IN_NEGOTIATION → REQUESTED está na tabela',
    deEmNegociacao.includes('TASK_QUOTE_STATUS.REQUESTED'),
  );

  // Os destinos que NÃO podem estar lá. Um `IN_NEGOTIATION → APPROVED` faria o
  // portal aprovar contrato sem assinatura e sem valor acordado.
  check(
    'IN_NEGOTIATION NÃO vai direto para APPROVED',
    !deEmNegociacao.includes('TASK_QUOTE_STATUS.APPROVED'),
  );
  check(
    'IN_NEGOTIATION NÃO vai direto para PENDING',
    !deEmNegociacao.includes('TASK_QUOTE_STATUS.PENDING'),
    'o envelope é lançado a partir de PRE_APPROVED',
  );

  // A volta: PRE_APPROVED tem de poder retornar a IN_NEGOTIATION, senão a
  // reversão de decisão que o CHECK teme nunca aconteceria — e o apagamento da
  // decisão oposta seria código morto defendendo um caso impossível.
  const dePreAprovado = allowedFor('PRE_APPROVED');
  check(
    'PRE_APPROVED volta para IN_NEGOTIATION (é o que torna a reversão real)',
    dePreAprovado.includes('TASK_QUOTE_STATUS.IN_NEGOTIATION'),
  );
  const deRequisicao = allowedFor('REQUESTED');
  check(
    'REQUESTED volta para IN_NEGOTIATION (o comercial reprecifica e devolve)',
    deRequisicao.includes('TASK_QUOTE_STATUS.IN_NEGOTIATION'),
  );

  check(
    'CANCELLED continua terminal',
    allowedFor('CANCELLED').replace(/\s/g, '') === '[]',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nO PORTAL PASSA PELA MÁQUINA — não ao lado dela');
{
  check(
    'o serviço chama assertTransitionAllowed',
    decisionService.includes('this.budgets.assertTransitionAllowed('),
  );
  check(
    'o movimento é updateStatus, que grava changelog e aplica as travas',
    decisionService.includes('this.budgets.updateStatus('),
  );
  check(
    'o serviço NÃO escreve `status` no Prisma',
    !/prisma\.budget\.update\(/.test(decisionService),
    'escrever status direto é o defeito da automação da O.S. em 4 pontos',
  );
  check(
    'assertTransitionAllowed é só um invólucro de validateStatusTransition',
    /assertTransitionAllowed\([\s\S]{0,200}?this\.validateStatusTransition\(/.test(
      budgetService,
    ),
    'se ele ganhar lógica própria, passam a existir dois grafos',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nO CHECK `BudgetRequest_decisao_unica` NUNCA é consultado com os dois cheios');
{
  // A forma do `stampDecision`: cada ramo escreve as DUAS colunas da sua
  // decisão E anula as DUAS da oposta, na mesma instrução.
  const inicio = decisionService.indexOf('const campos =');
  const fim = decisionService.indexOf('await this.prisma.budgetRequest.upsert(');
  const campos = inicio >= 0 && fim > inicio ? decisionService.slice(inicio, fim) : '';

  check('o bloco `campos` foi encontrado', campos.length > 0);

  for (const decision of ['APPROVE_VALUE', 'REFUSE'] as const) {
    const { escreve, apaga } = PORTAL_DECISION_STAMPS[decision];
    for (const coluna of escreve) {
      check(
        `${decision}: grava ${coluna}`,
        new RegExp(`${coluna}:\\s*(at|responsibleId)`).test(campos),
      );
    }
    for (const coluna of apaga) {
      check(
        `${decision}: APAGA ${coluna} (senão o CHECK vira 500)`,
        new RegExp(`${coluna}:\\s*null`).test(campos),
      );
    }
  }

  check(
    'as quatro colunas aparecem nos DOIS ramos',
    ['preApprovedAt', 'preApprovedByResponsibleId', 'refusedAt', 'refusedByResponsibleId'].every(
      c => (campos.match(new RegExp(`${c}:`, 'g')) ?? []).length === 2,
    ),
    'uma coluna citada uma vez só significa que um dos ramos a deixa de pé',
  );

  check(
    'as duas decisões nunca escrevem a mesma coluna com valor',
    PORTAL_DECISION_STAMPS.APPROVE_VALUE.escreve.every(
      c => !(PORTAL_DECISION_STAMPS.REFUSE.escreve as readonly string[]).includes(c),
    ),
  );

  check(
    'é `upsert`, não `update` — nem todo orçamento em negociação veio do portal',
    decisionService.includes('this.prisma.budgetRequest.upsert('),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nEXATAMENTE UM DESTINATÁRIO (Notification_exactly_one_recipient)');
{
  const doFuncionario = recipientColumns(userRecipient('user-1'));
  const doContato = recipientColumns(responsibleRecipient('resp-1'));

  check('funcionário: userId preenchido', doFuncionario.userId === 'user-1');
  check('funcionário: responsibleId NULO', doFuncionario.responsibleId === null);
  check('contato: responsibleId preenchido', doContato.responsibleId === 'resp-1');
  check('contato: userId NULO', doContato.userId === null);

  // ⚠️ AS DUAS CHAVES SEMPRE PRESENTES. No `update` do Prisma, chave ausente
  // quer dizer "não mexa": um `{ responsibleId }` sozinho deixaria o `userId`
  // antigo de pé, e é exatamente assim que se chega aos dois preenchidos.
  check(
    'funcionário: as DUAS chaves estão presentes',
    Object.keys(doFuncionario).sort().join(',') === 'responsibleId,userId',
  );
  check(
    'contato: as DUAS chaves estão presentes',
    Object.keys(doContato).sort().join(',') === 'responsibleId,userId',
  );

  check('o CHECK aceita a linha do funcionário', isExactlyOneRecipient(doFuncionario));
  check('o CHECK aceita a linha do contato', isExactlyOneRecipient(doContato));
  check(
    'o CHECK recusa DOIS destinatários',
    !isExactlyOneRecipient({ userId: 'u', responsibleId: 'r' }),
  );
  check(
    'o CHECK recusa NENHUM destinatário',
    !isExactlyOneRecipient({ userId: null, responsibleId: null }),
  );

  // A leitura de volta.
  check('lê de volta o funcionário', recipientOf(doFuncionario).kind === 'USER');
  check('lê de volta o contato', recipientOf(doContato).kind === 'RESPONSIBLE');

  let lancouComDois = false;
  try {
    recipientOf({ userId: 'u', responsibleId: 'r' });
  } catch {
    lancouComDois = true;
  }
  check('recipientOf LANÇA com dois destinatários', lancouComDois);

  let lancouComNenhum = false;
  try {
    recipientOf({});
  } catch {
    lancouComNenhum = true;
  }
  check(
    'recipientOf LANÇA sem destinatário',
    lancouComNenhum,
    'devolver null aqui faria o dispatch tratar a linha como BROADCAST',
  );

  check(
    'recipientOrBroadcast distingue o broadcast em memória',
    recipientOrBroadcast({ userId: null, responsibleId: null }) === null,
  );
  check('targetsResponsible reconhece o contato', targetsResponsible(doContato));
  check('targetsResponsible NÃO reconhece o funcionário', !targetsResponsible(doFuncionario));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nO DESVIO DO CLIENTE no dispatch — um aviso de cliente não vira broadcast');
{
  // A ordem importa: o desvio TEM de vir antes de `getTargetUsers`. Depois
  // dele, uma notificação sem `userId` entra no Caso 2 e varre `prisma.user`.
  const posDesvio = dispatchService.indexOf('await this.dispatchToResponsible(notification);');
  const posAlvos = dispatchService.indexOf('await this.getTargetUsers(notification);');
  check('o dispatch tem o desvio para o contato', posDesvio > 0);
  check('o dispatch ainda resolve funcionários', posAlvos > 0);
  check(
    'o desvio vem ANTES de getTargetUsers',
    posDesvio > 0 && posAlvos > 0 && posDesvio < posAlvos,
    'depois, o aviso de UM cliente sairia para a empresa inteira',
  );

  // E a segunda trava: mesmo chamado direto, `getTargetUsers` devolve vazio.
  const corpoAlvos = dispatchService.slice(
    dispatchService.indexOf('async getTargetUsers('),
    dispatchService.indexOf('async getTargetResponsible('),
  );
  const guardaDoContato = corpoAlvos.indexOf('if (notification.responsibleId) {');
  const guardaDoUsuario = corpoAlvos.indexOf('if (notification.userId) {');
  check('getTargetUsers tem a guarda do contato', guardaDoContato > 0);
  check(
    'e ela vem ANTES da resolução do funcionário',
    guardaDoContato > 0 && guardaDoUsuario > 0 && guardaDoContato < guardaDoUsuario,
  );

  check(
    'o contato é carregado junto com a notificação (loadNotification)',
    /include:\s*\{[\s\S]{0,600}?responsible:\s*true/.test(dispatchService),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nA ENTREGA AO CLIENTE reusa a escada do OTP — e não inventa uma terceira');
{
  check(
    'o dispatch injeta AuthOtpDeliveryService',
    dispatchService.includes('AuthOtpDeliveryService'),
  );
  check(
    'e entrega por deliverNotice',
    dispatchService.includes('this.authOtpDelivery.deliverNotice('),
  );
  // O corpo do método, sem a prosa que CITA o que ele não faz.
  const corpoDoContato = blocoEntre(
    dispatchServiceCode,
    'private async dispatchToResponsible(',
    'private extractActorId(',
  );
  check('o corpo de dispatchToResponsible foi encontrado', corpoDoContato.length > 0);
  check(
    'NÃO enfileira job de notificação para o contato (a fila roteia por userId)',
    corpoDoContato.length > 0 && !corpoDoContato.includes('queueNotificationJob('),
  );
  check(
    'NÃO consulta preferência de canal para o contato (não existe)',
    corpoDoContato.length > 0 && !corpoDoContato.includes('getUserChannels('),
  );
  check(
    'NÃO manda pelo websocket do funcionário',
    corpoDoContato.length > 0 && !corpoDoContato.includes('sendToUser('),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nOS DOIS SUJEITOS NÃO SE MISTURAM no código do portal');
{
  for (const [nome, fonte] of [
    ['portal-decision.service.ts', decisionServiceCode],
    ['portal-decision.controller.ts', decisionControllerCode],
  ] as const) {
    check(`${nome}: sem @UserId()`, !/@UserId\(\)/.test(fonte));
    check(`${nome}: sem request.user`, !/request\.user\b/.test(fonte));
    check(
      `${nome}: o principal é @CurrentResponsible()/ResponsiblePrincipal`,
      fonte.includes('ResponsiblePrincipal'),
    );
  }

  check(
    'o carimbo vai para FKs de Responsible, nunca de User',
    /preApprovedByResponsibleId:\s*responsibleId/.test(decisionService) &&
      /refusedByResponsibleId:\s*responsibleId/.test(decisionService),
  );

  check(
    'o ator do movimento é a sentinela vazia, não um UUID de contato',
    decisionService.includes("const SEM_FUNCIONARIO = '';") &&
      decisionService.includes('SEM_FUNCIONARIO'),
    'um UUID de contato em ChangeLog.userId derruba a transação com P2025',
  );

  check(
    'o escopo é cobrado antes de qualquer leitura do orçamento',
    decisionService.indexOf('this.scope.assertScoped(principal)') <
      decisionService.indexOf('this.prisma.budget.findFirst('),
  );
  check(
    'o orçamento é buscado COM o where do escopo, não por findUnique(id)',
    decisionService.includes('this.scope.budgetScopeWhere(principal)') &&
      !/prisma\.budget\.findUnique\(\{\s*where:\s*\{\s*id/.test(decisionService),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nO PORTÃO DA AÇÃO está nas DUAS rotas');
{
  const rotas = [...decisionController.matchAll(/@Put\('([^']+)'\)/g)].map(m => m[1]);
  check(
    'as duas rotas são as do contrato',
    rotas.join(' ') === 'orcamentos/:id/aprovar-valor orcamentos/:id/recusar',
    `achei: ${rotas.join(' ') || '(nenhuma)'}`,
  );
  check(
    'o segmento é `orcamentos` no PLURAL',
    rotas.every(r => r.startsWith('orcamentos/')),
    'no web, `orcamento` singular é engolido pela rota pública',
  );
  check(
    'toda rota tem @PortalCapability(APPROVE_VALUE)',
    (decisionController.match(/@PortalCapability\(PORTAL_CAPABILITY\.APPROVE_VALUE\)/g) ?? [])
      .length === rotas.length,
  );
  check(
    'a classe é @ResponsibleOnly()',
    /@Controller\('cliente\/me'\)\s*@ResponsibleOnly\(\)/.test(decisionController),
  );
  check('o motivo da recusa é obrigatório no zod', /motivo:[\s\S]{0,200}\.min\(1/.test(decisionController));
  check('a nota da pré-aprovação é opcional', /nota:[\s\S]{0,80}\.optional\(\)/.test(decisionController));
  check(
    'os dois corpos são .strict() — chave desconhecida some em silêncio',
    (decisionControllerCode.match(/\.strict\(\)/g) ?? []).length === 2,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nOS DOIS AVISOS nascem num lugar só, com destinatário de tipo certo');
{
  check(
    'o aviso ao comercial usa userRecipient',
    /notifyBudgetCommercial[\s\S]*?userRecipient\(/.test(portalNotifications),
  );
  check(
    'o aviso ao requisitante usa responsibleRecipient',
    /notifyRequesterValuesVisible[\s\S]*?responsibleRecipient\(/.test(portalNotifications),
  );
  check(
    'o par de colunas sai de recipientColumns, nunca escrito à mão',
    portalNotifications.includes('...recipientColumns(input.recipient)') &&
      !/data:\s*\{\s*userId:/.test(portalNotifications),
  );
  check(
    'a pré-aprovação avisa o comercial',
    decisionService.includes('PORTAL_NOTIFICATION_KEYS.PRE_APPROVED'),
  );
  check(
    'a recusa avisa o comercial',
    decisionService.includes('PORTAL_NOTIFICATION_KEYS.REFUSED'),
  );
  check(
    'REQUESTED → IN_NEGOTIATION avisa o requisitante',
    /TASK_QUOTE_STATUS\.IN_NEGOTIATION[\s\S]{0,400}?TASK_QUOTE_STATUS\.REQUESTED[\s\S]{0,400}?notifyRequesterValuesVisible/.test(
      budgetService,
    ),
  );
  check(
    'o motivo da recusa vai INTEIRO para o comercial',
    /Motivo: "\$\{note\}"/.test(decisionService),
  );

  // Os DOIS caminhos que movem REQUESTED → IN_NEGOTIATION: o seletor de status
  // (`updateStatus`) e o formulário (`update`). O segundo é o real — o
  // assistente grava serviços, valores e status na mesma requisição.
  const budgetCode = stripComments(budgetService);
  check(
    'o aviso ao requisitante sai dos DOIS caminhos (updateStatus e update)',
    (budgetCode.match(/notifyRequesterValuesVisible\(/g) ?? []).length === 2,
  );
  check(
    'e o caminho do formulário exige !_internal — senão o aviso sai em dobro',
    /!_internal &&\s*\n?\s*data\.status === TASK_QUOTE_STATUS\.IN_NEGOTIATION/.test(budgetCode),
    'updateStatus chama update(_internal = true) logo depois de já ter avisado',
  );
}

console.log(`\n${failures === 0 ? '✓ TODAS as verificações passaram' : `✗ ${failures} falha(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
