/**
 * V2 plan builder — converte o `artifact.layout` do engine (bandas por faixa,
 * papel, janelas por sessão) na sequência de passos de produção com cenas de
 * visualização autocontidas (rects acumulados com phase PRIOR|CURRENT).
 *
 * Decisões (api/PAINTING_V2_SYNTHESIS.md):
 * - consumo de tinta/tempo de pintura pela ÁREA DA JANELA, nunca vetorial;
 * - ordenação de sessões: contenção de janelas (quem contém pinta primeiro —
 *   caso bandeira: verde→amarelo→azul) sobrepõe a ordem default do engine;
 * - CURA 3h somente entre sessões cujas janelas se tocam (±margem);
 * - cena por passo é completa: o cliente nunca acumula estado.
 */

// ---- espelhos do JSON do engine (artifact.layout) --------------------------

export interface LayoutRectJson {
  id: string;
  kind: 'ADHESIVE_BAND' | 'PAPER' | 'PAINT_WINDOW';
  x: number;
  y: number;
  w: number;
  h: number;
  areaM2: number;
  widthClass?: number;
  rollWidthCm?: number;
  color?: string;
  colorIndex?: number;
  sessionId?: string;
  stripId?: string;
  splices?: number;
}

export interface LayoutStepJson {
  stepId: string;
  order: number;
  kind: 'APPLY_BANDS' | 'PAPER' | 'PAINT_GENERAL' | 'PAINT_SESSION';
  sessionId: string | null;
  title: string;
  visuals: LayoutRectJson[];
}

export interface LayoutSessionJson {
  id: string;
  order: number;
  kind: 'GERAL' | 'COR' | 'AEROGRAFIA';
  colorIndexes: number[];
  hexes: string[];
}

export interface FaceLayoutJson {
  face: { widthCm: number; heightCm: number; backgroundMode: string };
  sessions: LayoutSessionJson[];
  stepVisuals: LayoutStepJson[];
  totals: {
    adhesiveLinearMByWidth?: Record<string, number>;
    adhesiveAreaM2?: number;
    elementAreaM2?: number;
    adhesiveWasteM2?: number;
    transferLinearM?: number;
    paperAreaM2?: number;
    paperPanelCount?: number;
    tapeCrepeM?: number;
    paintWindowAreaM2BySession?: Record<string, number>;
    paintWindowAreaM2ByColor?: Record<string, number>;
  };
  alerts?: Array<{ code: string; severity: string; message: string }>;
}

// ---- contrato do cliente (step.visualization) ------------------------------

export interface VisualizationRect {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'ADHESIVE_BAND' | 'PAPER' | 'PAINT_WINDOW';
  phase: 'PRIOR' | 'CURRENT';
  color?: string | null;
  label?: string | null;
}

export interface StepVisualization {
  baseMode: 'BW' | 'COLOR';
  rects: VisualizationRect[];
}

// ---- normalização do JSON do engine ----------------------------------------

/** Rect cru do engine (masks.layout_to_json): xCm/yCm/wCm/hCm. */
interface RawRect {
  id: string;
  xCm: number;
  yCm: number;
  wCm: number;
  hCm: number;
  widthClassCm?: number;
  level?: number;
  splices?: number;
}

/**
 * Converte o `artifact.layout` emitido pelo engine 0.2 (strips/paper/sessions/
 * steps com chaves *Cm) para o schema interno FaceLayoutJson (stepVisuals com
 * rects x/y/w/h + areaM2). Aceita também o shape já normalizado (passthrough).
 */
export function normalizeLayout(raw: any): FaceLayoutJson | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.face && Array.isArray(raw.stepVisuals)) return raw as FaceLayoutJson;
  if (!Array.isArray(raw.steps) || !Array.isArray(raw.sessions)) return null;

  const rect = (
    r: RawRect,
    kind: LayoutRectJson['kind'],
    extra: Partial<LayoutRectJson> = {},
  ): LayoutRectJson => ({
    id: r.id,
    kind,
    x: r.xCm,
    y: r.yCm,
    w: r.wCm,
    h: r.hCm,
    areaM2: Number(((r.wCm * r.hCm) / 10_000).toFixed(4)),
    widthClass: r.widthClassCm,
    splices: r.splices,
    ...extra,
  });

  const bands: LayoutRectJson[] = (raw.strips ?? []).flatMap((strip: any) =>
    (strip.bands ?? []).map((band: RawRect) => rect(band, 'ADHESIVE_BAND', { stripId: strip.id })),
  );
  const papers: LayoutRectJson[] = (raw.paper?.panels ?? []).map((panel: RawRect) =>
    rect(panel, 'PAPER'),
  );

  const sessions: LayoutSessionJson[] = (raw.sessions ?? []).map((session: any, index: number) => ({
    id: session.id,
    order: index + 1,
    kind: session.kind === 'GENERAL' ? 'GERAL' : session.kind === 'AEROGRAFIA' ? 'AEROGRAFIA' : 'COR',
    colorIndexes: session.colorIndexes ?? [],
    hexes: session.hexes ?? [],
  }));
  const windowsBySession = new Map<string, LayoutRectJson[]>(
    (raw.sessions ?? []).map((session: any) => [
      session.id,
      (session.windows ?? []).map((window: RawRect) =>
        rect(window, 'PAINT_WINDOW', { sessionId: session.id, color: session.hexes?.[0] ?? undefined }),
      ),
    ]),
  );

  const stepVisuals: LayoutStepJson[] = (raw.steps ?? []).map((step: any, index: number) => {
    const kind = step.kind as LayoutStepJson['kind'];
    let visuals: LayoutRectJson[] = [];
    if (kind === 'APPLY_BANDS') visuals = bands;
    else if (kind === 'PAPER') visuals = papers;
    else if (kind === 'PAINT_SESSION' || kind === 'PAINT_GENERAL') {
      visuals = windowsBySession.get(step.sessionId ?? '') ?? [];
    }
    return {
      stepId: step.id ?? `step-${index + 1}`,
      order: index + 1,
      kind,
      sessionId: step.sessionId ?? null,
      title: step.title ?? '',
      visuals,
    };
  });

  const rawTotals = raw.totals ?? {};
  const tapeCrepe = raw.paper?.tapeCrepeM ?? rawTotals.tapeCrepeM;
  const tapeCrepeM =
    typeof tapeCrepe === 'number'
      ? tapeCrepe
      : Number(tapeCrepe?.perimeterM ?? 0) + Number(tapeCrepe?.seamsM ?? 0);

  return {
    face: {
      widthCm: Number(raw.faceWidthCm ?? 0),
      heightCm: Number(raw.faceHeightCm ?? 0),
      backgroundMode: raw.mode ?? 'WHITE_PLATE',
    },
    sessions,
    stepVisuals,
    totals: { ...rawTotals, tapeCrepeM },
    alerts: raw.alerts ?? [],
  };
}

// ---- cena acumulada --------------------------------------------------------

const round1 = (value: number) => Math.round(value * 10) / 10;

function toVisRect(rect: LayoutRectJson, phase: 'PRIOR' | 'CURRENT'): VisualizationRect {
  return {
    x: round1(rect.x),
    y: round1(rect.y),
    w: round1(rect.w),
    h: round1(rect.h),
    kind: rect.kind,
    phase,
    color: rect.color ?? null,
    label:
      rect.kind === 'ADHESIVE_BAND' && rect.widthClass
        ? String(Math.round(rect.widthClass))
        : rect.kind === 'PAPER' && rect.rollWidthCm
          ? String(Math.round(rect.rollWidthCm))
          : null,
  };
}

export class SceneBuilder {
  private bands: LayoutRectJson[] = [];
  private papers: LayoutRectJson[] = [];
  private paintedWindows: Array<LayoutRectJson & { paintedColor: string | null }> = [];

  addBands(rects: LayoutRectJson[]) {
    this.bands.push(...rects);
  }

  addPapers(rects: LayoutRectJson[]) {
    this.papers.push(...rects);
  }

  markPainted(rects: LayoutRectJson[], color: string | null) {
    for (const rect of rects) {
      this.paintedWindows.push({ ...rect, paintedColor: color ?? rect.color ?? null });
    }
  }

  removeMasking() {
    this.bands = [];
    this.papers = [];
  }

  /** Cena completa do passo: acumulado como PRIOR + `current` como CURRENT. */
  scene(options: {
    baseMode: 'BW' | 'COLOR';
    currentBands?: LayoutRectJson[];
    currentPapers?: LayoutRectJson[];
    currentWindows?: LayoutRectJson[];
    currentColor?: string | null;
  }): StepVisualization {
    const currentIds = new Set(
      [
        ...(options.currentBands ?? []),
        ...(options.currentPapers ?? []),
        ...(options.currentWindows ?? []),
      ].map((rect) => rect.id),
    );
    const rects: VisualizationRect[] = [];
    for (const window of this.paintedWindows) {
      if (currentIds.has(window.id)) continue;
      rects.push({ ...toVisRect(window, 'PRIOR'), color: window.paintedColor });
    }
    for (const paper of this.papers) {
      if (currentIds.has(paper.id)) continue;
      rects.push(toVisRect(paper, 'PRIOR'));
    }
    for (const band of this.bands) {
      if (currentIds.has(band.id)) continue;
      rects.push(toVisRect(band, 'PRIOR'));
    }
    for (const rect of options.currentWindows ?? []) {
      rects.push({ ...toVisRect(rect, 'CURRENT'), color: options.currentColor ?? rect.color ?? null });
    }
    for (const rect of options.currentPapers ?? []) {
      rects.push(toVisRect(rect, 'CURRENT'));
    }
    for (const rect of options.currentBands ?? []) {
      rects.push(toVisRect(rect, 'CURRENT'));
    }
    return { baseMode: options.baseMode, rects };
  }
}

// ---- ordenação de sessões --------------------------------------------------

export interface OrderedSession {
  session: LayoutSessionJson;
  windows: LayoutRectJson[];
  /** true quando a sessão anterior emitida toca/contém esta → CURA antes. */
  needsCureBefore: boolean;
}

const CONTACT_MARGIN_CM = 5;

function rectsTouch(a: LayoutRectJson, b: LayoutRectJson, marginCm = CONTACT_MARGIN_CM): boolean {
  return !(
    a.x + a.w + marginCm < b.x ||
    b.x + b.w + marginCm < a.x ||
    a.y + a.h + marginCm < b.y ||
    b.y + b.h + marginCm < a.y
  );
}

function rectContains(outer: LayoutRectJson, inner: LayoutRectJson, tolCm = 2): boolean {
  return (
    inner.x >= outer.x - tolCm &&
    inner.y >= outer.y - tolCm &&
    inner.x + inner.w <= outer.x + outer.w + tolCm &&
    inner.y + inner.h <= outer.y + outer.h + tolCm &&
    inner.w * inner.h < outer.w * outer.h
  );
}

function sessionsTouch(a: LayoutRectJson[], b: LayoutRectJson[]): boolean {
  return a.some((ra) => b.some((rb) => rectsTouch(ra, rb)));
}

function sessionContains(a: LayoutRectJson[], b: LayoutRectJson[]): boolean {
  // "A contém B": toda janela de B está dentro de alguma janela de A
  return b.length > 0 && b.every((rb) => a.some((ra) => rectContains(ra, rb)));
}

/**
 * Ordena as sessões de cor: contenção de janelas (pai antes do filho — caso
 * bandeira) via ordenação topológica; empates seguem a ordem do engine
 * (claras→escuras); AEROGRAFIA sempre por último. Marca as curas necessárias.
 */
export function orderSessions(
  layout: FaceLayoutJson,
): OrderedSession[] {
  const windowsBySession = new Map<string, LayoutRectJson[]>();
  for (const step of layout.stepVisuals) {
    if (step.kind !== 'PAINT_SESSION' && step.kind !== 'PAINT_GENERAL') continue;
    const windows = step.visuals.filter((rect) => rect.kind === 'PAINT_WINDOW');
    if (step.sessionId) windowsBySession.set(step.sessionId, windows);
  }

  const sessions = [...layout.sessions]
    .filter((session) => session.kind !== 'GERAL')
    .sort((a, b) => a.order - b.order);

  // grafo de contenção: aresta pai→filho
  const edges = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const session of sessions) {
    edges.set(session.id, new Set());
    indegree.set(session.id, 0);
  }
  for (const a of sessions) {
    for (const b of sessions) {
      if (a.id === b.id) continue;
      const winA = windowsBySession.get(a.id) ?? [];
      const winB = windowsBySession.get(b.id) ?? [];
      if (sessionContains(winA, winB) && !edges.get(b.id)!.has(a.id)) {
        if (!edges.get(a.id)!.has(b.id)) {
          edges.get(a.id)!.add(b.id);
          indegree.set(b.id, (indegree.get(b.id) ?? 0) + 1);
        }
      }
    }
  }

  // Kahn estável: fila mantém a ordem do engine; AEROGRAFIA empurrada p/ o fim
  const result: LayoutSessionJson[] = [];
  const ready = sessions.filter((session) => (indegree.get(session.id) ?? 0) === 0);
  const queued = new Set(ready.map((session) => session.id));
  while (ready.length > 0) {
    ready.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'AEROGRAFIA' ? 1 : -1;
      return a.order - b.order;
    });
    const next = ready.shift()!;
    result.push(next);
    for (const childId of edges.get(next.id) ?? []) {
      indegree.set(childId, (indegree.get(childId) ?? 1) - 1);
      if ((indegree.get(childId) ?? 0) === 0 && !queued.has(childId)) {
        const child = sessions.find((session) => session.id === childId);
        if (child) {
          ready.push(child);
          queued.add(childId);
        }
      }
    }
  }
  // ciclo (não deveria ocorrer): anexa o que sobrou na ordem do engine
  for (const session of sessions) {
    if (!result.includes(session)) result.push(session);
  }

  const ordered: OrderedSession[] = [];
  for (let index = 0; index < result.length; index += 1) {
    const session = result[index];
    const windows = windowsBySession.get(session.id) ?? [];
    let needsCureBefore = false;
    if (index > 0) {
      const previousWindows = windowsBySession.get(result[index - 1].id) ?? [];
      needsCureBefore = sessionsTouch(previousWindows, windows);
    }
    ordered.push({ session, windows, needsCureBefore });
  }
  return ordered;
}

// ---- agregados úteis -------------------------------------------------------

export function bandRects(layout: FaceLayoutJson): LayoutRectJson[] {
  const step = layout.stepVisuals.find((item) => item.kind === 'APPLY_BANDS');
  return step?.visuals.filter((rect) => rect.kind === 'ADHESIVE_BAND') ?? [];
}

export function paperRects(layout: FaceLayoutJson): LayoutRectJson[] {
  const step = layout.stepVisuals.find((item) => item.kind === 'PAPER');
  return step?.visuals.filter((rect) => rect.kind === 'PAPER') ?? [];
}

export function generalPaintStep(layout: FaceLayoutJson): LayoutStepJson | undefined {
  return layout.stepVisuals.find((item) => item.kind === 'PAINT_GENERAL');
}

/** m lineares de adesivo por classe de largura, para materiais com sizeLabel. */
export function adhesiveMaterialsByWidth(
  layout: FaceLayoutJson,
): Array<{ widthCm: number; linearM: number }> {
  const byWidth = layout.totals.adhesiveLinearMByWidth ?? {};
  return Object.entries(byWidth)
    .map(([width, linearM]) => ({ widthCm: Number(width), linearM: Number(linearM) }))
    .filter((entry) => Number.isFinite(entry.widthCm) && entry.linearM > 0)
    .sort((a, b) => b.widthCm - a.widthCm);
}

export function windowAreaOfSession(layout: FaceLayoutJson, sessionId: string): number {
  const bySession = layout.totals.paintWindowAreaM2BySession ?? {};
  const direct = Number(bySession[sessionId]);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const step = layout.stepVisuals.find(
    (item) =>
      (item.kind === 'PAINT_SESSION' || item.kind === 'PAINT_GENERAL') && item.sessionId === sessionId,
  );
  return (step?.visuals ?? [])
    .filter((rect) => rect.kind === 'PAINT_WINDOW')
    .reduce((sum, rect) => sum + (rect.areaM2 || (rect.w * rect.h) / 10_000), 0);
}
