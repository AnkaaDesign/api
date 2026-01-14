-- Check task and service orders
SELECT 
  t.id as task_id,
  t."serialNumber",
  t.status as task_status,
  t."updatedAt" as task_updated,
  COUNT(DISTINCT so.id) as service_order_count
FROM "Task" t
LEFT JOIN "ServiceOrder" so ON so."taskId" = t.id
WHERE t.id = 'c5c9ea18-7e84-4054-adf9-e3908a609ae0'
GROUP BY t.id, t."serialNumber", t.status, t."updatedAt";

-- Check service orders for this task
SELECT 
  id,
  type,
  status,
  description,
  "assignedToId",
  "createdById",
  "createdAt"
FROM "ServiceOrder"
WHERE "taskId" = 'c5c9ea18-7e84-4054-adf9-e3908a609ae0'
ORDER BY "createdAt" DESC;

-- Check changelogs
SELECT 
  id,
  "entityType",
  "entityId",
  action,
  field,
  reason,
  "createdAt",
  "userId"
FROM "ChangeLog"
WHERE "entityType" = 'SERVICE_ORDER'
  AND "entityId" IN (
    SELECT id FROM "ServiceOrder" WHERE "taskId" = 'c5c9ea18-7e84-4054-adf9-e3908a609ae0'
  )
ORDER BY "createdAt" DESC;

-- Check notifications
SELECT 
  id,
  type,
  title,
  body,
  "relatedEntityType",
  "relatedEntityId",
  "createdAt",
  "userId"
FROM "Notification"
WHERE "relatedEntityType" = 'SERVICE_ORDER'
  AND "relatedEntityId" IN (
    SELECT id FROM "ServiceOrder" WHERE "taskId" = 'c5c9ea18-7e84-4054-adf9-e3908a609ae0'
  )
ORDER BY "createdAt" DESC;
