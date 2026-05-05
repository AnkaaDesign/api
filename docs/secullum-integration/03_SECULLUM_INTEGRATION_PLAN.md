# Secullum ↔ Ankaa Integration Plan

Goal: turn the existing partial integration into a **complete bi-directional layer** so that:

- An admin creating an Ankaa user can opt-in to "Create in Secullum" and the
  funcionário is provisioned automatically with all available info.
- Dismissing an Ankaa user automatically dismisses (or moves) the funcionário in
  Secullum.
- Departments (`Sector` in Ankaa) and Positions (`Position` in Ankaa) are mapped
  and kept in sync with Secullum's `Departamentos` / `Funcoes`.
- `Atividades`, `Justificativas`, `Feriados`, `Horarios`, batidas, fechamentos,
  cálculos, absenteísmo and assinatura digital are all reachable through our
  Secullum service / controller.

This plan picks **the minimum schema/code change** that makes the above work.

---

## 1. Schema changes (Prisma)

Add three nullable Secullum-id columns + one User column. None of these break
existing behavior; they're purely additive.

```prisma
model User {
  // ...existing fields...
  secullumEmployeeId  Int?       @unique     // Funcionario.Id in Secullum
  secullumSyncEnabled Boolean    @default(false)  // checkbox value, persisted
}

model Sector {
  // ...existing fields...
  secullumDepartamentoId  Int?  @unique      // Departamento.Id
}

model Position {
  // ...existing fields...
  secullumFuncaoId        Int?  @unique      // Funcao.Id
}
```

(SecullumToken model already exists.)

Migration name: `add_secullum_mapping_ids`.

---

## 2. Mapping strategy

### 2.1 Sector ↔ Departamento

- On boot (and on demand), call `GET /Departamentos`.
- For each Secullum department, **match by uppercased name** with our `Sector.name`.
  - Match found → `sector.secullumDepartamentoId = depto.Id`.
  - No match → log `unmatched_secullum_department`. Admin UI surfaces these.
- For each Ankaa sector with no Secullum mapping → admin chooses: create in
  Secullum (`POST /Departamentos {Descricao: sector.name}`) or link manually.

### 2.2 Position ↔ Função

- Same pattern with `GET /Funcoes` matched by uppercased `Position.name`.
- Note: Secullum has more granular positions in this tenant
  ("LETRISTA JUNIOR I" through "LETRISTA SÊNIOR IV"). When Ankaa has a coarser
  "Letrista Junior" we keep one **canonical** mapping and let the admin override.

### 2.3 User ↔ Funcionario

- **Existing service** already does CPF/PIS/PayrollNumber lookup (lines
  `secullum.service.ts:1264 syncUser` and the `getEmployees`/`/Funcionarios`
  call). We persist the result instead of re-looking up:
  - On every `syncUser`/`getEmployees` call, write back the matched `Funcionario.Id`
    onto `User.secullumEmployeeId`.

---

## 3. Service additions (apps/api/src/modules/integrations/secullum/secullum.service.ts)

Add the following methods (all use `this.apiClient` with the existing token logic):

```ts
// Cadastros — generic helpers
listDepartamentos(): Promise<SecullumDepartamento[]>
upsertDepartamento(d: { Id?: number; Descricao: string; Nfolha?: string|null }): Promise<SecullumDepartamento>
deleteDepartamento(id: number): Promise<void>

listFuncoes(): Promise<SecullumFuncao[]>
upsertFuncao(f: { Id?: number; Descricao: string }): Promise<SecullumFuncao>
deleteFuncao(id: number): Promise<void>

listAtividades(): Promise<SecullumAtividade[]>
upsertAtividade(a: { Id?: number; Descricao: string; DescricaoAbreviada?: string; TipoDeAtividade?: number }): Promise<SecullumAtividade>
deleteAtividade(id: number): Promise<void>

listEmpresas(): Promise<SecullumEmpresa[]>
listEstruturas(): Promise<any[]>
listEscolaridades(): Promise<any[]>
listMotivosDemissao(): Promise<{ Id: number; Descricao: string }[]>

// Funcionarios CRUD
getFuncionarioFull(secullumId: number): Promise<SecullumFuncionarioFull>
createFuncionario(payload: SecullumFuncionarioCreate): Promise<SecullumFuncionarioFull>
updateFuncionario(id: number, payload: Partial<SecullumFuncionarioFull>): Promise<SecullumFuncionarioFull>
dismissFuncionario(id: number, demissaoDate: string, motivoDemissaoId?: number): Promise<SecullumFuncionarioFull>
deleteFuncionario(id: number): Promise<void>
listFuncionariosDemitidos(): Promise<SecullumFuncionario[]>
getAfastamentos(empId: number): Promise<any[]>

// Justificativas CRUD (currently only read)
upsertJustificativa(j: { Id?: number; ... }): Promise<...>
deleteJustificativa(id: number): Promise<void>

// Encerramento
listEncerramentos(): Promise<...>
getTipoEncerramento(): Promise<...>
encerrarCalculos(novaData: string): Promise<...>

// Assinatura Digital
listAssinaturas(): Promise<...>
gerarApuracao(payload: { ... }): Promise<...>
removerAssinatura(id: number): Promise<void>

// Mapping helpers
syncDepartamentosBidirectional(): Promise<{
  matched: Array<{ sectorId: string; deptId: number }>;
  createdInSecullum: number[];
  unmatchedSecullum: Array<{ Id: number; Descricao: string }>;
}>
syncFuncoesBidirectional(): Promise<{ same shape with positionId / funcaoId }>;

// User<->Funcionario bridge (high-level, called by user controller)
syncAnkaaUserToSecullum(userId: string, opts: { create: boolean }): Promise<{ secullumEmployeeId: number }>
syncDismissalToSecullum(userId: string, demissaoDate: Date, motivoId?: number): Promise<void>
```

Mostly thin axios wrappers — the auth + interceptors already exist.

---

## 4. Controller additions (secullum.controller.ts)

Expose only what the front-end needs (the rest stay internal helpers):

```
GET    /integrations/secullum/departamentos
POST   /integrations/secullum/departamentos
DELETE /integrations/secullum/departamentos/:id
GET    /integrations/secullum/funcoes
POST   /integrations/secullum/funcoes
DELETE /integrations/secullum/funcoes/:id
GET    /integrations/secullum/atividades
POST   /integrations/secullum/atividades
DELETE /integrations/secullum/atividades/:id

GET    /integrations/secullum/funcionarios               (already exists via getEmployees)
GET    /integrations/secullum/funcionarios/:id           (NEW — full)
POST   /integrations/secullum/funcionarios               (NEW)
PUT    /integrations/secullum/funcionarios/:id           (NEW)
POST   /integrations/secullum/funcionarios/:id/dismiss   (NEW)
DELETE /integrations/secullum/funcionarios/:id           (NEW)
GET    /integrations/secullum/funcionarios-demitidos     (NEW)

POST   /integrations/secullum/sync/departamentos         (NEW — runs sync)
POST   /integrations/secullum/sync/funcoes               (NEW)

POST   /integrations/secullum/encerramento               (NEW — encerrarCalculos)
GET    /integrations/secullum/encerramento               (NEW — list)
GET    /integrations/secullum/assinatura-digital         (NEW)
```

All routes guarded by `AuthGuard` + `Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, ADMIN)`.

---

## 5. UserService hook

Edit `apps/api/src/modules/people/user/user.service.ts`:

- `create(data, ...)`: after the Ankaa user is persisted, **if
  `data.syncToSecullum === true`** call
  `secullumService.syncAnkaaUserToSecullum(user.id, { create: true })`. Persist
  returned `secullumEmployeeId`. Failures should not roll back the local user
  (admin gets a soft warning).
- `update(id, data, ...)`: when `data.dismissalDate` transitions from null → a
  date, fire `secullumService.syncDismissalToSecullum(...)`. Best-effort, async,
  logged.

UserModule must import SecullumModule (currently the dependency goes the other
way: SecullumModule imports UserModule). Use `forwardRef()` if circular.

---

## 6. Web changes (apps/web)

### 6.1 user-form.tsx
Add a new switch component `secullum-sync-switch.tsx` placed in the existing
"DADOS PROFISSIONAIS" card under `PositionSelector`/`SectorSelector`:

```tsx
<SecullumSyncSwitch />   // bound to form field `syncToSecullum: boolean`
```

Default `false` for safety. Only visible to admin/HR roles.

### 6.2 user-edit-form.tsx
Show read-only badge "Sincronizado com Secullum (#{secullumEmployeeId})" if set;
hide the create switch for existing users.

### 6.3 Sector/Position list pages
Add a column "Secullum ID" + a "Sincronizar com Secullum" button that calls the
new sync endpoints.

### 6.4 New page: `pages/integrations/secullum/mapping.tsx`
Surface unmatched departamentos / funções so admins can resolve them once.

---

## 7. Rollout order

1. **Schema migration** (`add_secullum_mapping_ids`).
2. **Service methods** for Departamentos / Funcoes / Atividades / Funcionarios
   CRUD (the lowest-risk additions; no behavior change anywhere else).
3. **One-shot mapping job**: `pnpm exec ts-node scripts/secullum/initial-mapping.ts`
   → matches existing sectors/positions → writes `secullumDepartamentoId`/
   `secullumFuncaoId`.
4. **Controller endpoints** + admin "Mapping" page.
5. **User form switch** + create-side hook.
6. **User dismissal hook**.
7. **Encerramento + Assinatura digital** endpoints last (admin-only, low traffic).

---

## 8. Test plan (only Andressa Rodrigues / TEST records)

| Step | Action | Expected |
|---|---|---|
| T1 | `POST /Departamentos {Descricao:"_SYNC_TEST"}` then `DELETE` | ✅ Already validated live |
| T2 | `POST /Funcoes {Descricao:"_SYNC_TEST"}` then `DELETE` | Mirror of T1 |
| T3 | Create new Ankaa user with `syncToSecullum=true` and dummy CPF | New funcionário appears in Secullum, `secullumEmployeeId` filled |
| T4 | Edit Ankaa user (name change) with sync on | `POST /Funcionarios` upsert fires |
| T5 | Set Ankaa user `dismissalDate` | `POST /Funcionarios` upsert fires with `Demissao` set |
| T6 | Run `syncDepartamentosBidirectional` | Sector "Administrativo" gets `secullumDepartamentoId=2`, etc |
| T7 | `getFuncionarioFull(1)` for Andressa | Returns full record with Foto, endereço, contatos |

T3–T5 should only be done with a **dedicated** test user inside Andressa's
empresa (NOT Andressa herself), then deleted.

---

## 9. Open questions / TBD

1. **`Funcionario.POST` payload precise shape** — confirmed conceptually (upsert)
   but not run end-to-end due to the seat-limit warning in this tenant
   (22/30). Will validate in T3 with a dedicated test record.
2. **`Encerramento` payload** — UI shows only "Nova Data de Encerramento" date
   picker; the request body (likely `{NovaDataEncerramento:"yyyy-mm-dd"}`) needs
   one more capture pass after we click Encerrar with a date set in the past
   (won't actually close anything if data is already closed).
3. **`Assinatura Digital` apurar / sign / reject payloads** — not yet captured.
4. **Photo upload** — `Foto` is base64 in GET; capture POST payload for setting
   it. The existing `apps/web/.../photo-view-dialog.tsx` may already handle this.
5. **`MotivosDemissao`** is empty in this tenant — admin must add some before
   automated dismissals can attach a motive.
