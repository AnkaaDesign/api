/**
 * =============================================================================
 * NOTIFICATION CONFIGURATION SEED — complete in-repo registry (June 2026)
 * =============================================================================
 *
 * PURPOSE
 *   This file is the SINGLE authoritative registry for every
 *   NotificationConfiguration / NotificationChannelConfig / NotificationTargetRule
 *   row. It mirrors PRODUCTION as of the 2026-06-10 backup (167 configs, full
 *   templates/sectors/channel flags sourced from the prod rows) plus the new
 *   configs added on top (service_order paused/pending/waiting_artwork,
 *   sector-escalation configs, external_operation billing states,
 *   item.replenished), with the consolidated 2026-06-10 cross-domain audit
 *   corrections baked in: sector lists, importance levels, pt-BR names and
 *   descriptions (incl. the service_order accent/style sweep over names and
 *   template bodies), channel-flag fixes, template fixes ({{entryLabel}},
 *   "fatura", "voltou para pendente") and metadata.targeted flags. Derived
 *   whatsapp bodies were regenerated from the corrected inApp bodies.
 *
 * CONTENT RULES (2026-06-10)
 *   1) Abbreviating "Ordem de Serviço" (the two-capital-letter short form)
 *      is banned everywhere (names, descriptions, template
 *      titles/subjects/bodies, whatsapp bodies): always spell it out.
 *   2) Descriptions NEVER name recipients — the audience is configurable
 *      per-config in the admin UI, so each description states only the
 *      trigger/business context (cron, webhook, status transition,
 *      threshold) and any business nuance. TARGETED configs
 *      (metadata.targeted: true — hardcoded dispatch to a specific user,
 *      e.g. the assignee or requester; sector lists are only the fallback
 *      audience) carry a short mechanism suffix such as
 *      "(notificação direcionada ao solicitante)". Legacy/dead/integration
 *      notes — "(Legado — ...)", "(Inalcançável — ...)",
 *      "(Aguardando integração — ...)" — are kept.
 *   3) TEMPLATE CONTENT (2026-06-10 overhaul):
 *      a) Bodies are informative without being walls of text: the inApp body
 *         is 1–2 full pt-BR sentences carrying the entity name + identifier
 *         (série, placa, cliente, NS do boleto) + the key value/change
 *         (valor, data, status, quantidade); the push body is compact but
 *         substantive (entity + identifier + key fact). Optional payload
 *         vars are wrapped in {{#if var}}…{{/if}}. Every var was verified
 *         against the `data` payload at the emit site in api/src.
 *      b) ACTOR ANONYMITY: no template names who performed the change. All
 *         {{changedBy}}/{{createdBy}}/{{approvedBy}}/… vars and "Criado
 *         por"/"Aprovada por"/… phrases were removed and sentences rephrased
 *         passively. Business SUBJECTS (the employee whose punch is
 *         adjusted, the withdrawer of an external operation, the warned
 *         collaborator) are kept — they are the entity, not the actor.
 *
 *   The old EXISTING_KEYS_CREATE_ONLY split is gone: every config is a full
 *   ConfigDef and is UPSERTED by key — created if missing, otherwise converged
 *   to the declaration (name/type/templates/sectors/channels/frequency).
 *
 * KEY RENAMES (rename-in-place, preserving config ids + user preference rows)
 *   external_withdrawal.created  → external_operation.created
 *   external_withdrawal.returned → external_operation.returned
 *   task.field.commission        → task.field.bonification
 *   Before upserting, if the OLD key still exists in the DB and the NEW one
 *   does not, the row is renamed via update({where:{key:old}}). Idempotent:
 *   DBs where the rename already happened (e.g. local, via migrations) skip it.
 *   The registry itself carries ONLY the new keys.
 *
 * EMAIL DISABLED EVERYWHERE (user decision, "for now")
 *   Every EMAIL channel row is declared {enabled:false, mandatory:false,
 *   defaultOn:false} regardless of the prod value. The e-mail TEMPLATES are
 *   kept in the templates JSON, so re-enabling later is just flipping the flag.
 *
 * WHATSAPP TEMPLATES FOR ALL
 *   Every config's templates include a whatsapp.body (the dispatch layer
 *   prepends the title; body-only). The 3 explicitly-authored whatsapp bodies
 *   (bank_slip.due, bank_slip.paid, truck.movement_request) are kept (updated
 *   in the 2026-06-10 overhaul: actor-free, grounded vars); all others derive
 *   from the FINAL inApp body (post-overhaul). Prod WHATSAPP channel FLAGS
 *   are preserved as-is (61 configs have the channel enabled).
 *
 * LEGACY / DEAD KEYS
 *   Dormant keys (task.status.changed, task.field.truck.*SideLayoutId,
 *   secullum.signature.signed/rejected, …) stay in the registry with honest
 *   descriptions — prod rows are never deleted.
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
 *   - IDEMPOTENT: upsert-by-key, one transaction per config; unchanged configs
 *     are not written at all.
 *   - NEVER flips `enabled` on update — with TWO documented exceptions: keys in
 *     FORCE_DISABLE (verified-dead configs that can never fire) are converged
 *     to enabled:false, and keys in FORCE_ENABLE (task_quote.commercial_approved,
 *     the COMMERCIAL→FINANCIAL billing handoff) to enabled:true, even on
 *     update. Every other key has `enabled` written ONLY on CREATE and left
 *     untouched afterwards, so admin enable/disable decisions survive re-runs
 *     (service_order.status_changed_for_creator.commercial stays intentionally
 *     disabled — noisy quote-driven flips).
 *   - NEVER touches UserNotificationPreference.
 *   - maxFrequencyPerDay / deduplicationWindow are written on create AND
 *     update (values from prod; null allowed).
 *   - All FOUR channel rows are declared per config (missing prod rows are
 *     materialized disabled), so the channel deleteMany is harmless.
 *   - --dry-run performs NO writes; it only reports what would change
 *     (including pending key renames).
 *
 * THIS FILE IS GENERATED-THEN-OWNED: the CONFIGS array was generated from the
 * 2026-06-10 prod backup; edit it directly from now on (keep it sorted by key).
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
  | 'ACCOUNTING'
  | 'PRODUCTION_MANAGER';

interface ChannelTemplate {
  inApp?: { title: string; body: string };
  push?: { title: string; body: string };
  email?: { subject: string; body: string };
  /** Body-only: the dispatch layer prepends the title. Always present. */
  whatsapp?: { body: string };
}

interface ChannelFlags {
  enabled: boolean;
  mandatory: boolean;
  defaultOn: boolean;
}

/** All four channels are always declared (missing prod rows → disabled). */
type ChannelMap = Record<Channel, ChannelFlags>;

const CHANNELS: Channel[] = ['IN_APP', 'PUSH', 'EMAIL', 'WHATSAPP'];

interface ConfigDef {
  key: string;
  name: string;
  notificationType: NotificationType;
  /** Always equal to `key`. */
  eventType: string;
  description: string;
  /** Written ONLY on create (prod snapshot value); never flipped on update. */
  enabled: boolean;
  importance: Importance;
  workHoursOnly: boolean;
  batchingEnabled: boolean;
  maxFrequencyPerDay: number | null;
  deduplicationWindow: number | null;
  /** Sectors used as target rule (fallback audience even for targeted configs). */
  sectors: Sector[];
  /** Per-config channel flags, written on create AND update. */
  channels: ChannelMap;
  templates: ChannelTemplate;
  /** Written verbatim (prod metadata + registry/trigger/targeted doc keys). */
  metadata: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// KEY RENAMES — old key → new key, applied in-place BEFORE the upsert so the
// config id and the attached UserNotificationPreference rows are preserved.
// ─────────────────────────────────────────────────────────────────────────────

const RENAMES: Record<string, string> = {
  'external_withdrawal.created': 'external_operation.created',
  'external_withdrawal.returned': 'external_operation.returned',
  'task.field.commission': 'task.field.bonification',
};

// ─────────────────────────────────────────────────────────────────────────────
// THE REGISTRY — one entry per config, sorted by key. eventType === key.
// Handlebars {{var}} placeholders match the data the emit code passes.
// Generated from the 2026-06-10 prod backup; owned/edited in-repo since.
// ─────────────────────────────────────────────────────────────────────────────

const CONFIGS: ConfigDef[] = [
  // ─── artwork ─────────────────────────────────────────────────────────────────
  {
    key: "artwork.approved",
    name: "Arte Aprovada",
    notificationType: "PRODUCTION",
    eventType: "artwork.approved",
    description: "Arte da tarefa aprovada, liberando a produção dos serviços que dependem dela.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Arte Aprovada",
        body: "A arte da tarefa \"{{taskName}}\"{{#if serialNumber}} {{serialNumber}}{{/if}} foi aprovada e está liberada para produção.",
      },
      push: {
        title: "Arte Aprovada",
        body: "{{taskName}}{{#if serialNumber}} {{serialNumber}}{{/if}} — arte aprovada, pronta para produção",
      },
      email: {
        subject: "Arte Aprovada - {{taskName}}",
        body: "A arte da tarefa \"{{taskName}}\"{{#if serialNumber}} {{serialNumber}}{{/if}} foi aprovada e está liberada para produção.",
      },
      whatsapp: {
        body: "A arte da tarefa \"{{taskName}}\"{{#if serialNumber}} {{serialNumber}}{{/if}} foi aprovada e está liberada para produção.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"artwork.approved\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "artwork.pending_approval_reminder",
    name: "Lembrete de Arte Pendente",
    notificationType: "PRODUCTION",
    eventType: "artwork.pending_approval_reminder",
    description: "Arte segue aguardando aprovação há mais de 24 horas (verificação periódica); requer decisão de aprovar ou reprovar.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: 1,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Arte Aguardando Aprovação",
        body: "A arte da tarefa \"{{taskName}}\"{{#if serialNumber}} {{serialNumber}}{{/if}} está aguardando aprovação{{#if daysText}} há {{daysText}}{{/if}}. Aprove ou reprove para liberar a produção.",
      },
      push: {
        title: "Arte Aguardando Aprovação",
        body: "{{taskName}}{{#if serialNumber}} {{serialNumber}}{{/if}} — arte aguardando aprovação{{#if daysText}} há {{daysText}}{{/if}}",
      },
      email: {
        subject: "Lembrete: Arte Aguardando Aprovação - {{taskName}}",
        body: "A arte da tarefa \"{{taskName}}\"{{#if serialNumber}} {{serialNumber}}{{/if}} ainda está aguardando aprovação{{#if daysText}} há {{daysText}}{{/if}}.\n\nAprove ou reprove para liberar a produção.",
      },
      whatsapp: {
        body: "A arte da tarefa \"{{taskName}}\"{{#if serialNumber}} {{serialNumber}}{{/if}} está aguardando aprovação{{#if daysText}} há {{daysText}}{{/if}}. Aprove ou reprove para liberar a produção.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"artwork.pending_approval_reminder\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "artwork.reproved",
    name: "Arte Reprovada",
    notificationType: "PRODUCTION",
    eventType: "artwork.reproved",
    description: "Arte da tarefa reprovada e devolvida para revisão antes de seguir para produção.",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: true,
    batchingEnabled: true,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Arte Reprovada",
        body: "A arte da tarefa \"{{taskName}}\"{{#if serialNumber}} {{serialNumber}}{{/if}} foi reprovada.{{#if reason}} Motivo: {{reason}}.{{/if}} Uma nova versão é necessária.",
      },
      push: {
        title: "Arte Reprovada",
        body: "{{taskName}}{{#if serialNumber}} {{serialNumber}}{{/if}} — arte reprovada, nova versão necessária",
      },
      email: {
        subject: "Arte Reprovada - {{taskName}}",
        body: "A arte da tarefa \"{{taskName}}\"{{#if serialNumber}} {{serialNumber}}{{/if}} foi reprovada.\n\n{{#if reason}}Motivo: {{reason}}\n\n{{/if}}Uma nova versão é necessária.",
      },
      whatsapp: {
        body: "A arte da tarefa \"{{taskName}}\"{{#if serialNumber}} {{serialNumber}}{{/if}} foi reprovada.{{#if reason}} Motivo: {{reason}}.{{/if}} Uma nova versão é necessária.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"artwork.reproved\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  // ─── assessment ──────────────────────────────────────────────────────────────
  {
    key: "assessment.assigned",
    name: "Avaliação de Competência Atribuída",
    notificationType: "USER",
    eventType: "assessment.assigned",
    description: "Avaliação de competência atribuída na abertura da campanha, com prazo definido (notificação direcionada ao avaliador designado).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: [],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Nova Avaliação de Competência",
        body: "Você foi designado(a) como avaliador(a) na avaliação de competência \"{{assessmentName}}\".",
      },
      push: {
        title: "Nova Avaliação",
        body: "Avaliação \"{{assessmentName}}\" atribuída a você",
      },
      whatsapp: {
        body: "Você foi designado(a) como avaliador(a) na avaliação de competência \"{{assessmentName}}\".",
      },
    },
    metadata: {
      trigger: "skill.service.ts openAssessment (controller:297)",
      registry: "seed-notification-configs",
      targeted: true,
    },
  },
  {
    key: "assessment.closed",
    name: "Avaliação de Competência Encerrada",
    notificationType: "USER",
    eventType: "assessment.closed",
    description: "Campanha de avaliação de competência encerrada; respostas consolidadas para análise.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Avaliação Encerrada",
        body: "A avaliação de competência \"{{assessmentName}}\" foi encerrada{{#if submittedCount}} com {{submittedCount}} resposta(s) enviada(s){{/if}}.",
      },
      whatsapp: {
        body: "A avaliação de competência \"{{assessmentName}}\" foi encerrada{{#if submittedCount}} com {{submittedCount}} resposta(s) enviada(s){{/if}}.",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "assessment.entry.submitted",
    name: "Avaliação de Competência Enviada",
    notificationType: "USER",
    eventType: "assessment.entry.submitted",
    description: "Avaliador enviou uma avaliação de competência preenchida em campanha aberta.",
    enabled: true,
    importance: "LOW",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Avaliação Enviada",
        body: "A avaliação \"{{assessmentName}}\" recebeu uma nova resposta{{#if evaluateeName}} sobre {{evaluateeName}}{{/if}}.",
      },
      whatsapp: {
        body: "A avaliação \"{{assessmentName}}\" recebeu uma nova resposta{{#if evaluateeName}} sobre {{evaluateeName}}{{/if}}.",
      },
    },
    metadata: {
      trigger: "skill.service.ts submitEntry (controller:430)",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "assessment.reminder",
    name: "Lembrete de Avaliação de Competência",
    notificationType: "USER",
    eventType: "assessment.reminder",
    description: "Lembrete periódico de avaliação de competência ainda não enviada dentro do prazo da campanha (notificação direcionada ao avaliador designado).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: [],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Lembrete de Avaliação",
        body: "Você ainda não concluiu a avaliação de competência \"{{assessmentName}}\". Conclua antes do encerramento da campanha.",
      },
      push: {
        title: "Lembrete de Avaliação",
        body: "Avaliação \"{{assessmentName}}\" ainda não concluída",
      },
      whatsapp: {
        body: "Você ainda não concluiu a avaliação de competência \"{{assessmentName}}\". Conclua antes do encerramento da campanha.",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: true,
    },
  },
  // ─── bank_slip ───────────────────────────────────────────────────────────────
  {
    key: "bank_slip.cancelled",
    name: "Boleto Cancelado",
    notificationType: "SYSTEM",
    eventType: "bank_slip.cancelled",
    description: "Boleto cancelado junto ao Sicredi; o título deixa de ser cobrável.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Boleto Cancelado",
        body: "O boleto (NS {{nossoNumero}}){{#if customerName}} de {{customerName}}{{/if}}{{#if taskName}} (tarefa \"{{taskName}}\"){{/if}} foi cancelado e deixou de ser cobrável.",
      },
      whatsapp: {
        body: "O boleto (NS {{nossoNumero}}){{#if customerName}} de {{customerName}}{{/if}}{{#if taskName}} (tarefa \"{{taskName}}\"){{/if}} foi cancelado e deixou de ser cobrável.",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "bank_slip.created",
    name: "Boleto Gerado",
    notificationType: "SYSTEM",
    eventType: "bank_slip.created",
    description: "Boleto registrado e ativo no Sicredi (confirmação do pipeline de emissão).",
    enabled: true,
    importance: "LOW",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Boleto Gerado",
        body: "Um boleto (NS {{nossoNumero}}){{#if customerName}} para {{customerName}}{{/if}} foi registrado no Sicredi.{{#if amount}} Valor: {{amount}}.{{/if}}{{#if dueDate}} Vencimento: {{dueDate}}.{{/if}}",
      },
      whatsapp: {
        body: "Um boleto (NS {{nossoNumero}}){{#if customerName}} para {{customerName}}{{/if}} foi registrado no Sicredi.{{#if amount}} Valor: {{amount}}.{{/if}}{{#if dueDate}} Vencimento: {{dueDate}}.{{/if}}",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "bank_slip.due",
    name: "Boleto Próximo do Vencimento",
    notificationType: "SYSTEM",
    eventType: "bank_slip.due",
    description: "Boleto vence em até 3 dias (varredura diária Sicredi); recebimento deve ser acompanhado.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: true,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: false, defaultOn: false },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Boleto Próximo do Vencimento",
        body: "O boleto de {{customerName}}{{#if taskName}} (tarefa \"{{taskName}}\"){{/if}} vence em {{daysRemaining}} dia(s), em {{dueDate}}. Valor: {{amount}}.",
      },
      push: {
        title: "Boleto Vencendo",
        body: "{{customerName}} — {{amount}} vence em {{daysRemaining}} dia(s)",
      },
      email: {
        subject: "Boleto Vencendo - {{customerName}}",
        body: "Um boleto está próximo do vencimento.\n\nCliente: {{customerName}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}Valor: {{amount}}\nVencimento: {{dueDate}}\nDias restantes: {{daysRemaining}}\n",
      },
      whatsapp: {
        body: "Boleto vencendo em {{daysRemaining}} dia(s): {{customerName}} — {{amount}}.{{#if taskName}} Tarefa: {{taskName}}.{{/if}} Vencimento: {{dueDate}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"bank_slip.due\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "bank_slip.due_date_changed",
    name: "Vencimento de Boleto Alterado",
    notificationType: "SYSTEM",
    eventType: "bank_slip.due_date_changed",
    description: "Data de vencimento de um boleto alterada após a emissão.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Vencimento de Boleto Alterado",
        body: "O vencimento do boleto{{#if nossoNumero}} (NS {{nossoNumero}}){{/if}} mudou{{#if oldDueDate}} de {{oldDueDate}}{{/if}} para {{newDueDate}}.",
      },
      push: {
        title: "Vencimento Alterado",
        body: "Boleto{{#if nossoNumero}} NS {{nossoNumero}}{{/if}} — novo vencimento {{newDueDate}}",
      },
      whatsapp: {
        body: "O vencimento do boleto{{#if nossoNumero}} (NS {{nossoNumero}}){{/if}} mudou{{#if oldDueDate}} de {{oldDueDate}}{{/if}} para {{newDueDate}}.",
      },
    },
    metadata: {
      trigger: "invoice.controller.ts ~:652-799",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "bank_slip.overdue",
    name: "Boleto Vencido",
    notificationType: "SYSTEM",
    eventType: "bank_slip.overdue",
    description: "Boleto vencido sem pagamento (varredura diária Sicredi); requer início de cobrança.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: true,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Boleto Vencido",
        body: "O boleto (NS {{nossoNumero}}) de {{customerName}} venceu em {{dueDate}} sem pagamento. Valor: {{amount}}. Inicie a cobrança.",
      },
      push: {
        title: "Boleto Vencido",
        body: "{{customerName}} — {{amount}} venceu em {{dueDate}}",
      },
      email: {
        subject: "Boleto vencido — {{customerName}}",
        body: "Um boleto está vencido.\n\nCliente: {{customerName}}\nNosso número: {{nossoNumero}}\nVencimento: {{dueDate}}\nValor: {{amount}}\n\nProvidencie a cobrança.",
      },
      whatsapp: {
        body: "O boleto (NS {{nossoNumero}}) de {{customerName}} venceu em {{dueDate}} sem pagamento. Valor: {{amount}}. Inicie a cobrança.",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "bank_slip.paid",
    name: "Boleto Pago",
    notificationType: "SYSTEM",
    eventType: "bank_slip.paid",
    description: "Pagamento de boleto confirmado via webhook do Sicredi, varredura diária ou baixa manual.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Boleto Pago",
        body: "O boleto de {{customerName}}{{#if taskName}} (tarefa \"{{taskName}}\"){{/if}} foi pago. Valor: {{paidAmount}}. Vencimento: {{dueDate}}.",
      },
      push: {
        title: "Boleto Pago",
        body: "{{customerName}} — {{paidAmount}} (venc. {{dueDate}})",
      },
      email: {
        subject: "Boleto Pago - {{customerName}}",
        body: "Um boleto foi pago.\n\nCliente: {{customerName}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}Valor pago: {{paidAmount}}\nVencimento: {{dueDate}}\n",
      },
      whatsapp: {
        body: "Boleto pago: {{customerName}} — {{paidAmount}}.{{#if taskName}} Tarefa: {{taskName}}.{{/if}} Vencimento: {{dueDate}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"bank_slip.paid\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "bank_slip.registration_failed",
    name: "Falha no Registro do Boleto",
    notificationType: "SYSTEM",
    eventType: "bank_slip.registration_failed",
    description: "Falha ao registrar o boleto no Sicredi durante a emissão; requer reprocessamento do título.",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Falha no Registro do Boleto",
        body: "O registro do boleto{{#if customerName}} de {{customerName}}{{/if}}{{#if taskName}} (tarefa \"{{taskName}}\"){{/if}} falhou no Sicredi.{{#if errorMessage}} Erro: {{errorMessage}}.{{/if}} Reprocesse o título.",
      },
      email: {
        subject: "Falha no registro de boleto — {{customerName}}",
        body: "O registro de um boleto falhou.\n\nCliente: {{customerName}}\n{{#if errorMessage}}Erro: {{errorMessage}}\n\n{{/if}}Verifique a integração bancária no sistema.",
      },
      whatsapp: {
        body: "O registro do boleto{{#if customerName}} de {{customerName}}{{/if}}{{#if taskName}} (tarefa \"{{taskName}}\"){{/if}} falhou no Sicredi.{{#if errorMessage}} Erro: {{errorMessage}}.{{/if}} Reprocesse o título.",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "bank_slip.reversed",
    name: "Boleto Estornado",
    notificationType: "SYSTEM",
    eventType: "bank_slip.reversed",
    description: "Pagamento de boleto estornado pelo banco após a confirmação.",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Boleto Estornado",
        body: "O boleto (NS {{nossoNumero}}){{#if customerName}} de {{customerName}}{{/if}} teve o pagamento estornado pelo banco. Verifique a conciliação.",
      },
      email: {
        subject: "Boleto estornado — {{customerName}}",
        body: "Um boleto teve o pagamento estornado.\n\nCliente: {{customerName}}\nNosso número: {{nossoNumero}}\n\nVerifique a conciliação no sistema.",
      },
      whatsapp: {
        body: "O boleto (NS {{nossoNumero}}){{#if customerName}} de {{customerName}}{{/if}} teve o pagamento estornado pelo banco. Verifique a conciliação.",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  // ─── borrow ──────────────────────────────────────────────────────────────────
  {
    key: "borrow.unreturned.escalation",
    name: "Empréstimo Não Devolvido (Gestores)",
    notificationType: "STOCK",
    eventType: "borrow.unreturned.escalation",
    description: "Colaborador mantém itens emprestados além do prazo (cron diário; escalonamento do lembrete de devolução).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "PRODUCTION_MANAGER", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Empréstimo não devolvido — {{userName}}",
        body: "{{userName}} mantém {{borrowCount}} item(ns) emprestado(s) há mais de {{days}} dias: {{itemList}}.",
      },
      push: {
        title: "Empréstimo não devolvido — {{userName}}",
        body: "{{userName}} mantém {{borrowCount}} item(ns) emprestado(s) há mais de {{days}} dias: {{itemList}}.",
      },
      email: {
        subject: "Empréstimo não devolvido — {{userName}}",
        body: "O colaborador {{userName}} mantém {{borrowCount}} item(ns) emprestado(s) há mais de {{days}} dias.\n\nItens: {{itemList}}\n\nAcesse o sistema para cobrar a devolução.",
      },
      whatsapp: {
        body: "{{userName}} mantém {{borrowCount}} item(ns) emprestado(s) há mais de {{days}} dias: {{itemList}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "borrow-notification.scheduler.ts — cron diário de empréstimos não devolvidos (escalonamento ATIVO)",
      targeted: false,
    },
  },
  {
    key: "borrow.unreturned_manager_reminder",
    name: "Lembrete de Devolução (Gestor)",
    notificationType: "USER",
    eventType: "borrow.unreturned_manager_reminder",
    description: "Disparado diariamente às 17:20 quando há colaboradores com ferramentas emprestadas não devolvidas (notificação direcionada ao gestor responsável).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: 1,
    deduplicationWindow: null,
    sectors: [],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Itens Não Devolvidos",
        body: "O colaborador {{employeeName}} possui {{borrowCount}} ferramenta(s) emprestada(s) pendente(s) de devolução: {{itemList}}.",
      },
      push: {
        title: "Itens Não Devolvidos",
        body: "{{employeeName}} — {{borrowCount}} item(ns) sem devolução",
      },
      email: {
        subject: "Gestor: Itens Não Devolvidos — {{employeeName}}",
        body: "O colaborador {{employeeName}} possui ferramentas emprestadas pendentes de devolução.\n\nQuantidade: {{borrowCount}}\nItens: {{itemList}}\n\nCobre a devolução.",
      },
      whatsapp: {
        body: "O colaborador {{employeeName}} possui {{borrowCount}} ferramenta(s) emprestada(s) pendente(s) de devolução: {{itemList}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"borrow.unreturned_manager_reminder\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  {
    key: "borrow.unreturned_reminder",
    name: "Lembrete de Devolução",
    notificationType: "USER",
    eventType: "borrow.unreturned_reminder",
    description: "Disparado diariamente às 17:20 enquanto houver ferramentas emprestadas não devolvidas (notificação direcionada ao colaborador com itens em aberto).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: 1,
    deduplicationWindow: null,
    sectors: [],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Lembrete de Devolução",
        body: "Você possui {{borrowCount}} ferramenta(s) emprestada(s) pendente(s) de devolução: {{itemList}}. Devolva ao almoxarifado.",
      },
      push: {
        title: "Devolução Pendente",
        body: "Você tem {{borrowCount}} item(ns) para devolver: {{itemList}}",
      },
      email: {
        subject: "Lembrete de Devolução",
        body: "Você possui ferramentas emprestadas pendentes de devolução.\n\nQuantidade: {{borrowCount}}\nItens: {{itemList}}\n\nDevolva ao almoxarifado.",
      },
      whatsapp: {
        body: "Você possui {{borrowCount}} ferramenta(s) emprestada(s) pendente(s) de devolução: {{itemList}}. Devolva ao almoxarifado.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"borrow.unreturned_reminder\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  // ─── cut ─────────────────────────────────────────────────────────────────────
  {
    key: "cut.completed",
    name: "Recorte Concluido",
    notificationType: "PRODUCTION",
    eventType: "cut.completed",
    description: "Recorte concluído no plotter; o adesivo fica pronto para aplicação.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER", "PLOTTING", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Recorte Concluído",
        body: "O recorte ({{cutTypeLabel}}) da tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi concluído e está pronto para aplicação.",
      },
      push: {
        title: "Recorte Concluído",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — recorte concluído ({{cutTypeLabel}})",
      },
      email: {
        subject: "Recorte Concluído - {{taskName}}",
        body: "O recorte foi concluído e está pronto para aplicação.\n\nTipo: {{cutTypeLabel}}\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "O recorte ({{cutTypeLabel}}) da tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi concluído e está pronto para aplicação.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"cut.completed\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "cut.created",
    name: "Recorte Criado",
    notificationType: "PRODUCTION",
    eventType: "cut.created",
    description: "Novo recorte adicionado a uma tarefa, entrando na fila de corte do plotter.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER", "PLOTTING"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Novo Recorte Criado",
        body: "Novo recorte ({{cutTypeLabel}}) adicionado à tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}}, aguardando corte no plotter.",
      },
      push: {
        title: "Novo Recorte",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — novo recorte ({{cutTypeLabel}})",
      },
      email: {
        subject: "Novo Recorte Criado - {{taskName}}",
        body: "Um novo recorte foi criado e entrou na fila do plotter.\n\nTipo: {{cutTypeLabel}}\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "Novo recorte ({{cutTypeLabel}}) adicionado à tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}}, aguardando corte no plotter.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"cut.created\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "cut.request.created",
    name: "Solicitacao de Recorte",
    notificationType: "PRODUCTION",
    eventType: "cut.request.created",
    description: "Solicitação de recorte criada e aguardando início do corte no plotter.",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "PLOTTING", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Nova Solicitação de Recorte",
        body: "Nova solicitação de recorte ({{cutTypeLabel}}) para a tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}}.{{#if reason}} Motivo: {{reason}}.{{/if}}",
      },
      push: {
        title: "Solicitação de Recorte",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — solicitação de recorte ({{cutTypeLabel}})",
      },
      email: {
        subject: "Nova Solicitação de Recorte - {{taskName}}",
        body: "Uma nova solicitação de recorte foi criada.\n\nTipo: {{cutTypeLabel}}\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if reason}}Motivo: {{reason}}\n{{/if}}",
      },
      whatsapp: {
        body: "Nova solicitação de recorte ({{cutTypeLabel}}) para a tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}}.{{#if reason}} Motivo: {{reason}}.{{/if}}",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"cut.request.created\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "cut.started",
    name: "Recorte Iniciado",
    notificationType: "PRODUCTION",
    eventType: "cut.started",
    description: "Corte de um recorte iniciado no plotter.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER", "PLOTTING"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Recorte Iniciado",
        body: "O recorte ({{cutTypeLabel}}) da tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi iniciado no plotter.",
      },
      push: {
        title: "Recorte Iniciado",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — recorte em andamento ({{cutTypeLabel}})",
      },
      email: {
        subject: "Recorte Iniciado - {{taskName}}",
        body: "O recorte foi iniciado no plotter.\n\nTipo: {{cutTypeLabel}}\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "O recorte ({{cutTypeLabel}}) da tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi iniciado no plotter.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"cut.started\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  // ─── cuts ────────────────────────────────────────────────────────────────────
  {
    key: "cuts.added.to.task",
    name: "Recortes Adicionados",
    notificationType: "PRODUCTION",
    eventType: "cuts.added.to.task",
    description: "Vários recortes adicionados de uma só vez a uma tarefa (operação em lote).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER", "PLOTTING"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Recortes Adicionados à Tarefa",
        body: "{{count}} recorte(s) foram adicionados à tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}}.",
      },
      push: {
        title: "Recortes Adicionados",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — {{count}} recorte(s) adicionados",
      },
      email: {
        subject: "Recortes Adicionados - {{taskName}}",
        body: "Recortes foram adicionados à tarefa.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}Quantidade: {{count}} recorte(s)\n",
      },
      whatsapp: {
        body: "{{count}} recorte(s) foram adicionados à tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"cuts.added.to.task\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  // ─── external_operation ──────────────────────────────────────────────────────
  {
    key: "external_operation.cancelled",
    name: "Operação Externa Cancelada",
    notificationType: "STOCK",
    eventType: "external_operation.cancelled",
    description: "Operação externa cancelada; itens e cobranças vinculadas devem ser revisados.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    // 2026-06-11 decision: external operations are ADMIN-only notifications.
    sectors: ["ADMIN"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Operação Externa Cancelada",
        body: "A operação externa de {{withdrawerName}}{{#if customerName}} ({{customerName}}){{/if}} foi cancelada.{{#if totalAmount}} Valor: R$ {{totalAmount}}.{{/if}} Revise itens e cobranças vinculadas.",
      },
      push: {
        title: "Operação Externa Cancelada",
        body: "Operação externa de {{withdrawerName}} cancelada",
      },
      email: {
        subject: "Operação externa cancelada{{#if customerName}} — {{customerName}}{{/if}}",
        body: "Uma operação externa foi cancelada.\n\nRetirante: {{withdrawerName}}\n{{#if customerName}}Cliente: {{customerName}}\n{{/if}}{{#if totalAmount}}Valor: R$ {{totalAmount}}\n{{/if}}\nRevise itens e cobranças vinculadas.",
      },
      whatsapp: {
        body: "A operação externa de {{withdrawerName}}{{#if customerName}} ({{customerName}}){{/if}} foi cancelada.{{#if totalAmount}} Valor: R$ {{totalAmount}}.{{/if}} Revise itens e cobranças vinculadas.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "external-operation billing 2026-06-10 — external-operation.service.ts (CHARGED/LIQUIDATED/CANCELLED)",
      targeted: false,
    },
  },
  {
    key: "external_operation.charged",
    name: "Operação Externa Cobrada",
    notificationType: "STOCK",
    eventType: "external_operation.charged",
    description: "Operação externa cobrada: NFS-e emitida e boleto gerado (transição para o status Cobrada).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    // 2026-06-11 decision: external operations are ADMIN-only notifications.
    sectors: ["ADMIN"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Operação Externa Cobrada",
        body: "A operação externa de {{withdrawerName}}{{#if customerName}} ({{customerName}}){{/if}} foi cobrada: NFS-e emitida e boleto gerado.{{#if totalAmount}} Valor: R$ {{totalAmount}}.{{/if}}",
      },
      push: {
        title: "Operação Externa Cobrada",
        body: "Operação externa de {{withdrawerName}} cobrada{{#if totalAmount}} — R$ {{totalAmount}}{{/if}}",
      },
      email: {
        subject: "Operação externa cobrada{{#if customerName}} — {{customerName}}{{/if}}",
        body: "Uma operação externa foi cobrada (NFS-e emitida e boleto gerado).\n\nRetirante: {{withdrawerName}}\n{{#if customerName}}Cliente: {{customerName}}\n{{/if}}{{#if totalAmount}}Valor: R$ {{totalAmount}}\n{{/if}}",
      },
      whatsapp: {
        body: "A operação externa de {{withdrawerName}}{{#if customerName}} ({{customerName}}){{/if}} foi cobrada: NFS-e emitida e boleto gerado.{{#if totalAmount}} Valor: R$ {{totalAmount}}.{{/if}}",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "external-operation billing 2026-06-10 — external-operation.service.ts (CHARGED/LIQUIDATED/CANCELLED)",
      targeted: false,
    },
  },
  {
    key: "external_operation.created",
    name: "Operação Externa Criada",
    notificationType: "STOCK",
    eventType: "external_operation.created",
    description: "Operação externa registrada, com retirada de itens do estoque.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    // 2026-06-11 decision: external operations are ADMIN-only notifications.
    sectors: ["ADMIN"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Operação Externa Criada",
        body: "Operação externa registrada para {{withdrawerName}}, com retirada de itens do estoque.",
      },
      whatsapp: {
        body: "Operação externa registrada para {{withdrawerName}}, com retirada de itens do estoque.",
      },
    },
    metadata: {
      trigger: "inventory/external-operation/external-operation.service.ts ~:1509",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "external_operation.liquidated",
    name: "Operação Externa Liquidada",
    notificationType: "STOCK",
    eventType: "external_operation.liquidated",
    description: "Pagamento da operação externa confirmado (transição automática para Liquidada após a quitação).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    // 2026-06-11 decision: external operations are ADMIN-only notifications.
    sectors: ["ADMIN"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Operação Externa Liquidada",
        body: "A operação externa {{#if operationLabel}}{{operationLabel}} {{/if}}{{#if withdrawerName}}de {{withdrawerName}} {{/if}}foi liquidada — pagamento confirmado.{{#if totalAmount}} Valor: R$ {{totalAmount}}.{{/if}}",
      },
      push: {
        title: "Operação Externa Liquidada",
        body: "Operação externa {{#if operationLabel}}{{operationLabel}} {{/if}}{{#if withdrawerName}}de {{withdrawerName}} {{/if}}liquidada",
      },
      email: {
        subject: "Operação externa liquidada{{#if customerName}} — {{customerName}}{{/if}}",
        body: "Uma operação externa foi liquidada (pagamento confirmado).\n\n{{#if operationLabel}}Operação: {{operationLabel}}\n{{/if}}{{#if withdrawerName}}Retirante: {{withdrawerName}}\n{{/if}}{{#if customerName}}Cliente: {{customerName}}\n{{/if}}{{#if totalAmount}}Valor: R$ {{totalAmount}}\n{{/if}}",
      },
      whatsapp: {
        body: "A operação externa {{#if operationLabel}}{{operationLabel}} {{/if}}{{#if withdrawerName}}de {{withdrawerName}} {{/if}}foi liquidada — pagamento confirmado.{{#if totalAmount}} Valor: R$ {{totalAmount}}.{{/if}}",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "external-operation billing 2026-06-10 — external-operation.service.ts (CHARGED/LIQUIDATED/CANCELLED)",
      targeted: false,
    },
  },
  {
    key: "external_operation.returned",
    name: "Operação Externa Devolvida",
    notificationType: "STOCK",
    eventType: "external_operation.returned",
    description: "Todos os itens da operação externa foram devolvidos ao estoque; devolução pronta para conferência.",
    enabled: true,
    importance: "LOW",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    // 2026-06-11 decision: external operations are ADMIN-only notifications.
    sectors: ["ADMIN"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Operação Externa Devolvida",
        body: "A operação externa de {{withdrawerName}} foi totalmente devolvida ao estoque. Confira a devolução.",
      },
      whatsapp: {
        body: "A operação externa de {{withdrawerName}} foi totalmente devolvida ao estoque. Confira a devolução.",
      },
    },
    metadata: {
      trigger: "inventory/external-operation/external-operation.service.ts ~:2914",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  // ─── invoice ─────────────────────────────────────────────────────────────────
  {
    key: "invoice.cancelled",
    name: "Fatura Cancelada",
    notificationType: "SYSTEM",
    eventType: "invoice.cancelled",
    description: "Fatura interna cancelada, com motivo registrado; parcelas e boletos vinculados precisam de revisão.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Fatura Cancelada",
        body: "A fatura da tarefa \"{{taskName}}\"{{#if customerName}} ({{customerName}}){{/if}} foi cancelada.{{#if reason}} Motivo: {{reason}}.{{/if}} Revise parcelas e boletos vinculados.",
      },
      push: {
        title: "Fatura Cancelada",
        body: "Fatura de {{taskName}}{{#if customerName}} — {{customerName}}{{/if}} cancelada",
      },
      email: {
        subject: "Fatura cancelada — {{customerName}}",
        body: "Uma fatura foi cancelada.\n\nTarefa: {{taskName}}\nCliente: {{customerName}}\n{{#if reason}}Motivo: {{reason}}\n{{/if}}\nRevise parcelas e boletos vinculados no sistema.",
      },
      whatsapp: {
        body: "A fatura da tarefa \"{{taskName}}\"{{#if customerName}} ({{customerName}}){{/if}} foi cancelada.{{#if reason}} Motivo: {{reason}}.{{/if}} Revise parcelas e boletos vinculados.",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  // ─── item ────────────────────────────────────────────────────────────────────
  {
    key: "item.low_stock",
    name: "Item com Estoque Baixo",
    notificationType: "STOCK",
    eventType: "item.low_stock",
    description: "Item atingiu nível baixo de estoque (limiar calculado por item); reposição deve ser programada.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: 1,
    deduplicationWindow: null,
    sectors: ["ADMIN", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Estoque Baixo",
        body: "O item \"{{itemName}}\"{{#if itemCode}} ({{itemCode}}){{/if}} está com estoque baixo: {{quantity}} unidade(s) em estoque, mínimo recomendado {{minQuantity}}.",
      },
      push: {
        title: "Estoque Baixo",
        body: "{{itemName}} — {{quantity}} unid. restantes (mín. {{minQuantity}})",
      },
      email: {
        subject: "Estoque Baixo - {{itemName}}",
        body: "O item está com estoque baixo.\n\nItem: {{itemName}}\n{{#if itemCode}}Código: {{itemCode}}\n{{/if}}Quantidade atual: {{quantity}} unidade(s)\nMínimo recomendado: {{minQuantity}} unidade(s)\n",
      },
      whatsapp: {
        body: "O item \"{{itemName}}\"{{#if itemCode}} ({{itemCode}}){{/if}} está com estoque baixo: {{quantity}} unidade(s) em estoque, mínimo recomendado {{minQuantity}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"item.low_stock\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "item.out_of_stock",
    name: "Item Sem Estoque",
    notificationType: "STOCK",
    eventType: "item.out_of_stock",
    description: "Item ficou com estoque zerado; requer reposição urgente.",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: 2,
    deduplicationWindow: null,
    sectors: ["ADMIN", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Item Esgotado",
        body: "O item \"{{itemName}}\"{{#if itemCode}} ({{itemCode}}){{/if}} está ESGOTADO{{#if category}} — categoria {{category}}{{/if}}. Reposição urgente necessária.",
      },
      push: {
        title: "Item Esgotado",
        body: "{{itemName}} — estoque zerado, reposição urgente",
      },
      email: {
        subject: "URGENTE: Item Esgotado - {{itemName}}",
        body: "O item está completamente esgotado.\n\nItem: {{itemName}}\n{{#if itemCode}}Código: {{itemCode}}\n{{/if}}{{#if category}}Categoria: {{category}}\n{{/if}}Estoque atual: 0 unidades\n\nReposição urgente necessária.",
      },
      whatsapp: {
        body: "O item \"{{itemName}}\"{{#if itemCode}} ({{itemCode}}){{/if}} está ESGOTADO{{#if category}} — categoria {{category}}{{/if}}. Reposição urgente necessária.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"item.out_of_stock\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "item.overstock",
    name: "Excesso de Estoque",
    notificationType: "STOCK",
    eventType: "item.overstock",
    description: "Item com estoque acima do nível máximo configurado; compras devem ser revisadas.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Excesso de Estoque",
        body: "O item \"{{itemName}}\"{{#if itemCode}} ({{itemCode}}){{/if}} está com excesso de estoque: {{currentQuantity}} unidade(s), máximo recomendado {{maximumQuantity}}{{#if excessQuantity}} (excedente de {{excessQuantity}}){{/if}}.",
      },
      push: {
        title: "Excesso de Estoque",
        body: "{{itemName}} — {{currentQuantity}} unid. (máx. {{maximumQuantity}})",
      },
      email: {
        subject: "Excesso de Estoque - {{itemName}}",
        body: "O item está com excesso de estoque.\n\nItem: {{itemName}}\nQuantidade atual: {{currentQuantity}} unidade(s)\nMáximo recomendado: {{maximumQuantity}} unidade(s)\n",
      },
      whatsapp: {
        body: "O item \"{{itemName}}\"{{#if itemCode}} ({{itemCode}}){{/if}} está com excesso de estoque: {{currentQuantity}} unidade(s), máximo recomendado {{maximumQuantity}}{{#if excessQuantity}} (excedente de {{excessQuantity}}){{/if}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"item.overstock\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "item.reorder_required",
    name: "Recompra Necessária",
    notificationType: "STOCK",
    eventType: "item.reorder_required",
    description: "Item atingiu o ponto de recompra; momento de gerar o pedido de compra.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Recompra Necessária",
        body: "O item \"{{itemName}}\"{{#if itemCode}} ({{itemCode}}){{/if}} atingiu o ponto de recompra: {{currentQuantity}} unidade(s) em estoque.{{#if suggestedOrderQuantity}} Sugestão de pedido: {{suggestedOrderQuantity}} unidade(s).{{/if}}{{#if preferredSupplier}} Fornecedor sugerido: {{preferredSupplier}}.{{/if}}",
      },
      push: {
        title: "Recompra Necessária",
        body: "{{itemName}} — ponto de recompra atingido ({{currentQuantity}} unid. em estoque)",
      },
      email: {
        subject: "Recompra Necessária - {{itemName}}",
        body: "O item atingiu o ponto de recompra.\n\nItem: {{itemName}}\n{{#if itemCode}}Código: {{itemCode}}\n{{/if}}Quantidade atual: {{currentQuantity}} unidade(s)\n{{#if suggestedOrderQuantity}}Quantidade sugerida: {{suggestedOrderQuantity}} unidade(s)\n{{/if}}{{#if preferredSupplier}}Fornecedor sugerido: {{preferredSupplier}}\n{{/if}}",
      },
      whatsapp: {
        body: "O item \"{{itemName}}\"{{#if itemCode}} ({{itemCode}}){{/if}} atingiu o ponto de recompra: {{currentQuantity}} unidade(s) em estoque.{{#if suggestedOrderQuantity}} Sugestão de pedido: {{suggestedOrderQuantity}} unidade(s).{{/if}}{{#if preferredSupplier}} Fornecedor sugerido: {{preferredSupplier}}.{{/if}}",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "stock-notification.service.ts (processStockNotifications, evento derivado REORDER) — cruzamentos low/critical/out com reorderQuantity definida, vindos de atividades ou edição direta",
      targeted: false,
    },
  },
  {
    key: "item.replenished",
    name: "Estoque Reabastecido",
    notificationType: "STOCK",
    eventType: "item.replenished",
    description: "Item voltou ao nível ideal de estoque após reposição (aviso de baixa prioridade).",
    enabled: true,
    importance: "LOW",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: false, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Estoque Reabastecido",
        body: "O item {{itemName}} voltou ao nível ideal de estoque ({{currentQuantity}} unidades).",
      },
      push: {
        title: "Estoque Reabastecido",
        body: "O item {{itemName}} voltou ao nível ideal de estoque ({{currentQuantity}} unidades).",
      },
      whatsapp: {
        body: "O item {{itemName}} voltou ao nível ideal de estoque ({{currentQuantity}} unidades).",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "stock-notification.service.ts (processStockNotifications) — pipeline de atividades E edição direta de item via item.service.ts checkStockThresholds (ATIVO)",
      targeted: false,
    },
  },
  // ─── maintenance ─────────────────────────────────────────────────────────────
  {
    key: "maintenance.due",
    name: "Manutenção Próxima do Vencimento",
    notificationType: "SYSTEM",
    eventType: "maintenance.due",
    description: "Manutenção programada chegou à data prevista de execução.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["MAINTENANCE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Manutenção Programada para Hoje",
        body: "A manutenção \"{{scheduleName}}\" do item \"{{itemName}}\" chegou à data prevista de execução.",
      },
      push: {
        title: "Manutenção Programada",
        body: "{{itemName}} — manutenção \"{{scheduleName}}\" prevista para hoje",
      },
      whatsapp: {
        body: "A manutenção \"{{scheduleName}}\" do item \"{{itemName}}\" chegou à data prevista de execução.",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "maintenance.overdue",
    name: "Manutenção Vencida",
    notificationType: "SYSTEM",
    eventType: "maintenance.overdue",
    description: "Manutenção programada passou da data prevista sem ser executada.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "MAINTENANCE", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Manutenção Vencida",
        body: "A manutenção \"{{scheduleName}}\" do item \"{{itemName}}\" está vencida há {{daysOverdue}} dia(s) sem execução.",
      },
      push: {
        title: "Manutenção Vencida",
        body: "{{itemName}} — manutenção vencida há {{daysOverdue}} dia(s)",
      },
      whatsapp: {
        body: "A manutenção \"{{scheduleName}}\" do item \"{{itemName}}\" está vencida há {{daysOverdue}} dia(s) sem execução.",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  // ─── message ─────────────────────────────────────────────────────────────────
  {
    key: "message.published",
    name: "Novo Comunicado",
    notificationType: "GENERAL",
    eventType: "message.published",
    description: "Comunicado publicado no sistema (notificação direcionada à audiência escolhida na publicação; sem audiência definida, todos os usuários ativos).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "BASIC", "COMMERCIAL", "DESIGNER", "EXTERNAL", "FINANCIAL", "HUMAN_RESOURCES", "LOGISTIC", "MAINTENANCE", "PLOTTING", "PRODUCTION", "PRODUCTION_MANAGER", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Novo Comunicado",
        body: "Um novo comunicado foi publicado: \"{{title}}\". Acesse o sistema para ler na íntegra.",
      },
      push: {
        title: "Novo Comunicado",
        body: "Comunicado publicado: {{title}}",
      },
      email: {
        subject: "Novo comunicado — {{title}}",
        body: "Um novo comunicado foi publicado.\n\n{{title}}\n\nAcesse o sistema para ler na íntegra.",
      },
      whatsapp: {
        body: "Um novo comunicado foi publicado: \"{{title}}\". Acesse o sistema para ler na íntegra.",
      },
    },
    metadata: {
      trigger: "message.service.ts create/update (on publish)",
      registry: "seed-notification-configs",
      targeted: true,
    },
  },
  // ─── nfse ────────────────────────────────────────────────────────────────────
  {
    key: "nfse.issued",
    name: "NFS-e Emitida",
    notificationType: "SYSTEM",
    eventType: "nfse.issued",
    description: "NFS-e emitida e aceita pela prefeitura (retorno da integração Elotech).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "NFS-e Emitida",
        body: "A NFS-e nº {{nfseNumber}}{{#if customerName}} de {{customerName}}{{/if}}{{#if taskName}} (tarefa \"{{taskName}}\"){{/if}} foi emitida e aceita pela prefeitura.",
      },
      whatsapp: {
        body: "A NFS-e nº {{nfseNumber}}{{#if customerName}} de {{customerName}}{{/if}}{{#if taskName}} (tarefa \"{{taskName}}\"){{/if}} foi emitida e aceita pela prefeitura.",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "nfse.rejected",
    name: "NFS-e Rejeitada",
    notificationType: "SYSTEM",
    eventType: "nfse.rejected",
    description: "Prefeitura (Elotech) rejeitou a emissão da NFS-e; faturamento e boletos ficam bloqueados até a correção.",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "NFS-e Rejeitada",
        body: "A emissão da NFS-e{{#if customerName}} de {{customerName}}{{/if}}{{#if taskName}} (tarefa \"{{taskName}}\"){{/if}} foi rejeitada pela prefeitura.{{#if errorMessage}} Erro: {{errorMessage}}.{{/if}} Faturamento e boletos ficam bloqueados até a correção.",
      },
      push: {
        title: "NFS-e Rejeitada",
        body: "NFS-e de {{customerName}} rejeitada — faturamento bloqueado",
      },
      email: {
        subject: "NFS-e rejeitada — {{customerName}}",
        body: "A emissão de uma NFS-e foi rejeitada.\n\nCliente: {{customerName}}\n{{#if errorMessage}}Erro: {{errorMessage}}\n\n{{/if}}Verifique a emissão no sistema.",
      },
      whatsapp: {
        body: "A emissão da NFS-e{{#if customerName}} de {{customerName}}{{/if}}{{#if taskName}} (tarefa \"{{taskName}}\"){{/if}} foi rejeitada pela prefeitura.{{#if errorMessage}} Erro: {{errorMessage}}.{{/if}} Faturamento e boletos ficam bloqueados até a correção.",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  // ─── order ───────────────────────────────────────────────────────────────────
  {
    key: "order.cancelled",
    name: "Pedido Cancelado",
    notificationType: "STOCK",
    eventType: "order.cancelled",
    description: "Pedido de compra cancelado; o recebimento deve ser interrompido.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Pedido Cancelado",
        body: "O pedido #{{orderNumber}} de {{supplierName}} foi cancelado.{{#if reason}} Motivo: {{reason}}.{{/if}}",
      },
      push: {
        title: "Pedido Cancelado",
        body: "Pedido #{{orderNumber}} ({{supplierName}}) cancelado",
      },
      email: {
        subject: "Pedido Cancelado - #{{orderNumber}}",
        body: "O pedido foi cancelado.\n\nPedido: #{{orderNumber}}\nFornecedor: {{supplierName}}\n{{#if reason}}Motivo: {{reason}}\n{{/if}}",
      },
      whatsapp: {
        body: "O pedido #{{orderNumber}} de {{supplierName}} foi cancelado.{{#if reason}} Motivo: {{reason}}.{{/if}}",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"order.cancelled\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "order.created",
    name: "Pedido Criado",
    notificationType: "STOCK",
    eventType: "order.created",
    description: "Novo pedido de compra criado, aguardando acompanhamento junto ao fornecedor.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Novo Pedido Criado",
        body: "O pedido #{{orderNumber}} foi criado para {{supplierName}}.{{#if itemsSummary}}{{itemsSummary}}{{/if}}",
      },
      push: {
        title: "Novo Pedido",
        body: "Pedido #{{orderNumber}} criado — {{supplierName}}",
      },
      email: {
        subject: "Novo Pedido Criado - #{{orderNumber}}",
        body: "Um novo pedido foi criado.\n\nPedido: #{{orderNumber}}\nFornecedor: {{supplierName}}\n{{#if description}}Descrição: {{description}}\n{{/if}}{{#if itemsSummary}}Itens:{{itemsSummary}}\n{{/if}}",
      },
      whatsapp: {
        body: "O pedido #{{orderNumber}} foi criado para {{supplierName}}.{{#if itemsSummary}}{{itemsSummary}}{{/if}}",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"order.created\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "order.item.entered_inventory",
    name: "Item do Pedido Entrou no Estoque",
    notificationType: "STOCK",
    eventType: "order.item.entered_inventory",
    description: "Item do pedido deu entrada no estoque por meio de atividade de entrada.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Item Adicionado ao Estoque",
        body: "O item \"{{itemName}}\" do pedido #{{orderNumber}} deu entrada no estoque: +{{quantity}} unidade(s), saldo atual {{currentStock}}.",
      },
      push: {
        title: "Estoque Atualizado",
        body: "{{itemName}} +{{quantity}} unid. — saldo atual {{currentStock}}",
      },
      email: {
        subject: "Item Entrou no Estoque - {{itemName}}",
        body: "Um item do pedido deu entrada no estoque.\n\nPedido: #{{orderNumber}}\nItem: {{itemName}}\nQuantidade adicionada: {{quantity}} unidade(s)\nSaldo atual: {{currentStock}} unidade(s)\n",
      },
      whatsapp: {
        body: "O item \"{{itemName}}\" do pedido #{{orderNumber}} deu entrada no estoque: +{{quantity}} unidade(s), saldo atual {{currentStock}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"order.item.entered_inventory\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "order.item.received",
    name: "Item do Pedido Recebido",
    notificationType: "STOCK",
    eventType: "order.item.received",
    description: "Item do pedido marcado como recebido, aguardando conferência.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Item Recebido",
        body: "O item \"{{itemName}}\" do pedido #{{orderNumber}} ({{supplierName}}) foi recebido. Quantidade: {{quantity}} unidade(s).",
      },
      push: {
        title: "Item Recebido",
        body: "{{itemName}} ({{quantity}} unid.) recebido — pedido #{{orderNumber}}",
      },
      email: {
        subject: "Item Recebido - {{itemName}}",
        body: "Um item do pedido foi recebido.\n\nPedido: #{{orderNumber}}\nFornecedor: {{supplierName}}\nItem: {{itemName}}\nQuantidade recebida: {{quantity}} unidade(s)\n",
      },
      whatsapp: {
        body: "O item \"{{itemName}}\" do pedido #{{orderNumber}} ({{supplierName}}) foi recebido. Quantidade: {{quantity}} unidade(s).",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"order.item.received\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "order.overdue",
    name: "Pedido Atrasado/Vencendo",
    notificationType: "STOCK",
    eventType: "order.overdue",
    description: "Pedido de compra atrasado ou próximo do prazo previsto de entrega; requer cobrança do fornecedor.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: 2,
    deduplicationWindow: null,
    sectors: ["ADMIN", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Pedido Atrasado",
        body: "O pedido #{{orderNumber}} de {{supplierName}} está atrasado ou próximo do prazo previsto de entrega. Cobre o fornecedor.",
      },
      push: {
        title: "Pedido Atrasado",
        body: "Pedido #{{orderNumber}} ({{supplierName}}) — verificar prazo de entrega",
      },
      email: {
        subject: "Pedido Atrasado - #{{orderNumber}}",
        body: "O pedido está atrasado ou próximo do prazo previsto de entrega.\n\nPedido: #{{orderNumber}}\nFornecedor: {{supplierName}}\n{{#if itemsSummary}}Itens:{{itemsSummary}}\n{{/if}}",
      },
      whatsapp: {
        body: "O pedido #{{orderNumber}} de {{supplierName}} está atrasado ou próximo do prazo previsto de entrega. Cobre o fornecedor.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"order.overdue\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "order.payment.assigned",
    name: "Responsável pelo Pagamento Atribuído",
    notificationType: "STOCK",
    eventType: "order.payment.assigned",
    description: "Usuário definido como responsável pelo pagamento de um pedido (notificação direcionada ao responsável designado).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: [],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Pagamento Atribuído",
        body: "Você foi designado(a) como responsável pelo pagamento do pedido \"{{orderDescription}}\" ({{supplierName}}).",
      },
      push: {
        title: "Novo Pagamento Atribuído",
        body: "Pagamento do pedido \"{{orderDescription}}\" ({{supplierName}}) atribuído a você",
      },
      email: {
        subject: "Pagamento Atribuído - {{orderDescription}}",
        body: "Você foi designado(a) como responsável pelo pagamento do pedido \"{{orderDescription}}\" ({{supplierName}}).",
      },
      whatsapp: {
        body: "Você foi designado(a) como responsável pelo pagamento do pedido \"{{orderDescription}}\" ({{supplierName}}).",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"order.payment.assigned\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  {
    key: "order.payment.fulfilled",
    name: "Pagamento do Pedido Realizado",
    notificationType: "STOCK",
    eventType: "order.payment.fulfilled",
    description: "Pedido com responsável de pagamento marcado como pago (notificação direcionada a quem atribuiu a responsabilidade).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: [],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Pagamento Realizado",
        body: "O pedido \"{{orderDescription}}\" ({{supplierName}}) teve o pagamento marcado como realizado (responsável: {{paymentResponsible}}).",
      },
      push: {
        title: "Pagamento Concluído",
        body: "Pagamento do pedido \"{{orderDescription}}\" ({{supplierName}}) realizado",
      },
      email: {
        subject: "Pagamento Realizado - {{orderDescription}}",
        body: "O pedido \"{{orderDescription}}\" ({{supplierName}}) teve o pagamento marcado como realizado.\n\nResponsável: {{paymentResponsible}}",
      },
      whatsapp: {
        body: "O pedido \"{{orderDescription}}\" ({{supplierName}}) teve o pagamento marcado como realizado (responsável: {{paymentResponsible}}).",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"order.payment.fulfilled\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  {
    key: "order.status.changed",
    name: "Status do Pedido Alterado",
    notificationType: "STOCK",
    eventType: "order.status.changed",
    description: "Status de um pedido de compra alterado ao longo do fluxo de compra.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Status do Pedido Alterado",
        body: "O pedido #{{orderNumber}} de {{supplierName}} mudou de \"{{oldStatusLabel}}\" para \"{{newStatusLabel}}\".",
      },
      push: {
        title: "Pedido #{{orderNumber}}: {{newStatusLabel}}",
        body: "Pedido #{{orderNumber}} ({{supplierName}}) — agora {{newStatusLabel}}",
      },
      email: {
        subject: "Status do Pedido Alterado - #{{orderNumber}}",
        body: "O status do pedido foi alterado.\n\nPedido: #{{orderNumber}}\nFornecedor: {{supplierName}}\nStatus anterior: {{oldStatusLabel}}\nNovo status: {{newStatusLabel}}\n",
      },
      whatsapp: {
        body: "O pedido #{{orderNumber}} de {{supplierName}} mudou de \"{{oldStatusLabel}}\" para \"{{newStatusLabel}}\".",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"order.status.changed\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  // ─── order_schedule ──────────────────────────────────────────────────────────
  {
    key: "order_schedule.run.failed",
    name: "Agendamento de Pedido Falhou",
    notificationType: "STOCK",
    eventType: "order_schedule.run.failed",
    description: "Execução automática de um pedido agendado falhou (cron de agendamentos); requer reprocessamento do agendamento.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: true,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Agendamento de Pedido Falhou",
        body: "A execução automática do pedido agendado \"{{scheduleName}}\" falhou.{{#if errorMessage}} Erro: {{errorMessage}}.{{/if}} Reprocesse o agendamento.",
      },
      push: {
        title: "Agendamento de Pedido Falhou",
        body: "Agendamento \"{{scheduleName}}\" falhou — reprocessamento necessário",
      },
      whatsapp: {
        body: "A execução automática do pedido agendado \"{{scheduleName}}\" falhou.{{#if errorMessage}} Erro: {{errorMessage}}.{{/if}} Reprocesse o agendamento.",
      },
    },
    metadata: {
      trigger: "order-schedule.scheduler.ts ~:159-164,:222",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  // ─── paint ───────────────────────────────────────────────────────────────────
  {
    key: "paint.produced",
    name: "Tinta Produzida",
    notificationType: "PRODUCTION",
    eventType: "paint.produced",
    description: "Produção de tinta concluída e disponível para uso (notificação direcionada aos colaboradores com tarefas que usam a tinta).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Tinta Produzida",
        body: "A tinta \"{{paintName}}\"{{#if volumeLiters}} ({{volumeLiters}} L){{/if}} foi produzida e está disponível para a(s) tarefa(s): {{taskName}}.",
      },
      push: {
        title: "Tinta Produzida",
        body: "{{paintName}}{{#if volumeLiters}} — {{volumeLiters}} L{{/if}} disponível para {{taskName}}",
      },
      email: {
        subject: "Tinta Produzida - {{paintName}}",
        body: "A tinta foi produzida e está disponível para uso.\n\nTinta: {{paintName}}\n{{#if volumeLiters}}Volume: {{volumeLiters}} L\n{{/if}}Tarefa(s): {{taskName}}\n",
      },
      whatsapp: {
        body: "A tinta \"{{paintName}}\"{{#if volumeLiters}} ({{volumeLiters}} L){{/if}} foi produzida e está disponível para a(s) tarefa(s): {{taskName}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"paint.produced\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  // ─── payroll ─────────────────────────────────────────────────────────────────
  {
    key: "payroll.finalization.failed",
    name: "Falha na Finalização da Folha",
    notificationType: "SYSTEM",
    eventType: "payroll.finalization.failed",
    description: "Finalização mensal da folha e do bônus falhou (cron ou execução manual); requer reprocessamento.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "FINANCIAL", "HUMAN_RESOURCES"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Falha na Finalização da Folha",
        body: "A finalização de folha/bônus{{#if period}} do período {{period}}{{/if}} falhou.{{#if detail}} {{detail}}{{/if}} Reprocessamento necessário.",
      },
      push: {
        title: "Falha na Finalização da Folha",
        body: "Folha/bônus{{#if period}} ({{period}}){{/if}} — finalização falhou",
      },
      email: {
        subject: "Falha na finalização da folha",
        body: "A finalização de folha/bônus falhou.\n\n{{#if period}}Período: {{period}}\n{{/if}}{{#if detail}}Detalhe: {{detail}}\n\n{{/if}}Verifique o processamento no sistema.",
      },
      whatsapp: {
        body: "A finalização de folha/bônus{{#if period}} do período {{period}}{{/if}} falhou.{{#if detail}} {{detail}}{{/if}} Reprocessamento necessário.",
      },
    },
    metadata: {
      trigger: "bonus-cron.service.ts ~:83-87,:107-115",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "payroll.finalization.succeeded",
    name: "Folha Finalizada",
    notificationType: "SYSTEM",
    eventType: "payroll.finalization.succeeded",
    description: "Folha e bônus do período finalizados com sucesso (cron mensal ou execução manual).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "FINANCIAL", "HUMAN_RESOURCES"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Folha Finalizada",
        body: "A finalização de folha/bônus{{#if period}} do período {{period}}{{/if}} foi concluída com sucesso.{{#if detail}} {{detail}}{{/if}}",
      },
      push: {
        title: "Folha Finalizada",
        body: "Folha/bônus{{#if period}} ({{period}}){{/if}} — finalização concluída",
      },
      whatsapp: {
        body: "A finalização de folha/bônus{{#if period}} do período {{period}}{{/if}} foi concluída com sucesso.{{#if detail}} {{detail}}{{/if}}",
      },
    },
    metadata: {
      trigger: "personnel-department/bonus/bonus-cron.service.ts ~:104",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  // ─── ppe ─────────────────────────────────────────────────────────────────────
  {
    key: "ppe.approved",
    name: "Solicitação de EPI Aprovada",
    notificationType: "USER",
    eventType: "ppe.approved",
    description: "Solicitação de EPI aprovada; a entrega será programada (notificação direcionada ao solicitante).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: [],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "EPI Aprovado",
        body: "Sua solicitação de EPI ({{quantityLabel}}\"{{itemName}}\") foi aprovada. Aguarde a entrega.",
      },
      push: {
        title: "EPI Aprovado",
        body: "EPI aprovado: {{quantityLabel}}{{itemName}}",
      },
      email: {
        subject: "Solicitação de EPI Aprovada - {{itemName}}",
        body: "Sua solicitação de EPI foi aprovada.\n\nItem: {{itemName}}\n{{#if quantity}}Quantidade: {{quantity}}\n{{/if}}\nAguarde a entrega.",
      },
      whatsapp: {
        body: "Sua solicitação de EPI ({{quantityLabel}}\"{{itemName}}\") foi aprovada. Aguarde a entrega.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"ppe.approved\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  {
    key: "ppe.delivered",
    name: "EPI Entregue",
    notificationType: "USER",
    eventType: "ppe.delivered",
    description: "Entrega de EPI registrada (notificação direcionada ao colaborador que recebeu).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: [],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "EPI Entregue",
        body: "Entrega de EPI registrada para você: {{#if itemName}}{{quantityLabel}}\"{{itemName}}\"{{/if}}{{#if itemNames}}{{itemNames}}{{#if count}} ({{count}} itens){{/if}}{{/if}}. Retire no local indicado.",
      },
      push: {
        title: "EPI Entregue",
        body: "EPI entregue: {{#if itemName}}{{quantityLabel}}{{itemName}}{{/if}}{{#if itemNames}}{{itemNames}}{{/if}}",
      },
      email: {
        subject: "EPI Entregue",
        body: "Uma entrega de EPI foi registrada para você.\n\n{{#if itemName}}Item: {{itemName}}\n{{/if}}{{#if quantity}}Quantidade: {{quantity}}\n{{/if}}{{#if itemNames}}Itens: {{itemNames}}\n{{/if}}",
      },
      whatsapp: {
        body: "Entrega de EPI registrada para você: {{#if itemName}}{{quantityLabel}}\"{{itemName}}\"{{/if}}{{#if itemNames}}{{itemNames}}{{#if count}} ({{count}} itens){{/if}}{{/if}}. Retire no local indicado.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"ppe.delivered\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  {
    key: "ppe.rejected",
    name: "Solicitação de EPI Reprovada",
    notificationType: "USER",
    eventType: "ppe.rejected",
    description: "Solicitação de EPI reprovada (notificação direcionada ao solicitante).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: [],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "EPI Reprovado",
        body: "Sua solicitação do EPI \"{{itemName}}\" foi reprovada.",
      },
      push: {
        title: "EPI Reprovado",
        body: "Solicitação do EPI {{itemName}} reprovada",
      },
      email: {
        subject: "Solicitação de EPI Reprovada - {{itemName}}",
        body: "Sua solicitação de EPI foi reprovada.\n\nItem: {{itemName}}\n",
      },
      whatsapp: {
        body: "Sua solicitação do EPI \"{{itemName}}\" foi reprovada.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"ppe.rejected\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  {
    key: "ppe.requested",
    name: "Nova Solicitação de EPI",
    notificationType: "USER",
    eventType: "ppe.requested",
    description: "Nova solicitação de EPI registrada, aguardando aprovação ou reprovação.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Nova Solicitação de EPI",
        body: "Nova solicitação de EPI aguardando aprovação: {{quantityLabel}}\"{{itemName}}\".",
      },
      push: {
        title: "Solicitação de EPI",
        body: "EPI solicitado: {{quantityLabel}}{{itemName}}",
      },
      email: {
        subject: "Nova Solicitação de EPI - {{itemName}}",
        body: "Uma nova solicitação de EPI foi criada e aguarda aprovação.\n\nItem: {{itemName}}\n{{#if quantity}}Quantidade: {{quantity}}\n{{/if}}",
      },
      whatsapp: {
        body: "Nova solicitação de EPI aguardando aprovação: {{quantityLabel}}\"{{itemName}}\".",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"ppe.requested\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "ppe.signature_failed",
    name: "Falha na Assinatura de EPI",
    notificationType: "SYSTEM",
    eventType: "ppe.signature_failed",
    description: "Falha na assinatura digital do comprovante de entrega de EPI (auditoria de assinaturas); requer regularização do comprovante.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Falha na Assinatura de EPI",
        body: "A assinatura digital da entrega de EPI{{#if itemName}} \"{{itemName}}\"{{/if}} falhou. Regularize o comprovante.",
      },
      push: {
        title: "Falha na Assinatura de EPI",
        body: "Falha na assinatura digital de EPI{{#if itemName}} — {{itemName}}{{/if}}",
      },
      whatsapp: {
        body: "A assinatura digital da entrega de EPI{{#if itemName}} \"{{itemName}}\"{{/if}} falhou. Regularize o comprovante.",
      },
    },
    metadata: {
      trigger: "ppe-signature-audit.service.ts ~:45 (SIGNATURE_FAILED/PADES_FAILED)",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "ppe.signature_required",
    name: "Assinatura de EPI Necessária",
    notificationType: "USER",
    eventType: "ppe.signature_required",
    description: "EPI entregue aguardando assinatura digital do comprovante (notificação direcionada ao recebedor).",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: [],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "EPI Aguardando Assinatura",
        body: "A entrega do EPI \"{{itemName}}\"{{#if quantity}} ({{quantity}} unidade(s)){{/if}} aguarda sua assinatura digital.",
      },
      push: {
        title: "EPI Aguardando Assinatura",
        body: "{{itemName}} — assinatura digital pendente",
      },
      whatsapp: {
        body: "A entrega do EPI \"{{itemName}}\"{{#if quantity}} ({{quantity}} unidade(s)){{/if}} aguarda sua assinatura digital.",
      },
    },
    metadata: {
      trigger: "ppe-delivery.service.ts markAsDelivered->WAITING_SIGNATURE ~:1748",
      registry: "seed-notification-configs",
      targeted: true,
    },
  },
  // ─── questionnaire ───────────────────────────────────────────────────────────
  {
    key: "questionnaire.assigned",
    name: "Questionário Atribuído",
    notificationType: "USER",
    eventType: "questionnaire.assigned",
    description: "Questionário atribuído na abertura da campanha (notificação direcionada ao respondente designado).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: [],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Novo Questionário",
        body: "Você recebeu o questionário \"{{questionnaireName}}\". Responda dentro do prazo da campanha.",
      },
      push: {
        title: "Novo Questionário",
        body: "Questionário \"{{questionnaireName}}\" aguarda sua resposta",
      },
      whatsapp: {
        body: "Você recebeu o questionário \"{{questionnaireName}}\". Responda dentro do prazo da campanha.",
      },
    },
    metadata: {
      trigger: "questionnaire.service.ts openQuestionnaire ~:419",
      registry: "seed-notification-configs",
      targeted: true,
    },
  },
  {
    key: "questionnaire.closed",
    name: "Questionário Encerrado",
    notificationType: "GENERAL",
    eventType: "questionnaire.closed",
    description: "Campanha de questionário encerrada (manual ou por prazo); respostas fechadas para consulta (também direcionada ao criador da campanha).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Questionário Encerrado",
        body: "A campanha do questionário \"{{questionnaireName}}\" foi encerrada{{#if submittedCount}} com {{submittedCount}} resposta(s){{/if}}.",
      },
      push: {
        title: "Questionário Encerrado",
        body: "{{questionnaireName}} encerrado{{#if submittedCount}} — {{submittedCount}} resposta(s){{/if}}",
      },
      whatsapp: {
        body: "A campanha do questionário \"{{questionnaireName}}\" foi encerrada{{#if submittedCount}} com {{submittedCount}} resposta(s){{/if}}.",
      },
    },
    metadata: {
      trigger: "questionnaire.service.ts ~:432",
      registry: "seed-notification-configs",
      targeted: true,
    },
  },
  {
    key: "questionnaire.entry.submitted",
    name: "Resposta de Questionário Enviada",
    notificationType: "GENERAL",
    eventType: "questionnaire.entry.submitted",
    description: "Resposta de questionário enviada (suprimida automaticamente em campanhas anônimas; também direcionada ao criador da campanha).",
    enabled: true,
    importance: "LOW",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Resposta de Questionário",
        body: "O questionário \"{{questionnaireName}}\" recebeu uma nova resposta{{#if respondentName}} de {{respondentName}}{{/if}}.",
      },
      whatsapp: {
        body: "O questionário \"{{questionnaireName}}\" recebeu uma nova resposta{{#if respondentName}} de {{respondentName}}{{/if}}.",
      },
    },
    metadata: {
      trigger: "questionnaire.service.ts submitEntry ~:684",
      registry: "seed-notification-configs",
      targeted: true,
    },
  },
  {
    key: "questionnaire.reminder",
    name: "Lembrete de Questionário",
    notificationType: "USER",
    eventType: "questionnaire.reminder",
    description: "Lembrete periódico de questionário ainda não respondido dentro do prazo da campanha (notificação direcionada ao respondente).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: [],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Lembrete de Questionário",
        body: "Você ainda não respondeu o questionário \"{{questionnaireName}}\". Conclua antes do encerramento da campanha.",
      },
      push: {
        title: "Lembrete de Questionário",
        body: "Questionário \"{{questionnaireName}}\" ainda sem resposta",
      },
      whatsapp: {
        body: "Você ainda não respondeu o questionário \"{{questionnaireName}}\". Conclua antes do encerramento da campanha.",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: true,
    },
  },
  // ─── reconciliation ──────────────────────────────────────────────────────────
  {
    key: "reconciliation.run.failed",
    name: "Conciliação Falhou",
    notificationType: "SYSTEM",
    eventType: "reconciliation.run.failed",
    description: "Importação ou execução da conciliação bancária falhou; o arquivo OFX precisa ser reprocessado.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Conciliação Falhou",
        body: "A importação da conciliação bancária falhou.{{#if errorSummary}} {{errorSummary}}{{/if}} Reprocesse o arquivo OFX.",
      },
      push: {
        title: "Conciliação Falhou",
        body: "Falha na conciliação bancária — reprocessamento necessário",
      },
      email: {
        subject: "Conciliação falhou",
        body: "A importação da conciliação bancária falhou.\n\n{{#if errorSummary}}Resumo: {{errorSummary}}\n{{/if}}{{#if errorMessage}}Erro: {{errorMessage}}\n{{/if}}\nReprocesse o arquivo OFX no sistema.",
      },
      whatsapp: {
        body: "A importação da conciliação bancária falhou.{{#if errorSummary}} {{errorSummary}}{{/if}} Reprocesse o arquivo OFX.",
      },
    },
    metadata: {
      trigger: "reconciliation-import.service.ts ~:177-185",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "reconciliation.run.partial",
    name: "Conciliação Parcial",
    notificationType: "GENERAL",
    eventType: "reconciliation.run.partial",
    description: "Conciliação importada com pendências: arquivos com falha ou transações sem correspondência automática; requer revisão.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Conciliação Parcial",
        body: "Conciliação concluída com pendências: {{transactionsInserted}} transação(ões) importada(s), {{autoMatched}} conciliada(s) automaticamente{{#if unmatchedCount}}, {{unmatchedCount}} sem correspondência{{/if}}{{#if failedFiles}}, {{failedFiles}} arquivo(s) com falha{{/if}}. Revise as pendências.",
      },
      whatsapp: {
        body: "Conciliação concluída com pendências: {{transactionsInserted}} transação(ões) importada(s), {{autoMatched}} conciliada(s) automaticamente{{#if unmatchedCount}}, {{unmatchedCount}} sem correspondência{{/if}}{{#if failedFiles}}, {{failedFiles}} arquivo(s) com falha{{/if}}. Revise as pendências.",
      },
    },
    metadata: {
      trigger: "reconciliation-import.service.ts ~:161-175",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "payable.confirmation.stale",
    name: "Pagamentos Sem Conciliação",
    notificationType: "GENERAL",
    eventType: "payable.confirmation.stale",
    description: "Pagamentos marcados como pagos há mais de N dias (PAYABLE_CONFIRMATION_STALE_DAYS) que ainda não foram conciliados com nenhuma linha do extrato bancário; uma conta nunca realmente paga deixa de parecer idêntica a uma paga de verdade.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: 1,
    deduplicationWindow: null,
    sectors: ["ADMIN", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Pagamentos sem conciliação",
        body: "{{staleCount}} pagamento(s) marcado(s) como pago(s) há mais de {{staleDays}} dias ainda não foram conciliados com o extrato bancário. Importe o OFX ou revise as baixas.",
      },
      whatsapp: {
        body: "{{staleCount}} pagamento(s) marcado(s) como pago(s) há mais de {{staleDays}} dias ainda não foram conciliados com o extrato bancário.",
      },
    },
    metadata: {
      trigger: "reconciliation.scheduler.ts runStalePaidAging @Cron('0 5 * * *')",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  // ─── secullum ────────────────────────────────────────────────────────────────
  {
    key: "secullum.absence.unjustified",
    name: "Ausência Não Justificada",
    notificationType: "SYSTEM",
    eventType: "secullum.absence.unjustified",
    description: "Ausência sem justificativa detectada na varredura diária da Secullum (dia anterior; notificação direcionada ao colaborador ausente).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: true,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "BASIC", "COMMERCIAL", "DESIGNER", "EXTERNAL", "FINANCIAL", "HUMAN_RESOURCES", "LOGISTIC", "MAINTENANCE", "PLOTTING", "PRODUCTION", "PRODUCTION_MANAGER", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Ausência Não Justificada",
        body: "Ausência sem justificativa detectada em {{date}}{{#if userName}} para {{userName}}{{/if}}.",
      },
      push: {
        title: "Ausência Não Justificada",
        body: "Ausência sem justificativa em {{date}}{{#if userName}} — {{userName}}{{/if}}",
      },
      whatsapp: {
        body: "Ausência sem justificativa detectada em {{date}}{{#if userName}} para {{userName}}{{/if}}.",
      },
    },
    metadata: {
      trigger: "secullum.service.ts ~:1657 (novo cron diário)",
      registry: "seed-notification-configs",
      targeted: true,
    },
  },
  {
    key: "secullum.health.failed",
    name: "Healthcheck Secullum Falhou",
    notificationType: "SYSTEM",
    eventType: "secullum.health.failed",
    description: "Healthcheck ou credenciais da integração Secullum falhando; o ponto eletrônico fica indisponível até a regularização.",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Falha de Conexão Secullum",
        body: "O healthcheck da integração Secullum falhou.{{#if error}} {{error}}{{/if}} Verifique as credenciais.",
      },
      email: {
        subject: "URGENTE: integração Secullum indisponível",
        body: "O healthcheck da integração Secullum está falhando.\n\n{{#if error}}Erro: {{error}}\n\n{{/if}}Verifique as credenciais e a disponibilidade do serviço.",
      },
      whatsapp: {
        body: "O healthcheck da integração Secullum falhou.{{#if error}} {{error}}{{/if}} Verifique as credenciais.",
      },
    },
    metadata: {
      trigger: "secullum.service.ts ~:343-376,:2175",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "secullum.diagnostic.completed",
    name: "Diagnóstico Secullum (Resultado Diário)",
    notificationType: "SYSTEM",
    eventType: "secullum.diagnostic.completed",
    description: "Resultado diário do diagnóstico automático da integração Secullum — todos os endpoints (criar/editar/excluir, batidas, afastamentos, solicitações, inclusão, fechamento) são testados às 06:00 e o resumo ✓/✗ é enviado.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Diagnóstico Secullum: {{status}}",
        body: "{{passCount}} OK, {{failCount}} falhas, {{skipCount}} ignorados.{{#if failedLabels}} Falharam: {{failedLabels}}.{{/if}}",
      },
      email: {
        subject: "Diagnóstico Secullum: {{status}}",
        body: "Resultado do diagnóstico automático da integração Secullum.\n\n{{passCount}} OK, {{failCount}} falhas, {{skipCount}} ignorados.\n{{#if failedLabels}}\nVerificações que falharam: {{failedLabels}}\n{{/if}}\nAbra Integração Secullum > Diagnóstico para detalhes.",
      },
      whatsapp: {
        body: "Diagnóstico Secullum: {{status}}. {{passCount}} OK, {{failCount}} falhas, {{skipCount}} ignorados.{{#if failedLabels}} Falharam: {{failedLabels}}.{{/if}}",
      },
    },
    metadata: {
      trigger: "integrations/secullum/smoke-test/smoke-test.service.ts (dispatchDailyResult; cron 06:00 BRT)",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "secullum.payroll.dataDegraded",
    name: "Dados de Folha Degradados",
    notificationType: "SYSTEM",
    eventType: "secullum.payroll.dataDegraded",
    description: "Dados de folha degradados ou indisponíveis na integração Secullum durante o cálculo de folha e bônus.",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Dados de Folha Degradados",
        body: "Os dados de folha da integração Secullum estão degradados ou indisponíveis{{#if month}} ({{month}}/{{year}}){{/if}}.{{#if reason}} {{reason}}{{/if}}",
      },
      email: {
        subject: "URGENTE: dados de folha degradados",
        body: "Os dados de folha provenientes da integração Secullum estão degradados ou indisponíveis.\n\n{{#if month}}Período: {{month}}/{{year}}\n{{/if}}{{#if reason}}Detalhe: {{reason}}\n\n{{/if}}O cálculo de folha/bônus pode estar comprometido.",
      },
      whatsapp: {
        body: "Os dados de folha da integração Secullum estão degradados ou indisponíveis{{#if month}} ({{month}}/{{year}}){{/if}}.{{#if reason}} {{reason}}{{/if}}",
      },
    },
    metadata: {
      trigger: "personnel-department/bonus/secullum-bonus-integration.service.ts ~:144,:210; payroll/services/secullum-payroll-integration.service.ts ~:116",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "secullum.period.closed",
    name: "Período de Apuração Fechado",
    notificationType: "SYSTEM",
    eventType: "secullum.period.closed",
    description: "Período de apuração do ponto encerrado na Secullum; libera o fechamento da folha.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["FINANCIAL", "HUMAN_RESOURCES"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Período de Apuração Fechado",
        body: "O período de apuração do ponto foi encerrado em {{date}}. A folha pode ser fechada.",
      },
      whatsapp: {
        body: "O período de apuração do ponto foi encerrado em {{date}}. A folha pode ser fechada.",
      },
    },
    metadata: {
      trigger: "integrations/secullum/secullum-cadastros.service.ts ~:190",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "secullum.request.adjustment.created",
    name: "Ajuste de Ponto Solicitado",
    notificationType: "USER",
    eventType: "secullum.request.adjustment.created",
    description: "Colaborador solicitou ajuste de marcação de ponto na Secullum, aguardando análise.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: true,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ajuste de Ponto",
        body: "Nova solicitação de ajuste de ponto de {{employeeName}} para o dia {{date}}, aguardando análise.{{#if observacoes}} Observações: {{observacoes}}.{{/if}}",
      },
      push: {
        title: "Ajuste de Ponto",
        body: "Ajuste de ponto: {{employeeName}} — {{date}}, aguardando análise",
      },
      whatsapp: {
        body: "Nova solicitação de ajuste de ponto de {{employeeName}} para o dia {{date}}, aguardando análise.{{#if observacoes}} Observações: {{observacoes}}.{{/if}}",
      },
    },
    metadata: {
      trigger: "secullum.service.ts ~:4380,:4779",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "secullum.request.approved",
    name: "Solicitação de Ponto Aprovada",
    notificationType: "USER",
    eventType: "secullum.request.approved",
    description: "Solicitação de ponto aprovada na Secullum (notificação direcionada ao solicitante).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["HUMAN_RESOURCES"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Solicitação de Ponto Aprovada",
        body: "Sua solicitação de ponto foi aprovada e a marcação será atualizada.",
      },
      push: {
        title: "Solicitação Aprovada",
        body: "Sua solicitação de ponto foi aprovada",
      },
      whatsapp: {
        body: "Sua solicitação de ponto foi aprovada e a marcação será atualizada.",
      },
    },
    metadata: {
      trigger: "secullum.service.ts ~:2895",
      registry: "seed-notification-configs",
      targeted: true,
    },
  },
  {
    key: "secullum.request.justifyAbsence.created",
    name: "Justificativa de Ausência Solicitada",
    notificationType: "USER",
    eventType: "secullum.request.justifyAbsence.created",
    description: "Colaborador criou solicitação de justificativa de ausência na Secullum, aguardando análise.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Justificativa de Ausência",
        body: "Nova solicitação de justificativa de ausência de {{employeeName}} para o dia {{date}}, aguardando análise.{{#if observacoes}} Observações: {{observacoes}}.{{/if}}",
      },
      push: {
        title: "Justificativa de Ausência",
        body: "Justificativa de ausência: {{employeeName}} — {{date}}, aguardando análise",
      },
      email: {
        subject: "Nova justificativa de ausência — {{employeeName}}",
        body: "Uma solicitação de justificativa de ausência foi criada.\n\nFuncionário: {{employeeName}}\nData: {{date}}\n{{#if observacoes}}Observações: {{observacoes}}\n{{/if}}\nAcesse o sistema para analisar.",
      },
      whatsapp: {
        body: "Nova solicitação de justificativa de ausência de {{employeeName}} para o dia {{date}}, aguardando análise.{{#if observacoes}} Observações: {{observacoes}}.{{/if}}",
      },
    },
    metadata: {
      trigger: "integrations/secullum/secullum.service.ts ~:4291",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "secullum.request.punchInclusion.created",
    name: "Inclusão de Marcação Solicitada",
    notificationType: "USER",
    eventType: "secullum.request.punchInclusion.created",
    description: "Colaborador solicitou inclusão de marcação de ponto na Secullum, aguardando análise.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Inclusão de Marcação",
        body: "Nova solicitação de inclusão de marcação de ponto de {{employeeName}}, aguardando análise.{{#if justificativa}} Justificativa: {{justificativa}}.{{/if}}",
      },
      push: {
        title: "Inclusão de Marcação",
        body: "Inclusão de marcação: {{employeeName}}, aguardando análise",
      },
      whatsapp: {
        body: "Nova solicitação de inclusão de marcação de ponto de {{employeeName}}, aguardando análise.{{#if justificativa}} Justificativa: {{justificativa}}.{{/if}}",
      },
    },
    metadata: {
      trigger: "secullum.service.ts ~:4994",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "secullum.request.rejected",
    name: "Solicitação de Ponto Rejeitada",
    notificationType: "USER",
    eventType: "secullum.request.rejected",
    description: "Solicitação de ponto rejeitada na Secullum, com motivo (notificação direcionada ao solicitante).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["HUMAN_RESOURCES"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Solicitação de Ponto Rejeitada",
        body: "Sua solicitação de ponto foi rejeitada.{{#if motivo}} Motivo: {{motivo}}.{{/if}}",
      },
      push: {
        title: "Solicitação Rejeitada",
        body: "Solicitação de ponto rejeitada{{#if motivo}} — {{motivo}}{{/if}}",
      },
      email: {
        subject: "Solicitação de ponto rejeitada",
        body: "Sua solicitação de ponto foi rejeitada.\n\n{{#if motivo}}Motivo: {{motivo}}\n\n{{/if}}Procure o RH em caso de dúvidas.",
      },
      whatsapp: {
        body: "Sua solicitação de ponto foi rejeitada.{{#if motivo}} Motivo: {{motivo}}.{{/if}}",
      },
    },
    metadata: {
      trigger: "secullum.service.ts ~:2943",
      registry: "seed-notification-configs",
      targeted: true,
    },
  },
  {
    key: "secullum.signature.ready",
    name: "Cartão-Ponto Pronto para Assinatura",
    notificationType: "USER",
    eventType: "secullum.signature.ready",
    description: "Cartão-ponto do período disponível para assinatura digital (notificação direcionada ao colaborador do cartão).",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "BASIC", "COMMERCIAL", "DESIGNER", "EXTERNAL", "FINANCIAL", "HUMAN_RESOURCES", "LOGISTIC", "MAINTENANCE", "PLOTTING", "PRODUCTION", "PRODUCTION_MANAGER", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Cartão-Ponto para Assinatura",
        body: "Seu cartão-ponto está disponível para assinatura digital. Revise as marcações e assine.",
      },
      push: {
        title: "Cartão-Ponto para Assinatura",
        body: "Seu cartão-ponto aguarda assinatura digital",
      },
      email: {
        subject: "Cartão-ponto pronto para assinatura",
        body: "Seu cartão-ponto está disponível para assinatura digital.\n\nAcesse o sistema para revisar e assinar.",
      },
      whatsapp: {
        body: "Seu cartão-ponto está disponível para assinatura digital. Revise as marcações e assine.",
      },
    },
    metadata: {
      trigger: "secullum.service.ts ~:3341,:3647",
      registry: "seed-notification-configs",
      targeted: true,
    },
  },
  {
    key: "secullum.signature.rejected",
    name: "Cartão-Ponto Rejeitado",
    notificationType: "SYSTEM",
    eventType: "secullum.signature.rejected",
    description: "Colaborador rejeitou o cartão-ponto do período, com justificativa, pelo app Ankaa.",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["HUMAN_RESOURCES"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Cartão-Ponto Rejeitado",
        body: "{{employeeName}} rejeitou o cartão-ponto do período {{period}}.{{#if response}} Resposta: {{response}}{{/if}}",
      },
      push: {
        title: "Cartão-Ponto Rejeitado",
        body: "{{employeeName}} rejeitou o cartão-ponto",
      },
      email: {
        subject: "Cartão-ponto rejeitado — {{employeeName}}",
        body: "O funcionário {{employeeName}} rejeitou o cartão-ponto do período {{period}}.\n\n{{#if response}}Resposta: {{response}}\n\n{{/if}}Verifique a apuração no sistema.",
      },
      whatsapp: {
        body: "{{employeeName}} rejeitou o cartão-ponto do período {{period}}.{{#if response}} Resposta: {{response}}{{/if}}",
      },
    },
    metadata: {
      trigger: "secullum.service.ts rejectApuracaoAsFuncionario → notifyHrApuracaoDecision (employee rejects via Ankaa app)",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "secullum.signature.signed",
    name: "Cartão-Ponto Assinado",
    notificationType: "SYSTEM",
    eventType: "secullum.signature.signed",
    description: "Colaborador assinou o cartão-ponto do período pelo app Ankaa.",
    enabled: true,
    importance: "LOW",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["HUMAN_RESOURCES"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Cartão-Ponto Assinado",
        body: "{{employeeName}} assinou o cartão-ponto do período {{period}}.",
      },
      whatsapp: {
        body: "{{employeeName}} assinou o cartão-ponto do período {{period}}.",
      },
    },
    metadata: {
      trigger: "secullum.service.ts approveApuracaoAsFuncionario → notifyHrApuracaoDecision (employee signs via Ankaa app)",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "secullum.sync.conflict",
    name: "Conflito de Sincronização Secullum",
    notificationType: "SYSTEM",
    eventType: "secullum.sync.conflict",
    description: "Conflito de dados ao sincronizar funcionários com a Secullum; requer resolução manual.",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Conflito de Sincronização",
        body: "Foram detectados {{conflicts}} conflito(s) de vínculo na sincronização com a Secullum.{{#if sample}} Ex.: {{sample}}.{{/if}} Resolução manual necessária.",
      },
      whatsapp: {
        body: "Foram detectados {{conflicts}} conflito(s) de vínculo na sincronização com a Secullum.{{#if sample}} Ex.: {{sample}}.{{/if}} Resolução manual necessária.",
      },
    },
    metadata: {
      trigger: "user-secullum-sync.service.ts ~:362,:516",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "secullum.sync.failed",
    name: "Falha na Sincronização Secullum",
    notificationType: "SYSTEM",
    eventType: "secullum.sync.failed",
    description: "Falha na rotina de sincronização de funcionários com a Secullum.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Falha na Sincronização Secullum",
        body: "A sincronização de funcionários com a Secullum falhou{{#if userName}} (funcionário: {{userName}}){{/if}}.{{#if error}} Erro: {{error}}.{{/if}}",
      },
      email: {
        subject: "Falha na sincronização Secullum",
        body: "A sincronização de funcionários com a Secullum falhou.\n\n{{#if userName}}Funcionário: {{userName}}\n{{/if}}{{#if error}}Erro: {{error}}\n\n{{/if}}Verifique a integração no sistema.",
      },
      whatsapp: {
        body: "A sincronização de funcionários com a Secullum falhou{{#if userName}} (funcionário: {{userName}}){{/if}}.{{#if error}} Erro: {{error}}.{{/if}}",
      },
    },
    metadata: {
      trigger: "integrations/secullum/user-secullum-sync.service.ts ~:133,:259",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  // ─── service_order ───────────────────────────────────────────────────────────
  {
    key: "service_order.assigned.artwork",
    name: "Ordem de Serviço de Arte Atribuída",
    notificationType: "PRODUCTION",
    eventType: "service_order.assigned.artwork",
    description: "Ordem de serviço de arte atribuída a um responsável (notificação direcionada ao designado).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Arte Atribuída a Você",
        body: "Você foi atribuído(a) como responsável pela ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}}.",
      },
      push: {
        title: "Ordem de Serviço de Arte Atribuída",
        body: "Ordem de arte atribuída a você: {{description}}",
      },
      email: {
        subject: "Ordem de Serviço de Arte Atribuída a Você{{#if taskName}} - {{taskName}}{{/if}}",
        body: "Você foi atribuído(a) como responsável por uma ordem de serviço de arte.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "Você foi atribuído(a) como responsável pela ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.assigned.artwork\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  {
    key: "service_order.assigned.commercial",
    name: "Ordem de Serviço Comercial Atribuída",
    notificationType: "PRODUCTION",
    eventType: "service_order.assigned.commercial",
    description: "Ordem de serviço comercial atribuída a um responsável (notificação direcionada ao designado).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço Comercial Atribuída a Você",
        body: "Você foi atribuído(a) como responsável pela ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}}.",
      },
      push: {
        title: "Ordem de Serviço Comercial Atribuída",
        body: "Ordem comercial atribuída a você: {{description}}",
      },
      email: {
        subject: "Ordem de Serviço Comercial Atribuída a Você{{#if taskName}} - {{taskName}}{{/if}}",
        body: "Você foi atribuído(a) como responsável por uma ordem de serviço comercial.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "Você foi atribuído(a) como responsável pela ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.assigned.commercial\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  {
    key: "service_order.assigned.logistic",
    name: "Ordem de Serviço de Logística Atribuída",
    notificationType: "PRODUCTION",
    eventType: "service_order.assigned.logistic",
    description: "Ordem de serviço de logística atribuída a um responsável (notificação direcionada ao designado).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Logística Atribuída a Você",
        body: "Você foi atribuído(a) como responsável pela ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}}.",
      },
      push: {
        title: "Ordem de Serviço de Logística Atribuída",
        body: "Ordem de logística atribuída a você: {{description}}",
      },
      email: {
        subject: "Ordem de Serviço de Logística Atribuída a Você{{#if taskName}} - {{taskName}}{{/if}}",
        body: "Você foi atribuído(a) como responsável por uma ordem de serviço de logística.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "Você foi atribuído(a) como responsável pela ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.assigned.logistic\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  {
    key: "service_order.assigned.production",
    name: "Ordem de Serviço de Produção Atribuída",
    notificationType: "PRODUCTION",
    eventType: "service_order.assigned.production",
    description: "Ordem de serviço de produção atribuída a um responsável (notificação direcionada ao designado).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Produção Atribuída a Você",
        body: "Você foi atribuído(a) como responsável pela ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}}.",
      },
      push: {
        title: "Ordem de Serviço de Produção Atribuída",
        body: "Ordem de produção atribuída a você: {{description}}",
      },
      email: {
        subject: "Ordem de Serviço de Produção Atribuída a Você{{#if taskName}} - {{taskName}}{{/if}}",
        body: "Você foi atribuído(a) como responsável por uma ordem de serviço de produção.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "Você foi atribuído(a) como responsável pela ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.assigned.production\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  {
    key: "service_order.cancelled.artwork",
    name: "Ordem de Serviço de Arte Cancelada",
    notificationType: "PRODUCTION",
    eventType: "service_order.cancelled.artwork",
    description: "Ordem de serviço de arte cancelada antes da conclusão (transição de status).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Arte Cancelada",
        body: "A ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi cancelada e não deve mais ser executada.",
      },
      push: {
        title: "Ordem de Serviço de Arte Cancelada",
        body: "Ordem de arte cancelada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Arte Cancelada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de arte foi cancelada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi cancelada e não deve mais ser executada.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.cancelled.artwork\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.cancelled.commercial",
    name: "Ordem de Serviço Comercial Cancelada",
    notificationType: "PRODUCTION",
    eventType: "service_order.cancelled.commercial",
    description: "Ordem de serviço comercial cancelada antes da conclusão (transição de status).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço Comercial Cancelada",
        body: "A ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi cancelada e não deve mais ser executada.",
      },
      push: {
        title: "Ordem de Serviço Comercial Cancelada",
        body: "Ordem comercial cancelada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço Comercial Cancelada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço comercial foi cancelada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi cancelada e não deve mais ser executada.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.cancelled.commercial\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.cancelled.logistic",
    name: "Ordem de Serviço de Logística Cancelada",
    notificationType: "PRODUCTION",
    eventType: "service_order.cancelled.logistic",
    description: "Ordem de serviço de logística cancelada antes da conclusão (transição de status).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Logística Cancelada",
        body: "A ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi cancelada e não deve mais ser executada.",
      },
      push: {
        title: "Ordem de Serviço de Logística Cancelada",
        body: "Ordem de logística cancelada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Logística Cancelada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de logística foi cancelada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi cancelada e não deve mais ser executada.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.cancelled.logistic\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.cancelled.production",
    name: "Ordem de Serviço de Produção Cancelada",
    notificationType: "PRODUCTION",
    eventType: "service_order.cancelled.production",
    description: "Ordem de serviço de produção cancelada antes da conclusão (transição de status).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Produção Cancelada",
        body: "A ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi cancelada e não deve mais ser executada.",
      },
      push: {
        title: "Ordem de Serviço de Produção Cancelada",
        body: "Ordem de produção cancelada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Produção Cancelada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de produção foi cancelada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi cancelada e não deve mais ser executada.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.cancelled.production\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.completed.artwork",
    name: "Ordem de Serviço de Arte Concluída",
    notificationType: "PRODUCTION",
    eventType: "service_order.completed.artwork",
    description: "Ordem de serviço de arte concluída (transição de status para Concluída).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Arte Concluída",
        body: "A ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi concluída.",
      },
      push: {
        title: "Ordem de Serviço de Arte Concluída",
        body: "Ordem de arte concluída: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Arte Concluída{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de arte foi concluída.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi concluída.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.completed.artwork\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.completed.commercial",
    name: "Ordem de Serviço Comercial Concluída",
    notificationType: "PRODUCTION",
    eventType: "service_order.completed.commercial",
    description: "Ordem de serviço comercial concluída (transição de status para Concluída).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço Comercial Concluída",
        body: "A ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi concluída.",
      },
      push: {
        title: "Ordem de Serviço Comercial Concluída",
        body: "Ordem comercial concluída: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço Comercial Concluída{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço comercial foi concluída.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi concluída.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.completed.commercial\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.completed.logistic",
    name: "Ordem de Serviço de Logística Concluída",
    notificationType: "PRODUCTION",
    eventType: "service_order.completed.logistic",
    description: "Ordem de serviço de logística concluída (transição de status para Concluída).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Logística Concluída",
        body: "A ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi concluída.",
      },
      push: {
        title: "Ordem de Serviço de Logística Concluída",
        body: "Ordem de logística concluída: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Logística Concluída{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de logística foi concluída.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi concluída.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.completed.logistic\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.completed.production",
    name: "Ordem de Serviço de Produção Concluída",
    notificationType: "PRODUCTION",
    eventType: "service_order.completed.production",
    description: "Ordem de serviço de produção concluída (transição de status para Concluída).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Produção Concluída",
        body: "A ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi concluída.",
      },
      push: {
        title: "Ordem de Serviço de Produção Concluída",
        body: "Ordem de produção concluída: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Produção Concluída{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de produção foi concluída.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi concluída.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.completed.production\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.created.artwork",
    name: "Ordem de Serviço de Arte Criada",
    notificationType: "PRODUCTION",
    eventType: "service_order.created.artwork",
    description: "Nova ordem de serviço de arte criada em uma tarefa, aguardando execução.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Nova Ordem de Serviço de Arte",
        body: "Nova ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} criada, aguardando execução.",
      },
      push: {
        title: "Nova Ordem de Serviço de Arte",
        body: "Nova ordem de arte: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Nova Ordem de Serviço de Arte{{#if taskName}} - {{taskName}}{{/if}}",
        body: "Uma nova ordem de serviço de arte foi criada e aguarda execução.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "Nova ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} criada, aguardando execução.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.created.artwork\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.created.commercial",
    name: "Ordem de Serviço Comercial Criada",
    notificationType: "PRODUCTION",
    eventType: "service_order.created.commercial",
    description: "Nova ordem de serviço comercial criada em uma tarefa, aguardando execução.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Nova Ordem de Serviço Comercial",
        body: "Nova ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} criada, aguardando execução.",
      },
      push: {
        title: "Nova Ordem de Serviço Comercial",
        body: "Nova ordem comercial: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Nova Ordem de Serviço Comercial{{#if taskName}} - {{taskName}}{{/if}}",
        body: "Uma nova ordem de serviço comercial foi criada e aguarda execução.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "Nova ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} criada, aguardando execução.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.created.commercial\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.created.logistic",
    name: "Ordem de Serviço de Logística Criada",
    notificationType: "PRODUCTION",
    eventType: "service_order.created.logistic",
    description: "Nova ordem de serviço de logística criada em uma tarefa, aguardando execução.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Nova Ordem de Serviço de Logística",
        body: "Nova ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} criada, aguardando execução.",
      },
      push: {
        title: "Nova Ordem de Serviço de Logística",
        body: "Nova ordem de logística: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Nova Ordem de Serviço de Logística{{#if taskName}} - {{taskName}}{{/if}}",
        body: "Uma nova ordem de serviço de logística foi criada e aguarda execução.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "Nova ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} criada, aguardando execução.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.created.logistic\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.created.production",
    name: "Ordem de Serviço de Produção Criada",
    notificationType: "PRODUCTION",
    eventType: "service_order.created.production",
    description: "Nova ordem de serviço de produção criada em uma tarefa, aguardando execução.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Nova Ordem de Serviço de Produção",
        body: "Nova ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} criada, aguardando execução.",
      },
      push: {
        title: "Nova Ordem de Serviço de Produção",
        body: "Nova ordem de produção: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Nova Ordem de Serviço de Produção{{#if taskName}} - {{taskName}}{{/if}}",
        body: "Uma nova ordem de serviço de produção foi criada e aguarda execução.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "Nova ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} criada, aguardando execução.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.created.production\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.observation_changed.artwork",
    name: "Observação da Ordem de Serviço de Arte Alterada",
    notificationType: "PRODUCTION",
    eventType: "service_order.observation_changed.artwork",
    description: "Observação da ordem de serviço de arte adicionada ou alterada (nova orientação registrada na ordem).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Observação da Ordem de Serviço de Arte Alterada",
        body: "A observação da ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi atualizada.{{#if newObservation}} Nova observação: {{newObservation}}{{/if}}",
      },
      push: {
        title: "Ordem de Serviço de Arte: Observação",
        body: "Observação atualizada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Observação da Ordem de Serviço de Arte Alterada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A observação da ordem de serviço de arte foi atualizada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}{{#if newObservation}}Nova observação:\n{{newObservation}}\n{{/if}}",
      },
      whatsapp: {
        body: "A observação da ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi atualizada.{{#if newObservation}} Nova observação: {{newObservation}}{{/if}}",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.observation_changed.artwork\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.observation_changed.commercial",
    name: "Observação da Ordem de Serviço Comercial Alterada",
    notificationType: "PRODUCTION",
    eventType: "service_order.observation_changed.commercial",
    description: "Observação da ordem de serviço comercial adicionada ou alterada (nova orientação registrada na ordem).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Observação da Ordem de Serviço Comercial Alterada",
        body: "A observação da ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi atualizada.{{#if newObservation}} Nova observação: {{newObservation}}{{/if}}",
      },
      push: {
        title: "Ordem de Serviço Comercial: Observação",
        body: "Observação atualizada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Observação da Ordem de Serviço Comercial Alterada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A observação da ordem de serviço comercial foi atualizada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}{{#if newObservation}}Nova observação:\n{{newObservation}}\n{{/if}}",
      },
      whatsapp: {
        body: "A observação da ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi atualizada.{{#if newObservation}} Nova observação: {{newObservation}}{{/if}}",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.observation_changed.commercial\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.observation_changed.logistic",
    name: "Observação da Ordem de Serviço de Logística Alterada",
    notificationType: "PRODUCTION",
    eventType: "service_order.observation_changed.logistic",
    description: "Observação da ordem de serviço de logística adicionada ou alterada (nova orientação registrada na ordem).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Observação da Ordem de Serviço de Logística Alterada",
        body: "A observação da ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi atualizada.{{#if newObservation}} Nova observação: {{newObservation}}{{/if}}",
      },
      push: {
        title: "Ordem de Serviço de Logística: Observação",
        body: "Observação atualizada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Observação da Ordem de Serviço de Logística Alterada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A observação da ordem de serviço de logística foi atualizada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}{{#if newObservation}}Nova observação:\n{{newObservation}}\n{{/if}}",
      },
      whatsapp: {
        body: "A observação da ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi atualizada.{{#if newObservation}} Nova observação: {{newObservation}}{{/if}}",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.observation_changed.logistic\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.observation_changed.production",
    name: "Observação da Ordem de Serviço de Produção Alterada",
    notificationType: "PRODUCTION",
    eventType: "service_order.observation_changed.production",
    description: "Observação da ordem de serviço de produção adicionada ou alterada (nova orientação registrada na ordem).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Observação da Ordem de Serviço de Produção Alterada",
        body: "A observação da ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi atualizada.{{#if newObservation}} Nova observação: {{newObservation}}{{/if}}",
      },
      push: {
        title: "Ordem de Serviço de Produção: Observação",
        body: "Observação atualizada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Observação da Ordem de Serviço de Produção Alterada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A observação da ordem de serviço de produção foi atualizada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}{{#if newObservation}}Nova observação:\n{{newObservation}}\n{{/if}}",
      },
      whatsapp: {
        body: "A observação da ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi atualizada.{{#if newObservation}} Nova observação: {{newObservation}}{{/if}}",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.observation_changed.production\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.paused.artwork",
    name: "Ordem de Serviço de Arte Pausada",
    notificationType: "PRODUCTION",
    eventType: "service_order.paused.artwork",
    description: "Ordem de serviço de arte pausada (execução interrompida temporariamente).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Arte Pausada",
        body: "A ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi pausada (execução interrompida temporariamente).",
      },
      push: {
        title: "Ordem de Serviço de Arte Pausada",
        body: "Ordem de arte pausada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Arte Pausada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de arte foi pausada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi pausada (execução interrompida temporariamente).",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "service-order.service.ts (transição de status da Ordem de Serviço — espelha service_order.started.*)",
      targeted: false,
    },
  },
  {
    key: "service_order.paused.commercial",
    name: "Ordem de Serviço Comercial Pausada",
    notificationType: "PRODUCTION",
    eventType: "service_order.paused.commercial",
    description: "Ordem de serviço comercial pausada (execução interrompida temporariamente).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço Comercial Pausada",
        body: "A ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi pausada (execução interrompida temporariamente).",
      },
      push: {
        title: "Ordem de Serviço Comercial Pausada",
        body: "Ordem comercial pausada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço Comercial Pausada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço comercial foi pausada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi pausada (execução interrompida temporariamente).",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "service-order.service.ts (transição de status da Ordem de Serviço — espelha service_order.started.*)",
      targeted: false,
    },
  },
  {
    key: "service_order.paused.logistic",
    name: "Ordem de Serviço de Logística Pausada",
    notificationType: "PRODUCTION",
    eventType: "service_order.paused.logistic",
    description: "Ordem de serviço de logística pausada (execução interrompida temporariamente).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Logística Pausada",
        body: "A ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi pausada (execução interrompida temporariamente).",
      },
      push: {
        title: "Ordem de Serviço de Logística Pausada",
        body: "Ordem de logística pausada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Logística Pausada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de logística foi pausada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi pausada (execução interrompida temporariamente).",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "service-order.service.ts (transição de status da Ordem de Serviço — espelha service_order.started.*)",
      targeted: false,
    },
  },
  {
    key: "service_order.paused.production",
    name: "Ordem de Serviço de Produção Pausada",
    notificationType: "PRODUCTION",
    eventType: "service_order.paused.production",
    description: "Ordem de serviço de produção pausada (execução interrompida temporariamente).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Produção Pausada",
        body: "A ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi pausada (execução interrompida temporariamente).",
      },
      push: {
        title: "Ordem de Serviço de Produção Pausada",
        body: "Ordem de produção pausada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Produção Pausada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de produção foi pausada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi pausada (execução interrompida temporariamente).",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "service-order.service.ts (transição de status da Ordem de Serviço — espelha service_order.started.*)",
      targeted: false,
    },
  },
  {
    key: "service_order.pending.artwork",
    name: "Ordem de Serviço de Arte Revertida para Pendente",
    notificationType: "PRODUCTION",
    eventType: "service_order.pending.artwork",
    description: "Ordem de serviço de arte voltou ao status pendente (reversão a partir de outro status).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Arte Revertida para Pendente",
        body: "A ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} voltou para o status pendente.",
      },
      push: {
        title: "Ordem de Serviço de Arte Revertida para Pendente",
        body: "Ordem de arte pendente novamente: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Arte Revertida para Pendente{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de arte voltou para o status pendente.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} voltou para o status pendente.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "service-order.service.ts (transição de status da Ordem de Serviço — espelha service_order.started.*)",
      targeted: false,
    },
  },
  {
    key: "service_order.pending.commercial",
    name: "Ordem de Serviço Comercial Revertida para Pendente",
    notificationType: "PRODUCTION",
    eventType: "service_order.pending.commercial",
    description: "Ordem de serviço comercial voltou ao status pendente (reversão a partir de outro status).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço Comercial Revertida para Pendente",
        body: "A ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} voltou para o status pendente.",
      },
      push: {
        title: "Ordem de Serviço Comercial Revertida para Pendente",
        body: "Ordem comercial pendente novamente: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço Comercial Revertida para Pendente{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço comercial voltou para o status pendente.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} voltou para o status pendente.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "service-order.service.ts (transição de status da Ordem de Serviço — espelha service_order.started.*)",
      targeted: false,
    },
  },
  {
    key: "service_order.pending.logistic",
    name: "Ordem de Serviço de Logística Revertida para Pendente",
    notificationType: "PRODUCTION",
    eventType: "service_order.pending.logistic",
    description: "Ordem de serviço de logística voltou ao status pendente (reversão a partir de outro status).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Logística Revertida para Pendente",
        body: "A ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} voltou para o status pendente.",
      },
      push: {
        title: "Ordem de Serviço de Logística Revertida para Pendente",
        body: "Ordem de logística pendente novamente: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Logística Revertida para Pendente{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de logística voltou para o status pendente.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} voltou para o status pendente.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "service-order.service.ts (transição de status da Ordem de Serviço — espelha service_order.started.*)",
      targeted: false,
    },
  },
  {
    key: "service_order.pending.production",
    name: "Ordem de Serviço de Produção Revertida para Pendente",
    notificationType: "PRODUCTION",
    eventType: "service_order.pending.production",
    description: "Ordem de serviço de produção voltou ao status pendente (reversão a partir de outro status).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Produção Revertida para Pendente",
        body: "A ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} voltou para o status pendente.",
      },
      push: {
        title: "Ordem de Serviço de Produção Revertida para Pendente",
        body: "Ordem de produção pendente novamente: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Produção Revertida para Pendente{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de produção voltou para o status pendente.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} voltou para o status pendente.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "service-order.service.ts (transição de status da Ordem de Serviço — espelha service_order.started.*)",
      targeted: false,
    },
  },
  {
    key: "service_order.started.artwork",
    name: "Ordem de Serviço de Arte Iniciada",
    notificationType: "PRODUCTION",
    eventType: "service_order.started.artwork",
    description: "Ordem de serviço de arte iniciada (execução em andamento).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Arte Iniciada",
        body: "A ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi iniciada e está em execução.",
      },
      push: {
        title: "Ordem de Serviço de Arte Iniciada",
        body: "Ordem de arte iniciada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Arte Iniciada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de arte foi iniciada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi iniciada e está em execução.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.started.artwork\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.started.commercial",
    name: "Ordem de Serviço Comercial Iniciada",
    notificationType: "PRODUCTION",
    eventType: "service_order.started.commercial",
    description: "Ordem de serviço comercial iniciada (execução em andamento).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço Comercial Iniciada",
        body: "A ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi iniciada e está em execução.",
      },
      push: {
        title: "Ordem de Serviço Comercial Iniciada",
        body: "Ordem comercial iniciada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço Comercial Iniciada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço comercial foi iniciada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi iniciada e está em execução.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.started.commercial\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.started.logistic",
    name: "Ordem de Serviço de Logística Iniciada",
    notificationType: "PRODUCTION",
    eventType: "service_order.started.logistic",
    description: "Ordem de serviço de logística iniciada (execução em andamento).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Logística Iniciada",
        body: "A ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi iniciada e está em execução.",
      },
      push: {
        title: "Ordem de Serviço de Logística Iniciada",
        body: "Ordem de logística iniciada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Logística Iniciada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de logística foi iniciada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi iniciada e está em execução.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.started.logistic\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.started.production",
    name: "Ordem de Serviço de Produção Iniciada",
    notificationType: "PRODUCTION",
    eventType: "service_order.started.production",
    description: "Ordem de serviço de produção iniciada (execução em andamento).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Produção Iniciada",
        body: "A ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi iniciada e está em execução.",
      },
      push: {
        title: "Ordem de Serviço de Produção Iniciada",
        body: "Ordem de produção iniciada: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Produção Iniciada{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de produção foi iniciada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} foi iniciada e está em execução.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.started.production\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.status_changed_for_creator.artwork",
    name: "Status da Ordem de Serviço de Arte Alterado (Criador)",
    notificationType: "PRODUCTION",
    eventType: "service_order.status_changed_for_creator.artwork",
    description: "Status da ordem de serviço de arte alterado por outra pessoa (notificação direcionada ao criador da ordem; setores listados são apenas informativos).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Status da Ordem de Serviço de Arte Alterado",
        body: "O status da ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} mudou de \"{{oldStatus}}\" para \"{{newStatus}}\".",
      },
      push: {
        title: "Ordem de Serviço de Arte: {{newStatus}}",
        body: "{{description}}{{#if taskName}} — {{taskName}}{{/if}} — agora \"{{newStatus}}\"",
      },
      email: {
        subject: "Status da Ordem de Serviço de Arte Alterado{{#if taskName}} - {{taskName}}{{/if}}",
        body: "O status da ordem de serviço de arte foi alterado.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}Status anterior: {{oldStatus}}\nNovo status: {{newStatus}}\n",
      },
      whatsapp: {
        body: "O status da ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} mudou de \"{{oldStatus}}\" para \"{{newStatus}}\".",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.status_changed_for_creator.artwork\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  {
    key: "service_order.status_changed_for_creator.commercial",
    name: "Status da Ordem de Serviço Comercial Alterado (Criador)",
    notificationType: "PRODUCTION",
    eventType: "service_order.status_changed_for_creator.commercial",
    description: "Status da ordem de serviço comercial alterado por outra pessoa (notificação direcionada ao criador da ordem; setores listados são apenas informativos).",
    enabled: false,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Status da Ordem de Serviço Comercial Alterado",
        body: "O status da ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} mudou de \"{{oldStatus}}\" para \"{{newStatus}}\".",
      },
      push: {
        title: "Ordem de Serviço Comercial: {{newStatus}}",
        body: "{{description}}{{#if taskName}} — {{taskName}}{{/if}} — agora \"{{newStatus}}\"",
      },
      email: {
        subject: "Status da Ordem de Serviço Comercial Alterado{{#if taskName}} - {{taskName}}{{/if}}",
        body: "O status da ordem de serviço comercial foi alterado.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}Status anterior: {{oldStatus}}\nNovo status: {{newStatus}}\n",
      },
      whatsapp: {
        body: "O status da ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} mudou de \"{{oldStatus}}\" para \"{{newStatus}}\".",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.status_changed_for_creator.commercial\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  {
    key: "service_order.status_changed_for_creator.logistic",
    name: "Status da Ordem de Serviço de Logística Alterado (Criador)",
    notificationType: "PRODUCTION",
    eventType: "service_order.status_changed_for_creator.logistic",
    description: "Status da ordem de serviço de logística alterado por outra pessoa (notificação direcionada ao criador da ordem; setores listados são apenas informativos).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Status da Ordem de Serviço de Logística Alterado",
        body: "O status da ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} mudou de \"{{oldStatus}}\" para \"{{newStatus}}\".",
      },
      push: {
        title: "Ordem de Serviço de Logística: {{newStatus}}",
        body: "{{description}}{{#if taskName}} — {{taskName}}{{/if}} — agora \"{{newStatus}}\"",
      },
      email: {
        subject: "Status da Ordem de Serviço de Logística Alterado{{#if taskName}} - {{taskName}}{{/if}}",
        body: "O status da ordem de serviço de logística foi alterado.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}Status anterior: {{oldStatus}}\nNovo status: {{newStatus}}\n",
      },
      whatsapp: {
        body: "O status da ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} mudou de \"{{oldStatus}}\" para \"{{newStatus}}\".",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.status_changed_for_creator.logistic\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  {
    key: "service_order.status_changed_for_creator.production",
    name: "Status da Ordem de Serviço de Produção Alterado (Criador)",
    notificationType: "PRODUCTION",
    eventType: "service_order.status_changed_for_creator.production",
    description: "Status da ordem de serviço de produção alterado por outra pessoa (notificação direcionada ao criador da ordem; setores listados são apenas informativos).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Status da Ordem de Serviço de Produção Alterado",
        body: "O status da ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} mudou de \"{{oldStatus}}\" para \"{{newStatus}}\".",
      },
      push: {
        title: "Ordem de Serviço de Produção: {{newStatus}}",
        body: "{{description}}{{#if taskName}} — {{taskName}}{{/if}} — agora \"{{newStatus}}\"",
      },
      email: {
        subject: "Status da Ordem de Serviço de Produção Alterado{{#if taskName}} - {{taskName}}{{/if}}",
        body: "O status da ordem de serviço de produção foi alterado.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}Status anterior: {{oldStatus}}\nNovo status: {{newStatus}}\n",
      },
      whatsapp: {
        body: "O status da ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} mudou de \"{{oldStatus}}\" para \"{{newStatus}}\".",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.status_changed_for_creator.production\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  {
    key: "service_order.waiting_approval.artwork",
    name: "Ordem de Serviço de Arte Aguardando Aprovação",
    notificationType: "PRODUCTION",
    eventType: "service_order.waiting_approval.artwork",
    description: "Ordem de serviço de arte aguardando aprovação da arte (transição para Aguardando Aprovação).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Arte Aguardando Aprovação",
        body: "A ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está aguardando aprovação.",
      },
      push: {
        title: "Ordem de Serviço de Arte Aguardando Aprovação",
        body: "Ordem de arte aguardando aprovação: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Arte Aguardando Aprovação{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de arte está aguardando aprovação.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está aguardando aprovação.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.waiting_approval.artwork\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.waiting_approval.commercial",
    name: "Ordem de Serviço Comercial Aguardando Aprovação",
    notificationType: "PRODUCTION",
    eventType: "service_order.waiting_approval.commercial",
    description: "(Inalcançável — o status Aguardando Aprovação é exclusivo de ordens de serviço de arte; mantida por compatibilidade.)",
    enabled: false,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço Comercial Aguardando Aprovação",
        body: "A ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está aguardando aprovação.",
      },
      push: {
        title: "Ordem de Serviço Comercial Aguardando Aprovação",
        body: "Ordem comercial aguardando aprovação: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço Comercial Aguardando Aprovação{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço comercial está aguardando aprovação.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está aguardando aprovação.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.waiting_approval.commercial\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.waiting_approval.logistic",
    name: "Ordem de Serviço de Logística Aguardando Aprovação",
    notificationType: "PRODUCTION",
    eventType: "service_order.waiting_approval.logistic",
    description: "(Inalcançável — o status Aguardando Aprovação é exclusivo de ordens de serviço de arte; mantida por compatibilidade.)",
    enabled: false,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Logística Aguardando Aprovação",
        body: "A ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está aguardando aprovação.",
      },
      push: {
        title: "Ordem de Serviço de Logística Aguardando Aprovação",
        body: "Ordem de logística aguardando aprovação: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Logística Aguardando Aprovação{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de logística está aguardando aprovação.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está aguardando aprovação.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.waiting_approval.logistic\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.waiting_approval.production",
    name: "Ordem de Serviço de Produção Aguardando Aprovação",
    notificationType: "PRODUCTION",
    eventType: "service_order.waiting_approval.production",
    description: "(Inalcançável — o status Aguardando Aprovação é exclusivo de ordens de serviço de arte; mantida por compatibilidade.)",
    enabled: false,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Produção Aguardando Aprovação",
        body: "A ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está aguardando aprovação.",
      },
      push: {
        title: "Ordem de Serviço de Produção Aguardando Aprovação",
        body: "Ordem de produção aguardando aprovação: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Produção Aguardando Aprovação{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de produção está aguardando aprovação.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está aguardando aprovação.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"service_order.waiting_approval.production\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "service_order.waiting_artwork.artwork",
    name: "Ordem de Serviço de Arte Aguardando Arte",
    notificationType: "PRODUCTION",
    eventType: "service_order.waiting_artwork.artwork",
    description: "(Inalcançável — o status Aguardando Arte é exclusivo de ordens de serviço comerciais; mantida por compatibilidade.)",
    enabled: false,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Arte Aguardando Arte",
        body: "A ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está bloqueada aguardando arte aprovada.",
      },
      push: {
        title: "Ordem de Serviço de Arte Aguardando Arte",
        body: "Ordem de arte aguardando arte: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Arte Aguardando Arte{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de arte está aguardando arte aprovada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de arte \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está bloqueada aguardando arte aprovada.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "service-order.service.ts (transição de status da Ordem de Serviço — espelha service_order.started.*)",
      targeted: false,
    },
  },
  {
    key: "service_order.waiting_artwork.commercial",
    name: "Ordem de Serviço Comercial Aguardando Arte",
    notificationType: "PRODUCTION",
    eventType: "service_order.waiting_artwork.commercial",
    description: "Ordem de serviço comercial bloqueada aguardando arte aprovada (transição para Aguardando Arte).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço Comercial Aguardando Arte",
        body: "A ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está bloqueada aguardando arte aprovada.",
      },
      push: {
        title: "Ordem de Serviço Comercial Aguardando Arte",
        body: "Ordem comercial aguardando arte: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço Comercial Aguardando Arte{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço comercial está aguardando arte aprovada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço comercial \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está bloqueada aguardando arte aprovada.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "service-order.service.ts (transição de status da Ordem de Serviço — espelha service_order.started.*)",
      targeted: false,
    },
  },
  {
    key: "service_order.waiting_artwork.logistic",
    name: "Ordem de Serviço de Logística Aguardando Arte",
    notificationType: "PRODUCTION",
    eventType: "service_order.waiting_artwork.logistic",
    description: "(Inalcançável — o status Aguardando Arte é exclusivo de ordens de serviço comerciais; mantida por compatibilidade.)",
    enabled: false,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Logística Aguardando Arte",
        body: "A ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está bloqueada aguardando arte aprovada.",
      },
      push: {
        title: "Ordem de Serviço de Logística Aguardando Arte",
        body: "Ordem de logística aguardando arte: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Logística Aguardando Arte{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de logística está aguardando arte aprovada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de logística \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está bloqueada aguardando arte aprovada.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "service-order.service.ts (transição de status da Ordem de Serviço — espelha service_order.started.*)",
      targeted: false,
    },
  },
  {
    key: "service_order.waiting_artwork.production",
    name: "Ordem de Serviço de Produção Aguardando Arte",
    notificationType: "PRODUCTION",
    eventType: "service_order.waiting_artwork.production",
    description: "(Inalcançável — o status Aguardando Arte é exclusivo de ordens de serviço comerciais; mantida por compatibilidade.)",
    enabled: false,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ordem de Serviço de Produção Aguardando Arte",
        body: "A ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está bloqueada aguardando arte aprovada.",
      },
      push: {
        title: "Ordem de Serviço de Produção Aguardando Arte",
        body: "Ordem de produção aguardando arte: {{description}}{{#if taskName}} — {{taskName}}{{/if}}",
      },
      email: {
        subject: "Ordem de Serviço de Produção Aguardando Arte{{#if taskName}} - {{taskName}}{{/if}}",
        body: "A ordem de serviço de produção está aguardando arte aprovada.\n\nOrdem: {{description}}\n{{#if taskName}}Tarefa: {{taskName}}\n{{/if}}",
      },
      whatsapp: {
        body: "A ordem de serviço de produção \"{{description}}\"{{#if taskName}} da tarefa \"{{taskName}}\"{{/if}} está bloqueada aguardando arte aprovada.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "service-order.service.ts (transição de status da Ordem de Serviço — espelha service_order.started.*)",
      targeted: false,
    },
  },
  // ─── task ────────────────────────────────────────────────────────────────────
  {
    key: "task.assigned",
    name: "Responsável Adicionado à Tarefa",
    notificationType: "PRODUCTION",
    eventType: "task.assigned",
    description: "Colaborador adicionado como responsável por uma tarefa (notificação direcionada ao novo responsável).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: [],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Você foi designado para uma tarefa",
        body: "Você foi adicionado(a) como responsável pela tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}}.",
      },
      push: {
        title: "Nova Tarefa Atribuída",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — você agora é responsável",
      },
      whatsapp: {
        body: "Você foi adicionado(a) como responsável pela tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}}.",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: true,
    },
  },
  {
    key: "task.cancelled",
    name: "Tarefa Cancelada",
    notificationType: "SYSTEM",
    eventType: "task.cancelled",
    description: "Tarefa cancelada; serviços em andamento devem ser interrompidos.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "FINANCIAL", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Tarefa Cancelada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi cancelada. Serviços em andamento devem ser interrompidos.",
      },
      push: {
        title: "Tarefa Cancelada",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — cancelada, interromper serviços",
      },
      email: {
        subject: "Tarefa Cancelada - {{taskName}}",
        body: "A tarefa foi cancelada. Serviços em andamento devem ser interrompidos.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi cancelada. Serviços em andamento devem ser interrompidos.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.cancelled\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.completed",
    name: "Tarefa Concluida",
    notificationType: "PRODUCTION",
    eventType: "task.completed",
    description: "Tarefa concluída — caminhão finalizado (transição de status para Concluída).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Tarefa Concluída",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi concluída — caminhão finalizado.",
      },
      push: {
        title: "Tarefa Concluída",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — concluída, caminhão finalizado",
      },
      email: {
        subject: "Tarefa Concluída - {{taskName}}",
        body: "A tarefa foi concluída — caminhão finalizado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi concluída — caminhão finalizado.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.completed\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.created",
    name: "Nova Tarefa Criada",
    notificationType: "PRODUCTION",
    eventType: "task.created",
    description: "Nova tarefa criada, entrando na fase de preparação.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Nova Tarefa Criada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi criada e entrou na fase de preparação.",
      },
      push: {
        title: "Nova Tarefa",
        body: "Nova tarefa: {{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — em preparação",
      },
      email: {
        subject: "Nova Tarefa Criada - {{taskName}}",
        body: "Uma nova tarefa foi criada e entrou na fase de preparação.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi criada e entrou na fase de preparação.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.created\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.deadline_1day",
    name: "Prazo Amanha",
    notificationType: "PRODUCTION",
    eventType: "task.deadline_1day",
    description: "Prazo de conclusão da tarefa vence amanhã (verificação periódica de prazos).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: 1,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Prazo Amanhã",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} vence amanhã{{#if dueDate}} ({{dueDate}}){{/if}}. Verifique o andamento.",
      },
      push: {
        title: "Vence Amanhã",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — prazo vence amanhã",
      },
      email: {
        subject: "Prazo Amanhã - {{taskName}}",
        body: "O prazo da tarefa vence amanhã{{#if dueDate}} ({{dueDate}}){{/if}}.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} vence amanhã{{#if dueDate}} ({{dueDate}}){{/if}}. Verifique o andamento.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.deadline_1day\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.deadline_1hour",
    name: "Prazo em 1 Hora",
    notificationType: "PRODUCTION",
    eventType: "task.deadline_1hour",
    description: "Prazo de conclusão da tarefa vence em 1 hora (verificação periódica de prazos; aviso urgente).",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: 1,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Prazo em 1 Hora",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} vence em aproximadamente 1 hora{{#if dueDate}} ({{dueDate}}){{/if}}. Verifique o andamento.",
      },
      push: {
        title: "URGENTE: 1h restante",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — prazo vence em 1 hora",
      },
      email: {
        subject: "Prazo em 1 Hora - {{taskName}}",
        body: "O prazo da tarefa vence em aproximadamente 1 hora{{#if dueDate}} ({{dueDate}}){{/if}}.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} vence em aproximadamente 1 hora{{#if dueDate}} ({{dueDate}}){{/if}}. Verifique o andamento.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.deadline_1hour\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.deadline_3days",
    name: "Prazo em 3 Dias",
    notificationType: "PRODUCTION",
    eventType: "task.deadline_3days",
    description: "Prazo de conclusão da tarefa vence em 3 dias (verificação periódica de prazos).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: 1,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Prazo em 3 Dias",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} vence em 3 dias{{#if dueDate}} ({{dueDate}}){{/if}}. Verifique o andamento.",
      },
      push: {
        title: "Prazo em 3 Dias",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — prazo vence em 3 dias",
      },
      email: {
        subject: "Prazo em 3 Dias - {{taskName}}",
        body: "O prazo da tarefa vence em 3 dias{{#if dueDate}} ({{dueDate}}){{/if}}.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} vence em 3 dias{{#if dueDate}} ({{dueDate}}){{/if}}. Verifique o andamento.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.deadline_3days\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.deadline_4hours",
    name: "Prazo em 4 Horas",
    notificationType: "PRODUCTION",
    eventType: "task.deadline_4hours",
    description: "Prazo de conclusão da tarefa vence em 4 horas (verificação periódica de prazos; aviso urgente).",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: 1,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Prazo em 4 Horas",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} vence em aproximadamente 4 horas{{#if dueDate}} ({{dueDate}}){{/if}}. Verifique o andamento.",
      },
      push: {
        title: "Prazo Próximo: 4h",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — prazo vence em 4 horas",
      },
      email: {
        subject: "Prazo em 4 Horas - {{taskName}}",
        body: "O prazo da tarefa vence em aproximadamente 4 horas{{#if dueDate}} ({{dueDate}}){{/if}}.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} vence em aproximadamente 4 horas{{#if dueDate}} ({{dueDate}}){{/if}}. Verifique o andamento.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.deadline_4hours\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.deadline_7days",
    name: "Prazo em 7 Dias",
    notificationType: "PRODUCTION",
    eventType: "task.deadline_7days",
    description: "Prazo de conclusão da tarefa vence em 7 dias (verificação periódica de prazos; janela de planejamento).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: 1,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Prazo em 7 Dias",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} vence em 7 dias{{#if dueDate}} ({{dueDate}}){{/if}}. Verifique o andamento.",
      },
      push: {
        title: "Prazo em 1 Semana",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — prazo vence em 7 dias",
      },
      email: {
        subject: "Prazo em 7 Dias - {{taskName}}",
        body: "O prazo da tarefa vence em 7 dias{{#if dueDate}} ({{dueDate}}){{/if}}.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} vence em 7 dias{{#if dueDate}} ({{dueDate}}){{/if}}. Verifique o andamento.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.deadline_7days\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.artworks",
    name: "Artes da Tarefa Atualizadas",
    notificationType: "PRODUCTION",
    eventType: "task.field.artworks",
    description: "Artes da tarefa adicionadas, atualizadas ou removidas (rastreador de campos da tarefa).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: true,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Artes da Tarefa Atualizadas",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
      push: {
        title: "Artes da Tarefa Atualizadas",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}: {{fileChangeDescription}}",
      },
      email: {
        subject: "Artes da Tarefa Atualizadas - {{taskName}}",
        body: "Os arquivos de arte da tarefa foram atualizados.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}Alterações: {{fileChangeDescription}}\n",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
    },
    metadata: {
      field: "artworks",
      category: "ARTWORK",
      isFileArray: true,
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.artworks\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.bankSlips",
    name: "Boletos da Tarefa Atualizados",
    notificationType: "PRODUCTION",
    eventType: "task.field.bankSlips",
    description: "Boletos vinculados à tarefa adicionados ou removidos (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: true,
    maxFrequencyPerDay: 0,
    deduplicationWindow: 0,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Boletos da Tarefa Atualizados",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
      push: {
        title: "Boletos da Tarefa Atualizados",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}: {{fileChangeDescription}}",
      },
      email: {
        subject: "Boletos da Tarefa Atualizados - {{taskName}}",
        body: "Os arquivos de boleto da tarefa foram atualizados.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}Alterações: {{fileChangeDescription}}\n",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
    },
    metadata: {
      field: "bankSlips",
      category: "FINANCIAL",
      targetRule: {
        allowedSectors: ["ADMIN", "FINANCIAL"],
      },
      isFileArray: true,
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.bankSlips\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.baseFiles",
    name: "Arquivos Base Atualizados",
    notificationType: "PRODUCTION",
    eventType: "task.field.baseFiles",
    description: "Arquivos base da tarefa adicionados, atualizados ou removidos (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: true,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Arquivos Base Atualizados",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
      push: {
        title: "Arquivos Base Atualizados",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}: {{fileChangeDescription}}",
      },
      email: {
        subject: "Arquivos Base Atualizados - {{taskName}}",
        body: "Os arquivos base da tarefa foram atualizados.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}Alterações: {{fileChangeDescription}}\n",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
    },
    metadata: {
      field: "baseFiles",
      category: "ARTWORK",
      isFileArray: true,
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.baseFiles\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.bonification",
    name: "Bonificação da Tarefa Alterada",
    notificationType: "PRODUCTION",
    eventType: "task.field.bonification",
    description: "Status de bonificação da tarefa alterado — define se a tarefa conta para o bônus de produção.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Bonificação da Tarefa Alterada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o status de bonificação alterado{{#if newValue}} para {{newValue}}{{/if}}.",
      },
      push: {
        title: "Bonificação da Tarefa Alterada",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — bonificação alterada{{#if newValue}}: {{newValue}}{{/if}}",
      },
      email: {
        subject: "Bonificação da Tarefa Alterada - {{taskName}}",
        body: "A tarefa teve o status de bonificação alterado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o status de bonificação alterado{{#if newValue}} para {{newValue}}{{/if}}.",
      },
    },
    metadata: {
      category: "FINANCIAL",
      field: "bonification",
      formatter: "formatBonificationStatus",
      registry: "seed-notification-configs",
      trigger: "task-field-tracker.service.ts (metadata.field=bonification)",
      targeted: false,
    },
  },
  {
    key: "task.field.budgets",
    name: "Orcamentos da Tarefa Atualizados",
    notificationType: "PRODUCTION",
    eventType: "task.field.budgets",
    description: "Orçamentos da tarefa adicionados, atualizados ou removidos (rastreador de campos da tarefa).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Orçamentos da Tarefa Atualizados",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
      push: {
        title: "Orçamentos da Tarefa Atualizados",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}: {{fileChangeDescription}}",
      },
      email: {
        subject: "Orçamentos da Tarefa Atualizados - {{taskName}}",
        body: "Os arquivos de orçamento da tarefa foram atualizados.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}Alterações: {{fileChangeDescription}}\n",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
    },
    metadata: {
      field: "budgets",
      category: "FINANCIAL",
      isFileArray: true,
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.budgets\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.customerId",
    name: "Cliente da Tarefa Alterado",
    notificationType: "PRODUCTION",
    eventType: "task.field.customerId",
    description: "Cliente da tarefa alterado ou removido (rastreador de campos da tarefa).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Cliente da Tarefa Alterado",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o cliente alterado.",
      },
      push: {
        title: "Cliente da Tarefa Alterado",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — cliente alterado",
      },
      email: {
        subject: "Cliente da Tarefa Alterado - {{taskName}}",
        body: "A tarefa teve o cliente alterado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o cliente alterado.",
      },
    },
    metadata: {
      field: "customerId",
      category: "ASSIGNMENT",
      formatter: "formatCustomer",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.customerId\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.details",
    name: "Detalhes da Tarefa Atualizados",
    notificationType: "PRODUCTION",
    eventType: "task.field.details",
    description: "Detalhes ou descrição da tarefa atualizados (rastreador de campos da tarefa).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Detalhes da Tarefa Atualizados",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve os detalhes atualizados.",
      },
      push: {
        title: "Detalhes da Tarefa Atualizados",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — detalhes atualizados",
      },
      email: {
        subject: "Detalhes da Tarefa Atualizados - {{taskName}}",
        body: "A tarefa teve os detalhes atualizados.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve os detalhes atualizados.",
      },
    },
    metadata: {
      field: "details",
      category: "BASIC",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.details\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.entryDate",
    name: "Data de Entrada Alterada",
    notificationType: "PRODUCTION",
    eventType: "task.field.entryDate",
    description: "Data de entrada do caminhão alterada ou removida (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Data de Entrada Alterada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a data de entrada alterada{{#if oldValue}} de {{oldValue}}{{/if}}{{#if newValue}} para {{newValue}}{{/if}}.",
      },
      push: {
        title: "Data de Entrada Alterada",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — entrada: {{#if newValue}}{{newValue}}{{else}}removida{{/if}}",
      },
      email: {
        subject: "Data de Entrada Alterada - {{taskName}}",
        body: "A tarefa teve a data de entrada alterada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a data de entrada alterada{{#if oldValue}} de {{oldValue}}{{/if}}{{#if newValue}} para {{newValue}}{{/if}}.",
      },
    },
    metadata: {
      field: "entryDate",
      category: "DATES",
      formatter: "formatDate",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.entryDate\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.finishedAt",
    name: "Data de Conclusao Alterada",
    notificationType: "PRODUCTION",
    eventType: "task.field.finishedAt",
    description: "Data de conclusão definida ou removida — tarefa concluída ou reaberta (rastreador de campos da tarefa).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Data de Conclusão Alterada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a data de conclusão alterada{{#if oldValue}} de {{oldValue}}{{/if}}{{#if newValue}} para {{newValue}}{{/if}}.",
      },
      push: {
        title: "Data de Conclusão Alterada",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — conclusão: {{#if newValue}}{{newValue}}{{else}}removida{{/if}}",
      },
      email: {
        subject: "Data de Conclusão Alterada - {{taskName}}",
        body: "A tarefa teve a data de conclusão alterada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a data de conclusão alterada{{#if oldValue}} de {{oldValue}}{{/if}}{{#if newValue}} para {{newValue}}{{/if}}.",
      },
    },
    metadata: {
      field: "finishedAt",
      category: "DATES",
      formatter: "formatDate",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.finishedAt\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.forecastDate",
    name: "Previsao de Liberacao Atualizada",
    notificationType: "PRODUCTION",
    eventType: "task.field.forecastDate",
    description: "Previsão de liberação do caminhão alterada ou removida (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "FINANCIAL", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Previsão de Liberação Alterada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a previsão de liberação alterada{{#if oldValue}} de {{oldValue}}{{/if}}{{#if newValue}} para {{newValue}}{{/if}}.",
      },
      push: {
        title: "Previsão de Liberação Alterada",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — previsão: {{#if newValue}}{{newValue}}{{else}}removida{{/if}}",
      },
      email: {
        subject: "Previsão de Liberação Alterada - {{taskName}}",
        body: "A tarefa teve a previsão de liberação alterada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a previsão de liberação alterada{{#if oldValue}} de {{oldValue}}{{/if}}{{#if newValue}} para {{newValue}}{{/if}}.",
      },
    },
    metadata: {
      field: "forecastDate",
      category: "DATES",
      formatter: "formatDate",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.forecastDate\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.invoiceReimbursements",
    name: "Notas de Reembolso Atualizadas",
    notificationType: "PRODUCTION",
    eventType: "task.field.invoiceReimbursements",
    description: "Notas fiscais de reembolso da tarefa adicionadas ou removidas (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Notas de Reembolso Atualizadas",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
      push: {
        title: "Notas de Reembolso Atualizadas",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}: {{fileChangeDescription}}",
      },
      email: {
        subject: "Notas de Reembolso Atualizadas - {{taskName}}",
        body: "Os arquivos de nota de reembolso da tarefa foram atualizados.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}Alterações: {{fileChangeDescription}}\n",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
    },
    metadata: {
      field: "invoiceReimbursements",
      category: "FINANCIAL",
      isFileArray: true,
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.invoiceReimbursements\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.invoices",
    name: "Notas Fiscais da Tarefa Atualizadas",
    notificationType: "PRODUCTION",
    eventType: "task.field.invoices",
    description: "Notas fiscais da tarefa adicionadas, atualizadas ou removidas (rastreador de campos da tarefa).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Notas Fiscais da Tarefa Atualizadas",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
      push: {
        title: "Notas Fiscais da Tarefa Atualizadas",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}: {{fileChangeDescription}}",
      },
      email: {
        subject: "Notas Fiscais da Tarefa Atualizadas - {{taskName}}",
        body: "Os arquivos de nota fiscal da tarefa foram atualizados.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}Alterações: {{fileChangeDescription}}\n",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
    },
    metadata: {
      field: "invoices",
      category: "FINANCIAL",
      isFileArray: true,
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.invoices\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.logoPaints",
    name: "Logos/Pinturas Atualizadas",
    notificationType: "PRODUCTION",
    eventType: "task.field.logoPaints",
    description: "Tintas do logotipo da tarefa adicionadas, atualizadas ou removidas (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Logos/Pinturas Atualizadas",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
      push: {
        title: "Logos/Pinturas Atualizadas",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}: {{fileChangeDescription}}",
      },
      email: {
        subject: "Logos/Pinturas Atualizadas - {{taskName}}",
        body: "Os arquivos de logos e pinturas da tarefa foram atualizados.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}Alterações: {{fileChangeDescription}}\n",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
    },
    metadata: {
      field: "logoPaints",
      category: "PRODUCTION",
      formatter: "formatPaints",
      isFileArray: true,
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.logoPaints\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.name",
    name: "Nome da Tarefa Alterado",
    notificationType: "PRODUCTION",
    eventType: "task.field.name",
    description: "Nome da tarefa alterado (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Nome da Tarefa Alterado",
        body: "A tarefa{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o nome alterado de \"{{oldValue}}\" para \"{{newValue}}\".",
      },
      push: {
        title: "Nome da Tarefa Alterado",
        body: "Tarefa renomeada: {{oldValue}} → {{newValue}}",
      },
      email: {
        subject: "Nome da Tarefa Alterado",
        body: "O nome da tarefa foi alterado.\n\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}Nome anterior: {{oldValue}}\nNovo nome: {{newValue}}\n",
      },
      whatsapp: {
        body: "A tarefa{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o nome alterado de \"{{oldValue}}\" para \"{{newValue}}\".",
      },
    },
    metadata: {
      field: "name",
      category: "BASIC",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.name\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.observation",
    name: "Observacao da Tarefa Atualizada",
    notificationType: "PRODUCTION",
    eventType: "task.field.observation",
    description: "Observação da tarefa adicionada ou removida (rastreador de campos da tarefa).",
    enabled: true,
    importance: "LOW",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Observação da Tarefa Atualizada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve uma observação atualizada.",
      },
      push: {
        title: "Observação da Tarefa Atualizada",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — observação atualizada",
      },
      email: {
        subject: "Observação da Tarefa Atualizada - {{taskName}}",
        body: "A tarefa teve uma observação atualizada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve uma observação atualizada.",
      },
    },
    metadata: {
      field: "observation",
      category: "PRODUCTION",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.observation\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.paintId",
    name: "Tinta da Tarefa Alterada",
    notificationType: "PRODUCTION",
    eventType: "task.field.paintId",
    description: "Tinta geral da pintura da tarefa alterada ou removida (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Tinta da Tarefa Alterada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a tinta geral da pintura alterada.",
      },
      push: {
        title: "Tinta da Tarefa Alterada",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — tinta da pintura alterada",
      },
      email: {
        subject: "Tinta da Tarefa Alterada - {{taskName}}",
        body: "A tarefa teve a tinta geral da pintura alterada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a tinta geral da pintura alterada.",
      },
    },
    metadata: {
      field: "paintId",
      category: "PRODUCTION",
      formatter: "formatPaint",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.paintId\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.priority",
    name: "Prioridade da Tarefa Alterada",
    notificationType: "PRODUCTION",
    eventType: "task.field.priority",
    description: "(Legado — campo inexistente na tarefa; nunca dispara.)",
    enabled: false,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER", "FINANCIAL", "LOGISTIC", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Prioridade da Tarefa Alterada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a prioridade alterada de \"{{oldValue}}\" para \"{{newValue}}\".",
      },
      push: {
        title: "Prioridade da Tarefa Alterada",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — prioridade: {{newValue}}",
      },
      email: {
        subject: "Prioridade da Tarefa Alterada - {{taskName}}",
        body: "A tarefa teve a prioridade alterada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a prioridade alterada de \"{{oldValue}}\" para \"{{newValue}}\".",
      },
    },
    metadata: {
      field: "priority",
      category: "BASIC",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.priority\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.receipts",
    name: "Recibos da Tarefa Atualizados",
    notificationType: "PRODUCTION",
    eventType: "task.field.receipts",
    description: "Comprovantes e recibos da tarefa adicionados, atualizados ou removidos (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Recibos da Tarefa Atualizados",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
      push: {
        title: "Recibos da Tarefa Atualizados",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}: {{fileChangeDescription}}",
      },
      email: {
        subject: "Recibos da Tarefa Atualizados - {{taskName}}",
        body: "Os arquivos de recibo da tarefa foram atualizados.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}Alterações: {{fileChangeDescription}}\n",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
    },
    metadata: {
      field: "receipts",
      category: "FINANCIAL",
      isFileArray: true,
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.receipts\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.reimbursements",
    name: "Reembolsos Atualizados",
    notificationType: "PRODUCTION",
    eventType: "task.field.reimbursements",
    description: "Documentos de reembolso da tarefa adicionados ou removidos (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Reembolsos Atualizados",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
      push: {
        title: "Reembolsos Atualizados",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}: {{fileChangeDescription}}",
      },
      email: {
        subject: "Reembolsos Atualizados - {{taskName}}",
        body: "Os arquivos de reembolso da tarefa foram atualizados.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}Alterações: {{fileChangeDescription}}\n",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve {{fileChangeDescription}}.",
      },
    },
    metadata: {
      field: "reimbursements",
      category: "FINANCIAL",
      isFileArray: true,
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.reimbursements\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.responsibles",
    name: "Responsáveis da Tarefa Alterados",
    notificationType: "PRODUCTION",
    eventType: "task.field.responsibles",
    description: "Lista de responsáveis da tarefa alterada — inclusões ou remoções (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "FINANCIAL", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Responsáveis da Tarefa Alterados",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a lista de responsáveis alterada.",
      },
      push: {
        title: "Responsáveis da Tarefa Alterados",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — responsáveis alterados",
      },
      email: {
        subject: "Responsáveis da Tarefa Alterados - {{taskName}}",
        body: "A tarefa teve a lista de responsáveis alterada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a lista de responsáveis alterada.",
      },
    },
    metadata: {
      field: "representatives",
      category: "NEGOTIATION",
      formatter: "formatRepresentatives",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.responsibles\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.sectorId",
    name: "Setor da Tarefa Alterado",
    notificationType: "PRODUCTION",
    eventType: "task.field.sectorId",
    description: "Setor responsável pela execução da tarefa alterado ou removido (rastreador de campos da tarefa).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Setor da Tarefa Alterado",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi transferida para outro setor.",
      },
      push: {
        title: "Setor da Tarefa Alterado",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — transferida de setor",
      },
      email: {
        subject: "Setor da Tarefa Alterado - {{taskName}}",
        body: "A tarefa teve o setor responsável alterado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi transferida para outro setor.",
      },
    },
    metadata: {
      field: "sectorId",
      category: "ASSIGNMENT",
      formatter: "formatSector",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.sectorId\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.serialNumber",
    name: "Numero de Serie Alterado",
    notificationType: "PRODUCTION",
    eventType: "task.field.serialNumber",
    description: "Número de série da tarefa alterado (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER", "FINANCIAL", "LOGISTIC", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Número de Série Alterado",
        body: "A tarefa \"{{taskName}}\" teve o número de série alterado{{#if oldValue}} de \"{{oldValue}}\"{{/if}}{{#if newValue}} para \"{{newValue}}\"{{/if}}.",
      },
      push: {
        title: "Número de Série Alterado",
        body: "{{taskName}} — série: {{#if newValue}}{{newValue}}{{else}}removida{{/if}}",
      },
      email: {
        subject: "Número de Série Alterado - {{taskName}}",
        body: "O número de série da tarefa foi alterado.\n\nTarefa: {{taskName}}\n{{#if oldValue}}Número anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo número: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\" teve o número de série alterado{{#if oldValue}} de \"{{oldValue}}\"{{/if}}{{#if newValue}} para \"{{newValue}}\"{{/if}}.",
      },
    },
    metadata: {
      field: "serialNumber",
      category: "BASIC",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.serialNumber\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.startedAt",
    name: "Data de Inicio Alterada",
    notificationType: "PRODUCTION",
    eventType: "task.field.startedAt",
    description: "Data de início definida (produção iniciada) ou removida (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL", "LOGISTIC", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Data de Início Alterada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a data de início alterada{{#if oldValue}} de {{oldValue}}{{/if}}{{#if newValue}} para {{newValue}}{{/if}}.",
      },
      push: {
        title: "Data de Início Alterada",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — início: {{#if newValue}}{{newValue}}{{else}}removida{{/if}}",
      },
      email: {
        subject: "Data de Início Alterada - {{taskName}}",
        body: "A tarefa teve a data de início alterada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a data de início alterada{{#if oldValue}} de {{oldValue}}{{/if}}{{#if newValue}} para {{newValue}}{{/if}}.",
      },
    },
    metadata: {
      field: "startedAt",
      category: "DATES",
      formatter: "formatDate",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.startedAt\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.status",
    name: "Status da Tarefa Alterado",
    notificationType: "PRODUCTION",
    eventType: "task.field.status",
    description: "Status da tarefa alterado sem notificação específica correspondente (na prática, retorno para Preparação).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Status da Tarefa Alterado",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o status alterado de \"{{oldValue}}\" para \"{{newValue}}\".",
      },
      push: {
        title: "Status da Tarefa Alterado",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — status: {{newValue}}",
      },
      email: {
        subject: "Status da Tarefa Alterado - {{taskName}}",
        body: "A tarefa teve o status alterado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o status alterado de \"{{oldValue}}\" para \"{{newValue}}\".",
      },
    },
    metadata: {
      field: "status",
      category: "BASIC",
      formatter: "formatStatus",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.status\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.term",
    name: "Prazo da Tarefa Alterado",
    notificationType: "PRODUCTION",
    eventType: "task.field.term",
    description: "Prazo de conclusão da tarefa alterado ou removido (rastreador de campos da tarefa).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Prazo da Tarefa Alterado",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o prazo alterado{{#if oldValue}} de {{oldValue}}{{/if}}{{#if newValue}} para {{newValue}}{{/if}}.",
      },
      push: {
        title: "Prazo da Tarefa Alterado",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — prazo: {{#if newValue}}{{newValue}}{{else}}removido{{/if}}",
      },
      email: {
        subject: "Prazo da Tarefa Alterado - {{taskName}}",
        body: "A tarefa teve o prazo alterado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o prazo alterado{{#if oldValue}} de {{oldValue}}{{/if}}{{#if newValue}} para {{newValue}}{{/if}}.",
      },
    },
    metadata: {
      field: "term",
      category: "DATES",
      formatter: "formatDate",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.term\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.truck.backSideLayoutId",
    name: "Layout Traseira Alterado",
    notificationType: "PRODUCTION",
    eventType: "task.field.truck.backSideLayoutId",
    description: "(Legado — consolidado na notificação única de Medidas do Caminhão; nunca dispara.)",
    enabled: false,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Layout Traseira Alterado",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o layout da traseira do caminhão alterado.",
      },
      push: {
        title: "Layout Traseira Alterado",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — layout do caminhão alterado",
      },
      email: {
        subject: "Layout Traseira Alterado - {{taskName}}",
        body: "A tarefa teve o layout da traseira alterado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o layout da traseira do caminhão alterado.",
      },
    },
    metadata: {
      field: "truck.backSideLayoutId",
      category: "PRODUCTION",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.truck.backSideLayoutId\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.truck.category",
    name: "Categoria do Caminhao Alterada",
    notificationType: "PRODUCTION",
    eventType: "task.field.truck.category",
    description: "Categoria do caminhão da tarefa alterada (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Categoria do Caminhão Alterada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a categoria do caminhão alterada{{#if oldValue}} de \"{{oldValue}}\"{{/if}}{{#if newValue}} para \"{{newValue}}\"{{/if}}.",
      },
      push: {
        title: "Categoria do Caminhão Alterada",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — categoria: {{#if newValue}}{{newValue}}{{else}}removida{{/if}}",
      },
      email: {
        subject: "Categoria do Caminhão Alterada - {{taskName}}",
        body: "A tarefa teve a categoria do caminhão alterada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a categoria do caminhão alterada{{#if oldValue}} de \"{{oldValue}}\"{{/if}}{{#if newValue}} para \"{{newValue}}\"{{/if}}.",
      },
    },
    metadata: {
      field: "truck.category",
      category: "PRODUCTION",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.truck.category\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.truck.chassisNumber",
    name: "Chassi do Caminhao Alterado",
    notificationType: "PRODUCTION",
    eventType: "task.field.truck.chassisNumber",
    description: "Número do chassi do caminhão da tarefa alterado (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Chassi do Caminhão Alterado",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o chassi do caminhão alterado{{#if oldValue}} de \"{{oldValue}}\"{{/if}}{{#if newValue}} para \"{{newValue}}\"{{/if}}.",
      },
      push: {
        title: "Chassi do Caminhão Alterado",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — chassi: {{#if newValue}}{{newValue}}{{else}}removido{{/if}}",
      },
      email: {
        subject: "Chassi do Caminhão Alterado - {{taskName}}",
        body: "A tarefa teve o chassi do caminhão alterado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o chassi do caminhão alterado{{#if oldValue}} de \"{{oldValue}}\"{{/if}}{{#if newValue}} para \"{{newValue}}\"{{/if}}.",
      },
    },
    metadata: {
      field: "truck.chassisNumber",
      category: "PRODUCTION",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.truck.chassisNumber\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.truck.implementType",
    name: "Tipo de Implemento Alterado",
    notificationType: "PRODUCTION",
    eventType: "task.field.truck.implementType",
    description: "Tipo de implemento do caminhão da tarefa alterado (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Tipo de Implemento Alterado",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o tipo de implemento alterado{{#if oldValue}} de \"{{oldValue}}\"{{/if}}{{#if newValue}} para \"{{newValue}}\"{{/if}}.",
      },
      push: {
        title: "Tipo de Implemento Alterado",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — implemento: {{#if newValue}}{{newValue}}{{else}}removido{{/if}}",
      },
      email: {
        subject: "Tipo de Implemento Alterado - {{taskName}}",
        body: "A tarefa teve o tipo de implemento alterado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o tipo de implemento alterado{{#if oldValue}} de \"{{oldValue}}\"{{/if}}{{#if newValue}} para \"{{newValue}}\"{{/if}}.",
      },
    },
    metadata: {
      field: "truck.implementType",
      category: "PRODUCTION",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.truck.implementType\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.truck.layout",
    name: "Medidas do Caminhão Atualizadas",
    notificationType: "PRODUCTION",
    eventType: "task.field.truck.layout",
    description: "Medidas do caminhão da tarefa atualizadas (notificação única consolidada, não uma por lado).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Medidas do Caminhão Atualizadas",
        body: "As medidas do caminhão da tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foram atualizadas{{#if layoutChangeSummary}} ({{layoutChangeSummary}}){{/if}}.",
      },
      push: {
        title: "Medidas Atualizadas",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — medidas do caminhão atualizadas",
      },
      whatsapp: {
        body: "As medidas do caminhão da tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foram atualizadas{{#if layoutChangeSummary}} ({{layoutChangeSummary}}){{/if}}.",
      },
    },
    metadata: {
      trigger: "layout.service.ts (batch) + task-field-tracker.service.ts (colapsar trio)",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "task.field.truck.leftSideLayoutId",
    name: "Layout Lado Esquerdo Alterado",
    notificationType: "PRODUCTION",
    eventType: "task.field.truck.leftSideLayoutId",
    description: "(Legado — consolidado na notificação única de Medidas do Caminhão; nunca dispara.)",
    enabled: false,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Layout Lado Esquerdo Alterado",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o layout do lado esquerdo do caminhão alterado.",
      },
      push: {
        title: "Layout Lado Esquerdo Alterado",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — layout do caminhão alterado",
      },
      email: {
        subject: "Layout Lado Esquerdo Alterado - {{taskName}}",
        body: "A tarefa teve o layout do lado esquerdo alterado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o layout do lado esquerdo do caminhão alterado.",
      },
    },
    metadata: {
      field: "truck.leftSideLayoutId",
      category: "PRODUCTION",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.truck.leftSideLayoutId\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.truck.plate",
    name: "Placa do Caminhao Alterada",
    notificationType: "PRODUCTION",
    eventType: "task.field.truck.plate",
    description: "Placa do caminhão da tarefa alterada (rastreador de campos da tarefa).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC", "PRODUCTION"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Placa do Caminhão Alterada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a placa do caminhão alterada{{#if oldValue}} de \"{{oldValue}}\"{{/if}}{{#if newValue}} para \"{{newValue}}\"{{/if}}.",
      },
      push: {
        title: "Placa do Caminhão Alterada",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — placa: {{#if newValue}}{{newValue}}{{else}}removida{{/if}}",
      },
      email: {
        subject: "Placa do Caminhão Alterada - {{taskName}}",
        body: "A tarefa teve a placa do caminhão alterada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a placa do caminhão alterada{{#if oldValue}} de \"{{oldValue}}\"{{/if}}{{#if newValue}} para \"{{newValue}}\"{{/if}}.",
      },
    },
    metadata: {
      field: "truck.plate",
      category: "PRODUCTION",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.truck.plate\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.truck.rightSideLayoutId",
    name: "Layout Lado Direito Alterado",
    notificationType: "PRODUCTION",
    eventType: "task.field.truck.rightSideLayoutId",
    description: "(Legado — consolidado na notificação única de Medidas do Caminhão; nunca dispara.)",
    enabled: false,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Layout Lado Direito Alterado",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o layout do lado direito do caminhão alterado.",
      },
      push: {
        title: "Layout Lado Direito Alterado",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — layout do caminhão alterado",
      },
      email: {
        subject: "Layout Lado Direito Alterado - {{taskName}}",
        body: "A tarefa teve o layout do lado direito alterado.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve o layout do lado direito do caminhão alterado.",
      },
    },
    metadata: {
      field: "truck.rightSideLayoutId",
      category: "PRODUCTION",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.truck.rightSideLayoutId\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.field.truck.spot",
    name: "Vaga do Caminhao Alterada",
    notificationType: "PRODUCTION",
    eventType: "task.field.truck.spot",
    description: "Vaga do caminhão na garagem alterada (rastreador de campos da tarefa).",
    enabled: true,
    importance: "LOW",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: false, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Vaga do Caminhão Alterada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a vaga na garagem alterada{{#if oldValue}} de \"{{oldValue}}\"{{/if}}{{#if newValue}} para \"{{newValue}}\"{{/if}}.",
      },
      push: {
        title: "Vaga do Caminhão Alterada",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — vaga: {{#if newValue}}{{newValue}}{{else}}removida{{/if}}",
      },
      email: {
        subject: "Vaga do Caminhão Alterada - {{taskName}}",
        body: "A tarefa teve a vaga na garagem alterada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if oldValue}}Valor anterior: {{oldValue}}\n{{/if}}{{#if newValue}}Novo valor: {{newValue}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} teve a vaga na garagem alterada{{#if oldValue}} de \"{{oldValue}}\"{{/if}}{{#if newValue}} para \"{{newValue}}\"{{/if}}.",
      },
    },
    metadata: {
      field: "truck.spot",
      category: "PRODUCTION",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.field.truck.spot\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.forecast_10days",
    name: "Previsao de Liberacao em 10 Dias",
    notificationType: "PRODUCTION",
    eventType: "task.forecast_10days",
    description: "Faltam 10 dias para a previsão de liberação do caminhão (fase de preparação, tarefa ainda não liberada).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: 1,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Previsão de Liberação em 10 Dias",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação em 10 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.",
      },
      push: {
        title: "Previsão de Liberação em 10 Dias",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — liberação prevista em 10 dias",
      },
      email: {
        subject: "Previsão de Liberação em 10 Dias - {{taskName}}",
        body: "A tarefa tem previsão de liberação em 10 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação em 10 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.forecast_10days\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.forecast_1day",
    name: "Previsao de Liberacao Amanha",
    notificationType: "PRODUCTION",
    eventType: "task.forecast_1day",
    description: "Previsão de liberação do caminhão é amanhã (fase de preparação, tarefa ainda não liberada).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: 1,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Previsão de Liberação Amanhã",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação para amanhã{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.",
      },
      push: {
        title: "Previsão de Liberação Amanhã",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — liberação prevista para amanhã",
      },
      email: {
        subject: "Previsão de Liberação Amanhã - {{taskName}}",
        body: "A tarefa tem previsão de liberação para amanhã{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação para amanhã{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.forecast_1day\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.forecast_3days",
    name: "Previsao de Liberacao em 3 Dias",
    notificationType: "PRODUCTION",
    eventType: "task.forecast_3days",
    description: "Faltam 3 dias para a previsão de liberação do caminhão (fase de preparação, tarefa ainda não liberada).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: 1,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Previsão de Liberação em 3 Dias",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação em 3 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.",
      },
      push: {
        title: "Previsão de Liberação em 3 Dias",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — liberação prevista em 3 dias",
      },
      email: {
        subject: "Previsão de Liberação em 3 Dias - {{taskName}}",
        body: "A tarefa tem previsão de liberação em 3 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação em 3 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.forecast_3days\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.forecast_7days",
    name: "Previsao de Liberacao em 7 Dias",
    notificationType: "PRODUCTION",
    eventType: "task.forecast_7days",
    description: "Faltam 7 dias para a previsão de liberação do caminhão (fase de preparação, tarefa ainda não liberada).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: 1,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Previsão de Liberação em 7 Dias",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação em 7 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.",
      },
      push: {
        title: "Previsão de Liberação em 7 Dias",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — liberação prevista em 7 dias",
      },
      email: {
        subject: "Previsão de Liberação em 7 Dias - {{taskName}}",
        body: "A tarefa tem previsão de liberação em 7 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação em 7 dias{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.forecast_7days\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.forecast_overdue",
    name: "Previsao de Liberacao Atrasada",
    notificationType: "PRODUCTION",
    eventType: "task.forecast_overdue",
    description: "Previsão de liberação do caminhão estourada com a preparação ainda pendente; requer destravamento urgente.",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: 3,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Previsão de Liberação Atrasada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} está com a previsão de liberação atrasada em {{daysOverdue}} dia(s) e a preparação ainda não foi concluída.",
      },
      push: {
        title: "Liberação Atrasada",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — liberação atrasada há {{daysOverdue}} dia(s)",
      },
      email: {
        subject: "[ATENÇÃO] Previsão de Liberação Atrasada - {{taskName}}",
        body: "A previsão de liberação desta tarefa está atrasada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}Dias de atraso: {{daysOverdue}}\n",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} está com a previsão de liberação atrasada em {{daysOverdue}} dia(s) e a preparação ainda não foi concluída.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.forecast_overdue\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.forecast_today",
    name: "Previsao de Liberacao Hoje",
    notificationType: "PRODUCTION",
    eventType: "task.forecast_today",
    description: "Previsão de liberação do caminhão é hoje e a preparação ainda não foi concluída (aviso urgente).",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: 2,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "DESIGNER", "LOGISTIC", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Previsão de Liberação Hoje",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação para HOJE{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.",
      },
      push: {
        title: "Previsão de Liberação Hoje",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — liberação prevista para hoje",
      },
      email: {
        subject: "Previsão de Liberação Hoje - {{taskName}}",
        body: "A tarefa tem previsão de liberação para HOJE{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} tem previsão de liberação para HOJE{{#if dueDate}} ({{dueDate}}){{/if}} e a preparação ainda não foi concluída.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.forecast_today\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.in_production",
    name: "Tarefa em Producao",
    notificationType: "PRODUCTION",
    eventType: "task.in_production",
    description: "Tarefa entrou em produção (primeiro serviço da tarefa iniciado).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Tarefa em Produção",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} entrou em produção.",
      },
      push: {
        title: "Em Produção",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — produção iniciada",
      },
      email: {
        subject: "Tarefa em Produção - {{taskName}}",
        body: "A produção da tarefa foi iniciada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} entrou em produção.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.in_production\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.overdue",
    name: "Tarefa Atrasada",
    notificationType: "PRODUCTION",
    eventType: "task.overdue",
    description: "Prazo de conclusão da tarefa estourado sem conclusão (verificação periódica de prazos; aviso urgente).",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: 3,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL", "LOGISTIC", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Tarefa Atrasada",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} está atrasada há {{daysOverdue}} dia(s){{#if dueDate}} (prazo: {{dueDate}}){{/if}}. Ação imediata necessária.",
      },
      push: {
        title: "Tarefa Atrasada",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — {{daysOverdue}} dia(s) de atraso",
      },
      email: {
        subject: "[URGENTE] Tarefa Atrasada - {{taskName}}",
        body: "ATENÇÃO: a tarefa está atrasada e requer ação imediata.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}Dias de atraso: {{daysOverdue}}\n{{#if dueDate}}Prazo: {{dueDate}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} está atrasada há {{daysOverdue}} dia(s){{#if dueDate}} (prazo: {{dueDate}}){{/if}}. Ação imediata necessária.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.overdue\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.ready_for_production",
    name: "Tarefa Liberada para Producao",
    notificationType: "PRODUCTION",
    eventType: "task.ready_for_production",
    description: "Tarefa saiu da preparação e aguarda o início da produção.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Tarefa Liberada para Produção",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} saiu da preparação e está pronta para iniciar a produção.",
      },
      push: {
        title: "Liberada para Produção",
        body: "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — pronta para iniciar a produção",
      },
      email: {
        subject: "Tarefa Liberada - {{taskName}}",
        body: "A tarefa saiu da preparação e está pronta para iniciar a produção.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} saiu da preparação e está pronta para iniciar a produção.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task.ready_for_production\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task.status.changed",
    name: "Status da Tarefa Alterado",
    notificationType: "PRODUCTION",
    eventType: "task.status.changed",
    description: "(Legado — mudança genérica de status, coberta pelas notificações específicas de cada status; sem emissor no código.)",
    enabled: false,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "PRODUCTION", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Status da Tarefa Alterado",
        body: "Status da Tarefa Alterado. Acesse o sistema para mais detalhes.",
      },
      whatsapp: {
        body: "Status da Tarefa Alterado. Acesse o sistema para mais detalhes.",
      },
    },
    metadata: {
      trigger: "ver dispatchByConfiguration(\"task.status.changed\") no código (emissor não anotado)",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  // ─── task_quote ──────────────────────────────────────────────────────────────
  {
    key: "task_quote.approval_pending",
    name: "Orçamento Aguardando Aprovação",
    notificationType: "GENERAL",
    eventType: "task_quote.approval_pending",
    description: "Orçamento avançou de etapa e aguarda a próxima aprovação (comercial ou de faturamento).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Orçamento Aguardando Aprovação",
        body: "O orçamento {{quoteLabel}} avançou de etapa e aguarda aprovação.{{#if nextStep}} Próxima etapa: {{nextStep}}.{{/if}}",
      },
      push: {
        title: "Aprovação Pendente",
        body: "Orçamento {{quoteLabel}} aguarda aprovação{{#if nextStep}} — próxima etapa: {{nextStep}}{{/if}}",
      },
      whatsapp: {
        body: "O orçamento {{quoteLabel}} avançou de etapa e aguarda aprovação.{{#if nextStep}} Próxima etapa: {{nextStep}}.{{/if}}",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "task_quote.billing_approved",
    name: "Faturamento Aprovado",
    notificationType: "GENERAL",
    eventType: "task_quote.billing_approved",
    description: "Faturamento do orçamento aprovado: notas e NFS-e emitidas, boletos gerados na sequência.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Faturamento Aprovado",
        body: "O faturamento do orçamento {{quoteLabel}} foi aprovado. Notas e boletos serão gerados na sequência.",
      },
      push: {
        title: "Faturamento Aprovado",
        body: "Faturamento do orçamento {{quoteLabel}} aprovado",
      },
      whatsapp: {
        body: "O faturamento do orçamento {{quoteLabel}} foi aprovado. Notas e boletos serão gerados na sequência.",
      },
    },
    metadata: {
      trigger: "task-quote.service.ts ~:1646 (após NFS-e ~:1732)",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "task_quote.budget_approved",
    name: "Orçamento Aprovado",
    notificationType: "GENERAL",
    eventType: "task_quote.budget_approved",
    description: "Cliente aprovou os valores do orçamento; libera a etapa de aprovação comercial.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Orçamento Aprovado",
        body: "Os valores do orçamento {{quoteLabel}} foram aprovados pelo cliente. A aprovação comercial já pode ser feita.",
      },
      push: {
        title: "Orçamento Aprovado",
        body: "Orçamento {{quoteLabel}} aprovado pelo cliente — segue para aprovação comercial",
      },
      whatsapp: {
        body: "Os valores do orçamento {{quoteLabel}} foram aprovados pelo cliente. A aprovação comercial já pode ser feita.",
      },
    },
    metadata: {
      trigger: "task-quote.service.ts ~:1611,:1407",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "task_quote.commercial_approved",
    name: "Aprovação Comercial Concluída",
    notificationType: "GENERAL",
    eventType: "task_quote.commercial_approved",
    description: "Orçamento recebeu aprovação comercial; o faturamento já pode ser aprovado.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Aprovação Comercial",
        body: "O orçamento {{quoteLabel}} recebeu aprovação comercial. O faturamento já pode ser aprovado.",
      },
      push: {
        title: "Aprovação Comercial",
        body: "Orçamento {{quoteLabel}} — aprovação comercial concluída, faturamento liberado",
      },
      whatsapp: {
        body: "O orçamento {{quoteLabel}} recebeu aprovação comercial. O faturamento já pode ser aprovado.",
      },
    },
    metadata: {
      trigger: "task-quote.service.ts ~:1618",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "task_quote.installment_overdue",
    name: "Parcela Vencida",
    notificationType: "SYSTEM",
    eventType: "task_quote.installment_overdue",
    description: "Parcela ou boleto do orçamento vencido sem pagamento (verificação diária); requer cobrança.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Parcela Vencida",
        body: "A {{installmentLabel}} da tarefa \"{{taskName}}\"{{#if customerName}} de {{customerName}}{{/if}} venceu em {{dueDate}}. Valor: R$ {{amount}}.",
      },
      push: {
        title: "Parcela Vencida",
        body: "{{customerName}} — {{installmentLabel}} de R$ {{amount}} venceu {{dueDate}}",
      },
      email: {
        subject: "Parcela vencida — {{customerName}}",
        body: "Uma parcela está vencida.\n\nCliente: {{customerName}}\nTarefa: {{taskName}}\nParcela: {{installmentLabel}}\nValor: R$ {{amount}}\nVencimento: {{dueDate}}\n\nProvidencie a cobrança.",
      },
      whatsapp: {
        body: "A {{installmentLabel}} da tarefa \"{{taskName}}\"{{#if customerName}} de {{customerName}}{{/if}} venceu em {{dueDate}}. Valor: R$ {{amount}}.",
      },
    },
    metadata: {
      trigger: "task-quote-payment.scheduler.ts",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  {
    key: "task_quote.payment_due",
    name: "Lembrete de Cobrança",
    notificationType: "SYSTEM",
    eventType: "task_quote.payment_due",
    description: "Disparado 1 dia após o vencimento do boleto sem pagamento; requer início da cobrança do cliente.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: true, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Pagamento Pendente",
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} de {{customerName}}{{/if}} possui pagamento pendente de R$ {{amount}} ({{installmentLabel}}). Vencimento: {{dueDate}}.",
      },
      push: {
        title: "Pagamento Pendente",
        body: "{{taskName}} — {{installmentLabel}} de R$ {{amount}} venceu em {{dueDate}}",
      },
      email: {
        subject: "Pagamento Pendente - {{taskName}}",
        body: "A tarefa possui pagamento pendente.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Número de Série: {{serialNumber}}\n{{/if}}{{#if customerName}}Cliente: {{customerName}}\n{{/if}}Parcela: {{installmentLabel}}\nValor: R$ {{amount}}\nVencimento: {{dueDate}}\n",
      },
      whatsapp: {
        body: "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} de {{customerName}}{{/if}} possui pagamento pendente de R$ {{amount}} ({{installmentLabel}}). Vencimento: {{dueDate}}.",
      },
    },
    metadata: {
      category: "FINANCIAL",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"task_quote.payment_due\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  {
    key: "task_quote.settled",
    name: "Pagamento Liquidado",
    notificationType: "GENERAL",
    eventType: "task_quote.settled",
    description: "Orçamento (ou operação externa) totalmente quitado — todas as parcelas pagas.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: false,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "COMMERCIAL", "FINANCIAL"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Pagamento Liquidado",
        body: "O orçamento {{quoteLabel}} foi totalmente quitado — todas as parcelas pagas.",
      },
      push: {
        title: "Pagamento Liquidado",
        body: "Orçamento {{quoteLabel}} totalmente quitado",
      },
      whatsapp: {
        body: "O orçamento {{quoteLabel}} foi totalmente quitado — todas as parcelas pagas.",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: false,
    },
  },
  // ─── timeentry ───────────────────────────────────────────────────────────────
  {
    key: "timeentry.due",
    name: "Hora de Registrar o Ponto",
    notificationType: "USER",
    eventType: "timeentry.due",
    description: "Disparado no horário esperado de cada uma das 4 marcações de ponto (entrada, saída para almoço, retorno do almoço e saída do expediente), assim que o horário chega e a marcação ainda não foi registrada — antes do lembrete de 15 minutos. (notificação direcionada ao próprio colaborador)",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: 4,
    deduplicationWindow: null,
    sectors: ["ADMIN", "BASIC", "COMMERCIAL", "DESIGNER", "EXTERNAL", "FINANCIAL", "HUMAN_RESOURCES", "LOGISTIC", "MAINTENANCE", "PLOTTING", "PRODUCTION", "PRODUCTION_MANAGER", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Hora de registrar o ponto",
        body: "Está na hora de registrar: {{entryLabel}}. Horário esperado: {{expectedTime}}.",
      },
      push: {
        title: "Hora de registrar o ponto",
        body: "Registre agora: {{entryLabel}} (horário {{expectedTime}})",
      },
      email: {
        subject: "Hora de registrar o ponto",
        body: "Está na hora de registrar: {{entryLabel}}.\n\nHorário esperado: {{expectedTime}}\nData: {{date}}\n",
      },
      whatsapp: {
        body: "Está na hora de registrar: {{entryLabel}}. Horário esperado: {{expectedTime}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "time-entry-reminder.service.ts (sendTimeEntryPunchDue) — cron de detecção de marcações ausentes, dispara no horário esperado (ATIVO)",
      targeted: true,
    },
  },
  {
    key: "timeentry.missing.escalation",
    name: "Ponto Não Registrado (Gestores)",
    notificationType: "USER",
    eventType: "timeentry.missing.escalation",
    description: "Disparado quando o colaborador segue sem registrar qualquer uma das 4 marcações 30 minutos após o horário esperado (escalonamento do lembrete de ponto).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Ponto não registrado — {{userName}}",
        body: "{{userName}} não registrou {{entryLabel}} (horário esperado: {{expectedTime}}) em {{date}}.",
      },
      push: {
        title: "Ponto não registrado — {{userName}}",
        body: "{{userName}} não registrou {{entryLabel}} (horário esperado: {{expectedTime}}) em {{date}}.",
      },
      email: {
        subject: "Ponto não registrado — {{userName}}",
        body: "O colaborador {{userName}} não registrou {{entryLabel}} (horário esperado: {{expectedTime}}) em {{date}}.\n\nVerifique a situação no sistema de ponto.",
      },
      whatsapp: {
        body: "{{userName}} não registrou {{entryLabel}} (horário esperado: {{expectedTime}}) em {{date}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "time-entry-reminder.service.ts (sendTimeEntryEscalation) — cron de detecção de marcações ausentes (ATIVO)",
      targeted: false,
    },
  },
  {
    key: "timeentry.reminder",
    name: "Lembrete de Registro de Ponto",
    notificationType: "USER",
    eventType: "timeentry.reminder",
    description: "Disparado 15 minutos após o horário esperado de cada uma das 4 marcações de ponto: entrada, saída para almoço, retorno do almoço e saída do expediente (notificação direcionada ao próprio colaborador).",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: 4,
    deduplicationWindow: null,
    sectors: ["ADMIN", "BASIC", "COMMERCIAL", "DESIGNER", "EXTERNAL", "FINANCIAL", "HUMAN_RESOURCES", "LOGISTIC", "MAINTENANCE", "PLOTTING", "PRODUCTION", "PRODUCTION_MANAGER", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: false, defaultOn: true },
    },
    templates: {
      inApp: {
        title: "Registre seu Ponto",
        body: "Você ainda não registrou: {{entryLabel}}. Horário esperado: {{expectedTime}}.",
      },
      push: {
        title: "Registro de Ponto",
        body: "Registro pendente: {{entryLabel}} (esperado {{expectedTime}})",
      },
      email: {
        subject: "Lembrete: Registro de Ponto",
        body: "Você ainda não registrou: {{entryLabel}}.\n\nHorário esperado: {{expectedTime}}\nData: {{date}}\n",
      },
      whatsapp: {
        body: "Você ainda não registrou: {{entryLabel}}. Horário esperado: {{expectedTime}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"timeentry.reminder\") no código (emissor não anotado)",
      targeted: true,
    },
  },
  // ─── truck ───────────────────────────────────────────────────────────────────
  {
    key: "truck.movement_request",
    name: "Solicitação de Movimentação de Caminhão",
    notificationType: "PRODUCTION",
    eventType: "truck.movement_request",
    description: "Solicitação de movimentação de caminhão entre vagas da garagem registrada, aguardando execução.",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "LOGISTIC"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Solicitação de Movimentação",
        body: "Movimentação do caminhão \"{{taskName}}\" solicitada: de {{fromSpot}} para {{toSpot}}.",
      },
      push: {
        title: "Solicitação de Movimentação",
        body: "{{taskName}} — mover de {{fromSpot}} para {{toSpot}}",
      },
      email: {
        subject: "Solicitação de Movimentação - {{taskName}}",
        body: "Foi solicitada a movimentação do caminhão \"{{taskName}}\" de {{fromSpot}} para {{toSpot}}.",
      },
      whatsapp: {
        body: "🚛 Movimentação solicitada: \"{{taskName}}\" de {{fromSpot}} para {{toSpot}}.",
      },
    },
    metadata: {
      category: "PRODUCTION",
      registry: "seed-notification-configs",
      trigger: "ver dispatchByConfiguration(\"truck.movement_request\") no código (emissor não anotado)",
      targeted: false,
    },
  },
  // ─── warning ─────────────────────────────────────────────────────────────────
  {
    key: "warning.issued",
    name: "Advertência Emitida",
    notificationType: "USER",
    eventType: "warning.issued",
    description: "Advertência disciplinar registrada (notificação direcionada ao colaborador advertido).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: true,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["HUMAN_RESOURCES"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: false },
      PUSH: { enabled: true, mandatory: true, defaultOn: false },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: true, mandatory: true, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Advertência Emitida",
        body: "Você recebeu uma advertência{{#if category}} ({{category}}{{#if severity}}, severidade {{severity}}{{/if}}){{/if}}.{{#if reason}} Motivo: {{reason}}.{{/if}}",
      },
      push: {
        title: "Advertência Emitida",
        body: "Advertência: {{category}}{{#if severity}} — severidade {{severity}}{{/if}}",
      },
      email: {
        subject: "Advertência emitida — {{category}}",
        body: "Foi registrada uma advertência em seu nome.\n\n{{#if category}}Categoria: {{category}}\n{{/if}}{{#if severity}}Severidade: {{severity}}\n{{/if}}{{#if reason}}Motivo: {{reason}}\n\n{{/if}}Procure o RH em caso de dúvidas.",
      },
      whatsapp: {
        body: "Você recebeu uma advertência{{#if category}} ({{category}}{{#if severity}}, severidade {{severity}}{{/if}}){{/if}}.{{#if reason}} Motivo: {{reason}}.{{/if}}",
      },
    },
    metadata: {
      trigger: "see coverage-fix 2026",
      registry: "seed-notification-configs",
      targeted: true,
    },
  },
  {
    key: "warning.issued.escalation",
    name: "Advertência Emitida (Gestores)",
    notificationType: "USER",
    eventType: "warning.issued.escalation",
    description: "Advertência disciplinar registrada para um colaborador (cópia de escalonamento do evento de advertência).",
    enabled: true,
    importance: "NORMAL",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES", "PRODUCTION_MANAGER"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Advertência emitida — {{userName}}",
        body: "{{userName}} recebeu advertência ({{severityLabel}}) — {{categoryLabel}}.",
      },
      push: {
        title: "Advertência emitida — {{userName}}",
        body: "{{userName}} recebeu advertência ({{severityLabel}}) — {{categoryLabel}}.",
      },
      email: {
        subject: "Advertência emitida — {{userName}}",
        body: "O colaborador {{userName}} recebeu uma advertência ({{severityLabel}}) — {{categoryLabel}}.\n\nAcesse o sistema para detalhes.",
      },
      whatsapp: {
        body: "{{userName}} recebeu advertência ({{severityLabel}}) — {{categoryLabel}}.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "warning.service.ts (emissão de advertência — escalonamento ATIVO, create e batchCreate)",
      targeted: false,
    },
  },
  // ─── fispq/fds (medicina do trabalho — @Cron FispqAlertScheduler) ──
  {
    key: "fispq.expiring",
    name: "FISPQ/FDS a Vencer ou Pendente",
    notificationType: "USER",
    eventType: "fispq.expiring",
    description: "Fichas de Dados de Segurança (FISPQ/FDS) de produtos químicos prestes a vencer (dentro da janela de antecedência), vencidas ou ausentes — alerta diário do DP/Medicina do Trabalho.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES", "ACCOUNTING"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "FISPQ/FDS a vencer ou pendente",
        body: "{{expiringCount}} FDS vencem nos próximos {{advanceDays}} dias{{#if missingCount}} e {{missingCount}} produto(s) sem FDS válida{{/if}}{{#if products}}: {{products}}{{/if}}.",
      },
      push: {
        title: "FISPQ/FDS a vencer",
        body: "{{expiringCount}} FDS vencem em {{advanceDays}} dias{{#if products}}: {{products}}{{/if}}",
      },
      whatsapp: {
        body: "{{expiringCount}} FISPQ/FDS vencem nos próximos {{advanceDays}} dias{{#if missingCount}} e {{missingCount}} sem FDS válida{{/if}}{{#if products}}: {{products}}{{/if}}. Atualize as fichas de segurança.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "fispq-alert.scheduler.ts dispatchByConfiguration(\"fispq.expiring\")",
      targeted: false,
    },
  },
  // ─── medical-exam (medicina do trabalho — @Cron MedicalExamAlertScheduler) ──
  {
    key: "medical_exam.expiring",
    name: "Exames Ocupacionais a Vencer",
    notificationType: "USER",
    eventType: "medical_exam.expiring",
    description: "Exames ocupacionais (ASO) prestes a vencer dentro da janela de antecedência — alerta diário do DP/Medicina do Trabalho.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES", "ACCOUNTING"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Exames ocupacionais a vencer",
        body: "{{count}} exame(s) ocupacional(is) vencem nos próximos {{advanceDays}} dias{{#if employees}}: {{employees}}{{/if}}.",
      },
      push: {
        title: "Exames ocupacionais a vencer",
        body: "{{count}} exame(s) vencem em {{advanceDays}} dias{{#if employees}}: {{employees}}{{/if}}",
      },
      whatsapp: {
        body: "{{count}} exame(s) ocupacional(is) vencem nos próximos {{advanceDays}} dias{{#if employees}}: {{employees}}{{/if}}. Agende a renovação.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "medical-exam-alert.scheduler.ts dispatchByConfiguration(\"medical_exam.expiring\")",
      targeted: false,
    },
  },
  {
    key: "medical_exam.return_due",
    name: "Exame de Retorno ao Trabalho Pendente",
    notificationType: "USER",
    eventType: "medical_exam.return_due",
    description: "Exame de retorno ao trabalho (ASO de retorno) com data prevista vencida ou no prazo — alerta diário do DP/Medicina do Trabalho.",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES", "ACCOUNTING"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Exame de retorno ao trabalho pendente",
        body: "{{count}} exame(s) de retorno ao trabalho pendente(s){{#if employees}}: {{employees}}{{/if}}. Agende o ASO de retorno.",
      },
      push: {
        title: "Exame de retorno pendente",
        body: "{{count}} ASO de retorno pendente(s){{#if employees}}: {{employees}}{{/if}}",
      },
      whatsapp: {
        body: "{{count}} exame(s) de retorno ao trabalho pendente(s){{#if employees}}: {{employees}}{{/if}}. Agende o ASO de retorno.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "medical-exam-alert.scheduler.ts dispatchByConfiguration(\"medical_exam.return_due\")",
      targeted: false,
    },
  },
  // ─── ppe (EPI — @Cron PpeCaExpiryScheduler, NR-6) ──────────────────────────
  {
    key: "ppe.ca_expiry",
    name: "CA de EPI Vencido / a Vencer (NR-6)",
    notificationType: "STOCK",
    eventType: "ppe.ca_expiry",
    description: "Certificado de Aprovação (CA) de EPI vencido ou a vencer dentro da janela de antecedência — a entrega de EPI com CA vencido é bloqueada (NR-6).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES", "WAREHOUSE"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "CA de EPI vencido / a vencer (NR-6)",
        body: "{{expiredCount}} EPI(s) com CA vencido e {{expiringCount}} a vencer em {{advanceDays}} dias{{#if items}}: {{items}}{{/if}}. A entrega de EPI com CA vencido está bloqueada.",
      },
      push: {
        title: "CA de EPI vencido / a vencer",
        body: "{{expiredCount}} vencido(s), {{expiringCount}} a vencer{{#if items}}: {{items}}{{/if}}",
      },
      whatsapp: {
        body: "{{expiredCount}} EPI(s) com CA vencido e {{expiringCount}} a vencer em {{advanceDays}} dias{{#if items}}: {{items}}{{/if}}. Renove o CA — a entrega com CA vencido está bloqueada (NR-6).",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "ppe-ca-expiry.scheduler.ts dispatchByConfiguration(\"ppe.ca_expiry\")",
      targeted: false,
    },
  },
  // ─── vacation (férias — @Cron VacationNotificationScheduler, CLT art. 137) ──
  {
    key: "vacation.concessive_expired",
    name: "Férias Vencidas (Dobro)",
    notificationType: "USER",
    eventType: "vacation.concessive_expired",
    description: "Período concessivo de férias venceu sem gozo — as férias passam a ser devidas EM DOBRO (CLT art. 137). Providenciar pagamento.",
    enabled: true,
    importance: "URGENT",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES", "ACCOUNTING"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Férias vencidas (dobro)",
        body: "As férias de {{userName}} venceram o período concessivo sem gozo e agora são devidas EM DOBRO (CLT art. 137). Providencie o pagamento.",
      },
      push: {
        title: "Férias vencidas (dobro)",
        body: "Férias de {{userName}} vencidas — devidas em dobro (CLT 137).",
      },
      whatsapp: {
        body: "As férias de {{userName}} venceram o período concessivo sem gozo e agora são devidas EM DOBRO (CLT art. 137). Providencie o pagamento.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "vacation-notification.scheduler.ts dispatchByConfiguration(\"vacation.concessive_expired\")",
      targeted: false,
    },
  },
  {
    key: "vacation.concessive_expiring",
    name: "Período Concessivo de Férias Expirando",
    notificationType: "USER",
    eventType: "vacation.concessive_expiring",
    description: "Período concessivo de férias expirando dentro de 60 dias — conceder o gozo sob pena de pagamento em dobro (CLT art. 137).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES", "ACCOUNTING"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Período concessivo de férias expirando",
        body: "As férias de {{userName}} devem ser concedidas em até {{daysLeft}} dia(s), sob pena de pagamento em dobro (CLT art. 137). Agende o gozo.",
      },
      push: {
        title: "Concessivo de férias expirando",
        body: "Férias de {{userName}}: conceder em {{daysLeft}} dia(s) (CLT 137).",
      },
      whatsapp: {
        body: "As férias de {{userName}} devem ser concedidas em até {{daysLeft}} dia(s), sob pena de pagamento em dobro (CLT art. 137). Agende o gozo.",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "vacation-notification.scheduler.ts dispatchByConfiguration(\"vacation.concessive_expiring\")",
      targeted: false,
    },
  },
  {
    key: "vacation.planning_conflict",
    name: "Conflito no Planejamento de Férias",
    notificationType: "USER",
    eventType: "vacation.planning_conflict",
    description: "Gozo de férias agendado ultrapassa o fim do período concessivo — reagendar para evitar pagamento em dobro (CLT art. 137).",
    enabled: true,
    importance: "HIGH",
    workHoursOnly: true,
    batchingEnabled: false,
    maxFrequencyPerDay: null,
    deduplicationWindow: null,
    sectors: ["ADMIN", "HUMAN_RESOURCES", "ACCOUNTING"],
    channels: {
      IN_APP: { enabled: true, mandatory: true, defaultOn: true },
      PUSH: { enabled: true, mandatory: false, defaultOn: true },
      EMAIL: { enabled: false, mandatory: false, defaultOn: false },
      WHATSAPP: { enabled: false, mandatory: false, defaultOn: false },
    },
    templates: {
      inApp: {
        title: "Conflito no planejamento de férias",
        body: "O gozo agendado das férias de {{userName}} ultrapassa o fim do período concessivo. Reagende para evitar pagamento em dobro (CLT art. 137).",
      },
      push: {
        title: "Conflito no planejamento de férias",
        body: "Gozo de {{userName}} excede o concessivo — reagende (CLT 137).",
      },
      whatsapp: {
        body: "O gozo agendado das férias de {{userName}} ultrapassa o fim do período concessivo. Reagende para evitar pagamento em dobro (CLT art. 137).",
      },
    },
    metadata: {
      registry: "seed-notification-configs",
      trigger: "vacation-notification.scheduler.ts dispatchByConfiguration(\"vacation.planning_conflict\")",
      targeted: false,
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// FORCED `enabled` OVERRIDES (2026-06-10 audit) — the ONLY exceptions to the
// "never write `enabled` on update" rule. For keys listed here the declared
// `enabled` value is converged on UPDATE as well (and diffed accordingly).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verified-DEAD configs: no code path can ever fire them, so they are forced
 * to enabled:false on every run — an admin enabling them in the UI would only
 * create false expectations (the notification still would never arrive).
 */
const FORCE_DISABLE = new Set<string>([
  // The task model has no `priority` field; the field tracker never emits it.
  'task.field.priority',
  // Legacy umbrella event superseded by the per-status events; no emitter left.
  'task.status.changed',
  // Per-side truck layout fields were merged into the single
  // task.field.truck.layout event; the tracker no longer emits these three.
  'task.field.truck.backSideLayoutId',
  'task.field.truck.leftSideLayoutId',
  'task.field.truck.rightSideLayoutId',
  // The "Aguardando Arte" status is exclusive to COMMERCIAL service orders;
  // the artwork/logistic/production variants are unreachable.
  'service_order.waiting_artwork.artwork',
  'service_order.waiting_artwork.logistic',
  'service_order.waiting_artwork.production',
  // The "Aguardando Aprovação" status is exclusive to ARTWORK service orders;
  // the commercial/logistic/production variants are unreachable.
  'service_order.waiting_approval.commercial',
  'service_order.waiting_approval.logistic',
  'service_order.waiting_approval.production',
  // No emitter exists for the Secullum signature outcomes — the poller/webhook
  // that would fire these was deferred. Keep disabled until it lands.
  'secullum.signature.signed',
  'secullum.signature.rejected',
]);

/**
 * Forced back ON every run: task_quote.commercial_approved is the
 * COMMERCIAL→FINANCIAL billing handoff — it was found disabled in prod, which
 * silently drops the "billing can be approved" notification and stalls the
 * quote billing flow.
 */
const FORCE_ENABLE = new Set<string>(['task_quote.commercial_approved']);

/** Forced `enabled` value for a key, or null when the never-write rule applies. */
function forcedEnabled(key: string): boolean | null {
  if (FORCE_DISABLE.has(key)) return false;
  if (FORCE_ENABLE.has(key)) return true;
  return null;
}

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

/** Key-order-insensitive JSON stringify (Postgres jsonb does not preserve key order). */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(obj)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

type ConfigOutcome = 'created' | 'updated' | 'unchanged';

/**
 * Materialize a brand-new config graph inside a transaction: the
 * NotificationConfiguration (`enabled` from the declaration, set ONLY here on
 * create), its 1:1 NotificationTargetRule, and all four
 * NotificationChannelConfig rows. UserNotificationPreference is never touched.
 */
async function createConfigGraph(
  tx: Prisma.TransactionClient,
  def: ConfigDef,
): Promise<void> {
  const config = await tx.notificationConfiguration.create({
    data: {
      key: def.key,
      name: def.name,
      notificationType: def.notificationType,
      eventType: def.eventType,
      description: def.description,
      enabled: def.enabled,
      importance: def.importance,
      workHoursOnly: def.workHoursOnly,
      batchingEnabled: def.batchingEnabled,
      maxFrequencyPerDay: def.maxFrequencyPerDay,
      deduplicationWindow: def.deduplicationWindow,
      templates: def.templates as unknown as Prisma.InputJsonValue,
      metadata: def.metadata as Prisma.InputJsonValue,
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

  for (const ch of CHANNELS) {
    const flags = def.channels[ch];
    await tx.notificationChannelConfig.create({
      data: {
        configurationId: config.id,
        channel: ch,
        enabled: flags.enabled,
        mandatory: flags.mandatory,
        defaultOn: flags.defaultOn,
      },
    });
  }
}

interface ExistingRow {
  id: string;
  enabled: boolean;
  name: string | null;
  notificationType: string;
  eventType: string;
  description: string | null;
  importance: string;
  workHoursOnly: boolean;
  batchingEnabled: boolean;
  maxFrequencyPerDay: number | null;
  deduplicationWindow: number | null;
  templates: unknown;
  metadata: unknown;
  targetRule: { allowedSectors: string[] } | null;
  channelConfigs: {
    channel: string;
    enabled: boolean;
    mandatory: boolean;
    defaultOn: boolean;
  }[];
}

const EXISTING_SELECT = {
  id: true,
  enabled: true,
  name: true,
  notificationType: true,
  eventType: true,
  description: true,
  importance: true,
  workHoursOnly: true,
  batchingEnabled: true,
  maxFrequencyPerDay: true,
  deduplicationWindow: true,
  templates: true,
  metadata: true,
  targetRule: { select: { allowedSectors: true } },
  channelConfigs: {
    select: {
      channel: true,
      enabled: true,
      mandatory: true,
      defaultOn: true,
    },
  },
} as const;

/**
 * Decide whether an existing config row differs from the declared definition,
 * IGNORING the `enabled` flag (which we never touch on update) — EXCEPT for
 * FORCE_DISABLE/FORCE_ENABLE keys, whose forced value is diffed too. Channel,
 * frequency, metadata and target-rule diffs are folded in so --dry-run (and the
 * write-skip for unchanged rows) is accurate.
 */
function diffExisting(def: ConfigDef, existing: ExistingRow): boolean {
  const forced = forcedEnabled(def.key);
  if (forced !== null && existing.enabled !== forced) return true;
  if (existing.name !== def.name) return true;
  if (existing.notificationType !== def.notificationType) return true;
  if (existing.eventType !== def.eventType) return true;
  if (existing.description !== def.description) return true;
  if (existing.importance !== def.importance) return true;
  if (existing.workHoursOnly !== def.workHoursOnly) return true;
  if (existing.batchingEnabled !== def.batchingEnabled) return true;
  if (existing.maxFrequencyPerDay !== def.maxFrequencyPerDay) return true;
  if (existing.deduplicationWindow !== def.deduplicationWindow) return true;
  if (stableStringify(existing.templates) !== stableStringify(def.templates))
    return true;
  if (stableStringify(existing.metadata) !== stableStringify(def.metadata))
    return true;

  // Target rule sectors (order-insensitive)
  const wantSectors = [...def.sectors].sort();
  const haveSectors = [...(existing.targetRule?.allowedSectors ?? [])].sort();
  if (JSON.stringify(wantSectors) !== JSON.stringify(haveSectors)) return true;

  // Channels: all four rows must exist with the declared flags.
  const haveByChannel = new Map(
    existing.channelConfigs.map((c) => [c.channel, c]),
  );
  for (const ch of CHANNELS) {
    const want = def.channels[ch];
    const have = haveByChannel.get(ch);
    if (!have) return true;
    if (
      have.enabled !== want.enabled ||
      have.mandatory !== want.mandatory ||
      have.defaultOn !== want.defaultOn
    )
      return true;
  }

  return false;
}

/**
 * Upsert one config by key.
 * - CREATE: full graph, `enabled` from the declaration (only place it is set).
 * - UPDATE: converge every owned field EXCEPT `enabled`; upsert target rule and
 *   all four channel rows; skip the write entirely when nothing differs.
 * - In --dry-run mode, a pending rename (old key still in DB) is diffed against
 *   the OLD row so the report matches what the real run would do.
 */
async function upsertConfig(
  def: ConfigDef,
  pendingRenameOldKey?: string,
): Promise<ConfigOutcome> {
  let existing = (await prisma.notificationConfiguration.findUnique({
    where: { key: def.key },
    select: EXISTING_SELECT,
  })) as ExistingRow | null;

  // Dry-run only: the rename was not applied, so diff against the old row.
  if (!existing && DRY_RUN && pendingRenameOldKey) {
    existing = (await prisma.notificationConfiguration.findUnique({
      where: { key: pendingRenameOldKey },
      select: EXISTING_SELECT,
    })) as ExistingRow | null;
  }

  if (!existing) {
    if (DRY_RUN) return 'created';
    await prisma.$transaction(async (tx) => {
      await createConfigGraph(tx, def);
    });
    return 'created';
  }

  if (!diffExisting(def, existing)) return 'unchanged';
  if (DRY_RUN) return 'updated';

  await prisma.$transaction(async (tx) => {
    // NOTE: `enabled` is intentionally OMITTED so an intentionally-disabled
    // config is never re-enabled — EXCEPT for FORCE_DISABLE/FORCE_ENABLE keys
    // (verified-dead configs / the re-enabled billing handoff), whose declared
    // value is converged on update as well.
    const config = await tx.notificationConfiguration.update({
      where: { key: def.key },
      data: {
        ...(forcedEnabled(def.key) !== null ? { enabled: def.enabled } : {}),
        name: def.name,
        notificationType: def.notificationType,
        eventType: def.eventType,
        description: def.description,
        importance: def.importance,
        workHoursOnly: def.workHoursOnly,
        batchingEnabled: def.batchingEnabled,
        maxFrequencyPerDay: def.maxFrequencyPerDay,
        deduplicationWindow: def.deduplicationWindow,
        templates: def.templates as unknown as Prisma.InputJsonValue,
        metadata: def.metadata as Prisma.InputJsonValue,
        // enabled: NOT WRITTEN ON UPDATE except via the forced spread above
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

    // Upsert all four channel rows by composite (configurationId, channel).
    for (const ch of CHANNELS) {
      const flags = def.channels[ch];
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
          enabled: flags.enabled,
          mandatory: flags.mandatory,
          defaultOn: flags.defaultOn,
        },
        update: {
          enabled: flags.enabled,
          mandatory: flags.mandatory,
          defaultOn: flags.defaultOn,
        },
      });
    }

    // Harmless: all four channels are always declared, so nothing matches.
    await tx.notificationChannelConfig.deleteMany({
      where: {
        configurationId: config.id,
        channel: { notIn: CHANNELS },
      },
    });
  });

  return 'updated';
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const targets = ONLY ? CONFIGS.filter((c) => ONLY.includes(c.key)) : CONFIGS;

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  SEED: Notification Configurations (registro completo)');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Modo:    ${DRY_RUN ? 'DRY-RUN (sem gravações)' : 'GRAVANDO'}`);
  console.log(
    `  Escopo:  ${ONLY ? `--only=${ONLY.join(',')}` : 'todos os configs'}`,
  );
  console.log(`  Configs: ${targets.length} de ${CONFIGS.length}`);
  if (ONLY) {
    const unknown = ONLY.filter((k) => !CONFIGS.some((c) => c.key === k));
    if (unknown.length > 0) {
      console.warn(`  ⚠ Chaves desconhecidas ignoradas: ${unknown.join(', ')}`);
    }
  }
  console.log('──────────────────────────────────────────────────────────\n');

  // ── RENAMES pre-pass (rename-in-place preserves ids + user preferences) ────
  const targetKeys = new Set(targets.map((t) => t.key));
  /** newKey → oldKey, for renames that are still pending (dry-run only). */
  const pendingRenames = new Map<string, string>();
  let renamed = 0;

  console.log('  RENAMES:');
  for (const [oldKey, newKey] of Object.entries(RENAMES)) {
    if (!targetKeys.has(newKey)) continue;
    const oldRow = await prisma.notificationConfiguration.findUnique({
      where: { key: oldKey },
      select: { id: true },
    });
    if (!oldRow) {
      console.log(`   ⤳ ${oldKey} → ${newKey} — já aplicado (chave antiga ausente)`);
      continue;
    }
    const newRow = await prisma.notificationConfiguration.findUnique({
      where: { key: newKey },
      select: { id: true },
    });
    if (newRow) {
      console.warn(
        `   ⚠ ${oldKey} e ${newKey} existem AMBOS — rename pulado, resolver manualmente`,
      );
      continue;
    }
    if (DRY_RUN) {
      pendingRenames.set(newKey, oldKey);
      console.log(`   ↻ ${oldKey} → ${newKey} — seria renomeado`);
    } else {
      await prisma.notificationConfiguration.update({
        where: { key: oldKey },
        data: { key: newKey },
      });
      renamed++;
      console.log(`   ↻ ${oldKey} → ${newKey} — renomeado`);
    }
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  console.log('\n  CONFIGS (upsert):');
  for (const def of targets) {
    try {
      const outcome = await upsertConfig(def, pendingRenames.get(def.key));
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

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  Resumo');
  console.log('──────────────────────────────────────────────────────────');
  console.log(
    `   Renomeados:     ${DRY_RUN ? pendingRenames.size : renamed}${DRY_RUN && pendingRenames.size > 0 ? ' (pendente)' : ''}`,
  );
  console.log(`   Criados:        ${created}`);
  console.log(`   Atualizados:    ${updated}`);
  console.log(`   Sem alterações: ${unchanged}`);
  if (errors > 0) console.log(`   Erros:          ${errors}`);
  console.log(`   Total:          ${targets.length}`);
  if (DRY_RUN) {
    console.log(
      '\n  DRY-RUN: nenhuma gravação foi feita. Rode sem --dry-run para aplicar.',
    );
  }
  console.log(
    '\n  Garantias: `enabled` nunca é alterado em update (exceto chaves FORCE_DISABLE/FORCE_ENABLE documentadas no script); renames preservam ids e preferências; UserNotificationPreference nunca é tocado; EMAIL desabilitado em todos os canais (decisão atual).',
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
