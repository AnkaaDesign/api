import { SetMetadata } from '@nestjs/common';

/**
 * Exclusive ADMIN-only override.
 *
 * The AuthGuard merges class-level + method-level `@Roles` as a UNION
 * (`getAllAndMerge`), so a method-level `@Roles(ADMIN)` on a controller whose
 * class is already decorated with a broader role set does NOT restrict access —
 * it just re-unions to the same set.
 *
 * `@AdminOnly()` sets a separate metadata flag that the AuthGuard checks BEFORE
 * (and independently of) the role union: when present on the handler or class,
 * access is granted only to ADMIN, regardless of any `@Roles` on the class.
 *
 * Use this on individual handlers that must stay ADMIN-only even though their
 * controller class opens a wider role set (e.g. DELETE endpoints).
 */
export const IS_ADMIN_ONLY_KEY = 'isAdminOnly';
export const AdminOnly = () => SetMetadata(IS_ADMIN_ONLY_KEY, true);
