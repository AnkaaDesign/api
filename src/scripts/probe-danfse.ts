/**
 * Descobre qual rota de DANFSe ainda responde, e como.
 *
 * SÓ LEITURA. A documentação anuncia a desativação da API de DANFSe do ADN em
 * 2026, com a geração do PDF passando para o sistema do emitente — mas "anúncio
 * de desativação" e "desativado" são coisas diferentes, e a decisão de gerar o
 * PDF em casa custa caro para ser tomada por suposição. Este script pergunta.
 *
 * Rodar: npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/probe-danfse.ts <chaveAcesso>
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { FiscalCertificateService } from '../modules/integrations/nfse/painter/fiscal-certificate.service';
import axios from 'axios';

const CANDIDATES = (env: 1 | 2) => {
  const adn = env === 1 ? 'https://adn.nfse.gov.br' : 'https://adn.producaorestrita.nfse.gov.br';
  const sefin =
    env === 1
      ? 'https://sefin.nfse.gov.br/SefinNacional'
      : 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional';
  return [
    `${adn}/danfse/{chave}`,
    `${adn}/DANFSe/{chave}`,
    `${adn}/contribuintes/danfse/{chave}`,
    `${sefin}/danfse/{chave}`,
    `${sefin}/DANFSe/{chave}`,
  ];
};

async function main() {
  const chave = process.argv[2];
  if (!chave) {
    console.error('\nUso: probe-danfse.ts <chaveAcesso>\n');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService, { strict: false });
    const certificates = app.get(FiscalCertificateService, { strict: false });

    const profile = await prisma.fiscalEmitterProfile.findFirstOrThrow();
    const cert = await certificates.getActive(profile.id);
    if (!cert) throw new Error('Sem certificado ativo.');
    const { agent } = await certificates.getSigningContext(cert.id);
    const env = (profile.environment === 1 ? 1 : 2) as 1 | 2;

    console.log(`\n▸ Chave ${chave} — ambiente ${env === 1 ? 'produção' : 'produção restrita'}\n`);

    for (const template of CANDIDATES(env)) {
      const url = template.replace('{chave}', encodeURIComponent(chave));
      try {
        const res = await axios.get(url, {
          httpsAgent: agent,
          timeout: 30_000,
          responseType: 'arraybuffer',
          validateStatus: () => true,
          headers: { Accept: 'application/pdf, application/json' },
        });

        const buf = Buffer.from(res.data ?? []);
        const isPdf = buf.subarray(0, 5).toString() === '%PDF-';
        const preview = isPdf ? `PDF (${buf.length} bytes)` : buf.toString('utf-8').slice(0, 220);
        console.log(`  ${res.status.toString().padEnd(4)} ${url}`);
        console.log(`       ${preview.replace(/\s+/g, ' ')}\n`);
      } catch (error: any) {
        console.log(`  ERR  ${url}`);
        console.log(`       ${error?.message ?? error}\n`);
      }
    }
  } finally {
    await app.close().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Falhou:', e?.message ?? e);
    process.exit(1);
  });
