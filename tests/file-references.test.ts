/**
 * G10 — REFERÊNCIAS DE ARQUIVO CONFERIDAS.
 *
 * `FileReferenceService` é a resposta única a "alguém usa este arquivo?". Ele
 * lê as FKs para `File.id` do catálogo VIVO do banco e as colunas de saída de
 * `OUTBOUND_REFERENCES`; o organizador usa `INBOUND_REFERENCES` para saber a
 * pasta canônica. O rework cria FKs novas para File (arte do implemento, projeto
 * do implemento, plaqueta) e tira outras (`quoteLayoutId`): esquecer uma deixa
 * o organizador parado ou a exclusão travada. Até aqui a checagem era só um
 * `warn` no boot (file-reference.service.ts, `onModuleInit`) — agora é teste:
 *
 *   1. toda FK do catálogo para `File.id` tem linha em `INBOUND_REFERENCES`
 *      (as 9 que já faltavam em 23/09 ficam numa lista que só encolhe);
 *   2. toda linha de `INBOUND_REFERENCES` ainda é FK no catálogo (sem linha morta);
 *   3. toda `OUTBOUND_REFERENCES[].column` existe em `File` (DMMF);
 *   4. todo contexto citado nas duas tabelas existe em `folderMapping`;
 *   5. todo `fileContext` que os clientes mandam (contracts/file-contexts.json)
 *      existe em `folderMapping`.
 *
 * Rodar: npm run test:file-references   (lê o catálogo do banco de DATABASE_URL)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { PrismaClient } from '@prisma/client';
import {
  FileReferenceService,
  INBOUND_REFERENCES,
  OUTBOUND_REFERENCES,
} from '../src/modules/common/file/services/file-reference.service';
import { FilesStorageService } from '../src/modules/common/file/services/files-storage.service';
import { getField } from '../src/modules/common/query/dmmf-query-validator';
import { fileReferencedWhere } from '../src/schemas/file';

/** `fileContext` literal no código de web e app (repositórios irmãos, se existirem). */
function contextosDosClientes(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const padrao = /fileContext["']?\s*[:=]\s*["'`]([A-Za-z][\w-]*)["'`]/g;
  const raizes: Array<[string, RegExp]> = [
    [join(__dirname, '../../web/src'), /\.(ts|tsx)$/],
    [join(__dirname, '../../mobile-flutter/lib'), /\.dart$/],
  ];
  const varrer = (dir: string, ext: RegExp) => {
    for (const nome of readdirSync(dir)) {
      if (nome === 'node_modules' || nome === 'generated') continue;
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) varrer(p, ext);
      else if (ext.test(nome)) {
        for (const m of readFileSync(p, 'utf8').matchAll(padrao)) {
          const lista = out.get(m[1]) ?? [];
          lista.push(relative(join(__dirname, '../..'), p));
          out.set(m[1], lista);
        }
      }
    }
  };
  for (const [raiz, ext] of raizes) if (existsSync(raiz)) varrer(raiz, ext);
  return out;
}

let ok = 0;
let fail = 0;
function check(nome: string, cond: boolean, detalhe = ''): void {
  if (cond) {
    ok++;
    console.log(`[  ok  ] ${nome}`);
  } else {
    fail++;
    console.log(`[ FAIL ] ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

/**
 * FKs para File.id que já existiam sem linha em INBOUND_REFERENCES em 23/09
 * (o `warn` do boot as listava). Continuam PROTEGIDAS contra exclusão (FK
 * desconhecida ⇒ referenciada); só não têm pasta canônica, então o organizador
 * não as arquiva. Pôr contexto nelas muda onde o organizador guarda arquivo:
 * fica para o dono de cada área — `BudgetLayoutTask.fileId` (layout por
 * veículo, DD6) sai no P12. SÓ ENCOLHE.
 */
const FKS_SEM_LINHA_CONHECIDAS = new Set([
  'PaintingAnalysisFace.fileId',
  'PaintingAnalysisFace.overlayFileId',
  'AirbrushingNfse.pdfFileId',
  'AirbrushingNfse.xmlFileId',
  'EnvelopeDocument.originalFileId',
  'EnvelopeDocument.finalFileId',
  'SignatureEnvelope.addendumFileId',
  '_ADMISSION_DOCUMENT_FILES.A',
  'BudgetLayoutTask.fileId',
]);

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const storage = new FilesStorageService(prisma as any);
    const known = new Set(storage.getKnownFileContexts());
    const refs = new FileReferenceService(prisma as any, storage);

    const catalogo = (await refs.getInboundReferenceColumns()).map(c => `${c.table}.${c.column}`);
    check('o catálogo de FKs para File.id foi lido', catalogo.length > 20, `${catalogo.length}`);

    const semLinha = catalogo.filter(k => !(k in INBOUND_REFERENCES));
    const novas = semLinha.filter(k => !FKS_SEM_LINHA_CONHECIDAS.has(k));
    check(
      'toda FK NOVA para File.id tem linha em INBOUND_REFERENCES',
      novas.length === 0,
      novas.join(', '),
    );
    const resolvidas = [...FKS_SEM_LINHA_CONHECIDAS].filter(k => !semLinha.includes(k));
    check(
      'FKS_SEM_LINHA_CONHECIDAS não lista FK já mapeada ou extinta (a lista só encolhe)',
      resolvidas.length === 0,
      resolvidas.join(', '),
    );

    const mortas = Object.keys(INBOUND_REFERENCES).filter(k => !catalogo.includes(k));
    check(
      'nenhuma linha de INBOUND_REFERENCES aponta FK que não existe mais',
      mortas.length === 0,
      mortas.join(', '),
    );

    const colunasFora = OUTBOUND_REFERENCES.filter(r => {
      const f = getField('File', r.column);
      return !f || f.kind !== 'scalar';
    }).map(r => r.column);
    check(
      'toda OUTBOUND_REFERENCES[].column é coluna de File',
      colunasFora.length === 0,
      colunasFora.join(', '),
    );

    const contextos = [
      ...Object.entries(INBOUND_REFERENCES).map(([k, v]) => [k, v.context] as const),
      ...OUTBOUND_REFERENCES.map(r => [`File.${r.column}`, r.context] as const),
    ].filter(([, c]) => c !== null);
    const semPasta = contextos.filter(([, c]) => !known.has(c as string));
    check(
      'todo contexto das referências existe em folderMapping',
      semPasta.length === 0,
      semPasta.map(([k, c]) => `${k} → ${c}`).join(', '),
    );

    const clientes = JSON.parse(
      readFileSync(join(__dirname, '../contracts/file-contexts.json'), 'utf8'),
    ) as { contextos: Record<string, string[]> };
    const desconhecidos = Object.keys(clientes.contextos).filter(c => !known.has(c));
    check(
      'todo fileContext que web e app mandam existe em folderMapping',
      desconhecidos.length === 0,
      desconhecidos.join(', '),
    );

    // A lista acima é SEMENTE escrita à mão (R-B-12). Aqui ela é conferida
    // contra o código dos clientes: todo `fileContext` literal que o web e o
    // app mandam tem de estar nela (e, por ela, em folderMapping). Contexto
    // novo num cliente sem entrar aqui reprova.
    const vistos = contextosDosClientes();
    const foraDaSemente = [...vistos.entries()].filter(([c]) => !(c in clientes.contextos));
    check(
      `todo fileContext literal de web/app está em contracts/file-contexts.json (${vistos.size} vistos)`,
      vistos.size > 0 && foraDaSemente.length === 0,
      foraDaSemente.map(([c, onde]) => `${c} ← ${onde.slice(0, 3).join(', ')}`).join('; '),
    );

    // F10: o filtro de "órfão" sai do DMMF — toda relação de uso de File.
    const semRef = fileReferencedWhere(false) as { AND: Array<Record<string, unknown>> };
    const cobertas = new Set(semRef.AND.map(c => Object.keys(c)[0]));
    const devemEstar = [
      'implementMeasurePhotos',
      'implementVinPlates',
      'quoteLayoutTasks',
      'quoteLayout',
      'airbrushingNfsePdfs',
      'envelopeDocumentOriginals',
      'signatureEnvelopeFinals',
      'taskBankSlips',
    ];
    const faltam = devemEstar.filter(r => !cobertas.has(r));
    check(
      'o filtro de órfão cobre toda relação de uso de File (foto de medida, plaqueta, arte por veículo…)',
      faltam.length === 0 && !cobertas.has('thumbnailJob'),
      faltam.join(', '),
    );
    const orfaos = await prisma.file.count({ where: semRef as any });
    const referenciados = await prisma.file.count({ where: fileReferencedWhere(true) as any });
    const total = await prisma.file.count();
    check(
      'órfãos + referenciados = todos os arquivos (o Prisma aceita as duas formas)',
      orfaos + referenciados === total,
      `${orfaos} + ${referenciados} ≠ ${total}`,
    );
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\n${ok} ok, ${fail} falha(s)`);
  if (fail > 0) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
