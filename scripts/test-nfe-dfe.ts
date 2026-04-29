/**
 * Standalone test for SEFAZ NFeDistribuicaoDFe — fetches NFe issued
 * against our company CNPJ (we are the destinatário).
 *
 * Usage:
 *   npx tsx scripts/test-nfe-dfe.ts                 # one page from NSU 0, prod
 *   npx tsx scripts/test-nfe-dfe.ts --all           # paginate to the end
 *   npx tsx scripts/test-nfe-dfe.ts --ultNSU 100    # resume from a given NSU
 *   npx tsx scripts/test-nfe-dfe.ts --ambiente 2    # homologação
 *   npx tsx scripts/test-nfe-dfe.ts --save          # dump XMLs to files/dfe-test/
 *
 * Env (read from api/.env):
 *   NFSE_CNPJ
 *   NFSE_CERTIFICATE_PATH
 *   NFSE_CERTIFICATE_PASSWORD
 */

import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const ENDPOINTS = {
  // SEFAZ Nacional centralizes DFe distribution — same endpoint for any UF.
  1: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  2: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
} as const;

// Paraná. cUFAutor identifies the requester's UF, not the doc's UF.
const CUF_PR = 41;
const SOAP_ACTION =
  'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse';

type Args = {
  all: boolean;
  ultNSU: string;
  ambiente: 1 | 2;
  save: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const ambiente = (Number(get('--ambiente') ?? 1) as 1 | 2) ?? 1;
  return {
    all: argv.includes('--all'),
    ultNSU: (get('--ultNSU') ?? '0').padStart(15, '0'),
    ambiente,
    save: argv.includes('--save'),
  };
}

function buildEnvelope(
  cnpj: string,
  ambiente: 1 | 2,
  ultNSU: string,
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>${ambiente}</tpAmb>
          <cUFAutor>${CUF_PR}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <distNSU>
            <ultNSU>${ultNSU}</ultNSU>
          </distNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}

function postSoap(
  url: string,
  body: string,
  agent: https.Agent,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method: 'POST',
        host: u.host,
        path: u.pathname,
        agent,
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(body).toString(),
          SOAPAction: SOAP_ACTION,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode !== 200) {
            reject(
              new Error(`HTTP ${res.statusCode}: ${text.slice(0, 800)}`),
            );
            return;
          }
          resolve(text);
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

type DocZip = { NSU: string; schema: string; xml: string };

type DistResponse = {
  cStat: string;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  dhResp?: string;
  docs: DocZip[];
};

function parseResponse(soapXml: string): DistResponse {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
  });
  const env = parser.parse(soapXml);
  const ret =
    env?.Envelope?.Body?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult
      ?.retDistDFeInt;
  if (!ret) {
    throw new Error(
      `Could not find retDistDFeInt in response. Raw:\n${soapXml.slice(0, 1500)}`,
    );
  }

  const lote = ret.loteDistDFeInt;
  const rawDocs = lote
    ? Array.isArray(lote.docZip)
      ? lote.docZip
      : [lote.docZip]
    : [];

  const docs: DocZip[] = rawDocs.map((d: any) => ({
    NSU: String(d['@_NSU']),
    schema: String(d['@_schema']),
    xml: zlib
      .gunzipSync(Buffer.from(d['#text'] ?? d, 'base64'))
      .toString('utf-8'),
  }));

  return {
    cStat: String(ret.cStat),
    xMotivo: String(ret.xMotivo),
    ultNSU: String(ret.ultNSU),
    maxNSU: String(ret.maxNSU),
    dhResp: ret.dhResp,
    docs,
  };
}

function summarize(doc: DocZip): {
  type: string;
  chave?: string;
  emit?: string;
  vNF?: string;
  dhEmi?: string;
} {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
  });
  const root = parser.parse(doc.xml);
  // Schemas seen in DFe distribution:
  //   resNFe_v1.01.xsd      → lightweight summary (always sent)
  //   procNFe_v4.00.xsd     → full NFe XML (sent once if recipient confirms / "manifestação do destinatário")
  //   resEvento_v1.01.xsd   → event summary (CCe, cancelamento, ciência, etc.)
  //   procEventoNFe_v1.00   → full event XML
  if (root.resNFe) {
    const r = root.resNFe;
    return {
      type: 'resNFe',
      chave: r.chNFe,
      emit: `${r.xNome} (${r.CNPJ ?? r.CPF})`,
      vNF: r.vNF,
      dhEmi: r.dhEmi,
    };
  }
  if (root.nfeProc) {
    const inf = root.nfeProc.NFe?.infNFe;
    return {
      type: 'procNFe',
      chave: inf?.['@_Id']?.replace(/^NFe/, ''),
      emit: `${inf?.emit?.xNome} (${inf?.emit?.CNPJ ?? inf?.emit?.CPF})`,
      vNF: inf?.total?.ICMSTot?.vNF,
      dhEmi: inf?.ide?.dhEmi,
    };
  }
  if (root.resEvento) {
    return {
      type: `resEvento(${root.resEvento.tpEvento})`,
      chave: root.resEvento.chNFe,
      dhEmi: root.resEvento.dhEvento,
    };
  }
  if (root.procEventoNFe) {
    const ev = root.procEventoNFe.evento?.infEvento;
    return {
      type: `procEvento(${ev?.tpEvento})`,
      chave: ev?.chNFe,
      dhEmi: ev?.dhEvento,
    };
  }
  return { type: `unknown(${doc.schema})` };
}

function loadHttpsAgent(pfxPath: string, password: string): https.Agent {
  if (!fs.existsSync(pfxPath)) {
    throw new Error(`Certificate not found at ${pfxPath}`);
  }
  return new https.Agent({
    pfx: fs.readFileSync(pfxPath),
    passphrase: password,
    // SEFAZ chain is well-known, but TLS sometimes hits version mismatches.
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
  });
}

async function main() {
  const args = parseArgs();
  const cnpj = process.env.NFSE_CNPJ?.replace(/\D/g, '');
  const certPath = process.env.NFSE_CERTIFICATE_PATH;
  const certPassword = process.env.NFSE_CERTIFICATE_PASSWORD;

  if (!cnpj || !certPath || !certPassword) {
    throw new Error(
      'Missing env: NFSE_CNPJ, NFSE_CERTIFICATE_PATH, NFSE_CERTIFICATE_PASSWORD',
    );
  }

  const resolvedCertPath = path.isAbsolute(certPath)
    ? certPath
    : path.resolve(__dirname, '..', certPath);

  const url = ENDPOINTS[args.ambiente];
  const agent = loadHttpsAgent(resolvedCertPath, certPassword);

  console.log(`CNPJ:       ${cnpj}`);
  console.log(`Endpoint:   ${url}`);
  console.log(`Ambiente:   ${args.ambiente === 1 ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'}`);
  console.log(`Start NSU:  ${args.ultNSU}`);
  console.log(`Mode:       ${args.all ? 'paginate to end' : 'single page'}`);
  console.log('---');

  const saveDir = path.resolve(__dirname, '../files/dfe-test');
  if (args.save) {
    fs.mkdirSync(saveDir, { recursive: true });
  }

  let ultNSU = args.ultNSU;
  let pages = 0;
  let totalDocs = 0;
  const counts: Record<string, number> = {};

  while (true) {
    pages += 1;
    const envelope = buildEnvelope(cnpj, args.ambiente, ultNSU);
    const raw = await postSoap(url, envelope, agent);
    const res = parseResponse(raw);

    console.log(
      `Page ${pages} — cStat=${res.cStat} (${res.xMotivo}) | ultNSU=${res.ultNSU} | maxNSU=${res.maxNSU} | docs=${res.docs.length}`,
    );

    for (const doc of res.docs) {
      totalDocs += 1;
      const s = summarize(doc);
      counts[s.type] = (counts[s.type] ?? 0) + 1;
      console.log(
        `  NSU=${doc.NSU.padStart(8, ' ')} ${s.type.padEnd(22, ' ')} ${
          s.chave ?? ''
        } ${s.dhEmi ?? ''} ${s.emit ?? ''} ${s.vNF ? 'R$ ' + s.vNF : ''}`,
      );
      if (args.save) {
        const fname = `${doc.NSU}_${s.type.replace(/[^\w]/g, '_')}.xml`;
        fs.writeFileSync(path.join(saveDir, fname), doc.xml);
      }
    }

    // cStat 137 = no documents found; 138 = documents returned.
    // Anything else is an error/warning we should not loop on.
    if (res.cStat !== '138') break;
    if (!args.all) break;
    if (res.ultNSU === res.maxNSU) break;
    ultNSU = res.ultNSU;
  }

  console.log('---');
  console.log(`Total docs: ${totalDocs}`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  if (args.save) console.log(`XMLs saved to: ${saveDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
