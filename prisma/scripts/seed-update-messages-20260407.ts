/**
 * =============================================================================
 * UPDATE MESSAGES SEED - April 2026
 * =============================================================================
 *
 * Messages announcing the major system update:
 *   1. Novo Sistema de Orçamentos e Faturamento (ADMIN, COMMERCIAL, FINANCIAL)
 *   2. Melhorias nas Tarefas e Ordens de Serviço (ADMIN, COMMERCIAL, LOGISTIC)
 *   3. Check-in e Check-out de Veículos (ADMIN, COMMERCIAL, LOGISTIC, PRODUCTION_MANAGER)
 *   4. Conclusão de Tarefas pela Produção (PRODUCTION_MANAGER only)
 *
 * Run with: npx tsx prisma/scripts/seed-update-messages-20260407.ts
 *
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CREATED_BY_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100'; // Kennedy Campos
const LOGO_URL = '/files/serve/9e1cbf48-1ab0-4c54-b2dd-a46e7e2bf5de';

const now = new Date();
const ts = now.getTime();

// ─────────────────────────────────────────────────────────────────────────────
// Message 1: Novo Sistema de Orçamentos e Faturamento
// Target: ADMIN, COMMERCIAL, FINANCIAL
// ─────────────────────────────────────────────────────────────────────────────

const message1 = {
  title: 'Novo Sistema de Orçamentos e Faturamento',
  targetSectors: ['ADMIN', 'COMMERCIAL', 'FINANCIAL'],
  content: {
    blocks: [
      {
        id: `msg1_1_${ts}`,
        type: 'image',
        alt: 'Ankaa Design',
        url: LOGO_URL,
        size: '128px',
        alignment: 'left',
      },
      {
        id: `msg1_2_${ts}`,
        type: 'heading3',
        content: 'Novo Sistema de Orçamentos e Faturamento',
        fontSize: 'lg',
      },
      {
        id: `msg1_3_${ts}`,
        type: 'paragraph',
        content:
          'O sistema de precificação foi completamente reformulado. O antigo "Precificação" agora se chama "Orçamento", com um fluxo completo desde a criação do orçamento até a emissão de boletos e notas fiscais. O cadastro de clientes agora faz parte do módulo Financeiro.',
      },
      {
        id: `msg1_4_${ts}`,
        type: 'divider',
      },
      {
        id: `msg1_5_${ts}`,
        type: 'list',
        ordered: false,
        items: [
          '**Precificação → Orçamento**: O antigo sistema de "Precificação" foi substituído pelo novo módulo de "Orçamento" com número único, validade e layout vinculado',
          '**Múltiplos Clientes por Orçamento**: Cada orçamento agora suporta configurações individuais por cliente, com subtotais, condições de pagamento e responsável próprios',
          '**Descontos por Serviço**: Descontos agora são aplicados individualmente em cada serviço do orçamento, permitindo maior flexibilidade na negociação',
          '**Sugestão de Serviços**: Ao criar um orçamento, o sistema sugere automaticamente serviços com base no histórico do cliente',
          '**Novo Fluxo de Status**: Pendente → Aprovado pelo Orçamento → Aprovado pelo Comercial → Aprovado para Faturamento → A Vencer → Parcial → Quitado',
          '**Faturas e Parcelas**: Sistema completo de faturamento com geração de faturas, parcelas com datas de vencimento e controle de pagamento',
          '**Boletos Sicredi**: Geração automática de boletos bancários via integração com o Sicredi, com acompanhamento de status e baixa automática. Download individual ou em ZIP',
          '**NFS-e Elotech**: Emissão de notas fiscais de serviço eletrônicas integrada com o portal da prefeitura de Ibiporã, com visualização e download em PDF',
          '**Clientes no Financeiro**: O cadastro de clientes foi movido para o módulo Financeiro, centralizando a gestão financeira',
          '**Painel de Aprovação**: Dashboard com orçamentos aguardando aprovação para acompanhamento do setor comercial e financeiro',
        ],
      },
      {
        id: `msg1_6_${ts}`,
        type: 'divider',
      },
      {
        id: `msg1_7_${ts}`,
        type: 'quote',
        content:
          'Essa atualização centraliza todo o fluxo financeiro dentro do sistema — desde a criação do orçamento até a emissão de boletos e notas fiscais. Todos os orçamentos existentes foram migrados automaticamente.',
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Message 2: Melhorias nas Tarefas e Ordens de Serviço
// Target: ADMIN, COMMERCIAL, LOGISTIC
// ─────────────────────────────────────────────────────────────────────────────

const message2 = {
  title: 'Melhorias nas Tarefas e Ordens de Serviço',
  targetSectors: ['ADMIN', 'COMMERCIAL', 'LOGISTIC'],
  content: {
    blocks: [
      {
        id: `msg2_1_${ts}`,
        type: 'image',
        alt: 'Ankaa Design',
        url: LOGO_URL,
        size: '128px',
        alignment: 'left',
      },
      {
        id: `msg2_2_${ts}`,
        type: 'heading3',
        content: 'Melhorias nas Tarefas e Ordens de Serviço',
        fontSize: 'lg',
      },
      {
        id: `msg2_3_${ts}`,
        type: 'paragraph',
        content:
          'Diversas melhorias foram implementadas no gerenciamento de tarefas e ordens de serviço, com foco em rastreabilidade, organização e agilidade no dia a dia.',
      },
      {
        id: `msg2_4_${ts}`,
        type: 'divider',
      },
      {
        id: `msg2_5_${ts}`,
        type: 'list',
        ordered: false,
        items: [
          '**Histórico de Previsões**: Toda alteração na data de previsão da tarefa agora é registrada com motivo, responsável e data anterior — permitindo rastreabilidade completa de reagendamentos',
          '**Indicador de Reagendamento**: Tarefas com previsão alterada exibem um indicador visual violeta no canto, com detalhes ao passar o mouse',
          '**Cópia de Ordem de Serviço por Tipo**: Ao copiar uma tarefa, as ordens de serviço agora são separadas por tipo (Produção, Comercial, Arte, Logística), mantendo a organização correta',
          '**Liberação de Veículo**: Novo campo "Liberado" nas tarefas que indica que o veículo está pronto para ser retirado pelo cliente',
          '**Filtro por Liberação na Garagem**: A garagem agora permite filtrar caminhões por status de liberação',
          '**Placa e Chassi na Garagem**: Caminhões na garagem agora exibem a placa ou os últimos 5 dígitos do chassi como identificação visual',
          '**Sincronização Ordem de Serviço ↔ Orçamento**: Os serviços do orçamento são sincronizados automaticamente com as ordens de serviço, eliminando retrabalho manual',
        ],
      },
      {
        id: `msg2_6_${ts}`,
        type: 'divider',
      },
      {
        id: `msg2_7_${ts}`,
        type: 'quote',
        content:
          'Essas melhorias visam aumentar a rastreabilidade e agilizar o dia a dia na gestão das tarefas. O histórico de previsões é especialmente útil para entender atrasos e negociar prazos com clientes.',
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Message 3: Check-in e Check-out de Veículos
// Target: ADMIN, COMMERCIAL, LOGISTIC, PRODUCTION_MANAGER
// ─────────────────────────────────────────────────────────────────────────────

const message3 = {
  title: 'Check-in e Check-out de Veículos',
  targetSectors: ['ADMIN', 'COMMERCIAL', 'LOGISTIC', 'PRODUCTION_MANAGER'],
  content: {
    blocks: [
      {
        id: `msg3_1_${ts}`,
        type: 'image',
        alt: 'Ankaa Design',
        url: LOGO_URL,
        size: '128px',
        alignment: 'left',
      },
      {
        id: `msg3_2_${ts}`,
        type: 'heading3',
        content: 'Check-in e Check-out de Veículos',
        fontSize: 'lg',
      },
      {
        id: `msg3_3_${ts}`,
        type: 'paragraph',
        content:
          'O sistema agora possui um fluxo dedicado de Check-in e Check-out para documentar a entrada e saída de veículos com fotos e vídeos, organizados por ordem de serviço.',
      },
      {
        id: `msg3_4_${ts}`,
        type: 'divider',
      },
      {
        id: `msg3_5_${ts}`,
        type: 'list',
        ordered: false,
        items: [
          '**Check-in**: Ao receber o veículo, registre fotos e vídeos do estado de entrada. Os arquivos são organizados por ordem de serviço, permitindo documentar cada área separadamente',
          '**Check-out**: Após a conclusão dos serviços, registre fotos e vídeos do estado de saída do veículo. A seção de check-out fica disponível quando a tarefa é concluída',
          '**Organização por Ordem de Serviço**: Cada ordem de serviço possui seus próprios campos de check-in e check-out, facilitando a comparação do antes e depois por serviço',
          '**Fotos e Vídeos**: Suporte a imagens (JPEG, PNG, WebP) e vídeos (MP4, MOV, WebM) com até 500MB por arquivo e no máximo 20 arquivos por ordem de serviço',
          '**Armazenamento Organizado**: Os arquivos são salvos automaticamente na pasta do cliente correto, organizados por tarefa e tipo (check-in ou check-out)',
        ],
      },
      {
        id: `msg3_6_${ts}`,
        type: 'divider',
      },
      {
        id: `msg3_7_${ts}`,
        type: 'quote',
        content:
          'O check-in deve ser realizado pela Logística ou Gerente de Produção assim que o veículo chega. O check-out deve ser feito após a conclusão de todos os serviços, antes da liberação do veículo.',
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Message 4: Conclusão de Tarefas pela Produção
// Target: PRODUCTION_MANAGER only
// ─────────────────────────────────────────────────────────────────────────────

const message4 = {
  title: 'Conclusão de Tarefas — Nova Responsabilidade',
  targetSectors: ['PRODUCTION_MANAGER'],
  content: {
    blocks: [
      {
        id: `msg4_1_${ts}`,
        type: 'image',
        alt: 'Ankaa Design',
        url: LOGO_URL,
        size: '128px',
        alignment: 'left',
      },
      {
        id: `msg4_2_${ts}`,
        type: 'heading3',
        content: 'Conclusão de Tarefas — Nova Responsabilidade',
        fontSize: 'lg',
      },
      {
        id: `msg4_3_${ts}`,
        type: 'paragraph',
        content:
          'A partir de agora, quando todas as ordens de serviço de Produção forem concluídas, a tarefa não será finalizada automaticamente. A tarefa permanecerá com status "Em Produção" até que o Gerente de Produção finalize manualmente.',
      },
      {
        id: `msg4_4_${ts}`,
        type: 'divider',
      },
      {
        id: `msg4_5_${ts}`,
        type: 'list',
        ordered: false,
        items: [
          '**Antes**: Quando todas as ordens de serviço de produção eram concluídas, a tarefa era finalizada automaticamente',
          '**Agora**: A tarefa permanece "Em Produção" mesmo após todas as ordens de serviço serem concluídas. Somente o Gerente de Produção ou a Administração pode alterar o status para "Concluída"',
          '**Por quê**: Isso permite que o gerente verifique a qualidade do trabalho, realize o check-out do veículo e confirme que tudo está em ordem antes de liberar a tarefa',
          '**Como finalizar**: Acesse a tarefa e altere o status para "Concluída" quando todos os serviços estiverem verificados e o veículo estiver pronto para retirada',
        ],
      },
      {
        id: `msg4_6_${ts}`,
        type: 'divider',
      },
      {
        id: `msg4_7_${ts}`,
        type: 'quote',
        content:
          'Essa mudança garante que nenhum veículo seja liberado sem a verificação final do Gerente de Produção. Fique atento às tarefas com todas as ordens de serviço concluídas para finalizá-las.',
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Seed execution
// ─────────────────────────────────────────────────────────────────────────────

const ALL_MESSAGES = [message1, message2, message3, message4];

async function main() {
  for (const msg of ALL_MESSAGES) {
    console.log(`\n── ${msg.title} ──`);
    console.log(`   Setores alvo: ${msg.targetSectors.join(', ')}`);

    const targetUsers = await prisma.user.findMany({
      where: {
        status: { not: 'DISMISSED' },
        sector: {
          privileges: { in: msg.targetSectors as unknown as string[] },
        },
      },
      select: {
        id: true,
        name: true,
        sector: { select: { name: true, privileges: true } },
      },
    });

    console.log(`   Destinatários (${targetUsers.length}):`);
    for (const user of targetUsers) {
      console.log(`     • ${user.name} (${user.sector?.name})`);
    }

    const targetUserIds = targetUsers.map((u) => u.id);

    if (targetUserIds.length === 0) {
      console.error('   ⚠ Nenhum usuário encontrado! Pulando.');
      continue;
    }

    const message = await prisma.message.create({
      data: {
        title: msg.title,
        content: msg.content,
        status: 'ACTIVE',
        statusOrder: 3,
        isDismissible: true,
        requiresView: false,
        createdById: CREATED_BY_ID,
        publishedAt: now,
      },
    });
    console.log(`   ✓ Mensagem criada: ${message.id}`);

    await prisma.messageTarget.createMany({
      data: targetUserIds.map((userId) => ({
        messageId: message.id,
        userId,
      })),
    });
    console.log(`   ✓ ${targetUserIds.length} destinatários adicionados`);
  }

  console.log('\n✅ Todas as mensagens foram criadas com sucesso!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
