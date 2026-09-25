/**
 * G3 — O CENSO REGISTRA A FORMA E NUNCA O VALOR.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * O censo (src/modules/common/census) é a única fonte de "o que o app 1.4.1 e o
 * AnkaaAero REALMENTE mandam" antes de uma troca de nome. Se
 * ele errar a forma, a R-B quebra um cliente instalado sem aviso; se ele vazar
 * um valor, o log de produção passa a guardar CPF e placa. Aqui se prova:
 *
 *   A. caminhos aninhados de include/where/orderBy, `orderBy` em lista com a
 *      posição (a Agenda do app manda o 3º critério em `orderBy[2]`), consulta
 *      vinda como JSON dentro da query string;
 *   B. nenhum valor sai na linha (CPF, placa, série e nome na consulta e no
 *      corpo), nem como chave;
 *   C. corpo JSON e multipart (nomes de campo e de arquivo);
 *   D. teto de caminhos por forma e teto de formas por processo (balde);
 *   E. `X-App-Version` (`1.4.1+24`, ausente, lixo) e a família do User-Agent;
 *   F. de ponta a ponta num app Nest: padrão da rota (nunca a URL com o id),
 *      `req.appVersion` no pedido, resposta intocada, uma linha por forma nova,
 *      404 fora;
 *   G. do log à fixture do G4: cada forma real das fixtures de hoje, passada
 *      pelo censo e remontada, volta com os MESMOS caminhos.
 *
 * Rodar: `npm run test:census` (sem banco).
 */
import 'reflect-metadata';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  Body,
  Controller,
  Get,
  Logger,
  type LoggerService,
  MiddlewareConsumer,
  Module,
  NestModule,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FileInterceptor, type NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';
import * as qs from 'qs';
import { compareAppVersion, parseAppVersion } from '../src/modules/common/census/app-version';
import {
  CENSUS_LOG_PREFIX,
  CensusRegistry,
  MAX_PATHS_PER_SHAPE,
  OVERFLOW,
  TRUNCATED,
  bodyPaths,
  censusClient,
  censusRegistry,
  queryPaths,
  uaFamily,
  type CensusShape,
} from '../src/modules/common/census/census-shape';
import { CensusMiddleware } from '../src/modules/common/census/census.middleware';
import {
  buildCensusFixture,
  parseCensusLine,
  rebuildQuery,
} from '../src/modules/common/census/census-fixture';

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Valores que NUNCA podem aparecer numa linha do censo.
const CPF = '123.456.789-09';
const PLACA = 'ABC1D23';
const SERIE = 'SERIE-99871';
const NOME = 'Transportadora Sigilosa Ltda';
const SEGREDOS = [CPF, PLACA, SERIE, NOME, '12345678909'];
const leaks = (text: string) => SEGREDOS.filter(s => text.includes(s));

// ─── A. caminhos da consulta ────────────────────────────────────────────────

function parteA(): void {
  console.log('\nA. caminhos de include/where/orderBy');

  const aero = queryPaths({
    include: {
      customer: true,
      implement: { include: { leftSideMeasure: { include: { sections: true } } } },
      layouts: { include: { file: true } },
    },
    where: {
      id: { in: ['a', 'b'] },
      customer: { fantasyName: { contains: NOME, mode: 'insensitive' } },
    },
  });
  check(
    'include aninhado vira caminho com a espécie da folha',
    aero.includes('include.implement.include.leftSideMeasure.include.sections:bool') &&
      aero.includes('include.layouts.include.file:bool'),
    aero.join(' '),
  );
  check(
    'where: lista de escalares é UMA folha (`str[]`), operador de relação desce',
    aero.includes('where.id.in:str[]') &&
      aero.includes('where.customer.fantasyName.contains:str') &&
      aero.includes('where.customer.fantasyName.mode:str'),
    aero.join(' '),
  );

  // A Agenda do app (task_schedule_view.dart): orderBy em lista, pela query
  // string, como o `qs` do main.ts a monta.
  const agendaQs = qs.stringify(
    {
      orderBy: [
        { statusOrder: 'asc' },
        { term: { sort: 'asc', nulls: 'last' } },
        { serialNumber: { sort: 'asc', nulls: 'last' } },
      ],
      where: { OR: [{ status: 'PENDING' }, { status: 'IN_PRODUCTION', serialNumber: SERIE }] },
      page: 1,
      limit: 40,
    },
    { encodeValuesOnly: true },
  );
  const agenda = queryPaths(qs.parse(agendaQs, { depth: 10, arrayLimit: 100 }));
  check(
    '`orderBy` em lista guarda a POSIÇÃO de cada critério',
    agenda.includes('orderBy[0].statusOrder:str') &&
      agenda.includes('orderBy[1].term.nulls:str') &&
      agenda.includes('orderBy[2].serialNumber.sort:str'),
    agenda.join(' '),
  );
  check(
    'lista fora de `orderBy` é FUNDIDA (`[]`) — união das chaves dos elementos',
    agenda.includes('where.OR[].status:str') && agenda.includes('where.OR[].serialNumber:str'),
    agenda.join(' '),
  );
  check(
    'page e limit (da query string) entram como chave',
    agenda.includes('page:str') && agenda.includes('limit:str'),
  );

  const json = queryPaths({
    include: JSON.stringify({ customer: { select: { id: true } } }),
    page: '1',
  });
  check(
    'consulta mandada como JSON dentro da query string é lida como objeto',
    json.includes('include.customer.select.id:bool'),
    json.join(' '),
  );
  check('a saída é ordenada e sem repetição', same(json, [...new Set(json)].sort()));
}

// ─── B. nenhum valor vaza ───────────────────────────────────────────────────

function parteB(): void {
  console.log('\nB. nenhum valor sai na linha');
  const consulta = queryPaths({
    where: {
      customer: { cpf: CPF, fantasyName: NOME },
      implement: { plate: PLACA },
      serialNumber: { in: [SERIE] },
    },
    searchingFor: PLACA,
  });
  const corpo = bodyPaths({
    implement: { plate: PLACA },
    serialNumber: SERIE,
    responsible: { cpf: CPF, name: NOME },
  });
  // chave com cara de valor (um cliente que põe o CPF na chave). Chave em
  // formato de identificador passa como chave: não há como distinguir `ABC1D23`
  // de um nome de campo, e nenhum cliente nosso põe valor em chave.
  const chaves = bodyPaths({ [CPF]: true, '12345678909': 1, '42': 'x', ok: { [NOME]: 1 } });
  const texto = JSON.stringify({ consulta, corpo, chaves });
  check(
    'CPF, placa, série e nome não aparecem',
    leaks(texto).length === 0,
    leaks(texto).join(', '),
  );
  check(
    'chave fora do formato vira `(?)`, só de dígitos vira `#`',
    chaves.includes('(?):bool') &&
      chaves.includes('(?):num') &&
      chaves.includes('#:str') &&
      chaves.includes('ok.(?):num'),
    chaves.join(' '),
  );
  check(
    'mas a FORMA está lá: é o que o P11a precisa',
    consulta.includes('where.implement.plate:str') &&
      corpo.includes('implement.plate:str') &&
      corpo.includes('serialNumber:str'),
  );
}

// ─── C. corpo JSON e multipart ──────────────────────────────────────────────

function parteC(): void {
  console.log('\nC. corpo JSON e multipart');
  const json = bodyPaths({
    tasks: [
      { name: 'a', implement: { plate: 'x' } },
      { name: 'b', serialNumber: '1' },
    ],
    ok: false,
    n: 2,
    nada: null,
    vazio: [],
    obj: {},
  });
  check(
    'corpo JSON: lista de objetos fundida, folhas com espécie, vazio distinguido',
    same(json, [
      'n:num',
      'nada:null',
      'obj:{}',
      'ok:bool',
      'tasks[].implement.plate:str',
      'tasks[].name:str',
      'tasks[].serialNumber:str',
      'vazio:[]',
    ]),
    json.join(' '),
  );
  const jsonSemParse = bodyPaths({ observacao: '{"cpf":"x"}' });
  check(
    'corpo JSON: string com cara de JSON NÃO é aberta (é texto do usuário)',
    same(jsonSemParse, ['observacao:str']),
  );

  // multipart como o multer monta: campos de texto (o web manda objeto como JSON)
  const multipart = bodyPaths(
    {
      implement: JSON.stringify({ plate: PLACA, leftSideMeasure: { sections: [{ width: 1 }] } }),
      name: NOME,
    },
    { multipart: true, fileFields: ['layouts[0][file]', 'budgetFiles', 'layouts[1][file]'] },
  );
  check(
    'multipart: campo JSON aberto, arquivos pelo NOME do campo (índice do multer fundido)',
    same(multipart, [
      'budgetFiles:file',
      'implement.leftSideMeasure.sections[].width:num',
      'implement.plate:str',
      'layouts[].file:file',
      'name:str',
    ]),
    multipart.join(' '),
  );
  check('multipart: nenhum valor', leaks(JSON.stringify(multipart)).length === 0);
}

// ─── D. tetos ───────────────────────────────────────────────────────────────

function parteD(): void {
  console.log('\nD. tetos');
  const huge = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, true]));
  const paths = queryPaths({ include: huge });
  check(
    `mais de ${MAX_PATHS_PER_SHAPE} caminhos: corta e marca \`${TRUNCATED}\``,
    paths.length === MAX_PATHS_PER_SHAPE + 1 && paths[paths.length - 1] === TRUNCATED,
    `${paths.length}`,
  );
  let deep: Record<string, unknown> = { fim: true };
  for (let i = 0; i < 30; i++) deep = { include: { r: deep } };
  const fundo = queryPaths(deep);
  check(
    'profundidade sem fim é cortada',
    fundo.length === 1 && fundo[0].includes(TRUNCATED),
    fundo.join(' '),
  );

  const reg = new CensusRegistry(3);
  const shape = (i: number): CensusShape => ({
    rota: `GET /r${i}`,
    v: null,
    patch: null,
    plataforma: null,
    cliente: null,
    ua: 'Dart',
    consulta: [],
    corpo: [],
  });
  const primeiras = [0, 1, 2].map(i => reg.record(shape(i)));
  const repetida = reg.record(shape(1));
  const balde = reg.record(shape(3));
  const baldeDeNovo = reg.record(shape(4));
  const velhaDepoisDoTeto = reg.record(shape(0));
  check(
    'forma nova devolve a linha; repetida devolve null',
    primeiras.every(Boolean) && repetida === null,
  );
  check(
    `passado o teto, a forma nova vira UMA linha \`${OVERFLOW}\` e depois silêncio`,
    balde?.rota === OVERFLOW && baldeDeNovo === null && velhaDepoisDoTeto === null,
    JSON.stringify(balde),
  );
  check(
    'o balde conta, e o mapa não passa do teto + 1',
    reg.counters()[OVERFLOW] === 2 &&
      reg.size === 4 &&
      reg.counters()[JSON.stringify(shape(0))] === 2,
    JSON.stringify(reg.counters()),
  );
}

// ─── E. versão do app e família do cliente ──────────────────────────────────

function parteE(): void {
  console.log('\nE. X-App-Version e User-Agent');
  const v = parseAppVersion('1.4.1+24');
  check(
    '`1.4.1+24` → 1.4.1 build 24',
    v?.raw === '1.4.1+24' && v.major === 1 && v.minor === 4 && v.patch === 1 && v.build === 24,
  );
  check(
    'sem build: `1.4.1`',
    parseAppVersion(' 1.4.1 ')?.build === null && parseAppVersion('1.4.1')?.raw === '1.4.1',
  );
  check('`v1.5.0` tolera o v', parseAppVersion('v1.5.0')?.raw === '1.5.0');
  check(
    'lista de cabeçalho: vale o primeiro',
    parseAppVersion(['1.4.2+30', '9.9.9'])?.raw === '1.4.2+30',
  );
  const lixo = [
    '',
    'lixo',
    '1.4',
    '1.4.1+abc',
    '1.4.1; DROP TABLE',
    'x'.repeat(40),
    '1.4.1+24 extra',
  ];
  check('ausente → null', parseAppVersion(undefined) === null && parseAppVersion(null) === null);
  check(
    'lixo → null (nunca exceção)',
    lixo.every(l => parseAppVersion(l) === null),
    lixo.filter(l => parseAppVersion(l)).join(' | '),
  );
  const a = parseAppVersion('1.4.1+24')!;
  check(
    'ordem de versão (o build desempata)',
    compareAppVersion(a, parseAppVersion('1.5.0')!) < 0 &&
      compareAppVersion(a, parseAppVersion('1.4.1+25')!) < 0 &&
      compareAppVersion(a, parseAppVersion('1.4.1')!) === 0 &&
      compareAppVersion(parseAppVersion('1.10.0')!, parseAppVersion('1.9.9')!) > 0,
  );

  const uas: [string | undefined, string][] = [
    ['Dart/3.5 (dart:io)', 'Dart'],
    ['AnkaaAero/1 CFNetwork/978.0.7 Darwin/18.7.0', 'AnkaaAero/1'],
    [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Chrome',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
      'Safari (móvel)',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0',
      'Edge',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox'],
    ['Expo/1017756 CFNetwork/1410.0.3 Darwin/22.6.0', 'Expo'],
    [undefined, '(sem)'],
    ['', '(sem)'],
    ['SomethingElse/1', 'outro'],
  ];
  const erradas = uas.filter(([ua, fam]) => uaFamily(ua) !== fam);
  check(
    'família do User-Agent (nunca a string inteira)',
    erradas.length === 0,
    erradas.map(([u, f]) => `${u} → ${uaFamily(u)} (esperado ${f})`).join('; '),
  );

  const c = censusClient(
    {
      'x-app-version': 'lixo com espaço',
      'x-app-patch': '3',
      'x-app-platform': 'android',
      'x-client': `web@${CPF} <script>`,
      'user-agent': 'Dart/3.5 (dart:io)',
    },
    null,
  );
  check(
    'cabeçalho fora do formato vira `(inválido)` (versão presente mas ilegível ≠ ausente)',
    c.v === '(inválido)' &&
      c.cliente === '(inválido)' &&
      c.patch === '3' &&
      c.plataforma === 'android' &&
      c.ua === 'Dart',
    JSON.stringify(c),
  );
  check(
    'X-Client do web passa como veio',
    censusClient({ 'x-client': 'web@a1b2c3d' }, null).cliente === 'web@a1b2c3d',
  );
}

// ─── F. de ponta a ponta num app Nest ───────────────────────────────────────

@Controller('censo-teste')
class CensoTesteController {
  @Get(':id')
  one(@Param('id') id: string, @Req() req: Request) {
    return { id, appVersion: req.appVersion ?? null };
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return { ok: true, chaves: Object.keys(body ?? {}).length };
  }

  @Post('arquivo')
  @UseInterceptors(FileInterceptor('arquivo'))
  upload(
    @UploadedFile() file: { originalname?: string } | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return { nome: file?.originalname ?? null, campos: Object.keys(body ?? {}).sort() };
  }
}

@Module({ controllers: [CensoTesteController] })
class CensoTesteModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CensusMiddleware).forRoutes('*');
  }
}

async function parteF(): Promise<void> {
  console.log('\nF. de ponta a ponta (Nest + Express + multer)');
  const lines: string[] = [];
  const capture: LoggerService = {
    log: (m: unknown) => {
      const s = String(m);
      if (s.startsWith(CENSUS_LOG_PREFIX)) lines.push(s);
    },
    error: () => {},
    warn: () => {},
  };
  censusRegistry.reset();
  const app = await NestFactory.create<NestExpressApplication>(CensoTesteModule, {
    logger: capture,
  });
  app.set('query parser', (str: string) => qs.parse(str, { depth: 10, arrayLimit: 100 }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const settle = () => new Promise(r => setTimeout(r, 50));
  try {
    const q = qs.stringify({
      include: { implement: { include: { leftSideMeasure: true } } },
      where: { plate: PLACA },
    });
    const headers = {
      'x-app-version': '1.4.1+24',
      'x-app-patch': '2',
      'user-agent': 'Dart/3.5 (dart:io)',
    };
    const r1 = await fetch(`${base}/censo-teste/7c0f3a90-aaaa-4bbb-8ccc-000000000123?${q}`, {
      headers,
    });
    const b1 = (await r1.json()) as { id: string; appVersion: { raw: string } | null };
    await fetch(`${base}/censo-teste/outro-id?${q}`, { headers }); // mesma forma, outro id
    await settle();
    check(
      'resposta intocada (status e corpo do controlador)',
      r1.status === 200 && b1.id === '7c0f3a90-aaaa-4bbb-8ccc-000000000123',
    );
    check(
      '`req.appVersion` chega ao controlador já lido',
      b1.appVersion?.raw === '1.4.1+24',
      JSON.stringify(b1.appVersion),
    );
    check('a mesma forma com outro id = UMA linha só', lines.length === 1, lines.join('\n'));
    const s1 = parseCensusLine(lines[0] ?? '');
    check(
      'a linha tem o PADRÃO da rota, a versão, o patch e a família do cliente',
      s1?.rota === 'GET /censo-teste/:id' &&
        s1.v === '1.4.1+24' &&
        s1.patch === '2' &&
        s1.ua === 'Dart',
      lines[0],
    );
    check(
      'a linha não tem a URL crua, o id nem a placa',
      !lines[0]?.includes('7c0f3a90') && leaks(lines[0] ?? '').length === 0,
    );
    check(
      'e tem os caminhos da consulta',
      !!s1 &&
        s1.consulta.includes('include.implement.include.leftSideMeasure:str') &&
        s1.consulta.includes('where.plate:str'),
      JSON.stringify(s1?.consulta),
    );

    const r2 = await fetch(`${base}/censo-teste`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client': 'web@abc123',
        'user-agent': 'Mozilla/5.0 Chrome/128.0 Safari/537.36',
      },
      body: JSON.stringify({ implement: { plate: PLACA }, serialNumber: SERIE }),
    });
    await settle();
    const s2 = parseCensusLine(lines[1] ?? '');
    check(
      'POST JSON: 201 e corpo do controlador',
      r2.status === 201 && ((await r2.json()) as { chaves: number }).chaves === 2,
    );
    check(
      'POST JSON: caminhos do corpo, X-Client, sem versão de app',
      s2?.rota === 'POST /censo-teste' &&
        s2.cliente === 'web@abc123' &&
        s2.v === null &&
        s2.ua === 'Chrome' &&
        same(s2.corpo, ['implement.plate:str', 'serialNumber:str']),
      lines[1],
    );

    const form = new FormData();
    form.append('implement', JSON.stringify({ plate: PLACA }));
    form.append('name', NOME);
    form.append('arquivo', new Blob([Buffer.from('conteudo')], { type: 'text/plain' }), 'x.txt');
    const r3 = await fetch(`${base}/censo-teste/arquivo`, {
      method: 'POST',
      body: form,
      headers: { 'x-app-version': 'lixo!' },
    });
    await settle();
    const b3 = (await r3.json()) as { nome: string; campos: string[] };
    const s3 = parseCensusLine(lines[2] ?? '');
    check(
      'multipart: o multer segue lendo arquivo e campos',
      r3.status === 201 && b3.nome === 'x.txt' && same(b3.campos, ['implement', 'name']),
    );
    check(
      'multipart: nomes de campo (JSON aberto) e o campo do arquivo, versão ilegível marcada',
      s3?.rota === 'POST /censo-teste/arquivo' &&
        s3.v === '(inválido)' &&
        same(s3.corpo, ['arquivo:file', 'implement.plate:str', 'name:str']),
      lines[2],
    );
    check(
      'nenhuma linha vaza valor',
      leaks(lines.join('\n')).length === 0,
      leaks(lines.join('\n')).join(', '),
    );

    const antes = lines.length;
    const r404 = await fetch(`${base}/nao-existe/${PLACA}?where[cpf]=${CPF}`);
    const rOpt = await fetch(`${base}/censo-teste/x`, { method: 'OPTIONS' });
    await settle();
    check(
      '404 e OPTIONS ficam fora do censo',
      r404.status === 404 && rOpt.status < 500 && lines.length === antes,
      lines.slice(antes).join('\n'),
    );
  } finally {
    await app.close();
    censusRegistry.reset();
  }
}

// ─── G. do log à fixture do G4 ──────────────────────────────────────────────

const stripKind = (paths: string[]) =>
  [...new Set(paths.map(p => p.slice(0, p.lastIndexOf(':'))))].sort();
const TOP = /^(include|select|where|orderBy|page|limit|take|skip)([.[:]|$)/;

function parteG(): void {
  console.log('\nG. do log à fixture do G4 (remontagem pelos caminhos)');
  const dir = join(__dirname, '../contracts/queries');
  let total = 0;
  const divergentes: string[] = [];
  const shapes: CensusShape[] = [];
  const routes = new Map<string, { modelo: string; schema: string }>();
  for (const arquivo of readdirSync(dir).filter(
    f => f.endsWith('.json') && f !== 'negativas.json' && f !== 'censo.json',
  )) {
    const json = JSON.parse(readFileSync(join(dir, arquivo), 'utf8')) as {
      formas: {
        id: string;
        rota: string;
        modelo: string;
        schema: string;
        consulta: Record<string, unknown>;
      }[];
    };
    for (const f of json.formas) {
      total++;
      const paths = queryPaths(f.consulta);
      const { consulta } = rebuildQuery(f.modelo, paths);
      const antes = stripKind(paths.filter(p => TOP.test(p)));
      const depois = stripKind(queryPaths(consulta));
      if (!same(antes, depois)) {
        const falta = antes.filter(p => !depois.includes(p));
        const sobra = depois.filter(p => !antes.includes(p));
        divergentes.push(
          `${arquivo}#${f.id}: falta [${falta.join(', ')}] sobra [${sobra.join(', ')}]`,
        );
      }
      if (!routes.has(f.rota)) routes.set(f.rota, { modelo: f.modelo, schema: f.schema });
      shapes.push({
        rota: f.rota,
        v: '1.4.1+24',
        patch: null,
        plataforma: null,
        cliente: null,
        ua: 'Dart',
        consulta: paths,
        corpo: [],
      });
    }
  }
  check(
    `as ${total} formas reais de hoje, remontadas, voltam com os mesmos caminhos`,
    total > 0 && divergentes.length === 0,
    divergentes.slice(0, 5).join('\n      '),
  );

  // where remontado com valor do TIPO do campo (DMMF), não "x" em tudo
  const { consulta: w } = rebuildQuery('Task', [
    'where.status.in:str[]',
    'where.customerId:str',
    'where.createdAt.gte:str',
    'where.customer.fantasyName.contains:str',
    'where.customer.fantasyName.mode:str',
    'where.chaveInventada:str',
    'where.serviceOrders.some.status:str',
    'searchingFor:str',
  ]);
  const where = w.where as Record<string, any>;
  check(
    'where: enum ganha valor do enum, id ganha UUID, data ganha ISO, relação desce, chave desconhecida pela espécie',
    Array.isArray(where.status.in) &&
      typeof where.status.in[0] === 'string' &&
      where.status.in[0] !== 'x' &&
      /^[0-9a-f-]{36}$/.test(where.customerId) &&
      !Number.isNaN(Date.parse(where.createdAt.gte)) &&
      where.customer.fantasyName.mode === 'insensitive' &&
      where.chaveInventada === 'x' &&
      typeof where.serviceOrders.some.status === 'string',
    JSON.stringify(w),
  );
  const rebuilt = rebuildQuery('Task', ['searchingFor:str', 'where.id:str']);
  check(
    'chave de topo que não é cláusula sai em `outrasChaves`, fora da consulta',
    same(rebuilt.outrasChaves, ['searchingFor']) && !('searchingFor' in rebuilt.consulta),
  );

  // a linha como o Nest a escreve (com cor) volta inteira
  const linha = `\x1b[32m[Nest] 1234  - \x1b[39m23/09/2026 10:00:00 \x1b[32m    LOG\x1b[39m \x1b[33m[Censo] \x1b[39m\x1b[32m${CENSUS_LOG_PREFIX} ${JSON.stringify(shapes[0])}\x1b[39m`;
  check('linha do log com cor ANSI do Nest é lida', same(parseCensusLine(linha), shapes[0]));
  check(
    'linha sem o prefixo ou quebrada é ignorada',
    parseCensusLine('[Nest] qualquer') === null &&
      parseCensusLine(`${CENSUS_LOG_PREFIX} {quebrado`) === null,
  );

  const extra: CensusShape[] = [
    { ...shapes[0], ua: 'AnkaaAero/1', v: null }, // mesma forma, outro cliente
    {
      rota: 'GET /rota-sem-fixture',
      v: null,
      patch: null,
      plataforma: null,
      cliente: 'web@x',
      ua: 'Chrome',
      consulta: ['include.x:str'],
      corpo: [],
    },
    {
      rota: 'PUT /tasks/:id',
      v: '1.4.1+24',
      patch: null,
      plataforma: null,
      cliente: null,
      ua: 'Dart',
      consulta: [],
      corpo: ['implement.plate:str'],
    },
    {
      rota: OVERFLOW,
      v: null,
      patch: null,
      plataforma: null,
      cliente: null,
      ua: OVERFLOW,
      consulta: [],
      corpo: [],
    },
  ];
  const fx = buildCensusFixture([...shapes, ...extra], routes, new Date('2026-09-23T12:00:00Z'));
  const primeira = fx.formas.find(f => f.origem.includes('AnkaaAero/1'));
  check(
    'fixture: mesma forma de dois clientes é UMA forma com os dois na origem',
    !!primeira &&
      primeira.origem.includes('Dart 1.4.1+24') &&
      fx.formas.every(f => f.id.startsWith('censo.') && !!f.schema),
    primeira?.origem,
  );
  check(
    'fixture: rota sem schema no G4 fica em `semSchema`, corpo em `corpos`, o balde acusa',
    fx.semSchema.length === 1 &&
      fx.semSchema[0].rota === 'GET /rota-sem-fixture' &&
      fx.corpos.length === 1 &&
      same(fx.corpos[0].corpo, ['implement.plate:str']) &&
      fx.transbordou,
  );
  check('fixture: ids únicos', new Set(fx.formas.map(f => f.id)).size === fx.formas.length);
}

async function main(): Promise<void> {
  Logger.overrideLogger(false);
  parteA();
  parteB();
  parteC();
  parteD();
  parteE();
  await parteF();
  parteG();
  console.log(failures ? `\n✗ ${failures} verificação(ões) falharam\n` : '\n✓ censo: tudo verde\n');
  process.exit(failures ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
