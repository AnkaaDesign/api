# Deploy gate — run database migrations before/with each release

## Why this matters

Several recent features hard-depend on schema that ships in Prisma migrations.
If the new code is deployed **before** its migration is applied, the app throws
at runtime:

| Feature | Migration | Failure if not applied first |
|---|---|---|
| Accent/case-insensitive global search | `20260624150000_accent_insensitive_search` | every affected list query references `*Normalized` columns → `column does not exist` → 500 |
| Task-quote `CANCELLED` status (task→quote cancel cascade) | `20260624160000_add_taskquote_cancelled_status` | cancelling a quote → `invalid input value for enum TaskQuoteStatus: "CANCELLED"` |

Both migrations are additive and safe to re-run (`migrate deploy` is idempotent;
the enum one uses `ADD VALUE IF NOT EXISTS`). As of the last check both are
applied to the local DB; **production application is the deploy step below.**

## The gate

There is currently **no automated migration step** — no Dockerfile/CI/Procfile
runs migrations, and `pnpm start` only boots the compiled app. `prisma` (the CLI)
is a **devDependency**, so do NOT add `migrate deploy` to `start` if production
prunes devDependencies — it would fail to boot.

Run this as an explicit step in the deploy pipeline, **after** `pnpm build` and
**before** (or together with) starting the new code, on a host that has the
`prisma` CLI and the prod `DATABASE_URL`:

```bash
pnpm db:migrate:deploy      # = prisma migrate deploy
```

Check pending migrations at any time:
```bash
npx prisma migrate status
```

If devDependencies are pruned in prod, run the migration from a build/CI stage
that still has them, or vendor the CLI: `pnpm dlx prisma@6.19.2 migrate deploy`.

> Recommendation: bake `pnpm db:migrate:deploy` into the release pipeline so the
> gate can't be forgotten. Never use `migrate dev`/`migrate reset` against prod.
