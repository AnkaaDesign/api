import {
  CHANGE_LOG_ENTITY_TYPE,
  MEASURE_UNIT_LABELS,
  CHANGE_LOG_ACTION,
  CHANGE_TRIGGERED_BY,
  TRUCK_CATEGORY_LABELS,
  IMPLEMENT_TYPE_LABELS,
} from '@constants';
import { formatDateTime } from './date';
import { formatCurrency } from './number';
import { formatBrazilianPhone, formatCPF, formatCNPJ } from './formatters';

// Common field name mapping for all entities
const commonFields: Record<string, string> = {
  // Basic entity fields
  name: 'Nome',
  status: 'Status',
  description: 'Descrição',
  notes: 'Notas',
  comments: 'Comentários',
  observations: 'Observações',
  isActive: 'Ativo',
  createdAt: 'Criado em',
  updatedAt: 'Atualizado em',

  // User-related fields
  userId: 'Usuário',
  assignedToUserId: 'Atribuído a',
  'user.name': 'Nome do Usuário',
  'user.email': 'E-mail do Usuário',

  // Common relationships
  supplierId: 'Fornecedor',
  categoryId: 'Categoria',
  brandId: 'Marca',

  // Audit fields
  triggeredBy: 'Acionado por',
  reason: 'Motivo',
};

// Entity-specific field mappings
const entitySpecificFields: Partial<Record<CHANGE_LOG_ENTITY_TYPE, Record<string, string>>> = {
  [CHANGE_LOG_ENTITY_TYPE.ITEM]: {
    quantity: 'Quantidade',
    price: 'Preço',
    maxQuantity: 'Quantidade Máxima',
    measureUnit: 'Unidade de Medida',
    measureValue: 'Valor da Medida',
    measures: 'Medidas',
    barcode: 'Código de Barras',
    barcodes: 'Códigos de Barras',
    unicode: 'Código Único',
    uniCode: 'Código Único',
    CA: 'CA (Certificado de Aprovação)',
    leadTime: 'Tempo de Entrega',
    estimatedLeadTime: 'Tempo de Entrega Estimado',
    tax: 'Imposto (%)',
    totalPrice: 'Preço Total',
    monthlyConsumption: 'Consumo Mensal',
    monthlyConsumptionTrendPercent: 'Tendência de Consumo (%)',
    shouldAssignToUser: 'Deve ser Atribuído a Usuário',
    isForEpi: 'É EPI',
    boxQuantity: 'Quantidade por Caixa',
    reorderPoint: 'Ponto de Reposição',
    reorderQuantity: 'Quantidade de Reposição',
    location: 'Localização',
    weight: 'Peso',
    dimensions: 'Dimensões',
    abcCategory: 'Categoria ABC',
    xyzCategory: 'Categoria XYZ',
    serialNumber: 'Número de Série',
    manufacturerCode: 'Código do Fabricante',
    supplierCode: 'Código do Fornecedor',
    sku: 'SKU',
    ean: 'EAN',
    ncm: 'NCM',
    warranty: 'Garantia',
    warrantyPeriod: 'Período de Garantia',
    expirationDate: 'Data de Validade',
    manufacturingDate: 'Data de Fabricação',
    lastPurchaseDate: 'Data da Última Compra',
    lastPurchasePrice: 'Preço da Última Compra',
    averageCost: 'Custo Médio',
    unitCost: 'Custo Unitário',
    margin: 'Margem',
    minimumMargin: 'Margem Mínima',
    suggestedPrice: 'Preço Sugerido',
  },
  [CHANGE_LOG_ENTITY_TYPE.ITEM_CATEGORY]: {
    isPpe: 'É EPI',
    'category.isPpe': 'Categoria é EPI',
  },
  [CHANGE_LOG_ENTITY_TYPE.ITEM_BRAND]: {
    'brand.name': 'Nome da Marca',
  },
  [CHANGE_LOG_ENTITY_TYPE.ORDER]: {
    orderId: 'ID do Pedido',
    orderItemId: 'ID do Item do Pedido',
    totalAmount: 'Valor Total',
    scheduledFor: 'Agendado para',
    deliveryDate: 'Data de Entrega',
    receivedDate: 'Data de Recebimento',
    forecast: 'Previsão',
    status: 'Status',
    status_transition: 'Status',
    statusOrder: 'Ordem do Status',
    budgetIds: 'Orçamentos',
    invoiceIds: 'Notas Fiscais',
    receiptIds: 'Recibos',
    supplierId: 'Fornecedor',
    orderScheduleId: 'Agendamento do Pedido',
    orderRuleId: 'Regra do Pedido',
    ppeScheduleId: 'Agendamento de EPI',
    notes: 'Observações',
    doneAt: 'Concluído em',
    'supplier.name': 'Nome do Fornecedor',
    'supplier.fantasyName': 'Nome Fantasia do Fornecedor',
    'budget.filename': 'Nome do Orçamento',
    'nfe.filename': 'Nome da NFe',
    'receipt.filename': 'Nome do Recibo',
  },
  [CHANGE_LOG_ENTITY_TYPE.ORDER_ITEM]: {
    orderId: 'Pedido',
    itemId: 'Item',
    orderedQuantity: 'Quantidade Pedida',
    receivedQuantity: 'Quantidade Recebida',
    price: 'Preço Unitário',
    tax: 'Imposto (%)',
    isCritical: 'Item Crítico',
    receivedAt: 'Recebido em',
    fulfilledAt: 'Cumprido em',
    notes: 'Observações do Item',
    'item.name': 'Nome do Item',
    'item.sku': 'SKU do Item',
    'item.unicode': 'Código do Item',
    'item.uniCode': 'Código do Item',
    'item.barcode': 'Código de Barras do Item',
    'order.description': 'Descrição do Pedido',
    'order.status': 'Status do Pedido',
    totalPrice: 'Valor Total',
  },
  [CHANGE_LOG_ENTITY_TYPE.USER]: {
    name: 'Nome',
    email: 'E-mail',
    cpf: 'CPF',
    pis: 'PIS',
    payrollNumber: 'Número da Folha',
    phone: 'Telefone',
    position: 'Cargo',
    positionId: 'Cargo',
    performanceLevel: 'Nível de Desempenho',
    sector: 'Setor',
    sectorId: 'Setor',
    status: 'Status',
    statusOrder: 'Ordem do Status',
    verified: 'Verificado',
    requirePasswordChange: 'Requer Mudança de Senha',
    hireDate: 'Data de Contratação',
    birthDate: 'Data de Nascimento',
    admissional: 'Data de Admissão',
    dismissal: 'Data de Demissão',
    verificationCode: 'Código de Verificação',
    verificationExpiresAt: 'Expiração da Verificação',
    verificationType: 'Tipo de Verificação',
    sessionToken: 'Token de Sessão',
    lastLoginAt: 'Último Login',
    isExternal: 'É Externo',
    password: 'Senha',
  },
  [CHANGE_LOG_ENTITY_TYPE.TASK]: {
    title: 'Título',
    dueDate: 'Data de Vencimento',
    startedAt: 'Iniciado em',
    completedAt: 'Concluído em',
    finishedAt: 'Finalizado em',
    estimatedHours: 'Horas Estimadas',
    actualHours: 'Horas Reais',
    serialNumber: 'Número de Série',
    plate: 'Placa',
    details: 'Detalhes',
    entryDate: 'Data de Entrada',
    term: 'Prazo',
    forecastDate: 'Data de Previsão',
    commission: 'Comissão',
    price: 'Preço',
    statusOrder: 'Ordem do Status',
    customerId: 'Cliente',
    invoiceToId: 'Faturar Para',
    negotiatingWith: 'Negociando com',
    sectorId: 'Setor',
    createdById: 'Criado por',
    budgetIds: 'Orçamentos',
    invoiceIds: 'Notas Fiscais',
    receiptIds: 'Recibos',
    paintId: 'Tinta',
    generalPainting: 'Pintura Geral',
    observationId: 'Observação',
    // Relationship fields
    sector: 'Setor',
    customer: 'Cliente',
    invoiceTo: 'Faturar Para',
    budget: 'Orçamento',
    nfe: 'Nota Fiscal',
    receipt: 'Recibo',
    paint: 'Tinta',
    observation: 'Observação',
    createdBy: 'Criado por',
    truck: 'Caminhão',
    artworks: 'Artes',
    baseFiles: 'Arquivos Base',
    logoPaints: 'Tintas da Logomarca',
    paints: 'Tintas da Logomarca',
    commissions: 'Comissões',
    services: 'Serviços', // Legacy - for historical changelog records
    serviceOrders: 'Ordens de Serviço',
    airbrushings: 'Aerografias',
    cutRequest: 'Solicitações de Corte',
    cutPlan: 'Planos de Corte',
    relatedTasks: 'Tarefas Relacionadas',
    relatedTo: 'Relacionado a',
    // Direct truck fields (when truck data is embedded in task changelog)
    category: 'Categoria do Caminhão',
    implementType: 'Tipo de Implemento',
    // Nested relationship fields
    'customer.fantasyName': 'Nome Fantasia do Cliente',
    'customer.corporateName': 'Razão Social do Cliente',
    'customer.cnpj': 'CNPJ do Cliente',
    'invoiceTo.fantasyName': 'Nome Fantasia (Faturar Para)',
    'sector.name': 'Nome do Setor',
    'truck.plate': 'Placa do Caminhão',
    'truck.chassisNumber': 'Chassi do Caminhão',
    'truck.category': 'Categoria do Caminhão',
    'truck.implementType': 'Tipo de Implemento',
    'createdBy.name': 'Nome do Criador',
    'budget.filename': 'Nome do Orçamento',
    'nfe.filename': 'Nome da NFe',
    'receipt.filename': 'Nome do Recibo',
    'paint.name': 'Nome da Tinta',
    'observation.content': 'Conteúdo da Observação',
    'observation.type': 'Tipo da Observação',
  },
  [CHANGE_LOG_ENTITY_TYPE.SUPPLIER]: {
    corporateName: 'Razão Social',
    fantasyName: 'Nome Fantasia',
    cnpj: 'CNPJ',
    email: 'E-mail',
    phone: 'Telefone',
    phones: 'Telefones',
    site: 'Site',
    representativeName: 'Nome do Representante',
    address: 'Endereço',
    number: 'Número',
    complement: 'Complemento',
    neighborhood: 'Bairro',
    city: 'Cidade',
    state: 'Estado',
    zipCode: 'CEP',
    country: 'País',
    observations: 'Observações',
    statusOrder: 'Ordem do Status',
    logoId: 'Logo',
    logo: 'Logo',
  },
  [CHANGE_LOG_ENTITY_TYPE.PPE_DELIVERY]: {
    ppeConfigId: 'ID da Configuração de EPI',
    ppeDeliveryId: 'ID da Entrega de EPI',
    ppeScheduleId: 'Agendamento de EPI',
    userId: 'Funcionário',
    itemId: 'Item de EPI',
    quantity: 'Quantidade',
    status: 'Status',
    statusOrder: 'Ordem do Status',
    scheduledDate: 'Data Agendada',
    actualDeliveryDate: 'Data de Entrega',
    deliveryDate: 'Data de Entrega',
    reviewedBy: 'Aprovado por',
    observation: 'Observação',
    expirationDate: 'Data de Validade',
    ppe_info: 'Informações do EPI',
    delivery_completed: 'Entrega Concluída',
    batch_approval: 'Aprovação em Lote',
    batch_rejection: 'Rejeição em Lote',
    batch_mark_delivered: 'Entrega em Lote',
    reschedule: 'Reagendamento',
    auto_creation_error: 'Erro na Criação Automática',
    auto_schedule_update: 'Atualização Automática do Agendamento',
    // Nested relationship fields
    'user.name': 'Nome do Funcionário',
    'item.name': 'Nome do Item',
    'item.ppeType': 'Tipo de EPI',
    'item.ppeSize': 'Tamanho do EPI',
    'reviewedByUser.name': 'Nome do Aprovador',
    'ppeSchedule.frequency': 'Frequência do Agendamento',
  },
  [CHANGE_LOG_ENTITY_TYPE.PPE_CONFIG]: {
    itemId: 'Item',
    ppeType: 'Tipo de EPI',
    requiredQuantity: 'Quantidade Necessária',
    validityDays: 'Dias de Validade',
    size: 'Tamanho',
    // Nested relationship fields
    'item.name': 'Nome do Item',
  },
  [CHANGE_LOG_ENTITY_TYPE.PPE_SIZE]: {
    userId: 'Funcionário',
    shirts: 'Tamanho de Camisa',
    pants: 'Tamanho de Calça',
    shorts: 'Tamanho de Bermuda',
    boots: 'Tamanho de Bota',
    sleeves: 'Tamanho de Manga',
    mask: 'Tamanho de Máscara',
    gloves: 'Tamanho de Luva',
    rainBoots: 'Tamanho de Bota de Chuva',
    // Nested relationship fields
    'user.name': 'Nome do Funcionário',
  },
  [CHANGE_LOG_ENTITY_TYPE.PPE_DELIVERY_SCHEDULE]: {
    userId: 'Funcionário',
    itemId: 'Item',
    categoryId: 'Categoria',
    quantity: 'Quantidade',
    frequency: 'Frequência',
    frequencyCount: 'Contagem de Frequência',
    isActive: 'Ativo',
    nextRun: 'Próxima Execução',
    lastRun: 'Última Execução',
    assignmentType: 'Tipo de Atribuição',
    excludedUserIds: 'Usuários Excluídos',
    includedUserIds: 'Usuários Incluídos',
    items: 'Itens de EPI', // PpeScheduleItem relation
    ppeItems: 'Itens de EPI', // Legacy JSON field - for old changelog entries
    weeklyConfigId: 'Configuração Semanal',
    monthlyConfigId: 'Configuração Mensal',
    yearlyConfigId: 'Configuração Anual',
    dayOfWeek: 'Dia da Semana',
    dayOfMonth: 'Dia do Mês',
    month: 'Mês',
    // Nested relationship fields
    'user.name': 'Nome do Funcionário',
    'item.name': 'Nome do Item',
    'category.name': 'Nome da Categoria',
  },
  [CHANGE_LOG_ENTITY_TYPE.ACTIVITY]: {
    itemId: 'Item',
    userId: 'Usuário',
    orderId: 'Pedido',
    orderItemId: 'Item do Pedido',
    quantity: 'Quantidade',
    operation: 'Tipo de Operação',
    operationType: 'Tipo de Operação',
    reason: 'Motivo',
    description: 'Descrição',
    // Nested fields
    'item.name': 'Nome do Item',
    'item.uniCode': 'Código do Item',
    'user.name': 'Nome do Usuário',
    'order.description': 'Descrição do Pedido',
  },
  [CHANGE_LOG_ENTITY_TYPE.EXTERNAL_WITHDRAWAL]: {
    withdrawerName: 'Nome do Retirador',
    withdrawerDocument: 'Documento do Retirador',
    withdrawerContact: 'Contato do Retirador',
    type: 'Tipo',
    status: 'Status',
    status_transition: 'Status',
    statusOrder: 'Ordem do Status',
    invoiceIds: 'Notas Fiscais Eletrônicas',
    receiptIds: 'Recibos',
    budgetIds: 'Orçamentos',
    notes: 'Observações',
    totalPrice: 'Valor Total',
    withdrawalDate: 'Data da Retirada',
    actualReturnDate: 'Data Real de Devolução',
    totalValue: 'Valor Total',
    isPaid: 'Pago',
    paymentDate: 'Data de Pagamento',
    withdrawalType: 'Tipo de Retirada',
    responsibleUserId: 'Responsável',
    reason: 'Motivo',
    items: 'Itens',
    'nfe.filename': 'Nome da NFe',
    'receipt.filename': 'Nome do Recibo',
    'budget.filename': 'Nome do Orçamento',
    'responsibleUser.name': 'Nome do Responsável',
  },
  [CHANGE_LOG_ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM]: {
    externalWithdrawalId: 'Retirada Externa',
    itemId: 'Item',
    withdrawedQuantity: 'Quantidade Retirada',
    returnedQuantity: 'Quantidade Devolvida',
    price: 'Preço Unitário',
    unitPrice: 'Preço Unitário',
    totalPrice: 'Preço Total',
    tax: 'Imposto',
    discount: 'Desconto',
    notes: 'Observações',
    condition: 'Condição',
    serialNumber: 'Número de Série',
    batchNumber: 'Número do Lote',
    expirationDate: 'Data de Validade',
    location: 'Localização',
    isDefective: 'Defeituoso',
    defectDescription: 'Descrição do Defeito',
    'item.name': 'Nome do Item',
    'item.sku': 'SKU do Item',
    'item.barcode': 'Código de Barras do Item',
    'item.unicode': 'Código Único do Item',
    'item.uniCode': 'Código Único do Item',
    'externalWithdrawal.withdrawerName': 'Nome do Retirador',
  },
  [CHANGE_LOG_ENTITY_TYPE.POSITION]: {
    name: 'Nome',
    level: 'Nível',
    sectorId: 'Setor',
    privileges: 'Privilégios',
    commissionEligible: 'Elegível para Comissão',
    maxAllowedVacationDays: 'Dias Máximos de Férias',
    remuneration: 'Remuneração',
    sector: 'Setor',
    'sector.name': 'Nome do Setor',
  },
  [CHANGE_LOG_ENTITY_TYPE.SECTOR]: {
    name: 'Nome',
    privileges: 'Privilégios',
    managerId: 'Gerente do Setor',
    users: 'Usuários',
    positions: 'Cargos',
    tasks: 'Tarefas',
    'manager.name': 'Nome do Gerente',
  },
  [CHANGE_LOG_ENTITY_TYPE.PARKING_SPOT]: {
    name: 'Número',
    length: 'Comprimento',
    garageLaneId: 'Faixa da Garagem',
    'garageLane.id': 'ID da Faixa',
    'garageLane.xPosition': 'Posição X da Faixa',
    'garageLane.yPosition': 'Posição Y da Faixa',
  },
  [CHANGE_LOG_ENTITY_TYPE.MAINTENANCE]: {
    type: 'Tipo',
    mechanicId: 'Mecânico',
    scheduledFor: 'Agendado para',
    startedAt: 'Iniciado em',
    finishedAt: 'Finalizado em',
    completedAt: 'Concluído em',
    timeTaken: 'Tempo gasto',
    cost: 'Custo',
    maintenanceScheduleId: 'Cronograma de Manutenção',
    itemId: 'Equipamento',
    item: 'Equipamento',
    mechanic: 'Mecânico',
    maintenanceSchedule: 'Cronograma',
    itemsNeeded: 'Itens necessários',
    // Nested fields
    'mechanic.name': 'Nome do Mecânico',
    'item.name': 'Nome do Equipamento',
    'maintenanceSchedule.name': 'Nome do Cronograma',
  },
  [CHANGE_LOG_ENTITY_TYPE.MAINTENANCE_ITEM]: {
    maintenanceId: 'Manutenção',
    itemId: 'Item',
    quantity: 'Quantidade',
    price: 'Preço Unitário',
    totalPrice: 'Preço Total',
    maintenance: 'Manutenção',
    item: 'Item',
    // Nested fields
    'maintenance.name': 'Nome da Manutenção',
    'maintenance.type': 'Tipo de Manutenção',
    'item.name': 'Nome do Item',
    'item.sku': 'SKU do Item',
    'item.barcode': 'Código de Barras do Item',
    'item.unicode': 'Código Único do Item',
    'item.uniCode': 'Código Único do Item',
  },
  [CHANGE_LOG_ENTITY_TYPE.VACATION]: {
    userId: 'Funcionário',
    startAt: 'Data de Início',
    endAt: 'Data de Término',
    status: 'Status',
    statusOrder: 'Ordem do Status',
    type: 'Tipo',
    typeOrder: 'Ordem do Tipo',
    isCollective: 'É Coletiva',
    approvedBy: 'Aprovado por',
    approvedAt: 'Aprovado em',
    rejectedBy: 'Rejeitado por',
    rejectedAt: 'Rejeitado em',
    cancelledBy: 'Cancelado por',
    cancelledAt: 'Cancelado em',
    observation: 'Observação',
    statusTransition: 'Transição de Status',
    // Nested relationship fields
    'user.name': 'Nome do Funcionário',
    'user.cpf': 'CPF do Funcionário',
    'user.position.name': 'Cargo do Funcionário',
    'approvedByUser.name': 'Nome do Aprovador',
    'rejectedByUser.name': 'Nome do Rejeitador',
    'cancelledByUser.name': 'Nome do Cancelador',
  },
  [CHANGE_LOG_ENTITY_TYPE.PRICE]: {
    itemId: 'Item',
    value: 'Valor',
    tax: 'Imposto (%)',
    // Nested relationship fields
    'item.name': 'Nome do Item',
    'item.sku': 'SKU do Item',
    'item.unicode': 'Código do Item',
    'item.uniCode': 'Código do Item',
    'item.barcode': 'Código de Barras do Item',
  },
  [CHANGE_LOG_ENTITY_TYPE.HOLIDAY]: {
    name: 'Nome',
    date: 'Data',
    type: 'Tipo',
    description: 'Descrição',
    isRecurring: 'É Recorrente',
    isNational: 'É Nacional',
    isOptional: 'É Opcional',
    // Nested relationship fields
    'user.name': 'Nome do Usuário',
  },
  [CHANGE_LOG_ENTITY_TYPE.CUSTOMER]: {
    fantasyName: 'Nome Fantasia',
    corporateName: 'Razão Social',
    cnpj: 'CNPJ',
    cpf: 'CPF',
    email: 'E-mail',
    phone: 'Telefone',
    phones: 'Telefones',
    address: 'Endereço',
    addressNumber: 'Número',
    addressComplement: 'Complemento',
    neighborhood: 'Bairro',
    city: 'Cidade',
    state: 'Estado',
    zipCode: 'CEP',
    site: 'Site',
    tags: 'Tags',
    logoId: 'Logo',
    // Nested relationship fields
    'logo.filename': 'Nome do Logo',
    'tasks.length': 'Quantidade de Tarefas',
  },
  [CHANGE_LOG_ENTITY_TYPE.PAINT]: {
    name: 'Nome',
    code: 'Código',
    type: 'Tipo',
    brand: 'Marca',
    finish: 'Acabamento',
    color: 'Cor',
    hexColor: 'Cor Hexadecimal',
    manufacturer: 'Fabricante',
    productLine: 'Linha de Produto',
    isActive: 'Ativo',
    notes: 'Observações',
    formulas: 'Fórmulas',
    // Nested relationship fields
    'formulas.length': 'Quantidade de Fórmulas',
  },
  [CHANGE_LOG_ENTITY_TYPE.PAINT_FORMULA]: {
    description: 'Descrição',
    paintId: 'Tinta',
    density: 'Densidade (g/ml)',
    pricePerLiter: 'Preço por Litro',
    viscosity: 'Viscosidade',
    isActive: 'Ativo',
    code: 'Código',
    type: 'Tipo',
    notes: 'Observações',
    components: 'Componentes',
    productions: 'Produções',
    formulas: 'Fórmulas',
    // Nested relationship fields
    'paint.name': 'Nome da Tinta',
    'paint.code': 'Código da Tinta',
    'components.length': 'Quantidade de Componentes',
    'productions.length': 'Quantidade de Produções',
  },
  [CHANGE_LOG_ENTITY_TYPE.PAINT_FORMULA_COMPONENT]: {
    formulaPaintId: 'Fórmula',
    itemId: 'Item',
    ratio: 'Proporção (%)',
    quantity: 'Quantidade',
    weight: 'Peso (g)',
    volume: 'Volume (ml)',
    // Nested relationship fields
    'item.name': 'Nome do Item',
    'item.sku': 'SKU do Item',
    'item.barcode': 'Código de Barras do Item',
    'formulaPaint.description': 'Descrição da Fórmula',
  },
  [CHANGE_LOG_ENTITY_TYPE.PAINT_PRODUCTION]: {
    formulaId: 'Fórmula',
    weight: 'Peso (g)',
    volumeLiters: 'Volume (L)',
    batchCode: 'Código do Lote',
    productionDate: 'Data de Produção',
    notes: 'Observações',
    cost: 'Custo',
    componentImpact: 'Impacto nos Componentes',
    // Nested relationship fields
    'formula.description': 'Descrição da Fórmula',
    'formula.paint.name': 'Nome da Tinta',
    'formula.paint.code': 'Código da Tinta',
  },
  [CHANGE_LOG_ENTITY_TYPE.CUT]: {
    type: 'Tipo',
    fileId: 'Arquivo',
    taskId: 'Tarefa',
    origin: 'Origem',
    reason: 'Motivo',
    parentCutId: 'Corte Pai',
    status: 'Status',
    statusOrder: 'Ordem do Status',
    startedAt: 'Iniciado em',
    completedAt: 'Concluído em',
    // Nested relationship fields
    'file.filename': 'Nome do Arquivo',
    'task.serialNumber': 'Número de Série da Tarefa',
    'truck.plate': 'Placa do Caminhão',
    'task.title': 'Título da Tarefa',
    'parentCut.id': 'ID do Corte Pai',
  },
  [CHANGE_LOG_ENTITY_TYPE.FILE]: {
    filename: 'Nome do Arquivo',
    originalName: 'Nome Original',
    mimetype: 'Tipo de Arquivo',
    path: 'Caminho',
    size: 'Tamanho',
    thumbnailUrl: 'URL da Miniatura',
    // Relationship fields
    tasksArtworks: 'Artes das Tarefas',
    customerLogo: 'Logo do Cliente',
    supplierLogo: 'Logo do Fornecedor',
    observations: 'Observações',
    warning: 'Avisos',
    taskBudgets: 'Orçamentos de Tarefas',
    taskNfes: 'Notas Fiscais de Tarefas',
    taskReceipts: 'Recibos de Tarefas',
    orderBudgets: 'Orçamentos de Pedidos',
    orderNfes: 'Notas Fiscais de Pedidos',
    orderReceipts: 'Recibos de Pedidos',
    airbrushingReceipts: 'Recibos de Aerografia',
    airbrushingNfes: 'Notas Fiscais de Aerografia',
    externalWithdrawalNfes: 'Notas Fiscais de Retirada Externa',
    externalWithdrawalReceipts: 'Recibos de Retirada Externa',
  },
  [CHANGE_LOG_ENTITY_TYPE.NOTIFICATION]: {
    title: 'Título',
    body: 'Conteúdo',
    type: 'Tipo',
    importance: 'Importância',
    actionUrl: 'URL de Ação',
    actionType: 'Tipo de Ação',
    sentAt: 'Enviado em',
    scheduledAt: 'Agendado para',
    channel: 'Canais',
    userId: 'Usuário',
    readStatus: 'Status de Leitura',
    seenBy: 'Visto por',
    // Nested relationship fields
    'user.name': 'Nome do Usuário',
    'user.email': 'E-mail do Usuário',
  },
  [CHANGE_LOG_ENTITY_TYPE.SEEN_NOTIFICATION]: {
    notificationId: 'Notificação',
    userId: 'Usuário',
    seenAt: 'Visto em',
    // Nested relationship fields
    'notification.title': 'Título da Notificação',
    'user.name': 'Nome do Usuário',
  },
  [CHANGE_LOG_ENTITY_TYPE.SERVICE]: {
    name: 'Nome',
    price: 'Preço',
    description: 'Descrição',
    status: 'Status',
    statusOrder: 'Ordem do Status',
  },
  [CHANGE_LOG_ENTITY_TYPE.SERVICE_ORDER]: {
    status: 'Status',
    statusOrder: 'Ordem do Status',
    type: 'Tipo',
    description: 'Descrição',
    observation: 'Observação',
    taskId: 'Tarefa',
    assignedToId: 'Atribuído a',
    createdById: 'Criado por',
    startedById: 'Iniciado por',
    approvedById: 'Aprovado por',
    completedById: 'Concluído por',
    startedAt: 'Iniciado em',
    approvedAt: 'Aprovado em',
    finishedAt: 'Finalizado em',
    // Nested relationship fields
    'task.name': 'Nome da Tarefa',
    'task.serialNumber': 'Número de Série da Tarefa',
    'assignedTo.name': 'Nome do Responsável',
    'createdBy.name': 'Nome do Criador',
    'startedBy.name': 'Nome de quem Iniciou',
    'approvedBy.name': 'Nome de quem Aprovou',
    'completedBy.name': 'Nome de quem Concluiu',
  },
  [CHANGE_LOG_ENTITY_TYPE.TIME_CLOCK_ENTRY]: {
    userId: 'Funcionário',
    date: 'Data',
    entry1: 'Entrada 1',
    exit1: 'Saída 1',
    entry2: 'Entrada 2',
    exit2: 'Saída 2',
    entry3: 'Entrada 3',
    exit3: 'Saída 3',
    entry4: 'Entrada 4',
    exit4: 'Saída 4',
    entry5: 'Entrada 5',
    exit5: 'Saída 5',
    dayType: 'Tipo do Dia',
    compensated: 'Compensado',
    neutral: 'Neutro',
    dayOff: 'Folga',
    freeLunch: 'Almoço Livre',
    source: 'Origem',
    deviceId: 'ID do Dispositivo',
    hasPhoto: 'Tem Foto',
    synced: 'Sincronizado',
    secullumSyncStatus: 'Status de Sincronização',
    secullumRecordId: 'ID do Registro Secullum',
    syncAttempts: 'Tentativas de Sincronização',
    lastSyncError: 'Último Erro de Sincronização',
    latitude: 'Latitude',
    longitude: 'Longitude',
    accuracy: 'Precisão',
    address: 'Endereço',
    // Nested relationship fields
    'user.name': 'Nome do Funcionário',
    'user.cpf': 'CPF do Funcionário',
    'user.position.name': 'Cargo do Funcionário',
    'user.sector.name': 'Setor do Funcionário',
  },
  [CHANGE_LOG_ENTITY_TYPE.TRUCK]: {
    plate: 'Placa',
    chassisNumber: 'Número do Chassi',
    category: 'Categoria',
    implementType: 'Tipo de Implemento',
    spot: 'Localização',
    manufacturer: 'Fabricante',
    model: 'Modelo',
    year: 'Ano',
    color: 'Cor',
    notes: 'Observações',
  },
  // Add more entity-specific mappings as needed
};

/**
 * Get the display label for a field name
 * @param field - The field name
 * @param entityType - The entity type for context-specific labels
 * @returns The display label for the field
 */
export function getFieldLabel(field: string | null, entityType: CHANGE_LOG_ENTITY_TYPE): string {
  if (!field) return '';

  // Try entity-specific fields first, then common fields
  const entityFields = entitySpecificFields[entityType] || {};
  return entityFields[field] || commonFields[field] || field;
}

// Define a flexible type for field values that can handle the complexity of this function
type ComplexFieldValue = unknown;

// Define metadata type
interface FieldMetadata {
  fieldType?: string;
  [key: string]: unknown;
}

/**
 * Format a field value for display based on field type and entity context
 * @param value - The value to format
 * @param field - The field name (optional)
 * @param entityType - The entity type for context-specific formatting (optional)
 * @param metadata - Optional metadata for additional context
 * @returns The formatted value as a string
 */
export function formatFieldValue(
  value: ComplexFieldValue,
  field?: string | null,
  entityType?: CHANGE_LOG_ENTITY_TYPE,
  metadata?: FieldMetadata,
): string {
  // Handle null/undefined commission field specifically
  if ((value === null || value === undefined) && field === 'commission' && entityType === CHANGE_LOG_ENTITY_TYPE.TASK) {
    return 'Não Definida';
  }

  if (value === null || value === undefined) return '—';

  // Parse string numbers for specific numeric fields
  if (typeof value === 'string' && field) {
    const numericFields = [
      'pricePerLiter',
      'density',
      'price',
      'totalPrice',
      'unitCost',
      'averageCost',
      'lastPurchasePrice',
      'suggestedPrice',
      'totalAmount',
      'remuneration',
      'cost',
      'icms',
      'ipi',
      'margin',
      'minimumMargin',
      'monthlyConsumptionTrendPercent',
      'ratio',
      'quantity',
      'maxQuantity',
      'boxQuantity',
      'reorderPoint',
      'reorderQuantity',
      'orderedQuantity',
      'receivedQuantity',
      'withdrawedQuantity',
      'returnedQuantity',
      'viscosity',
      'weight',
      'volume',
      'volumeLiters',
      'timeTaken',
    ];

    if (numericFields.includes(field)) {
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) {
        value = parsed;
      }
    }
  }

  // Special handling for item returned quantity from metadata
  if (metadata?.fieldType === 'item_returned_quantity' && typeof value === 'number') {
    return `${value.toLocaleString('pt-BR')} un`;
  }

  // Handle boolean values
  if (typeof value === 'boolean') {
    return value ? 'Sim' : 'Não';
  }

  // Handle arrays
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Nenhum';
    if (field === 'barcodes' || field === 'barcode') {
      const stringValues = (value as string[]).filter(Boolean);
      if (stringValues.length > 3) {
        return `${stringValues.slice(0, 3).join(', ')} e mais ${stringValues.length - 3}`;
      }
      return stringValues.join(', ');
    }
    if (field === 'phones') {
      // Format phones array with Brazilian phone formatting
      const formattedPhones = (value as string[])
        .filter(phone => phone && String(phone).trim() !== '')
        .map(phone => formatBrazilianPhone(String(phone)));

      if (formattedPhones.length === 0) return 'Nenhum';
      if (formattedPhones.length > 3) {
        return `${formattedPhones.slice(0, 3).join(', ')} e mais ${formattedPhones.length - 3}`;
      }
      return formattedPhones.join(', ');
    }
    if (field === 'relatedItemIds') {
      return `${value.length} ${value.length === 1 ? 'item relacionado' : 'itens relacionados'}`;
    }
    if (field === 'tags') {
      return value.join(', ');
    }
    if (field === 'measures' && Array.isArray(value)) {
      // Format measures array
      const formattedMeasures = value.map((measure: Record<string, unknown>) => {
        const measureTypeLabels: Record<string, string> = {
          WEIGHT: 'Peso',
          VOLUME: 'Volume',
          LENGTH: 'Comprimento',
          AREA: 'Área',
          COUNT: 'Contagem',
        };
        const type =
          measureTypeLabels[measure.measureType as string] || String(measure.measureType);
        const unit =
          MEASURE_UNIT_LABELS[measure.unit as keyof typeof MEASURE_UNIT_LABELS] ||
          String(measure.unit);
        return `${type}: ${measure.value} ${unit}`;
      });
      return formattedMeasures.join(', ');
    }

    // Task-specific array handling
    if (entityType === CHANGE_LOG_ENTITY_TYPE.TASK) {
      if (field === 'artworks') {
        return `${value.length} ${value.length === 1 ? 'arte' : 'artes'}`;
      }
      if (field === 'baseFiles') {
        return `${value.length} ${value.length === 1 ? 'arquivo base' : 'arquivos base'}`;
      }
      if (field === 'logoPaints' || field === 'paints') {
        return `${value.length} ${value.length === 1 ? 'tinta' : 'tintas'}`;
      }
      if (field === 'services') {
        return `${value.length} ${value.length === 1 ? 'serviço' : 'serviços'}`;
      }
      if (field === 'commissions') {
        return `${value.length} ${value.length === 1 ? 'comissão' : 'comissões'}`;
      }
      if (field === 'airbrushings') {
        return `${value.length} ${value.length === 1 ? 'aerografia' : 'aerografias'}`;
      }
      if (field === 'cutRequest') {
        return `${value.length} ${value.length === 1 ? 'solicitação de corte' : 'solicitações de corte'}`;
      }
      if (field === 'cutPlan') {
        return `${value.length} ${value.length === 1 ? 'plano de corte' : 'planos de corte'}`;
      }
      if (field === 'relatedTasks' || field === 'relatedTo') {
        return `${value.length} ${value.length === 1 ? 'tarefa relacionada' : 'tarefas relacionadas'}`;
      }
    }

    return `${value.length} ${value.length === 1 ? 'item' : 'itens'}`;
  }

  // Handle enums
  if (field === 'measureUnit' && typeof value === 'string') {
    return MEASURE_UNIT_LABELS[value as keyof typeof MEASURE_UNIT_LABELS] || value;
  }

  // Handle order status
  if (
    (field === 'status' || field === 'status_transition') &&
    entityType === CHANGE_LOG_ENTITY_TYPE.ORDER &&
    typeof value === 'string'
  ) {
    const orderStatusLabels: Record<string, string> = {
      CREATED: 'Criado',
      PARTIALLY_FULFILLED: 'Parcialmente Pedido',
      FULFILLED: 'Pedido',
      OVERDUE: 'Atrasado',
      PARTIALLY_RECEIVED: 'Parcialmente Recebido',
      RECEIVED: 'Recebido',
      CANCELLED: 'Cancelado',
    };
    return orderStatusLabels[value] || value;
  }

  // Handle external withdrawal status
  if (
    (field === 'status' || field === 'status_transition') &&
    entityType === CHANGE_LOG_ENTITY_TYPE.EXTERNAL_WITHDRAWAL &&
    typeof value === 'string'
  ) {
    const externalWithdrawalStatusLabels: Record<string, string> = {
      PENDING: 'Pendente',
      PARTIALLY_RETURNED: 'Parcialmente Devolvido',
      FULLY_RETURNED: 'Totalmente Devolvido',
      CHARGED: 'Cobrado',
      CANCELLED: 'Cancelado',
    };
    return externalWithdrawalStatusLabels[value] || value;
  }

  // Handle task status
  if (
    (field === 'status' || field === 'status_transition') &&
    entityType === CHANGE_LOG_ENTITY_TYPE.TASK &&
    typeof value === 'string'
  ) {
    const taskStatusLabels: Record<string, string> = {
      PREPARATION: 'Em Preparação',
      WAITING_PRODUCTION: 'Aguardando Produção',
      IN_PRODUCTION: 'Em Produção',
      COMPLETED: 'Concluído',
      CANCELLED: 'Cancelado',
    };
    return taskStatusLabels[value] || value;
  }

  // Handle truck category
  if (
    (field === 'truck.category' || field === 'category') &&
    (entityType === CHANGE_LOG_ENTITY_TYPE.TASK || entityType === CHANGE_LOG_ENTITY_TYPE.TRUCK) &&
    typeof value === 'string'
  ) {
    return TRUCK_CATEGORY_LABELS[value as keyof typeof TRUCK_CATEGORY_LABELS] || value;
  }

  // Handle truck implement type
  if (
    (field === 'truck.implementType' || field === 'implementType') &&
    (entityType === CHANGE_LOG_ENTITY_TYPE.TASK || entityType === CHANGE_LOG_ENTITY_TYPE.TRUCK) &&
    typeof value === 'string'
  ) {
    // Include legacy CORRUGATED value for old changelog records
    const implementTypeLabelsWithLegacy: Record<string, string> = {
      ...IMPLEMENT_TYPE_LABELS,
      CORRUGATED: 'Baú (Legado)', // Legacy value - migrated to REFRIGERATED
    };
    return implementTypeLabelsWithLegacy[value] || value;
  }

  // Handle maintenance status
  if (
    (field === 'status' || field === 'status_transition') &&
    entityType === CHANGE_LOG_ENTITY_TYPE.MAINTENANCE &&
    typeof value === 'string'
  ) {
    const maintenanceStatusLabels: Record<string, string> = {
      PENDING: 'Pendente',
      IN_PROGRESS: 'Em Progresso',
      COMPLETED: 'Concluído',
      CANCELLED: 'Cancelado',
      OVERDUE: 'Atrasado',
    };
    return maintenanceStatusLabels[value] || value;
  }

  // Handle user status
  if (
    (field === 'status' || field === 'status_transition') &&
    entityType === CHANGE_LOG_ENTITY_TYPE.USER &&
    typeof value === 'string'
  ) {
    const userStatusLabels: Record<string, string> = {
      EXPERIENCE_PERIOD_1: 'Experiência - 1º Período',
      EXPERIENCE_PERIOD_2: 'Experiência - 2º Período',
      EFFECTED: 'Efetivado',
      DISMISSED: 'Demitido',
    };
    return userStatusLabels[value] || value;
  }

  // Handle PPE delivery status
  if (
    (field === 'status' || field === 'status_transition') &&
    entityType === CHANGE_LOG_ENTITY_TYPE.PPE_DELIVERY &&
    typeof value === 'string'
  ) {
    const ppeDeliveryStatusLabels: Record<string, string> = {
      PENDING: 'Pendente',
      APPROVED: 'Aprovado',
      DELIVERED: 'Entregue',
      REPROVED: 'Reprovado',
    };
    return ppeDeliveryStatusLabels[value] || value;
  }

  // Handle holiday type
  if (
    field === 'type' &&
    entityType === CHANGE_LOG_ENTITY_TYPE.HOLIDAY &&
    typeof value === 'string'
  ) {
    const holidayTypeLabels: Record<string, string> = {
      NATIONAL: 'Nacional',
      STATE: 'Estadual',
      MUNICIPAL: 'Municipal',
    };
    return holidayTypeLabels[value] || value;
  }

  // Handle vacation status
  if (
    (field === 'status' || field === 'status_transition') &&
    entityType === CHANGE_LOG_ENTITY_TYPE.VACATION &&
    typeof value === 'string'
  ) {
    const vacationStatusLabels: Record<string, string> = {
      PENDING: 'Pendente',
      APPROVED: 'Aprovado',
      REJECTED: 'Rejeitado',
      IN_PROGRESS: 'Em Andamento',
      COMPLETED: 'Concluído',
      CANCELLED: 'Cancelado',
    };
    return vacationStatusLabels[value] || value;
  }

  // Handle vacation type
  if (
    field === 'type' &&
    entityType === CHANGE_LOG_ENTITY_TYPE.VACATION &&
    typeof value === 'string'
  ) {
    const vacationTypeLabels: Record<string, string> = {
      ANNUAL: 'Anual',
      COLLECTIVE: 'Coletiva',
      SICK_LEAVE: 'Licença Médica',
      MATERNITY_LEAVE: 'Licença Maternidade',
      PATERNITY_LEAVE: 'Licença Paternidade',
      OTHER: 'Outro',
    };
    return vacationTypeLabels[value] || value;
  }

  // Handle cut status
  if (
    (field === 'status' || field === 'status_transition') &&
    entityType === CHANGE_LOG_ENTITY_TYPE.CUT &&
    typeof value === 'string'
  ) {
    const cutStatusLabels: Record<string, string> = {
      PENDING: 'Pendente',
      CUTTING: 'Cortando',
      COMPLETED: 'Concluído',
    };
    return cutStatusLabels[value] || value;
  }

  // Handle cut type
  if (field === 'type' && entityType === CHANGE_LOG_ENTITY_TYPE.CUT && typeof value === 'string') {
    const cutTypeLabels: Record<string, string> = {
      VINYL: 'Vinil',
      STENCIL: 'Estêncil',
    };
    return cutTypeLabels[value] || value;
  }

  // Handle cut origin
  if (
    field === 'origin' &&
    entityType === CHANGE_LOG_ENTITY_TYPE.CUT &&
    typeof value === 'string'
  ) {
    const cutOriginLabels: Record<string, string> = {
      PLAN: 'Plano',
      REQUEST: 'Solicitação',
    };
    return cutOriginLabels[value] || value;
  }

  // Handle cut request reason
  if (
    field === 'reason' &&
    entityType === CHANGE_LOG_ENTITY_TYPE.CUT &&
    typeof value === 'string'
  ) {
    const cutReasonLabels: Record<string, string> = {
      WRONG_APPLY: 'Aplicação Errada',
      LOST: 'Perdido',
      WRONG: 'Errado',
    };
    return cutReasonLabels[value] || value;
  }

  // Handle commission status
  if (
    field === 'commission' &&
    entityType === CHANGE_LOG_ENTITY_TYPE.TASK &&
    typeof value === 'string'
  ) {
    const commissionStatusLabels: Record<string, string> = {
      NO_COMMISSION: 'Sem Comissão',
      PARTIAL_COMMISSION: 'Comissão Parcial',
      FULL_COMMISSION: 'Comissão Integral',
      SUSPENDED_COMMISSION: 'Comissão Suspensa',
    };
    return commissionStatusLabels[value] || value;
  }

  // Handle maintenance type
  if (
    field === 'type' &&
    entityType === CHANGE_LOG_ENTITY_TYPE.MAINTENANCE &&
    typeof value === 'string'
  ) {
    const maintenanceTypeLabels: Record<string, string> = {
      PREVENTIVE: 'Preventiva',
      CORRECTIVE: 'Corretiva',
      PREDICTIVE: 'Preditiva',
      ROUTINE: 'Rotineira',
      EMERGENCY: 'Emergência',
    };
    return maintenanceTypeLabels[value] || value;
  }

  // Handle paint type
  if (
    field === 'type' &&
    entityType === CHANGE_LOG_ENTITY_TYPE.PAINT &&
    typeof value === 'string'
  ) {
    const paintTypeLabels: Record<string, string> = {
      POLYESTER: 'Poliéster',
      ACRYLIC: 'Acrílica',
      LACQUER: 'Laca',
      POLYURETHANE: 'Poliuretano',
      EPOXY: 'Epóxi',
    };
    return paintTypeLabels[value] || value;
  }

  // Handle paint brand
  if (
    field === 'brand' &&
    entityType === CHANGE_LOG_ENTITY_TYPE.PAINT &&
    typeof value === 'string'
  ) {
    const paintBrandLabels: Record<string, string> = {
      PPG: 'PPG',
      FARBEN: 'Farben',
      LAZZURIL: 'Lazzuril',
    };
    return paintBrandLabels[value] || value;
  }

  // Handle paint finish
  if (
    field === 'finish' &&
    entityType === CHANGE_LOG_ENTITY_TYPE.PAINT &&
    typeof value === 'string'
  ) {
    const paintFinishLabels: Record<string, string> = {
      SOLID: 'Sólido',
      METALLIC: 'Metálico',
      PEARL: 'Perolizado',
      MATTE: 'Fosco',
      SATIN: 'Acetinado',
    };
    return paintFinishLabels[value] || value;
  }

  // Handle ABC/XYZ categories
  if (field === 'abcCategory' && typeof value === 'string') {
    const abcLabels: Record<string, string> = {
      A: 'Categoria A - Alto Valor',
      B: 'Categoria B - Valor Médio',
      C: 'Categoria C - Baixo Valor',
    };
    return abcLabels[value] || value;
  }

  if (field === 'xyzCategory' && typeof value === 'string') {
    const xyzLabels: Record<string, string> = {
      X: 'Categoria X - Baixa Variabilidade',
      Y: 'Categoria Y - Média Variabilidade',
      Z: 'Categoria Z - Alta Variabilidade',
    };
    return xyzLabels[value] || value;
  }

  // Handle sector privileges
  if (
    field === 'privileges' &&
    (entityType === CHANGE_LOG_ENTITY_TYPE.SECTOR ||
      entityType === CHANGE_LOG_ENTITY_TYPE.POSITION) &&
    typeof value === 'string'
  ) {
    const privilegeLabels: Record<string, string> = {
      BASIC: 'Básico',
      TRAINEE: 'Estagiário',
      JUNIOR: 'Júnior',
      INTERMEDIATE: 'Intermediário',
      SENIOR: 'Sênior',
      LEAD: 'Líder',
      HUMAN_RESOURCES: 'Recursos Humanos',
      ADMIN: 'Administrador',
    };
    return privilegeLabels[value] || value;
  }

  // Handle activity reasons
  if (field === 'reason' && typeof value === 'string') {
    const activityReasonLabels: Record<string, string> = {
      ORDER_RECEIVED: 'Pedido Recebido',
      PRODUCTION_USAGE: 'Uso em Produção',
      PPE_DELIVERY: 'Entrega de EPI',
      BORROW: 'Empréstimo',
      RETURN: 'Devolução',
      EXTERNAL_WITHDRAWAL: 'Retirada Externa',
      EXTERNAL_WITHDRAWAL_RETURN: 'Devolução de Retirada Externa',
      INVENTORY_COUNT: 'Contagem de Inventário',
      MANUAL_ADJUSTMENT: 'Ajuste Manual',
      MAINTENANCE: 'Manutenção',
      DAMAGE: 'Avaria',
      LOSS: 'Perda',
      OTHER: 'Outro',
    };
    return activityReasonLabels[value] || value;
  }

  // Handle notification type
  if (field === 'notificationType' && typeof value === 'string') {
    const notificationTypeLabels: Record<string, string> = {
      TASK_CREATED: 'Tarefa Criada',
      TASK_UPDATED: 'Tarefa Atualizada',
      TASK_COMPLETED: 'Tarefa Concluída',
      TASK_CANCELLED: 'Tarefa Cancelada',
      TASK_ASSIGNED: 'Tarefa Atribuída',
      ORDER_CREATED: 'Pedido Criado',
      ORDER_UPDATED: 'Pedido Atualizado',
      ORDER_RECEIVED: 'Pedido Recebido',
      ORDER_CANCELLED: 'Pedido Cancelado',
      LOW_STOCK_ALERT: 'Alerta de Estoque Baixo',
      PPE_DELIVERY_SCHEDULED: 'Entrega de EPI Agendada',
      PPE_DELIVERY_PENDING: 'Entrega de EPI Pendente',
      PPE_EXPIRATION_WARNING: 'Aviso de Vencimento de EPI',
      MAINTENANCE_SCHEDULED: 'Manutenção Agendada',
      MAINTENANCE_OVERDUE: 'Manutenção Atrasada',
      VACATION_REQUESTED: 'Férias Solicitadas',
      VACATION_APPROVED: 'Férias Aprovadas',
      VACATION_REJECTED: 'Férias Rejeitadas',
      VACATION_STARTED: 'Férias Iniciadas',
      VACATION_ENDED: 'Férias Finalizadas',
      EXTERNAL_WITHDRAWAL_CREATED: 'Retirada Externa Criada',
      EXTERNAL_WITHDRAWAL_OVERDUE: 'Retirada Externa Atrasada',
      SYSTEM_UPDATE: 'Atualização do Sistema',
      SYSTEM_MAINTENANCE: 'Manutenção do Sistema',
      GENERAL_ANNOUNCEMENT: 'Comunicado Geral',
    };
    return notificationTypeLabels[value] || value;
  }

  // Handle notification importance
  if (
    field === 'importance' &&
    entityType === CHANGE_LOG_ENTITY_TYPE.NOTIFICATION_PREFERENCE &&
    typeof value === 'string'
  ) {
    const importanceLabels: Record<string, string> = {
      LOW: 'Baixa',
      NORMAL: 'Normal',
      HIGH: 'Alta',
      URGENT: 'Urgente',
    };
    return importanceLabels[value] || value;
  }

  // Handle notification channels
  if (
    (field === 'channels' || field === 'channel') &&
    entityType === CHANGE_LOG_ENTITY_TYPE.NOTIFICATION_PREFERENCE &&
    Array.isArray(value)
  ) {
    const channelLabels: Record<string, string> = {
      EMAIL: 'E-mail',
      PUSH: 'Push',
      SMS: 'SMS',
      IN_APP: 'No App',
    };
    const formattedChannels = value.map(channel => channelLabels[channel] || channel);
    if (formattedChannels.length === 0) return 'Nenhum';
    return formattedChannels.join(', ');
  }

  // Handle PPE types
  if ((field === 'ppeType' || field === 'item.ppeType') && typeof value === 'string') {
    const ppeTypeLabels: Record<string, string> = {
      SHIRT: 'Camisa',
      PANTS: 'Calça',
      SHORT: 'Bermuda',
      BOOTS: 'Bota',
      SLEEVES: 'Manga',
      MASK: 'Máscara',
      GLOVES: 'Luva',
      RAIN_BOOTS: 'Bota de Chuva',
      HELMET: 'Capacete',
      GOGGLES: 'Óculos',
      OVERALL: 'Macacão',
      APRON: 'Avental',
      VEST: 'Colete',
      EAR_PROTECTOR: 'Protetor Auricular',
      RESPIRATOR: 'Respirador',
      SAFETY_HARNESS: 'Cinto de Segurança',
      FACE_SHIELD: 'Protetor Facial',
    };
    return ppeTypeLabels[value] || value;
  }

  // Handle PPE sizes
  if (
    (field === 'size' ||
      field === 'shirts' ||
      field === 'pants' ||
      field === 'shorts' ||
      field === 'boots' ||
      field === 'sleeves' ||
      field === 'mask' ||
      field === 'gloves' ||
      field === 'rainBoots') &&
    typeof value === 'string'
  ) {
    // Size values are already in Portuguese format (PP, P, M, G, GG, XGG, etc.)
    return value;
  }

  // Handle schedule frequency
  if ((field === 'frequency' || field === 'ppeSchedule.frequency') && typeof value === 'string') {
    const frequencyLabels: Record<string, string> = {
      DAILY: 'Diário',
      WEEKLY: 'Semanal',
      MONTHLY: 'Mensal',
      QUARTERLY: 'Trimestral',
      SEMI_ANNUAL: 'Semestral',
      ANNUAL: 'Anual',
      ON_DEMAND: 'Sob Demanda',
    };
    return frequencyLabels[value] || value;
  }

  // Handle assignment type
  if (field === 'assignmentType' && typeof value === 'string') {
    const assignmentTypeLabels: Record<string, string> = {
      ALL: 'Todos',
      ALL_EXCEPT: 'Todos Exceto',
      SPECIFIC: 'Específicos',
    };
    return assignmentTypeLabels[value] || value;
  }

  // Handle PPE items array (special handling for PPE schedule)
  // 'items' is the new relational field, 'ppeItems' is legacy JSON field for old changelog entries
  if ((field === 'items' || field === 'ppeItems') && Array.isArray(value)) {
    const ppeTypeLabels: Record<string, string> = {
      SHIRT: 'Camisa',
      PANTS: 'Calça',
      SHORT: 'Bermuda',
      BOOTS: 'Bota',
      SLEEVES: 'Manga',
      MASK: 'Máscara',
      GLOVES: 'Luva',
      RAIN_BOOTS: 'Bota de Chuva',
      HELMET: 'Capacete',
      GOGGLES: 'Óculos',
      OVERALL: 'Macacão',
      APRON: 'Avental',
      VEST: 'Colete',
      EAR_PROTECTOR: 'Protetor Auricular',
      RESPIRATOR: 'Respirador',
      SAFETY_HARNESS: 'Cinto de Segurança',
      FACE_SHIELD: 'Protetor Facial',
      OTHERS: 'Outros',
    };

    const formattedItems = value.map((item: Record<string, unknown>) => {
      if (typeof item === 'object' && item.ppeType) {
        const typeName = ppeTypeLabels[item.ppeType as string] || String(item.ppeType);
        // For OTHERS type, include the item name if available
        if (item.ppeType === 'OTHERS' && item.item && typeof item.item === 'object' && (item.item as any).name) {
          return `${typeName}: ${(item.item as any).name} (${item.quantity} un)`;
        }
        return `${typeName} (${item.quantity} un)`;
      }
      return JSON.stringify(item);
    });

    if (formattedItems.length === 0) return 'Nenhum';
    if (formattedItems.length > 3) {
      return `${formattedItems.slice(0, 3).join(', ')} e mais ${formattedItems.length - 3}`;
    }
    return formattedItems.join(', ');
  }

  // Handle operation type
  if ((field === 'operationType' || field === 'operation') && typeof value === 'number') {
    return value === 1 ? 'Entrada' : value === -1 ? 'Saída' : String(value);
  }

  // Handle activity operation enum
  if ((field === 'operation' || field === 'operationType') && typeof value === 'string') {
    const operationLabels: Record<string, string> = {
      INBOUND: 'Entrada',
      OUTBOUND: 'Saída',
    };
    return operationLabels[value] || value;
  }

  // Handle notification importance
  if (
    field === 'importance' &&
    entityType === CHANGE_LOG_ENTITY_TYPE.NOTIFICATION &&
    typeof value === 'string'
  ) {
    const importanceLabels: Record<string, string> = {
      LOW: 'Baixa',
      MEDIUM: 'Média',
      HIGH: 'Alta',
      URGENT: 'Urgente',
    };
    return importanceLabels[value] || value;
  }

  // Handle notification channel array
  if (
    field === 'channel' &&
    entityType === CHANGE_LOG_ENTITY_TYPE.NOTIFICATION &&
    Array.isArray(value)
  ) {
    const channelLabels: Record<string, string> = {
      IN_APP: 'No Aplicativo',
      EMAIL: 'E-mail',
      SMS: 'SMS',
      PUSH: 'Push',
    };
    const formattedChannels = value.map((channel: string) => channelLabels[channel] || channel);
    return formattedChannels.length > 0 ? formattedChannels.join(', ') : 'Nenhum';
  }

  // Handle TIME_CLOCK_ENTRY specific fields
  if (entityType === CHANGE_LOG_ENTITY_TYPE.TIME_CLOCK_ENTRY) {
    // Handle source field
    if (field === 'source' && typeof value === 'string') {
      const sourceLabels: Record<string, string> = {
        MANUAL: 'Manual',
        SECULLUM: 'Secullum',
        DEVICE: 'Dispositivo',
        MOBILE: 'Mobile',
        WEB: 'Web',
      };
      return sourceLabels[value] || value;
    }

    // Handle dayType field
    if (field === 'dayType' && typeof value === 'number') {
      const dayTypeLabels: Record<number, string> = {
        0: 'Dia de Trabalho',
        1: 'Folga',
        2: 'Feriado',
        3: 'Compensado',
      };
      return dayTypeLabels[value] || `Tipo ${value}`;
    }

    // Handle secullumSyncStatus field
    if (field === 'secullumSyncStatus' && typeof value === 'string') {
      const syncStatusLabels: Record<string, string> = {
        PENDING: 'Pendente',
        SYNCED: 'Sincronizado',
        ERROR: 'Erro',
        CONFLICT: 'Conflito',
      };
      return syncStatusLabels[value] || value;
    }

    // Handle time fields (entry1, exit1, etc.)
    if (field && /^(entry|exit)\d$/.test(field) && typeof value === 'string') {
      return value || '—';
    }
  }

  // Handle file size formatting
  if (field === 'size' && entityType === CHANGE_LOG_ENTITY_TYPE.FILE && typeof value === 'number') {
    // Format file size
    if (value < 1024) {
      return `${value} B`;
    } else if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    } else if (value < 1024 * 1024 * 1024) {
      return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    } else {
      return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
  }

  // Handle file mimetype display
  if (
    field === 'mimetype' &&
    entityType === CHANGE_LOG_ENTITY_TYPE.FILE &&
    typeof value === 'string'
  ) {
    const mimeTypeLabels: Record<string, string> = {
      'application/pdf': 'PDF',
      'image/jpeg': 'JPEG',
      'image/jpg': 'JPG',
      'image/png': 'PNG',
      'image/gif': 'GIF',
      'image/webp': 'WebP',
      'image/svg+xml': 'SVG',
      'application/msword': 'Word',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
      'application/vnd.ms-excel': 'Excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
      'text/plain': 'Texto',
      'text/csv': 'CSV',
      'application/zip': 'ZIP',
      'application/x-rar-compressed': 'RAR',
    };
    return mimeTypeLabels[value] || value;
  }

  // Handle notification read status
  if (field === 'readStatus' && typeof value === 'string') {
    return value === 'read' ? 'Lida' : value === 'unread' ? 'Não Lida' : value;
  }

  // Handle logo field - special case for logoId
  if (field === 'logoId' || field === 'logo') {
    if (!value || value === null) {
      return '—';
    }
    // Check if it's a UUID (logo file ID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof value === 'string' && uuidRegex.test(value)) {
      return `Logo (${value.slice(0, 8)}...)`;
    }
    // For logo fields, we'll handle the display at the UI component level
    // Just return the raw value and let the component handle UUID detection and image rendering
    return String(value);
  }

  // Handle single phone field
  if (field === 'phone' && typeof value === 'string') {
    return formatBrazilianPhone(value);
  }

  // Handle CPF field
  if (field === 'cpf' && typeof value === 'string') {
    return formatCPF(value);
  }

  // Handle CNPJ field
  if (field === 'cnpj' && typeof value === 'string') {
    return formatCNPJ(value);
  }

  // Handle payrollNumber field
  if (field === 'payrollNumber' && typeof value === 'number') {
    return value.toString();
  }

  // Handle UUID references (will be resolved by entity details)
  if (typeof value === 'string') {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(value)) {
      if (
        field === 'supplierId' ||
        field === 'categoryId' ||
        field === 'brandId' ||
        field === 'assignedToUserId' ||
        field === 'createdById' ||
        field === 'customerId' ||
        field === 'sectorId' ||
        field === 'paintId' ||
        field === 'budgetIds' ||
        field === 'invoiceIds' ||
        field === 'receiptIds' ||
        field === 'observationId' ||
        field === 'userId' ||
        field === 'itemId' ||
        field === 'reviewedBy' ||
        field === 'ppeScheduleId' ||
        field === 'ppeConfigId' ||
        field === 'weeklyConfigId' ||
        field === 'monthlyConfigId' ||
        field === 'yearlyConfigId' ||
        field === 'positionId' ||
        field === 'managedSectorId' ||
        field === 'approvedBy' ||
        field === 'rejectedBy' ||
        field === 'cancelledBy' ||
        field === 'managerId'
      ) {
        return value; // Will be replaced with entity name
      }
    }
  }

  // Handle number formatting
  if (typeof value === 'number') {
    // Currency fields
    if (
      field === 'price' ||
      field === 'totalPrice' ||
      field === 'unitCost' ||
      field === 'averageCost' ||
      field === 'lastPurchasePrice' ||
      field === 'suggestedPrice' ||
      field === 'totalAmount' ||
      field === 'remuneration' ||
      field === 'cost' ||
      field === 'pricePerLiter'
    ) {
      return formatCurrency(value);
    }

    // ORDER_ITEM specific - calculate total price
    if (field === 'totalPrice' && entityType === CHANGE_LOG_ENTITY_TYPE.ORDER_ITEM) {
      return formatCurrency(value);
    }

    // Percentage fields
    if (
      field === 'tax' ||
      field === 'margin' ||
      field === 'minimumMargin' ||
      field === 'monthlyConsumptionTrendPercent' ||
      field === 'ratio'
    ) {
      return `${value.toLocaleString('pt-BR')}%`;
    }

    // Time fields (days)
    if (field === 'leadTime' || field === 'estimatedLeadTime' || field === 'warrantyPeriod') {
      return `${value} ${value === 1 ? 'dia' : 'dias'}`;
    }

    // Time fields (seconds) - format as HH:MM
    if (field === 'timeTaken') {
      const hours = Math.floor(value / 3600);
      const minutes = Math.floor((value % 3600) / 60);
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    // Quantity fields
    if (
      field === 'quantity' ||
      field === 'maxQuantity' ||
      field === 'boxQuantity' ||
      field === 'reorderPoint' ||
      field === 'reorderQuantity' ||
      field === 'orderedQuantity' ||
      field === 'receivedQuantity' ||
      field === 'withdrawedQuantity' ||
      field === 'returnedQuantity'
    ) {
      return `${value.toLocaleString('pt-BR')} un`;
    }

    // Density field
    if (field === 'density') {
      return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} g/ml`;
    }

    // Viscosity field
    if (field === 'viscosity') {
      return `${value.toLocaleString('pt-BR')} cP`;
    }

    // Weight field (grams)
    if (
      field === 'weight' &&
      (entityType === CHANGE_LOG_ENTITY_TYPE.PAINT_FORMULA_COMPONENT ||
        entityType === CHANGE_LOG_ENTITY_TYPE.PAINT_PRODUCTION)
    ) {
      return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} g`;
    }

    // Volume field (milliliters)
    if (field === 'volume' && entityType === CHANGE_LOG_ENTITY_TYPE.PAINT_FORMULA_COMPONENT) {
      return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ml`;
    }

    // Volume field (liters)
    if (field === 'volumeLiters') {
      return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} L`;
    }

    // Order fields
    if (field === 'abcCategoryOrder' || field === 'xyzCategoryOrder') {
      return `${value}º`;
    }

    return value.toLocaleString('pt-BR');
  }

  // Handle date formatting
  if (
    field === 'createdAt' ||
    field === 'updatedAt' ||
    field === 'expirationDate' ||
    field === 'manufacturingDate' ||
    field === 'lastPurchaseDate' ||
    field === 'deliveryDate' ||
    field === 'receivedDate' ||
    field === 'dueDate' ||
    field === 'startedAt' ||
    field === 'completedAt' ||
    field === 'finishedAt' ||
    field === 'entryDate' ||
    field === 'term' ||
    field === 'scheduledFor' ||
    field === 'forecast' ||
    field === 'receivedAt' ||
    field === 'fulfilledAt' ||
    field === 'scheduledDate' ||
    field === 'actualDeliveryDate' ||
    field === 'nextRun' ||
    field === 'lastRun' ||
    field === 'hireDate' ||
    field === 'birthDate' ||
    field === 'verificationExpiresAt' ||
    field === 'lastLoginAt' ||
    field === 'startAt' ||
    field === 'endAt' ||
    field === 'approvedAt' ||
    field === 'rejectedAt' ||
    field === 'cancelledAt' ||
    field === 'productionDate' ||
    field === 'sentAt' ||
    field === 'scheduledAt' ||
    field === 'seenAt'
  ) {
    const date = new Date(value as any);
    if (!isNaN(date.getTime())) {
      return formatDateTime(date);
    }
  }

  // Handle empty strings
  if (value === '') {
    return 'Vazio';
  }

  // Handle objects
  if (typeof value === 'object') {
    // Special handling for componentImpact field in PAINT_PRODUCTION
    if (field === 'componentImpact' && entityType === CHANGE_LOG_ENTITY_TYPE.PAINT_PRODUCTION) {
      if ((value as any).action === 'ADD_COMPONENT') {
        return `Componente adicionado: ${(value as any).itemName} (${(value as any).ratio.toFixed(2)}%)`;
      } else if ((value as any).action === 'REMOVE_COMPONENT') {
        return `Componente removido: ${(value as any).itemName} (${(value as any).ratio.toFixed(2)}%)`;
      } else if ((value as any).operationType === 'INCREASE') {
        return `${(value as any).itemName}: ${(value as any).additionalUnitsUsed.toFixed(2)} unidades adicionais utilizadas (${(value as any).additionalVolumeUsed.toFixed(3)}L)`;
      } else if ((value as any).operationType === 'DECREASE') {
        return `${(value as any).itemName}: ${(value as any).returnedUnits.toFixed(2)} unidades retornadas (${(value as any).returnedVolume.toFixed(3)}L)`;
      } else if ((value as any).operationType === 'DELETE_RETURN') {
        return `${(value as any).itemName}: ${(value as any).returnedUnits.toFixed(2)} unidades retornadas`;
      } else if ((value as any).batchOperation) {
        return `${(value as any).itemName}: ${(value as any).unitsUsed.toFixed(2)} unidades (${(value as any).volumeUsed.toFixed(3)}L)`;
      } else {
        return `${(value as any).itemName}: ${(value as any).unitsUsed.toFixed(2)} unidades (${(value as any).volumeUsed.toFixed(3)}L, ${(value as any).ratio.toFixed(1)}%)`;
      }
    }

    // Special handling for components field in PAINT_FORMULA
    if (field === 'components' && entityType === CHANGE_LOG_ENTITY_TYPE.PAINT_FORMULA) {
      if ((value as any).action === 'ADD_COMPONENT') {
        return `${(value as any).itemName} adicionado (${(value as any).ratio.toFixed(2)}%)`;
      } else if ((value as any).action === 'REMOVE_COMPONENT') {
        return `Componente removido (${(value as any).ratio.toFixed(2)}%)`;
      }
    }

    // Special handling for batch_mark_delivered field in PPE_DELIVERY
    if (field === 'batch_mark_delivered' && entityType === CHANGE_LOG_ENTITY_TYPE.PPE_DELIVERY) {
      const obj = value as any;
      const ppeDeliveryStatusLabels: Record<string, string> = {
        PENDING: 'Pendente',
        APPROVED: 'Aprovado',
        DELIVERED: 'Entregue',
        WAITING_SIGNATURE: 'Aguardando Assinatura',
        COMPLETED: 'Concluído',
        REPROVED: 'Reprovado',
        SIGNATURE_REJECTED: 'Assinatura Rejeitada',
        CANCELLED: 'Cancelado',
      };

      // Just return the status label - date and user are shown in changelog header
      return ppeDeliveryStatusLabels[obj.status] || obj.status;
    }

    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

// Action configuration for changelog
export const actionConfig: Record<CHANGE_LOG_ACTION, { label: string }> = {
  [CHANGE_LOG_ACTION.CREATE]: { label: 'Criado' },
  [CHANGE_LOG_ACTION.UPDATE]: { label: 'Atualizado' },
  [CHANGE_LOG_ACTION.DELETE]: { label: 'Excluído' },
  [CHANGE_LOG_ACTION.RESTORE]: { label: 'Restaurado' },
  [CHANGE_LOG_ACTION.ROLLBACK]: { label: 'Revertido' },
  [CHANGE_LOG_ACTION.ARCHIVE]: { label: 'Arquivado' },
  [CHANGE_LOG_ACTION.UNARCHIVE]: { label: 'Desarquivado' },
  [CHANGE_LOG_ACTION.ACTIVATE]: { label: 'Ativado' },
  [CHANGE_LOG_ACTION.DEACTIVATE]: { label: 'Desativado' },
  [CHANGE_LOG_ACTION.APPROVE]: { label: 'Aprovado' },
  [CHANGE_LOG_ACTION.REJECT]: { label: 'Rejeitado' },
  [CHANGE_LOG_ACTION.CANCEL]: { label: 'Cancelado' },
  [CHANGE_LOG_ACTION.COMPLETE]: { label: 'Concluído' },
  [CHANGE_LOG_ACTION.RESCHEDULE]: { label: 'Reagendado' },
  [CHANGE_LOG_ACTION.BATCH_CREATE]: { label: 'Criação em Lote' },
  [CHANGE_LOG_ACTION.BATCH_UPDATE]: { label: 'Atualização em Lote' },
  [CHANGE_LOG_ACTION.BATCH_DELETE]: { label: 'Exclusão em Lote' },
  [CHANGE_LOG_ACTION.VIEW]: { label: 'Visualizado' },
};

/**
 * Determine the action label based on action and triggered by
 * @param action - The change action
 * @param triggeredBy - The trigger type
 * @returns The action label
 */
export function getActionLabel(
  action: CHANGE_LOG_ACTION,
  triggeredBy?: CHANGE_TRIGGERED_BY,
): string {
  const baseLabel = actionConfig[action]?.label || action;

  // Handle batch operations
  if (triggeredBy === CHANGE_TRIGGERED_BY.BATCH_UPDATE) {
    return 'Atualizado em lote';
  } else if (triggeredBy === CHANGE_TRIGGERED_BY.BATCH_CREATE) {
    return 'Criado em lote';
  } else if (triggeredBy === CHANGE_TRIGGERED_BY.BATCH_DELETE) {
    return 'Excluído em lote';
  } else if (triggeredBy === CHANGE_TRIGGERED_BY.BATCH_OPERATION) {
    return 'Operação em lote';
  }

  return baseLabel;
}

/**
 * Check if this is a batch operation
 * @param triggeredBy - The trigger type
 * @returns Whether this is a batch operation
 */
export function isBatchOperation(triggeredBy?: CHANGE_TRIGGERED_BY): boolean {
  return (
    triggeredBy === CHANGE_TRIGGERED_BY.BATCH_UPDATE ||
    triggeredBy === CHANGE_TRIGGERED_BY.BATCH_CREATE ||
    triggeredBy === CHANGE_TRIGGERED_BY.BATCH_DELETE ||
    triggeredBy === CHANGE_TRIGGERED_BY.BATCH_OPERATION
  );
}
