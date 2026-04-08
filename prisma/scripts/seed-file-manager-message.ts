/**
 * =============================================================================
 * FILE MANAGER & HISTORY MESSAGE SEED SCRIPT
 * =============================================================================
 *
 * Creates a message about:
 * - Artes renamed to Layouts
 * - Base files split into Check-in, Check-out, and Project
 * - File history to avoid duplicates
 *
 * Targets: ADMIN, COMMERCIAL, FINANCIAL, LOGISTIC users
 *
 * Run with: npx tsx prisma/scripts/seed-file-manager-message.ts
 *
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CREATED_BY_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100'; // Kennedy Campos

const TARGET_SECTORS = ['ADMIN', 'COMMERCIAL', 'FINANCIAL', 'LOGISTIC'] as const;

const now = new Date();
const ts = now.getTime();

const fileManagerMessage = {
  title: 'Gerenciador de Arquivos e Histórico',
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
        content: 'Gerenciador de Arquivos e Histórico',
        fontSize: 'lg',
      },
      {
        id: `block_3_${ts}`,
        type: 'paragraph',
        content:
          "O sistema de arquivos foi reestruturado para oferecer uma organização mais eficiente. A nomenclatura de 'Artes' foi alterada para 'Layouts', e os antigos 'Arquivos Base' foram divididos em Check-in, Check-out e Projeto. O sistema agora utiliza histórico de arquivos para evitar duplicações desnecessárias.",
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
          "**Artes → Layouts**: O antigo campo 'Artes' agora se chama 'Layouts' em todo o sistema",
          '**Histórico de Arquivos**: O sistema utiliza um histórico centralizado, permitindo que múltiplas tarefas utilizem o mesmo arquivo sem criar duplicatas',
          '**Arquivos de Check-in**: Novo campo para arquivos relacionados à entrada do veículo',
          '**Arquivos de Check-out**: Novo campo para arquivos relacionados à saída do veículo',
          '**Arquivos de Projeto**: Novo campo para arquivos do projeto da tarefa',
          '**Arquivos Base**: Agora utilizado para outros arquivos relacionados ao cliente',
          '**Organização por Entidade**: Arquivos organizados por cliente e tarefa para facilitar localização',
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
          'Essa mudança agiliza o fluxo de trabalho e reduz arquivos duplicados no sistema. Os novos campos de Check-in, Check-out e Projeto permitem organizar melhor a documentação de cada tarefa.',
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

  // Create file manager message
  console.log('\nCreating file manager update message...');
  const message = await prisma.message.create({
    data: {
      title: fileManagerMessage.title,
      content: fileManagerMessage.content,
      status: 'ACTIVE',
      statusOrder: 3,
      isDismissible: true,
      requiresView: false,
      createdById: CREATED_BY_ID,
      publishedAt: now,
    },
  });
  console.log(`  Created message: ${message.id} - "${message.title}"`);

  await prisma.messageTarget.createMany({
    data: targetUserIds.map((userId) => ({
      messageId: message.id,
      userId,
    })),
  });
  console.log(`  Added ${targetUserIds.length} targets`);

  console.log('\nDone!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
