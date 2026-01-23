/**
 * Service Order Description Enums by Type
 *
 * These enums define the standardized service descriptions for each service order type.
 * Used for both ServiceOrder and TaskPricingItem descriptions.
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
  'Logomarca Padrão',
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
  'EM NEGOCIAÇÃO',
  // Orçamento - Ações
  'ELABORAR ORÇAMENTO',
  'ENVIAR ORÇAMENTO',
  'REENVIAR ORÇAMENTO',
  'REVISAR ORÇAMENTO',
  'AJUSTAR ORÇAMENTO',
  'DETALHAR ORÇAMENTO',
  'ORÇAMENTO URGENTE',
  'ORÇAMENTO FROTA',
  'ORÇAMENTO PARCIAL',
  'ORÇAMENTO COMPLEMENTAR',
  // Proposta e Negociação
  'APRESENTAR PROPOSTA',
  'NEGOCIAR VALOR',
  'NEGOCIAR PRAZO',
  'NEGOCIAR CONDIÇÕES',
  'APLICAR DESCONTO',
  'PROPOSTA ESPECIAL',
  'CONTRAPROPOSTA',
  'FECHAR NEGÓCIO',
  // Comunicação com Cliente
  'LIGAR PARA CLIENTE',
  'RETORNAR LIGAÇÃO',
  'ENVIAR WHATSAPP',
  'ENVIAR EMAIL',
  'RESPONDER CLIENTE',
  'CONFIRMAR INTERESSE',
  'ESCLARECER DÚVIDAS',
  'INFORMAR PRAZO',
  'INFORMAR STATUS',
  'SOLICITAR FEEDBACK',
  // Cadastro de Cliente
  'CADASTRAR CLIENTE',
  'ATUALIZAR CADASTRO CLIENTE',
  'COMPLETAR DADOS CLIENTE',
  'VALIDAR DADOS CLIENTE',
  'SOLICITAR DOCUMENTOS CLIENTE',
  'REGISTRAR CONTATO CLIENTE',
  // Visitas e Reuniões
  'AGENDAR VISITA',
  'REALIZAR VISITA TÉCNICA',
  'REUNIÃO COM CLIENTE',
  'APRESENTAR CATÁLOGO',
  'DEMONSTRAR SERVIÇOS',
  'VISITA PÓS-SERVIÇO',
  // Contratos e Documentos
  'ENVIAR CONTRATO',
  'COLETAR ASSINATURA',
  'REGISTRAR APROVAÇÃO',
  'FORMALIZAR PEDIDO',
  'ENVIAR CONFIRMAÇÃO',
  // Pós-venda e Fidelização
  'PESQUISA SATISFAÇÃO',
  'TRATAR RECLAMAÇÃO',
  'OFERECER SERVIÇO ADICIONAL',
  'PROGRAMA FIDELIDADE',
  'SOLICITAR INDICAÇÃO',
  // Outros
  'OUTROS',
] as const;

// =====================
// FINANCIAL - Billing Actions
// =====================
export const FINANCIAL_SERVICE_DESCRIPTIONS = [
  'ACORDO PAGAMENTO',
  'AJUSTAR VENCIMENTO BOLETO',
  'ATUALIZAR DADOS FINANCEIROS',
  'BAIXAR TÍTULO',
  'BOLETO AVULSO',
  'BOLETO ENTRADA',
  'BOLETO PARCELA',
  'BOLETO SALDO',
  'CADASTRAR CLIENTE FINANCEIRO',
  'CANCELAR BOLETO',
  'CANCELAR NOTA FISCAL',
  'CARTA CORREÇÃO NF',
  'COBRAR CLIENTE',
  'COMPENSAR CHEQUE',
  'CONFIRMAR PAGAMENTO',
  'CONSULTAR CRÉDITO CLIENTE',
  'EMITIR NF COMPLEMENTAR',
  'EMITIR NF SERVIÇO',
  'EMITIR NOTA FISCAL',
  'ENVIAR BOLETO',
  'ENVIAR COMPROVANTE',
  'ENVIAR LEMBRETE PAGAMENTO',
  'ENVIAR NOTA FISCAL',
  'ENVIAR WHATSAPP COBRANÇA',
  'ESTORNAR PAGAMENTO',
  'GERAR BOLETO',
  'GERAR RECIBO',
  'GERAR SEGUNDA VIA BOLETO',
  'LIGAR COBRANÇA',
  'NEGOCIAR DÍVIDA',
  'PARCELAR DÉBITO',
  'REENVIAR BOLETO',
  'REGISTRAR DADOS BANCÁRIOS',
  'REGISTRAR PAGAMENTO',
  'REGISTRAR PAGAMENTO CARTÃO',
  'REGISTRAR PAGAMENTO CHEQUE',
  'REGISTRAR PAGAMENTO DINHEIRO',
  'REGISTRAR PAGAMENTO PARCIAL',
  'REGISTRAR PAGAMENTO PIX',
  'RENEGOCIAR PRAZO',
  'VALIDAR CNPJ CLIENTE',
  'OUTROS',
] as const;

// =====================
// ARTWORK - Design Actions (6 items)
// =====================
export const ARTWORK_SERVICE_DESCRIPTIONS = [
  'ELABORAR LAYOUT',
  'AJUSTAR LAYOUT',
  'ELABORAR PROJETO',
  'AJUSTAR PROJETO',
  'PREPARAR ARQUIVOS PARA PROTAGEM',
  'APROVAR COM O CLIENTE',
] as const;

// =====================
// LOGISTIC - Coordination Actions
// =====================
export const LOGISTIC_SERVICE_DESCRIPTIONS = [
  'AJUSTAR PREVISÃO',
  'ALOCAR VAGA',
  'ATUALIZAR CLIENTE STATUS',
  'ATUALIZAR DADOS CLIENTE',
  'AVISAR CLIENTE LIBERAÇÃO',
  'CADASTRAR CLIENTE LOGÍSTICA',
  'CANCELAR TAREFA',
  'CHECKLIST ENTRADA',
  'CHECKLIST SAÍDA',
  'COBRAR SETOR PRODUÇÃO',
  'CONFERIR DOCUMENTOS ENTRADA',
  'CONFERIR SERVIÇOS EXECUTADOS',
  'CONFIGURAR TAREFA',
  'CRIAR TAREFA',
  'DEFINIR PREVISÃO',
  'DESPRIORITIZAR TAREFA',
  'ENTREGAR CHAVES',
  'ENVIAR PREVISÃO CLIENTE',
  'ESCALAR PRIORIDADE',
  'FOTOGRAFAR ENTRADA',
  'FOTOGRAFAR SAÍDA',
  'LIBERAR VAGA',
  'LIBERAR VEÍCULO',
  'ORGANIZAR FILA PRODUÇÃO',
  'PRIORIZAR TAREFA',
  'REAGENDAR TAREFA',
  'RECEBER VEÍCULO',
  'REDISTRIBUIR TAREFA',
  'REGISTRAR AVARIAS ENTRADA',
  'REGISTRAR CHEGADA',
  'REGISTRAR CONTATO CLIENTE',
  'RESERVAR ESPAÇO',
  'SOLICITAR RETIRADA',
  'TERMO RESPONSABILIDADE',
  'TRANSFERIR VAGA',
  'VERIFICAR ANDAMENTO',
  'VERIFICAR DISPONIBILIDADE',
  'OUTROS',
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
 */
export function isValidServiceDescription(
  type: SERVICE_ORDER_TYPE,
  description: string,
): boolean {
  const descriptions = SERVICE_DESCRIPTIONS_BY_TYPE[type];
  if (!descriptions) return false;
  const normalizedDescription = description.toUpperCase().trim();
  return descriptions.some((d) => d.toUpperCase() === normalizedDescription);
}

/**
 * Default service order for new tasks (COMMERCIAL type with "EM NEGOCIAÇÃO")
 */
export const DEFAULT_TASK_SERVICE_ORDER = {
  type: SERVICE_ORDER_TYPE.COMMERCIAL,
  description: 'EM NEGOCIAÇÃO',
} as const;
