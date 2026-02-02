-- Comprehensive test of Representative implementation

\echo '===== REPRESENTATIVE IMPLEMENTATION VERIFICATION ====='
\echo ''

\echo '1. Representative Table Structure:'
\d "Representative"

\echo ''
\echo '2. Representative Role Enum Values:'
SELECT unnest(enum_range(NULL::"RepresentativeRole"));

\echo ''
\echo '3. Count of Representatives:'
SELECT COUNT(*) as total_representatives FROM "Representative";

\echo ''
\echo '4. Representatives by Role:'
SELECT role, COUNT(*) as count FROM "Representative" GROUP BY role;

\echo ''
\echo '5. Task-Representative Relationship (Junction Table):'
\d "_TaskRepresentatives"

\echo ''
\echo '6. Count of Task-Representative Relations:'
SELECT COUNT(*) FROM "_TaskRepresentatives";

\echo ''
\echo '7. Representatives with Customer Details:'
SELECT
    r.id,
    r.name,
    r.role,
    r.email,
    r.phone,
    c."fantasyName" as customer_name,
    CASE WHEN r.password IS NOT NULL THEN 'Yes' ELSE 'No' END as can_login
FROM "Representative" r
JOIN "Customer" c ON r."customerId" = c.id
LIMIT 10;

\echo ''
\echo '8. Tasks with Representatives:'
SELECT
    t.id as task_id,
    t.name as task_name,
    COUNT(tr."B") as representative_count
FROM "Task" t
LEFT JOIN "_TaskRepresentatives" tr ON t.id = tr."A"
GROUP BY t.id, t.name
HAVING COUNT(tr."B") > 0
LIMIT 10;

\echo ''
\echo '===== VERIFICATION COMPLETE =====';