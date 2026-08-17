/**
 * Descobre quais números de DPS já foram consumidos na SEFIN por cada emitente,
 * para que o contador local (`FiscalDpsSequence`) não comece em cima de um número
 * usado — o que dá rejeição E0014 ("série+número+município+CNPJ já existe") logo
 * na PRIMEIRA nota real.
 *
 * O espaço de numeração é da SEFIN, não do nosso banco: um pintor que já emitiu
 * pelo emissor web (ou por um teste anterior) chega aqui com números queimados.
 * `HEAD /dps/{id}` responde 200 (existe) / 404 (livre) sem gerar nada.
 *
 * SÓ LEITURA — não grava nem emite. Ajuste a sequência à mão depois, com o
 * `lastNumber` que este script sugerir.
 *
 * Rodar:
 *   npm run probe:painter-dps-numbering -- [--cnpj 62626218000103] [--ate 30]
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { FiscalCertificateService } from '../modules/integrations/nfse/painter/fiscal-certificate.service';
import {
  SefinNacionalClient,
  type NfseEnvironment,
} from '../modules/integrations/nfse/painter/sefin-nacional.client';
import { buildDpsId } from '../modules/integrations/nfse/painter/dps.builder';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cnpjFiltro = arg('cnpj')?.replace(/\D/g, '');
  const ate = Number(arg('ate') ?? 30);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService, { strict: false });
    const certificates = app.get(FiscalCertificateService, { strict: false });
    const sefin = app.get(SefinNacionalClient, { strict: false });

    const profiles = await prisma.fiscalEmitterProfile.findMany({
      where: cnpjFiltro ? { cnpj: cnpjFiltro } : undefined,
      include: { user: { select: { name: true } } },
    });

    if (profiles.length === 0) {
      console.log('Nenhum perfil fiscal encontrado com esse filtro.');
      return;
    }

    for (const profile of profiles) {
      console.log(
        `\n═══ ${profile.user?.name ?? '?'} — CNPJ ${profile.cnpj} · série ${profile.serie} · ambiente ${profile.environment} ═══`,
      );

      const cert = await certificates.getActive(profile.id);
      if (!cert) {
        console.log('  (sem certificado ativo — pulando)');
        continue;
      }
      const { agent } = await certificates.getSigningContext(cert.id);
      const environment = (profile.environment === 1 ? 1 : 2) as NfseEnvironment;

      const usados: number[] = [];
      const livres: number[] = [];

      for (let n = 1; n <= ate; n++) {
        const dpsId = buildDpsId({
          municipioIbge: profile.municipalityIbgeCode,
          documento: profile.cnpj,
          serie: profile.serie,
          nDps: n,
        });
        try {
          const existe = await sefin.dpsExists({ environment, agent, dpsId });
          (existe ? usados : livres).push(n);
        } catch (error) {
          console.log(
            `  nDPS ${n}: ERRO — ${error instanceof Error ? error.message : String(error)}`,
          );
          // Um erro de transporte no meio da varredura torna o resultado
          // inconclusivo: parar é mais honesto do que reportar "livre" para
          // números que não chegamos a checar.
          break;
        }
      }

      console.log(`  usados: ${usados.length ? usados.join(', ') : '(nenhum)'}`);
      console.log(
        `  livres: ${livres.length ? `${livres[0]}..${livres[livres.length - 1]} (${livres.length})` : '(nenhum)'}`,
      );

      const maiorUsado = usados.length ? Math.max(...usados) : 0;
      const seq = await prisma.fiscalDpsSequence.findFirst({
        where: { profileId: profile.id, serie: profile.serie, environment: profile.environment },
        select: { lastNumber: true },
      });
      const atual = seq ? Number(seq.lastNumber) : 0;

      console.log(`  FiscalDpsSequence.lastNumber atual: ${seq ? atual : '(sem linha — vale 0)'}`);
      if (maiorUsado > atual) {
        console.log(
          `  ⚠️  AJUSTAR para lastNumber=${maiorUsado} (próxima DPS usaria ${maiorUsado + 1}); do jeito que está, a próxima seria ${atual + 1} → E0014.`,
        );
      } else {
        console.log(`  ✓ contador seguro — próxima DPS usaria ${atual + 1}, que está livre.`);
      }
    }
  } finally {
    await app.close().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`\nFALHOU: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
