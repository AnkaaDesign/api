# Painting elements without mandatory AI

Date: 2026-08-05

Status: architecture proposal for later evaluation
Related diagnostic: `PAINTING_BUDGET_DEEP_ANALYSIS_2026-08-05.md`

## 1. Main conclusion

The painting-budget calculator does not need to understand whether a visible
block is a slogan, telephone number, company name, website, or logo.

Those are marketing meanings. Production needs to know:

- where one physical element begins and ends;
- which visual regions belong to one adhesive sheet;
- which colors the element contains;
- whether white is preserved substrate;
- whether its colors touch;
- whether its appearance is solid, gradient, mosaic, or aerography;
- which masking route is required;
- its bounding box, contours, holes, cutting length, and paint windows.

Almost all of these properties can be derived through deterministic computer
vision and production rules.

The central architectural change is therefore:

> Replace semantic object recognition as a required stage with deterministic
> discovery of anonymous production elements. Keep AI, if used at all, as an
> optional quality-assurance or suggestion layer outside the cost-critical
> path.

## 2. The correct question

The current semantic prototype asks:

> What is this object?

Production actually needs to ask:

> Which painted regions belong to one physical manufacturing unit?

That is principally a geometry, grouping, and process-planning problem rather
than a semantic-recognition problem.

An anonymous element contract is sufficient:

```json
{
  "id": "element_04",
  "bbox": [372, 63, 656, 743],
  "regionIds": ["r32", "r193", "r201"],
  "colors": ["#2b9cbc", "#ea5a53"],
  "reserveRegionIds": ["r193"],
  "appearance": "SOLID",
  "maskRoute": "ADHESIVE_ON_GENERAL"
}
```

It does not matter to the production engine whether `element_04` is a logo.

## 3. Why BURES does not require AI

BURES can be decomposed through geometry:

- the large stripe is a long connected or spatially coherent structure;
- the BURES letters form a spatial cluster;
- the phone-like line forms another cluster;
- the small gray line forms a nearby aligned cluster;
- colors and gradients are already measured by the Python engine;
- the white background is already recognized;
- the tape route can be selected from geometry, orientation, and substrate.

Calling one cluster `TELEFONE` or another `TAGLINE` does not change its
manufacturing requirements. Each still needs a bounding/window, an adhesive or
tape decision, cutting, weeding, application, painting, and possibly covering
or varnish.

The good BURES result therefore does not demonstrate a need for semantic AI. It
demonstrates that deterministic geometry already contains much of the necessary
production information.

## 4. Aerography can also be inferred deterministically

The Python engine already computes or can compute the relevant signals:

- local color diversity;
- modal color purity at original resolution;
- continuous gradients;
- hard-edge versus soft-edge ratios;
- residual error after local quantization;
- photo-zone area;
- continuous spatial changes in tone;
- component and boundary geometry.

A deterministic appearance classifier can follow this structure:

```text
component contains many local colors
├── colors reduce to a small set of flat modes with hard boundaries
│     -> VECTOR or MOSAIC
├── colors follow one or more smooth, low-residual ramps
│     -> GRADIENT
└── high residual variation, continuous tone, and local texture/detail
      -> AIRBRUSH
```

This matches the three benchmark cases:

- BURES: smooth color ramp;
- 137 PESCADOS: several solid colors separated by hard triangular boundaries;
- mar e rio octopus: photographic or continuous-tone work zone.

Aerography therefore does not fundamentally require AI. It requires a robust
appearance classifier, confidence scoring, and manual confirmation for
borderline cases.

## 5. The real difficulty: production-element grouping

Computer vision can extract connected regions, but a production element often
contains several disconnected regions.

Letters in a word are disconnected. If every connected component became an
element, `BURES` could become five adhesives. The deterministic element stage
must group components using multiple signals.

### 5.1 Connected structure

Regions that are directly connected, contained inside each other, or tied by a
continuous background/reserve structure are strong candidates for one element.

This is especially important for mar e rio: its large connected white structure
provides direct evidence that multiple visual parts belong to one physical
lockup.

### 5.2 Relative proximity

Neighboring shapes should be grouped when their distance is small relative to:

- median component or character height;
- local stroke width;
- component bounding dimensions;
- neighboring gaps within the same sequence.

Relative measurements are more robust than one fixed pixel or centimeter
threshold.

### 5.3 Alignment

Disconnected components with compatible baseline, height, vertical center,
rotation, and repeated spacing are likely to form one production block.

This groups a line of text without needing to read it.

### 5.4 Shared visual style

Grouping evidence can include:

- common color or color family;
- similar stroke thickness;
- compatible height;
- common orientation;
- repeated spacing;
- close spatial location.

### 5.5 Containment and physical lockups

A symbol, letters, and internal regions enclosed by or placed on a shared plate
or background should normally form one parent production element.

The algorithm does not need to label this a logo. It only needs to detect that
the regions share one manufacturing window and likely one adhesive sheet.

### 5.6 Gap barriers

Grouping should be discouraged or stopped by:

- large physical distance;
- a different large element between candidates;
- strong scale changes;
- incompatible orientation;
- separate enclosing plates;
- incompatible masking context.

### 5.7 Production-cost objective

When two groupings are geometrically plausible, the system can compare their
manufacturing consequences:

```text
option A: one 2.4 x 1.8 m adhesive
option B: three smaller adhesive pieces
```

Configured production constraints can select the practical option or mark it
for review. The decision does not require knowing what the content means.

## 6. Hierarchical elements

There is not always one objectively correct flat bounding box. Production
artwork naturally has hierarchy:

```text
face
├── production element
│   ├── subcomponent
│   ├── subcomponent
│   └── subcomponent
└── production element
```

Example:

```text
Mar e Rio lockup
├── connected white reserve/plate
├── turquoise internal area
├── fish graphic
└── internal lettering
```

The parent can control:

- adhesive window;
- plotter banding;
- application;
- surrounding paper territory;
- final varnish territory.

The children can control:

- color openings;
- actual paint shapes;
- internal cutting paths;
- paint order;
- reserve regions.

This representation is more useful than unrelated semantic boxes such as
`LOGOMARCA`, `NOME`, and `SITE` when they are physically one adhesive.

## 7. Proposed non-AI workflow

```text
1. Quantize colors
2. Recognize the background and reserve family
3. Extract connected regions and physical geometry
4. Classify visual appearance
   - SOLID
   - GRADIENT
   - MOSAIC
   - AIRBRUSH
5. Build a region-adjacency graph
6. Group regions into anonymous production elements
7. Build parent windows and child shapes
8. Calculate T-T contacts inside and between elements
9. Select mask route and painting technique independently
10. Compile physical operations and dependencies
11. Request manual confirmation only for low-confidence decisions
12. Calculate time, materials, and cost from validated operations
```

No slogan, telephone, site, company-name, or logo labels are required.

## 8. Proposed element-discovery stages

### 8.1 Region graph

Create one node per extracted region or meaningful connected component. Store:

- geometry and contour;
- color and color-family distance;
- area, perimeter, stroke, and orientation;
- background/reserve status;
- appearance evidence;
- containment relationships.

Create weighted graph edges for:

- direct contact;
- containment;
- normalized distance;
- baseline/alignment compatibility;
- scale compatibility;
- common visual style;
- shared enclosing structure.

### 8.2 Initial high-certainty groups

Build groups from evidence that is difficult to dispute:

- shared connected plate/reserve;
- direct containment;
- repeated aligned components with consistent spacing;
- photographic zone components;
- long coherent stripe structures.

### 8.3 Candidate merges

Score merges using geometry and production consequences. Do not use one global
distance threshold. Keep the evidence and score so the UI can explain why two
groups were joined.

### 8.4 Candidate splits

Split groups when they contain:

- large empty gaps;
- incompatible scale or orientation;
- independent enclosing structures;
- disconnected manufacturing territories;
- an excessive adhesive window relative to painted content.

### 8.5 Validation

Before accepting the element graph, enforce invariants:

- every significant non-background region has an owner;
- no connected physical region is silently split among incompatible parents;
- no huge stripe group absorbs small aligned components merely through box
  overlap;
- sentinel photo regions never become literal colors;
- white reserve regions never become paid paint automatically;
- parent windows contain their owned child geometry;
- distant same-color regions do not automatically create one enormous window.

## 9. How this improves mar e rio

Without semantic AI:

1. The three left text lines can be found as clusters of similarly sized,
   aligned white components.
2. The Mar & Rio lockup can be grouped through its connected white structure,
   containment, and shared production territory.
3. The actual website can remain a separate nearby line cluster without being
   recognized as a website.
4. The octopus can be identified as a large continuous-tone/photo zone and
   classified as aerography.
5. The stripe can be identified through elongated coherent geometry.
6. The stripe cannot absorb the text merely because its bounding box overlaps
   the text; ownership comes from structural grouping, not a generic containing
   box.

This directly removes the failure modes found in the generated mar e rio plan.

## 10. Where optional AI may remain useful

AI can remain outside the required cost path for optional tasks:

- detecting a watermark;
- warning about mirrored or cropped text;
- identifying likely spelling mistakes;
- providing friendly element names in the UI;
- suggesting a grouping when deterministic evidence is ambiguous;
- independently checking whether a continuous-tone zone is an illustration or
  compression/noise.

AI should not own authoritative:

- geometry;
- dimensions;
- region ownership;
- paint quantity;
- cutting length;
- production sequence;
- final cost.

An AI suggestion should be treated like any other proposal: it must pass
deterministic validation and may require user acceptance.

## 11. Remaining manual decisions

Some artwork is genuinely ambiguous from pixels alone:

- whether two close lines should use one adhesive or two;
- whether a decorative symbol belongs with a nearby word group;
- whether distant same-color components should share one large sheet;
- whether a neutral background is real paint or presentation gray;
- whether a borderline continuous-tone area is gradient or aerography;
- whether the workshop prefers a theoretically cheaper grouping.

These questions do not require AI. The review UI can provide direct controls:

- merge elements;
- split element;
- add or remove a region;
- mark background/reserve;
- choose solid, gradient, mosaic, or aerography;
- choose one adhesive or separate adhesives;
- correct the mask route.

The system should show the physical and financial effect of each correction.

## 12. Testing requirements

### BURES

- stable anonymous element count and grouping;
- the word group is not split per letter;
- the long stripe remains separate from nearby text;
- gradient classification remains stable under resize and compression;
- AI presence or absence does not change the production program.

### 137 PESCADOS

- the mosaic remains one parent element per physical ornament;
- hard neighboring blue facets remain separate colors;
- the mosaic is not misclassified as gradient or photographic;
- triangle count does not cause linear growth in top-level steps;
- distant text clusters remain separate from mosaic groups.

### mar e rio

- connected lockup structure produces one parent element;
- the three aligned left text lines form one production block;
- the real site line remains a separate cluster;
- the octopus is classified as aerography from appearance evidence;
- the stripe does not own text regions;
- zero significant unassigned area;
- no literal `#multi` paint;
- white remains reserve;
- no semantic label is required to produce the correct operations.

### Metamorphic tests

- scale and resize invariance;
- small compression/noise invariance;
- harmless canvas-margin invariance;
- stable grouping under small color variation;
- stable manual overrides after reprocessing;
- deterministic output across repeated runs;
- optional AI labels do not alter geometry or cost unless explicitly accepted.

## 13. Recommended development direction

1. Treat `PaintingElement` as an anonymous physical production element.
2. Implement deterministic hierarchical grouping in a new `elements` engine
   stage.
3. Store grouping evidence, confidence, and provenance.
4. Add a visual merge/split/reassign review interface.
5. Separate mask route from painting technique.
6. Compile operations only after element validation.
7. Run the new element stage in shadow mode against BURES, 137, and mar e rio.
8. Make AI completely optional and verify that disabling it produces the same
   cost-critical program.

## 14. Final recommendation

Remove semantic AI from the mandatory workflow.

Build the production-element stage with connected components, adjacency,
containment, relative spacing, alignment, visual similarity, shared reserve
structures, and production-aware grouping constraints.

Keep AI only as an optional QA or naming assistant.

This architecture is simpler, reproducible, offline-capable, testable, and
better aligned with the real requirement: the calculator does not need to
understand the language of the artwork; it needs to understand how the artwork
will be manufactured.

## 15. Practical reference implementation

The BURES demonstration at
`layout database/analysis_v2/planos/orcamento_perfeito_BURES_2_8.40.html`
shows how an anonymous-element budget can be presented without requiring the
business calculation to know that a cluster is a name, phone, or tagline.

Human-friendly labels appear only in the report. Quantities are driven by:

- element bounding and its 8 cm adhesive allowance;
- connected-region shape area;
- contour length for plotter cutting;
- color-specific paint windows;
- substrate and orientation for the tape route;
- union geometry for collective varnish;
- typed physical operations and declared commercial assumptions.

The visual implementation also records an important UI invariant: overlays
must be rendered in a canvas with exactly the same aspect ratio and coordinate
frame as the analyzed image. A responsive card may grow around that canvas, but
must never stretch the coordinate surface itself.
