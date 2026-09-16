/**
 * Guarda do rename de pasta de cliente/fornecedor/colaborador.
 *
 * A pasta TEM de ir junto com a entidade renomeada, e o banco tem de acabar
 * apontando para onde os bytes realmente ficaram. Quando isso não acontece o
 * sintoma é traiçoeiro: a MINIATURA continua aparecendo (foi gerada no upload e
 * vive em `Thumbnails/`, fora da árvore do cliente), só o arquivo original some.
 * A tela parece meio certa e ninguém percebe até um cliente abrir o dossiê.
 *
 * Em 16/09/2026 o cliente "Mascarenhas" foi renomeado para "Comercial Dias" e
 * levou junto os 22 arquivos de OUTRO cliente, "Mascarenhas & Chaves LTDA":
 * `startsWith` sem a barra final casa qualquer pasta que COMECE com o nome
 * antigo. Os caminhos no banco viraram "Comercial Dias & Chaves LTDA/…", pasta
 * que nunca existiu. As fotos de check-in/check-out da tarefa sumiram do dossiê
 * público, do PDF e da própria tela de tarefas — e, sem linha no banco
 * apontando para eles, os arquivos seriam recolhidos pelo coletor de órfãos em
 * 7 dias.
 *
 * O que este arquivo protege:
 *  · a pasta inteira acompanha o rename (caminho feliz);
 *  · o cliente vizinho cujo nome COMEÇA igual não é tocado;
 *  · destino já ocupado MESCLA de verdade (a versão antiga pulava o move e
 *    mexia no banco assim mesmo — mesma falha, outra porta);
 *  · colisão de nome de arquivo no merge não sobrescreve nem perde byte;
 *  · o banco só anda quando há arquivo no destino;
 *  · o nome da pasta sai do MESMO sanitizador do upload (razão social com "S/A");
 *  · `rollbackDisk()` devolve os bytes quando a transação aborta depois.
 *
 * Não encosta em Postgres nem no disco de produção: usa um FILES_ROOT temporário
 * e um `tx` de mentira com as linhas de File em memória.
 *
 * Rodar: pnpm tsx tests/folder-rename.test.ts
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// FILES_ROOT precisa estar de pé ANTES do import: os dois serviços o leem uma
// única vez, no construtor.
const ROOT = mkdtempSync(join(tmpdir(), 'ankaa-folder-rename-'));
process.env.FILES_ROOT = ROOT;

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  FolderRenameService,
} = require('../src/modules/common/file/services/folder-rename.service');
const { FilesStorageService } = require('../src/modules/common/file/services/files-storage.service');
const {
  FileCleanupSchedulerService,
} = require('../src/modules/common/file/services/file-cleanup-scheduler.service');
/* eslint-enable @typescript-eslint/no-var-requires */

interface Row {
  id: string;
  path: string;
}

/** `tx` de mentira: só o que `FolderRenameService` usa (`file.findMany/update`). */
function makeTx(rows: Row[]) {
  return {
    file: {
      findMany: async ({ where }: any) => {
        const prefix = where?.path?.startsWith ?? '';
        return rows.filter(r => r.path.startsWith(prefix)).map(r => ({ ...r }));
      },
      update: async ({ where, data }: any) => {
        const row = rows.find(r => r.id === where.id);
        if (!row) throw new Error(`linha inexistente: ${where.id}`);
        row.path = data.path;
        return { ...row };
      },
    },
  } as any;
}

function newService() {
  // O serviço só toca `prisma` através do `tx` que recebe; aqui ele não é usado.
  return new FolderRenameService({} as any, new FilesStorageService());
}

function seed(relativePath: string, content: string): string {
  const full = join(ROOT, relativePath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
  return full;
}

function cli(...parts: string[]): string {
  return join(ROOT, 'Clientes', ...parts);
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  console.log('\nA pasta vai junto — e o vizinho de nome parecido fica onde está');
  {
    const alvo = seed('Clientes/Mascarenhas/Checkin/a.jpg', 'alvo');
    const vizinho = seed('Clientes/Mascarenhas & Chaves LTDA/Checkin/b.jpg', 'vizinho');
    const rows: Row[] = [
      { id: 'f1', path: alvo },
      { id: 'f2', path: vizinho },
    ];
    const tx = makeTx(rows);

    const result = await newService().renameCustomerFolders('Mascarenhas', 'Comercial Dias', tx);

    check('a pasta do renomeado mudou de nome', existsSync(cli('Comercial Dias', 'Checkin', 'a.jpg')));
    check('a pasta antiga não ficou para trás', !existsSync(cli('Mascarenhas')));
    check(
      'o banco do renomeado aponta para a pasta nova',
      rows[0].path === cli('Comercial Dias', 'Checkin', 'a.jpg'),
      rows[0].path,
    );

    // O CORAÇÃO DA REGRESSÃO.
    check(
      'o vizinho "Mascarenhas & Chaves LTDA" não foi arrastado em disco',
      existsSync(cli('Mascarenhas & Chaves LTDA', 'Checkin', 'b.jpg')),
    );
    check(
      'o vizinho não foi arrastado no banco',
      rows[1].path === vizinho,
      `virou ${rows[1].path}`,
    );
    check('contou 1 pasta e 1 arquivo', result.totalFoldersRenamed === 1 && result.totalFilesUpdated === 1);
  }

  // ---------------------------------------------------------------------------
  console.log('\nTodo caminho no banco tem byte no destino');
  {
    const rows: Row[] = [];
    const tx = makeTx(rows);
    for (const rel of ['Clientes/Sola/Layouts/x.pdf', 'Clientes/Sola/Outros/y.png']) {
      rows.push({ id: rel, path: seed(rel, rel) });
    }
    await newService().renameCustomerFolders('Sola', 'Sola Alimentos LTDA', tx);

    check(
      'nenhuma linha aponta para o vazio',
      rows.every(r => existsSync(r.path)),
      rows.filter(r => !existsSync(r.path)).map(r => r.path).join(', '),
    );
  }

  // ---------------------------------------------------------------------------
  console.log('\nDestino já ocupado: mescla de verdade, sem sobrescrever');
  {
    const origem = seed('Clientes/Perboni/Checkin/only-source.jpg', 'origem');
    const colide = seed('Clientes/Perboni/Checkin/shared.jpg', 'origem-colide');
    seed('Clientes/Perboni Goiania/Checkin/shared.jpg', 'destino-existente');
    const rows: Row[] = [
      { id: 'm1', path: origem },
      { id: 'm2', path: colide },
    ];
    const tx = makeTx(rows);

    await newService().renameCustomerFolders('Perboni', 'Perboni Goiania', tx);

    check(
      'o arquivo sem conflito foi levado para a pasta do destino',
      existsSync(cli('Perboni Goiania', 'Checkin', 'only-source.jpg')),
    );
    check(
      'e o banco o acompanhou',
      rows[0].path === cli('Perboni Goiania', 'Checkin', 'only-source.jpg'),
      rows[0].path,
    );
    check(
      'o arquivo do destino NÃO foi sobrescrito',
      readFileSync(cli('Perboni Goiania', 'Checkin', 'shared.jpg'), 'utf8') === 'destino-existente',
    );
    check(
      'o byte que colidiu não foi perdido: ficou na origem',
      existsSync(colide) && readFileSync(colide, 'utf8') === 'origem-colide',
    );
    check(
      'e o banco continua apontando para ele, não para o vazio',
      rows[1].path === colide && existsSync(rows[1].path),
      rows[1].path,
    );
  }

  // ---------------------------------------------------------------------------
  console.log('\nRazão social com barra usa o mesmo nome de pasta que o upload');
  {
    // O upload grava em "Frix Logistica S_A" (o sanitizador troca "/" por "_").
    // A cópia local que existia aqui não trocava, então o rename procurava
    // "Frix Logistica S/A" — pasta inexistente — e saía calado.
    const arquivo = seed('Clientes/Frix Logistica S_A/Layouts/z.pdf', 'frix');
    const rows: Row[] = [{ id: 's1', path: arquivo }];
    const tx = makeTx(rows);

    await newService().renameCustomerFolders('Frix Logistica S/A', 'Frix Log S/A', tx);

    check('achou a pasta sanitizada e a renomeou', existsSync(cli('Frix Log S_A', 'Layouts', 'z.pdf')));
    check(
      'o banco acompanhou',
      rows[0].path === cli('Frix Log S_A', 'Layouts', 'z.pdf'),
      rows[0].path,
    );
  }

  // ---------------------------------------------------------------------------
  console.log('\nRede de segurança: o cron não apaga arquivo apenas DESLOCADO');
  {
    // Cenário real de 16/09: os bytes num caminho que o banco não conhece, e a
    // linha do banco apontando para o vazio. Cada varredura sozinha chamaria
    // isso de "órfão" e de "sumido"; cruzadas, é o mesmo arquivo.
    const updates: Array<{ id: string; path: string }> = [];
    const prisma = { file: { update: async ({ where, data }: any) => updates.push({ id: where.id, path: data.path }) } };
    // A ordem dos parâmetros é (schedulerRegistry, prisma).
    const cleanup = new FileCleanupSchedulerService({ addCronJob: () => {} } as any, prisma as any);

    const orfaos = [
      { path: cli('Mascarenhas & Chaves LTDA', 'Checkin', 'foto_2026-09-14_107dbfd7.jpg'), size: 1, age: 9, reason: 'no_db_record' },
      { path: cli('Ambiguo A', 'repetido.jpg'), size: 1, age: 9, reason: 'no_db_record' },
      { path: cli('Ambiguo B', 'repetido.jpg'), size: 1, age: 9, reason: 'no_db_record' },
      { path: cli('Lixo De Verdade', 'sobra.jpg'), size: 1, age: 9, reason: 'no_db_record' },
    ];
    const sumidos = [
      { id: 'db1', path: cli('Comercial Dias & Chaves LTDA', 'Checkin', 'foto_2026-09-14_107dbfd7.jpg') },
      { id: 'db2', path: cli('Outro', 'repetido.jpg') },
    ];

    const preservados: Set<string> = await (cleanup as any).reclaimDisplacedFiles(orfaos, sumidos);

    check(
      'o deslocado foi repontado para onde os bytes estão',
      updates.length === 1 && updates[0].id === 'db1' && updates[0].path === orfaos[0].path,
      JSON.stringify(updates),
    );
    check('e foi tirado da fila de exclusão', preservados.has(orfaos[0].path));
    check(
      'nome ambíguo não é adivinhado, mas é preservado',
      !updates.some(u => u.id === 'db2') &&
        preservados.has(orfaos[1].path) &&
        preservados.has(orfaos[2].path),
    );
    check('lixo de verdade continua na fila de exclusão', !preservados.has(orfaos[3].path));
  }

  // ---------------------------------------------------------------------------
  console.log('\nTransação abortada depois do rename devolve os bytes');
  {
    const arquivo = seed('Clientes/Jr/Checkin/c.jpg', 'jr');
    const rows: Row[] = [{ id: 'r1', path: arquivo }];
    const tx = makeTx(rows);

    const result = await newService().renameCustomerFolders('Jr', 'Jr Distribuidora', tx);
    check('moveu primeiro', existsSync(cli('Jr Distribuidora', 'Checkin', 'c.jpg')));

    // O Prisma desfaz o banco sozinho; o disco é por nossa conta.
    rows[0].path = arquivo;
    await result.rollbackDisk();

    check('os bytes voltaram para a pasta antiga', existsSync(arquivo));
    check('e não sobrou nada na pasta nova', !existsSync(cli('Jr Distribuidora', 'Checkin', 'c.jpg')));
    check('banco e disco voltaram a concordar', existsSync(rows[0].path));

    await result.rollbackDisk(); // idempotente
    check('chamar de novo não desfaz o desfeito', existsSync(arquivo));
  }
}

main()
  .then(() => {
    rmSync(ROOT, { recursive: true, force: true });
    console.log(
      failures === 0
        ? '\n✅ Todas as verificações passaram.\n'
        : `\n❌ ${failures} verificação(ões) falharam.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    rmSync(ROOT, { recursive: true, force: true });
    console.error('\n❌ Erro inesperado:', err);
    process.exit(1);
  });
