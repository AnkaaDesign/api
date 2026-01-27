/**
 * Service Order Description Enums by Type
 *
 * These enums define the standardized service descriptions for each service order type.
 * Used for both ServiceOrder and TaskPricingItem descriptions.
 * All descriptions are in Title Case with Portuguese prepositions lowercase.
 */

import { SERVICE_ORDER_TYPE } from './enums';

// =====================
// PRODUCTION - Physical Work Actions (48 items including Outros)
// =====================
export const PRODUCTION_SERVICE_DESCRIPTIONS = [
  // Adesivo
  'Adesivo Cabine',
  'Adesivo Portas Traseiras',

  // Aerografia
  'Aerografia Lateral',
  'Aerografia Laterais',
  'Aerografia Parcial',
  'Aerografia Traseira',

  // Faixa
  'Faixa Veículo Longo Traseira',

  // Logomarca
  'Logomarca Lateral',
  'Logomarca Laterais',
  'Logomarca no Teto',
  'Logomarca Parcial',
  'Logomarca Plataforma',
  'Logomarca Portas Traseiras',

  // Pintura
  'Pintura Caixa de Cozinha',
  'Pintura Caixa de Ferramentas',
  'Pintura Carenagens de Frio',
  'Pintura Chassi',
  'Pintura Cubos das Rodas',
  'Pintura Frontal',
  'Pintura Frota no Teto',
  'Pintura Lateral',
  'Pintura Laterais',
  'Pintura Para-choque',
  'Pintura Parcial',
  'Pintura Pés Mecânicos',
  'Pintura Placa no Teto',
  'Pintura Quadro Frontal',
  'Pintura Quadro Lateral',
  'Pintura Quadro Traseiro',
  'Pintura Rodas',
  'Pintura Teto',
  'Pintura Traseira',

  // Plotagem
  'Plotagem Cabine',
  'Plotagem Portas Traseiras',

  // Remoção
  'Remoção Lateral',
  'Remoção Laterais',
  'Remoção Parcial',

  // Reparos
  'Reparos Carenagens de Frio',
  'Reparos Superficiais',

  // Troca de Faixas Refletivas
  'Troca de Faixas Refletivas',
  'Troca de Faixas Refletivas do Para-choque',

  // Vedação
  'Vedação Externa',

  // Verniz
  'Verniz Frontal',
  'Verniz Laterais',
  'Verniz Parcial',
  'Verniz Traseira',

  // Outros
  'Outros',
] as const;

// =====================
// COMMERCIAL - Sales Actions (52 items including Em Negociação + Outros)
// =====================
export const COMMERCIAL_SERVICE_DESCRIPTIONS = [
  // Default for new tasks
  'Em Negociação',
  // Orçamento - Ações
  'Elaborar Orçamento',
  'Enviar Orçamento',
  'Reenviar Orçamento',
  'Revisar Orçamento',
  'Ajustar Orçamento',
  'Detalhar Orçamento',
  'Orçamento Urgente',
  'Orçamento Frota',
  'Orçamento Parcial',
  'Orçamento Complementar',
  // Proposta e Negociação
  'Apresentar Proposta',
  'Negociar Valor',
  'Negociar Prazo',
  'Negociar Condições',
  'Aplicar Desconto',
  'Proposta Especial',
  'Contraproposta',
  'Fechar Negócio',
  // Comunicação com Cliente
  'Ligar para Cliente',
  'Retornar Ligação',
  'Enviar Whatsapp',
  'Enviar Email',
  'Responder Cliente',
  'Confirmar Interesse',
  'Esclarecer Dúvidas',
  'Informar Prazo',
  'Informar Status',
  'Solicitar Feedback',
  // Cadastro de Cliente
  'Cadastrar Cliente',
  'Atualizar Cadastro Cliente',
  'Completar Dados Cliente',
  'Validar Dados Cliente',
  'Solicitar Documentos Cliente',
  'Registrar Contato Cliente',
  // Visitas e Reuniões
  'Agendar Visita',
  'Realizar Visita Técnica',
  'Reunião com Cliente',
  'Apresentar Catálogo',
  'Demonstrar Serviços',
  'Visita Pós-Serviço',
  // Contratos e Documentos
  'Enviar Contrato',
  'Coletar Assinatura',
  'Registrar Aprovação',
  'Formalizar Pedido',
  'Enviar Confirmação',
  // Pós-venda e Fidelização
  'Pesquisa Satisfação',
  'Tratar Reclamação',
  'Oferecer Serviço Adicional',
  'Programa Fidelidade',
  'Solicitar Indicação',
  // Outros
  'Outros',
] as const;

// =====================
// FINANCIAL - Billing Actions
// =====================
export const FINANCIAL_SERVICE_DESCRIPTIONS = [
  'Acordo Pagamento',
  'Ajustar Vencimento Boleto',
  'Atualizar Dados Financeiros',
  'Baixar Título',
  'Boleto Avulso',
  'Boleto Entrada',
  'Boleto Parcela',
  'Boleto Saldo',
  'Cadastrar Cliente Financeiro',
  'Cancelar Boleto',
  'Cancelar Nota Fiscal',
  'Carta Correção NF',
  'Cobrar Cliente',
  'Compensar Cheque',
  'Confirmar Pagamento',
  'Consultar Crédito Cliente',
  'Emitir NF Complementar',
  'Emitir NF Serviço',
  'Emitir Nota Fiscal',
  'Enviar Boleto',
  'Enviar Comprovante',
  'Enviar Lembrete Pagamento',
  'Enviar Nota Fiscal',
  'Enviar Whatsapp Cobrança',
  'Estornar Pagamento',
  'Gerar Boleto',
  'Gerar Recibo',
  'Gerar Segunda Via Boleto',
  'Ligar Cobrança',
  'Negociar Dívida',
  'Parcelar Débito',
  'Reenviar Boleto',
  'Registrar Dados Bancários',
  'Registrar Pagamento',
  'Registrar Pagamento Cartão',
  'Registrar Pagamento Cheque',
  'Registrar Pagamento Dinheiro',
  'Registrar Pagamento Parcial',
  'Registrar Pagamento Pix',
  'Renegociar Prazo',
  'Validar Cnpj Cliente',
  'Outros',
] as const;

// =====================
// ARTWORK - Design Actions (6 items)
// =====================
export const ARTWORK_SERVICE_DESCRIPTIONS = [
  'Elaborar Layout',
  'Ajustar Layout',
  'Elaborar Projeto',
  'Ajustar Projeto',
  'Preparar Arquivos para Plotagem',
  'Aprovar com o Cliente',
] as const;

// =====================
// LOGISTIC - Coordination Actions
// =====================
export const LOGISTIC_SERVICE_DESCRIPTIONS = [
  'Ajustar Previsão',
  'Alocar Vaga',
  'Atualizar Cliente Status',
  'Atualizar Dados Cliente',
  'Avisar Cliente Liberação',
  'Cadastrar Cliente Logística',
  'Cancelar Tarefa',
  'Checklist Entrada',
  'Checklist Saída',
  'Cobrar Setor Produção',
  'Conferir Documentos Entrada',
  'Conferir Serviços Executados',
  'Configurar Tarefa',
  'Criar Tarefa',
  'Definir Previsão',
  'Desprioritizar Tarefa',
  'Entregar Chaves',
  'Enviar Previsão Cliente',
  'Escalar Prioridade',
  'Fotografar Entrada',
  'Fotografar Saída',
  'Liberar Vaga',
  'Liberar Veículo',
  'Organizar Fila Produção',
  'Priorizar Tarefa',
  'Reagendar Tarefa',
  'Receber Veículo',
  'Redistribuir Tarefa',
  'Registrar Avarias Entrada',
  'Registrar Chegada',
  'Registrar Contato Cliente',
  'Reservar Espaço',
  'Solicitar Retirada',
  'Termo Responsabilidade',
  'Transferir Vaga',
  'Verificar Andamento',
  'Verificar Disponibilidade',
  'Outros',
] as const;

// =====================
// Type Definitions
// =====================
export type ProductionServiceDescription =
  (typeof PRODUCTION_SERVICE_DESCRIPTIONS)[number];
export type CommercialServiceDescription =
  (typeof COMMERCIAL_SERVICE_DESCRIPTIONS)[number];
export type FinancialServiceDescription =
  (typeof FINANCIAL_SERVICE_DESCRIPTIONS)[number];
export type ArtworkServiceDescription =
  (typeof ARTWORK_SERVICE_DESCRIPTIONS)[number];
export type LogisticServiceDescription =
  (typeof LOGISTIC_SERVICE_DESCRIPTIONS)[number];

// =====================
// Helper to get descriptions by type
// =====================
export const SERVICE_DESCRIPTIONS_BY_TYPE: Record<
  SERVICE_ORDER_TYPE,
  readonly string[]
> = {
  [SERVICE_ORDER_TYPE.PRODUCTION]: PRODUCTION_SERVICE_DESCRIPTIONS,
  [SERVICE_ORDER_TYPE.COMMERCIAL]: COMMERCIAL_SERVICE_DESCRIPTIONS,
  [SERVICE_ORDER_TYPE.FINANCIAL]: FINANCIAL_SERVICE_DESCRIPTIONS,
  [SERVICE_ORDER_TYPE.ARTWORK]: ARTWORK_SERVICE_DESCRIPTIONS,
  [SERVICE_ORDER_TYPE.LOGISTIC]: LOGISTIC_SERVICE_DESCRIPTIONS,
};

/**
 * Get service descriptions for a specific type
 */
export function getServiceDescriptionsByType(
  type: SERVICE_ORDER_TYPE,
): readonly string[] {
  return SERVICE_DESCRIPTIONS_BY_TYPE[type] || [];
}

/**
 * Check if a description is valid for a given type
 * Case-insensitive comparison
 */
export function isValidServiceDescription(
  type: SERVICE_ORDER_TYPE,
  description: string,
): boolean {
  const descriptions = SERVICE_DESCRIPTIONS_BY_TYPE[type];
  if (!descriptions) return false;
  const normalizedDescription = description.toLowerCase().trim();
  return descriptions.some((d) => d.toLowerCase() === normalizedDescription);
}

/**
 * Default service order for new tasks (COMMERCIAL type with "Em Negociação")
 */
export const DEFAULT_TASK_SERVICE_ORDER = {
  type: SERVICE_ORDER_TYPE.COMMERCIAL,
  description: 'Em Negociação',
} as const;
