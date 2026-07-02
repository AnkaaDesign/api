// Global spotlight search types (GET /search)

export type GlobalSearchEntity = 'TASK' | 'ITEM' | 'ORDER' | 'USER' | 'PAINT' | 'CUSTOMER' | 'SUPPLIER';

export interface GlobalSearchResultField {
  /** Label for identifier-like values ("Nº série", "Matrícula", "CNPJ"); omitted for self-evident names. */
  label?: string;
  value: string;
}

export interface GlobalSearchResultItem {
  entity: GlobalSearchEntity;
  id: string;
  title: string;
  /** Identity line rendered under the title as "Label value · Label value · ...". */
  fields?: GlobalSearchResultField[] | null;
  /** Raw status enum value (e.g. TaskStatus, OrderStatus, ContractStatus, PaintFinish) — label/badge mapping happens on the client. */
  status?: string | null;
  /** Pre-computed status label when the entity's status is derived (e.g. collaborator situação: Efetivado / Em experiência 1). Takes precedence over client enum-label maps. */
  statusLabel?: string | null;
  /** Badge variant for statusLabel (green/red/blue/orange/teal/purple/gray). */
  statusVariant?: string | null;
  /** Hex color for entities with a visual identity (Paint). */
  color?: string | null;
  /** Contextual date shown on the row (e.g. "Concluída em" + finishedAt ISO). Client formats. */
  date?: { label: string; iso: string } | null;
  /** Trailing right-aligned info (e.g. item quantity). */
  extra?: string | null;
  /** Why this result matched, when the winning field is not visible in the row (CPF, phone, paint relation, notes...). */
  match?: { label: string; value: string } | null;
  /** Relevance score used for intra-group and inter-group ordering. */
  score: number;
}

export interface GlobalSearchGroup {
  entity: GlobalSearchEntity;
  label: string;
  items: GlobalSearchResultItem[];
}

export interface GlobalSearchData {
  query: string;
  groups: GlobalSearchGroup[];
  tookMs: number;
}

export interface GlobalSearchResponse {
  success: boolean;
  message: string;
  data?: GlobalSearchData;
}
