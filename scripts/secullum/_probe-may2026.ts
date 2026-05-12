import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const BASE = process.env.SECULLUM_BASE_URL!;
const DB = process.env.SECULLUM_DATABASE_ID!;
const prisma = new PrismaClient();

async function main() {
  const tok = await prisma.secullumToken.findUnique({ where: { identifier: 'default' } });
  if (!tok) throw new Error('no token');
  const headers = { Authorization: `Bearer ${tok.accessToken}`, secullumbancoselecionado: DB };

  console.log('\n=== Batidas /Batidas/2/2026-04-26/2026-05-25 ===');
  try {
    const r = await axios.get(`${BASE}/Batidas/2/2026-04-26/2026-05-25`, { headers, timeout: 20000 });
    const data = Array.isArray(r.data) ? r.data : (r.data?.lista || r.data?.data || []);
    console.log(`Got ${data.length} entries.`);
    if (data.length > 0) console.log('First 2:', JSON.stringify(data.slice(0, 2), null, 2));
  } catch (e: any) {
    console.error('Batidas failed:', e?.response?.status, JSON.stringify(e?.response?.data)?.slice(0, 200) || e?.message);
  }

  console.log('\n=== Calculos /Calculos/2/2026-04-26/2026-05-25 ===');
  try {
    const r = await axios.get(`${BASE}/Calculos/2/2026-04-26/2026-05-25`, { headers, timeout: 20000 });
    console.log('Sample:', JSON.stringify(r.data, null, 2).slice(0, 1500));
  } catch (e: any) {
    console.error('Calculos failed:', e?.response?.status, JSON.stringify(e?.response?.data)?.slice(0, 200) || e?.message);
  }

  console.log('\n=== Funcionarios count ===');
  try {
    const r = await axios.get(`${BASE}/Funcionarios`, { headers, timeout: 20000 });
    const data = Array.isArray(r.data) ? r.data : r.data?.data || [];
    console.log(`Total funcionarios: ${data.length}`);
    const matheus = data.find((e: any) => (e.Nome || '').toLowerCase().includes('matheus'));
    const fabio = data.find((e: any) => (e.Nome || '').toLowerCase().includes('fábio martins'));
    console.log('Matheus matches:', JSON.stringify(matheus));
    console.log('Fábio Martins match:', JSON.stringify(fabio));
  } catch (e: any) {
    console.error('Funcionarios failed:', e?.response?.status);
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
