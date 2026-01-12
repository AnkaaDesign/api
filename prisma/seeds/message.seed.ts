import { PrismaClient, SectorPrivileges } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

/**
 * Seed Script: Comprehensive Welcome Messages by Sector
 *
 * Creates detailed, personalized welcome messages for each sector
 * explaining their role at Ankaa Design and available system features
 */

// File storage configuration
// Development: ./uploads/files
// Production: /srv/files (served via https://arquivos.ankaa.live)
const FILES_ROOT = process.env.FILES_ROOT || './uploads/files';
const FILES_BASE_URL =
  process.env.NODE_ENV === 'production'
    ? 'https://arquivos.ankaa.live'
    : process.env.WEBDAV_BASE_URL || 'http://localhost:3030/uploads/files';

// Company logo URL - stored in Mensagens folder
const COMPANY_LOGO_URL = `${FILES_BASE_URL}/Mensagens/logo.png`;

/**
 * Ensures the logo file exists in the Mensagens storage folder.
 * Copies from source locations if not present.
 */
async function ensureLogoExists(): Promise<boolean> {
  const mensagensDir = path.join(FILES_ROOT, 'Mensagens');
  const logoDestPath = path.join(mensagensDir, 'logo.png');

  // Check if logo already exists
  if (fs.existsSync(logoDestPath)) {
    console.log('✓ Logo already exists at:', logoDestPath);
    return true;
  }

  // Create Mensagens directory if it doesn't exist
  if (!fs.existsSync(mensagensDir)) {
    fs.mkdirSync(mensagensDir, { recursive: true, mode: 0o755 });
    console.log('✓ Created Mensagens directory:', mensagensDir);
  }

  // Try to find the source logo from various locations
  const possibleSources = [
    // Relative to api root - web public folder (development)
    path.resolve(__dirname, '../../../web/public/logo.png'),
    // Relative to api root - web assets folder (development)
    path.resolve(__dirname, '../../../web/src/assets/logo.png'),
    // Inside api assets (if bundled for deployment)
    path.resolve(__dirname, '../../assets/logo.png'),
    // Production: web dist folder
    path.resolve(__dirname, '../../../web/dist/logo.png'),
    // Production: deployed web folder
    '/var/www/web/logo.png',
    '/var/www/html/logo.png',
    // Current working directory assets
    path.resolve(process.cwd(), 'assets/logo.png'),
    // Seed assets folder
    path.resolve(__dirname, './assets/logo.png'),
  ];

  for (const sourcePath of possibleSources) {
    if (fs.existsSync(sourcePath)) {
      try {
        fs.copyFileSync(sourcePath, logoDestPath);
        fs.chmodSync(logoDestPath, 0o644);
        console.log('✓ Logo copied from:', sourcePath);
        console.log('  To:', logoDestPath);
        return true;
      } catch (error) {
        console.warn('⚠️  Failed to copy logo from:', sourcePath, error);
      }
    }
  }

  console.warn('⚠️  Logo source not found. Tried:');
  possibleSources.forEach((p) => console.warn('   -', p));
  console.warn('   Messages will be created without logo image.');
  return false;
}

// Support WhatsApp link
const SUPPORT_WHATSAPP_URL =
  'https://wa.me/5543991402403?text=Olá%20Kennedy,%20preciso%20reportar%20um%20problema%20no%20sistema:%20';

// ======================
// Inline format type (matches frontend InlineFormat)
// ======================
type InlineFormat =
  | { type: 'text'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'link'; content: string; url: string };

// ======================
// Helper functions for creating inline content
// ======================
const text = (content: string): InlineFormat => ({ type: 'text', content });
const bold = (content: string): InlineFormat => ({ type: 'bold', content });
const italic = (content: string): InlineFormat => ({ type: 'italic', content });
const link = (content: string, url: string): InlineFormat => ({ type: 'link', content, url });

// ======================
// Block creation helpers
// ======================
const heading = (
  level: 1 | 2 | 3 | 4 | 5 | 6,
  content: InlineFormat[],
  options?: { fontSize?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl'; fontWeight?: 'normal' | 'medium' | 'semibold' | 'bold' },
) => ({
  type: 'heading' as const,
  level,
  content,
  ...(options?.fontSize && { fontSize: options.fontSize }),
  ...(options?.fontWeight && { fontWeight: options.fontWeight }),
});

const paragraph = (content: InlineFormat[], fontSize?: 'sm' | 'base' | 'lg') => ({
  type: 'paragraph' as const,
  content,
  ...(fontSize && { fontSize }),
});

const image = (
  url: string,
  alt: string,
  options?: { caption?: string; size?: string; alignment?: 'left' | 'center' | 'right' },
) => ({
  type: 'image' as const,
  url, // Backend expects 'url', frontend accepts both 'src' and 'url'
  alt,
  caption: options?.caption,
  size: options?.size || '128px',
  alignment: options?.alignment || 'center',
});

const button = (buttonText: string, url: string, variant: 'default' | 'secondary' | 'outline' = 'default') => ({
  type: 'button' as const,
  text: buttonText,
  url,
  variant,
});

const divider = () => ({ type: 'divider' as const });

const list = (ordered: boolean, items: (string | InlineFormat[])[]) => ({
  type: 'list' as const,
  ordered,
  items,
});

const quote = (content: InlineFormat[]) => ({
  type: 'quote' as const,
  content,
});

const spacer = (height: 'sm' | 'md' | 'lg' = 'sm') => ({
  type: 'spacer' as const,
  height,
});

// ======================
// Sector-specific detailed message configurations
// ======================
interface SectorMessageConfig {
  title: string;
  greeting: string;
  roleDescription: string;
  systemOverview: string;
  features: { category: string; items: string[] }[];
  workflows: string[];
  tips: string[];
}

const sectorConfigs: Record<SectorPrivileges, SectorMessageConfig> = {
  [SectorPrivileges.ADMIN]: {
    title: 'Painel Administrativo',
    greeting: 'Você possui acesso administrativo completo ao Sistema de Gestão Ankaa Design.',
    roleDescription:
      'Como administrador, você é o guardião do sistema. Sua responsabilidade inclui gerenciar usuários, configurar setores, monitorar a saúde do sistema e garantir que todos os colaboradores tenham os recursos necessários para trabalhar.',
    systemOverview:
      'O Sistema Ankaa Design é uma plataforma completa para gestão de personalização de caminhões, integrando produção, estoque, recursos humanos, financeiro e muito mais.',
    features: [
      {
        category: 'Gestão de Pessoas',
        items: [
          'Criar, editar e desativar usuários do sistema',
          'Atribuir colaboradores a setores específicos',
          'Definir gerentes de setor para delegação de responsabilidades',
          'Gerenciar permissões e níveis de acesso',
        ],
      },
      {
        category: 'Configuração do Sistema',
        items: [
          'Criar e configurar setores com privilégios específicos',
          'Enviar mensagens e comunicados para toda a empresa',
          'Configurar notificações por email, push, SMS e WhatsApp',
          'Gerenciar backups e restauração do sistema',
        ],
      },
      {
        category: 'Monitoramento e Auditoria',
        items: [
          'Visualizar registros de alterações (changelog) de todas as operações',
          'Monitorar saúde do sistema (CPU, memória, banco de dados)',
          'Acessar estatísticas de notificações e entregas',
          'Analisar tendências e métricas de uso',
        ],
      },
      {
        category: 'Gestão Comercial',
        items: [
          'Cadastrar e gerenciar clientes',
          'Cadastrar e gerenciar fornecedores',
          'Acompanhar todas as tarefas de produção',
          'Visualizar relatórios gerenciais completos',
        ],
      },
    ],
    workflows: [
      'Novos colaboradores: Criar usuário → Atribuir setor → Definir cargo → Configurar EPIs',
      'Comunicados: Criar mensagem → Selecionar público-alvo → Publicar',
      'Auditoria: Acessar Registros de Alterações → Filtrar por período/usuário → Analisar impacto',
    ],
    tips: [
      'Revise periodicamente os usuários inativos e desative contas não utilizadas',
      'Use o módulo de Registros de Alterações para investigar problemas',
      'Configure backups automáticos para garantir a segurança dos dados',
      'Mantenha os dados de contato dos colaboradores atualizados para notificações',
    ],
  },

  [SectorPrivileges.PRODUCTION]: {
    title: 'Setor de Produção',
    greeting: 'Você faz parte do coração da Ankaa Design - a equipe que transforma caminhões em verdadeiras obras de arte!',
    roleDescription:
      'O setor de Produção gerencia todo o ciclo de personalização dos caminhões, desde a entrada do veículo até a entrega final. Você controla o cronograma, coordena as ordens de serviço e garante a qualidade do trabalho.',
    systemOverview:
      'Aqui você acompanha cada caminhão em tempo real: sua posição no barracão, status de produção, recortes pendentes, aerografias e todas as etapas do processo criativo.',
    features: [
      {
        category: 'Cronograma de Produção',
        items: [
          'Visualizar e gerenciar todas as tarefas (caminhões) em produção',
          'Criar novas tarefas com dados do cliente e especificações',
          'Acompanhar status: Preparação → Aguardando Produção → Em Produção → Concluído',
          'Duplicar tarefas para criar cópias com modificações',
          'Gerar tarefas em lote a partir de números de série',
        ],
      },
      {
        category: 'Gestão de Barracões',
        items: [
          '3 barracões (B1, B2, B3) com 27 vagas cada (81 vagas totais)',
          'Cada barracão tem 3 faixas (F1, F2, F3) e 3 vagas por faixa',
          'Arrastar e soltar caminhões para reposicionar',
          'Verificação automática de espaço disponível por faixa',
          'Cálculo de comprimento do caminhão baseado nos layouts',
        ],
      },
      {
        category: 'Ordens de Serviço',
        items: [
          'Criar ordens de serviço vinculadas às tarefas',
          'Tipos: Produção, Financeiro, Negociação, Arte',
          'Workflow: Pendente → Em Andamento → Aguardando Aprovação → Concluído',
          'Atribuir responsáveis para cada ordem',
        ],
      },
      {
        category: 'Aerografias',
        items: [
          'Registrar trabalhos de aerografia por tarefa',
          'Upload de arquivos de arte, orçamentos e notas fiscais',
          'Acompanhar status: Pendente → Em Produção → Concluído',
          'Histórico completo de aerografias realizadas',
        ],
      },
      {
        category: 'Recortes (Plotter)',
        items: [
          'Solicitar recortes de vinil (adesivo) ou estêncil (máscara)',
          'Upload de arquivos vetoriais (SVG, DXF, AI, PDF, CDR, EPS)',
          'Acompanhar status: Pendente → Cortando → Concluído',
          'Solicitar recortes de reposição (aplicação errada, perdido, etc.)',
        ],
      },
      {
        category: 'Layouts de Caminhões',
        items: [
          'Criar layouts técnicos (lateral esquerda, direita, traseira)',
          'Definir seções com larguras e portas',
          'Gerar desenhos técnicos SVG automaticamente',
          'Armazenar fotos de referência da traseira',
        ],
      },
    ],
    workflows: [
      'Entrada: Criar tarefa → Posicionar no barracão → Criar layout → Solicitar recortes',
      'Produção: Atualizar status → Registrar aerografias → Criar ordens de serviço',
      'Recortes: Criar solicitação → Aguardar corte → Receber material → Aplicar',
      'Finalização: Marcar tarefa como concluída → Liberar vaga no barracão',
    ],
    tips: [
      'Mantenha o status das tarefas sempre atualizado para visibilidade da equipe',
      'Use observações para registrar detalhes importantes de cada caminhão',
      'Comunique-se com o Almoxarifado sobre materiais necessários com antecedência',
      'Verifique a disponibilidade de vagas antes de agendar novos caminhões',
    ],
  },

  [SectorPrivileges.WAREHOUSE]: {
    title: 'Almoxarifado',
    greeting: 'Você é o responsável por manter nosso estoque organizado e a produção sempre abastecida!',
    roleDescription:
      'O Almoxarifado é fundamental para o funcionamento da Ankaa Design. Você controla todos os materiais, ferramentas, EPIs e coordena com fornecedores para garantir que nunca falte nada.',
    systemOverview:
      'O sistema oferece controle completo de estoque com análise de consumo, pedidos automáticos, gestão de fornecedores, empréstimos de ferramentas e entrega de EPIs.',
    features: [
      {
        category: 'Controle de Estoque',
        items: [
          'Cadastrar itens com código, categoria, marca e medidas',
          'Definir ponto de reposição (mínimo) e quantidade máxima',
          'Acompanhar consumo mensal com média ponderada',
          'Lead time calculado automaticamente baseado no histórico',
          'Sugestões automáticas de reabastecimento',
        ],
      },
      {
        category: 'Movimentações',
        items: [
          'Registrar entradas: recebimento de pedidos, devoluções',
          'Registrar saídas: uso em produção, perdas, ajustes',
          'Motivos rastreados: PEDIDO_RECEBIDO, USO_PRODUCAO, PERDA, etc.',
          'Histórico completo de todas as movimentações',
          'Auto-matching com pedidos pendentes ao receber',
        ],
      },
      {
        category: 'Pedidos de Compra',
        items: [
          'Criar pedidos para fornecedores com múltiplos itens',
          'Status: Criado → Enviado → Recebido Parcial → Recebido',
          'Anexar orçamentos, notas fiscais e comprovantes',
          'Rastrear preços com ICMS e IPI',
          'Agendamento automático de pedidos recorrentes',
        ],
      },
      {
        category: 'Fornecedores',
        items: [
          'Cadastro completo: CNPJ, contatos, endereço, PIX',
          'Upload de logo e documentos',
          'Histórico de pedidos por fornecedor',
          'Validação automática de CNPJ',
        ],
      },
      {
        category: 'Manutenção',
        items: [
          'Agendar manutenções preventivas de equipamentos',
          'Registrar manutenções realizadas com tempo gasto',
          'Frequências: diária, semanal, mensal, trimestral, anual',
          'Rastrear peças/itens consumidos em cada manutenção',
          'Alertas automáticos de manutenções atrasadas',
        ],
      },
      {
        category: 'Retiradas Externas',
        items: [
          'Tipos: Retornável, Cobrável, Cortesia',
          'Registrar retiradas por pessoas externas',
          'Acompanhar devoluções e cobranças',
          'Anexar notas fiscais e comprovantes',
        ],
      },
      {
        category: 'EPIs (Equipamentos de Proteção)',
        items: [
          'Entregar EPIs aos colaboradores: camisas, calças, botas, luvas, máscaras',
          'Validar tamanhos cadastrados do colaborador',
          'Workflow: Solicitado → Aprovado → Entregue',
          'Agendamento de entregas periódicas',
          'Relatório de entregas por colaborador',
        ],
      },
      {
        category: 'Empréstimos de Ferramentas',
        items: [
          'Registrar empréstimos de ferramentas para colaboradores',
          'Controlar devoluções e itens perdidos',
          'Limite de 10 empréstimos simultâneos por pessoa',
          'Avisos de estoque baixo antes de emprestar',
        ],
      },
    ],
    workflows: [
      'Reposição: Item abaixo do mínimo → Criar pedido → Enviar → Receber → Dar entrada',
      'EPI: Colaborador solicita → Aprovar → Separar → Entregar → Registrar',
      'Manutenção: Agendar → Executar → Registrar peças usadas → Agendar próxima',
      'Empréstimo: Registrar saída → Colaborador usa → Devolver ou marcar como perdido',
    ],
    tips: [
      'Configure alertas de estoque mínimo para itens críticos',
      'Mantenha o cadastro de fornecedores atualizado com contatos',
      'Registre todas as movimentações para rastreabilidade',
      'Revise periodicamente os lead times para melhorar previsões',
    ],
  },

  [SectorPrivileges.PLOTTING]: {
    title: 'Setor de Recorte',
    greeting: 'Você é essencial para dar vida aos designs - cada recorte seu vai transformar um caminhão!',
    roleDescription:
      'O setor de Recorte (Plotter) é responsável por cortar vinis e estênceis que serão aplicados nos caminhões. Precisão e qualidade são fundamentais no seu trabalho.',
    systemOverview:
      'Você recebe solicitações de recorte da produção, executa os cortes na plotter e entrega os materiais prontos para aplicação.',
    features: [
      {
        category: 'Solicitações de Recorte',
        items: [
          'Visualizar todas as solicitações pendentes',
          'Filtrar por tipo: Vinil (Adesivo) ou Estêncil (Máscara de Pintura)',
          'Ver arquivos vetoriais anexados (SVG, DXF, AI, PDF, CDR, EPS)',
          'Identificar recortes de reposição e motivo (aplicação errada, perdido, erro)',
        ],
      },
      {
        category: 'Execução de Cortes',
        items: [
          'Marcar corte como "Cortando" ao iniciar',
          'Registrar tempo de início automático',
          'Marcar como "Concluído" ao finalizar',
          'Tempo de execução calculado automaticamente',
        ],
      },
      {
        category: 'Organização',
        items: [
          'Arquivos organizados por cliente e tipo de corte',
          'Pasta: Plotter/{Cliente}/Adesivo ou Espovo',
          'Histórico completo de cortes realizados',
          'Relacionamento pai-filho para recuts/revisões',
        ],
      },
    ],
    workflows: [
      'Receber: Verificar solicitações pendentes → Baixar arquivo → Preparar material',
      'Cortar: Marcar como "Cortando" → Executar na plotter → Conferir qualidade',
      'Entregar: Marcar como "Concluído" → Notificar produção → Entregar material',
    ],
    tips: [
      'Verifique as especificações de cada solicitação antes de iniciar',
      'Comunique-se com a Produção sobre prazos e prioridades',
      'Mantenha os equipamentos de corte calibrados e limpos',
      'Registre recuts para identificar padrões de problemas',
    ],
  },

  [SectorPrivileges.MAINTENANCE]: {
    title: 'Setor de Manutenção',
    greeting: 'Você mantém nossa estrutura e equipamentos funcionando perfeitamente!',
    roleDescription:
      'O setor de Manutenção é responsável pela conservação de equipamentos e instalações, garantindo que a produção nunca pare por problemas técnicos.',
    systemOverview:
      'O sistema permite agendar manutenções preventivas, registrar manutenções corretivas e acompanhar o histórico de cada equipamento.',
    features: [
      {
        category: 'Manutenções Programadas',
        items: [
          'Agendar manutenções preventivas com frequência definida',
          'Frequências: diária, semanal, quinzenal, mensal, trimestral, semestral, anual',
          'Geração automática da próxima manutenção ao concluir',
          'Alertas de manutenções atrasadas (status OVERDUE)',
        ],
      },
      {
        category: 'Execução de Manutenções',
        items: [
          'Status: Pendente → Em Andamento → Concluído (ou Cancelado)',
          'Registro automático de tempo de início e término',
          'Cálculo do tempo gasto em cada manutenção',
          'Vincular peças/itens consumidos do estoque',
        ],
      },
      {
        category: 'Histórico e Rastreamento',
        items: [
          'Histórico completo de manutenções por equipamento',
          'Registro de todas as alterações com usuário e data',
          'Análise de frequência de problemas',
          'Custo de manutenção por equipamento',
        ],
      },
    ],
    workflows: [
      'Preventiva: Sistema agenda → Receber alerta → Executar → Registrar peças → Concluir',
      'Corretiva: Identificar problema → Criar manutenção → Executar → Documentar solução',
      'Análise: Consultar histórico → Identificar padrões → Ajustar frequências',
    ],
    tips: [
      'Siga o cronograma de manutenções preventivas rigorosamente',
      'Registre todos os problemas encontrados, mesmo os menores',
      'Comunique urgências à administração imediatamente',
      'Mantenha um estoque mínimo de peças de reposição críticas',
    ],
  },

  [SectorPrivileges.HUMAN_RESOURCES]: {
    title: 'Recursos Humanos',
    greeting: 'Você cuida do nosso bem mais valioso: as pessoas que fazem a Ankaa acontecer!',
    roleDescription:
      'O RH é responsável por toda a gestão de pessoas, desde a admissão até o desenvolvimento dos colaboradores, incluindo férias, advertências e tamanhos de EPIs.',
    systemOverview:
      'O sistema integra gestão de colaboradores, controle de férias, registro de advertências, tamanhos de uniformes e interface com a folha de pagamento.',
    features: [
      {
        category: 'Gestão de Colaboradores',
        items: [
          'Cadastro completo de colaboradores com dados pessoais',
          'Atribuição a setores e cargos',
          'Controle de status: Ativo, Experiência 1, Experiência 2, Efetivado, Desligado',
          'Upload de foto de perfil (avatar)',
          'Integração com Secullum para ponto eletrônico',
        ],
      },
      {
        category: 'Cargos e Remuneração',
        items: [
          'Criar cargos com salário base',
          'Histórico de alterações salariais',
          'Definir elegibilidade para comissão e bônus',
          'Máximo de dias de férias por cargo',
        ],
      },
      {
        category: 'Controle de Férias',
        items: [
          'Solicitação e aprovação de férias',
          'Status: Pendente → Aprovado → Em Andamento → Concluído',
          'Validação de sobreposição de datas',
          'Registro de quem aprovou/rejeitou',
          'Observações para cada solicitação',
        ],
      },
      {
        category: 'Feriados',
        items: [
          'Visualizar feriados da empresa',
          'Integração com calendário Secullum',
          'Feriados nacionais, estaduais e municipais',
        ],
      },
      {
        category: 'Advertências',
        items: [
          'Registrar advertências com severidade: Leve, Moderada, Grave',
          'Categorias: Conduta, Desempenho, Assiduidade, Segurança, Outros',
          'Incluir testemunhas e anexos',
          'Histórico completo por colaborador',
        ],
      },
      {
        category: 'Tamanhos de EPIs',
        items: [
          'Cadastrar tamanhos por colaborador',
          'Camisas, calças, botas, luvas, máscaras, mangas, galochas',
          'Validação automática ao entregar EPIs',
          'Evita entregas de tamanhos incorretos',
        ],
      },
    ],
    workflows: [
      'Admissão: Cadastrar → Atribuir setor/cargo → Definir tamanhos EPI → Solicitar EPIs',
      'Férias: Colaborador solicita → RH analisa → Aprovar/Rejeitar → Acompanhar',
      'Advertência: Identificar ocorrência → Registrar → Colher testemunhos → Arquivar',
    ],
    tips: [
      'Mantenha os dados dos colaboradores sempre atualizados',
      'Acompanhe vencimentos de férias para evitar acúmulos',
      'Registre todas as ocorrências para manter histórico',
      'Valide tamanhos de EPI antes de fazer pedidos',
    ],
  },

  [SectorPrivileges.FINANCIAL]: {
    title: 'Setor Financeiro',
    greeting: 'Você é responsável pela saúde financeira da Ankaa Design!',
    roleDescription:
      'O setor Financeiro controla a folha de pagamento, cálculos trabalhistas, comissões e bonificações, garantindo que todos recebam corretamente.',
    systemOverview:
      'Sistema completo de folha de pagamento com cálculos automáticos de INSS, IRRF, FGTS, DSR, descontos e bônus, seguindo a legislação brasileira.',
    features: [
      {
        category: 'Folha de Pagamento',
        items: [
          'Gerar folha mensal para todos os colaboradores ativos',
          'Cálculo automático de proventos: salário base, horas extras 50%/100%, adicional noturno, DSR',
          'Cálculo de bônus baseado em tarefas do período',
          'Visualização em tempo real (folha "live") do mês atual',
        ],
      },
      {
        category: 'Descontos Automáticos',
        items: [
          'INSS progressivo com faixas atualizadas (7,5% a 14%)',
          'IRRF progressivo com deduções por dependentes',
          'FGTS (8% sobre salário bruto)',
          'Contribuição sindical (opcional desde 2017)',
          'Faltas e atrasos com perda de DSR proporcional',
        ],
      },
      {
        category: 'Descontos Manuais',
        items: [
          'Empréstimos consignados',
          'Plano de saúde',
          'Vale alimentação',
          'Vale transporte',
          'Descontos personalizados',
          'Descontos persistentes (copiam para o próximo mês)',
        ],
      },
      {
        category: 'Sistema de Bônus',
        items: [
          'Cálculo baseado em tarefas concluídas no período (26 do mês anterior a 25 do atual)',
          'Peso por status de comissão: Total (1.0), Parcial (0.5), Suspensa (0.0)',
          'Fórmula por cargo e nível de desempenho',
          'Desconto automático para tarefas suspensas',
          'Todos os colaboradores elegíveis compartilham o mesmo pool de tarefas',
        ],
      },
      {
        category: 'Relatórios',
        items: [
          'Detalhamento completo de cada folha',
          'Comparativo entre períodos',
          'Resumo de impostos e contribuições',
          'Exportação de dados',
        ],
      },
    ],
    workflows: [
      'Folha mensal: Gerar folha → Revisar cálculos → Adicionar descontos manuais → Finalizar',
      'Bônus: Sistema calcula automaticamente → Revisar → Incluir na folha',
      'Desconto persistente: Cadastrar → Aplicar na folha atual → Copiar para próximos meses',
    ],
    tips: [
      'Confira os cálculos antes de finalizar a folha',
      'Mantenha as tabelas de INSS e IRRF atualizadas',
      'Revise descontos persistentes periodicamente',
      'Use a visualização "live" para prever a folha do mês atual',
    ],
  },

  [SectorPrivileges.COMMERCIAL]: {
    title: 'Setor Comercial',
    greeting: 'Você é a ponte entre nossos clientes e a arte que criamos!',
    roleDescription:
      'O setor Comercial gerencia o relacionamento com clientes, acompanha as tarefas em andamento e cuida da parte comercial dos projetos.',
    systemOverview:
      'Acesso a clientes, acompanhamento de tarefas do ponto de vista comercial, gestão de orçamentos e histórico de relacionamento.',
    features: [
      {
        category: 'Gestão de Clientes',
        items: [
          'Cadastro completo: nome fantasia, razão social, CNPJ/CPF',
          'Múltiplos telefones e emails',
          'Endereço completo',
          'Tags para categorização',
          'Atividade econômica',
          'Upload de logo',
          'Mesclar clientes duplicados',
        ],
      },
      {
        category: 'Acompanhamento de Tarefas',
        items: [
          'Visualizar todas as tarefas dos seus clientes',
          'Acompanhar status de produção',
          'Ver previsão de entrega',
          'Histórico de tarefas por cliente',
        ],
      },
      {
        category: 'Orçamentos (Task Pricing)',
        items: [
          'Criar orçamentos vinculados às tarefas',
          'Múltiplos itens por orçamento',
          'Status: Rascunho, Ativo, Expirado, Aceito, Rejeitado',
          'Data de validade',
        ],
      },
      {
        category: 'Comunicação',
        items: [
          'Registrar contatos de negociação nas tarefas',
          'Observações por tarefa',
          'Histórico de interações',
        ],
      },
    ],
    workflows: [
      'Novo cliente: Cadastrar → Criar tarefa → Enviar orçamento → Acompanhar aprovação',
      'Acompanhamento: Verificar status → Atualizar cliente → Registrar observações',
      'Entrega: Confirmar conclusão → Atualizar cliente → Coletar feedback',
    ],
    tips: [
      'Mantenha o cadastro de clientes completo e atualizado',
      'Acompanhe o status das tarefas para informar clientes proativamente',
      'Registre todos os contatos e negociações para histórico',
      'Use tags para segmentar clientes',
    ],
  },

  [SectorPrivileges.LOGISTIC]: {
    title: 'Setor de Logística',
    greeting: 'Você garante que tudo chegue no lugar certo, na hora certa!',
    roleDescription:
      'O setor de Logística coordena o fluxo de materiais entre fornecedores e a empresa, garantindo que a produção nunca pare por falta de suprimentos.',
    systemOverview:
      'Gestão de pedidos de compra, agendamento de entregas, coordenação com fornecedores e acompanhamento de recebimentos.',
    features: [
      {
        category: 'Pedidos de Compra',
        items: [
          'Criar pedidos para fornecedores',
          'Múltiplos itens por pedido com quantidades e preços',
          'Status: Criado → Confirmado → Enviado → Recebido',
          'Previsão de entrega',
          'Condições de pagamento (prazo, PIX)',
        ],
      },
      {
        category: 'Agendamento de Entregas',
        items: [
          'Criar agendamentos recorrentes',
          'Frequências: única, diária, semanal, mensal, anual, personalizada',
          'Dia da semana ou dia do mês específico',
          'Geração automática do próximo agendamento',
          'Ativar/desativar agendamentos',
        ],
      },
      {
        category: 'Fornecedores',
        items: [
          'Consultar cadastro de fornecedores',
          'Ver histórico de pedidos',
          'Dados de contato e pagamento',
        ],
      },
      {
        category: 'Documentos',
        items: [
          'Anexar orçamentos aos pedidos',
          'Registrar notas fiscais recebidas',
          'Guardar comprovantes de pagamento',
          'Documentos de reembolso',
        ],
      },
    ],
    workflows: [
      'Pedido: Identificar necessidade → Criar pedido → Enviar ao fornecedor → Acompanhar',
      'Recebimento: Conferir mercadoria → Anexar NF → Dar entrada no estoque',
      'Agendamento: Configurar frequência → Sistema cria pedidos automaticamente',
    ],
    tips: [
      'Acompanhe os prazos de entrega dos fornecedores',
      'Comunique atrasos à produção imediatamente',
      'Mantenha bom relacionamento com fornecedores',
      'Use agendamentos para pedidos recorrentes',
    ],
  },

  [SectorPrivileges.DESIGNER]: {
    title: 'Setor de Design',
    greeting: 'Você transforma ideias em arte sobre rodas!',
    roleDescription:
      'O setor de Design é responsável pela criação de layouts, gestão do catálogo de tintas e desenvolvimento de fórmulas de cores personalizadas.',
    systemOverview:
      'Sistema completo para gestão de tintas, fórmulas de cores e produção de misturas, além de layouts técnicos dos caminhões.',
    features: [
      {
        category: 'Catálogo de Tintas',
        items: [
          'Cadastrar tintas com nome, código hex, acabamento',
          'Organizar por tipo, marca e fabricante',
          'Preview de cor (WebP)',
          'Tags para categorização',
          'Relacionar tintas similares',
        ],
      },
      {
        category: 'Fórmulas de Cores',
        items: [
          'Criar fórmulas de mistura de tintas',
          'Componentes com proporções (0-100%)',
          'Cálculo automático de densidade',
          'Cálculo automático de custo por litro',
          'Atualização automática quando preços mudam',
        ],
      },
      {
        category: 'Produção de Tintas',
        items: [
          'Registrar produções de misturas',
          'Informar volume desejado em litros',
          'Cálculo automático de pesos por componente',
          'Verificar disponibilidade no estoque',
          'Custo total da produção',
        ],
      },
      {
        category: 'Layouts de Caminhões',
        items: [
          'Criar layouts técnicos (lateral esquerda, direita, traseira)',
          'Definir seções com larguras em metros',
          'Marcar portas e suas alturas',
          'Gerar desenho SVG técnico automaticamente',
          'Armazenar fotos de referência',
        ],
      },
    ],
    workflows: [
      'Nova cor: Cadastrar tinta → Criar fórmula → Testar → Produzir em escala',
      'Produção: Selecionar fórmula → Informar volume → Conferir estoque → Produzir',
      'Layout: Medir caminhão → Criar seções → Gerar SVG → Anexar foto da traseira',
    ],
    tips: [
      'Mantenha o catálogo de cores atualizado',
      'Documente as fórmulas de cores especiais',
      'Comunique-se com a produção sobre especificações técnicas',
      'Valide o estoque antes de planejar produções grandes',
    ],
  },

  [SectorPrivileges.EXTERNAL]: {
    title: 'Acesso Externo',
    greeting: 'Bem-vindo ao Sistema Ankaa Design!',
    roleDescription:
      'Como usuário externo, você possui acesso limitado ao sistema, focado nas informações relevantes para sua atuação junto à Ankaa Design.',
    systemOverview:
      'Você pode visualizar informações específicas autorizadas pelo administrador e comunicar-se com os setores internos.',
    features: [
      {
        category: 'Acesso Disponível',
        items: [
          'Visualização de informações autorizadas',
          'Funcionalidades específicas do seu perfil',
          'Notificações relevantes para você',
        ],
      },
    ],
    workflows: ['Consultar informações disponíveis → Comunicar-se com setores → Aguardar retorno'],
    tips: [
      'Entre em contato com a administração se precisar de mais acessos',
      'Reporte qualquer problema encontrado no sistema',
    ],
  },

  [SectorPrivileges.BASIC]: {
    title: 'Sistema Ankaa Design',
    greeting: 'Você faz parte da equipe Ankaa Design!',
    roleDescription:
      'Este é o sistema de gestão interno da Ankaa Design. Com acesso básico, você pode consultar suas informações pessoais e acompanhar dados relevantes.',
    systemOverview:
      'Acesse suas notificações, informações pessoais, férias, EPIs e dados financeiros como comissões e bônus.',
    features: [
      {
        category: 'Minhas Informações',
        items: [
          'Visualizar seu perfil e dados cadastrais',
          'Acompanhar suas notificações',
          'Ver feriados da empresa',
          'Consultar seu calendário',
        ],
      },
      {
        category: 'Meus EPIs',
        items: [
          'Solicitar equipamentos de proteção',
          'Acompanhar entregas pendentes',
          'Histórico de EPIs recebidos',
        ],
      },
      {
        category: 'Minhas Férias',
        items: [
          'Solicitar férias',
          'Acompanhar status da solicitação',
          'Ver férias aprovadas',
        ],
      },
      {
        category: 'Meu Financeiro',
        items: [
          'Consultar suas comissões',
          'Ver bônus do período',
          'Acompanhar empréstimos registrados',
        ],
      },
    ],
    workflows: [
      'EPI: Solicitar → Aguardar aprovação → Receber',
      'Férias: Solicitar → Aguardar RH → Confirmar',
    ],
    tips: [
      'Mantenha seus dados pessoais atualizados',
      'Verifique suas notificações regularmente',
      'Entre em contato com seu gestor para dúvidas sobre acesso',
    ],
  },
};

/**
 * Creates a complete message content structure for a sector
 */
function createMessageContent(privilege: SectorPrivileges) {
  const config = sectorConfigs[privilege];

  const blocks: any[] = [];

  // Logo from Mensagens folder (file storage)
  blocks.push(
    image(COMPANY_LOGO_URL, 'Ankaa Design', {
      size: '128px',
      alignment: 'left',
    }),
  );
  blocks.push(spacer('sm'));

  // Main title - using level 3 with 'xl' fontSize for smaller appearance
  blocks.push(heading(3, [text(`Bem-vindo ao ${config.title}`)], { fontSize: 'xl', fontWeight: 'semibold' }));

  // Greeting
  blocks.push(paragraph([bold(config.greeting)]));

  // Role description
  blocks.push(paragraph([text(config.roleDescription)]));

  // System overview
  blocks.push(paragraph([italic(config.systemOverview)], 'sm'));

  blocks.push(divider());

  // Features by category - using level 4 with 'lg' fontSize
  blocks.push(heading(4, [text('Funcionalidades Disponíveis')], { fontSize: 'lg', fontWeight: 'semibold' }));

  for (const featureGroup of config.features) {
    blocks.push(paragraph([bold(featureGroup.category + ':')], 'sm'));
    blocks.push(list(false, featureGroup.items));
  }

  blocks.push(divider());

  // Workflows
  if (config.workflows.length > 0) {
    blocks.push(heading(4, [text('Fluxos de Trabalho')], { fontSize: 'lg', fontWeight: 'semibold' }));
    blocks.push(list(true, config.workflows));
    blocks.push(divider());
  }

  // Tips
  blocks.push(heading(4, [text('Dicas Importantes')], { fontSize: 'lg', fontWeight: 'semibold' }));
  blocks.push(list(false, config.tips));

  blocks.push(divider());

  // Support section
  blocks.push(heading(4, [text('Suporte Técnico')], { fontSize: 'lg', fontWeight: 'semibold' }));

  blocks.push(
    quote([
      bold('Sistema em implementação: '),
      text(
        'O sistema pode apresentar instabilidades durante esta fase. Sua colaboração reportando problemas é fundamental para melhorarmos juntos!',
      ),
    ]),
  );

  // Error reporting as a proper list
  blocks.push(paragraph([text('Ao encontrar um erro, informe:')], 'sm'));
  blocks.push(
    list(true, ['O que você estava fazendo', 'O que aconteceu', 'O que você esperava']),
  );
  blocks.push(paragraph([italic('Se possível, envie também uma captura de tela.')], 'sm'));

  blocks.push(spacer('sm'));

  blocks.push(button('Falar com Kennedy Campos (Suporte)', SUPPORT_WHATSAPP_URL, 'default'));

  blocks.push(divider());

  // Closing
  blocks.push(
    paragraph([text('Obrigado por fazer parte da equipe '), bold('Ankaa Design'), text('! Bom trabalho!')]),
  );

  return {
    blocks,
    version: '1.0',
  };
}

async function main() {
  console.log('🌱 Seeding comprehensive welcome messages by sector...\n');

  try {
    // Find an admin user
    const adminUser = await prisma.user.findFirst({
      where: {
        status: { not: 'DISMISSED' },
        sector: {
          privileges: 'ADMIN',
        },
      },
      select: { id: true, name: true },
    });

    if (!adminUser) {
      console.log('⚠️  No admin user found. Skipping message seed.');
      console.log('💡 Create a user in an ADMIN sector first, then run this seed again.');
      return;
    }

    console.log(`✓ Found admin user: ${adminUser.name}\n`);

    // Ensure logo file exists in storage
    const logoExists = await ensureLogoExists();
    if (!logoExists) {
      console.log('⚠️  Continuing without logo image...\n');
    }

    // Delete existing welcome messages (to allow re-seeding)
    const deletedMessages = await prisma.message.deleteMany({
      where: {
        title: {
          startsWith: 'Bem-vindo',
        },
      },
    });

    if (deletedMessages.count > 0) {
      console.log(`🗑️  Deleted ${deletedMessages.count} existing welcome message(s)\n`);
    }

    // Get all sectors with their privileges
    const sectors = await prisma.sector.findMany({
      select: {
        id: true,
        name: true,
        privileges: true,
      },
    });

    console.log(`📊 Found ${sectors.length} sectors\n`);

    // Group sectors by privilege
    const sectorsByPrivilege = new Map<SectorPrivileges, { id: string; name: string }[]>();
    for (const sector of sectors) {
      const existing = sectorsByPrivilege.get(sector.privileges) || [];
      existing.push({ id: sector.id, name: sector.name });
      sectorsByPrivilege.set(sector.privileges, existing);
    }

    // Create messages for each privilege type that has sectors
    let createdCount = 0;
    for (const [privilege, privilegeSectors] of sectorsByPrivilege) {
      const config = sectorConfigs[privilege];

      // Get all users in sectors with this privilege
      const users = await prisma.user.findMany({
        where: {
          status: { not: 'DISMISSED' },
          sectorId: {
            in: privilegeSectors.map(s => s.id),
          },
        },
        select: { id: true },
      });

      if (users.length === 0) {
        console.log(`⏭️  Skipping ${privilege} - no active users`);
        continue;
      }

      // Create the message
      const message = await prisma.message.create({
        data: {
          title: `Bem-vindo ao ${config.title}`,
          content: createMessageContent(privilege),
          status: 'ACTIVE',
          publishedAt: new Date(),
          createdById: adminUser.id,
          isDismissible: true,
          requiresView: false,
          targets: {
            create: users.map(user => ({
              userId: user.id,
            })),
          },
        },
      });

      const sectorNames = privilegeSectors.map(s => s.name).join(', ');
      console.log(`✅ Created message for ${privilege}`);
      console.log(`   Title: ${config.title}`);
      console.log(`   Sectors: ${sectorNames}`);
      console.log(`   Target users: ${users.length}`);
      console.log(`   Message ID: ${message.id}\n`);

      createdCount++;
    }

    console.log('━'.repeat(60));
    console.log(`\n🎉 Successfully created ${createdCount} comprehensive welcome messages!`);
    console.log('\n📝 Each message includes:');
    console.log('   ✓ Company logo');
    console.log('   ✓ Personalized greeting for the sector');
    console.log('   ✓ Detailed role description');
    console.log('   ✓ Complete feature list by category');
    console.log('   ✓ Workflow guides');
    console.log('   ✓ Practical tips');
    console.log('   ✓ Support contact with WhatsApp button');
    console.log('   ✓ System instability notice\n');
  } catch (error) {
    console.error('❌ Error seeding welcome messages:', error);
    throw error;
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
