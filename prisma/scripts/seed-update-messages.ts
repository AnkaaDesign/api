/**
 * =============================================================================
 * UPDATE MESSAGES SEED SCRIPT
 * =============================================================================
 *
 * Creates two update messages:
 * 1. Garage system updates (yard areas, truck movement, etc.)
 * 2. Representative → Responsible rename
 *
 * Targets: ADMIN, COMMERCIAL, FINANCIAL, LOGISTIC users
 *
 * Run with: npx tsx prisma/scripts/seed-update-messages.ts
 *
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CREATED_BY_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100'; // Kennedy Campos

const TARGET_SECTORS = ['ADMIN', 'COMMERCIAL', 'FINANCIAL', 'LOGISTIC'] as const;

const now = new Date();
const ts = now.getTime();

const garageMessage = {
  title: 'Novidades na Garagem',
  content: {
    blocks: [
      {
        id: `block_1_${ts}`,
        type: 'image',
        alt: 'Ankaa Design',
        url: 'https://arquivos.ankaadesign.com.br/Mensagens/logo.png',
        size: '128px',
        alignment: 'left',
      },
      {
        id: `block_2_${ts}`,
        type: 'heading3',
        content: 'Novidades na Garagem',
        fontSize: 'lg',
      },
      {
        id: `block_3_${ts}`,
        type: 'paragraph',
        content:
          'A visualização da garagem foi aprimorada com novas áreas de pátio e funcionalidades de movimentação de caminhões entre garagens.',
      },
      {
        id: `block_4_${ts}`,
        type: 'divider',
      },
      {
        id: `block_5_${ts}`,
        type: 'list',
        ordered: false,
        items: [
          'Novas áreas de pátio: "Espera" e "Saída" para organizar caminhões fora das vagas internas',
          'O antigo "Pátio" foi substituído pelas novas áreas de espera e saída',
          'Caminhões sem vaga definida agora são posicionados automaticamente na área de espera',
          'Movimentação de caminhões entre garagens com solicitação de transferência',
          'Visualização individual de garagem com detalhes de vagas e caminhões',
          'Arrastar e soltar caminhões entre vagas e áreas de pátio',
        ],
      },
      {
        id: `block_6_${ts}`,
        type: 'divider',
      },
      {
        id: `block_7_${ts}`,
        type: 'quote',
        content:
          'Acesse a tela de Garagem para visualizar as novas áreas de pátio e utilizar a movimentação de caminhões.',
      },
    ],
  },
};

const responsibleMessage = {
  title: 'Representantes agora são Responsáveis',
  content: {
    blocks: [
      {
        id: `block_8_${ts}`,
        type: 'image',
        alt: 'Ankaa Design',
        url: 'https://arquivos.ankaadesign.com.br/Mensagens/logo.png',
        size: '128px',
        alignment: 'left',
      },
      {
        id: `block_9_${ts}`,
        type: 'heading3',
        content: 'Representantes agora são Responsáveis',
        fontSize: 'lg',
      },
      {
        id: `block_10_${ts}`,
        type: 'paragraph',
        content:
          'O sistema de "Representantes" foi renomeado para "Responsáveis" em todo o sistema para melhor refletir o papel desses contatos nas tarefas e clientes.',
      },
      {
        id: `block_11_${ts}`,
        type: 'divider',
      },
      {
        id: `block_12_${ts}`,
        type: 'list',
        ordered: false,
        items: [
          'O menu e páginas de "Representantes" agora se chamam "Responsáveis"',
          'O campo "Representantes" nas tarefas foi renomeado para "Responsáveis"',
          'Todos os dados existentes foram migrados automaticamente — nenhuma ação necessária',
          'As funções (Comercial, Marketing, Coordenador, Financeiro, Gestor de Frota) permanecem as mesmas',
          'Histórico de alterações agora registra mudanças na seção "Responsáveis"',
        ],
      },
      {
        id: `block_13_${ts}`,
        type: 'divider',
      },
      {
        id: `block_14_${ts}`,
        type: 'quote',
        content:
          'Essa mudança é apenas de nomenclatura. Todos os cadastros e vínculos existentes continuam funcionando normalmente.',
      },
    ],
  },
};

async function main() {
  console.log('Fetching target users (ADMIN, COMMERCIAL, FINANCIAL, LOGISTIC)...');

  const targetUsers = await prisma.user.findMany({
    where: {
      status: { not: 'DISMISSED' },
      sector: {
        privileges: { in: TARGET_SECTORS as unknown as string[] },
      },
    },
    select: { id: true, name: true, sector: { select: { name: true, privileges: true } } },
  });

  console.log(`Found ${targetUsers.length} target users:`);
  for (const user of targetUsers) {
    console.log(`  - ${user.name} (${user.sector?.name} - ${user.sector?.privileges})`);
  }

  const targetUserIds = targetUsers.map((u) => u.id);

  if (targetUserIds.length === 0) {
    console.error('No target users found! Aborting.');
    return;
  }

  // Create garage message
  console.log('\nCreating garage update message...');
  const garage = await prisma.message.create({
    data: {
      title: garageMessage.title,
      content: garageMessage.content,
      status: 'ACTIVE',
      statusOrder: 3,
      isDismissible: true,
      requiresView: false,
      createdById: CREATED_BY_ID,
      publishedAt: now,
    },
  });
  console.log(`  Created message: ${garage.id} - "${garage.title}"`);

  await prisma.messageTarget.createMany({
    data: targetUserIds.map((userId) => ({
      messageId: garage.id,
      userId,
    })),
  });
  console.log(`  Added ${targetUserIds.length} targets`);

  // Create responsible message
  console.log('\nCreating responsible update message...');
  const responsible = await prisma.message.create({
    data: {
      title: responsibleMessage.title,
      content: responsibleMessage.content,
      status: 'ACTIVE',
      statusOrder: 3,
      isDismissible: true,
      requiresView: false,
      createdById: CREATED_BY_ID,
      publishedAt: now,
    },
  });
  console.log(`  Created message: ${responsible.id} - "${responsible.title}"`);

  await prisma.messageTarget.createMany({
    data: targetUserIds.map((userId) => ({
      messageId: responsible.id,
      userId,
    })),
  });
  console.log(`  Added ${targetUserIds.length} targets`);

  console.log('\nDone! Both messages created and published.');
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
