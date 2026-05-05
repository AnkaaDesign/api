# Solicitação de Ausência (Employee self-service) — Implementation Plan

Captured from the Secullum iOS app via Proxyman MitM (HAR `192.168.10.145_05-05-2026-13-23-20.har`).

## 1. What was captured

Base host: `pontowebapp.secullum.com.br`. Workspace prefix: `/118769/`.

| # | Method | Path | Role |
|---|--------|------|------|
| 1 | GET    | `/118769/Justificativas` | List of motivos (with `exigirFotoAtestado` flag) |
| 2 | GET    | `/118769/Batidas/{from}/{to}` | Day-by-day batidas (used to detect missing days) |
| 3 | GET    | `/118769/Solicitacoes/{date}?origemRequisicao=0` | Existing solicitação for a date (if any) |
| 4 | POST   | `/118769/Solicitacoes` | **Create the absence justification request** |
| 5 | GET    | `/118769/Notificacoes/{from}/{to}` | App notifications (approved / rejected requests) |

Auth header on all of them: `Authorization: Basic MTU6MTIzOjA=` → decodes to `15:123:0`.
That is the same `BasicId:BasicSecret:DatabaseId` triple already wired in
`api/src/modules/integrations/secullum/secullum.service.ts` (`makeAuthenticatedRequest`),
so no new auth work is required — we reuse the existing client.

## 2. Confirming this is NEW (not the existing `createAbsence`)

`secullum.service.ts:1128 createAbsence` calls **`POST /FuncionariosAfastamentos`** with
`{ Inicio, Fim, JustificativaId, Motivo, FuncionarioId }`. That is the **admin / HR** path
where a manager pre-records an absence directly, no approval flow.

The screenshot ("Justificar Ausência" → Cancelar/Enviar) is the **employee self-service**
path that posts to a different endpoint (`/Solicitacoes`) with a different payload, then
sits in a manager approval queue (visible in the existing `getRequests` listing). So we're
adding a new method, not reusing `createAbsence`.

## 3. POST /Solicitacoes — exact payload

```json
{
  "data": "2026-04-23T00:00:00",
  "funcionarioId": 1,
  "solicitanteId": null,
  "justificativaId": 1,
  "entrada1": null, "saida1": null,
  "entrada2": null, "saida2": null,
  "entrada3": null, "saida3": null,
  "entrada4": null, "saida4": null,
  "entrada5": null, "saida5": null,
  "filtro1Id": null,
  "filtro2Id": null,
  "periculosidade": null,
  "versao": null,
  "tipo": 2,
  "observacoes": "Alex - Adere",
  "dados": null,
  "foto": "<base64 JPEG, no data: prefix>"
}
```

Field semantics inferred from the captured request + `GET /Solicitacoes/{date}` echo:

| Field | Meaning |
|-------|---------|
| `data` | Day of the absence, ISO with `T00:00:00`, **no timezone suffix**. |
| `funcionarioId` | Secullum employee numeric ID. From the existing user→Secullum mapping table (`User.secullumEmployeeId`). |
| `solicitanteId` | `null` for self-service requests (server fills it from the auth token). |
| `justificativaId` | The motivo id from `GET /Justificativas`. |
| `tipo` | `2` for "Justificar Ausência". (Other values: `0`/`1` for ajuste-de-ponto / inclusão — outside this feature's scope.) |
| `entrada1..5 / saida1..5` | `null` for "Dia Inteiro". For "Manhã" / "Tarde" they get HH:mm strings (would need a separate capture to confirm exact mapping; **not required for the missing-day full-absence flow** the user asked for). |
| `observacoes` | Free text shown on the manager's approval card. |
| `foto` | base64 JPEG, **required** when `justificativa.exigirFotoAtestado === true` (e.g. id=1 ATESTADO MÉDICO). The Secullum response is empty `200`. |

Response: `200 OK`, empty body.

## 4. Justificativas response shape

```json
[
  { "id": 1, "exigirFotoAtestado": true,  "naoPermitirFuncionariosUtilizar": false, "nomeCompleto": "ATESTADO MÉDICO" },
  { "id": 2, "exigirFotoAtestado": false, "naoPermitirFuncionariosUtilizar": false, "nomeCompleto": "FÉRIAS" },
  { "id": 4, "exigirFotoAtestado": false, "naoPermitirFuncionariosUtilizar": false, "nomeCompleto": "ESQUECE" },
  { "id": 5, "exigirFotoAtestado": false, "naoPermitirFuncionariosUtilizar": false, "nomeCompleto": "Declarç" }
  /* … */
]
```

UI must:
- Filter out items with `naoPermitirFuncionariosUtilizar === true`.
- Show `exigirFotoAtestado` motivos with a required photo input.

## 5. Batidas response — how to detect "missing days"

`GET /Batidas/{empId}/{from}/{to}` returns `{ totais, lista[] }`.
Each `lista[i]`:

```json
{
  "id": 10727,
  "data": "2026-04-21T00:00:00",
  "funcionarioNome": "...",
  "batidas": [
    { "nome": "Entrada 1", "valor": "Feriado", "valorOriginal": null, … },
    { "nome": "Saída 1",   "valor": "Feriado", "valorOriginal": null, … },
    /* 4 more pairs */
  ],
  "valores": [ { "nome": "Faltas", "valor": "" }, /* … */ ],
  "saldo": "+00:00",
  "situacao": 0,
  "registroPendente": false,
  "existePeriodoEncerrado": false
}
```

Rule for "day without batida" (the user's filter):

```
isMissing(day) =
     day.batidas.every(b => b.valor === "" || b.valor == null)
  && !day.batidas.some(b => b.valor === "Feriado")
  && day.data <= today
  && !isWeeklyOff(day) // optional: filter by Horario afterwards
```

A simpler proxy that matches the Secullum UI: `valores[*].nome === "Faltas"` with a
non-zero `valor` (e.g. `"08:00"`) — but that requires parsing strings, so the all-empty
heuristic above is more robust.

## 6. Existing solicitação check

Before opening the form for a chosen date, call
`GET /Solicitacoes/{date}?origemRequisicao=0`. Status `200` with a JSON body means a
solicitação already exists for that day → show "Já solicitado" instead of allowing a
duplicate. `404`/empty → safe to create.

## 7. Implementation — Backend (NestJS)

File: `api/src/modules/integrations/secullum/secullum.service.ts`

Add three new methods (reusing `makeAuthenticatedRequest`):

```ts
async getMyMissingDays(userId: string, from: string, to: string)
  → calls GET /Batidas/{empId}/{from}/{to}
  → returns the filtered `MissingDay[]` (date + saldo + dayOfWeek pt-BR label)

async getExistingSolicitacaoForDate(userId: string, date: string)
  → GET /Solicitacoes/{date}?origemRequisicao=0
  → returns null on 404, parsed object on 200

async createSolicitacaoAusencia(userId: string, dto: CreateSolicitacaoAusenciaDto)
  → POST /Solicitacoes with the payload above
  → resolves funcionarioId from the user→Secullum mapping
  → encodes the photo (if provided) to base64 with no data: prefix
  → enforces "foto required" when justificativa.exigirFotoAtestado is true
```

DTO additions in `dto/index.ts`:

```ts
export interface SecullumCreateSolicitacaoAusenciaDto {
  date: string;            // YYYY-MM-DD
  justificativaId: number;
  periodo: 'INTEIRO' | 'MANHA' | 'TARDE'; // future-proof; "INTEIRO" only for v1
  observacoes?: string;
  photoBase64?: string;    // required when justificativa.exigirFotoAtestado
}

export interface SecullumMissingDay {
  date: string;            // YYYY-MM-DD
  weekdayPt: string;       // "Segunda-Feira"
  saldo?: string;          // "-08:00"
}
```

Controller additions in `secullum.controller.ts`:

```ts
@Get('me/missing-days')          → getMyMissingDays
@Get('me/solicitacoes/:date')    → getExistingSolicitacao
@Post('me/solicitacoes/ausencia') → createSolicitacaoAusencia
```

(Use `me/` prefix to mirror the existing `me/calculations` pattern. These resolve
`funcionarioId` from the auth user, not from the request body.)

## 8. Implementation — Mobile (React Native + Expo Router)

### 8.1 New routes

```
mobile/src/app/(tabs)/pessoal/meus-pontos/
  ├─ index.tsx                       (existing — table of calculations)
  ├─ justificar-ausencia/
  │   ├─ index.tsx                   NEW — list of missing days (filtered)
  │   └─ [date].tsx                  NEW — form for a chosen date
```

### 8.2 List screen (`justificar-ausencia/index.tsx`)

- Header: "Justificar Ausência"
- Subtitle: "Selecione um dia sem batida para enviar a justificativa."
- Date-range picker default: last 14 days through today (matches Secullum app default).
- Body: `FlatList` of `MissingDay`, each row → `Terça-Feira, 23/04/2026` + saldo badge `-08:00`.
- Tap a row → `router.push("./justificar-ausencia/2026-04-23")`.
- Empty state: "Sem dias pendentes 🎉" (no faltas in the period).

### 8.3 Form screen (`justificar-ausencia/[date].tsx`)

Match the screenshot layout exactly:

| Field | Component |
|-------|-----------|
| Header | "Justificar Ausência" with back button |
| Info box | Cyan informational text (matches Secullum style) |
| Ausência em | Disabled select fixed at `Dia Específico` (single-day v1) |
| Data | Read-only display of the route param (`Terça-Feira, 05/05/2026`) |
| Período da Ausência | Select: Dia Inteiro / Manhã / Tarde (only Dia Inteiro wired in v1) |
| Motivo | Combobox sourced from `GET /justifications` (existing endpoint) |
| Foto | `expo-image-picker` — only shown when motivo has `exigirFotoAtestado` |
| Observação | Multi-line `Input` |
| Cancelar / Enviar | Buttons matching the existing `meu-pessoal` style |

Submit calls `useCreateSolicitacaoAusencia()` mutation → on success: invalidate
`secullumKeys.timeEntries` + `secullumKeys.calculations` + the new
`secullumKeys.missingDays`, toast "Solicitação enviada para aprovação", `router.back()`.

### 8.4 New api-client + hooks

`mobile/src/api-client/services/secullum.ts` — append:

```ts
getMyMissingDays: (params: { from: string; to: string }) =>
  apiClient.get<{ success: boolean; data: SecullumMissingDay[] }>(
    "/integrations/secullum/me/missing-days", { params }),

getExistingSolicitacaoByDate: (date: string) =>
  apiClient.get<{ success: boolean; data: any | null }>(
    `/integrations/secullum/me/solicitacoes/${date}`),

createSolicitacaoAusencia: (body: CreateSolicitacaoAusenciaDto) =>
  apiClient.post<{ success: boolean }>(
    "/integrations/secullum/me/solicitacoes/ausencia", body),
```

`mobile/src/hooks/secullum.ts` — append `useMyMissingDays`, `useCreateSolicitacaoAusencia`,
plus a `secullumKeys.missingDays(params)` query key.

### 8.5 Entry point

Add a header action button on `pessoal/meus-pontos/index.tsx` (near the existing list
icon at line ~3) that pushes to `./justificar-ausencia`. Icon: `IconCalendarOff` from
`@tabler/icons-react-native`. Visible only when the existing `apiResponse.data` shows
faltas in the current period (`saldo` < 0).

## 9. Caveats / Open questions to verify with one more capture

1. **Manhã / Tarde period mapping** — current capture only has "Dia Inteiro" (`entrada1..5/saida1..5` all null). Before enabling those toggles, capture once more with each option to confirm what time-pair Secullum expects.
2. **Photo size limit** — the captured payload was 160 KB base64. Secullum likely caps around 1 MB. Run image through `expo-image-manipulator` (resize 1024px max, JPEG quality 0.7) before upload to stay safe.
3. **Timezone** — `data` is `T00:00:00` with no offset. Send as local-zone midnight string, not `toISOString()` (which becomes UTC and shifts the date in BRT).
4. **Server response** — the captured 200 had an empty body. Treat any 2xx as success; do not parse the body.

## 10. Suggested rollout order

1. Backend: DTOs + service methods + controller routes + unit test for "missing day filter".
2. Mobile: hooks/api-client wiring (no UI yet) — verify with a Postman-style smoke test from a dev script.
3. Mobile: list screen.
4. Mobile: form screen, photo picker last.
5. QA on a real Secullum-mapped account (the existing `User.secullumEmployeeId` must be set, otherwise 404 on `funcionarioId` resolution).

## 11. Implementation summary (shipped)

### Backend

- `api/src/modules/integrations/secullum/dto/index.ts` — added DTOs: `SecullumMissingDay`, `SecullumMissingDaysResponse`, `SecullumSolicitacaoRecord`, `SecullumExistingSolicitacaoResponse`, `SecullumCreateJustifyAbsenceDto`, `SecullumCreateJustifyAbsenceResponse`.
- `api/src/modules/integrations/secullum/secullum.service.ts` — appended four low-level methods:
  - `getJustificativasForFuncionario()` → `GET /Justificativas` (camelCase shape, filters out `naoPermitirFuncionariosUtilizar`)
  - `getMissingDaysForEmployee(empId, from, to)` → `GET /Batidas/{empId}/{from}/{to}` + filter (skips holidays, future days; uses `valores[Faltas]` as primary signal with all-empty-batidas fallback)
  - `getSolicitacaoByDate(date)` → `GET /Solicitacoes/{date}?origemRequisicao=0`, normalises hollow stub (`justificativaId === null`) to `data: null`
  - `createJustifyAbsence(empId, payload)` → `POST /Solicitacoes` with the full 24-field payload (tipo=2, all entrada/saida null, temFoto, registroPendente, existePeriodoEncerrado, tipoAusencia=0). Surfaces Secullum's `[{property,message,data}]` 400 array as `validationErrors` on the response.
- `api/src/modules/people/personal/personal.service.ts` — added orchestration methods: `resolveMySecullumEmployeeId`, `getMyMissingDays`, `getMyExistingSolicitacao`, `getMyJustificativas`, `createMyJustifyAbsence` (pre-validates `exigirFotoAtestado`).
- `api/src/modules/people/personal/personal.controller.ts` — added 4 routes: `GET /personal/my-missing-days`, `GET /personal/my-secullum-justificativas`, `GET /personal/my-secullum-solicitacoes/:date`, `POST /personal/my-secullum-solicitacoes/ausencia`.

### Mobile

- `mobile/src/api-client/services/secullum.ts` — appended 4 calls under `/personal/...`.
- `mobile/src/hooks/secullum.ts` — appended `useMyMissingDays`, `useMyJustificativas`, `useMyExistingSolicitacao`, `useCreateMyJustifyAbsence` with cache invalidation on success.
- `mobile/src/app/(tabs)/pessoal/meus-pontos/justificar-ausencia/index.tsx` — list of missing days with empty / loading / error states, RefreshControl, disabled rows for `existePeriodoEncerrado`.
- `mobile/src/app/(tabs)/pessoal/meus-pontos/justificar-ausencia/[date].tsx` — form mirroring the Secullum app screenshot (Dia Específico / Dia Inteiro locked for v1, motivo combobox, conditional photo picker via `expo-image-picker` + `expo-file-system` base64, observação textarea, existing-solicitação read-only banner).
- `mobile/src/app/(tabs)/pessoal/meus-pontos/index.tsx` — added `IconCalendarOff` shortcut button next to the column visibility button.

### Out of scope for v1 (intentionally deferred)

- `tipo=3` (Esquecimento de Batida) — would need its own form (specific time pair).
- `tipo=15` (Afastamento, multi-day) — uses `/Solicitacoes/Afastamento` with UTC ISO dates; needs date-range UI.
- Manhã / Tarde period selection — requires another HAR capture to confirm the entrada/saida payload Secullum expects.
- Image resizing — `expo-image-manipulator` not installed; `quality: 0.7` on the picker keeps payloads under ~250 KB which is below Secullum's accepted size.
