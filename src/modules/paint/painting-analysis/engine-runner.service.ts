import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

export interface EngineRunOptions {
  imagePath: string;
  referenceKind: string;
  referenceValueCm: number;
  stages?: string[];
  paramsOverride?: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * Spawns the Python analysis engine (api/painting-engine) as a CLI per job.
 * Env overrides:
 *  - PAINTING_ENGINE_PYTHON: python binary (default: painting-engine/.venv/bin/python)
 *  - PAINTING_ENGINE_DIR:    engine root (default: <api>/painting-engine)
 */
@Injectable()
export class PaintingEngineRunnerService {
  private readonly logger = new Logger(PaintingEngineRunnerService.name);

  private get engineDir(): string {
    return process.env.PAINTING_ENGINE_DIR || resolve(process.cwd(), 'painting-engine');
  }

  private get pythonBin(): string {
    return (
      process.env.PAINTING_ENGINE_PYTHON || join(this.engineDir, '.venv', 'bin', 'python')
    );
  }

  isAvailable(): boolean {
    return existsSync(this.pythonBin);
  }

  async run(options: EngineRunOptions): Promise<any> {
    if (!this.isAvailable()) {
      throw new InternalServerErrorException(
        `Motor de análise indisponível (python não encontrado em ${this.pythonBin}). ` +
          'Instale com: cd painting-engine && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt',
      );
    }

    const outDir = await mkdtemp(join(tmpdir(), 'painting-engine-'));
    const outPath = join(outDir, 'analysis.json');
    const args = [
      '-m',
      'painting_engine.cli',
      '--input',
      options.imagePath,
      '--reference-kind',
      options.referenceKind,
      '--reference-cm',
      String(options.referenceValueCm),
      '--out',
      outPath,
    ];
    if (options.stages?.length) {
      args.push('--stages', options.stages.join(','));
    }
    if (options.paramsOverride && Object.keys(options.paramsOverride).length > 0) {
      args.push('--params-json', JSON.stringify(options.paramsOverride));
    }

    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    this.logger.log(`engine run: ${options.imagePath} stages=${options.stages?.join(',') || 'all'}`);

    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(this.pythonBin, args, {
          cwd: this.engineDir,
          env: { ...process.env, PYTHONPATH: join(this.engineDir, 'src') },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += String(chunk);
        });
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          rejectPromise(new Error(`engine timeout após ${timeoutMs / 1000}s`));
        }, timeoutMs);
        child.on('error', (error) => {
          clearTimeout(timer);
          rejectPromise(error);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolvePromise();
          } else {
            rejectPromise(new Error(`engine exit ${code}: ${stderr.slice(-2000)}`));
          }
        });
      });

      const raw = await readFile(outPath, 'utf-8');
      return JSON.parse(raw);
    } finally {
      await rm(outDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
