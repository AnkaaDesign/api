import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Creating welcome message...');

  // Find Kennedy's user ID
  const kennedy = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { contains: 'kennedy', mode: 'insensitive' } },
        { name: { contains: 'Kennedy', mode: 'insensitive' } }
      ]
    }
  });

  if (!kennedy) {
    console.error('Could not find Kennedy user');
    process.exit(1);
  }

  console.log(`Found user: ${kennedy.name} (${kennedy.email})`);

  // Check if welcome message already exists
  const existing = await prisma.message.findFirst({
    where: {
      metadata: {
        path: ['welcomeMessage'],
        equals: true
      }
    }
  });

  if (existing) {
    console.log('Welcome message already exists, skipping creation');
    return;
  }

  // Create the welcome message
  const message = await prisma.message.create({
    data: {
      title: 'Bem-vindo ao Ankaa Design! 🎉',
      content: {
        version: '1.0',
        blocks: [
          {
            id: 'block-1',
            type: 'heading',
            level: 1,
            content: [{ type: 'text', content: 'Bem-vindo ao Ankaa Design!' }]
          },
          {
            id: 'block-2',
            type: 'paragraph',
            content: [{
              type: 'text',
              content: 'Estamos empolgados em ter você a bordo! Esta plataforma foi projetada para otimizar todo o seu fluxo de trabalho de produção, desde o gerenciamento de tarefas até o controle de estoque.'
            }]
          },
          {
            id: 'block-3',
            type: 'heading',
            level: 2,
            content: [{ type: 'text', content: '🎯 Recursos Principais' }]
          },
          {
            id: 'block-4',
            type: 'list',
            ordered: false,
            items: [
              'Gerenciamento de Tarefas - Acompanhe tarefas de produção com atualizações de status e prazos',
              'Gerenciamento de Pedidos - Crie, acompanhe e atenda pedidos com eficiência',
              'Controle de Estoque - Alertas automáticos e notificações de reabastecimento',
              'Coordenação de Equipe - Atribua tarefas e acompanhe o progresso da equipe',
              'Notificações Inteligentes - Alertas personalizáveis (in-app, e-mail, push, WhatsApp)',
              'Atualizações em Tempo Real - Notificações instantâneas sobre mudanças críticas',
              'Fluxo de Trabalho Completo - Desde a preparação até a entrega',
              'Análises e Relatórios - Acompanhe o desempenho e insights'
            ]
          },
          {
            id: 'block-5',
            type: 'heading',
            level: 2,
            content: [{ type: 'text', content: '📱 Primeiros Passos' }]
          },
          {
            id: 'block-6',
            type: 'list',
            ordered: true,
            items: [
              'Complete a configuração do seu perfil',
              'Familiarize-se com o painel',
              'Configure suas preferências de notificação',
              'Comece a explorar tarefas e pedidos'
            ]
          },
          {
            id: 'block-7',
            type: 'heading',
            level: 2,
            content: [{ type: 'text', content: '💬 Precisa de Ajuda?' }]
          },
          {
            id: 'block-8',
            type: 'paragraph',
            content: [
              { type: 'text', content: 'Nossa equipe está aqui para apoiá-lo:' },
              { type: 'text', content: ' ' },
              { type: 'bold', content: 'Admin: Kennedy' }
            ]
          },
          {
            id: 'block-9',
            type: 'paragraph',
            content: [{
              type: 'text',
              content: 'Sinta-se à vontade para entrar em contato com qualquer dúvida ou se precisar de ajuda para começar.'
            }]
          },
          {
            id: 'block-10',
            type: 'button',
            text: 'Falar com Kennedy no WhatsApp',
            url: 'https://wa.me/554991402403?text=Olá%2C%20preciso%20de%20ajuda%20com%20o%20Ankaa%20Design',
            variant: 'primary'
          },
          {
            id: 'block-11',
            type: 'divider'
          },
          {
            id: 'block-12',
            type: 'paragraph',
            content: [
              { type: 'text', content: 'Vamos tornar seu processo de produção mais eficiente juntos!' },
              { type: 'text', content: ' ' },
              { type: 'italic', content: 'Equipe Ankaa Design' }
            ]
          }
        ]
      },
      priority: 'HIGH',
      priorityOrder: 3,
      status: 'ACTIVE',
      statusOrder: 3,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      createdById: kennedy.id,
      targetingType: 'ALL_USERS',
      metadata: {
        welcomeMessage: true,
        version: '1.0',
        launchWeek: true,
        contactInfo: {
          admin: 'Kennedy',
          whatsapp: '4991402403',
          whatsappLink: 'https://wa.me/554991402403'
        }
      },
      actionType: 'EXTERNAL_LINK',
      actionUrl: 'https://wa.me/554991402403?text=Olá%2C%20preciso%20de%20ajuda%20com%20o%20Ankaa%20Design',
      isDismissible: true,
      requiresView: false,
      publishedAt: new Date()
    }
  });

  console.log('✅ Welcome message created successfully!');
  console.log(`Message ID: ${message.id}`);
  console.log(`Title: ${message.title}`);
  console.log(`Status: ${message.status}`);
  console.log(`Priority: ${message.priority}`);
}

main()
  .catch((e) => {
    console.error('Error creating welcome message:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
