/**
 * One-off: create a PRODUCTION-sector test user so the mobile guided tour
 * auto-trigger can be exercised. Idempotent (upsert by email).
 *
 *   Login contact: producao.teste@ankaa.com
 *   Password:      teste123456
 */
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const sector = await prisma.sector.findFirst({
    where: { privileges: "PRODUCTION" },
    orderBy: { name: "asc" },
  });
  if (!sector) throw new Error("No PRODUCTION sector found");

  const password = await bcrypt.hash("teste123456", 10);

  const user = await prisma.user.upsert({
    where: { email: "producao.teste@ankaa.com" },
    update: {
      password,
      verified: true,
      isActive: true,
      sectorId: sector.id,
    },
    create: {
      name: "Produção Teste (Tutorial)",
      email: "producao.teste@ankaa.com",
      phone: "11999990000",
      password,
      verified: true,
      isActive: true,
      sectorId: sector.id,
    },
    select: { id: true, name: true, email: true, phone: true, sectorId: true },
  });

  console.log("OK user:", JSON.stringify(user));
  console.log("Attached to sector:", sector.name, sector.id, sector.privileges);
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
