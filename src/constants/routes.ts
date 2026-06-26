// Complete route structure for Ankaa Brazilian manufacturing management system
// Updated to match navigation menu structure exactly
export const routes = {
  // Administration - Administração - Administration
  administration: {
    changeLogs: {
      details: (id: string) => `/administracao/registros-de-alteracoes/detalhes/${id}`,
      entity: (entityType: string, entityId: string) =>
        `/administracao/registros-de-alteracoes/entidade/${entityType}/${entityId}`,
      root: '/administracao/registros-de-alteracoes',
    },
    customers: {
      batchEdit: '/administracao/clientes/editar-em-lote',
      create: '/administracao/clientes/cadastrar',
      details: (id: string) => `/administracao/clientes/detalhes/${id}`,
      edit: (id: string) => `/administracao/clientes/editar/${id}`,
      root: '/administracao/clientes',
    },
    collaborators: {
      batchEdit: '/departamento-pessoal/colaboradores/editar-em-lote',
      create: '/departamento-pessoal/colaboradores/cadastrar',
      details: (id: string) => `/departamento-pessoal/colaboradores/detalhes/${id}`,
      edit: (id: string) => `/departamento-pessoal/colaboradores/editar/${id}`,
      root: '/departamento-pessoal/colaboradores',
    },
    files: {
      details: (id: string) => `/administracao/arquivos/detalhes/${id}`,
      orphans: '/administracao/arquivos/orfaos',
      root: '/administracao/arquivos',
      upload: '/administracao/arquivos/upload',
    },
    notifications: {
      create: '/administracao/notificacoes/cadastrar/enviar',
      details: (id: string) => `/administracao/notificacoes/detalhes/${id}`,
      edit: (id: string) => `/administracao/notificacoes/editar/${id}`,
      root: '/administracao/notificacoes',
    },
    root: '/administracao',
    sectors: {
      batchEdit: '/administracao/setores/editar-em-lote',
      create: '/administracao/setores/cadastrar',
      details: (id: string) => `/administracao/setores/detalhes/${id}`,
      edit: (id: string) => `/administracao/setores/editar/${id}`,
      root: '/administracao/setores',
    },
    users: {
      batchEdit: '/departamento-pessoal/colaboradores/editar-em-lote',
      create: '/departamento-pessoal/colaboradores/cadastrar',
      details: (id: string) => `/departamento-pessoal/colaboradores/detalhes/${id}`,
      edit: (id: string) => `/departamento-pessoal/colaboradores/editar/${id}`,
      root: '/departamento-pessoal/colaboradores',
    },
    monitoring: {
      dashboard: '/administracao/monitoramento/dashboard',
      root: '/administracao/monitoramento',
      metrics: {
        list: '/administracao/monitoramento/metricas',
        root: '/administracao/monitoramento/metricas',
      },
      alerts: {
        list: '/administracao/monitoramento/alertas',
        root: '/administracao/monitoramento/alertas',
      },
      logs: {
        list: '/administracao/monitoramento/logs',
        root: '/administracao/monitoramento/logs',
      },
    },
  },

  // Authentication - Rotas de autenticação
  authentication: {
    login: '/autenticacao/entrar', // fazer login
    recoverPassword: '/autenticacao/recuperar-senha', // recuperar senha
    register: '/autenticacao/registrar', // registrar-se
    resetPassword: (token: string) => `/autenticacao/redefinir-senha/${token}`, // redefinir senha com token
    verifyCode: '/autenticacao/verificar-codigo', // código de verificação (unificado)
    verifyPasswordReset: '/autenticacao/verificar-redefinicao-senha', // verificação de redefinição de senha
  },

  // Basic Catalog - Catálogo Básico - Basic catalog access for leaders
  catalog: {
    details: (id: string) => `/pintura/catalogo/detalhes/${id}`,
    root: '/pintura/catalogo-basico',
  },

  // Customers - Alias for administration customers for backward compatibility
  customers: {
    batchEdit: '/administracao/clientes/editar-em-lote',
    create: '/administracao/clientes/cadastrar',
    details: (id: string) => `/administracao/clientes/detalhes/${id}`,
    edit: (id: string) => `/administracao/clientes/editar/${id}`,
    root: '/administracao/clientes',
  },

  // Favorites - Favoritos - User Favorites
  favorites: '/favoritos',

  // Home - Página inicial
  home: '/',

  // Financial - Financeiro - Financial Management
  financial: {
    root: '/financeiro',
  },

  // Personnel Department - Departamento Pessoal - Personnel Department
  personnelDepartment: {
    calculations: {
      list: '/departamento-pessoal/calculos',
      root: '/departamento-pessoal/calculos',
    },
    holidays: {
      calendar: '/departamento-pessoal/feriados/calendario',
      create: '/departamento-pessoal/feriados/cadastrar',
      details: (id: string) => `/departamento-pessoal/feriados/detalhes/${id}`,
      edit: (id: string) => `/departamento-pessoal/feriados/editar/${id}`,
      list: '/departamento-pessoal/feriados',
      root: '/departamento-pessoal/feriados',
    },
    positions: {
      batchEdit: '/departamento-pessoal/cargos/editar-em-lote',
      create: '/departamento-pessoal/cargos/cadastrar',
      details: (id: string) => `/departamento-pessoal/cargos/detalhes/${id}`,
      edit: (id: string) => `/departamento-pessoal/cargos/editar/${id}`,
      remunerations: (positionId: string) => `/departamento-pessoal/cargos/${positionId}/remuneracoes`,
      root: '/departamento-pessoal/cargos',
    },
    performanceLevels: {
      list: '/departamento-pessoal/niveis-desempenho',
      root: '/departamento-pessoal/niveis-desempenho',
    },
    ppe: {
      create: '/departamento-pessoal/epi/cadastrar',
      deliveries: {
        create: '/departamento-pessoal/epi/entregas/cadastrar',
        details: (id: string) => `/departamento-pessoal/epi/entregas/detalhes/${id}`,
        edit: (id: string) => `/departamento-pessoal/epi/entregas/editar/${id}`,
        root: '/departamento-pessoal/epi/entregas',
      },
      details: (id: string) => `/departamento-pessoal/epi/detalhes/${id}`,
      edit: (id: string) => `/departamento-pessoal/epi/editar/${id}`,
      reports: {
        masks: '/departamento-pessoal/epi/relatorios/mascaras',
        root: '/departamento-pessoal/epi/relatorios',
        stock: '/departamento-pessoal/epi/relatorios/estoque',
        usage: '/departamento-pessoal/epi/relatorios/uso',
      },
      root: '/departamento-pessoal/epi',
      schedules: {
        create: '/departamento-pessoal/epi/agendamentos/cadastrar',
        details: (id: string) => `/departamento-pessoal/epi/agendamentos/detalhes/${id}`,
        edit: (id: string) => `/departamento-pessoal/epi/agendamentos/editar/${id}`,
        root: '/departamento-pessoal/epi/agendamentos',
      },
      sizes: {
        create: '/departamento-pessoal/epi/tamanhos/cadastrar',
        details: (id: string) => `/departamento-pessoal/epi/tamanhos/detalhes/${id}`,
        edit: (id: string) => `/departamento-pessoal/epi/tamanhos/editar/${id}`,
        root: '/departamento-pessoal/epi/tamanhos',
      },
    },
    requisicoes: {
      list: '/departamento-pessoal/controle-ponto/requisicoes',
      root: '/departamento-pessoal/controle-ponto/requisicoes',
    },
    root: '/departamento-pessoal',
    timeClock: {
      list: '/departamento-pessoal/controle-ponto',
      root: '/departamento-pessoal/controle-ponto',
    },
    absences: {
      root: '/departamento-pessoal/ausencias',
      create: '/departamento-pessoal/ausencias/cadastrar',
      collective: '/departamento-pessoal/ausencias/coletiva',
      edit: (id: string) => `/departamento-pessoal/ausencias/editar/${id}`,
      details: (id: string) => `/departamento-pessoal/ausencias/detalhes/${id}`,
    },
    faltas: {
      root: '/departamento-pessoal/faltas',
      create: '/departamento-pessoal/faltas/cadastrar',
      edit: (id: string) => `/departamento-pessoal/faltas/editar/${id}`,
      details: (id: string) => `/departamento-pessoal/faltas/detalhes/${id}`,
    },
    calendar: {
      root: '/departamento-pessoal/calendario',
    },
    warnings: {
      batchEdit: '/departamento-pessoal/avisos/editar-em-lote',
      create: '/departamento-pessoal/avisos/cadastrar',
      details: (id: string) => `/departamento-pessoal/avisos/detalhes/${id}`,
      edit: (id: string) => `/departamento-pessoal/avisos/editar/${id}`,
      root: '/departamento-pessoal/avisos',
    },
    payroll: {
      root: '/departamento-pessoal/folha-de-pagamento',
      list: '/departamento-pessoal/folha-de-pagamento',
      detail: (payrollId: string) => `/departamento-pessoal/folha-de-pagamento/detalhe/${payrollId}`,
      create: '/departamento-pessoal/folha-de-pagamento/criar',
      edit: (payrollId: string) => `/departamento-pessoal/folha-de-pagamento/editar/${payrollId}`,
    },
    // Mirrors web/src/constants/routes.ts (the registered web routes are
    // /departamento-pessoal/bonus/:id and /departamento-pessoal/bonus/simulacao-de-bonus)
    bonus: {
      root: '/departamento-pessoal/bonus',
      list: '/departamento-pessoal/bonus',
      details: (id: string) => `/departamento-pessoal/bonus/${id}`,
      simulation: '/departamento-pessoal/bonus/simulacao-de-bonus',
      performanceLevels: {
        root: '/departamento-pessoal/bonus/nivel-de-performance',
        list: '/departamento-pessoal/bonus/nivel-de-performance',
      },
    },
    // Medicina do Trabalho — FISPQ/FDS (inventário de produtos químicos).
    // Mirrors web /medicina-do-trabalho/fispq deep-links.
    fispq: {
      root: '/medicina-do-trabalho/fispq',
      list: '/medicina-do-trabalho/fispq',
      create: '/medicina-do-trabalho/fispq/cadastrar',
      details: (id: string) => `/medicina-do-trabalho/fispq/detalhes/${id}`,
      edit: (id: string) => `/medicina-do-trabalho/fispq/editar/${id}`,
    },
  },

  // Inventory - Estoque - Inventory Management
  inventory: {
    externalOperations: {
      create: '/estoque/operacoes-externas/cadastrar',
      details: (id: string) => `/estoque/operacoes-externas/detalhes/${id}`,
      edit: (id: string) => `/estoque/operacoes-externas/editar/${id}`,
      list: '/estoque/operacoes-externas',
      root: '/estoque/operacoes-externas',
    },
    loans: {
      batchEdit: '/estoque/emprestimos/editar-lote',
      create: '/estoque/emprestimos/cadastrar',
      details: (id: string) => `/estoque/emprestimos/detalhes/${id}`,
      import: '/estoque/emprestimos/importar',
      list: '/estoque/emprestimos',
      root: '/estoque/emprestimos',
    },
    maintenance: {
      create: '/estoque/manutencao/cadastrar',
      details: (id: string) => `/estoque/manutencao/detalhes/${id}`,
      edit: (id: string) => `/estoque/manutencao/editar/${id}`,
      list: '/estoque/manutencao/listar',
      root: '/estoque/manutencao',
      schedules: {
        create: '/estoque/manutencao/agendamentos/cadastrar',
        details: (id: string) => `/estoque/manutencao/agendamentos/detalhes/${id}`,
        edit: (id: string) => `/estoque/manutencao/agendamentos/editar/${id}`,
        root: '/estoque/manutencao/agendamentos',
      },
    },
    movements: {
      batchEdit: '/estoque/movimentacoes/editar-lote',
      create: '/estoque/movimentacoes/cadastrar',
      details: (id: string) => `/estoque/movimentacoes/detalhes/${id}`,
      edit: (id: string) => `/estoque/movimentacoes/editar/${id}`,
      list: '/estoque/movimentacoes',
      root: '/estoque/movimentacoes',
    },
    orders: {
      automatic: {
        configure: '/estoque/pedidos/automaticos/configurar',
        create: '/estoque/pedidos/automaticos/cadastrar',
        details: (id: string) => `/estoque/pedidos/automaticos/detalhes/${id}`,
        edit: (id: string) => `/estoque/pedidos/automaticos/editar/${id}`,
        list: '/estoque/pedidos/automaticos/listar',
        root: '/estoque/pedidos/automaticos',
      },
      create: '/estoque/pedidos/cadastrar',
      details: (id: string) => `/estoque/pedidos/detalhes/${id}`,
      edit: (id: string) => `/estoque/pedidos/editar/${id}`,
      list: '/estoque/pedidos',
      root: '/estoque/pedidos',
      schedules: {
        create: '/estoque/pedidos/agendamentos/cadastrar',
        details: (id: string) => `/estoque/pedidos/agendamentos/detalhes/${id}`,
        edit: (id: string) => `/estoque/pedidos/agendamentos/editar/${id}`,
        root: '/estoque/pedidos/agendamentos',
      },
    },
    ppe: {
      create: '/estoque/epi/cadastrar',
      deliveries: {
        create: '/estoque/epi/entregas/cadastrar',
        details: (id: string) => `/estoque/epi/entregas/detalhes/${id}`,
        edit: (id: string) => `/estoque/epi/entregas/editar/${id}`,
        list: '/estoque/epi/entregas',
        root: '/estoque/epi/entregas',
      },
      details: (id: string) => `/estoque/epi/detalhes/${id}`,
      edit: (id: string) => `/estoque/epi/editar/${id}`,
      root: '/estoque/epi',
      schedules: {
        create: '/estoque/epi/agendamentos/cadastrar',
        details: (id: string) => `/estoque/epi/agendamentos/detalhes/${id}`,
        edit: (id: string) => `/estoque/epi/agendamentos/editar/${id}`,
        root: '/estoque/epi/agendamentos',
      },
    },
    products: {
      batchEdit: '/estoque/produtos/editar-em-lote',
      brands: {
        batchEdit: '/estoque/produtos/marcas/editar-em-lote',
        create: '/estoque/produtos/marcas/cadastrar',
        details: (id: string) => `/estoque/produtos/marcas/detalhes/${id}`,
        edit: (id: string) => `/estoque/produtos/marcas/editar/${id}`,
        list: '/estoque/produtos/marcas',
        root: '/estoque/produtos/marcas',
      },
      categories: {
        batchEdit: '/estoque/produtos/categorias/editar-em-lote',
        create: '/estoque/produtos/categorias/cadastrar',
        details: (id: string) => `/estoque/produtos/categorias/detalhes/${id}`,
        edit: (id: string) => `/estoque/produtos/categorias/editar/${id}`,
        list: '/estoque/produtos/categorias',
        root: '/estoque/produtos/categorias',
      },
      create: '/estoque/produtos/cadastrar',
      details: (id: string) => `/estoque/produtos/detalhes/${id}`,
      edit: (id: string) => `/estoque/produtos/editar/${id}`,
      list: '/estoque/produtos',
      root: '/estoque/produtos',
    },
    root: '/estoque',
    suppliers: {
      batchEdit: '/estoque/fornecedores/editar-em-lote',
      create: '/estoque/fornecedores/cadastrar',
      details: (id: string) => `/estoque/fornecedores/detalhes/${id}`,
      edit: (id: string) => `/estoque/fornecedores/editar/${id}`,
      root: '/estoque/fornecedores',
    },
  },

  maintenance: {
    create: '/manutencao/cadastrar',
    details: (id: string) => `/manutencao/detalhes/${id}`,
    edit: (id: string) => `/manutencao/editar/${id}`,
    root: '/manutencao',
  },

  // Meu Pessoal - Sector Employee Management for Leaders
  meuPessoal: {
    avisos: {
      details: (sectorId: string, id: string) => `/meu-pessoal/avisos/${sectorId}/detalhes/${id}`,
      root: (sectorId: string) => `/meu-pessoal/avisos/${sectorId}`,
    },
    emprestimos: {
      details: (sectorId: string, id: string) =>
        `/meu-pessoal/emprestimos/${sectorId}/detalhes/${id}`,
      root: (sectorId: string) => `/meu-pessoal/emprestimos/${sectorId}`,
    },
    root: '/meu-pessoal',
  },

  // My Team - Meu Pessoal - Team management for leaders (simplified routes)
  myTeam: {
    loans: '/meu-pessoal/emprestimos',
    root: '/meu-pessoal',
    warnings: '/meu-pessoal/avisos',
  },

  // Painting - Pintura - Paint Management
  painting: {
    catalog: {
      create: '/pintura/catalogo/cadastrar',
      details: (id: string) => `/pintura/catalogo/detalhes/${id}`,
      edit: (id: string) => `/pintura/catalogo/editar/${id}`,
      formulaDetails: (paintId: string, formulaId: string) =>
        `/pintura/catalogo/detalhes/${paintId}/formulas/detalhes/${formulaId}`,
      formulas: (paintId: string) => `/pintura/catalogo/detalhes/${paintId}/formulas`,
      root: '/pintura/catalogo',
    },
    components: {
      create: '/pintura/componentes/cadastrar',
      details: (id: string) => `/pintura/componentes/detalhes/${id}`,
      edit: (id: string) => `/pintura/componentes/editar/${id}`,
      list: '/pintura/componentes/listar',
      root: '/pintura/componentes',
    },
    formulas: {
      create: '/pintura/formulas/cadastrar',
      details: (id: string) => `/pintura/formulas/detalhes/${id}`,
      edit: (id: string) => `/pintura/formulas/editar/${id}`,
      list: '/pintura/formulas/listar',
      root: '/pintura/formulas',
    },
    formulations: {
      create: '/pintura/formulacoes/cadastrar',
      details: (id: string) => `/pintura/formulacoes/detalhes/${id}`,
      edit: (id: string) => `/pintura/formulacoes/editar/${id}`,
      list: '/pintura/formulacoes/listar',
      root: '/pintura/formulacoes',
    },
    paintTypes: {
      create: '/pintura/tipos-de-tinta/cadastrar',
      details: (id: string) => `/pintura/tipos-de-tinta/detalhes/${id}`,
      edit: (id: string) => `/pintura/tipos-de-tinta/editar/${id}`,
      list: '/pintura/tipos-de-tinta/listar',
      root: '/pintura/tipos-de-tinta',
    },
    paintBrands: {
      create: '/pintura/marcas-de-tinta/cadastrar',
      details: (id: string) => `/pintura/marcas-de-tinta/detalhes/${id}`,
      edit: (id: string) => `/pintura/marcas-de-tinta/editar/${id}`,
      list: '/pintura/marcas-de-tinta/listar',
      root: '/pintura/marcas-de-tinta',
    },
    productions: {
      create: '/pintura/producoes/cadastrar',
      details: (id: string) => `/pintura/producoes/detalhes/${id}`,
      edit: (id: string) => `/pintura/producoes/editar/${id}`,
      root: '/pintura/producoes',
    },
    root: '/pintura',
  },

  // Personal - Pessoal - Personal (User-specific data)
  personal: {
    myHolidays: {
      root: '/pessoal/meus-feriados',
    },
    myLoans: {
      details: (id: string) => `/pessoal/meus-emprestimos/detalhes/${id}`,
      root: '/pessoal/meus-emprestimos',
    },
    myNotifications: {
      details: (id: string) => `/pessoal/minhas-notificacoes/detalhes/${id}`,
      root: '/pessoal/minhas-notificacoes',
    },
    myPpes: {
      request: '/pessoal/meus-epis/solicitar',
      root: '/pessoal/meus-epis',
    },
    myProfile: {
      root: '/pessoal/meu-perfil',
    },
    myWarnings: {
      details: (id: string) => `/pessoal/meus-avisos/detalhes/${id}`,
      root: '/pessoal/meus-avisos',
    },
    preferences: {
      root: '/pessoal/preferencias',
    },
    root: '/pessoal',
  },

  // Production - Produção - Production Management
  production: {
    airbrushings: {
      create: '/producao/aerografia/cadastrar',
      details: (id: string) => `/producao/aerografia/detalhes/${id}`,
      edit: (id: string) => `/producao/aerografia/editar/${id}`,
      list: '/producao/aerografia/listar',
      root: '/producao/aerografia',
    },
    cutting: {
      create: '/producao/recorte/cadastrar',
      details: (id: string) => `/producao/recorte/detalhes/${id}`,
      edit: (id: string) => `/producao/recorte/editar/${id}`,
      list: '/producao/recorte',
      root: '/producao/recorte',
    },
    garages: {
      root: '/producao/barracoes',
      patio: '/producao/barracoes/patio',
    },
    history: {
      cancelled: '/producao/historico/cancelados',
      completed: '/producao/historico/concluidos',
      root: '/producao/historico',
      details: (id: string) => `/producao/historico/detalhes/${id}`,
    },
    observations: {
      create: '/producao/observacoes/cadastrar',
      details: (id: string) => `/producao/observacoes/detalhes/${id}`,
      edit: (id: string) => `/producao/observacoes/editar/${id}`,
      list: '/producao/observacoes',
      root: '/producao/observacoes',
    },
    root: '/producao',
    // Note: 'schedule' property name is kept for backward compatibility but routes point to 'cronograma'
    schedule: {
      batchEdit: '/producao/cronograma/editar-em-lote',
      create: '/producao/cronograma/cadastrar',
      details: (id: string) => `/producao/cronograma/detalhes/${id}`,
      edit: (id: string) => `/producao/cronograma/editar/${id}`,
      list: '/producao/cronograma',
      root: '/producao/cronograma',
    },
    scheduleOnHold: {
      root: '/producao/em-espera',
      details: (id: string) => `/producao/em-espera/detalhes/${id}`,
    },
    serviceOrders: {
      create: '/producao/ordens-de-servico/cadastrar',
      details: (id: string) => `/producao/ordens-de-servico/detalhes/${id}`,
      edit: (id: string) => `/producao/ordens-de-servico/editar/${id}`,
      root: '/producao/ordens-de-servico',
    },
    services: {
      create: '/producao/servicos/cadastrar',
      details: (id: string) => `/producao/servicos/detalhes/${id}`,
      edit: (id: string) => `/producao/servicos/editar/${id}`,
      list: '/producao/servicos',
      root: '/producao/servicos',
    },
    trucks: {
      create: '/producao/caminhoes/cadastrar',
      details: (id: string) => `/producao/caminhoes/detalhes/${id}`,
      edit: (id: string) => `/producao/caminhoes/editar/${id}`,
      list: '/producao/caminhoes',
      root: '/producao/caminhoes',
    },
  },

  // Server - Servidor - Server Management
  server: {
    backup: '/servidor/backup',
    deployments: {
      create: '/servidor/implantacoes/cadastrar',
      details: (id: string) => `/servidor/implantacoes/detalhes/${id}`,
      edit: (id: string) => `/servidor/implantacoes/editar/${id}`,
      root: '/servidor/implantacoes',
    },
    logs: '/servidor/logs',
    metrics: '/servidor/metricas',
    root: '/servidor',
    services: '/servidor/servicos',
    sharedFolders: '/servidor/pastas-compartilhadas',
    users: {
      create: '/servidor/usuarios/cadastrar',
      root: '/servidor/usuarios',
    },
  },

  // Statistics - Estatísticas - Statistics/Analytics
  statistics: {
    administration: '/estatisticas/administracao',
    personnelDepartment: '/estatisticas/departamento-pessoal',
    inventory: {
      root: '/estatisticas/estoque',
      consumption: '/estatisticas/estoque/consumo',
      stockMovement: '/estatisticas/estoque/movimentacao',
      trends: '/estatisticas/estoque/tendencias',
      topItems: '/estatisticas/estoque/top-itens',
    },
    production: '/estatisticas/producao',
    root: '/estatisticas',
  },

  // Integrations - Integrações - System integrations
  integrations: {
    root: '/integracoes',
    secullum: {
      root: '/integracoes/secullum',
      timeEntries: {
        root: '/integracoes/secullum/registros-ponto',
        details: (id: string) => `/integracoes/secullum/registros-ponto/detalhes/${id}`,
      },
      calculations: '/integracoes/secullum/calculos',
      syncStatus: '/integracoes/secullum/status-sincronizacao',
    },
  },

  // Users - Alias for administration users (collaborators) for backward compatibility
  users: {
    batchEdit: '/departamento-pessoal/colaboradores/editar-em-lote',
    create: '/departamento-pessoal/colaboradores/cadastrar',
    details: (id: string) => `/departamento-pessoal/colaboradores/detalhes/${id}`,
    edit: (id: string) => `/departamento-pessoal/colaboradores/editar/${id}`,
    root: '/departamento-pessoal/colaboradores',
  },
} as const;

// Export types for type safety
export type Routes = typeof routes;
