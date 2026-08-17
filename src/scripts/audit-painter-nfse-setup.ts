/**
 * Auditoria do provisionamento de NFS-e dos aerografistas — SEM EMITIR.
 *
 * Responde "está tudo certo para funcionar?" sem gastar uma nota. Para cada
 * emitente: monta a DPS pelo MESMO `buildDpsXml` da emissão, assina com o A1 real
 * decifrado do banco, verifica a assinatura de volta e confere as regras que a
 * SEFIN rejeitaria. O único passo que não roda é o `sefin.emit`.
 *
 * Isto NÃO substitui homologação: uma rejeição só de servidor (E0041 município
 * divergente do cadastro CNPJ, por exemplo) não aparece aqui. O que aqui se prova
 * é que o pacote sai bem-formado, assinado e dentro do leiaute de MEI.
 *
 * SÓ LEITURA. Nada é gravado, nada é transmitido.
 *
 * Rodar: npx ts-node -r tsconfig-paths/register --transpile-only \
 *          src/scripts/audit-painter-nfse-setup.ts [--cnpj 62626218000103]
 */

import { NestFactory } from '@nestjs/core';
import { SignedXml } from 'xml-crypto';
import { DOMParser } from '@xmldom/xmldom';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { FiscalCertificateService } from '../modules/integrations/nfse/painter/fiscal-certificate.service';
import { DpsSignerService } from '../modules/integrations/nfse/painter/dps.signer';
import { buildCompanyTomador } from '../modules/integrations/nfse/painter/painter-nfse.service';
import {
  buildDpsId,
  buildDpsXml,
  buildServiceDescription,
} from '../modules/integrations/nfse/painter/dps.builder';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

let falhas = 0;
function check(ok: boolean, label: string, detalhe = ''): void {
  if (!ok) falhas++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detalhe ? ` — ${detalhe}` : ''}`);
}

/** Elemento presente no XML? Usado para as PROIBIÇÕES do leiaute de MEI. */
function has(xml: string, tag: string): boolean {
  return new RegExp(`<${tag}[ >]`).test(xml);
}
function value(xml: string, tag: string): string | null {
  return xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] ?? null;
}

async function main() {
  const cnpjFiltro = arg('cnpj')?.replace(/\D/g, '');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService, { strict: false });
    const certificates = app.get(FiscalCertificateService, { strict: false });
    const signer = app.get(DpsSignerService, { strict: false });

    const profiles = await prisma.fiscalEmitterProfile.findMany({
      where: cnpjFiltro ? { cnpj: cnpjFiltro } : undefined,
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    if (profiles.length === 0) {
      console.log('Nenhum perfil fiscal encontrado.');
      return;
    }

    const tomador = buildCompanyTomador();
    console.log(
      `\nTomador (Ankaa): CNPJ ${tomador.cnpj} · ${'cep' in tomador ? `CEP ${tomador.cep} (bloco <end> PRESENTE)` : 'sem CEP válido — bloco <end> OMITIDO'}`,
    );

    for (const profile of profiles) {
      console.log(`\n═══ ${profile.user?.name ?? '?'} <${profile.user?.email ?? '-'}> ═══`);

      // ── 1. Perfil ──
      console.log(' [perfil]');
      check(/^\d{14}$/.test(profile.cnpj), `CNPJ com 14 dígitos`, profile.cnpj);
      check(
        /^\d{7}$/.test(profile.municipalityIbgeCode),
        'IBGE com 7 dígitos',
        profile.municipalityIbgeCode,
      );
      check(profile.opSimpNac === 2, 'opSimpNac = 2 (Optante MEI)', String(profile.opSimpNac));
      check(profile.regEspTrib === 0, 'regEspTrib = 0 (E0174)', String(profile.regEspTrib));
      check(
        /^\d{6}$/.test(profile.cTribNac),
        'cTribNac com 6 dígitos',
        `${profile.cTribNac} (${profile.cTribNac === '141201' ? 'funilaria e lanternagem 14.12.01' : 'CONFERIR contra o histórico do pintor'})`,
      );
      check(
        !profile.municipalRegistration,
        'inscrição municipal omitida (E0116 — vazia é pior que ausente)',
        profile.municipalRegistration ?? '(ausente)',
      );
      check(profile.environment === 1, 'ambiente = 1 (Produção)', String(profile.environment));
      check(profile.emissionEnabled, 'emissão LIGADA');

      // ── 2. Certificado ──
      console.log(' [certificado]');
      const cert = await certificates.getActive(profile.id);
      if (!cert) {
        check(false, 'certificado ativo cadastrado', 'AUSENTE — pula o resto');
        continue;
      }
      check(true, 'certificado ativo', cert.subjectCommonName);
      check(
        cert.holderDocument === profile.cnpj,
        'CNPJ do certificado == CNPJ do perfil (E1209)',
        `${cert.holderDocument} vs ${profile.cnpj}`,
      );
      check(
        !cert.isExpired && cert.daysUntilExpiry > 0,
        'dentro da validade',
        `vence ${cert.notAfter.toLocaleDateString('pt-BR')} (${cert.daysUntilExpiry} dias)`,
      );

      // Decifra de verdade: prova que o envelope AES-GCM sob a KEK ATUAL abre.
      // Se a FISCAL_CERT_KEK tivesse mudado, é aqui que estoura.
      const { material } = await certificates.getSigningContext(cert.id);
      check(
        material.privateKeyPem.includes('PRIVATE KEY') &&
          material.certificatePem.includes('CERTIFICATE'),
        'decifra do banco sob a FISCAL_CERT_KEK atual',
      );

      // ── 3. Sequência ──
      console.log(' [numeração]');
      const seq = await prisma.fiscalDpsSequence.findFirst({
        where: { profileId: profile.id, serie: profile.serie, environment: profile.environment },
        select: { lastNumber: true },
      });
      const proximo = (seq ? BigInt(seq.lastNumber) : 0n) + 1n;
      check(true, `próxima DPS: série ${profile.serie} nº ${proximo}`);

      // ── 4. Monta e assina a DPS que sairia ──
      console.log(' [DPS montada e assinada]');
      const dpsId = buildDpsId({
        municipioIbge: profile.municipalityIbgeCode,
        documento: profile.cnpj,
        serie: profile.serie,
        nDps: proximo,
      });
      check(/^DPS\d{42}$/.test(dpsId), 'Id da DPS bem-formado', dpsId);

      const built = buildDpsXml({
        ambiente: profile.environment === 1 ? 1 : 2,
        emitidoEm: new Date(),
        competencia: new Date(),
        serie: profile.serie,
        nDps: proximo,
        emitente: {
          cnpj: profile.cnpj,
          inscricaoMunicipal: profile.municipalRegistration,
          municipioIbge: profile.municipalityIbgeCode,
          opSimpNac: profile.opSimpNac,
          regEspTrib: profile.regEspTrib,
        },
        tomador,
        servico: {
          municipioPrestacaoIbge: '4109807',
          cTribNac: profile.cTribNac,
          cTribMun: profile.cTribMun,
          // Aerografia sintética SÓ para a auditoria: nada disto é gravado.
          descricao: buildServiceDescription(profile.serviceDescription, {
            description: null,
            task: {
              name: 'AUDITORIA — NAO EMITIDA',
              serialNumber: null,
              customer: null,
              truck: null,
            },
          }),
        },
        valorServico: 100,
      });

      const xml = built.xml;
      check(xml.includes(`Id="${dpsId}"`), 'infDPS/@Id igual ao Id calculado');
      check(value(xml, 'tpAmb') === '1', 'tpAmb = 1 (nota com validade jurídica)', value(xml, 'tpAmb') ?? '-');
      check(value(xml, 'cLocEmi') === profile.municipalityIbgeCode, 'cLocEmi = município do perfil');
      check(value(xml, 'opSimpNac') === '2', 'opSimpNac = 2 no XML');
      check(value(xml, 'regEspTrib') === '0', 'regEspTrib = 0 no XML');
      check(value(xml, 'tpRetISSQN') === '1', 'tpRetISSQN = 1 (MEI nunca sofre retenção, E0583)');

      // As OMISSÕES são o que mais derruba MEI — cada uma é uma rejeição nomeada.
      const proibidos: Array<[string, string]> = [
        ['pAliq', 'E0600'],
        ['tribFed', 'E0676'],
        ['regApTribSN', 'E0162'],
        ['pTotTribSN', 'E0710'],
        ['vDedRed', 'E0436'],
        ['IM', 'E0116'],
      ];
      for (const [tag, regra] of proibidos) {
        check(!has(xml, tag), `<${tag}> AUSENTE (${regra})`);
      }

      const { signedXml } = signer.signAndPack(xml, material, 'infDPS');
      check(signedXml.includes('<X509Certificate>'), 'KeyInfo carrega o X509Certificate');

      // A prova de fogo: a assinatura tem de VERIFICAR contra o certificado.
      const signatureNode = new DOMParser()
        .parseFromString(signedXml, 'text/xml')
        .getElementsByTagName('Signature')[0];
      const verifier = new SignedXml({ publicCert: material.certificatePem });
      verifier.loadSignature(signatureNode as any);
      let verificou = false;
      let erro = '';
      try {
        verificou = verifier.checkSignature(signedXml);
      } catch (e) {
        erro = e instanceof Error ? e.message : String(e);
      }
      check(verificou, 'a assinatura VERIFICA com o certificado do pintor', erro);
    }

    console.log(
      falhas === 0
        ? '\n✅ Tudo conferido — o pacote sai bem-formado e assinado para todos.\n'
        : `\n❌ ${falhas} verificação(ões) falharam.\n`,
    );
  } finally {
    await app.close().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(falhas === 0 ? 0 : 1))
  .catch(error => {
    console.error(`\nFALHOU: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
