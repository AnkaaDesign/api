/**
 * Valida o ciclo EMITIR → CONSULTAR → CANCELAR contra a SEFIN, em produção
 * restrita, sem tocar em nenhum dado do sistema.
 *
 * Por que existe: o caminho de cancelamento foi escrito a partir do manual, não
 * de uma chamada real. Duas coisas nunca foram confirmadas contra o servidor —
 * o nome do campo do corpo (`pedidoRegistroEventoXmlGZipB64`) e a ordem dos
 * filhos de `infPedReg`. Descobrir que estão errados no dia em que for preciso
 * cancelar uma nota de verdade é o pior momento possível.
 *
 * Emite uma nota NOVA em homologação (numeração própria, sem validade fiscal),
 * consulta, cancela e mostra as respostas CRUAS de cada etapa. Nada é gravado
 * no banco.
 *
 * Rodar: npm run probe:painter-nfse-cancel
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { FiscalCertificateService } from '../modules/integrations/nfse/painter/fiscal-certificate.service';
import { DpsSignerService } from '../modules/integrations/nfse/painter/dps.signer';
import {
  CANCEL_REASON,
  buildCancelEventXml,
  buildDpsXml,
} from '../modules/integrations/nfse/painter/dps.builder';
import { buildCompanyTomador } from '../modules/integrations/nfse/painter/painter-nfse.service';
import axios from 'axios';
import { gzipSync, gunzipSync } from 'node:zlib';

/** Sempre produção restrita: este script emite e cancela de verdade. */
const BASE = 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional';
const AMBIENTE = 2 as const;
const COMPANY_MUNICIPALITY_IBGE = '4109807';

function show(label: string, status: number, body: unknown): void {
  console.log(`\n  ${label} → HTTP ${status}`);
  const text =
    typeof body === 'string'
      ? body
      : JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1);
  console.log(`  ${String(text).slice(0, 1200)}`);
}

async function main() {
  // Número alto e derivado do relógio para não colidir com o que já foi emitido
  // em homologação nas execuções anteriores.
  const nDps = BigInt(process.env.PROBE_NDPS ?? String(9000 + (Date.now() % 900)));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService, { strict: false });
    const certificates = app.get(FiscalCertificateService, { strict: false });
    const signer = app.get(DpsSignerService, { strict: false });

    const profile = await prisma.fiscalEmitterProfile.findFirstOrThrow();
    const cert = await certificates.getActive(profile.id);
    if (!cert) throw new Error('Emitente sem certificado ativo.');
    const { material, agent } = await certificates.getSigningContext(cert.id);

    const http = axios.create({
      baseURL: BASE,
      timeout: 60_000,
      httpsAgent: agent,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      validateStatus: () => true,
    });

    console.log('\n═══ CICLO DE CANCELAMENTO — PRODUÇÃO RESTRITA ═══');
    console.log(`  Emitente: ${profile.corporateName} (${profile.cnpj})`);
    console.log(`  Série ${profile.serie} / nDPS ${nDps}`);

    // ── 1. Emitir ───────────────────────────────────────────────────────────
    const built = buildDpsXml({
      ambiente: AMBIENTE,
      emitidoEm: new Date(),
      competencia: new Date(),
      serie: profile.serie,
      nDps,
      emitente: {
        cnpj: profile.cnpj,
        inscricaoMunicipal: profile.municipalRegistration,
        municipioIbge: profile.municipalityIbgeCode,
        opSimpNac: profile.opSimpNac,
        regEspTrib: profile.regEspTrib,
      },
      tomador: buildCompanyTomador(),
      servico: {
        municipioPrestacaoIbge: COMPANY_MUNICIPALITY_IBGE,
        cTribNac: profile.cTribNac,
        cTribMun: profile.cTribMun,
        descricao: 'Teste de ciclo de cancelamento — sem validade fiscal',
      },
      valorServico: 1,
    });

    const { packed } = signer.signAndPack(built.xml, material, 'infDPS');
    const emitir = await http.post('/nfse', { dpsXmlGZipB64: packed });
    show('1. EMITIR  POST /nfse', emitir.status, emitir.data);

    const chave = String(emitir.data?.chaveAcesso ?? '');
    if (!chave) {
      console.log('\n  ❌ Sem chave de acesso — o ciclo para aqui.\n');
      return;
    }

    // ── 2. Consultar ────────────────────────────────────────────────────────
    const consultar = await http.get(`/nfse/${encodeURIComponent(chave)}`);
    show(
      '2. CONSULTAR  GET /nfse/{chave}',
      consultar.status,
      consultar.data?.nfseXmlGZipB64
        ? { chaveAcesso: consultar.data.chaveAcesso, nfseXml: '(gzip+base64 recebido)' }
        : consultar.data,
    );

    // ── 3. Cancelar ─────────────────────────────────────────────────────────
    const evento = buildCancelEventXml({
      ambiente: AMBIENTE,
      chaveAcesso: chave,
      cnpjAutor: profile.cnpj,
      ocorridoEm: new Date(),
      descricao: 'Cancelamento de NFS-e',
      motivoCodigo: CANCEL_REASON.ERRO_NA_EMISSAO,
      motivo: 'Nota emitida em ambiente de teste para validar o fluxo de cancelamento.',
    });
    const packedEvento = signer.signAndPack(evento.xml, material, 'infPedReg').packed;

    console.log('\n  --- XML do evento (assinado) ---');
    console.log(`  ${signer.sign(evento.xml, material, 'infPedReg').slice(0, 700)}...`);

    // O nome do campo é a incógnita: tentamos os dois candidatos da documentação
    // e reportamos qual o servidor aceita.
    let eventoXmlGZipB64: string | null = null;
    for (const campo of ['pedidoRegistroEventoXmlGZipB64', 'pedRegEventoXmlGZipB64']) {
      const cancelar = await http.post(`/nfse/${encodeURIComponent(chave)}/eventos`, {
        [campo]: packedEvento,
      });
      show(`3. CANCELAR  POST /nfse/{chave}/eventos  (campo "${campo}")`, cancelar.status, cancelar.data);
      if (cancelar.status === 200 || cancelar.status === 201) {
        console.log(`\n  ✅ Campo aceito: "${campo}"`);
        eventoXmlGZipB64 = cancelar.data?.eventoXmlGZipB64 ?? null;
        break;
      }
    }

    // ── 4. Conferir a situação depois do cancelamento ───────────────────────
    const depois = await http.get(`/nfse/${encodeURIComponent(chave)}`);
    let cStat: string | null = null;
    if (depois.data?.nfseXmlGZipB64) {
      const xml = gunzipSync(Buffer.from(depois.data.nfseXmlGZipB64, 'base64')).toString('utf-8');
      cStat = xml.match(/<cStat>([^<]+)</)?.[1] ?? null;
    }
    console.log(`\n  4. SITUAÇÃO APÓS CANCELAMENTO → cStat = ${cStat ?? 'não identificado'}`);
    console.log('     (101 = cancelada)');

    // A consulta da NFS-e continua devolvendo o documento original (cStat 107) —
    // o cancelamento é um EVENTO à parte, não uma alteração da nota. A prova de
    // que foi registrado é o evento devolvido pelo próprio POST, decodificado
    // abaixo. (GET /nfse/{chave}/eventos responde 405: a consulta exige o tipo
    // do evento no caminho.)
    if (eventoXmlGZipB64) {
      const eventoXml = gunzipSync(Buffer.from(eventoXmlGZipB64, 'base64')).toString('utf-8');
      console.log('\n  5. EVENTO REGISTRADO (decodificado da resposta do POST):');
      console.log(`     Id ......... ${eventoXml.match(/Id="([^"]+)"/)?.[1] ?? '?'}`);
      console.log(`     tpEvento ... ${eventoXml.match(/<tpEvento>([^<]+)</)?.[1] ?? '?'}`);
      console.log(`     nSeqEvento . ${eventoXml.match(/<nSeqEvento>([^<]+)</)?.[1] ?? '?'}`);
      console.log(`     dhProc ..... ${eventoXml.match(/<dhProc>([^<]+)</)?.[1] ?? '?'}`);
    }

    console.log(`\n  Chave usada: ${chave}\n`);
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
