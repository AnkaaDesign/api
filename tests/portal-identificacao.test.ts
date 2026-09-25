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
 *   6. O P2002 DO PRISMA VAZANDO. `Implement.serialNumber` e `Implement.plate` sao
 *      `@unique` GLOBAIS; "Unique constraint failed on the fields:
 *      (`serialNumber`)" e' um 500 na tela que nao diz qual valor esta
 *      repetido.
 *
 *   7. A MENSAGEM UNICA DE CHASSI. "17 caracteres" nao ajuda em nada quem
 *      digitou um O no lugar do 0 num chassi que ja tem 17.
 *
 * E, desde o P13a (frente, porta traseira, projeto do implemento e a trava de
 * producao — DD5, pergunta 15):
 *
 *   8. O "200 QUE NAO GRAVA". Chave nova do corpo (`medidas.frente`,
 *      `portaTraseira`) que nao entra na conta `mexeNoImplemento` e' aceita e
 *      pulada em silencio — ja custou isso com categoria e implemento.
 *
 *   9. A MEDIDA, A PORTA E A SERIE MUDANDO COM O VEICULO NA LINHA. Com a
 *      tarefa em `IN_PRODUCTION`/`COMPLETED` a oficina ja trabalha pelo que
 *      esta gravado: o portal recusa com 409 nomeado — e so o que DE FATO muda.
 *
 * A maior parte e' PURA: funcoes (a regra da assinatura, a trava, o schema da
 * borda, a tabela de capacidades, o predicado do escopo) e a FORMA da fonte
 * onde a regra so existe dentro de um servico — o mesmo metodo de
 * `test:responsible-otp` e `test:portal-escopo`.
 *
 * ⚠️ O ULTIMO BLOCO USA O BANCO (`contraOBanco`): "grava" so se prova gravando.
 * Ele roda o servico DE VERDADE (escritor de medida, trilha, Prisma) contra o
 * banco da Fase B, DENTRO DE UMA TRANSACAO QUE E' DESFEITA no fim — nada fica,
 * e nada sai (o servico nao dispara aviso; o armazenamento de arquivo e' um
 * duble). Mesmo assim, rode SEMPRE com o env blindado do pacote:
 *
 *   source .git/implemento-env-p13a.sh && npm run test:portal-identificacao
 */

import { readFileSync } from 'fs';
import { Logger } from '@nestjs/common';
import { orderNumberRequirement } from '../src/modules/common/signature/order-number-gate';
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
  emProducao,
  frozenIdentityInSnapshot,
  frozenIdentityOf,
  mesmaMedida,
  overwritesAmong,
  STATUS_QUE_TRAVAM_O_IMPLEMENTO,
  TRAVA_DE_PRODUCAO_MENSAGEM,
  travaDeProducao,
  vehicleIdentityConflictMessage,
  VEHICLE_IDENTITY_FIELDS,
} from '../src/modules/people/portal/portal-vehicle-identity';
import {
  assertIdentidadeNaoContradizDocumento,
  mudancaDePedido,
} from '../src/modules/people/portal/portal-frozen-document';
import {
  ehArquivoDeProjeto,
  PortalIdentityService,
  PROJETO_AUSENTE_MENSAGEM,
} from '../src/modules/people/portal/portal-identity.service';
import { PurchaseOrderService } from '../src/modules/production/purchase-order/purchase-order.service';
import {
  CAMPOS_DE_IDENTIFICACAO,
  NADA_PARA_MUDAR_MENSAGEM,
  portalIdentificacaoCorpoSchema,
  portalIdentificacaoSchema,
  temAlgoParaMudar,
} from '../src/schemas/portal-vehicle-identity';
import {
  LADO_DA_FACE,
  LADOS_DO_PORTAL,
  PAYLOAD_INVALIDO_MENSAGEM,
  medidaParaPrisma,
  portaParaPrisma,
} from '../src/schemas/portal-request';
import { IMPLEMENT_FACES } from '../src/constants/implement-faces';
import {
  CHASSIS_FORBIDDEN_LETTERS_MESSAGE,
  CHASSIS_INVALID_MESSAGE,
  PLATE_INVALID_MESSAGE,
} from '../src/utils/implement';

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
    category: null,
    type: null,
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
    { serialNumber: '1003', plate: null, chassisNumber: null, orderNumber: null, category: null, type: null },
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
  // ASSINATURA (`order-number-gate.ts`, DD12), que e' onde ela sempre pertenceu: a
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
    '⛔ e mesmo assim quem TEM COMPRAS so assina com o numero (DD12, order-number-gate)',
    orderNumberRequirement({ roles: ['PURCHASING'], tasks: [{ id: 't' }] })?.required === true &&
      orderNumberRequirement({ roles: ['COMMERCIAL'], tasks: [{ id: 't' }] }) === null,
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
      VEHICLE_IDENTITY_FIELDS.length === 6 &&
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
    'o campo de arquivo e `implementVinPlate`, no maximo 1',
    /name:\s*'implementVinPlate',\s*maxCount:\s*MAXIMO_PLAQUETAS/.test(CONTROLLER) &&
      /MAXIMO_PLAQUETAS\s*=\s*1/.test(CONTROLLER),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA PLAQUETA e ARQUIVO, e vai para a pasta `Plaquetas`');
// ═══════════════════════════════════════════════════════════════════════════
{
  check(
    'sobe pelo mesmo caminho da tarefa (`createFromUploadWithTransaction`, contexto implementVinPlate)',
    /createFromUploadWithTransaction\(/.test(SERVICO) && /'implementVinPlate',/.test(SERVICO),
  );
  check(
    'o contexto `implementVinPlate` mapeia para a pasta `Plaquetas`',
    /implementVinPlate:\s*'Plaquetas'/.test(
      fonte('src/modules/common/file/services/files-storage.service.ts'),
    ),
  );
  check(
    '⚠️ o upload vai SEM userId (File.createdById e FK de User)',
    /'implementVinPlate',\s*\n\s*undefined,/.test(SERVICO),
  );
  check('e grava em `Implement.vinPlateId`', /vinPlateId:\s*arquivo\.id/.test(SERVICO));
  check(
    'so aceita imagem (a plaqueta e uma FOTO; a coluna de texto morreu em 20260727150000)',
    /startsWith\('image\/'\)/.test(SERVICO),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n⛔ O IMPLEMENTO SEMPRE EXISTE (DD1) — e `plate` NUNCA vai no topo');
// ═══════════════════════════════════════════════════════════════════════════
{
  check(
    'NAO cria implemento aqui: toda tarefa ja nasce com um (o gatilho diferido da M1s recusa a que nascer sem)',
    !/tx\.implement\.create\(/.test(SERVICO),
  );
  check(
    'tarefa sem implemento e 500 nomeado, nunca um update otimista (P2025)',
    /if \(!implementId\) \{/.test(SERVICO) &&
      /Tarefa sem implemento/.test(SERVICO) &&
      /tx\.implement\.update\(/.test(SERVICO),
  );
  check(
    'a SERIE e gravada no implemento (W5), nunca em `task` (espelho somente leitura)',
    /tx\.implement\.update\(\{\s*where:\s*\{\s*taskId:\s*task\.id\s*\},\s*data:\s*\{\s*serialNumber/.test(SERVICO) &&
      !/tx\.task\.update\(\{[\s\S]{0,200}serialNumber/.test(SERVICO),
  );
  check(
    '⛔ escreve placa e chassi em `tx.implement`, NUNCA no topo de `task`',
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
    'a serie e conferida no IMPLEMENTO antes de escrever (DD1)',
    /prisma\.implement\.findFirst\(\{[\s\S]{0,400}serialNumber: serie/.test(SERVICO),
  );
  check(
    'a placa e conferida no implemento antes de escrever',
    /prisma\.implement\.findFirst\(\{[\s\S]{0,200}plate: placa/.test(SERVICO),
  );
  check(
    '⚠️ o PROPRIO veiculo e excluido da busca (reenviar o mesmo valor nao e colisao)',
    (SERVICO.match(/NOT:\s*\{\s*taskId\s*\}/g) ?? []).length >= 2,
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
  check(
    'cobre os SEIS campos que o documento imprime (série, placa, chassi, pedido, categoria, implemento)',
    VEHICLE_IDENTITY_FIELDS.length === 6,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA FRENTE E A PORTA TRASEIRA NA BORDA (P13a)');
// ═══════════════════════════════════════════════════════════════════════════
{
  const LADO_CM = { height: 245, sections: [{ width: 248 }] };

  check(
    'as QUATRO faces tem chave de borda, a frente inclusive (a lista unica do portal)',
    LADOS_DO_PORTAL.length === IMPLEMENT_FACES.length &&
      IMPLEMENT_FACES.every(face => LADOS_DO_PORTAL.some(l => l.face === face)) &&
      LADO_DA_FACE.front === 'frente',
    JSON.stringify(LADOS_DO_PORTAL),
  );

  const soFrente = parse({ medidas: { frente: LADO_CM } });
  check(
    '`medidas.frente` e aceita',
    soFrente.success && !!(soFrente as any).data.medidas?.frente,
    JSON.stringify(soFrente.success ? null : soFrente.error.issues),
  );
  check(
    'e o PATCH so com a frente TEM o que mudar',
    soFrente.success && temAlgoParaMudar((soFrente as any).data),
  );

  const ladoErrado = parse({ medidas: { frontal: LADO_CM } });
  check(
    '⛔ lado com o nome errado (`frontal`) e RECUSADO e nomeado — sem isso era `medidas: {}` e um 200 que nao grava',
    !ladoErrado.success && /frontal/.test(JSON.stringify(ladoErrado.error.issues)),
    JSON.stringify(ladoErrado.success ? (ladoErrado as any).data : ladoErrado.error.issues),
  );
  check('`medidas: {}` NAO tem o que mudar (400, nao um 200 vazio)', !temAlgoParaMudar({ medidas: {} } as any));
  check('`medidas: null` TEM (apagar as faces e um ato)', temAlgoParaMudar({ medidas: null } as any));

  // ── A PORTA TRASEIRA ────────────────────────────────────────────────────
  const porta = parse({ portaTraseira: { abertura: 'tripartida', varoes: '4', portinholas: 6 } });
  check(
    '`portaTraseira` e aceita (abertura em qualquer caixa, numero em texto do FormData)',
    porta.success &&
      (porta as any).data.portaTraseira?.abertura === 'TRIPARTIDA' &&
      (porta as any).data.portaTraseira?.varoes === 4 &&
      (porta as any).data.portaTraseira?.portinholas === 6,
    JSON.stringify(porta.success ? (porta as any).data : porta.error.issues),
  );
  check(
    '`portaTraseira` SEM medida nenhuma tem o que mudar',
    porta.success && temAlgoParaMudar((porta as any).data),
  );
  check('`portaTraseira: {}` NAO tem o que mudar', !temAlgoParaMudar({ portaTraseira: {} } as any));

  for (const [rotulo, corpo] of [
    ['varoes 5', { varoes: 5 }],
    ['varoes 1', { varoes: 1 }],
    ['varoes 2,5', { varoes: 2.5 }],
    ['portinholas 7', { portinholas: 7 }],
    ['portinholas -1', { portinholas: -1 }],
    ['abertura QUADRIPARTIDA', { abertura: 'QUADRIPARTIDA' }],
    ['abertura no enum do banco (BIPARTITE): a borda fala portugues', { abertura: 'BIPARTITE' }],
    ['chave desconhecida (`folhas`)', { folhas: 'BIPARTIDA' }],
  ] as Array<[string, Record<string, unknown>]>) {
    const r = parse({ portaTraseira: corpo });
    check(`porta fora da faixa — ${rotulo} → 400`, !r.success, JSON.stringify(r.success ? (r as any).data : null));
  }
  const varoesRuins = parse({ portaTraseira: { varoes: 5 } });
  check(
    'e a frase e a da faixa (a mesma da tarefa e do PUT /implements)',
    !varoesRuins.success && /2, 3 ou 4/.test(JSON.stringify(varoesRuins.error.issues)),
  );

  check(
    'BIPARTIDA vira `BIPARTITE` e TRIPARTIDA vira `TRIPARTITE` (o enum do banco)',
    portaParaPrisma({ abertura: 'BIPARTIDA' }).rearDoorLeaves === 'BIPARTITE' &&
      portaParaPrisma({ abertura: 'TRIPARTIDA' }).rearDoorLeaves === 'TRIPARTITE',
  );
  check(
    'so os varoes: a abertura e as portinholas ficam AUSENTES (nao apagadas)',
    JSON.stringify(portaParaPrisma({ varoes: 3 })) === JSON.stringify({ rearDoorBarCount: 3 }),
    JSON.stringify(portaParaPrisma({ varoes: 3 })),
  );
  check(
    '`portaTraseira: null` apaga as tres colunas; ausente nao mexe em nada',
    JSON.stringify(portaParaPrisma(null)) ===
      JSON.stringify({ rearDoorLeaves: null, rearDoorBarCount: null, rearDoorHatchCount: null }) &&
      Object.keys(portaParaPrisma(undefined)).length === 0,
  );

  // ── `type`, o nome da coluna (DD13) ─────────────────────────────────────
  const tipo = parse({ type: 'REFRIGERATED' });
  check('`type` e aceito (o nome da coluna)', tipo.success && (tipo as any).data.type === 'REFRIGERATED');
  const tipoVelho = parse({ implementType: 'REFRIGERATED' });
  check(
    '⛔ `implementType` (o nome antigo) e RECUSADO e nomeado — DD13, sem valor antigo',
    !tipoVelho.success && /implementType/.test(JSON.stringify(tipoVelho.error.issues)),
  );

  // ── toda chave do corpo conta ───────────────────────────────────────────
  const chavesDoCorpo = Object.keys(portalIdentificacaoCorpoSchema.shape).sort();
  check(
    '⛔ TODA chave do corpo esta em CAMPOS_DE_IDENTIFICACAO (chave esquecida = 200 que nao grava)',
    JSON.stringify(chavesDoCorpo) === JSON.stringify([...CAMPOS_DE_IDENTIFICACAO].sort()),
    `corpo=${chavesDoCorpo.join(',')} campos=${[...CAMPOS_DE_IDENTIFICACAO].sort().join(',')}`,
  );
  // A expressao inteira, ate o `;` que a fecha (a fonte ja vem sem comentarios).
  const inicioDaConta = SERVICO.indexOf('const mexeNoImplemento');
  const conta = SERVICO.slice(inicioDaConta, SERVICO.indexOf(';', inicioDaConta));
  check(
    '⛔ `mexeNoImplemento` conta a MEDIDA e a PORTA (o bloco do implemento nao e pulado)',
    /medidas !== undefined/.test(conta) && /portaTraseira !== undefined/.test(conta),
    conta.slice(0, 400),
  );
  check(
    'as faces da identificacao vem da lista unica (`LADOS_DO_PORTAL`), nao de uma lista de tres',
    /LADOS_DO_PORTAL\.map\(/.test(SERVICO) && !/chave: 'traseira'/.test(SERVICO),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA FRENTE E A PORTA NAO DAO O 409 DO DOCUMENTO CONGELADO');
// ═══════════════════════════════════════════════════════════════════════════
{
  check(
    'a lista da guarda NAO tem medida, frente nem porta (a folha nao as imprime)',
    !(VEHICLE_IDENTITY_FIELDS as readonly string[]).some(c =>
      /medid|frente|front|porta|rearDoor/i.test(c),
    ),
    VEHICLE_IDENTITY_FIELDS.join(','),
  );
  check(
    'o tipo entra pelo nome da COLUNA (`type`), nao `implementType`',
    (VEHICLE_IDENTITY_FIELDS as readonly string[]).includes('type') &&
      !(VEHICLE_IDENTITY_FIELDS as readonly string[]).includes('implementType'),
  );
  // O snapshot SELADO continua com `implementType` (hash). A traducao e' de
  // `frozenIdentityOf`, e so dela.
  const congelado = frozenIdentityOf(
    [{ taskId: 't', serialNumber: '1', plate: null, chassisNumber: null, category: 'TRUCK', implementType: 'DRY_CARGO' } as any],
    't',
  );
  check('o `implementType` selado e lido como `type`', congelado?.type === 'DRY_CARGO', JSON.stringify(congelado));
  check(
    'e trocar o tipo impresso continua sendo 409',
    overwritesAmong(classifyVehicleIdentityWrite(congelado, { type: 'REFRIGERATED' })).length === 1,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n⛔ A TRAVA DE PRODUCAO — medida, porta e serie (DD5, pergunta 15)');
// ═══════════════════════════════════════════════════════════════════════════
{
  check(
    'travam IN_PRODUCTION e COMPLETED',
    JSON.stringify([...STATUS_QUE_TRAVAM_O_IMPLEMENTO]) === JSON.stringify(['IN_PRODUCTION', 'COMPLETED']),
  );
  check(
    'PREPARATION, WAITING_PRODUCTION e CANCELLED NAO travam (cancelado nao esta sendo produzido)',
    !emProducao('PREPARATION') && !emProducao('WAITING_PRODUCTION') && !emProducao('CANCELLED') && !emProducao(null),
  );

  const tudo = travaDeProducao('IN_PRODUCTION', [
    { campo: 'medida', face: 'front', chave: 'frente' },
    { campo: 'portaTraseira' },
    { campo: 'serialNumber' },
  ]);
  check(
    'em producao, mudar medida, porta e serie e recusado com a frase do dono',
    !!tudo && tudo.message.startsWith(TRAVA_DE_PRODUCAO_MENSAGEM),
    tudo?.message,
  );
  check(
    'a frase NOMEIA o que foi recusado (a face em portugues, a porta, a serie)',
    !!tudo && /Frente/.test(tudo.message) && /porta traseira/.test(tudo.message) && /número de série/.test(tudo.message),
    tudo?.message,
  );
  check(
    'e devolve os caminhos do corpo, para a tela marcar o campo',
    JSON.stringify(tudo?.fields) === JSON.stringify(['medidas.frente', 'portaTraseira', 'serialNumber']),
    JSON.stringify(tudo?.fields),
  );
  check('concluido tambem trava', !!travaDeProducao('COMPLETED', [{ campo: 'serialNumber' }]));
  check(
    'antes da producao nao trava',
    travaDeProducao('WAITING_PRODUCTION', [{ campo: 'medida', face: 'left', chave: 'esquerda' }]) === null,
  );
  check('em producao SEM mudanca travavel nao trava (placa, chassi: regras de hoje)', travaDeProducao('IN_PRODUCTION', []) === null);

  // ── so o que DE FATO muda ───────────────────────────────────────────────
  const gravada = {
    height: 2.45,
    sections: [
      { width: 6.2, isDoor: false, doorHeight: 1.9, position: 0 },
      { width: 1.8, isDoor: true, doorHeight: 2.1, position: 1 },
    ],
  };
  const reenviada = medidaParaPrisma({
    height: 245,
    sections: [{ width: 620, isDoor: false }, { width: 180, isDoor: true, doorHeight: 210 }],
  } as any);
  check(
    'reenviar o MESMO desenho (em cm) nao e mudanca — nem com o `doorHeight` que o editor interno deixa na secao sem porta',
    mesmaMedida(gravada, reenviada),
    JSON.stringify(reenviada),
  );
  check(
    'ruido de ponto flutuante do banco nao inventa mudanca',
    mesmaMedida({ ...gravada, height: 2.4499999999999997 }, reenviada),
  );
  check(
    'um centimetro a mais E mudanca',
    !mesmaMedida(gravada, medidaParaPrisma({ height: 246, sections: [{ width: 620, isDoor: false }, { width: 180, isDoor: true, doorHeight: 210 }] } as any)),
  );
  check(
    'uma secao a mais E mudanca',
    !mesmaMedida(gravada, { ...reenviada, sections: [...reenviada.sections, { width: 1, isDoor: false, doorHeight: null, position: 2 }] }),
  );
  check('face vazia × face pedida E mudanca', !mesmaMedida(null, reenviada) && mesmaMedida(null, null));

  check(
    'o servico julga a trava ANTES da guarda do documento e de toda escrita',
    SERVICO.indexOf('travaDeProducao(task.status') > 0 &&
      SERVICO.indexOf('travaDeProducao(task.status') < SERVICO.indexOf('assertNaoContradizDocumento(task.quoteId') &&
      SERVICO.indexOf('travaDeProducao(task.status') < SERVICO.indexOf('await this.gravar('),
  );
  check('recusa com 409 (`ConflictException`)', /throw new ConflictException\(\{/.test(SERVICO));
  check('o `select` traz o estado da tarefa (sem ele a trava nunca morderia)', /status: true,/.test(SERVICO));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nO PROJETO DO IMPLEMENTO — `POST /cliente/me/veiculos/:taskId/projeto`');
// ═══════════════════════════════════════════════════════════════════════════
{
  check(
    'a rota e POST veiculos/:taskId/projeto, com WRITE_VEHICLE_IDENTITY',
    /@Post\('veiculos\/:taskId\/projeto'\)\s*\n\s*@HttpCode\(HttpStatus\.CREATED\)\s*\n\s*@PortalCapability\(PORTAL_CAPABILITY\.WRITE_VEHICLE_IDENTITY\)/.test(CONTROLLER),
  );
  check(
    'o campo multipart e `implementProject`',
    /name:\s*'implementProject',\s*maxCount:\s*MAXIMO_PROJETOS/.test(CONTROLLER),
  );
  check('PDF e imagem sao projeto', ehArquivoDeProjeto('application/pdf') && ehArquivoDeProjeto('image/jpeg'));
  check(
    'planilha, zip e EPS NAO sao',
    !ehArquivoDeProjeto('application/zip') &&
      !ehArquivoDeProjeto('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') &&
      !ehArquivoDeProjeto('application/postscript') &&
      !ehArquivoDeProjeto(undefined),
  );
  const enviar = SERVICO.slice(SERVICO.indexOf('async enviarProjeto('), SERVICO.indexOf('private apenasOQueMuda('));
  check(
    'escopo COMERCIAL e 404 fora dele (nunca 403), com a conferencia dupla',
    /this\.scope\.commercialTaskScopeWhere\(principal\)/.test(enviar) &&
      /commercialTaskLink\(task,\s*companyId\)\s*===\s*null/.test(enviar) &&
      /NotFoundException\('Veículo não encontrado\.'\)/.test(enviar) &&
      !/ForbiddenException/.test(enviar),
  );
  check(
    'sobe com o contexto `implementProjectFiles`, SEM userId, na mesma transacao do vinculo',
    /createFromUploadWithTransaction\(\s*tx,\s*arquivo,\s*'implementProjectFiles',\s*undefined,/.test(enviar),
  );
  check(
    'ACRESCENTA ao projeto (`connect`), nunca troca a lista (`set` apagaria o que o comercial anexou)',
    /projectFiles:\s*\{\s*connect:/.test(enviar) && !/projectFiles:\s*\{\s*set:/.test(enviar),
  );
  check(
    'deixa trilha `IMPLEMENT/projectFiles`, com a autoria do contato em metadata',
    /field:\s*'projectFiles'/.test(enviar) && /this\.auditar\(tx,/.test(enviar),
  );
  check('sem arquivo, a frase diz o nome do campo', /implementProject/.test(PROJETO_AUSENTE_MENSAGEM));
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
            implement: { plate: null },
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
      { serialNumber: '1003', customerOrderNumber: cadastro, implement: null },
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

/** Status e corpo de uma chamada de servico: 200 quando nao lancou. */
async function resultado(fn: () => Promise<unknown>): Promise<{ status: number; body: any }> {
  try {
    const body = await fn();
    return { status: 200, body };
  } catch (e: any) {
    const status = typeof e?.getStatus === 'function' ? e.getStatus() : 500;
    const body = typeof e?.getResponse === 'function' ? e.getResponse() : { message: e?.message ?? String(e) };
    return { status, body };
  }
}

const textoDa = (body: any): string =>
  typeof body === 'string' ? body : JSON.stringify(body?.message ?? body);

// ===========================================================================
// A FRENTE E A PORTA PASSAM PELA GUARDA DO DOCUMENTO — pelo servico de verdade
// ===========================================================================
//
// Um envelope VIVO imprimindo serie, placa, categoria e tipo. Mudar a frente e
// a porta tem de CHEGAR NA ESCRITA (o sentinela do `$transaction`); mudar o tipo
// impresso tem de parar no 409 — que e' a prova de que a guarda esta armada
// neste cenario, e nao apenas ausente.
async function frenteEPortaNaoContradizemODocumento() {
  console.log('\nA frente e a porta chegam na escrita com a coleta VIVA (o 409 e so do que a folha imprime)');

  const SENTINELA = 'CHEGOU-NA-ESCRITA';
  const EMPRESA = 'cust-dono';
  const principal: any = { id: 'resp-1', companyId: EMPRESA, roles: ['COMMERCIAL'] };
  const tarefa = (status: string) => ({
    id: 'task-A',
    name: 'Bau 1003',
    status,
    quoteId: 'quote-1',
    customerId: EMPRESA,
    customerOrderNumber: null,
    purchaseOrderId: null,
    forecastDate: null,
    customer: { id: EMPRESA, fantasyName: 'Dono', corporateName: null },
    implement: {
      id: 'impl-A',
      serialNumber: '1003',
      plate: 'ABC1D23',
      chassisNumber: null,
      category: 'TRUCK',
      type: 'DRY_CARGO',
      leftSideMeasureId: null,
      rightSideMeasureId: null,
      backSideMeasureId: null,
      frontSideMeasureId: null,
      leftSideMeasure: null,
      rightSideMeasure: null,
      backSideMeasure: null,
      frontSideMeasure: null,
      rearDoorLeaves: null,
      rearDoorBarCount: null,
      rearDoorHatchCount: null,
      vinPlateId: null,
    },
    billingEntry: null,
  });
  const envelope = {
    id: 'env-1',
    status: 'RUNNING',
    quoteSnapshot: {
      vehicles: [
        {
          taskId: 'task-A',
          serialNumber: '1003',
          plate: 'ABC1D23',
          chassisNumber: null,
          category: 'TRUCK',
          implementType: 'DRY_CARGO',
          orderNumber: null,
        },
      ],
    },
    quote: { budgetNumber: 973, commercialUser: { name: 'Ana do Comercial' } },
  };
  const servicoCom = (status: string) =>
    new (PortalIdentityService as any)(
      {
        task: { findFirst: async () => tarefa(status) },
        signatureEnvelope: {
          findFirst: async (args: any) => (args?.where?.status === envelope.status ? envelope : null),
        },
        implement: { findFirst: async () => null },
        $transaction: async () => {
          throw new Error(SENTINELA);
        },
      },
      new PortalScopeService(),
      null,
      null,
      null,
      null,
    );

  const frenteEPorta = portalIdentificacaoSchema.parse({
    medidas: { frente: { height: 250, sections: [{ width: 245 }] } },
    portaTraseira: { abertura: 'BIPARTIDA', varoes: 3, portinholas: 2 },
  });
  const r1 = await resultado(() => servicoCom('PREPARATION').atualizarIdentificacao(principal, 'task-A', frenteEPorta));
  check(
    'frente + porta com a coleta VIVA: nenhum 409, a escrita e alcancada',
    r1.status === 500 && textoDa(r1.body).includes(SENTINELA),
    `${r1.status} ${textoDa(r1.body)}`,
  );

  const tipo = portalIdentificacaoSchema.parse({ type: 'REFRIGERATED' });
  const r2 = await resultado(() => servicoCom('PREPARATION').atualizarIdentificacao(principal, 'task-A', tipo));
  check(
    'e o TIPO impresso, no mesmo cenario, para no 409 da coleta (a guarda esta armada)',
    r2.status === 409 && /tipo de implemento/.test(textoDa(r2.body)),
    `${r2.status} ${textoDa(r2.body)}`,
  );

  const r3 = await resultado(() => servicoCom('IN_PRODUCTION').atualizarIdentificacao(principal, 'task-A', frenteEPorta));
  check(
    'com a tarefa EM PRODUCAO a mesma frente + porta para na TRAVA (409), antes de escrever',
    r3.status === 409 &&
      textoDa(r3.body).includes(TRAVA_DE_PRODUCAO_MENSAGEM) &&
      JSON.stringify(r3.body?.fields) === JSON.stringify(['medidas.frente', 'portaTraseira']),
    `${r3.status} ${JSON.stringify(r3.body)}`,
  );
}

// ===========================================================================
// ⛔ CONTRA O BANCO — "grava" so se prova gravando
// ===========================================================================
//
// O servico DE VERDADE (o escritor unico de medida, a trilha, o Prisma), contra
// o banco da Fase B, DENTRO DE UMA TRANSACAO DESFEITA NO FIM: o `prisma` que o
// servico recebe e' a propria transacao, e o `$transaction` dele reusa a mesma.
// Nada fica no banco e nada sai da maquina (o servico nao dispara aviso; o
// armazenamento de arquivo e' um duble que so cria a linha de `File`).
//
// A requisicao cria o veiculo pelo MESMO `criarVeiculo` da rota — e' a prova,
// no banco, de "4 faces e porta; o implemento nasce com serie e `spot: null`".
async function contraOBanco() {
  console.log('\n⛔ CONTRA O BANCO — a requisicao e a identificacao gravando de verdade (transacao desfeita no fim)');

  const { PrismaService } = await import('../src/modules/common/prisma/prisma.service');
  const { ChangeLogService } = await import('../src/modules/common/changelog/changelog.service');
  const { ChangeLogPrismaRepository } = await import(
    '../src/modules/common/changelog/repositories/changelog-prisma.repository'
  );
  const { PortalRequestService } = await import('../src/modules/people/portal/portal-request.service');
  const { portalVeiculoSchema } = await import('../src/schemas/portal-request');

  const prisma: any = new PrismaService();
  const DESFAZER = 'DESFAZER-A-TRANSACAO-DO-TESTE';
  // Os servicos logam cada escrita; aqui so interessa o que falhar.
  Logger.overrideLogger(['error']);

  try {
    const [{ banco }] = await prisma.$queryRawUnsafe('select current_database() as banco');
    const colunas = await prisma.$queryRawUnsafe(
      `select column_name from information_schema.columns
        where table_name = 'Implement' and column_name in ('frontSideMeasureId', 'rearDoorLeaves')`,
    );
    console.log(`  (banco: ${banco})`);
    if ((colunas as unknown[]).length !== 2) {
      check(
        'o banco tem a M2 (frente e porta traseira)',
        false,
        `o banco ${banco} nao tem — rode com o env do pacote (source .git/implemento-env-p13a.sh)`,
      );
      return;
    }

    await prisma.$transaction(
      async (tx: any) => {
        const noTx: any = new Proxy(tx, {
          get: (alvo, chave) => (chave === '$transaction' ? (fn: any) => fn(tx) : alvo[chave]),
        });
        const trilha = new ChangeLogService(new ChangeLogPrismaRepository(noTx), noTx);
        const contextos: string[] = [];
        const armazenamento = {
          createFromUploadWithTransaction: async (t: any, arquivo: any, contexto: string, userId: unknown) => {
            contextos.push(`${contexto}|${userId === undefined ? 'sem-usuario' : 'COM-USUARIO'}`);
            return t.file.create({
              data: {
                filename: arquivo.originalname,
                originalName: arquivo.originalname,
                mimetype: arquivo.mimetype,
                path: `/dev/null/p13a/${arquivo.originalname}`,
                size: arquivo.size ?? 1,
              },
            });
          },
        };
        const leitura = { getVehicle: async () => ({ success: true, message: 'ok', data: {} }) };
        const identidade: any = new (PortalIdentityService as any)(
          noTx,
          new PortalScopeService(),
          trilha,
          armazenamento,
          null,
          leitura,
        );
        const requisicao: any = new (PortalRequestService as any)(noTx, trilha, null, null, null, null);

        const [cliente, outro] = await tx.customer.findMany({
          take: 2,
          orderBy: { createdAt: 'asc' },
          select: { id: true, fantasyName: true },
        });
        const contato = await tx.responsible.findFirst({ select: { id: true } });
        if (!cliente || !outro || !contato) {
          check('o banco tem 2 clientes e 1 contato', false);
          throw new Error(DESFAZER);
        }
        const orcamento = await tx.budget.create({
          data: {
            budgetNumber: 900_000_000 + Math.floor(Math.random() * 1_000_000),
            subtotal: 0,
            total: 0,
            expiresAt: new Date(Date.now() + 86_400_000),
          },
          select: { id: true },
        });
        const principal: any = {
          sessionId: 's',
          id: contato.id,
          name: 'Contato de teste',
          email: null,
          phone: '0',
          roles: ['COMMERCIAL'],
          companyId: cliente.id,
          companyName: cliente.fantasyName,
        };
        const estranho: any = { ...principal, companyId: outro.id };
        const carimbo = Date.now().toString().slice(-6);

        const MEDIDA = {
          select: {
            height: true,
            sections: { select: { width: true, isDoor: true, doorHeight: true }, orderBy: { position: 'asc' } },
          },
        };
        const implemento = (id: string) =>
          tx.implement.findUnique({
            where: { id },
            select: {
              serialNumber: true,
              spot: true,
              type: true,
              category: true,
              plate: true,
              rearDoorLeaves: true,
              rearDoorBarCount: true,
              rearDoorHatchCount: true,
              leftSideMeasureId: true,
              frontSideMeasureId: true,
              leftSideMeasure: MEDIDA,
              rightSideMeasure: MEDIDA,
              backSideMeasure: MEDIDA,
              frontSideMeasure: MEDIDA,
              projectFiles: { select: { id: true } },
            },
          });
        const trilhaDe = (entityId: string, field: string) =>
          tx.changeLog.findMany({
            where: { entityType: 'IMPLEMENT', entityId, field },
            orderBy: { createdAt: 'asc' },
            select: { oldValue: true, newValue: true, userId: true, metadata: true },
          });

        // ── A REQUISICAO: 4 faces + porta + tipo ──────────────────────────
        const veiculoA = portalVeiculoSchema.parse({
          serialNumber: `P13A${carimbo}A`,
          category: 'TRUCK',
          type: 'DRY_CARGO',
          medidas: {
            esquerda: { height: 240, sections: [{ width: 620 }, { width: 180, isDoor: true, doorHeight: 210 }] },
            direita: { height: 240, sections: [{ width: 615 }, { width: 185 }] },
            traseira: { height: 245, sections: [{ width: 248 }] },
            frente: { height: 250, sections: [{ width: 246 }] },
          },
          portaTraseira: { abertura: 'TRIPARTIDA', varoes: 4, portinholas: 6 },
        });
        const criadoA = await requisicao.criarVeiculo(tx, {
          indice: 0,
          veiculo: veiculoA,
          budgetId: orcamento.id,
          customerId: cliente.id,
          customerName: cliente.fantasyName,
          paintId: null,
          responsibleId: contato.id,
        });
        const a = await implemento(criadoA.implementId);
        check(
          'REQUISICAO: o implemento nasce com a SERIE e `spot: null` (o veiculo ainda nao chegou)',
          a?.serialNumber === `P13A${carimbo}A` && a?.spot === null,
          JSON.stringify({ serie: a?.serialNumber, spot: a?.spot }),
        );
        check('REQUISICAO: `type` e categoria gravados', a?.type === 'DRY_CARGO' && a?.category === 'TRUCK');
        check(
          'REQUISICAO: a porta traseira nasce traduzida (TRIPARTITE, 4 varoes, 6 portinholas)',
          a?.rearDoorLeaves === 'TRIPARTITE' && a?.rearDoorBarCount === 4 && a?.rearDoorHatchCount === 6,
          JSON.stringify({ l: a?.rearDoorLeaves, b: a?.rearDoorBarCount, h: a?.rearDoorHatchCount }),
        );
        check(
          'REQUISICAO: as QUATRO faces em METROS (2,40 · 2,40 · 2,45 · 2,50)',
          a?.leftSideMeasure?.height === 2.4 &&
            a?.rightSideMeasure?.height === 2.4 &&
            a?.backSideMeasure?.height === 2.45 &&
            a?.frontSideMeasure?.height === 2.5 &&
            a?.frontSideMeasure?.sections?.[0]?.width === 2.46,
          JSON.stringify([a?.leftSideMeasure?.height, a?.rightSideMeasure?.height, a?.backSideMeasure?.height, a?.frontSideMeasure]),
        );
        check(
          'REQUISICAO: o recibo traz o id da medida das quatro faces, a frente inclusive',
          ['esquerda', 'direita', 'traseira', 'frente'].every(k => typeof criadoA.measureIds?.[k] === 'string') &&
            criadoA.measureIds.frente === a?.frontSideMeasureId,
          JSON.stringify(criadoA.measureIds),
        );

        // ── A IDENTIFICACAO, num veiculo sem frente e sem porta ────────────
        const criadoB = await requisicao.criarVeiculo(tx, {
          indice: 1,
          veiculo: portalVeiculoSchema.parse({
            serialNumber: `P13A${carimbo}B`,
            medidas: { esquerda: { height: 240, sections: [{ width: 620 }] } },
          }),
          budgetId: orcamento.id,
          customerId: cliente.id,
          customerName: cliente.fantasyName,
          paintId: null,
          responsibleId: contato.id,
        });
        const taskB = criadoB.taskId;
        const implB = criadoB.implementId;
        const antesB = await implemento(implB);
        check(
          'o veiculo B nasce sem frente e sem porta',
          antesB?.frontSideMeasureId === null && antesB?.rearDoorLeaves === null,
        );
        const patch = (corpo: unknown, quem: any = principal) =>
          resultado(() =>
            identidade.atualizarIdentificacao(quem, taskB, portalIdentificacaoSchema.parse(corpo)),
          );

        // `portaTraseira` SEM medida
        const rPorta = await patch({ portaTraseira: { abertura: 'BIPARTIDA', varoes: 3, portinholas: 2 } });
        const comPorta = await implemento(implB);
        check(
          '`portaTraseira` SEM medida GRAVA (BIPARTITE, 3, 2)',
          rPorta.status === 200 &&
            comPorta?.rearDoorLeaves === 'BIPARTITE' &&
            comPorta?.rearDoorBarCount === 3 &&
            comPorta?.rearDoorHatchCount === 2,
          `${rPorta.status} ${textoDa(rPorta.body)} ${JSON.stringify(comPorta)}`,
        );
        const trilhaPorta = await trilhaDe(implB, 'rearDoorLeaves');
        check(
          'e deixa trilha IMPLEMENT/rearDoorLeaves com `userId: null` e o contato em metadata',
          trilhaPorta.length === 1 &&
            trilhaPorta[0].userId === null &&
            (trilhaPorta[0].metadata as any)?.responsibleId === contato.id,
          JSON.stringify(trilhaPorta),
        );
        await patch({ portaTraseira: { varoes: 4 } });
        const soVaroes = await implemento(implB);
        check(
          'so os varoes: a abertura e as portinholas NAO sao apagadas',
          soVaroes?.rearDoorLeaves === 'BIPARTITE' && soVaroes?.rearDoorBarCount === 4 && soVaroes?.rearDoorHatchCount === 2,
          JSON.stringify(soVaroes),
        );

        // PATCH so com `medidas.frente`
        const FRENTE = { height: 250, sections: [{ width: 245 }] };
        const rFrente = await patch({ medidas: { frente: FRENTE } });
        const comFrente = await implemento(implB);
        check(
          '⛔ PATCH SO com `medidas.frente` GRAVA (nao e o 200 que nao grava)',
          rFrente.status === 200 &&
            !!comFrente?.frontSideMeasureId &&
            comFrente?.frontSideMeasure?.height === 2.5 &&
            comFrente?.frontSideMeasure?.sections?.[0]?.width === 2.45,
          `${rFrente.status} ${textoDa(rFrente.body)} ${JSON.stringify(comFrente?.frontSideMeasure)}`,
        );
        check(
          'e nao toca nas outras faces',
          comFrente?.leftSideMeasureId === antesB?.leftSideMeasureId && comFrente?.leftSideMeasure?.height === 2.4,
        );
        check('e deixa trilha IMPLEMENT/frontSideMeasureId', (await trilhaDe(implB, 'frontSideMeasureId')).length === 1);
        const rIgual = await patch({ medidas: { frente: FRENTE } });
        check(
          'reenviar a MESMA frente e no-op: 200, sem linha nova de trilha',
          rIgual.status === 200 && (await trilhaDe(implB, 'frontSideMeasureId')).length === 1,
        );
        const rApaga = await patch({ medidas: { frente: null } });
        const semFrente = await implemento(implB);
        const trilhaFrente = await trilhaDe(implB, 'frontSideMeasureId');
        check(
          '`medidas.frente: null` apaga a face — e agora deixa trilha (antes sumia sem linha)',
          rApaga.status === 200 &&
            semFrente?.frontSideMeasureId === null &&
            trilhaFrente.length === 2 &&
            // (dentro de UMA transacao o `createdAt` e o mesmo: nada de ordem; e a
            // trilha grava o nulo como texto vazio, a convencao do ChangeLogService)
            trilhaFrente.some(
              l => (l.newValue ?? '') === '' && typeof l.oldValue === 'string' && l.oldValue !== '',
            ),
          JSON.stringify(trilhaFrente),
        );
        await patch({ medidas: { frente: FRENTE } });

        // ── ⛔ A TRAVA DE PRODUCAO ─────────────────────────────────────────
        await tx.task.update({ where: { id: taskB }, data: { status: 'IN_PRODUCTION' } });
        const emLinha = await implemento(implB);

        const rMedida = await patch({ medidas: { esquerda: { height: 300, sections: [{ width: 500 }] } } });
        check(
          'EM PRODUCAO: mudar a medida → 409 nomeado',
          rMedida.status === 409 &&
            textoDa(rMedida.body).includes(TRAVA_DE_PRODUCAO_MENSAGEM) &&
            JSON.stringify(rMedida.body?.fields) === JSON.stringify(['medidas.esquerda']),
          `${rMedida.status} ${JSON.stringify(rMedida.body)}`,
        );
        const rFrenteEmLinha = await patch({ medidas: { frente: { height: 260, sections: [{ width: 245 }] } } });
        check(
          'EM PRODUCAO: mudar a FRENTE → 409',
          rFrenteEmLinha.status === 409 && JSON.stringify(rFrenteEmLinha.body?.fields) === JSON.stringify(['medidas.frente']),
          `${rFrenteEmLinha.status} ${JSON.stringify(rFrenteEmLinha.body)}`,
        );
        const rPortaEmLinha = await patch({ portaTraseira: { portinholas: 0 } });
        check(
          'EM PRODUCAO: mudar a porta → 409',
          rPortaEmLinha.status === 409 && JSON.stringify(rPortaEmLinha.body?.fields) === JSON.stringify(['portaTraseira']),
          `${rPortaEmLinha.status} ${JSON.stringify(rPortaEmLinha.body)}`,
        );
        const rSerie = await patch({ serialNumber: `P13A${carimbo}X` });
        check(
          'EM PRODUCAO: mudar a SERIE → 409 (pergunta 15)',
          rSerie.status === 409 && JSON.stringify(rSerie.body?.fields) === JSON.stringify(['serialNumber']),
          `${rSerie.status} ${JSON.stringify(rSerie.body)}`,
        );
        const rTudo = await patch({
          serialNumber: `P13A${carimbo}X`,
          plate: `ZZQ9Z${carimbo.slice(-2)}`,
          portaTraseira: { portinholas: 0 },
        });
        check(
          'EM PRODUCAO: o corpo com placa JUNTO de serie e porta e recusado INTEIRO (nada pela metade)',
          rTudo.status === 409 &&
            JSON.stringify(rTudo.body?.fields) === JSON.stringify(['portaTraseira', 'serialNumber']),
          `${rTudo.status} ${JSON.stringify(rTudo.body)}`,
        );
        const depoisDasRecusas = await implemento(implB);
        check(
          'e NADA foi gravado pelas recusas (medida, frente, porta, serie e placa como estavam)',
          JSON.stringify(depoisDasRecusas) === JSON.stringify(emLinha),
          `${JSON.stringify(emLinha)}\n!==\n${JSON.stringify(depoisDasRecusas)}`,
        );
        const rMesmaPorta = await patch({ portaTraseira: { varoes: 4 }, medidas: { frente: FRENTE } });
        check(
          'EM PRODUCAO: reenviar a porta e a frente que ja estao gravadas passa (so o que MUDA trava)',
          rMesmaPorta.status === 200,
          `${rMesmaPorta.status} ${textoDa(rMesmaPorta.body)}`,
        );
        const placa = `ZZQ9Z${carimbo.slice(-2)}`;
        const rPlaca = await patch({ plate: placa });
        check(
          'EM PRODUCAO: a PLACA segue as regras de hoje (grava)',
          rPlaca.status === 200 && (await implemento(implB))?.plate === placa,
          `${rPlaca.status} ${textoDa(rPlaca.body)}`,
        );
        await tx.task.update({ where: { id: taskB }, data: { status: 'COMPLETED' } });
        const rConcluido = await patch({ serialNumber: `P13A${carimbo}Y` });
        check('CONCLUIDO tambem trava a serie', rConcluido.status === 409, `${rConcluido.status}`);
        await tx.task.update({ where: { id: taskB }, data: { status: 'WAITING_PRODUCTION' } });
        const rAntes = await patch({ portaTraseira: { portinholas: 0 } });
        check(
          'AGUARDANDO PRODUCAO nao trava (a porta grava)',
          rAntes.status === 200 && (await implemento(implB))?.rearDoorHatchCount === 0,
          `${rAntes.status} ${textoDa(rAntes.body)}`,
        );

        // ── O ESCOPO ───────────────────────────────────────────────────────
        const rFora = await patch({ portaTraseira: { varoes: 2 } }, estranho);
        check('fora do escopo comercial: 404, nunca 403', rFora.status === 404, `${rFora.status} ${textoDa(rFora.body)}`);

        // ── O PROJETO DO IMPLEMENTO ────────────────────────────────────────
        const pdf = { originalname: `PROJETO FURGAO ${carimbo}.pdf`, mimetype: 'application/pdf', size: 8, buffer: Buffer.from('%PDF-1.4') };
        const foto = { originalname: `PRANCHA ${carimbo}.jpg`, mimetype: 'image/jpeg', size: 4, buffer: Buffer.from('jpeg') };
        const rProjeto = await resultado(() => identidade.enviarProjeto(principal, taskB, { implementProject: [pdf] }));
        const comProjeto = await implemento(implB);
        check(
          'o PROJETO enviado cai em `Implement.projectFiles`',
          rProjeto.status === 200 && comProjeto?.projectFiles?.length === 1,
          `${rProjeto.status} ${textoDa(rProjeto.body)} ${JSON.stringify(comProjeto?.projectFiles)}`,
        );
        check(
          'com o contexto `implementProjectFiles` e SEM usuario (id de contato nao e User)',
          JSON.stringify(contextos) === JSON.stringify(['implementProjectFiles|sem-usuario']),
          JSON.stringify(contextos),
        );
        const trilhaProjeto = await trilhaDe(implB, 'projectFiles');
        check(
          'e deixa trilha IMPLEMENT/projectFiles ([] → [o arquivo]) com `userId: null`',
          trilhaProjeto.length === 1 &&
            trilhaProjeto[0].userId === null &&
            JSON.stringify(typeof trilhaProjeto[0].newValue === 'string' ? JSON.parse(trilhaProjeto[0].newValue as string) : trilhaProjeto[0].newValue) ===
              JSON.stringify(comProjeto?.projectFiles.map((f: any) => f.id)),
          JSON.stringify(trilhaProjeto),
        );
        await tx.task.update({ where: { id: taskB }, data: { status: 'IN_PRODUCTION' } });
        const rSegundo = await resultado(() => identidade.enviarProjeto(principal, taskB, { implementProject: [foto] }));
        check(
          'um segundo envio ACRESCENTA (e o projeto nao tem trava de producao)',
          rSegundo.status === 200 && (await implemento(implB))?.projectFiles?.length === 2,
          `${rSegundo.status} ${textoDa(rSegundo.body)}`,
        );
        const zip = { originalname: 'projeto.zip', mimetype: 'application/zip', size: 3, buffer: Buffer.from('zip') };
        const rZip = await resultado(() => identidade.enviarProjeto(principal, taskB, { implementProject: [zip] }));
        check('arquivo que nao e PDF nem imagem → 400', rZip.status === 400, `${rZip.status} ${textoDa(rZip.body)}`);
        const rVazio = await resultado(() => identidade.enviarProjeto(principal, taskB, {}));
        check('sem arquivo → 400', rVazio.status === 400, `${rVazio.status} ${textoDa(rVazio.body)}`);
        const rProjetoFora = await resultado(() => identidade.enviarProjeto(estranho, taskB, { implementProject: [pdf] }));
        check(
          'projeto fora do escopo comercial → 404, nunca 403',
          rProjetoFora.status === 404 && (await implemento(implB))?.projectFiles?.length === 2,
          `${rProjetoFora.status} ${textoDa(rProjetoFora.body)}`,
        );

        throw new Error(DESFAZER);
      },
      { timeout: 180_000, maxWait: 20_000 },
    );
  } catch (e: any) {
    if (!String(e?.message ?? e).includes(DESFAZER)) {
      check('o bloco contra o banco rodou ate o fim', false, e?.stack ?? String(e));
    }
  } finally {
    await prisma.$disconnect();
  }
}

void (async () => {
  await caminhosDeEscrita();
  await frenteEPortaNaoContradizemODocumento();
  await contraOBanco();
})().then(() => {
  console.log(
    failures === 0
      ? '\n\u2713 TODAS as verificacoes passaram\n'
      : `\n\u2717 ${failures} verificacao(oes) falharam\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
});
