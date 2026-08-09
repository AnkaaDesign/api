# Deep analysis — painting budget calculator

Date: 2026-08-05

Status: diagnostic and implementation guidance; no production changes made
Scope: painting engine, semantic probe, API/database model, costing workflow,
layout database, historical attempts, known errors, and the BURES, 137 PESCADOS,
and mar e rio benchmark results.

## 1. Executive conclusion

The project has made strong progress on deterministic geometry, especially
physical scale, color quantization, region extraction, gradients, and
paint-to-paint boundaries. The BURES and 137 PESCADOS results are good largely
because their hardest problems are geometric:

- BURES tests continuous gradient versus distinct solid colors.
- 137 tests several nearby solid blues, hard interfaces, and mosaic geometry.

The mar e rio failure belongs to a different layer. Its dominant problems are
semantic element assembly and production workflow composition, not basic color
quantization. The engine sees much of the geometry, including the photographic
octopus, but the semantic prototype partitions the artwork into incorrect
production elements. Those bad elements then propagate into routing,
sequencing, materials, labor, varnish, and price.

The safest architectural direction is:

> Preserve the deterministic geometry engine, introduce a constrained and
> reviewable production-element assembly stage, compile production from
> validated elements, and prevent uncertain or contradictory analyses from
> silently becoming exact-looking budgets.

## 2. Sources and precedence

The repository already establishes this precedence:

1. `PAINTING_PRODUCTION_DOCTRINE.md` — owner-confirmed production rules.
2. `PAINTING_CASE_CATALOG.md` — executable cases and expected behavior.
3. `layout database/CONHECIMENTO_DO_MOTOR.md` — reasoning, measurements, and
   known uncertainties.
4. `layout database/analysis_v2/` — reanalysis of the layout collection.
5. `layout database/analysis_v2/planos/` — generated benchmark plans.
6. `PAINTING_COST_ENGINE_PLAN.md` — earlier architecture, partially obsolete.
7. `layout database/analysis/analysis_A..F.md` — historical and obsolete.

Other important sources reviewed:

- `PAINTING_V3_WORKFLOW_SPEC.md`
- `PAINTING_ENGINE_V2_CLASSIFY_SEQUENCE_PLAN.md`
- `PAINTING_SEMANTIC_VISION_PLAN.md`
- `painting-vision/DIAGNOSTICO_SEMANTICA.md`
- `painting-vision/DIAGNOSTICO_ROTAS.md`
- `painting-vision/README.md`
- `layout database/ERROS_E_CORRECOES.md`
- Python engine and tests under `painting-engine/`
- Semantic prototype and tests under `painting-vision/`
- API services under `src/modules/paint/painting-analysis/`
- Painting models in `prisma/schema.prisma`
- Painting-budget UI under `web/src/components/administration/painting-budget/`

## 3. Current implemented workflow

The production path is approximately:

```text
image
  -> physical scale calibration
  -> quantization
  -> connected regions
  -> region classification
  -> paint-to-paint boundaries
  -> generic adhesive bands, paper, and paint windows
  -> paint-catalog matching
  -> regional strategies and boundary resolutions
  -> surface program plus visual-communication steps
  -> labor, materials, indirect costs, and suggested price
```

The Python engine is deterministic and emits a versioned artifact. The API
materializes faces, regions, and boundaries, then performs MATCH, STRATEGY, and
PLAN stages.

The V3 surface-program work has already improved the old model:

- surface painting is emitted once per implement rather than once per face;
- general painting is inferred from the artwork;
- paint systems support coat schedules, catalyst, and thinner;
- preparation, dismantling, and reassembly can exist independently of image
  elements;
- the surface program is separated conceptually from visual communication.

The incomplete part is Program B, visual communication. It still derives its
work mainly from color bands and sessions rather than validated production
elements.

The Prisma schema already contains `PaintingElement`, but the current engine
does not emit a production-element stage and the API does not materialize and
consume this model in the production-plan compiler. This unused model is the
natural bridge between geometry and workflow.

## 4. What is working well

### 4.1 Geometry is increasingly deterministic

The engine correctly owns measurable facts:

- scale and dimensions;
- palette candidates;
- connected regions;
- contour and hole geometry;
- area and perimeter;
- minimum stroke;
- background classification;
- photographic zones;
- gradient evidence;
- paint-to-paint boundary length and curvature;
- adhesive bands and paint windows.

This responsibility should remain deterministic. A vision-language model
should not replace geometric measurement.

### 4.2 BURES versus 137 quantization was fixed at the source

The earlier engine failed in opposite directions:

- BURES: created multiple solid blue paints from a continuous gradient.
- 137: merged several real solid blues into too few colors.

The revised histogram seed selection and original-resolution modal-purity
measurement address the shared cause rather than compensating later through a
global merge.

Documented result:

| Layout | Before | After |
|---|---:|---:|
| 137 PESCADOS | 3 colors, 4 T-T boundaries | 7 colors, 142 T-T boundaries |
| BURES 2 | 6 colors, 4 T-T boundaries | 4 colors, 2 T-T boundaries |

This is one of the strongest parts of the implementation because both cases
improved together without merely trading one regression for another.

### 4.3 The production doctrine now captures critical physical rules

The most important established rules are:

- adhesive is a mask for painting, never a final printed product;
- white is normally preserved substrate, not paid paint;
- paint-to-paint contact drives masking complexity;
- general paint is cured before visual communication begins;
- paint consumption follows the production window/bounding;
- plotter cutting follows the real contour;
- the smaller coverage is generally painted before the larger one;
- boxes and shapes control different operations and both are required;
- aerography still requires an external mask;
- photographic content is painted by aerography, never printed;
- the adhesive is generally applied as one complete sheet and opened by color.

### 4.4 Historical errors are documented with useful causal detail

The recurring failure pattern is clear: a correction made globally for one
layout changed a representation and broke another layout.

Examples:

- a color merge intended to repair BURES transitively merged the 137 mosaic;
- a prompt intended to separate content in BURES split the mar e rio lockup;
- modeling aerography as a route prevented it from receiving a proper mask
  route;
- switching between bounding boxes and shapes lost the fact that different
  operations require different representations.

This history strongly favors local, typed behavior with regression tests over
more global heuristics.

## 5. Benchmark analysis

### 5.1 BURES 2 — good result, remaining limitations

The generated BURES plan correctly recognizes:

- white plate background;
- four meaningful color candidates;
- gradient tones rather than many false solid blues;
- the main long graphic as a `FAIXA`;
- yellow tape;
- separate name, logo, phone, and tagline elements;
- no full general-paint surface program;
- fewer sessions than one session per color.

Remaining limitations:

1. The plan has color sessions for the gradient but does not represent the
   final smoothing/blending operation as a distinct production operation.
2. The stripe still depends on a broad semantic/bounding representation. A
   slightly wrong box can expand tape, paper, and paint quantities.
3. Edge-crop alerts are noisy for stripes that legitimately terminate at the
   face boundary.
4. BURES validates quantization well but is not a difficult validation of
   semantic lockup assembly.
5. Documentation contains conflicting gradient language: case `B5` describes
   neighboring ramp tones as one paint with gradient, while `D1` describes N
   tones as N paints/demands. The later owner correction appears to favor
   `D1`, but the contradiction must be removed.

### 5.2 137 PESCADOS — good result, remaining limitations

The 137 result correctly preserves nearby solid blues and hard interfaces. It
also identifies a general-painted background, separate text-related elements,
two large mosaic ornaments, dense T-T adjacency, and multiple color groups.

Remaining limitations:

#### Ambiguous background has excessive financial impact

The generated plan warns that the dominant gray might be presentation gray
rather than real general paint. This single decision activates the entire
surface program and can radically change price and duration. A warning is not
enough: this ambiguity should require confirmation before the budget can be
approved.

#### Mosaic workflow is not represented directly

The real operation is closer to:

```text
one common adhesive
  -> open/weed one tone
  -> paint that tone
  -> preserve protection through the remaining vinyl web
  -> repeat for the remaining tones
```

It should not become a long list of independent adhesive applications or an
unbounded number of top-level pages.

The mosaic should be a compound production operation with:

- one adhesive;
- K color passes;
- per-tone piece counts and areas;
- paint changes;
- one coherent element geometry;
- explicit relationship to global sessions of the same paint.

#### Greedy graph coloring is not necessarily minimal

The documentation calls the number of sessions the chromatic number, but a
greedy coloring only guarantees a valid coloring, not the minimum.

These graphs are small enough to use:

- greedy coloring for an upper bound;
- DSATUR and branch-and-bound for an exact or tighter solution;
- manual override when observed shop practice differs.

#### Contact edges need weights and context

A short incidental contact and a long structural boundary currently become the
same kind of graph edge once they pass a threshold. The adjacency model should
carry:

```text
contact length
curvature
masking context
whether both colors share a common adhesive
confidence
```

### 5.3 mar e rio — why the result fails

#### The semantic prompt split a single production lockup

The old prompt explicitly asked the VLM to separate symbol, name, and
descriptive line. In mar e rio, these share a connected white structure and are
manufactured as one lockup.

The result contained:

- an incomplete logo element;
- a second false name element;
- a false site inside the lockup;
- a 1.30 m2 `AVULSO` element;
- missing or misassigned left-side text;
- incorrect element ownership for the real site.

The model did see much of the content. The failure is mainly grouping and
region-to-element assignment, not simple object blindness.

#### The large stripe box becomes an orphan vacuum

When text boxes are slightly vertically misaligned, text regions fall into the
enormous `FAIXA` box. Text work is then budgeted as stripe/tape work instead of
being reported as unresolved.

This is more dangerous than a missing detection because it produces a
plausible-looking but mechanically wrong route.

#### Connected-component integrity is not enforced

One connected white region spans much of the mar e rio logo. The semantic
model divided that physical piece among several boxes, and no deterministic
validator rejected the split.

A VLM should propose elements. It should not be allowed to contradict strong
connected-component evidence without an explicit, reviewable split rule.

#### Aerography is modeled on the wrong axis in the prototype

`AEROGRAFIA` is currently treated in the prototype as if it were mutually
exclusive with the mask route. They answer separate questions:

```text
mask route:
  tape / adhesive on plate / adhesive on cured general paint /
  adhesive reapplied / adhesive on varnish / manual cut

painting technique:
  solid / gradient / aerography
```

The octopus is both an aerography technique and an adhesive-route decision.

Consequences of the conflated model include:

- the octopus is structurally unable to receive correct `toca_tinta` in the
  prototype;
- approximately 28.59 m of relevant contact is assigned incorrectly;
- `#multi` becomes a fake paint session;
- internal holes are included in cutting even though aerography requires only
  the external silhouette;
- route-dependent varnish, cure, weeding, application, and removal operations
  are missing or misplaced.

#### White becomes paid paint

The generated plan contains `Pintura #fdfdfd`. Under the established doctrine,
white in this artwork is predominantly preserved substrate/negative space and
must not automatically become a paint pass.

That error contaminates color count, boundaries, sessions, liters, labor,
varnish, duration, and price.

#### Adhesive operations are sequenced before their support exists

Elements classified as requiring adhesive on varnish are scheduled before
general painting and curing. This is physically impossible. The route is being
used as a display label rather than as a sequencing constraint.

#### Sentinel colors escape into business logic

`#multi` is a marker for a photographic work zone, not a color. It must never
enter:

- paint matching;
- paint-session generation;
- material costing;
- rendering as a literal paint.

The current string-based color contract does not prevent this.

## 6. Principal architectural gap

The system currently transforms visual communication approximately as:

```text
color regions -> horizontal bands -> sessions -> production steps
```

The correct bridge is:

```text
regions + semantic proposals
  -> validated production elements
  -> mask route per element
  -> painting technique per element
  -> typed operations and dependencies
  -> ordered steps and cost
```

`PaintingElement` should become the validated and persistent unit of visual
production.

## 7. Recommended robust workflow

### Stage 1 — intake and immutable physical facts

Inputs:

- service context;
- substrate;
- paint system;
- implement length and height;
- face type;
- original image.

Requirements:

- never infer scale silently when explicit measurements conflict;
- store the source and confidence of dimensions;
- fail if the vision wrapper did not actually receive image bytes;
- identify file-level blockers before costing;
- store an image hash and engine version for reproducibility.

### Stage 2 — deterministic geometry

Keep the current Python engine responsible for palette candidates, relative
background family, regions, contours, holes, photographic zones, gradient
evidence, boundaries, strokes, curvature, and physical measurements.

Do not assign names such as logo, tagline, stripe, or mascot here.

### Stage 3 — semantic proposals

Use vision only to propose:

- element type;
- approximate box or polygon;
- label and text;
- grouping/lockup relationships;
- confidence.

Use OCR on original-resolution crops for exact text. Use deterministic rules
for site, phone, social media, regulatory seal, and similar classes.

The improved lockup/text-block prompt documented in
`painting-vision/DIAGNOSTICO_SEMANTICA.md` is a good baseline, but prompt changes
alone are not a robust solution.

### Stage 4 — deterministic element reconciliation

Add an explicit element stage that:

1. Assigns regions to semantic proposals using overlap, centroid, containment,
   connectedness, and geometry.
2. Prevents connected regions from being split without a justified split rule.
3. Merges lockups when connected geometry bridges adjacent proposals.
4. Prevents broad stripe boxes from claiming text as a generic fallback.
5. Creates visible `UNASSIGNED` elements for significant unresolved geometry.
6. Validates that element boxes agree with the geometry they own.
7. Supports manual merge, split, reassign, relabel, and route correction.

Manual overrides should survive reprocessing through geometric matching, not
only exact `engineId`. A more stable match should combine:

- face;
- color family;
- normalized centroid;
- shape overlap/IoU;
- contour signature;
- semantic label.

### Stage 5 — independent production axes

Each production element should contain at least:

```text
category
maskRoute
paintTechnique
substrateContext
owned regions
paint colors
reserve/background regions
cut geometry
paint windows
contacts
confidence and source
```

Suggested route states:

```text
TAPE_YELLOW
TAPE_WHITE
ADHESIVE_ON_PLATE
ADHESIVE_ON_GENERAL
ADHESIVE_REAPPLIED
ADHESIVE_ON_VARNISH
MANUAL_CUT
STENCIL
```

Suggested technique states:

```text
SOLID
GRADIENT
AIRBRUSH
```

Aerography must never be a mask route.

### Stage 6 — operation dependency graph

Do not construct the final flat list directly. First create typed operations:

```text
prepare surface
paint general
cure general
cut adhesive
weed adhesive
apply adhesive
paint color
cover color
cure local paint
apply adhesive again
airbrush
remove mask
varnish
```

Then create dependencies, for example:

```text
general paint -> general cure -> adhesive on general
local paint -> local varnish -> cure -> adhesive on varnish
smaller color -> protect/cover -> larger color
all relevant final paint -> collective varnish
```

A topological sort produces the visible plan. Cycles or missing prerequisites
become validation errors rather than physically impossible step sequences.

### Stage 7 — compound operations for known edge cases

Support explicit compound operations:

- `MOSAIC_PAINT`: one adhesive and K weed/paint passes;
- `GRADIENT_PAINT`: N tone applications plus final blend/softening;
- `PARTIAL_GRADIENT`: base color followed by internal tape/paper and airbrush;
- `AIRBRUSH_SILHOUETTE`: external contour only, no internal-hole cutting;
- `LOCKUP_PAINT`: semantic subparts under one common adhesive;
- `REAPPLIED_ADHESIVE`: paint, dry, reapply adhesive, paint the next color.

This prevents special layouts from forcing global heuristics into the normal
session algorithm.

### Stage 8 — confidence and approval gates

Use three states:

- green: deterministic and internally consistent;
- yellow: draft budget with explicit assumptions and sensitivity;
- red: block approval until corrected.

Red conditions should include:

- significant `UNASSIGNED` area;
- `#multi` entering paint matching or costing;
- white/background becoming paid paint without confirmation;
- one connected region split among incompatible elements;
- uncertain background mode activating the full surface program;
- adhesive-on-varnish scheduled before varnish and cure;
- missing or contradictory scale;
- material file content cut at an image boundary.

The 1.30 m2 mar e rio orphan should have blocked plan approval.

### Stage 9 — cost only validated operations

The cost engine should consume a typed production program, not raw image
regions. Every quantity should carry provenance:

```text
value
unit
source: MEASURED | CONFIGURED | INFERRED | MANUAL
formula or basis
confidence
```

This prevents uncertain recognition from producing unexplained exact-looking
prices.

## 8. Safe implementation order

To improve mar e rio without breaking BURES and 137:

1. Freeze the three cases as golden integration fixtures.
2. Add invariants before changing behavior.
3. Add the element-reconciliation stage in shadow mode while the current plan
   remains authoritative.
4. Apply the improved mar e rio semantic prompt and deterministic lockup
   reconciliation.
5. Split `route` into `maskRoute` and `paintTechnique`.
6. Compile production through an operation dependency graph.
7. Add compound mosaic, gradient, partial-gradient, and airbrush operations.
8. Switch Program B from generic bands to validated elements only after shadow
   comparisons are stable.

Recommended invariants before any behavior change:

- no sentinel value can become a paint;
- white/background is not paid paint without confirmation;
- relevant orphan geometry is never silent;
- connected regions are not split without a justified rule;
- route-dependent sequencing is physically valid;
- every cost quantity has source and formula;
- manual overrides survive non-material reprocessing changes.

## 9. Test strategy

The existing tests protect useful isolated facts but do not yet validate the
complete production plan.

### BURES golden assertions

- white plate background;
- no white paint;
- expected solid colors and ramp tones;
- long stripe remains one element;
- yellow tape;
- gradient finishing operation exists;
- no general surface program;
- no false varnish/adhesive cycle.

### 137 golden assertions

- nearby solid blues remain distinct;
- mosaic ornaments remain one element each;
- one adhesive with multiple passes per mosaic;
- no transitive gradient merge;
- background confirmation required when ambiguous;
- plan page/operation count remains bounded as triangle count grows.

### mar e rio golden assertions

- the three left text lines form one text block;
- the Mar & Rio lockup is one element;
- the real site is separate;
- the octopus is one airbrush element;
- octopus cut geometry uses only the external silhouette;
- both mask route and painting technique are present;
- zero material `AVULSO` area;
- white is reserve;
- no `#multi` paint;
- general paint and cure precede dependent adhesive;
- no stripe owns text regions.

### Metamorphic tests

- resizing the same artwork does not change production decisions;
- small JPEG compression changes do not change element ownership;
- harmless canvas/margin changes do not materially change cost;
- repeated VLM runs reconcile to the same element graph;
- manual overrides survive small geometry changes;
- adding distant content of the same color does not create one enormous paint
  window;
- increasing mosaic triangle count does not linearly increase top-level pages.

## 10. Documentation and configuration contradictions

Resolve these before trusting financial output:

1. Gradient `B5` says one paint with gradient while `D1` says N tones are N
   paints/demands. Owner-confirmed wording must become canonical.
2. Session-by-color graph logic conflicts with the common-adhesive behavior of
   mosaics. The masking context must be part of the rule.
3. Owner-confirmed adhesive margin is documented as 8 cm, but
   `EngineParams.adhesive_margin_cm` currently defaults to 2 cm.
4. Kraft paper is documented as 100 cm, while the engine default is 90 cm.
5. A confirmed cuttable example is documented at 14 mm, while business rules
   contain lower fallback thresholds. Confirm the meaning of each threshold:
   physical plotter limit, difficult cut, and owner-confirmed manual cut.
6. The white-plate doctrine says no full washing cycle, while the current
   no-general-paint flow can still emit washing depending on `alreadyPrepared`.
7. Several thresholds are explicitly uncalibrated: vertical tape angle,
   orphan/noise area, bounding merge distance, cover margin, and background
   coverage.
8. Greedy coloring should not be described as the exact chromatic number unless
   the solver is exact.

## 11. Additional production-code risks

### 11.1 Status can become REVIEW after auto-compute failure

`runProcessing` catches an auto-compute error, logs it, and subsequently sets
the analysis status to `REVIEW`. This can expose an incomplete or stale plan as
reviewable. A compute failure should keep the analysis failed or explicitly
partial.

### 11.2 Manual overrides depend too strongly on engine IDs

Region and boundary overrides are restored by exact `engineId`. Quantization or
component changes can alter those IDs, losing correct user work. Geometric
reconciliation is needed.

### 11.3 Significant alerts are deleted and recreated per face

During materialization, unresolved analysis alerts are deleted while each face
is processed. In a multi-face analysis, later faces can erase alerts emitted by
earlier faces. Alerts should be replaced per face/run or collected and committed
after all faces complete.

### 11.4 Layout dependencies omit boundaries

The engine dependency graph allows `layout` from classification without the
boundary stage. Current layout sessions are color-driven, but future
contact-aware element planning must explicitly depend on boundaries.

### 11.5 Missing layout produces a fake inspection step

If a face lacks V2 layout, the plan emits an `INSPECAO` step titled “Reprocessar
a imagem”. This is an application state/error, not a production operation and
must not appear in labor scheduling or the production wizard.

### 11.6 Remaining hardcoded or zero-price quantities

The current plan still contains important values requiring configuration or
inventory verification, including paper with zero unit price, collective varnish
using a hardcoded 8 m2/L calculation, and some fallback consumptions. A missing
price must be an approval-blocking configuration alert when it materially affects
the quote.

### 11.7 Labor crew size is not consistently reflected in cost

Rates load `crewSize`, but ordinary step labor cost is calculated from elapsed
minutes times one hourly rate. Verify whether configured rates represent
person-minutes or wall-clock minutes. The database and UI should not imply crew
cost multiplication if the calculation ignores it.

## 12. Final recommendation

The feature does not primarily need another global image heuristic. It needs a
stronger typed contract between image analysis and production planning.

The highest-value change is:

> Make `PaintingElement` the validated unit of visual production, give every
> element independent mask-route and paint-technique fields, and generate the
> final plan from a validated operation dependency graph.

This retains the successful BURES and 137 quantization work, directly addresses
the mar e rio failure, and gives future edge cases a controlled extension point
instead of forcing every exception into quantization, prompts, or global color
sessions.

## 13. Verification performed during this analysis

- Repository and relevant documentation reviewed read-only.
- Generated BURES, 137 PESCADOS, and mar e rio JSON plans compared.
- Python engine, semantic prototype, API services, Prisma models, and painting
  UI files inspected.
- Existing Python regression suites completed without reported failures.
- `npx tsc --noEmit --pretty false` completed successfully.
- No production code or configuration was changed as part of this analysis.

## 14. BURES reconstructed budget reference

After this diagnostic, a standalone reference budget was created at:

`layout database/analysis_v2/planos/orcamento_perfeito_BURES_2_8.40.html`

It demonstrates the desired output independently of the incomplete semantic
prototype. Its measured physical basis is:

- explicit face length: 840.0 cm;
- height derived from the 9924 x 2838 image aspect: 240.3 cm;
- face area: 20.188 m2;
- measured colored shape: approximately 6.405 m2;
- four adhesive windows with the confirmed 8 cm border: 8.359 m2 of vinyl;
- plotter contour length: 59.71 m;
- manual cut: 0 m;
- yellow flexible tape for the long stripe: 17.64 m including 5% allowance;
- varnish territory: 15.465 m2 after geometric union, without counting
  overlapping windows twice.

The document intentionally invents commercial prices and productivity values,
but calculates all extensions and totals from those declared values. It keeps
measured geometry separate from commercial assumptions.

### Visualization coordinate correction

The first version of the reference HTML allowed the visual column of each step
to stretch to the height of its accompanying text. The artwork remained centered
inside that taller column, while overlay boxes were positioned as percentages of
the stretched column. This created false vertical space above and below elements.

The corrected implementation locks the visual canvas to the original image
aspect ratio `9924 / 2838` and prevents CSS Grid from stretching it. Overlay
coordinates and image pixels now share the same frame. This presentation issue
must not be confused with the real 8 cm adhesive-sheet allowance used in
material calculations.
