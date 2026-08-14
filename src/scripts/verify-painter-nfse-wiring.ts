/**
 * Smoke test de injeção de dependências da NFS-e do aerografista.
 *
 * SÓ LEITURA. Não grava nada, não fala com a SEFIN.
 *
 * Existe porque erro de fiação de módulo no Nest não aparece no `tsc`: ele só
 * estoura no boot, e neste caso o boot que importa é o de produção. Aqui o
 * container é levantado de verdade e cada provider novo é resolvido, incluindo
 * os pontos onde AirbrushingService e TaskService passaram a depender do
 * emissor — que é onde um ciclo de módulos apareceria.
 *
 * Rodar: npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/verify-painter-nfse-wiring.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PainterNfseService } from '../modules/integrations/nfse/painter/painter-nfse.service';
import { FiscalCertificateService } from '../modules/integrations/nfse/painter/fiscal-certificate.service';
import { FiscalEmitterProfileService } from '../modules/integrations/nfse/painter/fiscal-emitter-profile.service';
import { DpsSignerService } from '../modules/integrations/nfse/painter/dps.signer';
import { SefinNacionalClient } from '../modules/integrations/nfse/painter/sefin-nacional.client';
import { PainterNfseScheduler } from '../modules/integrations/nfse/painter/painter-nfse.scheduler';
import { AirbrushingService } from '../modules/production/airbrushing/airbrushing.service';
import { TaskService } from '../modules/production/task/task.service';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('\n▸ Levantando o container do Nest...\n');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const providers = [
      ['PainterNfseService', PainterNfseService],
      ['FiscalCertificateService', FiscalCertificateService],
      ['FiscalEmitterProfileService', FiscalEmitterProfileService],
      ['DpsSignerService', DpsSignerService],
      ['SefinNacionalClient', SefinNacionalClient],
      ['PainterNfseScheduler', PainterNfseScheduler],
    ] as const;

    for (const [name, token] of providers) {
      let resolved: unknown = null;
      try {
        resolved = app.get(token as never, { strict: false });
      } catch (error) {
        check(`${name} resolve`, false, error instanceof Error ? error.message : String(error));
        continue;
      }
      check(`${name} resolve`, Boolean(resolved));
    }

    // Os dois consumidores. Se algum ciclo de módulo tivesse sido introduzido,
    // é aqui que ele apareceria como undefined em vez de erro.
    const airbrushing = app.get(AirbrushingService, { strict: false });
    check(
      'AirbrushingService recebeu o emissor injetado',
      Boolean((airbrushing as any)?.painterNfseService),
    );

    const task = app.get(TaskService, { strict: false });
    check('TaskService recebeu o emissor injetado', Boolean((task as any)?.painterNfseService));

    // A trava tem de REFLETIR a variável, não ser sempre falsa — afirmar
    // "começa desligada" quebrava o script justamente quando alguém ligava a
    // emissão de propósito, que é o cenário normal em produção.
    const scheduler = app.get(PainterNfseScheduler, { strict: false });
    const expectedGate = process.env.PAINTER_NFSE_SCHEDULER_ENABLED === 'true';
    check(
      `trava de emissão reflete PAINTER_NFSE_SCHEDULER_ENABLED (${expectedGate ? 'LIGADA' : 'desligada'})`,
      (scheduler as any).enabled === expectedGate,
    );
  } finally {
    // O desligamento do container derruba Redis/Baileys e costuma estourar
    // "Connection is closed" DEPOIS das verificações. Isso não diz nada sobre a
    // fiação e não pode mascarar o resultado.
    await app.close().catch(() => undefined);
  }

  console.log(
    failures === 0
      ? '\n✅ Fiação verificada.\n'
      : `\n❌ ${failures} verificação(ões) falharam.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => {
  console.error('\n❌ Falha ao levantar o container:', error);
  process.exit(1);
});
