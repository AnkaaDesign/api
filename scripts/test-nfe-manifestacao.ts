/**
 * Standalone test for Portal de Manifestação do Destinatário
 * (https://www.nfe.fazenda.gov.br/portal/manifestacaoDestinatario.aspx)
 *
 * Uses Playwright with A1 cert to log in and scrape the table of NFe
 * issued against our CNPJ in the last 15 days. Independent of the DFe
 * NSU pointer — does NOT race with whoever is pulling DFe.
 *
 * Usage:
 *   npx tsx scripts/test-nfe-manifestacao.ts          # headless
 *   npx tsx scripts/test-nfe-manifestacao.ts --headful # show browser
 *   npx tsx scripts/test-nfe-manifestacao.ts --save    # also dump HTML/JSON
 *
 * Env (api/.env):
 *   NFSE_CNPJ
 *   NFSE_CERTIFICATE_PATH
 *   NFSE_CERTIFICATE_PASSWORD
 */

import { chromium, type Page } from 'playwright';
import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const PORTAL_URL =
  'https://www.nfe.fazenda.gov.br/portal/manifestacaoDestinatario.aspx';

type Args = { headful: boolean; save: boolean };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  return {
    headful: argv.includes('--headful'),
    save: argv.includes('--save'),
  };
}

type NfeRow = {
  dataHora: string;
  chave: string;
  situacaoNfe: string;
  situacaoManifest: string;
  resultado: string;
};

async function scrapeTable(page: Page): Promise<NfeRow[]> {
  // Result table rows are anchored on a radio input named "SuppliersGroup"
  // whose value is the 44-digit chave. Columns: [radio, dataHora, chave-link,
  // situacaoNFe, situacaoManifest, resultado].
  return page.$$eval(
    'input[type="radio"][name="SuppliersGroup"]',
    (radios) =>
      radios.map((radio) => {
        const tr = radio.closest('tr')!;
        const cells = Array.from(tr.querySelectorAll('td')).map((td) =>
          (td.textContent ?? '').replace(/\s+/g, ' ').trim(),
        );
        return {
          dataHora: cells[1] ?? '',
          chave: (radio as HTMLInputElement).value ?? '',
          situacaoNfe: cells[3] ?? '',
          situacaoManifest: cells[4] ?? '',
          resultado: cells[5] ?? '',
        };
      }),
  );
}

async function main() {
  const args = parseArgs();
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

  console.log(`CNPJ:       ${cnpj}`);
  console.log(`Cert:       ${resolvedCertPath}`);
  console.log(`Mode:       ${args.headful ? 'headful' : 'headless'}`);
  console.log(`URL:        ${PORTAL_URL}`);
  console.log('---');

  const browser = await chromium.launch({ headless: !args.headful });

  const context = await browser.newContext({
    clientCertificates: [
      {
        origin: 'https://www.nfe.fazenda.gov.br',
        pfxPath: resolvedCertPath,
        passphrase: certPassword,
      },
    ],
    // SEFAZ chain is generally fine, but their TLS sometimes hiccups.
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  console.log('Loading portal...');
  await page.goto(PORTAL_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  if (args.save) {
    fs.mkdirSync(path.resolve(__dirname, '../files/manifest-test'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.resolve(__dirname, '../files/manifest-test/initial.html'),
      await page.content(),
    );
  }

  // Default radio is "Tenho a Chave de Acesso" (single-NFe lookup).
  // Switch to "Não tenho a Chave de Acesso" — that triggers an ASP.NET
  // PostBack which re-renders the form with CNPJ inputs + filters + Pesquisar.
  console.log('Switching to lista mode...');
  await page.locator('#ctl00_ContentPlaceHolder1_rbtSemChave').check();
  await page.waitForLoadState('networkidle', { timeout: 30_000 });

  if (args.save) {
    fs.writeFileSync(
      path.resolve(__dirname, '../files/manifest-test/lista-form.html'),
      await page.content(),
    );
  }

  console.log('Submitting form...');
  const submitButton = page.locator('#ctl00_ContentPlaceHolder1_btnPesquisar');
  await submitButton.click();

  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  // Give server-side rendering a moment for the result table.
  await page.waitForTimeout(2000);

  if (args.headful) {
    console.log('Headful mode — leaving browser open for 60s for inspection');
    await page.waitForTimeout(60_000);
  }

  if (args.save) {
    fs.writeFileSync(
      path.resolve(__dirname, '../files/manifest-test/result.html'),
      await page.content(),
    );
  }

  const nfes = await scrapeTable(page);

  console.log(`Found ${nfes.length} NFe in the last 15 days`);
  console.log('---');

  const counts = { autorizada: 0, cancelada: 0, ciencia: 0, semManifest: 0 };
  for (const n of nfes) {
    if (/Autorizada/i.test(n.situacaoNfe)) counts.autorizada += 1;
    if (/Cancelada/i.test(n.situacaoNfe)) counts.cancelada += 1;
    if (/Ciência/i.test(n.situacaoManifest)) counts.ciencia += 1;
    if (/Sem Manifest/i.test(n.situacaoManifest)) counts.semManifest += 1;
    console.log(
      `${n.dataHora.padEnd(20)} ${n.chave}  ${n.situacaoNfe.padEnd(12)} ${n.situacaoManifest}`,
    );
  }

  console.log('---');
  console.log(
    `Autorizada=${counts.autorizada}  Cancelada=${counts.cancelada}  Ciência=${counts.ciencia}  SemManifest=${counts.semManifest}`,
  );

  if (args.save) {
    fs.writeFileSync(
      path.resolve(__dirname, '../files/manifest-test/nfes.json'),
      JSON.stringify(nfes, null, 2),
    );
    console.log('Output saved to files/manifest-test/');
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
