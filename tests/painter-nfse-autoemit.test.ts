/**
 * Regression guard — "concluí a aerografia e a nota não saiu".
 *
 * A emissão automática depende de DOIS passos, e eles vivem em lugares diferentes de
 * propósito: `registerIntent` grava a intenção DENTRO da transação da conclusão, e
 * `flushAfterCompletion` faz a chamada de rede à SEFIN DEPOIS do commit (rede dentro de
 * `$transaction` segura conexão do pool e, num timeout, derruba a conclusão junto).
 *
 * Concluir uma aerografia acontece em seis lugares: `update`, `create`, `batchUpdate` e
 * `batchCreate` do AirbrushingService, mais dois `tx.airbrushing.*` crus dentro do
 * TaskService. Antes desta rodada, só `update` e `batchUpdate` disparavam a emissão
 * imediata — os outros quatro registravam a intenção e paravam aí, então a nota só saía
 * na varredura de 15 minutos. O sintoma no app do pintor: concluir o serviço não produzia
 * nota nenhuma na hora, e ninguém sabia se era falha ou demora.
 *
 * O que este arquivo trava:
 *   1. as três regras de `flushAfterCompletion` (trava mestra, lista vazia, falha engolida);
 *   2. que TODO arquivo que registra intenção também dispara o flush.
 *
 * Run: pnpm tsx tests/painter-nfse-autoemit.test.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { PainterNfseService } from '../src/modules/integrations/nfse/painter/painter-nfse.service';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * O serviço com as dependências zeradas: `flushAfterCompletion` não toca em nenhuma delas
 * — ele só decide SE chama `emitForAirbrushings`, que aqui é substituído por um espião.
 * É exatamente essa decisão que está sob teste.
 */
function serviceWithSpy(behaviour?: () => Promise<unknown>) {
  const calls: string[][] = [];
  const service = new PainterNfseService(
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );
  (service as any).emitForAirbrushings = async (ids: string[]) => {
    calls.push(ids);
    if (behaviour) return behaviour();
    return [];
  };
  return { service, calls };
}

async function withFlag<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.PAINTER_NFSE_SCHEDULER_ENABLED;
  if (value === undefined) delete process.env.PAINTER_NFSE_SCHEDULER_ENABLED;
  else process.env.PAINTER_NFSE_SCHEDULER_ENABLED = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.PAINTER_NFSE_SCHEDULER_ENABLED;
    else process.env.PAINTER_NFSE_SCHEDULER_ENABLED = previous;
  }
}

async function main() {
  console.log('\nEmissão automática ao concluir a aerografia\n');

  // ── 1. A trava mestra ───────────────────────────────────────────────────────
  await withFlag('false', async () => {
    const { service, calls } = serviceWithSpy();
    await service.flushAfterCompletion(['a1']);
    check(
      'trava desligada não emite (a intenção fica para a varredura)',
      calls.length === 0,
      `chamou ${calls.length}x`,
    );
  });

  await withFlag(undefined, async () => {
    const { service, calls } = serviceWithSpy();
    await service.flushAfterCompletion(['a1']);
    check('variável ausente conta como desligada', calls.length === 0);
  });

  // ── 2. O caminho feliz — o que o app do pintor exercita ─────────────────────
  await withFlag('true', async () => {
    const { service, calls } = serviceWithSpy();
    await service.flushAfterCompletion(['a1', 'a2']);
    check('trava ligada emite na hora', calls.length === 1, `chamou ${calls.length}x`);
    check(
      'emite exatamente as aerografias concluídas',
      JSON.stringify(calls[0]) === JSON.stringify(['a1', 'a2']),
      JSON.stringify(calls[0]),
    );
  });

  await withFlag('true', async () => {
    const { service, calls } = serviceWithSpy();
    await service.flushAfterCompletion([]);
    check('lista vazia não vira chamada de rede', calls.length === 0);
  });

  // ── 3. Falha nunca derruba a conclusão ──────────────────────────────────────
  await withFlag('true', async () => {
    const { service } = serviceWithSpy(async () => {
      throw new Error('SEFIN fora do ar');
    });
    let threw = false;
    try {
      await service.flushAfterCompletion(['a1']);
    } catch {
      threw = true;
    }
    check(
      'SEFIN fora do ar não propaga (a aerografia já está concluída e salva)',
      !threw,
      'a exceção vazou para o chamador',
    );
  });

  // ── 4. Nenhum caminho de conclusão pode registrar sem disparar ──────────────
  // O comentário de `registerNfseIntent` avisa que esquecer um caminho é SILENCIOSO:
  // a aerografia fica concluída, sem nota, sem erro. Este par de asserções é o que
  // torna o esquecimento barulhento.
  const sources = [
    'src/modules/production/airbrushing/airbrushing.service.ts',
    'src/modules/production/task/task.service.ts',
  ];

  for (const relative of sources) {
    const source = readFileSync(join(__dirname, '..', relative), 'utf8');
    const registers = source.includes('registerIntent(') || source.includes('registerNfseIntent(');
    const flushes =
      source.includes('flushAfterCompletion(') || source.includes('flushNfseEmissions(');
    check(
      `${relative.split('/').pop()} registra intenção e também dispara a emissão`,
      !registers || flushes,
      'registra a intenção mas nunca chama o flush — a nota só sairia na varredura',
    );
  }

  console.log(
    failures === 0
      ? '\nConcluir uma aerografia emite a NFS-e na hora.\n'
      : `\n${failures} guarda(s) FALHARAM — a emissão automática está quebrada.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
