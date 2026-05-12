/**
 * Direct-HTTP variant of test-nfe-manifestacao.ts (no browser).
 *
 * Calls the Portal de Manifestação ASP.NET WebForm directly with
 * mTLS + cookie management + __VIEWSTATE/__EVENTVALIDATION carry-over.
 * ~170 MB lighter and ~2s faster than the Playwright version, but
 * brittle: any HTML/PostBack-token change at SEFAZ breaks it.
 *
 * Usage:
 *   npx tsx scripts/test-nfe-manifestacao-http.ts
 *   npx tsx scripts/test-nfe-manifestacao-http.ts --save
 *
 * Env (api/.env):
 *   NFSE_CNPJ
 *   NFSE_CERTIFICATE_PATH
 *   NFSE_CERTIFICATE_PASSWORD
 */

import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const PORTAL_URL =
  'https://www.nfe.fazenda.gov.br/portal/manifestacaoDestinatario.aspx';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

type HttpResponse = {
  status: number;
  headers: NodeJS.Dict<string | string[]>;
  body: string;
};

class CertHttpClient {
  private cookies = new Map<string, string>();

  constructor(private readonly agent: https.Agent) {}

  async request(
    url: string,
    opts: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
      maxRedirects?: number;
    } = {},
  ): Promise<HttpResponse> {
    const maxRedirects = opts.maxRedirects ?? 5;
    let res = await this.requestRaw(url, opts);
    let redirects = 0;
    while (
      [301, 302, 303, 307, 308].includes(res.status) &&
      redirects < maxRedirects
    ) {
      const loc = res.headers['location'] as string | undefined;
      if (!loc) break;
      const next = new URL(loc, url).toString();
      // 302/303 turn POST into GET; 307/308 keep method.
      const isGetAfter = [301, 302, 303].includes(res.status);
      res = await this.requestRaw(next, {
        method: isGetAfter ? 'GET' : opts.method,
        body: isGetAfter ? undefined : opts.body,
        headers: opts.headers,
      });
      redirects += 1;
    }
    return res;
  }

  private requestRaw(
    url: string,
    opts: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<HttpResponse> {
    const u = new URL(url);
    return new Promise((resolve, reject) => {
      const cookieHeader = Array.from(this.cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

      const req = https.request(
        {
          method: opts.method ?? 'GET',
          host: u.host,
          path: u.pathname + u.search,
          agent: this.agent,
          headers: {
            'User-Agent': USER_AGENT,
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate',
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
            ...opts.headers,
          },
        },
        (res) => {
          // Capture Set-Cookie. SEFAZ uses ASP.NET_SessionId + a few others.
          const setCookies = res.headers['set-cookie'] ?? [];
          for (const c of setCookies) {
            const first = c.split(';')[0];
            const eq = first.indexOf('=');
            if (eq > 0) {
              this.cookies.set(first.slice(0, eq), first.slice(eq + 1));
            }
          }

          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            let buf = Buffer.concat(chunks);
            if (res.headers['content-encoding'] === 'gzip') {
              buf = zlib.gunzipSync(buf);
            } else if (res.headers['content-encoding'] === 'deflate') {
              buf = zlib.inflateSync(buf);
            }
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              body: buf.toString('utf-8'),
            });
          });
        },
      );
      req.on('error', reject);
      if (opts.body) req.write(opts.body);
      req.end();
    });
  }
}

type AspState = {
  viewState: string;
  viewStateGen: string;
  eventValidation: string;
};

function extractAspState(html: string): AspState {
  const grab = (id: string) => {
    const re = new RegExp(
      `<input[^>]*name="${id}"[^>]*value="([^"]*)"|<input[^>]*value="([^"]*)"[^>]*name="${id}"`,
    );
    const m = html.match(re);
    return (m?.[1] ?? m?.[2] ?? '').replace(/&amp;/g, '&');
  };
  return {
    viewState: grab('__VIEWSTATE'),
    viewStateGen: grab('__VIEWSTATEGENERATOR'),
    eventValidation: grab('__EVENTVALIDATION'),
  };
}

type NfeRow = {
  dataHora: string;
  chave: string;
  situacaoNfe: string;
  situacaoManifest: string;
};

function parseRows(html: string): NfeRow[] {
  // Anchor on the JS handler — it has all 3 fields we need (chave, idx, dh)
  // in a stable shape. Then walk forward to grab the situação <td>s.
  const anchorRe =
    /atualizarChaveSelecionada\('(\d{44})','(\d+)',\s*'([^']+)'\)/g;

  const rows: NfeRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const chave = m[1];
    const dataHora = m[3];
    // From the anchor position, the next <td> blocks are:
    //   0 = data/hora
    //   1 = chave (with link)
    //   2 = situacaoNfe
    //   3 = situacaoManifest
    //   4 = resultado
    const tail = html.slice(m.index, m.index + 4000);
    const tds = [...tail.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .slice(0, 6)
      .map((x) =>
        x[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
          .replace(/&amp;/g, '&')
          .replace(/&nbsp;/g, ' ')
          .trim(),
      );
    rows.push({
      chave,
      dataHora,
      situacaoNfe: tds[2] ?? '',
      situacaoManifest: tds[3] ?? '',
    });
  }
  return rows;
}

function form(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%20/g, '+')}`,
    )
    .join('&');
}

async function main() {
  const save = process.argv.includes('--save');
  const certPath = process.env.NFSE_CERTIFICATE_PATH;
  const certPassword = process.env.NFSE_CERTIFICATE_PASSWORD;
  const cnpj = process.env.NFSE_CNPJ?.replace(/\D/g, '');

  if (!certPath || !certPassword || !cnpj) {
    throw new Error(
      'Missing env: NFSE_CNPJ, NFSE_CERTIFICATE_PATH, NFSE_CERTIFICATE_PASSWORD',
    );
  }

  const resolvedCertPath = path.isAbsolute(certPath)
    ? certPath
    : path.resolve(__dirname, '..', certPath);

  const agent = new https.Agent({
    pfx: fs.readFileSync(resolvedCertPath),
    passphrase: certPassword,
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
  });
  const client = new CertHttpClient(agent);

  console.log(`CNPJ:  ${cnpj}`);
  console.log(`Cert:  ${resolvedCertPath}`);
  console.log(`URL:   ${PORTAL_URL}`);
  console.log('---');

  const saveDir = path.resolve(__dirname, '../files/manifest-http-test');
  if (save) fs.mkdirSync(saveDir, { recursive: true });

  // Step 1: GET initial page — establishes session cookie + grabs viewstate.
  console.log('[1/3] GET initial page...');
  const initial = await client.request(PORTAL_URL);
  if (save) fs.writeFileSync(path.join(saveDir, '1-initial.html'), initial.body);
  let state = extractAspState(initial.body);
  if (!state.viewState) {
    throw new Error('Could not extract __VIEWSTATE from initial page');
  }

  // Step 2: PostBack — toggle to "Não tenho a Chave de Acesso".
  // ASP.NET re-renders the form with CNPJ inputs + Pesquisar button.
  console.log('[2/3] POST radio toggle (rbtSemChave)...');
  const togglePayload = form({
    __EVENTTARGET: 'ctl00$ContentPlaceHolder1$rbtSemChave',
    __EVENTARGUMENT: '',
    __LASTFOCUS: '',
    __VIEWSTATE: state.viewState,
    __VIEWSTATEGENERATOR: state.viewStateGen,
    __EVENTVALIDATION: state.eventValidation,
    'ctl00$ContentPlaceHolder1$Escolha': 'rbtSemChave',
    'ctl00$ContentPlaceHolder1$txtChaveAcesso': '',
    'ctl00$ContentPlaceHolder1$hdfChaveAutenticacao': '',
    'ctl00$ContentPlaceHolder1$hdfChaveSelecionada': '',
    'ctl00$ContentPlaceHolder1$hdfDataAutorizacao': '',
    'ctl00$ContentPlaceHolder1$hdfDocumentoAssinado': '',
    'ctl00$ContentPlaceHolder1$hdfLinhaSelecionada': '',
    'ctl00$ContentPlaceHolder1$hdfStatusAssinatura': '',
    'ctl00$ContentPlaceHolder1$hdfThumbprint': '',
  });
  const toggle = await client.request(PORTAL_URL, {
    method: 'POST',
    body: togglePayload,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://www.nfe.fazenda.gov.br',
      Referer: PORTAL_URL,
    },
  });
  if (save) fs.writeFileSync(path.join(saveDir, '2-toggle.html'), toggle.body);
  state = extractAspState(toggle.body);

  // Step 3: POST search — fires btnPesquisar with CNPJ + filters.
  console.log('[3/3] POST search (btnPesquisar)...');
  const cnpjBase = cnpj.slice(0, 8);
  const cnpjFinal = cnpj.slice(8);
  const searchPayload = form({
    __EVENTTARGET: '',
    __EVENTARGUMENT: '',
    __LASTFOCUS: '',
    __VIEWSTATE: state.viewState,
    __VIEWSTATEGENERATOR: state.viewStateGen,
    __EVENTVALIDATION: state.eventValidation,
    'ctl00$ContentPlaceHolder1$Escolha': 'rbtSemChave',
    'ctl00$ContentPlaceHolder1$iptCNPJBase': cnpjBase,
    'ctl00$ContentPlaceHolder1$iptCNPJ': cnpjFinal,
    'ctl00$ContentPlaceHolder1$ddlOpcaoPesquisa': 'Todas as NF-e',
    'ctl00$ContentPlaceHolder1$ddlEmissor': 'Todos os emitentes',
    'ctl00$ContentPlaceHolder1$btnPesquisar': 'Pesquisar',
    'ctl00$ContentPlaceHolder1$hdfChaveAutenticacao': '',
    'ctl00$ContentPlaceHolder1$hdfChaveSelecionada': '',
    'ctl00$ContentPlaceHolder1$hdfDataAutorizacao': '',
    'ctl00$ContentPlaceHolder1$hdfDocumentoAssinado': '',
    'ctl00$ContentPlaceHolder1$hdfLinhaSelecionada': '',
    'ctl00$ContentPlaceHolder1$hdfStatusAssinatura': '',
    'ctl00$ContentPlaceHolder1$hdfThumbprint': '',
  });
  const search = await client.request(PORTAL_URL, {
    method: 'POST',
    body: searchPayload,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://www.nfe.fazenda.gov.br',
      Referer: PORTAL_URL,
    },
  });
  if (save) fs.writeFileSync(path.join(saveDir, '3-search.html'), search.body);

  const rows = parseRows(search.body);

  console.log('---');
  console.log(`Found ${rows.length} NFe in the last 15 days`);
  for (const r of rows) {
    console.log(
      `${r.dataHora.padEnd(20)} ${r.chave}  ${r.situacaoNfe.padEnd(12)} ${r.situacaoManifest}`,
    );
  }

  if (save) {
    fs.writeFileSync(
      path.join(saveDir, 'nfes.json'),
      JSON.stringify(rows, null, 2),
    );
    console.log(`Saved to ${saveDir}/`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
