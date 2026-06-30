/**
 * Seeds an ACTIVE, published Message announcing the new Table + Detail page
 * migration (datatable / detailpage base systems) to the relevant teams.
 *
 * Audience: every active user whose sector privilege is ADMIN, COMMERCIAL,
 * PRODUCTION_MANAGER (PM) or LOGISTIC. The message appears in the post-login
 * "messages modal" (GET unviewed) until each user views/dismisses it.
 *
 * Content covers:
 *  - what changed (tables + detail pages rebuilt on a shared base)
 *  - the new export / "Compartilhar" workflow (xlsx / pdf / shareable link)
 *  - the pin feature (fixar linhas / colunas)
 *  - everything is saved to the user's preferences (layout, sort, filters…)
 *  - the migration is gradual; first pages = Agenda, Pedidos, Produtos,
 *    Colaboradores.
 *
 * Idempotent: removes any prior copy of this message (same title) first, then
 * recreates it with fresh targets.
 *
 * Run:  npx tsx scripts/seed-table-detail-migration-message.ts
 */
import { PrismaClient, SectorPrivileges } from "@prisma/client";

const prisma = new PrismaClient();

const TITLE = "Novidades: novas Tabelas e Páginas de Detalhe 🚀";

// Sector privileges that should receive this announcement.
const TARGET_PRIVILEGES: SectorPrivileges[] = [
  SectorPrivileges.ADMIN,
  SectorPrivileges.COMMERCIAL,
  SectorPrivileges.PRODUCTION_MANAGER,
  SectorPrivileges.LOGISTIC,
];

// Stable, sequential ids so the editor/renderer stay happy without Math.random.
let blockSeq = 0;
const id = () => `block-migration-${++blockSeq}`;

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
const list = (items: string[], ordered = false) => ({
  id: id(),
  type: "list" as const,
  items,
  ordered,
});
const divider = () => ({ id: id(), type: "divider" as const });
const spacer = () => ({ id: id(), type: "spacer" as const, height: "sm" as const });
const headerLogo = () => ({ id: id(), type: "decorator" as const, variant: "header-logo" as const });
const footerWave = () => ({
  id: id(),
  type: "decorator" as const,
  variant: "footer-wave-dark" as const,
});

// Editor (DB-stored) content format — `{ blocks: [...] }`. Inline markdown
// (**bold**, *italic*, [link](url)) is supported by the renderer's parser.
const blocks = [
  headerLogo(),

  heading1("Chegaram as novas Tabelas e Páginas de Detalhe! 🚀"),
  paragraph(
    "Estamos modernizando o sistema! As listagens e as páginas de detalhe estão sendo reconstruídas sobre uma **base única, mais robusta e performática**, com muito mais recursos para o seu dia a dia.",
  ),

  divider(),

  heading2("📊 Novidades nas tabelas"),
  paragraph("As tabelas ganharam novos recursos. Agora você pode:"),
  list([
    "**Redimensionar** as colunas, ajustando a largura do jeito que preferir",
    "**Alinhar** o conteúdo das colunas à **esquerda, ao centro ou à direita**",
    "Manter as configurações salvas: **a tabela lembra do seu ajuste** e abre sempre do seu jeito",
  ]),

  heading2("📌 Fixar linhas e colunas"),
  paragraph(
    "O novo recurso de **fixar** permite manter as linhas e colunas mais importantes sempre visíveis na tela, mesmo enquanto você rola a tabela. Ótimo para comparar registros e não perder de vista o que importa.",
  ),

  heading2("📤 Novo fluxo de exportação (Compartilhar)"),
  paragraph(
    "O botão **Compartilhar** reúne toda a exportação em um só lugar. A partir de qualquer tabela você pode:",
  ),
  list([
    "Exportar para **Excel (xlsx)** ou **PDF**",
    "Gerar um **link compartilhável** que abre a tabela já com os mesmos filtros, ordenação e seleção",
    "A exportação respeita o que está em tela: **exporta tudo o que está filtrado**, não apenas a página atual",
    "**Não é preciso ajustar as colunas antes de exportar** — você escolhe quais colunas vão no arquivo na hora da exportação",
    "Para exportar apenas alguns registros, **basta selecioná-los e exportar a seleção** — não é mais necessário filtrar a tabela para deixar só eles na tela",
  ]),

  heading2("📄 Páginas de detalhe que você organiza"),
  paragraph("As páginas de detalhe também foram repensadas. Agora você pode:"),
  list([
    "**Reorganizar as seções** arrastando-as para a ordem que fizer mais sentido",
    "**Mostrar ou ocultar** as seções que quiser",
    "Ajustar a **largura** de cada seção (metade ou inteira)",
    "**Editar direto na página** com um duplo clique no campo",
  ]),

  heading2("💾 Tudo salvo nas suas preferências"),
  paragraph(
    "Você não precisa reconfigurar nada toda vez. **A largura e o alinhamento das colunas, a ordenação, os filtros, as linhas fixadas, os itens por página e a organização das páginas de detalhe** ficam salvos no seu usuário e seguem você em qualquer dispositivo.",
  ),

  divider(),

  heading2("🗓️ A migração será gradual"),
  paragraph(
    "Estamos levando essas melhorias para o sistema **aos poucos, com o tempo**. As primeiras páginas já migradas para o novo padrão são:",
  ),
  list(["**Agenda**", "**Pedidos**", "**Produtos**", "**Colaboradores**"], true),
  paragraph(
    "As demais páginas serão atualizadas nas próximas etapas. Aproveite os novos recursos e bom trabalho! 💪",
  ),
  spacer(),

  footerWave(),
];

async function main() {
  // Pick a creator: any active ADMIN user (fallback to first user).
  const creator =
    (await prisma.user.findFirst({
      where: { sector: { privileges: SectorPrivileges.ADMIN }, currentContractStatus: "ACTIVE" },
      select: { id: true, name: true },
    })) ?? (await prisma.user.findFirst({ select: { id: true, name: true } }));

  if (!creator) throw new Error("No user found to act as message creator.");

  // Resolve the audience: active users in the target sectors.
  const recipients = await prisma.user.findMany({
    where: {
      currentContractStatus: "ACTIVE",
      sector: { privileges: { in: TARGET_PRIVILEGES } },
    },
    select: { id: true, name: true, sector: { select: { privileges: true } } },
  });

  if (recipients.length === 0) {
    throw new Error(
      `No active users found in sectors: ${TARGET_PRIVILEGES.join(", ")}. Nothing to target.`,
    );
  }

  // Clean any previous run's copy (cascades to targets/views).
  await prisma.message.deleteMany({ where: { title: TITLE } });

  const message = await prisma.message.create({
    data: {
      title: TITLE,
      content: { blocks },
      status: "ACTIVE",
      publishedAt: new Date(),
      createdById: creator.id,
      isDismissible: true,
      requiresView: false,
      targets: {
        create: recipients.map((u) => ({ userId: u.id })),
      },
    },
    select: { id: true, title: true, status: true, publishedAt: true },
  });

  console.log("OK message created:", JSON.stringify(message));
  console.log(`Creator: ${creator.name} (${creator.id})`);
  console.log(`Targeted ${recipients.length} user(s):`);
  for (const u of recipients) {
    console.log(`  - ${u.name} [${u.sector?.privileges}] ${u.id}`);
  }
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
