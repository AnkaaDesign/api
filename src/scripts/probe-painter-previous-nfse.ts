/**
 * Lê as NFS-e que o pintor JÁ emitiu (inclusive pelo emissor do portal) e
 * mostra as opções fiscais que ele escolheu.
 *
 * SÓ LEITURA. Nada é gravado.
 *
 * Para quê: o sistema passa a emitir em nome do pintor, e o padrão tem de
 * continuar o mesmo que ele já vinha usando — código de tributação, regime,
 * retenção, município de incidência. Divergir disso é criar inconsistência no
 * histórico fiscal dele sem ninguém perceber.
 *
 * Usa a distribuição de DF-e do ADN (`/contribuintes/dfe/{NSU}`), que devolve os
 * documentos do titular do certificado apresentado no handshake.
 *
 * Rodar: npm run probe:painter-previous-nfse
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { FiscalCertificateService } from '../modules/integrations/nfse/painter/fiscal-certificate.service';
import { parseNfseXml } from '../modules/integrations/nfse/painter/danfse.generator';
import axios from 'axios';
import { gunzipSync } from 'node:zlib';

const ADN = {
  1: 'https://adn.nfse.gov.br/contribuintes',
  2: 'https://adn.producaorestrita.nfse.gov.br/contribuintes',
} as const;

/** Extrai uma tag do XML cru — usado para os campos que o parser do DANFSe não expõe. */
function tag(xml: string, name: string): string | null {
  return xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? null;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService, { strict: false });
    const certificates = app.get(FiscalCertificateService, { strict: false });

    const profiles = await prisma.fiscalEmitterProfile.findMany({
      include: { user: { select: { name: true } } },
    });

    for (const profile of profiles) {
      console.log(`\n═══ ${profile.user?.name ?? '?'} — CNPJ ${profile.cnpj} ═══`);

      const cert = await certificates.getActive(profile.id);
      if (!cert) {
        console.log('  (sem certificado ativo — pulando)');
        continue;
      }
      const { agent } = await certificates.getSigningContext(cert.id);
      const env = (profile.environment === 1 ? 1 : 2) as 1 | 2;

      const http = axios.create({
        baseURL: ADN[env],
        timeout: 60_000,
        httpsAgent: agent,
        headers: { Accept: 'application/json' },
        validateStatus: () => true,
      });

      // A distribuição é sequencial por NSU; começamos do zero e seguimos os lotes.
      let nsu = 0;
      let lote = 0;
      const vistas: string[] = [];

      while (lote < 5) {
        const res = await http.get(`/dfe/${nsu}`);
        if (res.status !== 200) {
          console.log(`  GET /dfe/${nsu} → HTTP ${res.status}`);
          if (typeof res.data === 'object') {
            console.log(`  ${JSON.stringify(res.data).slice(0, 400)}`);
          }
          break;
        }

        const docs: any[] = res.data?.LoteDFe ?? res.data?.loteDFe ?? res.data?.lote ?? [];
        if (!Array.isArray(docs) || docs.length === 0) {
          console.log(`  Sem mais documentos a partir do NSU ${nsu}.`);
          break;
        }

        for (const doc of docs) {
          const b64 = doc?.ArquivoXml ?? doc?.arquivoXml ?? doc?.DocumentoXmlGZipB64;
          if (!b64) continue;
          let xml: string;
          try {
            xml = gunzipSync(Buffer.from(String(b64), 'base64')).toString('utf-8');
          } catch {
            xml = Buffer.from(String(b64), 'base64').toString('utf-8');
          }
          if (!xml.includes('infNFSe')) continue;

          const d = parseNfseXml(xml);
          if (vistas.includes(d.chaveAcesso ?? '')) continue;
          vistas.push(d.chaveAcesso ?? '');

          console.log(`\n  ── NFS-e nº ${d.numeroNfse} (${d.competencia}) ──`);
          console.log(`     cStat ............... ${d.cStat}`);
          console.log(`     tpEmit .............. ${d.tpEmit}`);
          console.log(`     opSimpNac ........... ${d.prestadorOpSimpNac}`);
          console.log(`     regEspTrib .......... ${d.regEspTrib}`);
          console.log(`     regApTribSN ......... ${d.prestadorRegApTribSN ?? '-'}`);
          console.log(`     cTribNac ............ ${d.cTribNac}`);
          console.log(`     cTribMun ............ ${d.cTribMun ?? '-'}`);
          console.log(`     cNBS ................ ${d.cNBS ?? '-'}`);
          console.log(`     tribISSQN ........... ${d.tribISSQN}`);
          console.log(`     tpRetISSQN .......... ${d.retencaoIssqn}`);
          console.log(`     cLocEmi ............. ${tag(xml, 'cLocEmi')}`);
          console.log(`     cLocPrestacao ....... ${tag(xml, 'cLocPrestacao')}`);
          console.log(`     cLocIncid ........... ${tag(xml, 'cLocIncid')}`);
          console.log(`     vServ / vLiq ........ ${d.valorServico} / ${d.valorLiquido}`);
          console.log(`     IM .................. ${d.prestador.inscricaoMunicipal ?? '-'}`);
          // Grupos que NÃO deveriam existir para MEI — é aqui que aparece se ele
          // marcou algo que ainda não é obrigatório.
          for (const grupo of ['IBSCBS', 'tribFed', 'totTrib', 'pTotTribSN', 'subst']) {
            if (xml.includes(`<${grupo}`)) console.log(`     ⚠ contém <${grupo}>`);
          }
          console.log(`     descrição ........... ${(d.descricaoServico ?? '').slice(0, 90)}`);
        }

        const ultimo = Number(res.data?.UltNSU ?? res.data?.ultNSU ?? nsu);
        const max = Number(res.data?.MaxNSU ?? res.data?.maxNSU ?? ultimo);
        if (!Number.isFinite(ultimo) || ultimo <= nsu || ultimo >= max) break;
        nsu = ultimo;
        lote += 1;
      }

      if (vistas.length === 0) {
        console.log('  Nenhuma NFS-e anterior encontrada na distribuição.');
      } else {
        console.log(`\n  Total de notas lidas: ${vistas.length}`);
      }
    }
  } finally {
    await app.close().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('\n❌ Falhou:', e?.response?.data ?? e?.message ?? e);
    process.exit(1);
  });
