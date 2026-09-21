/**
 * A IDENTIFICACAO DO VEICULO ESCRITA PELO CLIENTE — `PATCH /cliente/me/
 * veiculos/:taskId/identificacao`.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * Esta rota e' a unica do portal em que o cliente escreve um dado que ja esta
 * IMPRESSO num documento assinado. Errar aqui nao devolve erro: devolve um 200,
 * e a coleta de assinaturas de tres pessoas vira `VOIDED` por um digito de
 * placa — sem que o contato que apertou "salvar" tenha como entender, nem como
 * reconvocar quem ja assinou.
 *
 * As sete formas exatas em que isso acontece estao verificadas abaixo:
 *
 *   1. ⛔ SOBRESCREVER UM CAMPO QUE O DOCUMENTO JA IMPRIME. O construtor do PDF
 *      (`quote-html.builder.ts:556-577`) so reserva LACUNA para o campo que
 *      estava VAZIO na emissao; o preenchido vai impresso, byte a byte, e o
 *      hash desses bytes liga a trilha de OTP ao documento. Preencher a lacuna
 *      e' legitimo (`tolerateLateRegistration` existe para isso); trocar o
 *      impresso e' alteracao MATERIAL e derruba tudo.
 *
 *   2. ESCOPO DE LEITURA NO LUGAR DO COMERCIAL. `taskScopeWhere` tem o caminho
 *      (c) — "eu sou contato deste veiculo" —, que e' PESSOAL, atravessa
 *      empresas de proposito e nao carrega laco comercial nenhum.
 *
 *   3. A IGUALDADE `task.customerId === companyId` no lugar do predicado. Ela
 *      erra para o outro lado: recusa o caso Furgoes (a Ibipora emite, o
 *      caminhao e' da RKO — orcamentos 259-262).
 *
 *   4. O NUMERO DO PEDIDO SEM SUB-PORTAO. A rota exige
 *      `WRITE_VEHICLE_IDENTITY`, que o GESTOR DE FROTA tem; o pedido de compra
 *      e' de quem tem `WRITE_PURCHASE_ORDER`, que ele NAO tem.
 *
 *   5. `''` GRAVADO NO LUGAR DE `null` — e `undefined` confundido com `null`,
 *      que faria um formulario que manda so a placa apagar serie e chassi.
 *
 *   6. O P2002 DO PRISMA VAZANDO. `Task.serialNumber` e `Truck.plate` sao
 *      `@unique` GLOBAIS; "Unique constraint failed on the fields:
 *      (`serialNumber`)" e' um 500 na tela que nao diz qual valor esta
 *      repetido.
 *
 *   7. A MENSAGEM UNICA DE CHASSI. "17 caracteres" nao ajuda em nada quem
 *      digitou um O no lugar do 0 num chassi que ja tem 17.
 *
 * Nada aqui toca no banco: o que se verifica sao FUNCOES PURAS (a regra da
 * assinatura, o schema da borda, a tabela de capacidades, o predicado do
 * escopo) e a FORMA da fonte onde a regra so existe dentro de um servico. E' o
 * mesmo metodo de `test:responsible-otp` e `test:portal-escopo`.
 *
 * `npm run test:portal-identificacao`
 */

import { readFileSync } from 'fs';
import { isSolePurchasingContact } from '../src/modules/common/signature/purchase-order-gate';
import { join } from 'path';

import {
  hasCapability,
  capabilitiesForRoles,
  PORTAL_CAPABILITY,
  ROLE_CAPABILITIES,
} from '../src/modules/people/portal/portal-capabilities';
import {
  commercialTaskLink,
  PortalScopeService,
} from '../src/modules/people/portal/portal-scope.service';
import {
  classifyVehicleIdentityWrite,
  frozenIdentityInSnapshot,
  frozenIdentityOf,
  overwritesAmong,
  vehicleIdentityConflictMessage,
  VEHICLE_IDENTITY_FIELDS,
} from '../src/modules/people/portal/portal-vehicle-identity';
import {
  assertIdentidadeNaoContradizDocumento,
  mudancaDePedido,
} from '../src/modules/people/portal/portal-frozen-document';
import { PortalIdentityService } from '../src/modules/people/portal/portal-identity.service';
import { PurchaseOrderService } from '../src/modules/production/purchase-order/purchase-order.service';
import {
  NADA_PARA_MUDAR_MENSAGEM,
  portalIdentificacaoCorpoSchema,
  portalIdentificacaoSchema,
  temAlgoParaMudar,
} from '../src/schemas/portal-vehicle-identity';
import { PAYLOAD_INVALIDO_MENSAGEM } from '../src/schemas/portal-request';
import {
  CHASSIS_FORBIDDEN_LETTERS_MESSAGE,
  CHASSIS_INVALID_MESSAGE,
  PLATE_INVALID_MESSAGE,
} from '../src/utils/truck';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const raiz = join(__dirname, '..');
const fonte = (caminho: string) => readFileSync(join(raiz, caminho), 'utf8');

/**
 * A FONTE SEM OS COMENTARIOS.
 *
 * ⚠️ SEM ISTO TODA AFIRMACAO DE AUSENCIA E FALSA. Os arquivos deste pacote
 * documentam, em prosa, exatamente o que nao fazem — "⛔ NAO acrescente
 * `@ResponsibleRoles(...)`", "NUNCA `customerConfigs: true`", "⚠️ E NAO HA
 * `@UserId()`". Um `!/@UserId\(/.test(fonte)` reprova por causa do AVISO que
 * existe para impedir o defeito, e a unica forma de "consertar" seria apagar o
 * aviso — trocando uma trava por um teste verde.
 *
 * O contrario tambem e' verdade: um `/@UserId\(/` que so casasse dentro de um
 * comentario passaria com a chamada NUNCA tendo sido escrita.
 *
 * O scanner respeita aspas simples, duplas e crase — um `'image/'` ou um
 * `'https://…'` dentro de string nao pode ser confundido com inicio de
 * comentario.
 */
function codigo(texto: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;

  while (i < texto.length) {
    const c = texto[i];
    const n = texto[i + 1];

    if (quote) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }

    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      i++;
      continue;
    }

    if (c === '/' && n === '/') {
      while (i < texto.length && texto[i] !== '\n') i++;
      continue;
    }

    if (c === '/' && n === '*') {
      i += 2;
      while (i < texto.length && !(texto[i] === '*' && texto[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

const SERVICO = codigo(fonte('src/modules/people/portal/portal-identity.service.ts'));
/** A guarda do documento congelado — COMPARTILHADA pelos dois caminhos de escrita. */
const GUARDA = codigo(fonte('src/modules/people/portal/portal-frozen-document.ts'));
/** O outro caminho que escreve `Task.customerOrderNumber`. */
const PEDIDO = codigo(fonte('src/modules/production/purchase-order/purchase-order.service.ts'));
const CONTROLLER = codigo(fonte('src/modules/people/portal/portal-identity.controller.ts'));
const MODULO = codigo(fonte('src/modules/people/portal/portal-identity.module.ts'));
const REGRA = codigo(fonte('src/modules/people/portal/portal-vehicle-identity.ts'));
const APP = fonte('src/app.module.ts');

/** Atalho: o corpo, ja validado, ou o erro. */
const parse = (corpo: unknown) => portalIdentificacaoSchema.safeParse(corpo);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n⛔ A COLETA DE ASSINATURAS — os dois ramos, que e o que importa');
// ═══════════════════════════════════════════════════════════════════════════
{
  // O documento congelado deste veiculo: placa EM BRANCO (implemento 0 km,
  // orcado e assinado antes de emplacar), serie JA IMPRESSA.
  const congelado = {
    serialNumber: '1003',
    plate: null,
    chassisNumber: null,
    orderNumber: null,
  };

  // ── RAMO 1: PREENCHER O QUE ESTAVA EM BRANCO ────────────────────────────
  const preenchendo = classifyVehicleIdentityWrite(congelado, { plate: 'ABC1D23' });
  check(
    'preencher a placa que o documento deixou em branco => LATE_FILL',
    preenchendo.length === 1 && preenchendo[0].kind === 'LATE_FILL',
    JSON.stringify(preenchendo),
  );
  check(
    'e NAO e recusado (nenhuma sobrescrita)',
    overwritesAmong(preenchendo).length === 0,
  );

  // O chassi que chega depois e' o caso canonico do aditivo: medido no
  // orcamento no 81ZR-79SY-6EN5, cadastrado 14 MINUTOS depois do selo.
  const chassiTardio = classifyVehicleIdentityWrite(congelado, {
    chassisNumber: '9BM979026CS006622',
  });
  check(
    'preencher o chassi que chegou depois do selo => LATE_FILL, nao recusa',
    chassiTardio[0]?.kind === 'LATE_FILL' && overwritesAmong(chassiTardio).length === 0,
  );

  // ── RAMO 2: TROCAR O QUE JA ESTAVA IMPRESSO ─────────────────────────────
  const trocando = classifyVehicleIdentityWrite(congelado, { serialNumber: '1004' });
  check(
    'trocar a serie que o documento ja imprime => OVERWRITE',
    trocando.length === 1 && trocando[0].kind === 'OVERWRITE',
    JSON.stringify(trocando),
  );
  check('e e recusado', overwritesAmong(trocando).length === 1);

  // APAGAR tambem e sobrescrever. O documento diz "1003"; o cadastro passaria a
  // nao dizer nada, e a folha continuaria afirmando.
  const apagando = classifyVehicleIdentityWrite(congelado, { serialNumber: null });
  check('APAGAR o que o documento imprime tambem e OVERWRITE', apagando[0]?.kind === 'OVERWRITE');

  // ── O QUE NAO E NEM UM NEM OUTRO ────────────────────────────────────────
  const igual = classifyVehicleIdentityWrite(congelado, { serialNumber: '1003' });
  check('reenviar o MESMO valor nao e sobrescrita', igual[0]?.kind === 'UNCHANGED');

  const soCaixa = classifyVehicleIdentityWrite(
    { ...congelado, plate: 'abc1d23' },
    { plate: 'ABC1D23' },
  );
  check(
    'caixa nao e identidade: `abc1d23` -> `ABC1D23` nao derruba coleta nenhuma',
    soCaixa[0]?.kind === 'UNCHANGED',
  );

  const naoMencionado = classifyVehicleIdentityWrite(congelado, { plate: 'ABC1D23' });
  check(
    'campo NAO mencionado no corpo nao entra na classificacao',
    naoMencionado.length === 1 && naoMencionado[0].field === 'plate',
  );

  // ⚠️ `undefined` e' "nao toque"; `null` e' "apague". Confundir os dois faria
  // um formulario que manda so a placa apagar a serie e o chassi.
  const semNada = classifyVehicleIdentityWrite(congelado, {
    serialNumber: undefined,
    plate: undefined,
    chassisNumber: undefined,
    orderNumber: undefined,
  });
  check('`undefined` em todos os campos nao classifica NADA', semNada.length === 0);

  // ── O VEICULO QUE NAO ESTAVA NO DOCUMENTO ───────────────────────────────
  //
  // Tarefa acrescentada ao orcamento depois da emissao: nao tem linha nem
  // lacuna naquela folha, entao escrever a identidade dela nao contradiz nada.
  const semCongelado = classifyVehicleIdentityWrite(null, { plate: 'ABC1D23' });
  check(
    'veiculo ausente do documento congelado: tudo e LATE_FILL',
    semCongelado[0]?.kind === 'LATE_FILL' && overwritesAmong(semCongelado).length === 0,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nO snapshot congelado e lido pelas DUAS formas (v1/v2 e v3+)');
// ═══════════════════════════════════════════════════════════════════════════
{
  // v3+: lista `vehicles`, pareada por `taskId` e NUNCA por posicao — excluir o
  // caminhao 12 de sessenta deslocaria os quarenta e oito seguintes.
  const v3: any = {
    vehicles: [
      { taskId: 'task-A', serialNumber: '1001', plate: 'AAA1A11', chassisNumber: null },
      { taskId: 'task-B', serialNumber: '1002', plate: null, chassisNumber: null },
    ],
  };
  check(
    'v3+: acha o veiculo pelo taskId, nao pela posicao',
    frozenIdentityInSnapshot(v3, 'task-B')?.serialNumber === '1002',
  );
  check(
    'v3+: veiculo que nao esta no documento devolve null',
    frozenIdentityInSnapshot(v3, 'task-Z') === null,
  );

  // v1/v2: `task` + `truck` no SINGULAR. Ler `snapshot.vehicles` direto deixaria
  // esta guarda CEGA para toda coleta anterior a multitarefa.
  const v1: any = {
    task: { id: 'task-velha', name: 'X', serialNumber: '900' },
    truck: { plate: 'XYZ9876', chassisNumber: '9BM979026CS006622' },
  };
  check(
    'v1/v2: `task`+`truck` no singular sao lidos pelo mesmo caminho',
    frozenIdentityInSnapshot(v1, 'task-velha')?.plate === 'XYZ9876',
  );
  check(
    'v1/v2: e a placa impressa la BLOQUEIA a troca',
    overwritesAmong(
      classifyVehicleIdentityWrite(frozenIdentityInSnapshot(v1, 'task-velha'), {
        plate: 'AAA1A11',
      }),
    ).length === 1,
  );

  // `orderNumber` entrou DEPOIS das outras tres chaves: envelope congelado antes
  // disso nao a tem, e a ausencia tem de ser lida como BRANCO — que e' o que a
  // folha de fato mostrava.
  const semPedido = frozenIdentityOf(
    [{ taskId: 't', serialNumber: null, plate: null, chassisNumber: null } as any],
    't',
  );
  check('`orderNumber` ausente no snapshot antigo le como BRANCO', semPedido?.orderNumber === null);
  check(
    'e por isso informar o pedido num envelope antigo e LATE_FILL',
    classifyVehicleIdentityWrite(semPedido, { orderNumber: '8842' })[0]?.kind === 'LATE_FILL',
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA frase da recusa diz O QUE, POR QUE e A QUEM RECORRER');
// ═══════════════════════════════════════════════════════════════════════════
{
  const overwrites = classifyVehicleIdentityWrite(
    { serialNumber: '1003', plate: null, chassisNumber: null, orderNumber: null },
    { serialNumber: '1004' },
  );

  const correndo = vehicleIdentityConflictMessage(overwrites, 'RUNNING', 'Ana do Comercial');
  check('nomeia o valor impresso', correndo.includes('1003'));
  check('nomeia o valor enviado', correndo.includes('1004'));
  check('nomeia o campo em portugues', correndo.includes('número de série'));
  check('diz que o documento esta em coleta', /COLETA DE ASSINATURAS/.test(correndo));
  check('nomeia quem procurar', correndo.includes('Ana do Comercial'));

  const selado = vehicleIdentityConflictMessage(overwrites, 'COMPLETED', null);
  check('distingue o documento JA ASSINADO do que esta em coleta', /JÁ FOI ASSINADO/.test(selado));
  check(
    'sem comercial cadastrado, ainda diz a quem recorrer',
    selado.includes('comercial da Ankaa'),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nO SERVICO consulta o documento ANTES de escrever (forma da fonte)');
// ═══════════════════════════════════════════════════════════════════════════
{
  check(
    'procura envelope RUNNING e COMPLETED (a mesma dupla de onQuoteContentChanged)',
    /ENVELOPES_VIVOS\s*=\s*\['RUNNING',\s*'COMPLETED'\]/.test(GUARDA),
  );
  check(
    '⚠️ RUNNING e procurado PRIMEIRO, em consulta propria (ordenar por enum do Postgres ' +
      'segue a ordem de DECLARACAO do tipo, nao o alfabeto)',
    GUARDA.indexOf('status: ENVELOPE_RUNNING') >= 0 &&
      GUARDA.indexOf('status: ENVELOPE_RUNNING') < GUARDA.indexOf('status: ENVELOPE_COMPLETED') &&
      !/status:\s*\{\s*in:\s*ENVELOPES_VIVOS/.test(GUARDA),
  );
  check(
    'entre dois concluidos vale o de MAIOR versao (o contrato em vigor)',
    /orderBy:\s*\{\s*version:\s*'desc'\s*\}/.test(GUARDA),
  );
  check(
    'le o snapshot pela unica porta de entrada (`frozenIdentityInSnapshot`)',
    /frozenIdentityInSnapshot\(/.test(GUARDA) && !/\.quoteSnapshot\s*as[^;]*\.vehicles/.test(GUARDA),
  );
  check('recusa com 409 (`ConflictException`)', /throw new ConflictException\(/.test(GUARDA));
  check(
    'a guarda NAO e um servico injetavel (um seria forwardRef: PortalIdentityService ja injeta PurchaseOrderService)',
    !/@Injectable\(\)/.test(GUARDA),
  );
  check(
    'e o servico da identidade DELEGA para ela, em vez de manter a sua propria consulta',
    /assertIdentidadeNaoContradizDocumento\(this\.prisma, quoteId, taskId, desejado\)/.test(
      SERVICO,
    ) && !/signatureEnvelope\.findFirst\(/.test(SERVICO),
  );
  check(
    'a guarda do documento roda ANTES da escrita',
    SERVICO.indexOf('assertNaoContradizDocumento(task.quoteId') <
      SERVICO.indexOf('await this.gravar('),
  );
  check(
    '⚠️ so o que DE FATO muda e julgado (reenviar o valor ja gravado nao pode dar 409)',
    /apenasOQueMuda\(task, dados, pedido\)/.test(SERVICO) &&
      /if \(\(valor \?\? null\) === atual\[campo\]\) continue;/.test(SERVICO),
  );
  check(
    'NAO chama o gancho de invalidacao (`onQuoteContentChanged`)',
    !/this\.[A-Za-z]+\.onQuoteContentChanged\(/.test(SERVICO),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nO PORTAO DA ROTA — `WRITE_VEHICLE_IDENTITY`, e so ele');
// ═══════════════════════════════════════════════════════════════════════════
{
  const escrevem = [
    'COMMERCIAL',
    'SELLER',
    'REPRESENTATIVE',
    'COORDINATOR',
    'PURCHASING',
    'FLEET_MANAGER',
  ];
  const naoEscrevem = ['MARKETING', 'FINANCIAL', 'DRIVER'];

  for (const papel of escrevem) {
    check(
      `${papel} escreve identidade de veiculo`,
      hasCapability([papel], PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY),
    );
  }
  for (const papel of naoEscrevem) {
    check(
      `${papel} NAO escreve identidade de veiculo`,
      !hasCapability([papel], PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY),
    );
  }

  // Papel e' LISTA e a semantica e' UNIAO: acumular funcoes nunca TIRA poder.
  check(
    'MOTORISTA + GESTOR DE FROTA escreve (uniao, nunca intersecao)',
    hasCapability(['DRIVER', 'FLEET_MANAGER'], PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY),
  );
  check(
    'cadastro sem papel nenhum (`roles: []`, que o banco permite) nao escreve',
    !hasCapability([], PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY),
  );
  check(
    'papel desconhecido nao vira poder',
    !hasCapability(['SUPERVISOR_GERAL'], PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY),
  );

  // A tabela e' `Record<RESPONSIBLE_ROLE, …>`: papel novo sem decisao e' erro de
  // compilacao. Aqui so se guarda que ninguem a esvaziou.
  check(
    'a tabela cobre os 9 papeis',
    Object.keys(ROLE_CAPABILITIES).length === 9,
    String(Object.keys(ROLE_CAPABILITIES).length),
  );

  check(
    'o controller marca a rota com @PortalCapability(WRITE_VEHICLE_IDENTITY)',
    /@PortalCapability\(PORTAL_CAPABILITY\.WRITE_VEHICLE_IDENTITY\)/.test(CONTROLLER),
  );
  check('o controller e @ResponsibleOnly()', /@ResponsibleOnly\(\)/.test(CONTROLLER));
  check(
    'o controller NAO usa @UseGuards (a marca e o decorador bastam)',
    !/@UseGuards\(/.test(CONTROLLER),
  );
  check(
    'o controller NAO empilha @ResponsibleRoles (mesma chave de metadado, sobrescreve)',
    !/@ResponsibleRoles\(/.test(CONTROLLER),
  );
  check('⛔ NENHUM @UserId() no pacote', !/@UserId\(/.test(CONTROLLER) && !/@UserId\(/.test(SERVICO));
  check('`taskId` passa por ParseUUIDPipe', /ParseUUIDPipe/.test(CONTROLLER));
  check(
    'a rota e PATCH veiculos/:taskId/identificacao',
    /@Patch\('veiculos\/:taskId\/identificacao'\)/.test(CONTROLLER),
  );
  check(
    'o modulo esta registrado no AppModule (sem isso a rota e 404)',
    /PortalIdentityModule,/.test(APP) && /portal-identity\.module/.test(APP),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nO SUB-PORTAO DO PEDIDO DE COMPRA');
// ═══════════════════════════════════════════════════════════════════════════
{
  // ⚠️ O SUB-PORTAO CONTINUA EXISTINDO, e hoje nao barra ninguem — decisao do
  // dono: "vendedor tambem pode definir o numero de pedido, nao apenas o
  // compras, todos os papeis; mas se nao tiver, pelo menos o compras fica
  // impedido de assinar". A exigencia migrou inteira para o PORTAO DA
  // ASSINATURA (`purchase-order-gate.ts`), que e' onde ela sempre pertenceu: a
  // regra e' sobre o ATO DE APROVAR, nao sobre quem digita.
  //
  // O codigo do sub-portao fica de pe: ele volta a morder no dia em que a
  // tabela de capacidades estreitar, e custa uma linha.
  check(
    'GESTOR DE FROTA escreve placa e chassi',
    hasCapability(['FLEET_MANAGER'], PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY),
  );
  check(
    'e AGORA tambem o numero do pedido (todos os papeis escrevem)',
    hasCapability(['FLEET_MANAGER'], PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER),
  );
  check(
    'COMPRAS escreve os dois',
    hasCapability(['PURCHASING'], PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY) &&
      hasCapability(['PURCHASING'], PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER),
  );
  check(
    'FINANCEIRO escreve o pedido e NAO a identidade — e por isso nem entra nesta rota',
    hasCapability(['FINANCIAL'], PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER) &&
      !hasCapability(['FINANCIAL'], PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY),
  );
  check(
    'COMERCIAL escreve identidade E o pedido — era o gargalo que o dono desfez',
    hasCapability(['COMMERCIAL'], PORTAL_CAPABILITY.WRITE_VEHICLE_IDENTITY) &&
      hasCapability(['COMMERCIAL'], PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER),
  );
  check(
    '⛔ e mesmo assim o COMPRAS-PURO segue barrado de ASSINAR sem o numero',
    isSolePurchasingContact(['PURCHASING']) && !isSolePurchasingContact(['COMMERCIAL']),
  );
  check(
    'quem acumula COMPRAS com GESTOR DE FROTA escreve os dois',
    capabilitiesForRoles(['FLEET_MANAGER', 'PURCHASING']).includes(
      PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER,
    ),
  );

  check(
    'o servico cobra WRITE_PURCHASE_ORDER antes de aceitar `purchaseOrderNumber`',
    /hasCapability\(\s*principal\.roles,\s*PORTAL_CAPABILITY\.WRITE_PURCHASE_ORDER\s*\)/.test(
      SERVICO,
    ) && /throw new ForbiddenException\(/.test(SERVICO),
  );
  check(
    '⛔ a escrita do pedido e DELEGADA (escrita dupla), nunca `customerOrderNumber` a mao',
    /this\.purchaseOrders\.createFromPortal\(/.test(SERVICO) &&
      !/customerOrderNumber:\s*/.test(SERVICO.replace(/customerOrderNumber:\s*true/g, '')),
  );
  check(
    'o modulo importa PurchaseOrderModule',
    /PurchaseOrderModule/.test(MODULO),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n⛔ O ESCOPO E COMERCIAL — (a) PAGADOR ou (b) DONO, nunca (c) contato');
// ═══════════════════════════════════════════════════════════════════════════
{
  const scope = new PortalScopeService();
  const IBIPORA = 'ibipora-uuid';
  const RKO = 'rko-uuid';
  const CONTATO = 'contato-uuid';

  const where: any = scope.commercialTaskScopeWhere({ id: CONTATO, companyId: IBIPORA } as any);
  const serializado = JSON.stringify(where);

  check('o `where` tem exatamente DOIS ramos', where.OR?.length === 2, serializado);
  check(
    '⛔ nenhum ramo e `responsibles` (o caminho PESSOAL nao autoriza escrita comercial)',
    !/responsibles/.test(serializado),
  );
  check('um ramo e o PAGADOR (billingEntry -> customerConfigs)', /billingEntry/.test(serializado));
  check('o outro e o DONO (`customerId`)', where.OR?.some((r: any) => r.customerId === IBIPORA));
  check(
    'nenhum ramo e vazio (um `OR` vazio devolve A TABELA)',
    where.OR?.every((r: any) => r && Object.keys(r).length > 0),
  );

  // ── O CASO FURGOES: pagador mas NAO dono ────────────────────────────────
  //
  // A Ibipora faz o bau e intermedeia a pintura; o caminhao e' da RKO
  // (orcamentos 259-262, migration `20260917150100`). A igualdade
  // `task.customerId === companyId` recusaria o caso PRINCIPAL da feature.
  const pagadorNaoDono = {
    customerId: RKO,
    billingEntry: { billing: { customerConfigs: [{ customerId: IBIPORA }] } },
  };
  check(
    'PAGADOR mas nao dono: PERMITIDO (o caso Furgoes)',
    commercialTaskLink(pagadorNaoDono, IBIPORA) === 'PAYER',
  );
  check(
    'DONO: PERMITIDO',
    commercialTaskLink({ customerId: IBIPORA, billingEntry: null }, IBIPORA) === 'OWNER',
  );

  // ── SO CONTATO PESSOAL: RECUSADO ────────────────────────────────────────
  //
  // `Task.responsibles` e' m:n e NADA confere contra `Task.customerId`. Um
  // contato pendurado por engano num caminhao de outra empresa carimbaria a
  // placa da empresa dele nele, e o banco nao reclamaria de nada.
  const soContato = {
    customerId: RKO,
    billingEntry: { billing: { customerConfigs: [] } },
  };
  check(
    '⛔ so contato pessoal do veiculo: RECUSADO',
    commercialTaskLink(soContato, IBIPORA) === null,
  );
  check(
    '⛔ `select` incompleto (sem billingEntry) FALHA FECHADO',
    commercialTaskLink({ customerId: RKO }, IBIPORA) === null,
  );
  check(
    '⛔ contato sem empresa nao "e dono" de tarefa orfa (undefined === undefined)',
    commercialTaskLink({ customerId: null }, null) === null,
  );

  // A guarda de `companyId` nulo — sem ela o `where` vira `customerId IS NULL`,
  // que no Postgres casa com TODOS os orfaos.
  let recusouSemEmpresa = false;
  try {
    scope.commercialTaskScopeWhere({ id: CONTATO, companyId: null } as any);
  } catch {
    recusouSemEmpresa = true;
  }
  check('contato SEM empresa e recusado antes de montar o `where`', recusouSemEmpresa);

  check(
    'o servico usa `commercialTaskScopeWhere`, nunca `taskScopeWhere`',
    /this\.scope\.commercialTaskScopeWhere\(/.test(SERVICO) &&
      !/this\.scope\.taskScopeWhere\(/.test(SERVICO),
  );
  check(
    'e confere de novo a linha carregada com `commercialTaskLink` (falha fechado)',
    /commercialTaskLink\(task,\s*companyId\)\s*===\s*null/.test(SERVICO),
  );
  check(
    '⛔ fora do escopo e 404, NUNCA 403',
    /throw new NotFoundException\('Veículo não encontrado\.'\)/.test(SERVICO) &&
      !/ForbiddenException\('Veículo/.test(SERVICO),
  );
  check(
    'o include do pagador e RECORTADO (`where: { customerId }`), nunca `customerConfigs: true`',
    /customerConfigs:\s*\{\s*where:\s*\{\s*customerId\s*\}/.test(SERVICO) &&
      !/customerConfigs:\s*true/.test(SERVICO),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA BORDA — normalizacao, `\'\'` -> null e as duas mensagens de chassi');
// ═══════════════════════════════════════════════════════════════════════════
{
  // ── SERIE: TEXTO, e MAIUSCULA na borda ──────────────────────────────────
  const serie = parse({ serialNumber: ' abc-123456 ' });
  check(
    'serie e TEXTO e sobe para MAIUSCULA (`abc-1` e o que esta escrito no chassi)',
    serie.success && (serie as any).data.serialNumber === 'ABC-123456',
    JSON.stringify(serie.success ? (serie as any).data : serie.error.issues),
  );
  const serieRuim = parse({ serialNumber: 'ABC 123' });
  check(
    'serie com caractere fora de [A-Z0-9-] e recusada',
    !serieRuim.success &&
      /apenas letras maiúsculas, números e hífens/.test(serieRuim.error.issues[0].message),
  );

  // ── PLACA: limpa, e os dois padroes brasileiros ─────────────────────────
  const placaAntiga = parse({ plate: 'abc-1234' });
  check(
    'placa antiga e limpa (sem hifen) e maiuscula',
    placaAntiga.success && (placaAntiga as any).data.plate === 'ABC1234',
  );
  const mercosul = parse({ plate: 'ABC1D23' });
  check('placa Mercosul passa', mercosul.success && (mercosul as any).data.plate === 'ABC1D23');
  const placaRuim = parse({ plate: 'A1' });
  check(
    'placa invalida traz a mensagem de formato',
    !placaRuim.success && placaRuim.error.issues.some(i => i.message === PLATE_INVALID_MESSAGE),
  );

  // ── CHASSI: DUAS mensagens distintas ────────────────────────────────────
  const chassiCurto = parse({ chassisNumber: '9BM979026' });
  check(
    'chassi de tamanho errado => mensagem de COMPRIMENTO',
    !chassiCurto.success &&
      chassiCurto.error.issues.some(i => i.message === CHASSIS_INVALID_MESSAGE),
    JSON.stringify(chassiCurto.success ? null : chassiCurto.error.issues.map(i => i.message)),
  );
  const chassiComO = parse({ chassisNumber: '9BM979O26CS006622' });
  check(
    '⚠️ chassi com 17 caracteres e um O => mensagem de LETRA PROIBIDA, nao a de comprimento',
    !chassiComO.success &&
      chassiComO.error.issues.some(i => i.message === CHASSIS_FORBIDDEN_LETTERS_MESSAGE) &&
      !chassiComO.error.issues.some(i => i.message === CHASSIS_INVALID_MESSAGE),
    JSON.stringify(chassiComO.success ? null : chassiComO.error.issues.map(i => i.message)),
  );
  const chassiBom = parse({ chassisNumber: '9bm 979026 cs006622' });
  check(
    'chassi valido e limpo e maiusculo',
    chassiBom.success && (chassiBom as any).data.chassisNumber === '9BM979026CS006622',
  );

  // ── `''` -> null, `'null'` -> null, AUSENTE -> undefined ────────────────
  const vazios = parse({
    serialNumber: '',
    plate: '',
    chassisNumber: '',
    purchaseOrderNumber: '',
    vinPlateFileId: '',
  });
  check(
    "`''` vira null nos cinco campos (nunca a string vazia gravada)",
    vazios.success &&
      VEHICLE_IDENTITY_FIELDS.length === 4 &&
      (vazios as any).data.serialNumber === null &&
      (vazios as any).data.plate === null &&
      (vazios as any).data.chassisNumber === null &&
      (vazios as any).data.purchaseOrderNumber === null &&
      (vazios as any).data.vinPlateFileId === null,
    JSON.stringify(vazios.success ? (vazios as any).data : vazios.error.issues),
  );
  const literalNulo = parse({ serialNumber: 'null', purchaseOrderNumber: 'null' });
  check(
    "a string literal `'null'` do FormData tambem vira null (nao um valor de 4 letras)",
    literalNulo.success &&
      (literalNulo as any).data.serialNumber === null &&
      (literalNulo as any).data.purchaseOrderNumber === null,
  );
  const soPlaca = parse({ plate: 'ABC1D23' });
  check(
    '⚠️ AUSENTE e `undefined`, NUNCA null — mandar so a placa nao apaga serie nem chassi',
    soPlaca.success &&
      (soPlaca as any).data.serialNumber === undefined &&
      (soPlaca as any).data.chassisNumber === undefined,
  );

  // ── `.strict()`: chave desconhecida NOMEIA o erro ───────────────────────
  const chaveErrada = parse({ chassis: '9BM979026CS006622' });
  check(
    "⚠️ `chassis` no lugar de `chassisNumber` e RECUSADO e nomeado (sem `.strict()` viraria um 200 vazio)",
    !chaveErrada.success && /chassis/.test(JSON.stringify(chaveErrada.error.issues)),
    JSON.stringify(chaveErrada.success ? null : chaveErrada.error.issues),
  );

  // ── CORPO VAZIO ─────────────────────────────────────────────────────────
  check('`{}` nao tem nada para mudar', !temAlgoParaMudar({} as any));
  check(
    '`{}` COM a foto da plaqueta e um PATCH valido (zod nao enxerga arquivo)',
    temAlgoParaMudar({} as any, { temPlaqueta: true }),
  );
  check(
    '`{ plate: null }` TEM o que mudar (apagar e um ato)',
    temAlgoParaMudar({ plate: null } as any),
  );
  check(
    'a mensagem de corpo vazio lista os cinco campos',
    /série.*placa.*chassi.*plaqueta.*pedido/.test(NADA_PARA_MUDAR_MENSAGEM),
  );
  check(
    'o servico recusa o corpo vazio com essa mensagem',
    /temAlgoParaMudar\(/.test(SERVICO) && /NADA_PARA_MUDAR_MENSAGEM/.test(SERVICO),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nO MULTIPART — um campo `payload` com o corpo inteiro dentro');
// ═══════════════════════════════════════════════════════════════════════════
{
  const corpo = { plate: 'ABC1D23', chassisNumber: '9BM979026CS006622' };

  // Forma 1: JSON puro (sem arquivo).
  const puro = portalIdentificacaoCorpoSchema.safeParse(corpo);
  // Forma 2: `payload` como STRING (o teste, e qualquer chamador fora do pipe).
  const comoString = parse({ payload: JSON.stringify(corpo) });
  // Forma 3: `payload` JA DESSERIALIZADO (pela rota: `fixArrays` roda antes).
  const comoObjeto = parse({ payload: corpo });

  check('JSON puro passa', puro.success);
  check('`payload` como string passa', comoString.success);
  check('`payload` ja desserializado passa', comoObjeto.success);
  check(
    'as TRES formas produzem o MESMO objeto',
    puro.success &&
      comoString.success &&
      comoObjeto.success &&
      JSON.stringify((puro as any).data) === JSON.stringify((comoString as any).data) &&
      JSON.stringify((comoString as any).data) === JSON.stringify((comoObjeto as any).data),
  );

  const quebrado = parse({ payload: '{"plate": ' });
  check(
    '`payload` ilegivel vira UM erro nomeado, nao "campo obrigatorio" em todos os campos',
    !quebrado.success &&
      quebrado.error.issues.length === 1 &&
      quebrado.error.issues[0].message === PAYLOAD_INVALIDO_MENSAGEM,
  );

  check(
    'o desembrulho e REUSADO de portal-request, nao copiado',
    /desempacotarPayload/.test(fonte('src/schemas/portal-vehicle-identity.ts')) &&
      /from '\.\/portal-request'/.test(fonte('src/schemas/portal-vehicle-identity.ts')),
  );
  check(
    'o campo de arquivo e `truckVinPlate`, no maximo 1',
    /name:\s*'truckVinPlate',\s*maxCount:\s*MAXIMO_PLAQUETAS/.test(CONTROLLER) &&
      /MAXIMO_PLAQUETAS\s*=\s*1/.test(CONTROLLER),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA PLAQUETA e ARQUIVO, e vai para a pasta `Plaquetas`');
// ═══════════════════════════════════════════════════════════════════════════
{
  check(
    'sobe pelo mesmo caminho da tarefa (`createFromUploadWithTransaction`, contexto truckVinPlate)',
    /createFromUploadWithTransaction\(/.test(SERVICO) && /'truckVinPlate',/.test(SERVICO),
  );
  check(
    'o contexto `truckVinPlate` mapeia para a pasta `Plaquetas`',
    /truckVinPlate:\s*'Plaquetas'/.test(
      fonte('src/modules/common/file/services/files-storage.service.ts'),
    ),
  );
  check(
    '⚠️ o upload vai SEM userId (File.createdById e FK de User)',
    /'truckVinPlate',\s*\n\s*undefined,/.test(SERVICO),
  );
  check('e grava em `Truck.vinPlateId`', /vinPlateId:\s*arquivo\.id/.test(SERVICO));
  check(
    'so aceita imagem (a plaqueta e uma FOTO; a coluna de texto morreu em 20260727150000)',
    /startsWith\('image\/'\)/.test(SERVICO),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n⛔ `Truck` PODE NAO EXISTIR — e `plate` NUNCA vai no topo');
// ═══════════════════════════════════════════════════════════════════════════
{
  check(
    'cria a linha de `Truck` quando ela nao existe',
    /tx\.truck\.create\(/.test(SERVICO),
  );
  check(
    'e so atualiza quando existe (nada de update otimista => P2025)',
    /if \(!truckId\) \{/.test(SERVICO) && /tx\.truck\.update\(/.test(SERVICO),
  );
  check(
    '⛔ escreve placa e chassi em `tx.truck`, NUNCA no topo de `task`',
    !/tx\.task\.update\([^)]*plate/.test(SERVICO) &&
      !/data:\s*\{[^}]*\bplate:\s*[^}]*\}\s*\}\s*\)\s*;?\s*\/\/\s*task/.test(SERVICO),
  );
  check(
    'nao passa por TaskService (taskUpdateSchema nao e `.strict()`)',
    !/TaskService/.test(SERVICO) && !/TaskModule/.test(MODULO),
  );
  check('tudo numa transacao so', /this\.prisma\.\$transaction\(/.test(SERVICO));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAS UNICIDADES GLOBAIS — o contrato de erro, nunca o P2002');
// ═══════════════════════════════════════════════════════════════════════════
{
  check(
    'a serie e conferida em `Task` antes de escrever',
    /prisma\.task\.findFirst\(\{[\s\S]{0,200}serialNumber: serie/.test(SERVICO),
  );
  check(
    'a placa e conferida em `Truck` antes de escrever',
    /prisma\.truck\.findFirst\(\{[\s\S]{0,200}plate: placa/.test(SERVICO),
  );
  check(
    '⚠️ o PROPRIO veiculo e excluido da busca (reenviar o mesmo valor nao e colisao)',
    /NOT:\s*\{\s*id:\s*taskId\s*\}/.test(SERVICO) && /NOT:\s*\{\s*taskId\s*\}/.test(SERVICO),
  );
  check(
    'o erro e 400 com `{ message, errors[], conflicts[] }` — o mesmo da requisicao',
    /throw new BadRequestException\(\{[\s\S]{0,300}errors: frases,[\s\S]{0,120}conflicts: colisoes,/.test(
      SERVICO,
    ),
  );
  check(
    'a frase NOMEIA o valor culpado',
    /\$\{rotulo\} \$\{colisao\.value\}/.test(SERVICO),
  );
  check(
    '`null` nao colide com `null` (dois NULL nao sao iguais num indice unico)',
    /typeof serie === 'string' && serie !== ''/.test(SERVICO) &&
      /typeof placa === 'string' && placa !== ''/.test(SERVICO),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA AUDITORIA — `userId: null`, autoria em `metadata`');
// ═══════════════════════════════════════════════════════════════════════════
{
  check('grava changelog com `userId: null`', /userId: null,/.test(SERVICO));
  check(
    '⛔ e NUNCA com o id do contato (ChangeLog.userId e FK de User, grava por `connect`)',
    !/userId:\s*responsibleId/.test(SERVICO) && !/userId:\s*principal\./.test(SERVICO),
  );
  check(
    'o contato fica em `metadata.responsibleId`, como no caminho do pedido de compra',
    /metadata:\s*\{\s*origem:\s*'portal',\s*responsibleId:\s*args\.responsibleId\s*\}/.test(SERVICO),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA REGRA DA ASSINATURA e um modulo PURO (testavel sem banco)');
// ═══════════════════════════════════════════════════════════════════════════
{
  check(
    'nao importa Nest nem Prisma',
    !/@nestjs\/common/.test(REGRA) && !/@prisma\/client/.test(REGRA) && !/PrismaService/.test(REGRA),
  );
  check(
    'usa `snapshotVehicles`, a unica porta de entrada dos veiculos de um snapshot',
    /import \{ snapshotVehicles \}/.test(REGRA),
  );
  check('cobre os QUATRO campos que o documento imprime', VEHICLE_IDENTITY_FIELDS.length === 4);
}

// ===========================================================================
// ⛔ OS DOIS CAMINHOS QUE ESCREVEM `Task.customerOrderNumber`
// ===========================================================================
//
// O BURACO QUE ESTE BLOCO FECHA, e que ficou ABERTO E NOMEADO por um dia:
//
//   `PATCH /cliente/me/veiculos/:taskId/identificacao` tranca os quatro campos
//   que o documento assinado imprime — e o numero do pedido e um deles.
//   `POST /cliente/me/pedidos` escreve O MESMO `Task.customerOrderNumber`, pelo
//   `PurchaseOrderService`, e nao tinha guarda nenhuma. Um contato com
//   `WRITE_PURCHASE_ORDER` recebia 409 numa porta e 201 na outra, PARA A MESMA
//   ESCRITA. A porta trancada nao protege nada enquanto a dos fundos esta
//   aberta.
//
// E a correcao nao podia ser uma SEGUNDA copia da regra: duas guardas divergem
// no primeiro conserto, e a que ficar para tras e a que um cliente encontra.
// Por isso ha UMA funcao (`assertIdentidadeNaoContradizDocumento`) e este bloco
// exercita OS DOIS CAMINHOS, de verdade, com a MESMA entrada e um `prisma` de
// mentira — nao por igualdade de texto-fonte, que passaria com as duas
// respondendo coisas diferentes.
//
// ⚠️ E o caminho do FUNCIONARIO fica de fora da guarda, de proposito: ele tem a
// tela do envelope na frente e reemite num clique. Isso tambem esta fixado
// abaixo, porque "fechar o buraco" quebrando a correcao interna seria trocar um
// defeito por outro.
async function caminhosDeEscrita() {
  console.log('\n⛔ OS DOIS CAMINHOS QUE ESCREVEM `Task.customerOrderNumber`');

  const QUOTE = 'quote-1';
  const TASK = 'task-A';
  const IBIPORA = 'cust-ibipora';
  const CONTATO = 'resp-compras';

  /** O envelope VIVO cujo documento congelado IMPRIME o pedido `8842`. */
  const envelopeImprimindo8842 = {
    id: 'env-1',
    status: 'RUNNING',
    quoteSnapshot: {
      vehicles: [
        {
          taskId: TASK,
          serialNumber: '1003',
          plate: null,
          chassisNumber: null,
          orderNumber: '8842',
        },
      ],
    },
    quote: { budgetNumber: 973, commercialUser: { name: 'Ana do Comercial' } },
  };

  /** O mesmo veiculo num documento que deixou a LACUNA do pedido em branco. */
  const envelopeComLacuna = {
    ...envelopeImprimindo8842,
    quoteSnapshot: {
      vehicles: [
        { taskId: TASK, serialNumber: '1003', plate: null, chassisNumber: null, orderNumber: null },
      ],
    },
  };

  /**
   * O `prisma` de mentira. So `signatureEnvelope.findFirst` importa para a
   * guarda; `task.findMany` e `$transaction` existem para levar
   * `createFromPortal` ate a beira da escrita.
   *
   * ⚠️ `$transaction` LANCA UM SENTINELA. Chegar nele e o que prova que a
   * guarda DEIXOU PASSAR — um `return` mudo ali nao distinguiria "passou" de
   * "nem tentou".
   */
  const SENTINELA = 'CHEGOU-NA-ESCRITA';
  const prismaDeMentira = (envelope: any, cadastro: string | null) =>
    ({
      signatureEnvelope: {
        findFirst: async (args: any) =>
          envelope && envelope.status === args?.where?.status ? envelope : null,
      },
      task: {
        findMany: async () => [
          {
            id: TASK,
            name: 'Bau 1003',
            serialNumber: '1003',
            customerId: IBIPORA,
            customerOrderNumber: cadastro,
            purchaseOrderId: null,
            quoteId: QUOTE,
            truck: { plate: null },
            billingEntry: null,
          },
        ],
      },
      $transaction: async () => {
        throw new Error(SENTINELA);
      },
    }) as any;

  /** O que aconteceu: `null` = passou, `SENTINELA` = passou e foi escrever. */
  const oQueAconteceu = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
      await fn();
      return null;
    } catch (e: any) {
      return e?.message ?? String(e);
    }
  };

  // ── O CAMINHO DA IDENTIFICACAO ─────────────────────────────────────────
  //
  // Os dois passos que o servico da a este campo: reduzir ao que DE FATO muda
  // (`apenasOQueMuda`) e consultar o documento. Sao metodos privados, e e por
  // isso que sao chamados assim — o que se quer provar e o comportamento DELE,
  // nao o de uma reimplementacao do teste.
  const pelaIdentificacao = async (envelope: any, cadastro: string | null, novo: string) => {
    const servico: any = new (PortalIdentityService as any)(
      prismaDeMentira(envelope, cadastro),
      null,
      null,
      null,
      null,
      null,
    );
    const desejado = servico.apenasOQueMuda(
      { serialNumber: '1003', customerOrderNumber: cadastro, truck: null },
      {},
      novo,
    );
    return oQueAconteceu(() => servico.assertNaoContradizDocumento(QUOTE, TASK, desejado));
  };

  // ── O CAMINHO DO PEDIDO DE COMPRA ──────────────────────────────────────
  //
  // Pela porta PUBLICA do portal (`createFromPortal`), com o escopo de verdade.
  const peloPedido = async (envelope: any, cadastro: string | null, novo: string) => {
    const servico: any = new (PurchaseOrderService as any)(
      prismaDeMentira(envelope, cadastro),
      new PortalScopeService(),
      null,
    );
    return oQueAconteceu(() =>
      servico.createFromPortal({ id: CONTATO, companyId: IBIPORA } as any, {
        number: novo,
        taskIds: [TASK],
      }),
    );
  };

  // ── 1. SOBRESCREVER O QUE O DOCUMENTO IMPRIME ──────────────────────────
  const identidadeTroca = await pelaIdentificacao(envelopeImprimindo8842, '8842', '9013');
  const pedidoTroca = await peloPedido(envelopeImprimindo8842, '8842', '9013');

  check(
    'trocar o numero impresso e RECUSADO pelo caminho da identificacao',
    !!identidadeTroca && /8842/.test(identidadeTroca) && /9013/.test(identidadeTroca),
    String(identidadeTroca),
  );
  check(
    '⛔ e tambem pelo caminho do PEDIDO DE COMPRA (era por aqui que se passava)',
    !!pedidoTroca && pedidoTroca !== SENTINELA,
    String(pedidoTroca),
  );
  check(
    '⛔ E A FRASE E A MESMA, byte a byte — uma regra so, nao duas que se parecem',
    identidadeTroca === pedidoTroca,
    `${identidadeTroca}\n!==\n${pedidoTroca}`,
  );
  check(
    'a frase diz a quem recorrer, pelos dois caminhos',
    !!pedidoTroca && pedidoTroca.includes('Ana do Comercial'),
  );

  // ── 2. PREENCHER A LACUNA (cadastro tardio) — passa nos DOIS ────────────
  const identidadeLacuna = await pelaIdentificacao(envelopeComLacuna, null, '9013');
  const pedidoLacuna = await peloPedido(envelopeComLacuna, null, '9013');
  check('preencher a lacuna PASSA pelo caminho da identificacao', identidadeLacuna === null);
  check(
    'e PASSA pelo caminho do pedido (chegou na escrita)',
    pedidoLacuna === SENTINELA,
    String(pedidoLacuna),
  );

  // ── 3. RELINK COM O MESMO NUMERO — no-op, passa nos DOIS ────────────────
  //
  // "Esses tres tambem sao do 8842" e o caso NORMAL de um pedido em lotes. Um
  // 409 aqui seria sobre nada.
  const identidadeIgual = await pelaIdentificacao(envelopeImprimindo8842, '8842', '8842');
  const pedidoIgual = await peloPedido(envelopeImprimindo8842, '8842', '8842');
  check('reenviar o MESMO numero nao e sobrescrita (identificacao)', identidadeIgual === null);
  check('idem no pedido de compra', pedidoIgual === SENTINELA, String(pedidoIgual));

  // ⚠️ Espaco a esquerda numa linha antiga (escrita por `PUT /tasks/:id`) nao
  // pode virar 409: `mudancaDePedido` apara, e `comparavel` apara de novo.
  check(
    'espaco nas pontas do cadastro antigo nao inventa mudanca',
    Object.keys(mudancaDePedido(' 8842 ', '8842')).length === 0,
  );
  check(
    'e um numero DIFERENTE continua sendo mudanca',
    mudancaDePedido('8842', '9013').orderNumber === '9013',
  );

  // ── 4. O CAMINHO DO FUNCIONARIO SEGUE LIVRE ────────────────────────────
  //
  // Esta e a metade da regra que e facil quebrar "consertando" a outra. Quem
  // esta do lado de dentro sempre pode corrigir o numero: ele ve a tela do
  // envelope e reemite num clique. Invalidar e, para ele, a resposta CERTA.
  const servicoInterno: any = new (PurchaseOrderService as any)(
    prismaDeMentira(envelopeImprimindo8842, '8842'),
    new PortalScopeService(),
    null,
  );
  const interno = await oQueAconteceu(() =>
    servicoInterno.createInternal({ number: '9013', taskIds: [TASK] }, 'user-1'),
  );
  check(
    '⚠️ o funcionario continua podendo corrigir o numero (a guarda e do PORTAL)',
    interno === SENTINELA,
    String(interno),
  );

  // ── A FORMA DA FONTE, para o dia em que alguem mexer ───────────────────
  check(
    'o pedido de compra chama a MESMA funcao, nao uma copia da regra',
    /assertIdentidadeNaoContradizDocumento\(/.test(PEDIDO) &&
      !/ConflictException\(\s*vehicleIdentityConflictMessage/.test(PEDIDO),
  );
  check(
    'a guarda roda ANTES da transacao (lote nao grava metade e aborta)',
    PEDIDO.indexOf('assertIdentidadeNaoContradizDocumento(') >= 0 &&
      PEDIDO.indexOf('assertIdentidadeNaoContradizDocumento(') <
        PEDIDO.indexOf('this.prisma.$transaction('),
  );
  check(
    'o portal liga a guarda e o caminho interno a desliga, explicitamente',
    /guardFrozenDocument: true,/.test(PEDIDO) && /guardFrozenDocument: false,/.test(PEDIDO),
  );
  check(
    '⚠️ `quoteId` esta no `select` (sem ele a guarda nao acha envelope e passa TUDO)',
    /quoteId: true,/.test(PEDIDO),
  );
}

void caminhosDeEscrita().then(() => {
  console.log(
    failures === 0
      ? '\n\u2713 TODAS as verificacoes passaram\n'
      : `\n\u2717 ${failures} verificacao(oes) falharam\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
});
