/**
 * Route pattern for the single-segment `:id` routes under the `notifications`
 * prefix.
 *
 * Constraining the param to a UUID shape is what keeps those routes from
 * swallowing their SIBLINGS' static paths. Several controllers share the
 * `notifications` prefix — PushController (`device-token`, `device-tokens`),
 * NotificationApiController (`stats`, `preferences`, `analytics`) — and Express
 * matches in registration order. NotificationController is registered first
 * (PushModule is only an *import* of NotificationModule, so it is scanned
 * afterwards), so a bare `:id` there matched `DELETE /notifications/device-token`
 * and answered it with ParseUUIDPipe's "Validation failed (uuid is expected)"
 * 400. That broke push-token unregistration on logout, leaving the handset
 * subscribed to the previous user's notifications.
 *
 * Inline param patterns are an Express 4 / path-to-regexp feature. An Express 5
 * upgrade (Nest 11) drops them — the fix there is to move the device-token
 * routes off the shared prefix instead.
 */
export const NOTIFICATION_UUID_PARAM =
  ':id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';
