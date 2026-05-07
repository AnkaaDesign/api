/**
 * Standalone backfill: User.secullumEmployeeId by matching against /Funcionarios.
 * Bypasses NestJS bootstrap (which currently fails on DeepLinkService DI).
 *
 *   pnpm exec tsx scripts/secullum/backfill-employee-ids.ts
 *
 * Idempotent. Reuses the cached SecullumToken row in the DB; only re-authenticates
 * if expired. Conflicts (existing FK differs from current match) are logged, not
 * overwritten.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const BASE_URL = process.env.SECULLUM_BASE_URL || 'https://pontoweb.secullum.com.br';
const AUTH_URL = process.env.SECULLUM_AUTH_URL || 'https://autenticador.secullum.com.br/Token';
const EMAIL = process.env.SECULLUM_EMAIL || '';
const PASSWORD = process.env.SECULLUM_PASSWORD || '';
const DATABASE_ID = process.env.SECULLUM_DATABASE_ID || '4c8681f2e79a4b7ab58cc94503106736';
const CLIENT_ID = process.env.SECULLUM_CLIENT_ID || '3';
const CLIENT_SECRET = process.env.SECULLUM_CLIENT_SECRET || '';

const prisma = new PrismaClient();

async function authenticate(): Promise<string> {
  if (!EMAIL || !PASSWORD) throw new Error('SECULLUM_EMAIL/SECULLUM_PASSWORD not set in env');
  const formData = new URLSearchParams();
  formData.append('grant_type', 'password');
  formData.append('username', EMAIL);
  formData.append('password', PASSWORD);
  formData.append('client_id', CLIENT_ID);
  formData.append('scope', 'api');
  if (CLIENT_SECRET) formData.append('client_secret', CLIENT_SECRET);

  const resp = await axios.post(AUTH_URL, formData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  });
  if (!resp.data?.access_token) throw new Error('No access_token in Secullum auth response');

  const expiresAt = new Date(Date.now() + (resp.data.expires_in ?? 3600) * 1000);
  await prisma.secullumToken.upsert({
    where: { identifier: 'default' },
    update: {
      accessToken: resp.data.access_token,
      refreshToken: resp.data.refresh_token,
      tokenType: resp.data.token_type ?? 'Bearer',
      expiresIn: resp.data.expires_in ?? 3600,
      expiresAt,
      scope: resp.data.scope ?? null,
    },
    create: {
      identifier: 'default',
      accessToken: resp.data.access_token,
      refreshToken: resp.data.refresh_token,
      tokenType: resp.data.token_type ?? 'Bearer',
      expiresIn: resp.data.expires_in ?? 3600,
      expiresAt,
      scope: resp.data.scope ?? null,
    },
  });
  return resp.data.access_token;
}

async function getValidToken(): Promise<string> {
  const stored = await prisma.secullumToken.findUnique({ where: { identifier: 'default' } });
  if (stored && stored.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return stored.accessToken;
  }
  console.log('[secullum] no valid cached token, authenticating…');
  return authenticate();
}

const normalizeCpf = (cpf?: string | null) => (cpf || '').replace(/[.-]/g, '');

async function main() {
  const token = await getValidToken();
  const empResp = await axios.get(`${BASE_URL}/Funcionarios`, {
    headers: {
      Authorization: `Bearer ${token}`,
      secullumbancoselecionado: DATABASE_ID,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
  const employees: Array<{
    Id: number;
    Nome?: string;
    Cpf?: string;
    NumeroPis?: string;
    NumeroFolha?: string;
  }> = Array.isArray(empResp.data) ? empResp.data : empResp.data?.data || [];
  console.log(`[secullum] fetched ${employees.length} Funcionarios`);

  const users = await prisma.user.findMany({
    select: { id: true, name: true, cpf: true, pis: true, payrollNumber: true, secullumEmployeeId: true },
  });
  console.log(`[secullum] scanning ${users.length} Ankaa users`);

  let newlyLinked = 0;
  let alreadyLinked = 0;
  let conflicts = 0;
  let unmatched = 0;
  const conflictDetails: { ankaaUserId: string; name: string; oldId: number; newId: number }[] = [];
  const unmatchedNames: string[] = [];

  for (const u of users) {
    const userCpf = normalizeCpf(u.cpf);
    const userPis = u.pis || '';
    const userPayroll = u.payrollNumber != null ? String(u.payrollNumber) : '';

    const match = employees.find(e => {
      const eCpf = normalizeCpf(e.Cpf);
      const ePis = e.NumeroPis || '';
      const ePayroll = e.NumeroFolha || '';
      return (
        (userCpf && eCpf === userCpf) ||
        (userPis && ePis === userPis) ||
        (userPayroll && ePayroll === userPayroll)
      );
    });

    if (!match) {
      unmatched++;
      unmatchedNames.push(`${u.name} (id=${u.id.slice(0, 8)})`);
      continue;
    }
    const matchId = Number(match.Id);
    if (u.secullumEmployeeId === matchId) {
      alreadyLinked++;
      continue;
    }
    if (u.secullumEmployeeId != null && u.secullumEmployeeId !== matchId) {
      conflicts++;
      conflictDetails.push({ ankaaUserId: u.id, name: u.name, oldId: u.secullumEmployeeId, newId: matchId });
      console.warn(
        `[secullum] CONFLICT user=${u.name} oldId=${u.secullumEmployeeId} newId=${matchId} — keeping old`,
      );
      continue;
    }
    try {
      await prisma.user.update({
        where: { id: u.id },
        data: { secullumEmployeeId: matchId },
      });
      newlyLinked++;
      console.log(`[secullum] linked ${u.name} → Funcionario #${matchId}`);
    } catch (err: any) {
      conflicts++;
      console.warn(
        `[secullum] update failed for ${u.name} → ${matchId}: ${err?.code ?? err?.message ?? err}`,
      );
    }
  }

  console.log('\n[secullum] backfill complete:');
  console.log(`  total Ankaa users:        ${users.length}`);
  console.log(`  total Secullum employees: ${employees.length}`);
  console.log(`  newly linked:             ${newlyLinked}`);
  console.log(`  already linked:           ${alreadyLinked}`);
  console.log(`  conflicts (skipped):      ${conflicts}`);
  console.log(`  unmatched:                ${unmatched}`);
  if (unmatchedNames.length && unmatchedNames.length <= 60) {
    console.log('\n[secullum] unmatched users:');
    for (const n of unmatchedNames) console.log(`  - ${n}`);
  }
}

main()
  .catch(err => {
    console.error('[secullum] backfill failed:', err?.response?.data ?? err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
