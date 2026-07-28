/**
 * Regression guard — "airbrushing layouts silently disappear".
 *
 * Between 2026-07-20 and 2026-07-27, 15 airbrushings lost every attached layout. Root
 * cause chain:
 *   1. the task-edit form built its airbrushing payload with a predicate that only
 *      recognised hydrated files (`f.uploaded`), so rows the user never touched reported
 *      "no layouts" and shipped `layoutIds: []`;
 *   2. `AirbrushingService.batchUpdate` handed that payload straight to the repository,
 *      skipping the intent reconciliation the single-update path performs;
 *   3. the repository mapped `layoutIds: []` to `layouts: { set: [] }`, detaching every
 *      Layout row (files survive on disk, `airbrushingId` becomes NULL, UI shows nothing).
 *
 * The primary fix is structural and lives elsewhere: `batchUpdate` now strips attachment
 * arrays entirely (a JSON endpoint cannot upload, so it could only ever destroy), and the
 * task-edit form routes attachment changes to the single multipart endpoint.
 *
 * What THIS asserts is the last line of defence behind that: the repository mapper must
 * never empty a file relation unless the service explicitly vouched for the intent. If
 * someone adds a fourth write path that forgets to reconcile, this fails instead of
 * silently losing customer artwork.
 *
 * Run: pnpm tsx tests/airbrushing-relation-clear.test.ts
 */

import { AirbrushingPrismaRepository } from '../src/modules/production/airbrushing/repositories/airbrushing-prisma.repository';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// The mapper is pure: it never touches the injected client, so a stub is enough.
const repo = new AirbrushingPrismaRepository({} as never);
const mapUpdate = (formData: any): any =>
  (repo as any).mapUpdateFormDataToDatabaseUpdateInput(formData);

console.log('\nairbrushing repository — file-relation replacement guard\n');

// 1. The exact payload that caused the incident.
{
  const out = mapUpdate({ status: 'COMPLETED', layoutIds: [], receiptIds: [], invoiceIds: [] });
  check('unvouched empty layoutIds does NOT clear layouts', out.layouts === undefined,
    `got ${JSON.stringify(out.layouts)}`);
  check('unvouched empty receiptIds does NOT clear receipts', out.receipts === undefined,
    `got ${JSON.stringify(out.receipts)}`);
  check('unvouched empty invoiceIds does NOT clear invoices', out.invoices === undefined,
    `got ${JSON.stringify(out.invoices)}`);
  check('the rest of the payload still applies', out.status === 'COMPLETED');
}

// 2. A deliberate clear (user removed every file) must still work when vouched for.
{
  const out = mapUpdate({ layoutIds: [], _allowRelationClear: true });
  check('vouched empty layoutIds DOES clear layouts',
    JSON.stringify(out.layouts) === JSON.stringify({ set: [] }),
    `got ${JSON.stringify(out.layouts)}`);
}

// 3. Non-empty arrays are unaffected by the guard (no marker needed to replace).
{
  const out = mapUpdate({ layoutIds: ['l1', 'l2'] });
  check('non-empty layoutIds replaces without a marker',
    JSON.stringify(out.layouts) === JSON.stringify({ set: [{ id: 'l1' }, { id: 'l2' }] }),
    `got ${JSON.stringify(out.layouts)}`);
}

// 4. Absent arrays must leave the relations completely untouched (partial updates).
{
  const out = mapUpdate({ price: 100 });
  check('absent arrays leave every relation untouched',
    out.layouts === undefined && out.receipts === undefined && out.invoices === undefined);
}

// 5. Transport-only fields must never reach Prisma (they are not columns).
{
  const out = mapUpdate({
    price: 1,
    layoutIds: [],
    _allowRelationClear: true,
    layoutStatuses: { 'file-id': 'DRAFT' },
  });
  check('_allowRelationClear is stripped', !('_allowRelationClear' in out));
  check('layoutStatuses is stripped', !('layoutStatuses' in out));
}

console.log(
  failures === 0
    ? '\nAll relation-clear guards hold.\n'
    : `\n${failures} guard(s) FAILED — an airbrushing write path can silently detach files.\n`,
);
process.exit(failures === 0 ? 0 : 1);
