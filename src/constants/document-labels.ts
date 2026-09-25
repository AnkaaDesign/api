/**
 * A FONTE ÚNICA DOS RÓTULOS DE CATEGORIA E DE IMPLEMENTO — um perfil por documento.
 *
 * Por que PERFIS, e não um mapa só (D-18)
 * ─────────────────────────────────────────────────────────────────────────────
 * Os documentos que nomeiam o veículo NÃO falam a mesma língua, e isso é o
 * texto que já está na prefeitura e no banco:
 *
 *   - a NFS-e da tarefa (Elotech) diz "Carga seca", "Isotérmico",
 *     "Prancha/Plataforma";
 *   - o boleto, a fatura e a NFS-e do aerografista dizem "Carga Seca",
 *     "Isoplastic", "Carroceria" — as palavras da TELA.
 *
 * "Nenhuma palavra muda na nota até o dono escolher" (pergunta 22 do plano)
 * quer dizer que CADA documento continua com o texto de hoje. Um mapa único
 * que unificasse os quatro dicionários já mudaria dois documentos. Por isso
 * cada documento tem o SEU perfil aqui, escrito por extenso, e nenhum perfil é
 * derivado de outro: a NFS-e do aerografista lia o mapa da tela, e bastava
 * alguém renomear um rótulo de tela para mudar a nota dele sem saber.
 *
 * Quando o dono escolher as palavras, os perfis convergem AQUI — e o teste de
 * ouro (`tests/fiscal-labels-golden.test.ts`) é o que diz quais documentos a
 * escolha mudou.
 *
 * Quem lê cada perfil:
 *   screen       → `enum-labels.ts` (os mapas de tela de categoria e de tipo):
 *                  telas, changelog da API, notificações, documento do orçamento
 *                  assinado (`quote-text.ts`, cujo hash é travado em
 *                  `tests/signature-golden-hashes.test.ts`);
 *   nfseTask     → `elotech-oxy-nfse.service.ts` e `nfse-discriminacao.ts`;
 *   nfsePainter  → `painter/dps.builder.ts` (xDescServ da DPS nacional);
 *   boleto       → `sicredi-boleto.scheduler.ts` (informativo da varredura);
 *   invoice      → `invoice-generation.service.ts` (informativo do registro
 *                  embutido na aprovação);
 *   webChangelog → o histórico de alterações do web
 *                  (`web/src/utils/changelog-fields.ts`), que tem palavras
 *                  próprias ("VUC (Veículo Urbano de Carga)", "Caminhão").
 *
 * Web e app recebem estes perfis pelo contrato gerado
 * (`scripts/export-contracts.ts` → `contracts/labels.json`); ninguém copia
 * mapa à mão.
 *
 * ⚠️ Acrescentar valor ao enum de categoria ou ao de tipo obriga a
 * acrescentá-lo em TODOS os perfis (o tipo `Record<ENUM, string>` recusa o
 * mapa incompleto, e `tests/labels-exhaustive.test.ts` confere em runtime).
 * Valor fora do enum passa CRU nos documentos (`map[v] ?? v`), nunca some.
 */
import { IMPLEMENT_TYPE, IMPLEMENT_CATEGORY } from './enums';

/**
 * As chaves dos mapas abaixo são LITERAIS ('MINI', 'VUC'…), e o tipo
 * `Record<Category, …>` recusa a chave que faltar ou sobrar.
 */
type Category = IMPLEMENT_CATEGORY;

export const LABEL_PROFILES = [
  'screen',
  'nfseTask',
  'nfsePainter',
  'boleto',
  'invoice',
  'webChangelog',
] as const;

export type LabelProfile = (typeof LABEL_PROFILES)[number];

/** Quem lê cada perfil (vai para o contrato exportado). */
export const LABEL_PROFILE_READERS: Readonly<Record<LabelProfile, string>> = Object.freeze({
  screen: 'telas (api, web, app), changelog da api, notificações, documento do orçamento assinado',
  nfseTask: 'NFS-e da tarefa (Elotech: discriminação) e as prévias dela no web e no app',
  nfsePainter: 'NFS-e do aerografista (DPS nacional, xDescServ)',
  boleto: 'informativo do boleto registrado pela varredura (sicredi-boleto.scheduler)',
  invoice: 'informativo do boleto registrado na aprovação (invoice-generation) e a prévia do web',
  webChangelog: 'histórico de alterações do web (changelog-fields.ts)',
});

type Labels<E extends string> = Readonly<Record<E, string>>;

const freeze = <E extends string>(labels: Record<E, string>): Labels<E> => Object.freeze(labels);

// ═══════════════════════════════════════════════════════════════════════════
// Categoria do veículo
// ═══════════════════════════════════════════════════════════════════════════

export const CATEGORY_PROFILE_LABELS: Readonly<Record<LabelProfile, Labels<Category>>> =
  Object.freeze({
    screen: freeze<Category>({
      MINI: 'Mini',
      VUC: 'VUC',
      THREE_QUARTER: '3/4',
      RIGID: 'Toco',
      TRUCK: 'Truck',
      SEMI_TRAILER: 'Semirreboque',
      SEMI_TRAILER_2_AXLES: 'Semirreboque 2 Eixos',
      B_DOUBLE_FRONT: 'Bitrem Composição Dianteira',
      B_DOUBLE_REAR: 'Bitrem Composição Traseira',
      BITRUCK: 'Bitruck',
    }),
    nfseTask: freeze<Category>({
      MINI: 'Mini',
      VUC: 'VUC',
      THREE_QUARTER: '3/4',
      RIGID: 'Toco',
      TRUCK: 'Truck',
      SEMI_TRAILER: 'Semirreboque',
      SEMI_TRAILER_2_AXLES: 'Semirreboque 2 Eixos',
      B_DOUBLE_FRONT: 'Bitrem Composição Dianteira',
      B_DOUBLE_REAR: 'Bitrem Composição Traseira',
      BITRUCK: 'Bitruck',
    }),
    nfsePainter: freeze<Category>({
      MINI: 'Mini',
      VUC: 'VUC',
      THREE_QUARTER: '3/4',
      RIGID: 'Toco',
      TRUCK: 'Truck',
      SEMI_TRAILER: 'Semirreboque',
      SEMI_TRAILER_2_AXLES: 'Semirreboque 2 Eixos',
      B_DOUBLE_FRONT: 'Bitrem Composição Dianteira',
      B_DOUBLE_REAR: 'Bitrem Composição Traseira',
      BITRUCK: 'Bitruck',
    }),
    boleto: freeze<Category>({
      MINI: 'Mini',
      VUC: 'VUC',
      THREE_QUARTER: '3/4',
      RIGID: 'Toco',
      TRUCK: 'Truck',
      SEMI_TRAILER: 'Semirreboque',
      SEMI_TRAILER_2_AXLES: 'Semirreboque 2 Eixos',
      B_DOUBLE_FRONT: 'Bitrem Composição Dianteira',
      B_DOUBLE_REAR: 'Bitrem Composição Traseira',
      BITRUCK: 'Bitruck',
    }),
    invoice: freeze<Category>({
      MINI: 'Mini',
      VUC: 'VUC',
      THREE_QUARTER: '3/4',
      RIGID: 'Toco',
      TRUCK: 'Truck',
      SEMI_TRAILER: 'Semirreboque',
      SEMI_TRAILER_2_AXLES: 'Semirreboque 2 Eixos',
      B_DOUBLE_FRONT: 'Bitrem Composição Dianteira',
      B_DOUBLE_REAR: 'Bitrem Composição Traseira',
      BITRUCK: 'Bitruck',
    }),
    webChangelog: freeze<Category>({
      MINI: 'Mini',
      VUC: 'VUC (Veículo Urbano de Carga)',
      THREE_QUARTER: '3/4',
      RIGID: 'Toco',
      TRUCK: 'Caminhão',
      SEMI_TRAILER: 'Semirreboque',
      SEMI_TRAILER_2_AXLES: 'Semirreboque 2 Eixos',
      B_DOUBLE_FRONT: 'Bitrem Composição Dianteira',
      B_DOUBLE_REAR: 'Bitrem Composição Traseira',
      BITRUCK: 'Bitruck',
    }),
  });

// ═══════════════════════════════════════════════════════════════════════════
// Tipo do implemento
// ═══════════════════════════════════════════════════════════════════════════

export const IMPLEMENT_TYPE_PROFILE_LABELS: Readonly<Record<LabelProfile, Labels<IMPLEMENT_TYPE>>> =
  Object.freeze({
    screen: freeze<IMPLEMENT_TYPE>({
      DRY_CARGO: 'Carga Seca',
      REFRIGERATED: 'Refrigerado',
      INSULATED: 'Isoplastic',
      CURTAIN_SIDE: 'Sider',
      TANK: 'Tanque',
      FLATBED: 'Carroceria',
    }),
    // ⚠️ "Carga seca" com s minúsculo, "Isotérmico" e "Prancha/Plataforma":
    // é o texto de todas as NFS-e de tarefa emitidas até hoje.
    nfseTask: freeze<IMPLEMENT_TYPE>({
      DRY_CARGO: 'Carga seca',
      REFRIGERATED: 'Refrigerado',
      INSULATED: 'Isotérmico',
      CURTAIN_SIDE: 'Sider',
      TANK: 'Tanque',
      FLATBED: 'Prancha/Plataforma',
    }),
    nfsePainter: freeze<IMPLEMENT_TYPE>({
      DRY_CARGO: 'Carga Seca',
      REFRIGERATED: 'Refrigerado',
      INSULATED: 'Isoplastic',
      CURTAIN_SIDE: 'Sider',
      TANK: 'Tanque',
      FLATBED: 'Carroceria',
    }),
    boleto: freeze<IMPLEMENT_TYPE>({
      DRY_CARGO: 'Carga Seca',
      REFRIGERATED: 'Refrigerado',
      INSULATED: 'Isoplastic',
      CURTAIN_SIDE: 'Sider',
      TANK: 'Tanque',
      FLATBED: 'Carroceria',
    }),
    invoice: freeze<IMPLEMENT_TYPE>({
      DRY_CARGO: 'Carga Seca',
      REFRIGERATED: 'Refrigerado',
      INSULATED: 'Isoplastic',
      CURTAIN_SIDE: 'Sider',
      TANK: 'Tanque',
      FLATBED: 'Carroceria',
    }),
    webChangelog: freeze<IMPLEMENT_TYPE>({
      DRY_CARGO: 'Carga Seca',
      REFRIGERATED: 'Refrigerado',
      INSULATED: 'Isoplastic',
      CURTAIN_SIDE: 'Sider',
      TANK: 'Tanque',
      FLATBED: 'Carroceria',
    }),
  });

