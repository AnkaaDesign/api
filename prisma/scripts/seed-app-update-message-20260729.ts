/**
 * =============================================================================
 * APP UPDATE MESSAGE — julho 2026
 * =============================================================================
 *
 * Mensagem simples com um único botão apontando para a página de instalação do
 * aplicativo (https://ankaadesign.com.br/install). Serve como teste do bloco de
 * botão no app mobile antes de disparar o aviso de atualização para todos.
 *
 * Alvo: apenas Kennedy Campos (kennedy.ankaa@gmail.com).
 * Para enviar a outras pessoas depois, troque TARGET_EMAILS.
 *
 * Rodar com: npx tsx prisma/scripts/seed-app-update-message-20260729.ts
 *
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CREATED_BY_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100'; // Kennedy Campos
const TARGET_EMAILS = ['kennedy.ankaa@gmail.com'];
const INSTALL_URL = 'https://ankaadesign.com.br/install';

const now = new Date();
const ts = now.getTime();

const message = {
  title: 'Atualize o aplicativo',
  content: {
    blocks: [
      {
        id: `upd_1_${ts}`,
        type: 'heading3',
        content: 'Nova versão disponível',
        fontSize: 'lg',
      },
      {
        id: `upd_2_${ts}`,
        type: 'paragraph',
        content:
          'Uma nova versão do aplicativo Ankaa está disponível. Toque no botão abaixo para abrir a página de instalação e atualizar.',
      },
      {
        id: `upd_3_${ts}`,
        type: 'button',
        text: 'Instalar atualização',
        url: INSTALL_URL,
        alignment: 'left',
      },
    ],
  },
};

async function main() {
  const targetUsers = await prisma.user.findMany({
    where: { email: { in: TARGET_EMAILS } },
    select: { id: true, name: true, email: true },
  });

  if (targetUsers.length !== TARGET_EMAILS.length) {
    const found = targetUsers.map(u => u.email);
    const missing = TARGET_EMAILS.filter(e => !found.includes(e));
    throw new Error(`Usuário(s) não encontrado(s): ${missing.join(', ')}`);
  }

  console.log(`\n── ${message.title} ──`);
  console.log(`   Botão: "Instalar atualização" → ${INSTALL_URL}`);
  console.log(`   Destinatários (${targetUsers.length}):`);
  for (const user of targetUsers) {
    console.log(`     • ${user.name} (${user.email})`);
  }

  const created = await prisma.message.create({
    data: {
      title: message.title,
      content: message.content,
      status: 'ACTIVE',
      statusOrder: 3,
      isDismissible: true,
      requiresView: false,
      createdById: CREATED_BY_ID,
      publishedAt: now,
    },
  });
  console.log(`   ✓ Mensagem criada: ${created.id}`);

  await prisma.messageTarget.createMany({
    data: targetUsers.map(u => ({ messageId: created.id, userId: u.id })),
  });
  console.log(`   ✓ ${targetUsers.length} destinatário(s) vinculado(s)`);

  console.log('\n✅ Pronto. Abra o app para ver a mensagem.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
