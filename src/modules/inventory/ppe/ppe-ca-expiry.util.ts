// ppe-ca-expiry.util.ts
// Pure helper for the NR-6 CA (Certificado de Aprovação) expiry rule, shared by
// ppe-delivery.service (delivery block) and ppe-ca-expiry.scheduler (alerts).

/**
 * True when an EPI's CA is expired as of `now`. The CA is valid through the WHOLE
 * expiry day (compared by end-of-day), so an item only becomes blocked the day
 * AFTER its ppeCAExpiry. A null expiry means "no CA tracked" → not blocked here.
 */
export function isPpeCaExpired(
  ppeCAExpiry: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!ppeCAExpiry) return false;
  const expiry = ppeCAExpiry instanceof Date ? new Date(ppeCAExpiry) : new Date(ppeCAExpiry);
  if (Number.isNaN(expiry.getTime())) return false;
  expiry.setHours(23, 59, 59, 999);
  return expiry.getTime() < now.getTime();
}
