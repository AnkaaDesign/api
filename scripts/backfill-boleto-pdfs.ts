/**
 * One-time script to backfill PDFs for existing bank slips that have
 * pdfFileId: null but have a valid digitableLine.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-boleto-pdfs.ts [--dry-run|--execute]
 *
 * Requires SICREDI_* env vars to be set (loaded from .env automatically by Prisma).
 */

import { PrismaClient } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const prisma = new PrismaClient();

// ─── Sicredi API helpers (standalone, no NestJS DI) ─────────────────────────

const SICREDI_CONFIG = {
  apiUrl: process.env.SICREDI_API_URL || 'https://api-parceiro.sicredi.com.br',
  xApiKey: process.env.SICREDI_X_API_KEY || '',
  cooperativa: process.env.SICREDI_COOPERATIVA || '',
  posto: process.env.SICREDI_POSTO || '',
  codigoBeneficiario: process.env.SICREDI_CODIGO_BENEFICIARIO || '',
  codigoAcesso: process.env.SICREDI_CODIGO_ACESSO || '',
};

let cachedToken: { accessToken: string; expiresAt: Date } | null = null;

async function authenticate(): Promise<string> {
  const { apiUrl, xApiKey, cooperativa, codigoBeneficiario, codigoAcesso } = SICREDI_CONFIG;
  const username = `${codigoBeneficiario}${cooperativa}`;

  console.log(`[AUTH] Authenticating with Sicredi (username=${username})...`);

  const formData = new URLSearchParams();
  formData.append('grant_type', 'password');
  formData.append('username', username);
  formData.append('password', codigoAcesso);
  formData.append('scope', 'cobranca');

  const response = await axios.post(
    `${apiUrl}/auth/openapi/token`,
    formData.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-api-key': xApiKey,
        context: 'COBRANCA',
      },
      timeout: 10000,
    },
  );

  if (!response.data?.access_token) {
    throw new Error(`Invalid auth response: ${JSON.stringify(response.data)}`);
  }

  const { access_token, expires_in = 300 } = response.data;
  cachedToken = {
    accessToken: access_token,
    expiresAt: new Date(Date.now() + expires_in * 1000),
  };

  console.log(`[AUTH] Authenticated successfully (expires in ${expires_in}s)`);
  return access_token;
}

async function getAccessToken(): Promise<string> {
  // Check DB for stored token first
  const storedToken = await prisma.sicrediToken.findUnique({
    where: { identifier: 'default' },
  });

  if (storedToken) {
    const timeUntilExpiry = storedToken.expiresAt.getTime() - Date.now();
    if (timeUntilExpiry > 60 * 1000) {
      console.log(`[AUTH] Using stored token (expires in ${Math.round(timeUntilExpiry / 1000)}s)`);
      cachedToken = {
        accessToken: storedToken.accessToken,
        expiresAt: storedToken.expiresAt,
      };
      return storedToken.accessToken;
    }
  }

  // Check in-memory cache
  if (cachedToken) {
    const timeUntilExpiry = cachedToken.expiresAt.getTime() - Date.now();
    if (timeUntilExpiry > 60 * 1000) {
      return cachedToken.accessToken;
    }
  }

  return authenticate();
}

function createApiClient(): AxiosInstance {
  const { apiUrl, xApiKey, cooperativa, posto } = SICREDI_CONFIG;

  const client = axios.create({
    baseURL: apiUrl,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });

  client.interceptors.request.use(async (config) => {
    const token = await getAccessToken();
    config.headers.Authorization = `Bearer ${token}`;
    config.headers['x-api-key'] = xApiKey;
    config.headers['cooperativa'] = cooperativa;
    config.headers['posto'] = posto;
    return config;
  });

  // Retry on 401
  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;
        const newToken = await authenticate();
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return client(originalRequest);
      }
      throw error;
    },
  );

  return client;
}

async function downloadBoletoPdf(
  client: AxiosInstance,
  linhaDigitavel: string,
): Promise<Buffer> {
  const response = await client.get('/cobranca/boleto/v1/boletos/pdf', {
    params: { linhaDigitavel },
    responseType: 'arraybuffer',
  });
  return Buffer.from(response.data);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  if (dryRun) {
    console.log('Running in DRY RUN mode. Use --execute to actually download and store PDFs.\n');
  } else {
    console.log('Running in EXECUTE mode. PDFs will be downloaded and stored.\n');
  }

  try {
    // Find all bank slips with ACTIVE status, no PDF, but with a digitableLine
    const bankSlips = await prisma.bankSlip.findMany({
      where: {
        status: 'ACTIVE',
        pdfFileId: null,
        digitableLine: { not: null },
      },
      select: {
        id: true,
        nossoNumero: true,
        digitableLine: true,
        installment: {
          select: {
            id: true,
            invoice: {
              select: {
                customer: {
                  select: { fantasyName: true },
                },
                task: {
                  select: { name: true, serialNumber: true },
                },
              },
            },
          },
        },
      },
    });

    console.log(`Found ${bankSlips.length} bank slip(s) with missing PDFs\n`);

    if (bankSlips.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    // List them
    for (const slip of bankSlips) {
      const customer = slip.installment?.invoice?.customer?.fantasyName || 'N/A';
      const task = slip.installment?.invoice?.task;
      const taskInfo = task ? `${task.name} #${task.serialNumber}` : 'N/A';
      console.log(
        `  - nossoNumero=${slip.nossoNumero}, customer="${customer}", task="${taskInfo}"`,
      );
    }
    console.log();

    if (dryRun) {
      console.log(`[DRY RUN] Would download ${bankSlips.length} PDF(s). Exiting.`);
      return;
    }

    // Set up API client and upload directory
    const apiClient = createApiClient();
    const uploadDir = path.join(process.cwd(), 'uploads', 'boleto');
    await fs.mkdir(uploadDir, { recursive: true });

    let success = 0;
    let errors = 0;

    for (const slip of bankSlips) {
      try {
        console.log(`[${slip.nossoNumero}] Downloading PDF...`);

        const pdfBuffer = await downloadBoletoPdf(apiClient, slip.digitableLine!);
        const filename = `boleto-${slip.nossoNumero}.pdf`;
        const filePath = path.join(uploadDir, filename);

        // Write file to disk
        await fs.writeFile(filePath, pdfBuffer);

        // Create File record
        const file = await prisma.file.create({
          data: {
            filename,
            originalName: filename,
            path: filePath,
            mimetype: 'application/pdf',
            size: pdfBuffer.length,
          },
        });

        // Link to bank slip
        await prisma.bankSlip.update({
          where: { id: slip.id },
          data: { pdfFileId: file.id },
        });

        success++;
        console.log(
          `[${slip.nossoNumero}] OK - saved ${pdfBuffer.length} bytes -> ${filePath} (fileId=${file.id})`,
        );
      } catch (error) {
        errors++;
        const msg = error instanceof Error ? error.message : String(error);
        const details = (error as any)?.response?.data
          ? ` | API response: ${JSON.stringify((error as any).response.data)}`
          : '';
        console.error(`[${slip.nossoNumero}] FAILED - ${msg}${details}`);
      }

      // Small delay to avoid rate-limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(
      `\nDone. Success: ${success}, Errors: ${errors}, Total: ${bankSlips.length}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  prisma.$disconnect();
  process.exit(1);
});
