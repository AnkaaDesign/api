import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed Script: Welcome Message
 *
 * Creates a welcome message for all users in the system
 */

async function main() {
  console.log('🌱 Seeding welcome message...\n');

  try {
    // Find an admin user (user in "Administração" sector)
    const adminUser = await prisma.user.findFirst({
      where: {
        status: { not: 'DISMISSED' },
        sector: {
          name: 'Administração',
        },
      },
      select: { id: true, name: true },
    });

    if (!adminUser) {
      console.log('⚠️  No admin user found. Skipping message seed.');
      console.log('💡 Create a user in "Administração" sector first, then run this seed again.');
      return;
    }

    console.log(`✓ Found admin user: ${adminUser.name}`);

    // Check if welcome message already exists
    const existingMessage = await prisma.message.findFirst({
      where: {
        title: 'Bem-vindo ao Ankaa Design! 🎉',
      },
    });

    if (existingMessage) {
      console.log('⚠️  Welcome message already exists. Skipping creation.');
      console.log(`   Message ID: ${existingMessage.id}`);
      return;
    }

    // Create welcome message
    const message = await prisma.message.create({
      data: {
        title: 'Bem-vindo ao Ankaa Design! 🎉',
        content: {
          blocks: [
            {
              id: 'block-1',
              type: 'heading1',
              content: [
                {
                  type: 'text',
                  content: 'Bem-vindo ao Ankaa Design!',
                },
              ],
            },
            {
              id: 'block-2',
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  content: 'Estamos muito felizes em tê-lo conosco. Este é o novo sistema de mensagens do Ankaa Design.',
                },
              ],
            },
            {
              id: 'block-3',
              type: 'heading2',
              content: [
                {
                  type: 'text',
                  content: 'O que você pode fazer aqui:',
                },
              ],
            },
            {
              id: 'block-4',
              type: 'list',
              listType: 'bullet',
              items: [
                {
                  id: 'item-1',
                  content: [
                    {
                      type: 'text',
                      content: 'Receber anúncios importantes da administração',
                    },
                  ],
                },
                {
                  id: 'item-2',
                  content: [
                    {
                      type: 'text',
                      content: 'Ficar por dentro de novidades e atualizações do sistema',
                    },
                  ],
                },
                {
                  id: 'item-3',
                  content: [
                    {
                      type: 'text',
                      content: 'Receber notificações relevantes para seu setor ou cargo',
                    },
                  ],
                },
                {
                  id: 'item-4',
                  content: [
                    {
                      type: 'text',
                      content: 'Gerenciar suas preferências de visualização',
                    },
                  ],
                },
              ],
            },
            {
              id: 'block-5',
              type: 'callout',
              calloutType: 'info',
              content: [
                {
                  type: 'text',
                  content: 'Dica: Você pode clicar em "Não mostrar novamente" para ocultar permanentemente uma mensagem, ou fechar para visualizar novamente amanhã.',
                },
              ],
            },
            {
              id: 'block-6',
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  content: 'Qualquer dúvida, entre em contato com a administração.',
                },
              ],
            },
            {
              id: 'block-7',
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  content: 'Boa jornada!',
                  bold: true,
                },
              ],
            },
          ],
          version: '1.0',
        },
        status: 'ACTIVE',
        publishedAt: new Date(),
        createdById: adminUser.id,
        isDismissible: true,
        requiresView: false,
      },
    });

    // No MessageTarget records = ALL_USERS (everyone sees it)
    console.log(`✅ Welcome message created successfully!`);
    console.log(`   Message ID: ${message.id}`);
    console.log(`   Title: ${message.title}`);
    console.log(`   Status: ${message.status}`);
    console.log(`   Published: ${message.publishedAt?.toISOString()}`);
    console.log(`   Target: ALL_USERS (no targets specified)`);

  } catch (error) {
    console.error('❌ Error seeding welcome message:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
