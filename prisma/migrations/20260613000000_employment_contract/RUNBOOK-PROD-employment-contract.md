# Prod runbook — EmploymentContract (vínculo) migration `20260613000000_employment_contract`

Status: **applied LOCALLY only** on 2026-06-13. Production run **pending**.

## What it does
- Adds enums `ContractType`, `ContractStatus`, `EmployeeType`; drops `ContractKind`.
- Adds `EmploymentContract` table (one vínculo per row) + FK columns on
  `Admission.contractId` (unique), `Termination.contractId`, `Payroll.contractId`,
  and `User.currentContractId` + `currentContractType/Status/EmployeeType` cache.
- Drops `Admission.userId` unique (enables rehires).
- **Backfills** one `sequence=1` contract per existing user from the old `User` columns,
  sets the `User.current*` cache, links existing admissions.
- **Special case Kennedy Campos** (`41fcb3fe-…`): seq-1 CLT (DISMISSED 2024-03-28) +
  seq-2 TERCEIRIZADO (ACTIVE, admissionDate 2024-04-01, current).
- Data repair: `isActive=false` for any `currentContractStatus=DISMISSED`.
- Drops the migrated `User` columns (`contractKind`, `contractKindOrder`, `exp*`, `effectedAt`,
  `dismissedAt`) + their indexes.

## Pre-flight (prod)
1. `pg_dump -Fc` backup of `ankaa_production`.
2. Confirm `prisma migrate status` shows no pending/failed migrations.
3. The Kennedy/Alisson special-case IDs are local-DB IDs. **Re-check the prod user IDs/CPFs**
   before running; if the prod `User.id` for Kennedy differs, edit section 5 of `migration.sql`
   (or run the generic backfill, then apply the Kennedy seq-2 + flip manually).

## Apply
```
npm run db:migrate:deploy   # prisma migrate deploy
npm run db:generate
```
Do **not** use `db push` / `migrate reset`.

## Verify (prod)
- `SELECT count(*) FROM "User" WHERE "currentContractId" IS NULL;` → 0
- every user has exactly one `isCurrent` contract (see migration verify queries)
- ACTIVE/DISMISSED counts match the prior `contractKind` distribution
- Kennedy has 2 contracts, current = TERCEIRIZADO

## Follow-ups (data, manual)
- **Alisson Nantes** (`97fb1fd3-…`): add the prior dismissed vínculo as `sequence 1` once exact
  admissão/desligamento dates are known; renumber the current EFFECTED one if needed.
- Pedro Antônio `effectedAt=1922`, Flavio `exp1StartAt=1970` — bogus dates carried over verbatim;
  correct at source when real dates are available.
