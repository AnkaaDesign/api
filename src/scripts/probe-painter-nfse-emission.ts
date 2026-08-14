/**
 * Sonda a emissão da NFS-e do aerografista mostrando a resposta CRUA da SEFIN.
 *
 * SÓ LEITURA no banco: monta e assina a DPS exatamente como o emissor faz, mas
 * o resultado não é persistido em lugar nenhum. Serve para ver o corpo de erro
 * inteiro quando a nota é recusada — a mensagem gravada na linha é truncada em
 * 1000 caracteres e uma rejeição de leiaute pode trazer dezenas de itens.
 *
 * ⚠️ Se a SEFIN ACEITAR, a nota é emitida de verdade no ambiente configurado no
 * perfil do pintor e este script NÃO a registra no banco — use apenas quando a
 * emissão já estiver falhando, ou com o perfil em produção restrita.
 *
 * Rodar: npm run probe:painter-nfse
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { FiscalCertificateService } from '../modules/integrations/nfse/painter/fiscal-certificate.service';
import { DpsSignerService } from '../modules/integrations/nfse/painter/dps.signer';
import { buildDpsXml } from '../modules/integrations/nfse/painter/dps.builder';
import { buildCompanyTomador } from '../modules/integrations/nfse/painter/painter-nfse.service';
import axios from 'axios';
import { gzipSync } from 'node:zlib';

const COMPANY_MUNICIPALITY_IBGE = '4109807';

const BASE_URLS: Record<number, string> = {
  1: 'https://sefin.nfse.gov.br/SefinNacional',
  2: 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional',
};

async function main() {
  const airbrushingId = process.argv[2] || process.env.PROBE_AIRBRUSHING_ID;
  if (!airbrushingId) {
    console.error('\nUso: npm run probe:painter-nfse -- <airbrushingId>\n');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    const prisma = app.get(PrismaService, { strict: false });
    const certificates = app.get(FiscalCertificateService, { strict: false });
    const signer = app.get(DpsSignerService, { strict: false });

    const ab = await prisma.airbrushing.findUniqueOrThrow({
      where: { id: airbrushingId },
      include: {
        task: { select: { name: true, serialNumber: true } },
        painter: { select: { id: true, name: true } },
        nfse: { select: { id: true, serie: true, nDps: true, dpsId: true, status: true } },
      },
    });

    const profile = await prisma.fiscalEmitterProfile.findUniqueOrThrow({
      where: { userId: ab.painterId! },
    });
    const certificate = await certificates.getActive(profile.id);
    if (!certificate) throw new Error('Pintor sem certificado ativo.');

    const { material, agent } = await certificates.getSigningContext(certificate.id);
    const environment = profile.environment === 1 ? 1 : 2;

    // Reaproveita a numeração já alocada, para a sonda refletir exatamente a
    // DPS que o emissor tentou enviar.
    const serie = ab.nfse?.serie ?? profile.serie;
    // PROBE_NDPS força um número novo. Necessário porque o conjunto
    // (série, número, município, CNPJ) só pode virar nota UMA vez: repetir
    // devolve E0014, mesmo que a tentativa anterior tenha sido só uma sonda.
    const nDps = process.env.PROBE_NDPS ? BigInt(process.env.PROBE_NDPS) : (ab.nfse?.nDps ?? 1n);

    const built = buildDpsXml({
      ambiente: environment as 1 | 2,
      emitidoEm: new Date(),
      competencia: ab.finishedAt ?? ab.finishDate ?? new Date(),
      serie,
      nDps,
      emitente: {
        cnpj: profile.cnpj,
        inscricaoMunicipal: profile.municipalRegistration,
        municipioIbge: profile.municipalityIbgeCode,
        opSimpNac: profile.opSimpNac,
        regEspTrib: profile.regEspTrib,
      },
      // Exatamente o mesmo bloco que o emissor usa — a sonda não pode divergir.
      tomador: buildCompanyTomador(),
      servico: {
        municipioPrestacaoIbge: COMPANY_MUNICIPALITY_IBGE,
        cTribNac: profile.cTribNac,
        cTribMun: profile.cTribMun,
        descricao: ab.description?.trim() || profile.serviceDescription,
      },
      valorServico: Number(ab.price),
    });

    const signed = signer.sign(built.xml, material, 'infDPS');
    const packed = gzipSync(Buffer.from(signed, 'utf-8')).toString('base64');
    const url = `${BASE_URLS[environment]}/nfse`;

    console.log('\n─── DPS ───────────────────────────────────────────────────');
    console.log(`  Prestador ... ${profile.corporateName} (${profile.cnpj})`);
    console.log(`  Município ... ${profile.municipalityIbgeCode}`);
    console.log(`  Serviço ..... ${profile.cTribNac}`);
    console.log(`  Valor ....... R$ ${Number(ab.price).toFixed(2)}`);
    console.log(`  Id .......... ${built.id}`);
    console.log(`  Ambiente .... ${environment === 1 ? 'PRODUÇÃO' : 'produção restrita'}`);
    console.log(`  Destino ..... ${url}`);
    console.log('\n─── XML assinado ──────────────────────────────────────────');
    console.log(signed);

    console.log('\n─── Resposta da SEFIN ─────────────────────────────────────');
    const response = await axios.post(
      url,
      { dpsXmlGZipB64: packed },
      {
        httpsAgent: agent,
        timeout: 60_000,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        validateStatus: () => true,
      },
    );

    console.log(`  HTTP ${response.status} ${response.statusText}`);
    console.log(
      `  Corpo: ${JSON.stringify(response.data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}`,
    );
    console.log('───────────────────────────────────────────────────────────\n');
  } finally {
    await app.close().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Falhou:', error?.response?.data ?? error?.message ?? error);
    process.exit(1);
  });
