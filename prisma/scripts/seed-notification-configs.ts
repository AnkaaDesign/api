/**
 * =============================================================================
 * NOTIFICATION CONFIGURATION SEED (in-repo registry) — May 2026
 * =============================================================================
 *
 * PURPOSE
 *   There is no code-level config registry for notifications: every
 *   NotificationConfiguration / NotificationChannelConfig / NotificationTargetRule
 *   row was historically hand-seeded via prisma/manual/*.sql (one ad-hoc SQL
 *   file per change). That is error-prone and non-idempotent.
 *
 *   This file IS the authoritative registry for the configs it owns. Running it
 *   upserts each config (by key) together with its target rule and channel
 *   configs, so the DB converges to what is declared here — and re-running it is
 *   safe in production.
 *
 * TWO LISTS
 *   1) CONFIGS — the OWNED set. Each entry is a full ConfigDef and is UPSERTED
 *      by key: created if missing, otherwise converged to the declaration
 *      (name/type/templates/sectors/channels), so this file is the source of
 *      truth for these configs. `enabled` is the only field never re-written on
 *      update (see SAFETY GUARANTEES).
 *   2) EXISTING_KEYS_CREATE_ONLY — keys that already exist in production (often
 *      hand-seeded with admin-tuned copy/sectors/channels). These are
 *      CREATE-ONLY-IF-MISSING: if a row with the key already exists it is
 *      SKIPPED entirely (logged 'skip (exists)') and NEVER updated; if missing
 *      (fresh environment) it is created with a generic pt-BR template so the
 *      base set is complete. This guarantees production rows are never
 *      overwritten while fresh DBs still get the full set.
 *
 * HOW TO RUN
 *   1) Always dry-run first to see the per-key created/updated/unchanged diff:
 *        npm run seed:notifications -- --dry-run
 *   2) Then for real:
 *        npm run seed:notifications
 *   Optional: limit to specific keys (comma separated):
 *        npm run seed:notifications -- --only=message.published,secullum.sync.failed
 *        npm run seed:notifications -- --dry-run --only=questionnaire.assigned
 *
 * SAFETY GUARANTEES
 *   - IDEMPOTENT: upsert-by-key, one transaction per config. Re-running never
 *     duplicates rows.
 *   - NEVER flips `enabled`: the `enabled` flag is written ONLY on CREATE (set
 *     true). On UPDATE it is left untouched, so a config an admin intentionally
 *     disabled in prod stays disabled across re-runs.
 *   - NEVER overwrites EXISTING_KEYS_CREATE_ONLY rows: those keys are only ever
 *     created if entirely missing; an existing row (and its admin-tuned copy,
 *     sectors and channels) is skipped untouched.
 *   - NEVER touches UserNotificationPreference (user opt-in/opt-out toggles are
 *     not in scope and are never read or written here).
 *   - Channel configs follow the canonical pattern (see CHANNEL_PRESET) and are
 *     upserted by the composite (configurationId, channel); the target rule is
 *     upserted 1:1 by configurationId.
 *   - --dry-run performs NO writes; it only reports what would change.
 *
 * NOTE ON LEGACY CONFIGS
 *   This script does NOT delete or disable the legacy task.field.truck.*SideLayoutId
 *   configs. They are superseded at the code level by the consolidated
 *   task.field.truck.layout config (declared below) and simply go dormant; their
 *   DB rows are intentionally left untouched here.
 *
 * =============================================================================
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Types for the registry
// ─────────────────────────────────────────────────────────────────────────────

type NotificationType = 'SYSTEM' | 'PRODUCTION' | 'STOCK' | 'USER' | 'GENERAL';
type Importance = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
type Channel = 'IN_APP' | 'PUSH' | 'EMAIL' | 'WHATSAPP';
type Sector =
  | 'BASIC'
  | 'PRODUCTION'
  | 'MAINTENANCE'
  | 'WAREHOUSE'
  | 'PLOTTING'
  | 'ADMIN'
  | 'HUMAN_RESOURCES'
  | 'EXTERNAL'
  | 'DESIGNER'
  | 'FINANCIAL'
  | 'LOGISTIC'
  | 'COMMERCIAL'
  | 'PRODUCTION_MANAGER';

interface ChannelTemplate {
  inApp?: { title: string; body: string };
  push?: { title: string; body: string };
  email?: { subject: string; body: string };
  whatsapp?: { body: string };
}

interface ConfigDef {
  key: string;
  name: string;
  notificationType: NotificationType;
  /** Always equal to `key`. */
  eventType: string;
  description: string;
  importance: Importance;
  workHoursOnly: boolean;
  batchingEnabled: boolean;
  /** Channels to materialize as NotificationChannelConfig rows. */
  channels: Channel[];
  /** Sectors used as target rule (fallback audience even for targeted configs). */
  sectors: Sector[];
  /** Documentation only: where the emit lives. Stored in metadata. */
  trigger: string;
  /** Documentation only: whether the emit explicitly targets a user. */
  targeted: boolean;
  templates: ChannelTemplate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical channel pattern (mirrors prisma/manual/*.sql):
//   IN_APP   → enabled, mandatory,        defaultOn:true
//   PUSH     → enabled, NOT mandatory,    defaultOn:true
//   EMAIL    → enabled, NOT mandatory,    defaultOn:false
//   WHATSAPP → enabled, NOT mandatory,    defaultOn:false  (only if listed)
// ─────────────────────────────────────────────────────────────────────────────

interface ChannelFlags {
  enabled: boolean;
  mandatory: boolean;
  defaultOn: boolean;
}

const CHANNEL_PRESET: Record<Channel, ChannelFlags> = {
  IN_APP: { enabled: true, mandatory: true, defaultOn: true },
  PUSH: { enabled: true, mandatory: false, defaultOn: true },
  EMAIL: { enabled: true, mandatory: false, defaultOn: false },
  WHATSAPP: { enabled: true, mandatory: false, defaultOn: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// THE REGISTRY — one entry per config. eventType === key. Handlebars {{var}}
// placeholders are authored to match the data the emit code passes.
// ─────────────────────────────────────────────────────────────────────────────

const CONFIGS: ConfigDef[] = [
  // ─── Secullum: requests ───────────────────────────────────────────────────
  {
    key: 'secullum.request.justifyAbsence.created',
    name: 'Justificativa de Ausência Solicitada',
    notificationType: 'USER',
    eventType: 'secullum.request.justifyAbsence.created',
    description:
      'Funcionário criou solicitação de justificativa de ausência; avisa RH/aprovadores',
    importance: 'HIGH',
    workHoursOnly: true,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    sectors: ['HUMAN_RESOURCES', 'ADMIN'],
    trigger: 'integrations/secullum/secullum.service.ts ~:4291',
    targeted: false,
    templates: {
      inApp: {
        title: 'Justificativa de Ausência',
        body: '{{employeeName}} solicitou justificativa de ausência para {{date}}.',
      },
      push: {
        title: 'Justificativa de Ausência',
        body: '{{employeeName}} — ausência {{date}}',
      },
      email: {
        subject: 'Nova justificativa de ausência — {{employeeName}}',
        body: 'O funcionário {{employeeName}} criou uma solicitação de justificativa de ausência.\n\nData: {{date}}\nMotivo: {{reason}}\n\nAcesse o sistema para analisar.',
      },
    },
  },
  {
    key: 'secullum.request.adjustment.created',
    name: 'Ajuste de Ponto Solicitado',
    notificationType: 'USER',
    eventType: 'secullum.request.adjustment.created',
    description: 'Solicitação de ajuste de ponto criada',
    importance: 'NORMAL',
    workHoursOnly: true,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['HUMAN_RESOURCES', 'ADMIN'],
    trigger: 'secullum.service.ts ~:4380,:4779',
    targeted: false,
    templates: {
      inApp: {
        title: 'Ajuste de Ponto',
        body: '{{employeeName}} solicitou ajuste de ponto para {{date}}.',
      },
      push: {
        title: 'Ajuste de Ponto',
        body: '{{employeeName}} — ajuste {{date}}',
      },
    },
  },
  {
    key: 'secullum.request.punchInclusion.created',
    name: 'Inclusão de Marcação Solicitada',
    notificationType: 'USER',
    eventType: 'secullum.request.punchInclusion.created',
    description: 'Solicitação de inclusão de marcação criada',
    importance: 'NORMAL',
    workHoursOnly: true,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['HUMAN_RESOURCES', 'ADMIN'],
    trigger: 'secullum.service.ts ~:4994',
    targeted: false,
    templates: {
      inApp: {
        title: 'Inclusão de Marcação',
        body: '{{employeeName}} solicitou inclusão de marcação para {{date}}.',
      },
      push: {
        title: 'Inclusão de Marcação',
        body: '{{employeeName}} — marcação {{date}}',
      },
    },
  },
  {
    key: 'secullum.request.approved',
    name: 'Solicitação Aprovada',
    notificationType: 'USER',
    eventType: 'secullum.request.approved',
    description: 'Solicitação do funcionário aprovada; avisa o funcionário',
    importance: 'HIGH',
    workHoursOnly: true,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    sectors: [],
    trigger: 'secullum.service.ts ~:2895',
    targeted: true,
    templates: {
      inApp: {
        title: 'Solicitação Aprovada',
        body: 'Sua solicitação de {{requestType}} ({{date}}) foi aprovada.',
      },
      push: {
        title: 'Solicitação Aprovada',
        body: '{{requestType}} — {{date}} aprovada',
      },
    },
  },
  {
    key: 'secullum.request.rejected',
    name: 'Solicitação Rejeitada',
    notificationType: 'USER',
    eventType: 'secullum.request.rejected',
    description: 'Solicitação rejeitada; avisa funcionário com motivo',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    sectors: [],
    trigger: 'secullum.service.ts ~:2943',
    targeted: true,
    templates: {
      inApp: {
        title: 'Solicitação Rejeitada',
        body: 'Sua solicitação de {{requestType}} ({{date}}) foi rejeitada.{{#if reason}} Motivo: {{reason}}{{/if}}',
      },
      push: {
        title: 'Solicitação Rejeitada',
        body: '{{requestType}} — {{date}} rejeitada',
      },
      email: {
        subject: 'Solicitação rejeitada — {{requestType}}',
        body: 'Sua solicitação de {{requestType}} para {{date}} foi rejeitada.\n\n{{#if reason}}Motivo: {{reason}}\n\n{{/if}}Procure o RH em caso de dúvidas.',
      },
    },
  },
  // ─── Secullum: signatures ───────────────────────────────────────────────────
  {
    key: 'secullum.signature.ready',
    name: 'Cartão-Ponto Pronto para Assinatura',
    notificationType: 'USER',
    eventType: 'secullum.signature.ready',
    description: 'Cartão-ponto/apuração pronto para assinatura digital',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    sectors: ['HUMAN_RESOURCES'],
    trigger: 'secullum.service.ts ~:3341,:3647',
    targeted: true,
    templates: {
      inApp: {
        title: 'Cartão-Ponto para Assinatura',
        body: 'Seu cartão-ponto do período {{period}} está pronto para assinatura digital.',
      },
      push: {
        title: 'Cartão-Ponto para Assinatura',
        body: 'Período {{period}} aguardando sua assinatura',
      },
      email: {
        subject: 'Cartão-ponto pronto para assinatura — {{period}}',
        body: 'Seu cartão-ponto referente ao período {{period}} está disponível para assinatura digital.\n\nAcesse o sistema para revisar e assinar.',
      },
    },
  },
  {
    key: 'secullum.signature.signed',
    name: 'Cartão-Ponto Assinado',
    notificationType: 'SYSTEM',
    eventType: 'secullum.signature.signed',
    description: 'Funcionário assinou o cartão-ponto',
    importance: 'LOW',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP'],
    sectors: ['HUMAN_RESOURCES'],
    trigger: 'DEFERRED — no emitter (needs stateful poller/webhook to detect Secullum signature)',
    targeted: false,
    templates: {
      inApp: {
        title: 'Cartão-Ponto Assinado',
        body: '{{employeeName}} assinou o cartão-ponto do período {{period}}.',
      },
    },
  },
  {
    key: 'secullum.signature.rejected',
    name: 'Cartão-Ponto Rejeitado',
    notificationType: 'SYSTEM',
    eventType: 'secullum.signature.rejected',
    description: 'Funcionário rejeitou o cartão-ponto com resposta',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    sectors: ['HUMAN_RESOURCES', 'ADMIN'],
    trigger: 'DEFERRED — no emitter (needs stateful poller/webhook to detect Secullum rejection)',
    targeted: false,
    templates: {
      inApp: {
        title: 'Cartão-Ponto Rejeitado',
        body: '{{employeeName}} rejeitou o cartão-ponto do período {{period}}.{{#if response}} Resposta: {{response}}{{/if}}',
      },
      push: {
        title: 'Cartão-Ponto Rejeitado',
        body: '{{employeeName}} rejeitou o cartão-ponto',
      },
      email: {
        subject: 'Cartão-ponto rejeitado — {{employeeName}}',
        body: 'O funcionário {{employeeName}} rejeitou o cartão-ponto do período {{period}}.\n\n{{#if response}}Resposta: {{response}}\n\n{{/if}}Verifique a apuração no sistema.',
      },
    },
  },
  // ─── Secullum: sync / health ─────────────────────────────────────────────────
  {
    key: 'secullum.sync.failed',
    name: 'Falha na Sincronização Secullum',
    notificationType: 'SYSTEM',
    eventType: 'secullum.sync.failed',
    description: 'Falha na sincronização de funcionários com a Secullum',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'EMAIL'],
    sectors: ['HUMAN_RESOURCES', 'ADMIN'],
    trigger: 'integrations/secullum/user-secullum-sync.service.ts ~:133,:259',
    targeted: false,
    templates: {
      inApp: {
        title: 'Falha na Sincronização Secullum',
        body: 'A sincronização de funcionários com a Secullum falhou.{{#if error}} {{error}}{{/if}}',
      },
      email: {
        subject: 'Falha na sincronização Secullum',
        body: 'A sincronização de funcionários com a Secullum falhou.\n\n{{#if error}}Erro: {{error}}\n\n{{/if}}Verifique a integração no sistema.',
      },
    },
  },
  {
    key: 'secullum.sync.conflict',
    name: 'Conflito de Sincronização Secullum',
    notificationType: 'SYSTEM',
    eventType: 'secullum.sync.conflict',
    description: 'Conflito de dados durante sincronização Secullum',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP'],
    sectors: ['HUMAN_RESOURCES', 'ADMIN'],
    trigger: 'user-secullum-sync.service.ts ~:362,:516',
    targeted: false,
    templates: {
      inApp: {
        title: 'Conflito de Sincronização',
        body: 'Conflito de dados detectado durante a sincronização com a Secullum{{#if employeeName}} ({{employeeName}}){{/if}}. Resolução manual necessária.',
      },
    },
  },
  {
    key: 'secullum.absence.unjustified',
    name: 'Ausência Não Justificada',
    notificationType: 'SYSTEM',
    eventType: 'secullum.absence.unjustified',
    description: 'Ausência não justificada detectada; avisa funcionário + RH',
    importance: 'HIGH',
    workHoursOnly: true,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['HUMAN_RESOURCES'],
    trigger: 'secullum.service.ts ~:1657 (novo cron diário)',
    targeted: true,
    templates: {
      inApp: {
        title: 'Ausência Não Justificada',
        body: 'Ausência sem justificativa detectada em {{date}}{{#if employeeName}} para {{employeeName}}{{/if}}.',
      },
      push: {
        title: 'Ausência Não Justificada',
        body: 'Ausência em {{date}} sem justificativa',
      },
    },
  },
  {
    key: 'secullum.payroll.dataDegraded',
    name: 'Dados de Folha Degradados',
    notificationType: 'SYSTEM',
    eventType: 'secullum.payroll.dataDegraded',
    description: 'Dados de folha degradados/indisponíveis na integração',
    importance: 'URGENT',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'EMAIL'],
    sectors: ['HUMAN_RESOURCES', 'FINANCIAL', 'ADMIN'],
    trigger:
      'human-resources/bonus/secullum-bonus-integration.service.ts ~:144,:210; payroll/services/secullum-payroll-integration.service.ts ~:116',
    targeted: false,
    templates: {
      inApp: {
        title: 'Dados de Folha Degradados',
        body: 'Os dados de folha da integração Secullum estão degradados ou indisponíveis.{{#if detail}} {{detail}}{{/if}}',
      },
      email: {
        subject: 'URGENTE: dados de folha degradados',
        body: 'Os dados de folha provenientes da integração Secullum estão degradados ou indisponíveis.\n\n{{#if detail}}Detalhe: {{detail}}\n\n{{/if}}O cálculo de folha/bônus pode estar comprometido. Verifique imediatamente.',
      },
    },
  },
  {
    key: 'secullum.period.closed',
    name: 'Período de Apuração Fechado',
    notificationType: 'SYSTEM',
    eventType: 'secullum.period.closed',
    description: 'Período de apuração fechado',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP'],
    sectors: ['HUMAN_RESOURCES', 'FINANCIAL'],
    trigger: 'integrations/secullum/secullum-cadastros.service.ts ~:190',
    targeted: false,
    templates: {
      inApp: {
        title: 'Período de Apuração Fechado',
        body: 'O período de apuração {{period}} foi fechado.',
      },
    },
  },
  {
    key: 'secullum.health.failed',
    name: 'Healthcheck Secullum Falhou',
    notificationType: 'SYSTEM',
    eventType: 'secullum.health.failed',
    description: 'Healthcheck/credenciais Secullum falhando',
    importance: 'URGENT',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'EMAIL'],
    sectors: ['ADMIN'],
    trigger: 'secullum.service.ts ~:343-376,:2175',
    targeted: false,
    templates: {
      inApp: {
        title: 'Falha de Conexão Secullum',
        body: 'O healthcheck da integração Secullum falhou.{{#if error}} {{error}}{{/if}} Verifique as credenciais.',
      },
      email: {
        subject: 'URGENTE: integração Secullum indisponível',
        body: 'O healthcheck da integração Secullum está falhando.\n\n{{#if error}}Erro: {{error}}\n\n{{/if}}Verifique as credenciais e a disponibilidade do serviço.',
      },
    },
  },
  // ─── Questionnaires ─────────────────────────────────────────────────────────
  {
    key: 'questionnaire.assigned',
    name: 'Questionário Atribuído',
    notificationType: 'USER',
    eventType: 'questionnaire.assigned',
    description: 'Questionário atribuído ao respondente',
    importance: 'NORMAL',
    workHoursOnly: true,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: [],
    trigger: 'questionnaire.service.ts openQuestionnaire ~:419',
    targeted: true,
    templates: {
      inApp: {
        title: 'Novo Questionário',
        body: 'Você recebeu o questionário "{{questionnaireName}}".{{#if dueDate}} Prazo: {{dueDate}}.{{/if}}',
      },
      push: {
        title: 'Novo Questionário',
        body: '{{questionnaireName}}',
      },
    },
  },
  {
    key: 'questionnaire.entry.submitted',
    name: 'Resposta de Questionário Enviada',
    notificationType: 'GENERAL',
    eventType: 'questionnaire.entry.submitted',
    description: 'Resposta de questionário enviada; suprimir/agregar se anônimo',
    importance: 'LOW',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP'],
    sectors: ['ADMIN', 'HUMAN_RESOURCES'],
    trigger: 'questionnaire.service.ts submitEntry ~:684',
    targeted: true,
    templates: {
      inApp: {
        title: 'Resposta de Questionário',
        body: 'Uma resposta do questionário "{{questionnaireName}}" foi enviada{{#if respondentName}} por {{respondentName}}{{/if}}.',
      },
    },
  },
  {
    key: 'questionnaire.closed',
    name: 'Questionário Encerrado',
    notificationType: 'GENERAL',
    eventType: 'questionnaire.closed',
    description: 'Campanha de questionário encerrada',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['ADMIN'],
    trigger: 'questionnaire.service.ts ~:432',
    targeted: true,
    templates: {
      inApp: {
        title: 'Questionário Encerrado',
        body: 'A campanha do questionário "{{questionnaireName}}" foi encerrada.{{#if responseCount}} {{responseCount}} respostas.{{/if}}',
      },
      push: {
        title: 'Questionário Encerrado',
        body: '{{questionnaireName}} encerrado',
      },
    },
  },
  // ─── Skill assessments ──────────────────────────────────────────────────────
  {
    key: 'assessment.assigned',
    name: 'Avaliação de Competência Atribuída',
    notificationType: 'USER',
    eventType: 'assessment.assigned',
    description: 'Avaliação de competência atribuída ao avaliador',
    importance: 'NORMAL',
    workHoursOnly: true,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: [],
    trigger: 'skill.service.ts openAssessment (controller:297)',
    targeted: true,
    templates: {
      inApp: {
        title: 'Nova Avaliação de Competência',
        body: 'Você foi designado para a avaliação "{{assessmentName}}".{{#if dueDate}} Prazo: {{dueDate}}.{{/if}}',
      },
      push: {
        title: 'Nova Avaliação',
        body: '{{assessmentName}}',
      },
    },
  },
  {
    key: 'assessment.entry.submitted',
    name: 'Avaliação de Competência Enviada',
    notificationType: 'USER',
    eventType: 'assessment.entry.submitted',
    description: 'Avaliação de competência enviada',
    importance: 'LOW',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP'],
    sectors: ['PRODUCTION_MANAGER', 'ADMIN', 'HUMAN_RESOURCES'],
    trigger: 'skill.service.ts submitEntry (controller:430)',
    targeted: false,
    templates: {
      inApp: {
        title: 'Avaliação Enviada',
        body: 'A avaliação "{{assessmentName}}" foi enviada{{#if evaluatorName}} por {{evaluatorName}}{{/if}}.',
      },
    },
  },
  // ─── Reconciliation ─────────────────────────────────────────────────────────
  {
    key: 'reconciliation.run.failed',
    name: 'Conciliação Falhou',
    notificationType: 'SYSTEM',
    eventType: 'reconciliation.run.failed',
    description: 'Execução de conciliação falhou',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    sectors: ['FINANCIAL', 'ADMIN'],
    trigger: 'reconciliation-import.service.ts ~:177-185',
    targeted: false,
    templates: {
      inApp: {
        title: 'Conciliação Falhou',
        body: 'A execução de conciliação falhou.{{#if error}} {{error}}{{/if}}',
      },
      push: {
        title: 'Conciliação Falhou',
        body: 'Falha na execução de conciliação',
      },
      email: {
        subject: 'Conciliação falhou',
        body: 'A execução de conciliação falhou.\n\n{{#if error}}Erro: {{error}}\n\n{{/if}}Verifique a importação no sistema.',
      },
    },
  },
  {
    key: 'reconciliation.run.partial',
    name: 'Conciliação Parcial',
    notificationType: 'GENERAL',
    eventType: 'reconciliation.run.partial',
    description:
      'Conciliação concluída parcialmente com itens sem correspondência',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP'],
    sectors: ['FINANCIAL'],
    trigger: 'reconciliation-import.service.ts ~:161-175',
    targeted: false,
    templates: {
      inApp: {
        title: 'Conciliação Parcial',
        body: 'A conciliação foi concluída parcialmente.{{#if unmatchedCount}} {{unmatchedCount}} itens sem correspondência.{{/if}}',
      },
    },
  },
  // ─── Order schedule ─────────────────────────────────────────────────────────
  {
    key: 'order_schedule.run.failed',
    name: 'Agendamento de Pedido Falhou',
    notificationType: 'STOCK',
    eventType: 'order_schedule.run.failed',
    description: 'Agendamento automático de pedido falhou',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'LOGISTIC', 'ADMIN'],
    trigger: 'order-schedule.scheduler.ts ~:159-164,:222',
    targeted: false,
    templates: {
      inApp: {
        title: 'Agendamento de Pedido Falhou',
        body: 'O agendamento automático de pedido "{{scheduleName}}" falhou.{{#if error}} {{error}}{{/if}}',
      },
      push: {
        title: 'Agendamento de Pedido Falhou',
        body: '{{scheduleName}} falhou',
      },
    },
  },
  // ─── Task quote ──────────────────────────────────────────────────────────────
  {
    key: 'task_quote.budget_approved',
    name: 'Orçamento Aprovado',
    notificationType: 'GENERAL',
    eventType: 'task_quote.budget_approved',
    description: 'Orçamento aprovado; avisa comercial',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['COMMERCIAL'],
    trigger: 'task-quote.service.ts ~:1611,:1407',
    targeted: false,
    templates: {
      inApp: {
        title: 'Orçamento Aprovado',
        body: 'O orçamento da tarefa "{{taskName}}"{{#if customerName}} ({{customerName}}){{/if}} foi aprovado.',
      },
      push: {
        title: 'Orçamento Aprovado',
        body: '{{taskName}}{{#if customerName}} — {{customerName}}{{/if}}',
      },
    },
  },
  {
    key: 'task_quote.commercial_approved',
    name: 'Aprovação Comercial Concluída',
    notificationType: 'GENERAL',
    eventType: 'task_quote.commercial_approved',
    description: 'Aprovação comercial concluída; avisa financeiro',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['FINANCIAL'],
    trigger: 'task-quote.service.ts ~:1618',
    targeted: false,
    templates: {
      inApp: {
        title: 'Aprovação Comercial',
        body: 'A aprovação comercial da tarefa "{{taskName}}"{{#if customerName}} ({{customerName}}){{/if}} foi concluída.',
      },
      push: {
        title: 'Aprovação Comercial',
        body: '{{taskName}}{{#if customerName}} — {{customerName}}{{/if}}',
      },
    },
  },
  {
    key: 'task_quote.billing_approved',
    name: 'Faturamento Aprovado',
    notificationType: 'GENERAL',
    eventType: 'task_quote.billing_approved',
    description: 'Faturamento aprovado',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['COMMERCIAL', 'FINANCIAL', 'ADMIN'],
    trigger: 'task-quote.service.ts ~:1646 (após NFS-e ~:1732)',
    targeted: false,
    templates: {
      inApp: {
        title: 'Faturamento Aprovado',
        body: 'O faturamento da tarefa "{{taskName}}"{{#if customerName}} ({{customerName}}){{/if}} foi aprovado.',
      },
      push: {
        title: 'Faturamento Aprovado',
        body: '{{taskName}}{{#if customerName}} — {{customerName}}{{/if}}',
      },
    },
  },
  {
    key: 'task_quote.installment_overdue',
    name: 'Parcela Vencida',
    notificationType: 'SYSTEM',
    eventType: 'task_quote.installment_overdue',
    description: 'Parcela/boleto vencido',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    sectors: ['FINANCIAL', 'ADMIN'],
    trigger: 'task-quote-payment.scheduler.ts',
    targeted: false,
    templates: {
      inApp: {
        title: 'Parcela Vencida',
        body: 'A parcela{{#if installmentNumber}} {{installmentNumber}}{{/if}} de {{customerName}} venceu em {{dueDate}}. Valor: {{amount}}.',
      },
      push: {
        title: 'Parcela Vencida',
        body: '{{customerName}} — {{amount}} venceu {{dueDate}}',
      },
      email: {
        subject: 'Parcela vencida — {{customerName}}',
        body: 'Uma parcela está vencida.\n\nCliente: {{customerName}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}{{#if installmentNumber}}Parcela: {{installmentNumber}}\n{{/if}}Valor: {{amount}}\nVencimento: {{dueDate}}',
      },
    },
  },
  // ─── Bank slip ──────────────────────────────────────────────────────────────
  {
    key: 'bank_slip.due_date_changed',
    name: 'Vencimento de Boleto Alterado',
    notificationType: 'SYSTEM',
    eventType: 'bank_slip.due_date_changed',
    description: 'Data de vencimento do boleto alterada',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['FINANCIAL', 'ADMIN', 'COMMERCIAL'],
    trigger: 'invoice.controller.ts ~:652-799',
    targeted: false,
    templates: {
      inApp: {
        title: 'Vencimento de Boleto Alterado',
        body: 'O vencimento do boleto de {{customerName}}{{#if nossoNumero}} (NS {{nossoNumero}}){{/if}} mudou{{#if oldDueDate}} de {{oldDueDate}}{{/if}} para {{newDueDate}}.',
      },
      push: {
        title: 'Vencimento Alterado',
        body: '{{customerName}} — novo vencimento {{newDueDate}}',
      },
    },
  },
  // ─── PPE ─────────────────────────────────────────────────────────────────────
  {
    key: 'ppe.signature_required',
    name: 'Assinatura de EPI Necessária',
    notificationType: 'USER',
    eventType: 'ppe.signature_required',
    description: 'EPI entregue aguardando assinatura do recebedor',
    importance: 'NORMAL',
    workHoursOnly: true,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: [],
    trigger: 'ppe-delivery.service.ts markAsDelivered->WAITING_SIGNATURE ~:1748',
    targeted: true,
    templates: {
      inApp: {
        title: 'EPI Aguardando Assinatura',
        body: 'A entrega de EPI "{{itemName}}"{{#if quantity}} (qtd {{quantity}}){{/if}} aguarda sua assinatura.',
      },
      push: {
        title: 'EPI Aguardando Assinatura',
        body: '{{itemName}} aguarda sua assinatura',
      },
    },
  },
  {
    key: 'ppe.signature_failed',
    name: 'Falha na Assinatura de EPI',
    notificationType: 'SYSTEM',
    eventType: 'ppe.signature_failed',
    description: 'Falha na assinatura digital de EPI',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['ADMIN', 'HUMAN_RESOURCES'],
    trigger:
      'ppe-signature-audit.service.ts ~:45 (SIGNATURE_FAILED/PADES_FAILED)',
    targeted: false,
    templates: {
      inApp: {
        title: 'Falha na Assinatura de EPI',
        body: 'A assinatura digital de EPI{{#if itemName}} "{{itemName}}"{{/if}} falhou.{{#if reason}} {{reason}}{{/if}}',
      },
      push: {
        title: 'Falha na Assinatura de EPI',
        body: 'Falha na assinatura digital de EPI',
      },
    },
  },
  // ─── Payroll ─────────────────────────────────────────────────────────────────
  {
    key: 'payroll.finalization.succeeded',
    name: 'Folha Finalizada',
    notificationType: 'SYSTEM',
    eventType: 'payroll.finalization.succeeded',
    description: 'Finalização de folha/bônus concluída',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['ADMIN', 'HUMAN_RESOURCES', 'FINANCIAL'],
    trigger: 'human-resources/bonus/bonus-cron.service.ts ~:104',
    targeted: false,
    templates: {
      inApp: {
        title: 'Folha Finalizada',
        body: 'A finalização de folha/bônus{{#if period}} do período {{period}}{{/if}} foi concluída.',
      },
      push: {
        title: 'Folha Finalizada',
        body: 'Finalização de folha/bônus concluída',
      },
    },
  },
  {
    key: 'payroll.finalization.failed',
    name: 'Falha na Finalização da Folha',
    notificationType: 'SYSTEM',
    eventType: 'payroll.finalization.failed',
    description: 'Finalização de folha/bônus falhou',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    sectors: ['ADMIN', 'HUMAN_RESOURCES'],
    trigger: 'bonus-cron.service.ts ~:83-87,:107-115',
    targeted: false,
    templates: {
      inApp: {
        title: 'Falha na Finalização da Folha',
        body: 'A finalização de folha/bônus{{#if period}} do período {{period}}{{/if}} falhou.{{#if error}} {{error}}{{/if}}',
      },
      push: {
        title: 'Falha na Finalização da Folha',
        body: 'Finalização de folha/bônus falhou',
      },
      email: {
        subject: 'Falha na finalização da folha',
        body: 'A finalização de folha/bônus falhou.\n\n{{#if period}}Período: {{period}}\n{{/if}}{{#if error}}Erro: {{error}}\n\n{{/if}}Verifique o processamento no sistema.',
      },
    },
  },
  // ─── Messages (broadcast) ─────────────────────────────────────────────────────
  {
    key: 'message.published',
    name: 'Novo Comunicado',
    notificationType: 'GENERAL',
    eventType: 'message.published',
    description:
      'Novo comunicado/mensagem publicado; audiência alvo, senão todos ativos',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    sectors: [
      'BASIC',
      'PRODUCTION',
      'MAINTENANCE',
      'WAREHOUSE',
      'PLOTTING',
      'ADMIN',
      'HUMAN_RESOURCES',
      'EXTERNAL',
      'DESIGNER',
      'FINANCIAL',
      'LOGISTIC',
      'COMMERCIAL',
      'PRODUCTION_MANAGER',
    ],
    trigger: 'message.service.ts create/update (on publish)',
    targeted: true,
    templates: {
      inApp: {
        title: '{{messageTitle}}',
        body: 'Um novo comunicado foi publicado: "{{messageTitle}}".',
      },
      push: {
        title: 'Novo Comunicado',
        body: '{{messageTitle}}',
      },
      email: {
        subject: 'Novo comunicado — {{messageTitle}}',
        body: 'Um novo comunicado foi publicado.\n\n{{messageTitle}}\n\nAcesse o sistema para ler na íntegra.',
      },
    },
  },
  // ─── Task field: consolidated truck layout ─────────────────────────────────────
  {
    key: 'task.field.truck.layout',
    name: 'Medidas do Caminhão Atualizadas',
    notificationType: 'PRODUCTION',
    eventType: 'task.field.truck.layout',
    description:
      'Medidas do caminhão da tarefa atualizadas (notificação única consolidada, NÃO uma por lado)',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['PRODUCTION', 'PRODUCTION_MANAGER', 'PLOTTING', 'ADMIN'],
    trigger:
      'layout.service.ts (batch) + task-field-tracker.service.ts (colapsar trio)',
    targeted: false,
    templates: {
      inApp: {
        title: 'Medidas do Caminhão Atualizadas',
        body: 'As medidas do caminhão da tarefa "{{taskName}}"{{#if serialNumber}} #{{serialNumber}}{{/if}} foram atualizadas{{#if changedBy}} por {{changedBy}}{{/if}}.',
      },
      push: {
        title: 'Medidas Atualizadas',
        body: '{{taskName}} — medidas do caminhão atualizadas',
      },
    },
  },
  // ─── Coverage fix 2026: tasks ───────────────────────────────────────────────
  {
    key: 'task.assigned',
    name: 'Responsável Adicionado à Tarefa',
    notificationType: 'PRODUCTION',
    eventType: 'task.assigned',
    description: 'Usuário adicionado como responsável por uma tarefa',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: [],
    trigger: 'see coverage-fix 2026',
    targeted: true,
    templates: {
      inApp: {
        title: 'Você foi designado para uma tarefa',
        body: 'Você foi adicionado(a) como responsável pela tarefa "{{taskName}}"{{#if serialNumber}} #{{serialNumber}}{{/if}}.',
      },
      push: {
        title: 'Nova Tarefa Atribuída',
        body: '{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}',
      },
    },
  },
  // ─── Coverage fix 2026: external withdrawals ───────────────────────────────
  {
    key: 'external_withdrawal.created',
    name: 'Retirada Externa Criada',
    notificationType: 'STOCK',
    eventType: 'external_withdrawal.created',
    description: 'Retirada externa de itens registrada; avisa almoxarifado/logística',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP'],
    sectors: ['WAREHOUSE', 'LOGISTIC'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'Retirada Externa Criada',
        body: '{{withdrawerName}} registrou uma retirada externa de {{itemCount}} item(ns).',
      },
    },
  },
  {
    key: 'external_withdrawal.returned',
    name: 'Retirada Externa Devolvida',
    notificationType: 'STOCK',
    eventType: 'external_withdrawal.returned',
    description: 'Itens de retirada externa devolvidos; avisa almoxarifado/logística',
    importance: 'LOW',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP'],
    sectors: ['WAREHOUSE', 'LOGISTIC'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'Retirada Externa Devolvida',
        body: 'A retirada externa de {{withdrawerName}} foi devolvida.',
      },
    },
  },
  // ─── Coverage fix 2026: task quote ──────────────────────────────────────────
  {
    key: 'task_quote.settled',
    name: 'Orçamento Quitado',
    notificationType: 'GENERAL',
    eventType: 'task_quote.settled',
    description: 'Orçamento totalmente quitado; avisa financeiro/comercial',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['FINANCIAL', 'COMMERCIAL', 'ADMIN'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'Orçamento Quitado',
        body: 'O orçamento {{quoteLabel}}{{#if customerName}} de {{customerName}}{{/if}} foi quitado. Valor: {{amount}}.',
      },
      push: {
        title: 'Orçamento Quitado',
        body: '{{quoteLabel}} — {{amount}}',
      },
    },
  },
  {
    key: 'task_quote.approval_pending',
    name: 'Orçamento Aguardando Aprovação',
    notificationType: 'GENERAL',
    eventType: 'task_quote.approval_pending',
    description: 'Orçamento aguardando aprovação; avisa comercial/financeiro',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['COMMERCIAL', 'FINANCIAL', 'ADMIN'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'Orçamento Aguardando Aprovação',
        body: 'O orçamento {{quoteLabel}} aguarda aprovação.{{#if nextStep}} Próxima etapa: {{nextStep}}.{{/if}}',
      },
      push: {
        title: 'Aprovação Pendente',
        body: '{{quoteLabel}}{{#if nextStep}} — {{nextStep}}{{/if}}',
      },
    },
  },
  // ─── Coverage fix 2026: invoice / NFS-e ─────────────────────────────────────
  {
    key: 'invoice.cancelled',
    name: 'Nota Fiscal Cancelada',
    notificationType: 'SYSTEM',
    eventType: 'invoice.cancelled',
    description: 'Nota fiscal cancelada; avisa financeiro/comercial',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    sectors: ['FINANCIAL', 'COMMERCIAL', 'ADMIN'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'Nota Fiscal Cancelada',
        body: 'A nota fiscal da tarefa "{{taskName}}"{{#if customerName}} ({{customerName}}){{/if}} foi cancelada.',
      },
      push: {
        title: 'Nota Fiscal Cancelada',
        body: '{{taskName}}{{#if customerName}} — {{customerName}}{{/if}}',
      },
      email: {
        subject: 'Nota fiscal cancelada — {{customerName}}',
        body: 'A nota fiscal foi cancelada.\n\nTarefa: {{taskName}}\nCliente: {{customerName}}\n\nVerifique a situação no sistema.',
      },
    },
  },
  // ─── Coverage fix 2026: bank slip (boleto) ──────────────────────────────────
  {
    key: 'bank_slip.cancelled',
    name: 'Boleto Cancelado',
    notificationType: 'SYSTEM',
    eventType: 'bank_slip.cancelled',
    description: 'Boleto cancelado; avisa financeiro',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP'],
    sectors: ['FINANCIAL', 'ADMIN'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'Boleto Cancelado',
        body: 'O boleto (NS {{nossoNumero}}){{#if customerName}} de {{customerName}}{{/if}} foi cancelado.',
      },
    },
  },
  {
    key: 'bank_slip.overdue',
    name: 'Boleto Vencido',
    notificationType: 'SYSTEM',
    eventType: 'bank_slip.overdue',
    description: 'Boleto vencido sem pagamento; avisa financeiro',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    sectors: ['FINANCIAL', 'ADMIN'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'Boleto Vencido',
        body: 'O boleto (NS {{nossoNumero}}) de {{customerName}} venceu em {{dueDate}}. Valor: {{amount}}.',
      },
      push: {
        title: 'Boleto Vencido',
        body: '{{customerName}} — {{amount}} venceu {{dueDate}}',
      },
      email: {
        subject: 'Boleto vencido — {{customerName}}',
        body: 'Um boleto está vencido.\n\nCliente: {{customerName}}\nNosso número: {{nossoNumero}}\nVencimento: {{dueDate}}\nValor: {{amount}}\n\nProvidencie a cobrança.',
      },
    },
  },
  {
    key: 'bank_slip.created',
    name: 'Boleto Gerado',
    notificationType: 'SYSTEM',
    eventType: 'bank_slip.created',
    description: 'Boleto gerado; avisa financeiro',
    importance: 'LOW',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP'],
    sectors: ['FINANCIAL'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'Boleto Gerado',
        body: 'Um boleto (NS {{nossoNumero}}){{#if customerName}} para {{customerName}}{{/if}} foi gerado.',
      },
    },
  },
  {
    key: 'bank_slip.registration_failed',
    name: 'Falha no Registro do Boleto',
    notificationType: 'SYSTEM',
    eventType: 'bank_slip.registration_failed',
    description: 'Falha ao registrar boleto no banco; avisa financeiro',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'EMAIL'],
    sectors: ['FINANCIAL', 'ADMIN'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'Falha no Registro do Boleto',
        body: 'O registro do boleto{{#if customerName}} de {{customerName}}{{/if}} falhou.{{#if errorMessage}} {{errorMessage}}{{/if}}',
      },
      email: {
        subject: 'Falha no registro de boleto — {{customerName}}',
        body: 'O registro de um boleto falhou.\n\nCliente: {{customerName}}\n{{#if errorMessage}}Erro: {{errorMessage}}\n\n{{/if}}Verifique a integração bancária no sistema.',
      },
    },
  },
  {
    key: 'bank_slip.reversed',
    name: 'Boleto Estornado',
    notificationType: 'SYSTEM',
    eventType: 'bank_slip.reversed',
    description: 'Boleto estornado; avisa financeiro',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'EMAIL'],
    sectors: ['FINANCIAL', 'ADMIN'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'Boleto Estornado',
        body: 'O boleto (NS {{nossoNumero}}){{#if customerName}} de {{customerName}}{{/if}} foi estornado. Valor: {{amount}}.',
      },
      email: {
        subject: 'Boleto estornado — {{customerName}}',
        body: 'Um boleto foi estornado.\n\nCliente: {{customerName}}\nNosso número: {{nossoNumero}}\nValor: {{amount}}\n\nVerifique a conciliação no sistema.',
      },
    },
  },
  {
    key: 'nfse.issued',
    name: 'NFS-e Emitida',
    notificationType: 'SYSTEM',
    eventType: 'nfse.issued',
    description: 'NFS-e emitida com sucesso; avisa financeiro',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP'],
    sectors: ['FINANCIAL', 'ADMIN'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'NFS-e Emitida',
        body: 'A NFS-e nº {{nfseNumber}}{{#if customerName}} de {{customerName}}{{/if}} foi emitida.',
      },
    },
  },
  {
    key: 'nfse.rejected',
    name: 'NFS-e Rejeitada',
    notificationType: 'SYSTEM',
    eventType: 'nfse.rejected',
    description: 'Emissão de NFS-e rejeitada; avisa financeiro',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    sectors: ['FINANCIAL', 'ADMIN'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'NFS-e Rejeitada',
        body: 'A emissão da NFS-e{{#if customerName}} de {{customerName}}{{/if}} foi rejeitada.{{#if errorMessage}} {{errorMessage}}{{/if}}',
      },
      push: {
        title: 'NFS-e Rejeitada',
        body: '{{customerName}} — emissão rejeitada',
      },
      email: {
        subject: 'NFS-e rejeitada — {{customerName}}',
        body: 'A emissão de uma NFS-e foi rejeitada.\n\nCliente: {{customerName}}\n{{#if errorMessage}}Erro: {{errorMessage}}\n\n{{/if}}Verifique a emissão no sistema.',
      },
    },
  },
  // ─── Coverage fix 2026: HR warnings / assessments / questionnaires ──────────
  {
    key: 'warning.issued',
    name: 'Advertência Emitida',
    notificationType: 'USER',
    eventType: 'warning.issued',
    description: 'Advertência disciplinar emitida ao colaborador; avisa o colaborador',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    sectors: ['HUMAN_RESOURCES'],
    trigger: 'see coverage-fix 2026',
    targeted: true,
    templates: {
      inApp: {
        title: 'Advertência Emitida',
        body: 'Você recebeu uma advertência ({{category}}, severidade {{severity}}).{{#if reason}} Motivo: {{reason}}.{{/if}}',
      },
      push: {
        title: 'Advertência Emitida',
        body: '{{category}} — severidade {{severity}}',
      },
      email: {
        subject: 'Advertência emitida — {{category}}',
        body: 'Foi emitida uma advertência em seu nome.\n\nCategoria: {{category}}\nSeveridade: {{severity}}\n{{#if reason}}Motivo: {{reason}}\n\n{{/if}}Procure o RH em caso de dúvidas.',
      },
    },
  },
  {
    key: 'assessment.closed',
    name: 'Avaliação de Competência Encerrada',
    notificationType: 'USER',
    eventType: 'assessment.closed',
    description: 'Campanha de avaliação de competência encerrada',
    importance: 'NORMAL',
    workHoursOnly: true,
    batchingEnabled: false,
    channels: ['IN_APP'],
    sectors: ['ADMIN', 'HUMAN_RESOURCES'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'Avaliação Encerrada',
        body: 'A avaliação de competência "{{assessmentName}}" foi encerrada.',
      },
    },
  },
  {
    key: 'questionnaire.reminder',
    name: 'Lembrete de Questionário',
    notificationType: 'USER',
    eventType: 'questionnaire.reminder',
    description: 'Lembrete de questionário pendente; avisa o respondente',
    importance: 'NORMAL',
    workHoursOnly: true,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: [],
    trigger: 'see coverage-fix 2026',
    targeted: true,
    templates: {
      inApp: {
        title: 'Lembrete de Questionário',
        body: 'Você ainda não respondeu o questionário "{{questionnaireName}}".{{#if dueDate}} Prazo: {{dueDate}}.{{/if}}',
      },
      push: {
        title: 'Lembrete de Questionário',
        body: '{{questionnaireName}}{{#if dueDate}} — prazo {{dueDate}}{{/if}}',
      },
    },
  },
  {
    key: 'assessment.reminder',
    name: 'Lembrete de Avaliação',
    notificationType: 'USER',
    eventType: 'assessment.reminder',
    description: 'Lembrete de avaliação de competência pendente; avisa o avaliador',
    importance: 'NORMAL',
    workHoursOnly: true,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: [],
    trigger: 'see coverage-fix 2026',
    targeted: true,
    templates: {
      inApp: {
        title: 'Lembrete de Avaliação',
        body: 'Você ainda não concluiu a avaliação "{{assessmentName}}".{{#if dueDate}} Prazo: {{dueDate}}.{{/if}}',
      },
      push: {
        title: 'Lembrete de Avaliação',
        body: '{{assessmentName}}{{#if dueDate}} — prazo {{dueDate}}{{/if}}',
      },
    },
  },
  // ─── Coverage fix 2026: maintenance ─────────────────────────────────────────
  {
    key: 'maintenance.due',
    name: 'Manutenção Próxima do Vencimento',
    notificationType: 'SYSTEM',
    eventType: 'maintenance.due',
    description: 'Manutenção programada próxima do vencimento; avisa manutenção',
    importance: 'NORMAL',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['MAINTENANCE'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'Manutenção Próxima',
        body: 'A manutenção de "{{itemName}}" está prevista para {{dueDate}}.',
      },
      push: {
        title: 'Manutenção Próxima',
        body: '{{itemName}} — {{dueDate}}',
      },
    },
  },
  {
    key: 'maintenance.overdue',
    name: 'Manutenção Vencida',
    notificationType: 'SYSTEM',
    eventType: 'maintenance.overdue',
    description: 'Manutenção programada vencida; avisa manutenção/admin',
    importance: 'HIGH',
    workHoursOnly: false,
    batchingEnabled: false,
    channels: ['IN_APP', 'PUSH'],
    sectors: ['MAINTENANCE', 'ADMIN'],
    trigger: 'see coverage-fix 2026',
    targeted: false,
    templates: {
      inApp: {
        title: 'Manutenção Vencida',
        body: 'A manutenção de "{{itemName}}" venceu em {{dueDate}}.',
      },
      push: {
        title: 'Manutenção Vencida',
        body: '{{itemName}} venceu {{dueDate}}',
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// EXISTING_KEYS_CREATE_ONLY — create-only-if-missing registry.
//
// These keys may already exist in production (hand-seeded long ago) with
// admin-tuned copy/sectors/channels we MUST NOT overwrite. They are declared
// here only so that a FRESH environment gets the full base set. The runtime
// processes them on a CREATE-ONLY path: if a row with the key already exists it
// is SKIPPED entirely; if missing it is created (config + targetRule +
// channelConfigs) using the same create code path as the main upsert. Existing
// rows are NEVER updated from this list.
//
// Exact production copy is unknown, so each entry gets a simple generic pt-BR
// template via genericTemplate(name).
// ─────────────────────────────────────────────────────────────────────────────

interface ExistingKeyDef {
  key: string;
  name: string;
  notificationType: NotificationType;
  importance: Importance;
  channels: Channel[];
  sectors: Sector[];
}

/** Generic single-channel (in-app) template used when the exact copy is unknown. */
function genericTemplate(name: string): ChannelTemplate {
  return {
    inApp: {
      title: name,
      body: `${name}. Acesse o sistema para mais detalhes.`,
    },
  };
}

const EXISTING_KEYS_CREATE_ONLY: ExistingKeyDef[] = [
  // ─── Artwork ────────────────────────────────────────────────────────────────
  {
    key: 'artwork.approved',
    name: 'Arte Aprovada',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['DESIGNER', 'PRODUCTION', 'ADMIN'],
  },
  {
    key: 'artwork.reproved',
    name: 'Arte Reprovada',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['DESIGNER', 'PRODUCTION', 'ADMIN'],
  },
  {
    key: 'artwork.pending_approval_reminder',
    name: 'Lembrete de Arte Pendente de Aprovação',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['DESIGNER', 'PRODUCTION', 'ADMIN'],
  },
  // ─── Bank slip (legacy) ───────────────────────────────────────────────────────
  {
    key: 'bank_slip.due',
    name: 'Boleto a Vencer',
    notificationType: 'SYSTEM',
    importance: 'NORMAL',
    channels: ['IN_APP'],
    sectors: ['FINANCIAL', 'ADMIN'],
  },
  {
    key: 'bank_slip.paid',
    name: 'Boleto Pago',
    notificationType: 'SYSTEM',
    importance: 'NORMAL',
    channels: ['IN_APP'],
    sectors: ['FINANCIAL', 'ADMIN'],
  },
  // ─── Borrow ───────────────────────────────────────────────────────────────────
  {
    key: 'borrow.unreturned_reminder',
    name: 'Lembrete de Empréstimo Não Devolvido',
    notificationType: 'STOCK',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'ADMIN'],
  },
  {
    key: 'borrow.unreturned_manager_reminder',
    name: 'Lembrete de Empréstimo Não Devolvido (Gestor)',
    notificationType: 'STOCK',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'ADMIN'],
  },
  // ─── Cut ─────────────────────────────────────────────────────────────────────
  {
    key: 'cut.created',
    name: 'Corte Criado',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['PLOTTING', 'PRODUCTION', 'ADMIN'],
  },
  {
    key: 'cut.started',
    name: 'Corte Iniciado',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['PLOTTING', 'PRODUCTION', 'ADMIN'],
  },
  {
    key: 'cut.completed',
    name: 'Corte Concluído',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['PLOTTING', 'PRODUCTION', 'ADMIN'],
  },
  {
    key: 'cut.request.created',
    name: 'Solicitação de Corte Criada',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['PLOTTING', 'PRODUCTION', 'ADMIN'],
  },
  {
    key: 'cuts.added.to.task',
    name: 'Cortes Adicionados à Tarefa',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['PLOTTING', 'PRODUCTION', 'ADMIN'],
  },
  // ─── Item (stock levels) ───────────────────────────────────────────────────────
  {
    key: 'item.low_stock',
    name: 'Estoque Baixo',
    notificationType: 'STOCK',
    importance: 'HIGH',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'ADMIN'],
  },
  {
    key: 'item.out_of_stock',
    name: 'Item Sem Estoque',
    notificationType: 'STOCK',
    importance: 'HIGH',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'ADMIN'],
  },
  {
    key: 'item.reorder_required',
    name: 'Reposição Necessária',
    notificationType: 'STOCK',
    importance: 'HIGH',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'ADMIN'],
  },
  {
    key: 'item.overstock',
    name: 'Excesso de Estoque',
    notificationType: 'STOCK',
    importance: 'HIGH',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'ADMIN'],
  },
  // ─── Order ─────────────────────────────────────────────────────────────────────
  {
    key: 'order.created',
    name: 'Pedido Criado',
    notificationType: 'STOCK',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'LOGISTIC', 'ADMIN'],
  },
  {
    key: 'order.status.changed',
    name: 'Status do Pedido Alterado',
    notificationType: 'STOCK',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'LOGISTIC', 'ADMIN'],
  },
  {
    key: 'order.overdue',
    name: 'Pedido Atrasado',
    notificationType: 'STOCK',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'LOGISTIC', 'ADMIN'],
  },
  {
    key: 'order.item.received',
    name: 'Item do Pedido Recebido',
    notificationType: 'STOCK',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'LOGISTIC', 'ADMIN'],
  },
  {
    key: 'order.cancelled',
    name: 'Pedido Cancelado',
    notificationType: 'STOCK',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'LOGISTIC', 'ADMIN'],
  },
  {
    key: 'order.item.entered_inventory',
    name: 'Item do Pedido Entrou no Estoque',
    notificationType: 'STOCK',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'LOGISTIC', 'ADMIN'],
  },
  {
    key: 'order.payment.assigned',
    name: 'Pagamento de Pedido Atribuído',
    notificationType: 'STOCK',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'LOGISTIC', 'ADMIN'],
  },
  {
    key: 'order.payment.fulfilled',
    name: 'Pagamento de Pedido Concluído',
    notificationType: 'STOCK',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['WAREHOUSE', 'LOGISTIC', 'ADMIN'],
  },
  // ─── Paint ─────────────────────────────────────────────────────────────────────
  {
    key: 'paint.produced',
    name: 'Tinta Produzida',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP'],
    sectors: ['PRODUCTION', 'PRODUCTION_MANAGER', 'ADMIN'],
  },
  // ─── PPE ───────────────────────────────────────────────────────────────────────
  {
    key: 'ppe.requested',
    name: 'EPI Solicitado',
    notificationType: 'USER',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['HUMAN_RESOURCES', 'WAREHOUSE', 'ADMIN'],
  },
  {
    key: 'ppe.approved',
    name: 'EPI Aprovado',
    notificationType: 'USER',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['HUMAN_RESOURCES', 'WAREHOUSE', 'ADMIN'],
  },
  {
    key: 'ppe.rejected',
    name: 'EPI Rejeitado',
    notificationType: 'USER',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['HUMAN_RESOURCES', 'WAREHOUSE', 'ADMIN'],
  },
  {
    key: 'ppe.delivered',
    name: 'EPI Entregue',
    notificationType: 'USER',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['HUMAN_RESOURCES', 'WAREHOUSE', 'ADMIN'],
  },
  // ─── Service order (waiting approval) ────────────────────────────────────────────
  {
    key: 'service_order.waiting_approval.artwork',
    name: 'Ordem de Serviço Aguardando Aprovação (Arte)',
    notificationType: 'PRODUCTION',
    importance: 'HIGH',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['ADMIN', 'PRODUCTION_MANAGER'],
  },
  {
    key: 'service_order.waiting_approval.production',
    name: 'Ordem de Serviço Aguardando Aprovação (Produção)',
    notificationType: 'PRODUCTION',
    importance: 'HIGH',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['ADMIN', 'PRODUCTION_MANAGER'],
  },
  {
    key: 'service_order.waiting_approval.commercial',
    name: 'Ordem de Serviço Aguardando Aprovação (Comercial)',
    notificationType: 'PRODUCTION',
    importance: 'HIGH',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['ADMIN', 'PRODUCTION_MANAGER'],
  },
  {
    key: 'service_order.waiting_approval.logistic',
    name: 'Ordem de Serviço Aguardando Aprovação (Logística)',
    notificationType: 'PRODUCTION',
    importance: 'HIGH',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['ADMIN', 'PRODUCTION_MANAGER'],
  },
  // ─── Task ─────────────────────────────────────────────────────────────────────
  {
    key: 'task.created',
    name: 'Tarefa Criada',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['PRODUCTION', 'PRODUCTION_MANAGER', 'ADMIN'],
  },
  {
    key: 'task.cancelled',
    name: 'Tarefa Cancelada',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['PRODUCTION', 'PRODUCTION_MANAGER', 'ADMIN'],
  },
  {
    key: 'task.overdue',
    name: 'Tarefa Atrasada',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['PRODUCTION', 'PRODUCTION_MANAGER', 'ADMIN'],
  },
  {
    key: 'task.forecast_overdue',
    name: 'Tarefa com Previsão de Atraso',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['PRODUCTION', 'PRODUCTION_MANAGER', 'ADMIN'],
  },
  {
    key: 'task.ready_for_production',
    name: 'Tarefa Pronta para Produção',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['PRODUCTION', 'PRODUCTION_MANAGER', 'ADMIN'],
  },
  {
    key: 'task.status.changed',
    name: 'Status da Tarefa Alterado',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['PRODUCTION', 'PRODUCTION_MANAGER', 'ADMIN'],
  },
  {
    key: 'task.field.status',
    name: 'Campo de Status da Tarefa Alterado',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['PRODUCTION', 'PRODUCTION_MANAGER', 'ADMIN'],
  },
  // ─── Task quote (legacy) ───────────────────────────────────────────────────────
  {
    key: 'task_quote.payment_due',
    name: 'Pagamento de Orçamento a Vencer',
    notificationType: 'SYSTEM',
    importance: 'HIGH',
    channels: ['IN_APP', 'PUSH', 'EMAIL'],
    sectors: ['FINANCIAL', 'ADMIN'],
  },
  // ─── Time entry ────────────────────────────────────────────────────────────────
  {
    key: 'timeentry.reminder',
    name: 'Lembrete de Registro de Ponto',
    notificationType: 'USER',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: [],
    targeted: true,
  },
  // ─── Truck ─────────────────────────────────────────────────────────────────────
  {
    key: 'truck.movement_request',
    name: 'Solicitação de Movimentação de Caminhão',
    notificationType: 'PRODUCTION',
    importance: 'NORMAL',
    channels: ['IN_APP', 'PUSH'],
    sectors: ['PRODUCTION', 'LOGISTIC', 'ADMIN'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CLI flags
// ─────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const onlyArg = argv.find((a) => a.startsWith('--only='));
const ONLY: string[] | null = onlyArg
  ? onlyArg
      .slice('--only='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function configMetadata(def: ConfigDef): Prisma.InputJsonValue {
  return {
    registry: 'seed-notification-configs',
    trigger: def.trigger,
    targeted: def.targeted,
  };
}

type ConfigOutcome = 'created' | 'updated' | 'unchanged';
type CreateOnlyOutcome = 'created' | 'skipped';

/**
 * Shape shared by the full CONFIGS entries and the lighter
 * EXISTING_KEYS_CREATE_ONLY entries, sufficient to materialize a brand-new
 * config graph (configuration + target rule + channel configs). This is the
 * single source of truth for the CREATE code path used by both the main upsert
 * and the create-only-if-missing flow.
 */
interface CreatableConfig {
  key: string;
  name: string;
  notificationType: NotificationType;
  importance: Importance;
  channels: Channel[];
  sectors: Sector[];
  /** eventType defaults to key for the lighter list. */
  eventType: string;
  description: string;
  workHoursOnly: boolean;
  batchingEnabled: boolean;
  templates: ChannelTemplate;
  /** Documentation metadata. */
  trigger: string;
  targeted: boolean;
}

/** Normalize a lighter EXISTING_KEYS_CREATE_ONLY entry into a CreatableConfig. */
function fromExistingKeyDef(def: ExistingKeyDef): CreatableConfig {
  return {
    key: def.key,
    name: def.name,
    notificationType: def.notificationType,
    importance: def.importance,
    channels: def.channels,
    sectors: def.sectors,
    eventType: def.key,
    description: def.name,
    workHoursOnly: false,
    batchingEnabled: false,
    templates: genericTemplate(def.name),
    trigger: 'see coverage-fix 2026 (create-only-if-missing)',
    targeted: false,
  };
}

/**
 * Materialize a brand-new config graph inside a transaction: the
 * NotificationConfiguration (with `enabled: true`, set ONLY here on create),
 * its 1:1 NotificationTargetRule, and one NotificationChannelConfig per
 * declared channel. Shared by the main upsert create branch and the
 * create-only-if-missing flow. UserNotificationPreference is never touched.
 */
async function createConfigGraph(
  tx: Prisma.TransactionClient,
  def: CreatableConfig,
): Promise<void> {
  const templates = def.templates as unknown as Prisma.InputJsonValue;
  const metadata: Prisma.InputJsonValue = {
    registry: 'seed-notification-configs',
    trigger: def.trigger,
    targeted: def.targeted,
  };

  const config = await tx.notificationConfiguration.create({
    data: {
      key: def.key,
      name: def.name,
      notificationType: def.notificationType,
      eventType: def.eventType,
      description: def.description,
      enabled: true,
      importance: def.importance,
      workHoursOnly: def.workHoursOnly,
      batchingEnabled: def.batchingEnabled,
      templates,
      metadata,
    },
    select: { id: true },
  });

  await tx.notificationTargetRule.create({
    data: {
      configurationId: config.id,
      allowedSectors: def.sectors,
      excludeOnVacation: true,
    },
  });

  for (const ch of def.channels) {
    const preset = CHANNEL_PRESET[ch];
    await tx.notificationChannelConfig.create({
      data: {
        configurationId: config.id,
        channel: ch,
        enabled: preset.enabled,
        mandatory: preset.mandatory,
        defaultOn: preset.defaultOn,
      },
    });
  }
}

/**
 * Decide whether an existing config row differs from the declared definition,
 * IGNORING the `enabled` flag (which we never touch on update). Channel and
 * target-rule diffs are folded in so --dry-run reports those too.
 */
function diffExisting(
  def: ConfigDef,
  existing: {
    name: string | null;
    notificationType: string;
    eventType: string;
    description: string | null;
    importance: string;
    workHoursOnly: boolean;
    batchingEnabled: boolean;
    templates: unknown;
    targetRule: { allowedSectors: string[] } | null;
    channelConfigs: {
      channel: string;
      enabled: boolean;
      mandatory: boolean;
      defaultOn: boolean;
    }[];
  },
): boolean {
  if (existing.name !== def.name) return true;
  if (existing.notificationType !== def.notificationType) return true;
  if (existing.eventType !== def.eventType) return true;
  if (existing.description !== def.description) return true;
  if (existing.importance !== def.importance) return true;
  if (existing.workHoursOnly !== def.workHoursOnly) return true;
  if (existing.batchingEnabled !== def.batchingEnabled) return true;
  if (
    JSON.stringify(existing.templates ?? null) !==
    JSON.stringify(def.templates)
  )
    return true;

  // Target rule sectors (order-insensitive)
  const wantSectors = [...def.sectors].sort();
  const haveSectors = [...(existing.targetRule?.allowedSectors ?? [])].sort();
  if (JSON.stringify(wantSectors) !== JSON.stringify(haveSectors)) return true;

  // Channels
  const wantChannels = new Set(def.channels);
  const haveByChannel = new Map(
    existing.channelConfigs.map((c) => [c.channel, c]),
  );
  if (wantChannels.size !== existing.channelConfigs.length) return true;
  for (const ch of def.channels) {
    const have = haveByChannel.get(ch);
    if (!have) return true;
    const preset = CHANNEL_PRESET[ch];
    if (
      have.enabled !== preset.enabled ||
      have.mandatory !== preset.mandatory ||
      have.defaultOn !== preset.defaultOn
    )
      return true;
  }

  return false;
}

async function upsertConfig(def: ConfigDef): Promise<ConfigOutcome> {
  const existing = await prisma.notificationConfiguration.findUnique({
    where: { key: def.key },
    select: {
      id: true,
      name: true,
      notificationType: true,
      eventType: true,
      description: true,
      importance: true,
      workHoursOnly: true,
      batchingEnabled: true,
      templates: true,
      targetRule: { select: { allowedSectors: true } },
      channelConfigs: {
        select: {
          channel: true,
          enabled: true,
          mandatory: true,
          defaultOn: true,
        },
      },
    },
  });

  // ── DRY RUN ──────────────────────────────────────────────────────────────
  if (DRY_RUN) {
    if (!existing) return 'created';
    return diffExisting(def, {
      name: existing.name,
      notificationType: existing.notificationType as string,
      eventType: existing.eventType,
      description: existing.description,
      importance: existing.importance as string,
      workHoursOnly: existing.workHoursOnly,
      batchingEnabled: existing.batchingEnabled,
      templates: existing.templates,
      targetRule: existing.targetRule
        ? { allowedSectors: existing.targetRule.allowedSectors as string[] }
        : null,
      channelConfigs: existing.channelConfigs.map((c) => ({
        channel: c.channel as string,
        enabled: c.enabled,
        mandatory: c.mandatory,
        defaultOn: c.defaultOn,
      })),
    })
      ? 'updated'
      : 'unchanged';
  }

  // ── WRITE (per-key transaction) ───────────────────────────────────────────
  const templates = def.templates as unknown as Prisma.InputJsonValue;
  const metadata = configMetadata(def);

  await prisma.$transaction(async (tx) => {
    if (!existing) {
      // Brand-new config: use the shared create code path. `enabled` is set to
      // true ONLY here on create. UserNotificationPreference is never touched.
      await createConfigGraph(tx, def);
      return;
    }

    // Existing config: UPDATE path. NOTE: `enabled` is intentionally OMITTED
    // so an intentionally-disabled config is never re-enabled.
    const config = await tx.notificationConfiguration.update({
      where: { key: def.key },
      data: {
        name: def.name,
        notificationType: def.notificationType,
        eventType: def.eventType,
        description: def.description,
        importance: def.importance,
        workHoursOnly: def.workHoursOnly,
        batchingEnabled: def.batchingEnabled,
        templates,
        metadata,
        // enabled: DELIBERATELY NOT WRITTEN ON UPDATE
      },
      select: { id: true },
    });

    // Upsert target rule (1:1 by configurationId).
    await tx.notificationTargetRule.upsert({
      where: { configurationId: config.id },
      create: {
        configurationId: config.id,
        allowedSectors: def.sectors,
        excludeOnVacation: true,
      },
      update: {
        allowedSectors: def.sectors,
        excludeOnVacation: true,
      },
    });

    // Upsert each channel config by composite (configurationId, channel).
    for (const ch of def.channels) {
      const preset = CHANNEL_PRESET[ch];
      await tx.notificationChannelConfig.upsert({
        where: {
          configurationId_channel: {
            configurationId: config.id,
            channel: ch,
          },
        },
        create: {
          configurationId: config.id,
          channel: ch,
          enabled: preset.enabled,
          mandatory: preset.mandatory,
          defaultOn: preset.defaultOn,
        },
        update: {
          enabled: preset.enabled,
          mandatory: preset.mandatory,
          defaultOn: preset.defaultOn,
        },
      });
    }

    // Remove channel rows no longer declared (keeps the set canonical).
    await tx.notificationChannelConfig.deleteMany({
      where: {
        configurationId: config.id,
        channel: { notIn: def.channels },
      },
    });
  });

  // For real writes we report created vs updated based on prior existence.
  return existing ? 'updated' : 'created';
}

/**
 * CREATE-ONLY-IF-MISSING path for EXISTING_KEYS_CREATE_ONLY entries.
 * If a NotificationConfiguration with this key already exists, SKIP it entirely
 * (never update). If missing, create the full graph via createConfigGraph.
 * Respects --dry-run (no writes).
 */
async function createIfMissing(def: ExistingKeyDef): Promise<CreateOnlyOutcome> {
  const existing = await prisma.notificationConfiguration.findUnique({
    where: { key: def.key },
    select: { id: true },
  });

  if (existing) return 'skipped';
  if (DRY_RUN) return 'created';

  const creatable = fromExistingKeyDef(def);
  await prisma.$transaction(async (tx) => {
    await createConfigGraph(tx, creatable);
  });

  return 'created';
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const targets = ONLY
    ? CONFIGS.filter((c) => ONLY.includes(c.key))
    : CONFIGS;
  const createOnlyTargets = ONLY
    ? EXISTING_KEYS_CREATE_ONLY.filter((c) => ONLY.includes(c.key))
    : EXISTING_KEYS_CREATE_ONLY;

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  SEED: Notification Configurations');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Modo:    ${DRY_RUN ? 'DRY-RUN (sem gravações)' : 'GRAVANDO'}`);
  console.log(
    `  Escopo:  ${ONLY ? `--only=${ONLY.join(',')}` : 'todos os configs'}`,
  );
  console.log(`  Upsert:       ${targets.length} de ${CONFIGS.length}`);
  console.log(
    `  Create-only:  ${createOnlyTargets.length} de ${EXISTING_KEYS_CREATE_ONLY.length}`,
  );
  if (ONLY) {
    const unknown = ONLY.filter(
      (k) =>
        !CONFIGS.some((c) => c.key === k) &&
        !EXISTING_KEYS_CREATE_ONLY.some((c) => c.key === k),
    );
    if (unknown.length > 0) {
      console.warn(`  ⚠ Chaves desconhecidas ignoradas: ${unknown.join(', ')}`);
    }
  }
  console.log('──────────────────────────────────────────────────────────\n');

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let errors = 0;

  // ── CONFIGS: full upsert (owns the row, converges to declaration) ──────────
  console.log('  CONFIGS (upsert):');
  for (const def of targets) {
    try {
      const outcome = await upsertConfig(def);
      if (outcome === 'created') {
        created++;
        console.log(`   ＋ ${def.key} — ${DRY_RUN ? 'seria criado' : 'criado'}`);
      } else if (outcome === 'updated') {
        updated++;
        console.log(
          `   ↻ ${def.key} — ${DRY_RUN ? 'seria atualizado' : 'atualizado'}`,
        );
      } else {
        unchanged++;
        console.log(`   ＝ ${def.key} — sem alterações`);
      }
    } catch (e) {
      errors++;
      console.error(`   ✗ ${def.key} — ERRO:`, e);
    }
  }

  // ── EXISTING_KEYS_CREATE_ONLY: create-only-if-missing (never updates) ──────
  if (createOnlyTargets.length > 0) {
    console.log('\n  EXISTING_KEYS_CREATE_ONLY (create-only-if-missing):');
    for (const def of createOnlyTargets) {
      try {
        const outcome = await createIfMissing(def);
        if (outcome === 'created') {
          created++;
          console.log(
            `   ＋ ${def.key} — ${DRY_RUN ? 'seria criado' : 'criado'}`,
          );
        } else {
          skipped++;
          console.log(`   ⤳ ${def.key} — skip (exists)`);
        }
      } catch (e) {
        errors++;
        console.error(`   ✗ ${def.key} — ERRO:`, e);
      }
    }
  }

  const total = targets.length + createOnlyTargets.length;

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  Resumo');
  console.log('──────────────────────────────────────────────────────────');
  console.log(`   Criados:        ${created}`);
  console.log(`   Atualizados:    ${updated}`);
  console.log(`   Sem alterações: ${unchanged}`);
  console.log(`   Pulados:        ${skipped}`);
  if (errors > 0) console.log(`   Erros:          ${errors}`);
  console.log(`   Total:          ${total}`);
  if (DRY_RUN) {
    console.log(
      '\n  DRY-RUN: nenhuma gravação foi feita. Rode sem --dry-run para aplicar.',
    );
  }
  console.log(
    '\n  Garantias: `enabled` nunca é alterado em update; configs da lista create-only nunca são sobrescritas; UserNotificationPreference nunca é tocado.',
  );
  console.log('══════════════════════════════════════════════════════════\n');

  if (errors > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('\n❌ Erro fatal:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
