# Apuração de Cartão Ponto — Aprovar / Descartar (live capture 2026-06-15)

Captured from the Secullum **PontoWeb iOS app** via mitmproxy (HAR `~/secullum-ios-capture.har`),
acting as employee **Kennedy Campos** (`funcionarioId 18`) approving one apuração and rejecting another.

This is the **employee self-service signature** track: the employee digitally signs (approves)
or rejects their own monthly time-card calculation. It is NOT yet implemented in
`secullum.service.ts` — only list / detail / PDF / create / delete exist.

## 1. Host, prefix, auth

- Base host: `pontowebapp.secullum.com.br` (mobile host, **not** `pontoweb.secullum.com.br`)
- Workspace prefix: `/118769/` (the `SECULLUM_CUSTOMER_ID`)
- Auth header on every call: `Authorization: Basic MTUwOjEyMzow` → decodes to `150:123:0`
  = `BasicId:BasicSecret:DatabaseId`, the same triple already wired in
  `secullum.service.ts` (`makeAuthenticatedRequest`). No new auth work.
- `Content-Type: application/json`

## 2. Endpoints captured

| Method | Path | Role |
|--------|------|------|
| GET  | `/118769/AssinaturaDigitalCartaoPonto/CarregarAssinatura/{id}` | Load the apuração object (the body you echo back) |
| GET  | `/118769/AssinaturaDigitalCartaoPonto/{assinaturaDigitalCartaoPontoId}` | Returns the **PDF** time card (Stimulsoft) |
| POST | `/118769/AssinaturaDigitalCartaoPonto/Aprovar`   | **Approve / sign** the apuração |
| POST | `/118769/AssinaturaDigitalCartaoPonto/Descartar` | **Reject** the apuração (with reason) |

Note two distinct IDs travel together:
- `assinaturaDigitalCartaoPontoId` (e.g. `132`, `133`) — the signature-request envelope; `GET /{this}` → PDF.
- `id` (e.g. `472`, `473`) — the per-employee apuração record; `GET /CarregarAssinatura/{id}` → JSON object.

## 3. The `estado` state machine

`estado` is the employee's signature state on the apuração:

| value | meaning |
|-------|---------|
| 0 | Pendente (not yet signed) |
| 1 | Aprovado / assinado (after `Aprovar`) |
| 2 | Rejeitado / descartado (after `Descartar`) |

The request always sends `estado: 0`; the **response echoes the object back with the new
`estado`** (`1` for Aprovar, `2` for Descartar). `estadoGerente` / `motivoGerente` stay `null`
here — those belong to a separate **manager** track (not captured).

## 4. POST /Aprovar — exact payload

The body is the **full apuração object** (as returned by `CarregarAssinatura`), with the
employee's Secullum **password** in `senha` and `motivo: null`:

```json
{
  "assinaturaDigitalCartaoPontoId": 132,
  "estado": 0,
  "estadoGerente": null,
  "dataResposta": null,
  "dataRespostaGerente": null,
  "motivo": null,
  "motivoGerente": null,
  "senha": "123",
  "versao": 2,
  "idioma": "en",
  "geolocalizacao": {
    "latitude": -23.28964236785127,
    "longitude": -51.12910000543171,
    "precisao": 8.91169519137966,
    "endereco": "Rua do Jaboru, Londrina, Paraná, Brasil"
  },
  "funcionarioId": 18,
  "funcionarioNome": "Kennedy Campos",
  "id": 472,
  "descricao": "Apuração Kennedy Campos Maio/2026",
  "compactada": false,
  "dataInicio": "2026-04-26T00:00:00",
  "dataFim": "2026-05-26T00:00:00",
  "dataInclusao": "2026-06-15T18:32:11.547"
}
```

Response: same object, `estado: 1`.

## 5. POST /Descartar — exact payload

Same object, but `senha: null` and `motivo` carries the rejection reason:

```json
{
  "assinaturaDigitalCartaoPontoId": 133,
  "estado": 0,
  "motivo": "Ponto do dia x esta errado",
  "senha": null,
  "versao": 2,
  "idioma": "en",
  "geolocalizacao": { "latitude": -23.2895918, "longitude": -51.1291546, "precisao": 3.49, "endereco": "Rua do Jaboru, Londrina, Paraná, Brasil" },
  "funcionarioId": 18,
  "funcionarioNome": "Kennedy Campos",
  "id": 473,
  "descricao": "Apuração Kennedy Campos Maio/2026 - Tentativa 2",
  "compactada": false,
  "dataInicio": "2026-04-26T00:00:00",
  "dataFim": "2026-05-26T00:00:00",
  "dataInclusao": "2026-06-15T18:46:18.17"
}
```

Response: same object, `estado: 2`.

## 6. Field notes for implementation

- **`senha`** — Aprovar requires the employee's Secullum password. Descartar does not.
  This is the main design decision: where does the password come from in our app? (employee
  re-enters it, or we store/sync it, or we use the manager track instead — see §7).
- **`motivo`** — required (non-null) for Descartar; null for Aprovar.
- **`geolocalizacao`** — sent by the app, but `CarregarAssinatura` returns it as `null`, so it
  is almost certainly optional. Safe to send `null` server-side.
- **`versao: 2`, `idioma`, `compactada: false`** — constants; pass through from the loaded object.
- Cleanest implementation: `GET /CarregarAssinatura/{id}` → mutate `senha`/`motivo` → POST to
  `/Aprovar` or `/Descartar`. Don't hand-build the object; echo what the server gave you.

## 6b. Discovery (no list endpoint) — the Notificacoes feed

There is **no employee-facing list endpoint**; the Secullum app surfaces apurações
purely through notifications. `GET /{customerId}/Notificacoes/{from}/{to}` returns
the feed; an entry with **`tipo === 3` and `assinaturaDigitalCartaoPontoId != null`**
is an apuração awaiting signature. That field actually carries the apuração **record
`id`** (the `CarregarAssinatura` argument), not the PDF id. We build the in-app list
by filtering the feed and loading each `CarregarAssinatura/{id}` for its current `estado`.

## 6c. Implementation (2026-06-15) — Ankaa app, no Secullum poller

Built entirely inside the Ankaa app (apurações are created via Ankaa, which is when the
employee push fires — no Secullum-side poller).

**API** (`pontowebapp` + Basic auth, senha `'123'` via `resolveMyFuncionarioCredentials`):
- `secullum.service.ts`: `getApuracaoNotificacoesAsFuncionario`, `getApuracaoDetailAsFuncionario`,
  `approveApuracaoAsFuncionario`, `rejectApuracaoAsFuncionario`, `buildApuracaoPdfUrl`,
  `notifyHrApuracaoDecision`.
- `personal.service.ts`: `getMyApuracoes` / `getMyApuracaoDetail` / `approveMyApuracao` / `rejectMyApuracao`.
- `personal.controller.ts`: `GET my-assinaturas`, `GET my-assinaturas/:id`,
  `POST my-assinaturas/:id/aprovar`, `POST my-assinaturas/:id/reprovar`.

**Notifications** (all 3 configs already existed in `seed-notification-configs.ts`):
- `secullum.signature.ready` → **employee** (already wired at apuração creation; deep-link
  repointed to `/(tabs)/pessoal/meus-pontos/assinaturas`).
- `secullum.signature.signed` / `secullum.signature.rejected` → **HR** (were DEFERRED; now
  emitted by `notifyHrApuracaoDecision` on approve/reject). Prod seed run still pending.

**Mobile**: `meus-pontos/index.tsx` column-toggle button replaced by the Assinatura
shortcut (all columns now shown by default); new `meus-pontos/assinaturas/index.tsx` (list)
and `[id].tsx` (detail + embedded PDF + Aprovar / Reprovar-motivo modal).

## 7. Open question — employee track vs manager track

What we captured is the **employee** signing their own card (`estado`, `senha`, `funcionarioId = self`).
The object also has `estadoGerente` / `motivoGerente` / `dataRespostaGerente`, implying a separate
**manager approval** track that uses the same `Aprovar`/`Descartar` endpoints but the `*Gerente`
fields (and presumably no employee password). If the goal is for a *manager/HR* to approve/reject
on the back office, we'd need to capture that variant too (log in as a manager in the app and act
on a subordinate's apuração). Confirm which track the feature targets before building.
