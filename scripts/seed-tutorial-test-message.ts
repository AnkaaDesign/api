/**
 * One-off: seed an ACTIVE, published Message targeted at the PRODUCTION test
 * user so the post-tutorial messages modal has something to display.
 * Flow being verified: login -> tutorial -> finish tutorial -> message modal.
 *
 * Idempotent-ish: removes any prior test message with the same title first.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TITLE = "Bem-vindo(a) à Ankaa! 🎉";

const content = [
  {
    type: "heading",
    level: 1,
    content: [{ text: TITLE }],
  },
  {
    type: "paragraph",
    content: [
      { text: "Parabéns por concluir o tutorial! " },
      { text: "Esta é uma mensagem de teste", styles: ["bold"] },
      {
        text: " exibida logo após o onboarding para validar o fluxo completo: login → tutorial → mensagem.",
      },
    ],
  },
  {
    type: "paragraph",
    content: [
      { text: "Se você está vendo isto, o encadeamento está funcionando corretamente. ✅" },
    ],
  },
];

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: "producao.teste@ankaa.com" },
    select: { id: true, name: true },
  });
  if (!user) throw new Error("Test user producao.teste@ankaa.com not found — run seed-production-test-user.ts first");

  // Clean any previous run's message (cascades to targets/views).
  await prisma.message.deleteMany({ where: { title: TITLE, createdById: user.id } });

  const message = await prisma.message.create({
    data: {
      title: TITLE,
      content,
      status: "ACTIVE",
      publishedAt: new Date(),
      createdById: user.id,
      isDismissible: true,
      requiresView: false,
      targets: {
        create: [{ userId: user.id }],
      },
    },
    select: { id: true, title: true, status: true, publishedAt: true },
  });

  console.log("OK message:", JSON.stringify(message));
  console.log("Targeted user:", user.name, user.id);
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
