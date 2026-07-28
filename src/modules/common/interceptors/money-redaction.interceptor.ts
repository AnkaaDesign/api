import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SECTOR_PRIVILEGES } from '@constants';
import { canViewMonetaryValues } from '../../../utils/privilege';

/**
 * Strips monetary fields from responses for sectors outside `MONEY_PRIVILEGES`.
 *
 * WHY THIS EXISTS: every monetary gate in this product used to be client-side
 * only. The API happily returned item prices to a PRODUCTION token and
 * collaborators' remunerations to anyone who could read `/users`, so hiding the
 * numbers in the UI was cosmetic — devtools, a proxy or a plain `curl` showed
 * them. Endpoint-level `@Roles` cannot fix that on its own: `GET /items` is
 * legitimately readable by twelve sectors, it is only the PRICE that is not.
 *
 * This is the enforcing copy of the same rule the clients apply. Keeping both
 * is deliberate: the client gate stops the value being rendered, this one stops
 * it being transmitted.
 *
 * ── Scope and safety ────────────────────────────────────────────────────────
 *
 * Only the `data` subtree of the standard `{ success, message, data, meta }`
 * envelope is walked. `meta` is left alone so pagination is untouched (it also
 * uses `totalRecords`, never `total`, which is why the walk is safe at all).
 *
 * [MONEY_FIELDS] is deliberately conservative on two axes. Generic names that
 * are money on one model and a count on another (`total`, `subtotal`, `amount`)
 * are excluded: the entities carrying those (task quotes, invoices, payables)
 * are already restricted by `@Roles` to money sectors, so nothing is lost,
 * whereas stripping a `total` from a statistics payload would silently corrupt a
 * chart. And any field the redacted sector can WRITE BACK is excluded — see the
 * long note on [MONEY_FIELDS] for why prices are not on the list.
 *
 * Matched values are BLANKED, not deleted — arrays become `[]` and scalars
 * become `null`. A missing key would break client parsing that expects the
 * shape; a null one reads as "no price", which is exactly what the UI already
 * renders for these users.
 *
 * ── The own-compensation exemption ──────────────────────────────────────────
 *
 * A person's OWN pay is not company money, and the "Meu Bônus" feature exists
 * precisely for the produção/manutenção sectors that sit outside the allowlist.
 * Bonus field names are therefore absent from [MONEY_FIELDS] entirely, and
 * [SELF_SCOPED_PATHS] additionally exempts the personal endpoints wholesale so
 * a future addition to the list cannot break them by accident.
 */
@Injectable()
export class MoneyRedactionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // `role` is the sector privilege, put on the request by AuthGuard from the
    // JWT payload — no extra DB round trip on every response.
    const privilege = request?.user?.role as SECTOR_PRIVILEGES | undefined;

    // Unauthenticated routes (login, public budget pages, webhooks) have no
    // privilege. They are not the leak this guards against and several of them
    // legitimately carry totals, so they pass through untouched.
    if (!privilege) return next.handle();
    if (canViewMonetaryValues(privilege)) return next.handle();

    const path: string = request?.path ?? request?.url ?? '';
    if (SELF_SCOPED_PATHS.some((prefix) => path.startsWith(prefix))) {
      return next.handle();
    }

    return next.handle().pipe(
      map((body) => {
        if (!body || typeof body !== 'object') return body;
        if (!('data' in body)) return redactMoney(body);
        // Rebuild the envelope rather than mutating it: the handler's object may
        // be a cached instance shared with another in-flight request, and
        // blanking it in place would poison the cache for a money user.
        return { ...body, data: redactMoney((body as Record<string, unknown>).data) };
      }),
    );
  }
}

/**
 * Field names blanked for non-money sectors.
 *
 * ── Why this list is SALARY-ONLY, and not prices ────────────────────────────
 *
 * The obvious list — `prices`, `price`, `totalPrice`, `freight`, `discount`,
 * `totalOverride` — is NOT here, and deliberately so. Redaction is only safe for
 * a field the redacted sector never WRITES BACK, and for prices that condition
 * fails hard:
 *
 *   • WAREHOUSE authors orders. `order-item-selector.tsx` prefills each line's
 *     price from `item.prices[0].value`, and `order.service.ts` explicitly does
 *     NOT backfill from the catalog ("User can manually set the price, no
 *     validation against catalog price needed") — `calculateOrderTotal` sums
 *     whatever the client sent. Blanking `prices` would therefore make every
 *     warehouse-created order line save at R$ 0.
 *   • The same round trip exists for `freight`, `discount` and `totalOverride`
 *     on the order form, and for `prices` on the item form, all of which
 *     WAREHOUSE edits.
 *
 * Silently zeroing real financial records is strictly worse than the read-only
 * leak it would have closed, so prices stay on the wire for now and are hidden
 * by the client gates alone. Closing that leak properly means making the SERVER
 * own the price — backfill an omitted order-item price from the catalog, and
 * have the form omit rather than zero it when `canViewPrices` is false. That is
 * its own change, with its own testing, on the order create/update path.
 *
 * Salary fields have no such hazard: `position.controller.ts` restricts writes
 * to HUMAN_RESOURCES, ADMIN and ACCOUNTING, and the latter two are exempt from
 * redaction entirely — so no sector that is redacted here can write these back.
 */
const MONEY_FIELDS = new Set<string>([
  // Position / User remuneration — the salary leak behind the extra-hours tool,
  // and the most sensitive money in the system.
  'remunerations',
  'remuneration',
  'monthlySalary',
]);

/**
 * Paths serving the caller their OWN records. Exempt wholesale so the personal
 * money features keep working for the sectors they were built for.
 */
const SELF_SCOPED_PATHS = ['/personal', '/bonuses/my', '/preferences', '/auth/me'];

/** Depth cap — a guard against pathological nesting, never reached in practice. */
const MAX_DEPTH = 12;

/**
 * Only PLAIN objects and arrays are walked into.
 *
 * Everything else — `Date`, `Buffer`, and above all Prisma's `Decimal` — is a
 * leaf that must survive by reference. Decimal is a class instance whose value
 * lives in internal fields and which serialises through its own `toJSON`;
 * structurally copying one yields `{ s, e, d }` and silently corrupts every
 * monetary and numeric Decimal column in the payload (Bonus, TaskQuote,
 * Vacation). Copying a `Date` the same way yields `{}`.
 */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively blank [MONEY_FIELDS] in a response payload.
 *
 * Returns new objects/arrays rather than mutating, for the cache-poisoning
 * reason given in the interceptor.
 *
 * `memo` maps each source object to its redacted counterpart and is populated
 * BEFORE recursing into that object's children. That ordering is what makes
 * reference cycles terminate (a cycle resolves to the in-progress copy) while
 * shared references still get the redacted copy — a plain "seen" set would
 * return the ORIGINAL object the second time it was encountered, quietly
 * leaking every price reachable by more than one path.
 */
function redactMoney(value: unknown, depth = 0, memo = new Map<object, unknown>()): unknown {
  if (value === null || typeof value !== 'object') return value;

  const asObject = value as object;
  if (memo.has(asObject)) return memo.get(asObject);

  const isArray = Array.isArray(value);
  if (!isArray && !isPlainObject(asObject)) return value;

  // Past the cap, hand back the original rather than a half-walked copy.
  if (depth >= MAX_DEPTH) return value;

  if (isArray) {
    const out: unknown[] = [];
    memo.set(asObject, out);
    for (const entry of value as unknown[]) {
      out.push(redactMoney(entry, depth + 1, memo));
    }
    return out;
  }

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  memo.set(asObject, out);
  for (const key of Object.keys(source)) {
    const current = source[key];
    if (MONEY_FIELDS.has(key)) {
      out[key] = Array.isArray(current) ? [] : null;
      continue;
    }
    out[key] = redactMoney(current, depth + 1, memo);
  }
  return out;
}
