import { Injectable } from '@nestjs/common';
import {
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_ACTION_TYPE,
  NOTIFICATION_CHANNEL,
} from '../../../../constants/enums';

// =====================
// Template Interfaces
// =====================
// Types are imported from template.types.ts to avoid duplication

import type {
  NotificationTemplate,
  WhatsAppTemplate,
  EmailTemplate,
  RenderedNotification,
} from './template.types';

// =====================
// Notification Templates
// =====================

const TEMPLATES: Record<string, NotificationTemplate> = {
  // =====================
  // Task Templates
  // =====================

  'task.created': {
    title: data => `Nova Tarefa Criada`,
    body: data =>
      `Tarefa "${data.taskName}" foi criada e atribuída ao setor ${data.sectorName}${data.serialNumber ? ` (${data.serialNumber})` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.TASK_CREATED,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'task.status': {
    title: data => `Status da Tarefa Atualizado`,
    body: data =>
      `Tarefa "${data.taskName}" mudou de "${data.oldStatus}" para "${data.newStatus}"${data.changedBy ? ` por ${data.changedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.TASK_UPDATED,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'task.deadline': {
    title: data => `Prazo da Tarefa se Aproximando`,
    body: data =>
      `Tarefa "${data.taskName}" tem prazo em ${data.daysRemaining} ${data.daysRemaining === 1 ? 'dia' : 'dias'}${data.serialNumber ? ` (${data.serialNumber})` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.URGENT,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'task.deadline.critical': {
    title: data => `Prazo da Tarefa - URGENTE`,
    body: data =>
      `ATENÇÃO: Tarefa "${data.taskName}" tem prazo em apenas ${data.daysRemaining} ${data.daysRemaining === 1 ? 'dia' : 'dias'}! Ação imediata necessária.`,
    importance: NOTIFICATION_IMPORTANCE.URGENT,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.EMAIL],
  },

  'task.overdue': {
    title: data => `Tarefa Atrasada`,
    body: data =>
      `Tarefa "${data.taskName}" está atrasada há ${data.daysOverdue} ${data.daysOverdue === 1 ? 'dia' : 'dias'}${data.serialNumber ? ` (${data.serialNumber})` : ''}!`,
    importance: NOTIFICATION_IMPORTANCE.URGENT,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.EMAIL],
  },

  'task.term': {
    title: data => `Prazo da Tarefa Alterado`,
    body: data =>
      `Prazo da tarefa "${data.taskName}" foi alterado de ${data.oldValue} para ${data.newValue}${data.changedBy ? ` por ${data.changedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.TASK_UPDATED,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'task.forecastDate': {
    title: data => `Data de Previsão Atualizada`,
    body: data =>
      `Data de previsão da tarefa "${data.taskName}" foi alterada de ${data.oldValue} para ${data.newValue}${data.changedBy ? ` por ${data.changedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.TASK_UPDATED,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'task.sector': {
    title: data => `Tarefa Transferida de Setor`,
    body: data =>
      `Tarefa "${data.taskName}" foi transferida de ${data.oldSector} para ${data.newSector}${data.changedBy ? ` por ${data.changedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.TASK_UPDATED,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'task.artwork.added': {
    title: data => `Arte Adicionada à Tarefa`,
    body: data =>
      `Arquivos de arte foram adicionados à tarefa "${data.taskName}"${data.fileCount ? ` (${data.fileCount} ${data.fileCount === 1 ? 'arquivo' : 'arquivos'})` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'task.artwork.updated': {
    title: data => `Arte da Tarefa Atualizada`,
    body: data =>
      `Arquivos de arte da tarefa "${data.taskName}" foram atualizados${data.changedBy ? ` por ${data.changedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'task.artwork.removed': {
    title: data => `Arte Removida da Tarefa`,
    body: data =>
      `Arquivos de arte foram removidos da tarefa "${data.taskName}"${data.changedBy ? ` por ${data.changedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'task.budget.added': {
    title: data => `Orçamento Adicionado`,
    body: data =>
      `Novo orçamento foi adicionado à tarefa "${data.taskName}"${data.budgetValue ? ` no valor de ${data.budgetValue}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'task.budget.updated': {
    title: data => `Orçamento Atualizado`,
    body: data =>
      `Orçamento da tarefa "${data.taskName}" foi atualizado${data.changedBy ? ` por ${data.changedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'task.budget.approved': {
    title: data => `Orçamento Aprovado`,
    body: data =>
      `Orçamento da tarefa "${data.taskName}" foi aprovado${data.approvedBy ? ` por ${data.approvedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'task.invoice.added': {
    title: data => `Nota Fiscal Adicionada`,
    body: data =>
      `Nota fiscal foi adicionada à tarefa "${data.taskName}"${data.invoiceNumber ? ` (NF ${data.invoiceNumber})` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'task.invoice.updated': {
    title: data => `Nota Fiscal Atualizada`,
    body: data =>
      `Nota fiscal da tarefa "${data.taskName}" foi atualizada${data.changedBy ? ` por ${data.changedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'task.receipt.added': {
    title: data => `Recibo Adicionado`,
    body: data =>
      `Recibo foi adicionado à tarefa "${data.taskName}"${data.receiptValue ? ` no valor de ${data.receiptValue}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'task.commission.updated': {
    title: data => `Status da Comissão Atualizado`,
    body: data =>
      `Status da comissão da tarefa "${data.taskName}" foi alterado de "${data.oldStatus}" para "${data.newStatus}".`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'task.priority.changed': {
    title: data => `Prioridade da Tarefa Alterada`,
    body: data =>
      `Prioridade da tarefa "${data.taskName}" foi alterada de "${data.oldPriority}" para "${data.newPriority}"${data.changedBy ? ` por ${data.changedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'task.completed': {
    title: data => `Tarefa Concluída`,
    body: data =>
      `Tarefa "${data.taskName}" foi concluída com sucesso${data.completedBy ? ` por ${data.completedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'task.cancelled': {
    title: data => `Tarefa Cancelada`,
    body: data =>
      `Tarefa "${data.taskName}" foi cancelada${data.cancelledBy ? ` por ${data.cancelledBy}` : ''}${data.reason ? `. Motivo: ${data.reason}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'task.comment.added': {
    title: data => `Novo Comentário na Tarefa`,
    body: data =>
      `${data.userName} adicionou um comentário na tarefa "${data.taskName}": "${data.commentPreview}"`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  // =====================
  // Order Templates
  // =====================

  'order.created': {
    title: data => `Novo Pedido Criado`,
    body: data =>
      `Pedido #${data.orderNumber} para ${data.supplierName} foi criado${data.createdBy ? ` por ${data.createdBy}` : ''}${data.totalValue ? ` no valor de ${data.totalValue}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_ORDER,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'order.status': {
    title: data => `Status do Pedido Atualizado`,
    body: data =>
      `Pedido #${data.orderNumber} mudou de "${data.oldStatus}" para "${data.newStatus}"${data.changedBy ? ` por ${data.changedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_ORDER,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'order.overdue': {
    title: data => `Pedido Atrasado`,
    body: data =>
      `Pedido #${data.orderNumber} para ${data.supplierName} está atrasado há ${data.daysOverdue} ${data.daysOverdue === 1 ? 'dia' : 'dias'}!`,
    importance: NOTIFICATION_IMPORTANCE.URGENT,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_ORDER,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.EMAIL],
  },

  'order.received': {
    title: data => `Pedido Recebido`,
    body: data =>
      `Pedido #${data.orderNumber} foi recebido completamente${data.receivedBy ? ` por ${data.receivedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_ORDER,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'order.partially_received': {
    title: data => `Pedido Parcialmente Recebido`,
    body: data =>
      `Pedido #${data.orderNumber} foi parcialmente recebido${data.percentage ? ` (${data.percentage}%)` : ''}${data.receivedBy ? ` por ${data.receivedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_ORDER,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'order.item.received': {
    title: data => `Item do Pedido Recebido`,
    body: data =>
      `Item "${data.itemName}" do pedido #${data.orderNumber} foi recebido${data.quantity ? ` (${data.quantity} unidades)` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_ORDER,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'order.cancelled': {
    title: data => `Pedido Cancelado`,
    body: data =>
      `Pedido #${data.orderNumber} foi cancelado${data.cancelledBy ? ` por ${data.cancelledBy}` : ''}${data.reason ? `. Motivo: ${data.reason}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_ORDER,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'order.deadline.approaching': {
    title: data => `Prazo de Entrega se Aproximando`,
    body: data =>
      `Pedido #${data.orderNumber} tem prazo de entrega em ${data.daysRemaining} ${data.daysRemaining === 1 ? 'dia' : 'dias'}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_ORDER,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  // =====================
  // Service Order Templates
  // =====================

  'service-order.created': {
    title: data => `Nova Ordem de Serviço Criada`,
    body: data =>
      `Ordem de serviço "${data.serviceOrderDescription}" foi criada para a tarefa "${data.taskName}"${data.creatorName ? ` por ${data.creatorName}` : ''} (Tipo: ${data.serviceOrderType}).`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [
      NOTIFICATION_CHANNEL.IN_APP,
      NOTIFICATION_CHANNEL.PUSH,
      NOTIFICATION_CHANNEL.WHATSAPP,
    ],
  },

  'service-order.status.changed': {
    title: data => `Ordem de Serviço Atualizada`,
    body: data =>
      `Ordem de serviço "${data.serviceOrderDescription}" da tarefa "${data.taskName}" mudou de "${data.oldStatus}" para "${data.newStatus}"${data.changedByName ? ` por ${data.changedByName}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [
      NOTIFICATION_CHANNEL.IN_APP,
      NOTIFICATION_CHANNEL.PUSH,
      NOTIFICATION_CHANNEL.WHATSAPP,
    ],
  },

  'service-order.completed': {
    title: data => `Ordem de Serviço Concluída`,
    body: data =>
      `Ordem de serviço "${data.serviceOrderDescription}" da tarefa "${data.taskName}" foi concluída${data.completedBy ? ` por ${data.completedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'service-order.assigned': {
    title: data => `Nova Ordem de Serviço Atribuída`,
    body: data =>
      `Você foi atribuído à ordem de serviço "${data.serviceOrderDescription}" da tarefa "${data.taskName}" (Tipo: ${data.serviceOrderType}).`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [
      NOTIFICATION_CHANNEL.IN_APP,
      NOTIFICATION_CHANNEL.PUSH,
      NOTIFICATION_CHANNEL.WHATSAPP,
    ],
  },

  'service-order.artwork-waiting-approval': {
    title: data => `Arte Aguardando Aprovação`,
    body: data =>
      `Ordem de serviço de arte "${data.serviceOrderDescription}" da tarefa "${data.taskName}" está aguardando aprovação.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.APPROVE_REQUEST,
    channels: [
      NOTIFICATION_CHANNEL.IN_APP,
      NOTIFICATION_CHANNEL.PUSH,
      NOTIFICATION_CHANNEL.WHATSAPP,
    ],
  },

  'service-order.assigned-user-updated': {
    title: data => `Ordem de Serviço Atualizada`,
    body: data =>
      `A ordem de serviço "${data.serviceOrderDescription}" da tarefa "${data.taskName}" teve ${data.changesText} alterados por ${data.changedByName}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [
      NOTIFICATION_CHANNEL.IN_APP,
      NOTIFICATION_CHANNEL.PUSH,
      NOTIFICATION_CHANNEL.WHATSAPP,
    ],
  },

  // =====================
  // Stock Templates
  // =====================

  'stock.low': {
    title: data => `Estoque Baixo`,
    body: data =>
      `${data.itemName} está com estoque baixo (${data.currentQuantity} unidades restantes). Recomenda-se reabastecer.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'stock.critical': {
    title: data => `Estoque Crítico`,
    body: data =>
      `ATENÇÃO: ${data.itemName} está em nível crítico (${data.currentQuantity} unidades). Reabastecimento urgente necessário!`,
    importance: NOTIFICATION_IMPORTANCE.URGENT,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.EMAIL],
  },

  'stock.out': {
    title: data => `Estoque Esgotado`,
    body: data =>
      `${data.itemName} está sem estoque! Ação imediata necessária para reabastecimento.`,
    importance: NOTIFICATION_IMPORTANCE.URGENT,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.EMAIL],
  },

  'stock.negative': {
    title: data => `Estoque Negativo Detectado`,
    body: data =>
      `ALERTA: ${data.itemName} está com estoque negativo (${data.currentQuantity}). Verifique inconsistências no sistema.`,
    importance: NOTIFICATION_IMPORTANCE.URGENT,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.EMAIL],
  },

  'stock.reorder': {
    title: data => `Ponto de Reabastecimento Atingido`,
    body: data =>
      `${data.itemName} atingiu o ponto de reabastecimento (${data.currentQuantity}/${data.reorderPoint}). Considere fazer um novo pedido.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'stock.overstocked': {
    title: data => `Excesso de Estoque`,
    body: data =>
      `${data.itemName} está acima do nível ideal de estoque (${data.currentQuantity}/${data.maxQuantity}). Considere reduzir pedidos.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'stock.movement.large': {
    title: data => `Movimentação Significativa de Estoque`,
    body: data =>
      `Movimentação significativa detectada: ${data.itemName} teve ${data.operation} de ${data.quantity} unidades${data.userName ? ` por ${data.userName}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  // =====================
  // PPE (EPI) Templates
  // =====================

  'ppe.request.created': {
    title: data => `Nova Solicitação de EPI`,
    body: data =>
      `${data.userName} solicitou EPIs${data.itemCount ? ` (${data.itemCount} ${data.itemCount === 1 ? 'item' : 'itens'})` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.APPROVE_REQUEST,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'ppe.request.approved': {
    title: data => `Solicitação de EPI Aprovada`,
    body: data =>
      `Sua solicitação de EPI foi aprovada${data.approvedBy ? ` por ${data.approvedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'ppe.request.rejected': {
    title: data => `Solicitação de EPI Rejeitada`,
    body: data =>
      `Sua solicitação de EPI foi rejeitada${data.rejectedBy ? ` por ${data.rejectedBy}` : ''}${data.reason ? `. Motivo: ${data.reason}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'ppe.delivery.ready': {
    title: data => `EPI Pronto para Retirada`,
    body: data =>
      `Seu EPI está pronto para retirada${data.location ? ` no ${data.location}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'ppe.delivery.completed': {
    title: data => `EPI Entregue`,
    body: data =>
      `EPI foi entregue para ${data.userName}${data.deliveredBy ? ` por ${data.deliveredBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'ppe.expiring.soon': {
    title: data => `EPI Próximo ao Vencimento`,
    body: data =>
      `Seu EPI "${data.itemName}" vence em ${data.daysRemaining} ${data.daysRemaining === 1 ? 'dia' : 'dias'}. Solicite a substituição.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'ppe.expired': {
    title: data => `EPI Vencido`,
    body: data =>
      `Seu EPI "${data.itemName}" está vencido! Não utilize e solicite substituição imediatamente.`,
    importance: NOTIFICATION_IMPORTANCE.URGENT,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.EMAIL],
  },

  // =====================
  // Vacation Templates
  // =====================

  'vacation.request.created': {
    title: data => `Nova Solicitação de Férias`,
    body: data =>
      `${data.userName} solicitou férias de ${data.startDate} a ${data.endDate} (${data.days} dias).`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.APPROVE_REQUEST,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'vacation.request.approved': {
    title: data => `Férias Aprovadas`,
    body: data =>
      `Suas férias de ${data.startDate} a ${data.endDate} foram aprovadas${data.approvedBy ? ` por ${data.approvedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.EMAIL],
  },

  'vacation.request.rejected': {
    title: data => `Férias Rejeitadas`,
    body: data =>
      `Sua solicitação de férias foi rejeitada${data.rejectedBy ? ` por ${data.rejectedBy}` : ''}${data.reason ? `. Motivo: ${data.reason}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.EMAIL],
  },

  'vacation.starting.soon': {
    title: data => `Férias se Aproximando`,
    body: data =>
      `Suas férias começam em ${data.daysRemaining} ${data.daysRemaining === 1 ? 'dia' : 'dias'} (${data.startDate}).`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'vacation.started': {
    title: data => `Férias Iniciadas`,
    body: data => `Suas férias começaram hoje! Aproveite seu descanso.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'vacation.ending.soon': {
    title: data => `Férias Terminando`,
    body: data =>
      `Suas férias terminam em ${data.daysRemaining} ${data.daysRemaining === 1 ? 'dia' : 'dias'} (${data.endDate}). Prepare-se para o retorno.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  // =====================
  // System Templates
  // =====================

  'system.maintenance.scheduled': {
    title: data => `Manutenção Programada`,
    body: data =>
      `Manutenção do sistema agendada para ${data.startDate} às ${data.startTime}. Duração estimada: ${data.duration}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.ACKNOWLEDGE,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.EMAIL],
  },

  'system.maintenance.starting': {
    title: data => `Manutenção Iniciando`,
    body: data =>
      `Manutenção do sistema iniciará em ${data.minutesRemaining} minutos. Salve seu trabalho.`,
    importance: NOTIFICATION_IMPORTANCE.URGENT,
    actionType: NOTIFICATION_ACTION_TYPE.ACKNOWLEDGE,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.EMAIL],
  },

  'system.maintenance.completed': {
    title: data => `Manutenção Concluída`,
    body: data => `Manutenção do sistema foi concluída. O sistema está novamente disponível.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.ACKNOWLEDGE,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'system.warning': {
    title: data => `Aviso do Sistema`,
    body: data => `${data.message}`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.ACKNOWLEDGE,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'system.error': {
    title: data => `Erro do Sistema`,
    body: data => `Um erro foi detectado: ${data.errorMessage}. Nossa equipe foi notificada.`,
    importance: NOTIFICATION_IMPORTANCE.URGENT,
    actionType: NOTIFICATION_ACTION_TYPE.ACKNOWLEDGE,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'system.announcement': {
    title: data => `${data.title}`,
    body: data => `${data.message}`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.ACKNOWLEDGE,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'system.update.available': {
    title: data => `Atualização Disponível`,
    body: data =>
      `Nova versão do sistema disponível (${data.version}). ${data.description || 'Atualize para obter novos recursos e melhorias.'}`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.ACKNOWLEDGE,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  // =====================
  // User Templates
  // =====================

  'user.birthday': {
    title: data => `Feliz Aniversário!`,
    body: data => `Parabéns, ${data.userName}! Desejamos um ótimo dia e muito sucesso!`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.ACKNOWLEDGE,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'user.anniversary': {
    title: data => `Aniversário de Empresa`,
    body: data =>
      `Parabéns, ${data.userName}! Hoje você completa ${data.years} ${data.years === 1 ? 'ano' : 'anos'} na empresa. Obrigado pela dedicação!`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.ACKNOWLEDGE,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  'user.profile.updated': {
    title: data => `Perfil Atualizado`,
    body: data => `Seu perfil foi atualizado com sucesso.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'user.password.changed': {
    title: data => `Senha Alterada`,
    body: data =>
      `Sua senha foi alterada com sucesso. Se não foi você, contate o administrador imediatamente.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.ACKNOWLEDGE,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
  },

  'user.role.changed': {
    title: data => `Função Alterada`,
    body: data =>
      `Sua função foi alterada de "${data.oldRole}" para "${data.newRole}"${data.changedBy ? ` por ${data.changedBy}` : ''}.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
  },

  // =====================
  // Report Templates
  // =====================

  'report.generated': {
    title: data => `Relatório Gerado`,
    body: data =>
      `O relatório "${data.reportName}" foi gerado com sucesso e está disponível para download.`,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionType: NOTIFICATION_ACTION_TYPE.VIEW_REPORT,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },

  'report.failed': {
    title: data => `Falha ao Gerar Relatório`,
    body: data =>
      `Houve um erro ao gerar o relatório "${data.reportName}". Tente novamente ou contate o suporte.`,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    actionType: NOTIFICATION_ACTION_TYPE.ACKNOWLEDGE,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
  },
};

// =====================
// WhatsApp Templates
// =====================

const WHATSAPP_TEMPLATES: Record<string, WhatsAppTemplate> = {
  'task.created': data =>
    `
🔔 *Nova Tarefa Criada*

Tarefa: ${data.taskName}
Setor: ${data.sectorName}
${data.serialNumber ? `Série: ${data.serialNumber}` : ''}

Ver detalhes: ${data.url}
  `.trim(),

  'task.status': data =>
    `
🔔 *Status da Tarefa Atualizado*

Tarefa: ${data.taskName}
Status: ${data.oldStatus} → ${data.newStatus}
${data.changedBy ? `Alterado por: ${data.changedBy}` : ''}

Ver detalhes: ${data.url}
  `.trim(),

  'task.deadline': data =>
    `
⏰ *Prazo da Tarefa se Aproximando*

Tarefa: ${data.taskName}
Prazo: ${data.daysRemaining} ${data.daysRemaining === 1 ? 'dia' : 'dias'}
${data.serialNumber ? `Série: ${data.serialNumber}` : ''}

Ver detalhes: ${data.url}
  `.trim(),

  'task.overdue': data =>
    `
🚨 *Tarefa Atrasada*

Tarefa: ${data.taskName}
Atrasada há: ${data.daysOverdue} ${data.daysOverdue === 1 ? 'dia' : 'dias'}
${data.serialNumber ? `Série: ${data.serialNumber}` : ''}

*AÇÃO URGENTE NECESSÁRIA*

Ver detalhes: ${data.url}
  `.trim(),

  'order.created': data =>
    `
📦 *Novo Pedido Criado*

Pedido: #${data.orderNumber}
Fornecedor: ${data.supplierName}
${data.totalValue ? `Valor: ${data.totalValue}` : ''}

Ver detalhes: ${data.url}
  `.trim(),

  'order.overdue': data =>
    `
🚨 *Pedido Atrasado*

Pedido: #${data.orderNumber}
Fornecedor: ${data.supplierName}
Atrasado há: ${data.daysOverdue} ${data.daysOverdue === 1 ? 'dia' : 'dias'}

Ver detalhes: ${data.url}
  `.trim(),

  'stock.low': data =>
    `
⚠️ *Estoque Baixo*

Item: ${data.itemName}
Quantidade: ${data.currentQuantity} unidades

Recomenda-se reabastecer.

Ver detalhes: ${data.url}
  `.trim(),

  'stock.out': data =>
    `
🚨 *Estoque Esgotado*

Item: ${data.itemName}

*AÇÃO IMEDIATA NECESSÁRIA*

Ver detalhes: ${data.url}
  `.trim(),

  'ppe.request.approved': data =>
    `
✅ *Solicitação de EPI Aprovada*

${data.approvedBy ? `Aprovado por: ${data.approvedBy}` : ''}

Aguarde instruções para retirada.

Ver detalhes: ${data.url}
  `.trim(),

  'vacation.request.approved': data =>
    `
🏖️ *Férias Aprovadas*

Período: ${data.startDate} a ${data.endDate}
Dias: ${data.days}
${data.approvedBy ? `Aprovado por: ${data.approvedBy}` : ''}

Aproveite suas férias!

Ver detalhes: ${data.url}
  `.trim(),

  'system.maintenance.scheduled': data =>
    `
🔧 *Manutenção Programada*

Data: ${data.startDate} às ${data.startTime}
Duração: ${data.duration}

Planeje suas atividades de acordo.
  `.trim(),
};

// =====================
// Email Templates
// =====================

const EMAIL_TEMPLATES: Record<string, EmailTemplate> = {
  'task.deadline.critical': {
    subject: data => `URGENTE: Prazo da Tarefa "${data.taskName}" se Aproximando`,
    body: data =>
      `
Olá,

Esta é uma notificação urgente sobre o prazo de uma tarefa:

Tarefa: ${data.taskName}
${data.serialNumber ? `Série: ${data.serialNumber}` : ''}
Prazo: ${data.daysRemaining} ${data.daysRemaining === 1 ? 'dia' : 'dias'}

Ação imediata é necessária para garantir a conclusão dentro do prazo.

Acesse o sistema para mais detalhes: ${data.url}

Atenciosamente,
Sistema de Gestão
    `.trim(),
    html: data =>
      `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #f44336; color: white; padding: 20px; text-align: center; }
    .content { background-color: #f9f9f9; padding: 20px; margin-top: 20px; }
    .info { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #f44336; }
    .button { display: inline-block; padding: 10px 20px; background-color: #f44336; color: white; text-decoration: none; border-radius: 5px; margin-top: 15px; }
    .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚠️ URGENTE: Prazo se Aproximando</h1>
    </div>
    <div class="content">
      <p>Olá,</p>
      <p>Esta é uma notificação urgente sobre o prazo de uma tarefa:</p>
      <div class="info">
        <strong>Tarefa:</strong> ${data.taskName}<br>
        ${data.serialNumber ? `<strong>Série:</strong> ${data.serialNumber}<br>` : ''}
        <strong>Prazo:</strong> ${data.daysRemaining} ${data.daysRemaining === 1 ? 'dia' : 'dias'}<br>
      </div>
      <p><strong>Ação imediata é necessária</strong> para garantir a conclusão dentro do prazo.</p>
      <a href="${data.url}" class="button">Ver Detalhes</a>
    </div>
    <div class="footer">
      <p>Sistema de Gestão - Notificação Automática</p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  },

  'task.overdue': {
    subject: data => `URGENTE: Tarefa "${data.taskName}" Atrasada`,
    body: data =>
      `
Olá,

Uma tarefa está atrasada:

Tarefa: ${data.taskName}
${data.serialNumber ? `Série: ${data.serialNumber}` : ''}
Atrasada há: ${data.daysOverdue} ${data.daysOverdue === 1 ? 'dia' : 'dias'}

Por favor, tome providências imediatas.

Acesse o sistema para mais detalhes: ${data.url}

Atenciosamente,
Sistema de Gestão
    `.trim(),
    html: data =>
      `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #d32f2f; color: white; padding: 20px; text-align: center; }
    .content { background-color: #f9f9f9; padding: 20px; margin-top: 20px; }
    .info { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #d32f2f; }
    .alert { background-color: #ffebee; padding: 15px; margin: 15px 0; border-radius: 5px; }
    .button { display: inline-block; padding: 10px 20px; background-color: #d32f2f; color: white; text-decoration: none; border-radius: 5px; margin-top: 15px; }
    .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚨 URGENTE: Tarefa Atrasada</h1>
    </div>
    <div class="content">
      <div class="alert">
        <strong>⚠️ Esta tarefa está atrasada e requer ação imediata!</strong>
      </div>
      <div class="info">
        <strong>Tarefa:</strong> ${data.taskName}<br>
        ${data.serialNumber ? `<strong>Série:</strong> ${data.serialNumber}<br>` : ''}
        <strong>Atrasada há:</strong> ${data.daysOverdue} ${data.daysOverdue === 1 ? 'dia' : 'dias'}<br>
      </div>
      <p>Por favor, tome providências imediatas para resolver esta situação.</p>
      <a href="${data.url}" class="button">Ver Detalhes</a>
    </div>
    <div class="footer">
      <p>Sistema de Gestão - Notificação Automática</p>
    </div>
  </div>
</body>
</html>
    `.trim(),
  },

  'order.overdue': {
    subject: data => `URGENTE: Pedido #${data.orderNumber} Atrasado`,
    body: data =>
      `
Olá,

Um pedido está atrasado:

Pedido: #${data.orderNumber}
Fornecedor: ${data.supplierName}
Atrasado há: ${data.daysOverdue} ${data.daysOverdue === 1 ? 'dia' : 'dias'}

Por favor, contate o fornecedor e verifique o status da entrega.

Acesse o sistema para mais detalhes: ${data.url}

Atenciosamente,
Sistema de Gestão
    `.trim(),
  },

  'stock.critical': {
    subject: data => `URGENTE: Estoque Crítico - ${data.itemName}`,
    body: data =>
      `
Olá,

Um item está em nível crítico de estoque:

Item: ${data.itemName}
Quantidade atual: ${data.currentQuantity} unidades

AÇÃO URGENTE: Reabastecimento necessário imediatamente.

Acesse o sistema para mais detalhes: ${data.url}

Atenciosamente,
Sistema de Gestão
    `.trim(),
  },

  'vacation.request.approved': {
    subject: data => `Férias Aprovadas - ${data.startDate} a ${data.endDate}`,
    body: data =>
      `
Olá ${data.userName},

Sua solicitação de férias foi aprovada!

Período: ${data.startDate} a ${data.endDate}
Dias: ${data.days}
${data.approvedBy ? `Aprovado por: ${data.approvedBy}` : ''}

Aproveite suas férias!

Acesse o sistema para mais detalhes: ${data.url}

Atenciosamente,
Sistema de Gestão
    `.trim(),
  },

  'system.maintenance.scheduled': {
    subject: data => `Manutenção Programada do Sistema - ${data.startDate}`,
    body: data =>
      `
Prezado(a),

Informamos que haverá manutenção programada do sistema:

Data: ${data.startDate} às ${data.startTime}
Duração estimada: ${data.duration}

Durante este período, o sistema poderá ficar indisponível.
Por favor, salve seu trabalho e planeje suas atividades de acordo.

Agradecemos a compreensão.

Atenciosamente,
Equipe de TI
    `.trim(),
  },
};

// =====================
// Template Service
// =====================

@Injectable()
export class NotificationTemplateService {
  /**
   * Render a notification template
   */
  render(templateKey: string, data: any): RenderedNotification {
    const template = TEMPLATES[templateKey];

    if (!template) {
      throw new Error(`Notification template "${templateKey}" not found`);
    }

    return {
      title: template.title(data),
      body: template.body(data),
      importance: template.importance,
      actionType: template.actionType,
      channels: template.channels,
    };
  }

  /**
   * Render a WhatsApp template
   */
  renderWhatsApp(templateKey: string, data: any): string {
    const template = WHATSAPP_TEMPLATES[templateKey];

    if (!template) {
      // Fallback to basic notification if WhatsApp template doesn't exist
      const notification = this.render(templateKey, data);
      return `🔔 *${notification.title}*\n\n${notification.body}\n\n${data.url ? `Ver detalhes: ${data.url}` : ''}`;
    }

    return template(data);
  }

  /**
   * Render an email template
   */
  renderEmail(templateKey: string, data: any): { subject: string; body: string; html?: string } {
    const template = EMAIL_TEMPLATES[templateKey];

    if (!template) {
      // Fallback to basic notification if email template doesn't exist
      const notification = this.render(templateKey, data);
      return {
        subject: notification.title,
        body: `${notification.body}\n\n${data.url ? `Ver detalhes: ${data.url}` : ''}`,
      };
    }

    return {
      subject: template.subject(data),
      body: template.body(data),
      html: template.html ? template.html(data) : undefined,
    };
  }

  /**
   * Check if a template exists
   */
  hasTemplate(templateKey: string): boolean {
    return templateKey in TEMPLATES;
  }

  /**
   * Get all available template keys
   */
  getAvailableTemplates(): string[] {
    return Object.keys(TEMPLATES);
  }

  /**
   * Get template metadata
   */
  getTemplateMetadata(templateKey: string): {
    importance: NOTIFICATION_IMPORTANCE;
    actionType: NOTIFICATION_ACTION_TYPE;
    channels?: NOTIFICATION_CHANNEL[];
  } | null {
    const template = TEMPLATES[templateKey];

    if (!template) {
      return null;
    }

    return {
      importance: template.importance,
      actionType: template.actionType,
      channels: template.channels,
    };
  }
}
