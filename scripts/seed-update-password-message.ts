/**
 * Seeds one ACTIVE, published Message asking the new mobile-app users
 * (PRODUCTION, WAREHOUSE and MAINTENANCE sectors) to update their password
 * for security.
 *
 * Author (createdById): Kennedy Campos (support).
 * Audience: every ACTIVE user whose sector privilege is PRODUCTION, WAREHOUSE
 * or MAINTENANCE.
 *
 * Idempotent: removes any prior copy of this message (by title) before
 * recreating it with fresh targets.
 *
 * Run:  npx tsx scripts/seed-update-password-message.ts
 */
import { PrismaClient, SectorPrivileges } from "@prisma/client";

const prisma = new PrismaClient();

const KENNEDY_ID = "41fcb3fe-e1b6-43e9-bd72-41c072154100";
const SUPPORT_NAME = "Kennedy Campos";
const TITLE = "🔒 Atualize a sua senha de acesso";

// Fixed created/published timestamp: 2026-06-29 23:08 (BRT, UTC-3). The message
// stays dated to this moment regardless of when the seed is actually run.
const SEED_DATE = new Date("2026-06-29T23:08:00-03:00");

const TARGET_PRIVILEGES: SectorPrivileges[] = [
  SectorPrivileges.PRODUCTION,
  SectorPrivileges.WAREHOUSE,
  SectorPrivileges.MAINTENANCE,
];

// --- block builders (editor/DB format: `{ blocks: [...] }`) ----------------
let blockSeq = 0;
const id = () => `block-pwd-${++blockSeq}`;

const headerLogo = () => ({ id: id(), type: "decorator" as const, variant: "header-logo" as const });
const footerWave = () => ({
  id: id(),
  type: "decorator" as const,
  variant: "footer-wave-dark" as const,
});
const heading1 = (content: string) => ({
  id: id(),
  type: "heading1" as const,
  content,
  fontSize: "2xl" as const,
  fontWeight: "bold" as const,
});
const heading2 = (content: string) => ({
  id: id(),
  type: "heading2" as const,
  content,
  fontSize: "lg" as const,
  fontWeight: "semibold" as const,
});
const paragraph = (content: string) => ({ id: id(), type: "paragraph" as const, content });
const quote = (content: string) => ({ id: id(), type: "quote" as const, content });
const list = (items: string[], ordered = false) => ({
  id: id(),
  type: "list" as const,
  items,
  ordered,
});
const divider = () => ({ id: id(), type: "divider" as const });
const spacer = () => ({ id: id(), type: "spacer" as const, height: "sm" as const });

const blocks = [
  headerLogo(),
  heading1("Atualize a sua senha de acesso 🔒"),
  paragraph(
    "Seja bem-vindo(a) ao aplicativo da Ankaa! Por **segurança**, pedimos que você **troque a sua senha** logo no primeiro acesso, definindo uma senha pessoal que só você conheça.",
  ),

  heading2("📱 Como alterar a sua senha"),
  list(
    [
      "Abra o seu **Perfil** no aplicativo",
      "Vá até a seção **Segurança**",
      "Informe a **senha atual**, digite a **nova senha** e **confirme** a nova senha",
      "Toque em **Alterar Senha** para salvar",
    ],
    true,
  ),

  heading2("💡 Dicas para uma boa senha"),
  list([
    "Use uma senha que você **consiga lembrar**, mas que **outras pessoas não consigam adivinhar**",
    "Evite dados óbvios, como datas de nascimento ou sequências (1234)",
    "**Não compartilhe** a sua senha com ninguém",
  ]),

  divider(),
  heading2("📨 Precisa de ajuda?"),
  quote(
    `Ficou com alguma dúvida ou teve algum problema para alterar a senha? Fale com o suporte: ${SUPPORT_NAME}.`,
  ),
  spacer(),
  footerWave(),
];

async function main() {
  const creator = await prisma.user.findUnique({
    where: { id: KENNEDY_ID },
    select: { id: true, name: true },
  });
  if (!creator) throw new Error(`Creator (Kennedy) not found: ${KENNEDY_ID}`);

  const recipients = await prisma.user.findMany({
    where: {
      currentContractStatus: "ACTIVE",
      sector: { privileges: { in: TARGET_PRIVILEGES } },
    },
    select: { id: true, name: true, sector: { select: { privileges: true } } },
  });

  // Clean any previous run's copy (cascades to targets/views).
  await prisma.message.deleteMany({ where: { title: TITLE } });

  if (recipients.length === 0) {
    throw new Error(`No active users found in sectors: ${TARGET_PRIVILEGES.join(", ")}.`);
  }

  const message = await prisma.message.create({
    data: {
      title: TITLE,
      content: { blocks },
      status: "ACTIVE",
      createdAt: SEED_DATE,
      publishedAt: SEED_DATE,
      createdById: creator.id,
      isDismissible: true,
      requiresView: false,
      targets: { create: recipients.map((u) => ({ userId: u.id })) },
    },
    select: { id: true, title: true },
  });

  console.log(`OK "${message.title}" (${message.id}) → ${recipients.length} user(s)`);
  for (const u of recipients) console.log(`  - ${u.name} [${u.sector?.privileges}]`);
  console.log(`\nCreated by ${creator.name} (${creator.id}).`);
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
