import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const BASE = process.env.SECULLUM_BASE_URL!;
const DB = process.env.SECULLUM_DATABASE_ID!;
const prisma = new PrismaClient();

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Mirror getBonusPeriodStart/End for May 2026 — 26th of prior month to 25th of target month
function getBonusPeriodStart(year: number, month: number): Date {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return new Date(prevYear, prevMonth - 1, 26);
}
function getBonusPeriodEnd(year: number, month: number): Date {
  return new Date(year, month - 1, 25);
}

async function main() {
  const tok = await prisma.secullumToken.findUnique({ where: { identifier: 'default' } });
  if (!tok) throw new Error('no token');
  const headers = { Authorization: `Bearer ${tok.accessToken}`, secullumbancoselecionado: DB };

  const year = 2026, month = 5;
  const start = getBonusPeriodStart(year, month);
  const end = getBonusPeriodEnd(year, month);
  const startStr = fmt(start);
  const endStr = fmt(end);
  console.log(`Period: ${startStr} -> ${endStr}`);

  // EXACTLY mirror computeLiveBonusesForPeriod's user query
  const users = await prisma.user.findMany({
    where: {
      status: 'EFFECTED' as any,
      position: { bonifiable: true },
      secullumEmployeeId: { not: null },
    },
    select: {
      id: true, name: true, performanceLevel: true,
      cpf: true, pis: true, payrollNumber: true, secullumEmployeeId: true,
    },
  });
  console.log(`\nLoaded ${users.length} bonifiable users with secullumEmployeeId set.`);
  for (const u of users) {
    console.log(`  ${u.name.padEnd(40)} secId=${u.secullumEmployeeId}  pId=${u.payrollNumber}  cpf=${u.cpf?.slice(0,4)}...`);
  }

  // Probe employees endpoint (analyzeAllUsers calls this for availability)
  console.log('\n=== Probe: GET /Funcionarios ===');
  try {
    const r = await axios.get(`${BASE}/Funcionarios`, { headers, timeout: 20000 });
    const data = Array.isArray(r.data) ? r.data : r.data?.data || [];
    console.log(`  ${data.length} funcionarios returned (HTTP ${r.status})`);
  } catch (e: any) {
    console.error('  FAILED:', e?.response?.status, e?.message);
  }

  // For each user, hit Batidas + Calculos like analyzeUser does
  console.log('\n=== Per-user fetch ===');
  for (const u of users) {
    const empId = u.secullumEmployeeId!;
    let batidasCount = -1, batidasErr = '';
    let calcKeys = '', calcErr = '';
    let faltas: string | null = null, atrasos: string | null = null;

    try {
      const r = await axios.get(`${BASE}/Batidas/${empId}/${startStr}/${endStr}`, { headers, timeout: 20000 });
      const data = Array.isArray(r.data) ? r.data : (r.data?.lista || r.data?.data || []);
      batidasCount = data.length;
    } catch (e: any) {
      batidasErr = `${e?.response?.status} ${e?.message}`;
    }

    try {
      const r = await axios.get(`${BASE}/Calculos/${empId}/${startStr}/${endStr}`, { headers, timeout: 20000 });
      const totais = r.data?.Totais ?? r.data?.totais ?? {};
      faltas = totais.Faltas ?? totais.faltas ?? null;
      atrasos = totais.Atrasos ?? totais.atrasos ?? null;
      calcKeys = Object.keys(totais).slice(0, 8).join(',');
    } catch (e: any) {
      calcErr = `${e?.response?.status} ${e?.message}`;
    }

    console.log(`  ${u.name.padEnd(40)} sec=${empId} batidas=${batidasCount}${batidasErr ? ' ERR:'+batidasErr : ''}  Faltas=${faltas}  Atrasos=${atrasos}${calcErr ? ' calcERR:'+calcErr : ''}`);
  }
}
main().catch(e => { console.error('FATAL', e); process.exit(1); }).finally(() => prisma.$disconnect());
