import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import axios from 'axios';

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.findFirst({
    where: { sector: { privileges: { in: ['ADMIN'] as any } } },
    select: { id: true, email: true, phone: true, name: true, sector: { select: { privileges: true } } },
  });
  if (!admin) throw new Error('no admin user');
  const token = jwt.sign(
    { sub: admin.id, email: admin.email, phone: admin.phone, role: (admin.sector as any)?.privileges },
    process.env.JWT_SECRET!,
    { expiresIn: '10m' },
  );
  console.log('Using admin:', admin.name, (admin.sector as any)?.privileges);

  for (const path of ['/integrations/secullum/time-entries/by-day', '/secullum/time-entries/by-day']) {
    const url = `http://127.0.0.1:3030${path}?date=2026-06-02`;
    try {
      const r = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 60000,
      });
      const rows = r.data?.data || [];
      console.log(`\n${path} → HTTP ${r.status}, success=${r.data?.success}, rows=${rows.length}`);
      const davyd = rows.find((x: any) => (x?.user?.name || '').includes('Davyd'));
      if (davyd) {
        console.log('Davyd entry keys:', Object.keys(davyd.entry || {}).join(', '));
        console.log('Davyd Normais/Faltas:', JSON.stringify({
          Normais: davyd.entry?.Normais, Faltas: davyd.entry?.Faltas, Atraso: davyd.entry?.Atraso,
          Entrada1: davyd.entry?.Entrada1,
        }));
      } else {
        console.log('Davyd not in rows. sample names:', rows.slice(0, 3).map((x: any) => x?.user?.name));
      }
      break; // first working path wins
    } catch (e: any) {
      console.log(`${path} → HTTP ${e?.response?.status || 'ERR'} ${e?.message}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
