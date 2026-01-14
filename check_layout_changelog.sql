-- Check task truck layouts
SELECT
  t.id as task_id,
  t."serialNumber",
  tr."leftSideLayoutId",
  tr."rightSideLayoutId",
  tr."backSideLayoutId"
FROM "Task" t
LEFT JOIN "Truck" tr ON tr.id = t."truckId"
WHERE t.id = 'c5c9ea18-7e84-4054-adf9-e3908a609ae0';

-- Check layout changelogs for this task
SELECT
  cl.id,
  cl."entityType",
  cl."entityId",
  cl.action,
  cl.field,
  cl.reason,
  cl."newValue",
  cl."createdAt",
  cl."userId"
FROM "ChangeLog" cl
WHERE cl."entityType" = 'LAYOUT'
  AND cl."entityId" IN (
    SELECT UNNEST(ARRAY[
      tr."leftSideLayoutId",
      tr."rightSideLayoutId",
      tr."backSideLayoutId"
    ])
    FROM "Task" t
    LEFT JOIN "Truck" tr ON tr.id = t."truckId"
    WHERE t.id = 'c5c9ea18-7e84-4054-adf9-e3908a609ae0'
  )
ORDER BY cl."createdAt" DESC;

-- Check all layout changelogs in the last hour
SELECT
  cl.id,
  cl."entityType",
  cl."entityId",
  cl.action,
  cl.field,
  cl.reason,
  LENGTH(cl."newValue"::text) as newvalue_length,
  cl."createdAt"
FROM "ChangeLog" cl
WHERE cl."entityType" = 'LAYOUT'
  AND cl."createdAt" >= NOW() - INTERVAL '1 hour'
ORDER BY cl."createdAt" DESC;
