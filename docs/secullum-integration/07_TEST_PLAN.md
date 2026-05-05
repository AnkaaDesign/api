# Secullum integration — End-to-end smoke test

This is the validation procedure to run **after `pnpm db:migrate:deploy` and
the bootstrap mapping script**. It exercises the full create/update/dismiss
loop using a disposable test user — never touching real employee records.

## Pre-flight

1. `cd C:\Zepetto\ankaa-api && pnpm db:migrate:deploy`
   (applies `add_secullum_mapping_ids`)
2. `pnpm exec tsx scripts/secullum/initial-mapping.ts`
   Expected log:
   ```
   ✔ ADMINISTRATIVO    → Departamento #2 (ADMINISTRATIVO)
   ✔ ALMOXARIFADO      → Departamento #4 (ALMOXARIFADO)
   ✔ LOGISTICA         → Departamento #5 (LOGISTICA)
   ✔ PRODUÇÃO          → Departamento #3 (PRODUÇÃO)
   ✔ ASSISTENTE ADMINISTRATIVO → Função #3
   ... (17 funções)
   linked 4/4 departamentos and N/17 funções.
   ```
   Any unmatched Função will be skipped — admin can map it manually from the
   `/recursos-humanos/integracoes/secullum/mapeamento` page.

## T1 — Mapping page is reachable

- Sidebar → **Recursos Humanos → Integração Secullum → Mapeamento**.
- 3 tabs render. Departamentos tab shows 4 rows, all "Vinculado". Funções tab
  shows 17, the linked ones marked.

## T2 — Sector / Position list show Secullum column

- Navigate to **Administração → Setores**. Last column "SECULLUM" shows
  `#2`, `#4`, `#5`, `#3` for the 4 sectors. ✅
- Navigate to **Recursos Humanos → Cargos**. Same column. ✅

## T3 — Create user with sync (disposable)

In the Ankaa user form (Administração → Usuários → Cadastrar):

| Field | Value |
|---|---|
| Nome | `_TEST_E2E_SECULLUM` |
| Email | `e2e+secullum@example.test` |
| CPF | use a generator ([gerardocumentos.com.br](https://www.gerardocumentos.com.br/?cpf)); the format is `xxx.xxx.xxx-xx`, must validate |
| Telefone | any valid Brazilian mobile |
| Nº Folha | `998` |
| Cargo | any (must be linked to a Função) |
| Setor | any (must be linked to a Departamento) |
| **Criar / sincronizar no Secullum** | **ON** |

Save. The success toast says "Usuário criado com sucesso". Within ~2s the API
log shows:

```
[secullum] user <uuid> ↔ Funcionario <NN> linked
```

Verify in Secullum (`https://pontoweb.secullum.com.br/#/funcionarios`) — search
for `_TEST_E2E_SECULLUM`. The row appears with the right CPF, Nº Folha, Cargo,
Departamento. Open it: **Endereço** is the joined address+number+complement,
**Admissão** is `User.exp1StartAt`, **Nascimento** is `User.birth`.

## T4 — Edit user → mirror to Secullum

In the Ankaa user form, change **Telefone**. Save. API log:

```
[secullum] user <uuid> → Funcionario <NN> updated
```

Reload Secullum funcionario edit form — phone changed.

## T5 — Set dismissedAt → soft-dismiss in Secullum

In the Ankaa user form, set **Status = Demitido** (which auto-fills `dismissedAt`).
Save. API log:

```
[secullum] user <uuid> → Funcionario <NN> updated + dismissed
```

In Secullum, search the active funcionarios list for `_TEST_E2E_SECULLUM` —
should be **empty** (the row is soft-dismissed; it stays in the DB but is
hidden from the active list).

## T6 — Cleanup

In Ankaa, hard-delete the test user. Then in Secullum's active list ensure
the row is gone (it'll still exist in the dismissed list — that's fine; manual
hard-delete from the SPA needs the operator password and is a one-time admin
chore).

---

## What "good" looks like

- Steps T3, T4, T5 each fire exactly **one** Secullum POST per Ankaa save —
  no infinite loops, no spurious `Funcionario not found` errors.
- The mapping page never shows red ("Sem correspondência") for a sector or
  position that's actively used.
- The "Criar / sincronizar no Secullum" switch is **OFF by default** for new
  users (opt-in).

## Common failures and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `[secullum] cannot create funcionário: missing Secullum mapping` | Sector/Position not linked | Run the bootstrap script, or use the mapping page |
| `[secullum] createFuncionario failed: 401` | Backend `SECULLUM_*` env vars missing or stale | Check `apps/api/.env` and bounce the API |
| `[secullum] createFuncionario failed: 400 Cpf inválido` | CPF format wrong (must be `xxx.xxx.xxx-xx` with valid check digits) | Use a real CPF generator |
| Funcionario created with empty Endereço | User has no `address` field set | Fill address fields before enabling sync |
| Bridge silently skips on update | `secullumSyncEnabled=false` OR `secullumEmployeeId=null` | Toggle the switch ON in the user form |

---

## Hard-delete notes (manual / out of scope for automation)

Funcionario hard-delete needs the operator password (typed into the SPA's
`Senha usuário` field on the delete dialog). Do **NOT** automate this.
Soft-dismiss (T5) is the supported automated path — it preserves all batidas.
