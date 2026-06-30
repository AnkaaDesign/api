/**
 * Seeds three ACTIVE, published welcome Messages — one per sector that is now
 * starting to use the mobile app: PRODUCTION, WAREHOUSE and MAINTENANCE.
 *
 * Each message is tailored to what that sector actually sees in the mobile app
 * (derived from src/constants/navigation.ts gating), welcomes the team, and
 * closes asking users to report any problem / malfunction / suggestion to
 * support (Kennedy Campos).
 *
 * Author (createdById): Kennedy Campos.
 * Audience: every ACTIVE user whose sector privilege matches the message.
 *
 * Idempotent: removes any prior copy of each message (by title) before
 * recreating it with fresh targets.
 *
 * Run:  npx tsx scripts/seed-welcome-messages.ts
 */
import { PrismaClient, SectorPrivileges } from "@prisma/client";

const prisma = new PrismaClient();

const KENNEDY_ID = "41fcb3fe-e1b6-43e9-bd72-41c072154100";
const SUPPORT_NAME = "Kennedy Campos";

// --- block builders (editor/DB format: `{ blocks: [...] }`) ----------------
let blockSeq = 0;
const id = () => `block-welcome-${++blockSeq}`;

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

// Shared support/help closing used by every message.
const supportBlocks = () => [
  divider(),
  heading2("📨 Precisa de ajuda?"),
  quote(
    `Encontrou algum problema, mau funcionamento ou tem uma sugestão? Fale com o suporte: ${SUPPORT_NAME}. Sua opinião ajuda a melhorar o aplicativo!`,
  ),
  spacer(),
  footerWave(),
];

// --- message definitions ----------------------------------------------------
type Def = { privilege: SectorPrivileges; title: string; blocks: any[] };

const definitions: Def[] = [
  // ===== PRODUCTION =====
  {
    privilege: SectorPrivileges.PRODUCTION,
    title: "Bem-vindo(a) ao app da Ankaa — Produção 🎉",
    blocks: [
      headerLogo(),
      heading1("Seja bem-vindo(a) ao aplicativo da Ankaa! 🎉"),
      paragraph(
        "A equipe da **Produção** agora passa a usar o aplicativo no dia a dia. Por aqui você acompanha as suas tarefas com muito mais detalhe e cuida das suas informações de forma prática e rápida. 🚀",
      ),

      heading2("🗓️ Cronograma — as suas tarefas"),
      paragraph(
        "O **Cronograma** é a sua tela principal: a fila de tarefas e veículos que estão na produção. Toque em uma tarefa para ver **tudo sobre ela**:",
      ),
      list([
        "Todos os **detalhes da tarefa** — serviços, prazos e situação atual",
        "O **Layout** do caminhão — veja exatamente onde cada arte/adesivo deve ser aplicado",
        "As **Tintas** e fórmulas usadas na tarefa, com as cores certas para o serviço",
        "As **Ordens de Serviço** ligadas àquela tarefa",
      ]),

      heading2("💬 Observações — comunique problemas e erros"),
      paragraph(
        "Use as **Observações** para registrar e acompanhar **problemas, erros ou pontos de atenção** nas tarefas da produção. É o canal certo para avisar o que precisa ser corrigido ou revisto — e também **onde você será avisado** quando algo for apontado.",
      ),

      heading2("📜 Histórico e ✂️ Recorte"),
      list([
        "**Histórico** — consulte as tarefas já concluídas",
        "**Recorte** — solicite e acompanhe os recortes de adesivo/plotagem",
      ]),

      heading2("🔔 Notificações"),
      paragraph(
        "Você será **avisado automaticamente** sempre que algo que você precisa saber for atualizado — assim nada passa despercebido.",
      ),

      heading2("⏱️ Controle de ponto e área pessoal"),
      paragraph("No app você faz tudo do seu controle de ponto e ainda acompanha as suas informações:"),
      list([
        "**Meus Pontos** — faça tudo pelo celular: **bater o ponto, ajustar, justificar ausências e assinar o espelho de ponto**",
        "**Meu Bônus** — veja **quanto você está recebendo**, consulte o **histórico** dos seus bônus e faça **simulações** para saber quanto pode receber (quando aplicável ao seu cargo)",
        "**Meus EPIs** — veja os EPIs entregues a você e solicite novos",
        "**Meus Empréstimos**, **Minhas Advertências** e **Minhas Movimentações** — acompanhe o seu histórico",
        "**Feriados** — consulte o calendário de feriados da empresa",
        "**Questionários** — responda os formulários e pesquisas quando houver",
        "**Minhas Mensagens** — leia os comunicados e avisos enviados a você",
      ]),

      ...supportBlocks(),
    ],
  },

  // ===== WAREHOUSE =====
  {
    privilege: SectorPrivileges.WAREHOUSE,
    title: "Bem-vindo(a) ao app da Ankaa — Estoque 🎉",
    blocks: [
      headerLogo(),
      heading1("Seja bem-vindo(a) ao aplicativo da Ankaa! 🎉"),
      paragraph(
        "O time do **Estoque / Almoxarifado** agora passa a usar o aplicativo no dia a dia. Ele é a sua central de operações de estoque — tudo na palma da mão. 📦",
      ),

      heading2("📦 Estoque"),
      list([
        "**Produtos** — cadastre e consulte os itens, com **categorias** e **marcas**",
        "**Movimentações** — registre entradas, saídas e consumo de materiais",
        "**Balanço de Estoque** — faça a contagem e a conferência do estoque",
        "**Empréstimos** — controle as ferramentas emprestadas aos colaboradores",
        "**EPI** e **Entregas** — gerencie os EPIs e registre as entregas",
        "**Fornecedores** — mantenha o cadastro dos fornecedores",
        "**Localizações** — consulte o mapa de localização dos itens no estoque",
        "**Manutenção** — registre as manutenções de equipamentos",
        "**Pedidos** — consulte os pedidos de compra (o cadastro e a edição ficam com o administrador)",
      ]),

      heading2("🎨 Pintura"),
      list([
        "**Catálogo** de tintas, **Marcas de Tinta** e **Tipos de Tinta**",
        "**Produções** — acompanhe as misturas e produções de tinta",
      ]),

      heading2("🏭 Produção (consulta)"),
      list([
        "**Barracões**, **Cronograma**, **Histórico** e **Observações** — para acompanhar o andamento da produção",
      ]),

      heading2("👤 Sua área pessoal"),
      list([
        "**Meus Pontos** — bata o ponto, ajuste, justifique ausências e assine seu espelho de ponto",
        "**Meus EPIs** (e solicitação de novos), **Meus Empréstimos** e **Minhas Movimentações**",
        "**Minhas Advertências**, **Meu Bônus** (quando aplicável), **Feriados**, **Questionários**, **Minhas Mensagens** e **Notificações**",
      ]),

      ...supportBlocks(),
    ],
  },

  // ===== MAINTENANCE =====
  {
    privilege: SectorPrivileges.MAINTENANCE,
    title: "Bem-vindo(a) ao app da Ankaa — Manutenção 🎉",
    blocks: [
      headerLogo(),
      heading1("Seja bem-vindo(a) ao aplicativo da Ankaa! 🎉"),
      paragraph(
        "A equipe da **Manutenção** agora passa a usar o aplicativo no dia a dia. Por aqui você cuida do seu ponto e de todas as suas informações de forma simples e rápida. 🔧",
      ),

      heading2("👤 O que você encontra no app"),
      list([
        "**Meus Pontos** — bata o ponto, ajuste, justifique ausências e assine seu espelho de ponto",
        "**Meus EPIs** — veja os EPIs entregues a você e solicite novos",
        "**Meus Empréstimos** — acompanhe as ferramentas emprestadas a você",
        "**Minhas Movimentações** — consulte suas movimentações de materiais",
        "**Minhas Advertências** — acompanhe suas advertências",
        "**Feriados** — veja o calendário de feriados da empresa",
        "**Questionários** — responda os formulários quando houver",
        "**Minhas Mensagens** e **Notificações** — fique por dentro dos comunicados",
      ]),

      ...supportBlocks(),
    ],
  },
];

async function main() {
  const creator = await prisma.user.findUnique({
    where: { id: KENNEDY_ID },
    select: { id: true, name: true },
  });
  if (!creator) throw new Error(`Creator (Kennedy) not found: ${KENNEDY_ID}`);

  for (const def of definitions) {
    const recipients = await prisma.user.findMany({
      where: {
        currentContractStatus: "ACTIVE",
        sector: { privileges: def.privilege },
      },
      select: { id: true, name: true },
    });

    // Clean any previous run's copy (cascades to targets/views).
    await prisma.message.deleteMany({ where: { title: def.title } });

    if (recipients.length === 0) {
      console.log(`SKIP "${def.title}" — no active users in sector ${def.privilege}`);
      continue;
    }

    const message = await prisma.message.create({
      data: {
        title: def.title,
        content: { blocks: def.blocks },
        status: "ACTIVE",
        publishedAt: new Date(),
        createdById: creator.id,
        isDismissible: true,
        requiresView: false,
        targets: { create: recipients.map((u) => ({ userId: u.id })) },
      },
      select: { id: true, title: true },
    });

    console.log(
      `OK [${def.privilege}] "${message.title}" (${message.id}) → ${recipients.length} user(s)`,
    );
    for (const u of recipients) console.log(`     - ${u.name}`);
  }

  console.log(`\nAll welcome messages created by ${creator.name} (${creator.id}).`);
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
