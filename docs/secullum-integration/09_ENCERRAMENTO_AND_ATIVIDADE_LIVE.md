# Secullum — Encerramento + Atividade live findings (2026-05-04)

Both probes done with read-only operations and a single deliberately-idempotent
POST. No real data changed.

## A. POST /EncerramentoCalculos — body confirmed

```jsonc
// Request
POST /EncerramentoCalculos
Content-Type: application/json
Authorization: Bearer …
secullumbancoselecionado: 4c8681f2e79a4b7ab58cc94503106736
{ "NovaDataEncerramento": "2026-02-28T00:00:00" }

// Response 200, body empty
```

### Idempotency analysis

The Encerramento I sent re-targeted a date that **was already closed** (the
existing close was 28/02/2026, set by `(SYSTEM)` on 02/05/2026 00:03:34).

After my POST the audit log gained a NEW row:
```jsonc
{ "Id": 16,
  "UsuarioNome": "Kennedy Campos Teixeira",
  "DataHora":     "04/05/2026 09:22:30",
  "Encerramento":     null,    // ← null = skipped (date already closed)
  "DataEncerramento": null }
```

**Interpretation:**
- The data layer **is idempotent** — no double-close, no recalculation.
- The audit layer **is NOT** — every POST writes a row, even no-ops. The
  `Encerramento`/`DataEncerramento` fields are set to `null` when the call is
  a no-op, vs the actual close date when it really closed.
- **Production rule:** before calling `POST /EncerramentoCalculos`, do a
  `GET /EncerramentoCalculos/Listar` and check whether the latest *non-null*
  `DataEncerramento` >= the date you want to close. If yes, skip the POST to
  avoid audit pollution.

### Discriminating "actually closed" from "no-op"
Audit rows where `Encerramento` is null = no-op (date already past previous
close). Real closes always have both `Encerramento` (display) + `DataEncerramento`
(ISO) set.

## B. Atividades vs Cartão Ponto boolean fields

Captured Atividades (`GET /Atividades`):
```json
[
  { "Id": 1, "Descricao": "Fechamento de Ponto", "DescricaoAbreviada": "FP", "TipoDeAtividade": 1 },
  { "Id": 2, "Descricao": "Compensado",          "DescricaoAbreviada": "T. feri", "TipoDeAtividade": 1 }
]
```

Captured Batida row keys (Andressa, period 2026-02-26 → 2026-04-25, 59 days):
```
Id, FuncionarioId, Data, DataExibicao, TipoDoDia,
Entrada1..Saida5, Ajuste, Abono2, Abono3, Abono4, Observacoes,
AlmocoLivre, Compensado, Neutro, Folga, NBanco, Refeicao, Encerrado,
AntesAdmissao, DepoisDemissao, MemoriaCalculoId,
FonteDadosIdEntrada1..Saida5, FonteDadosEntrada1..Saida5,
SolicitacaoFotoIdEntrada1..Saida5, SolicitacaoFotoEntrada1..Saida5,
ListaFonteDados, Versao, NumeroHorario
```

**There is no `AtividadeId` field on the Batida row.** Activities map directly
to **boolean fields**:

| Atividade.Descricao | Batida boolean field |
|---|---|
| `Compensado` (Id=2) | `Compensado: boolean` |
| `Fechamento de Ponto` (Id=1) | `Encerrado: boolean` ← per-row close |
| (built-in) `Folga` | `Folga: boolean` |
| (built-in) `Almoço Livre` | `AlmocoLivre: boolean` |
| (built-in) `Neutro` | `Neutro: boolean` |
| (built-in) `Refeição` | `Refeicao: boolean` |
| (built-in) `NBanco` | `NBanco: boolean` |

**Implication:**
- Adding a new Atividade via `POST /Atividades` does **not** create a new
  column in cartão ponto. Custom atividades are essentially descriptive — they
  show up in pickers and reports but don't alter the Batida shape.
- "Fechamento de Ponto" Atividade (Id=1) is just the human-readable label for
  the `Encerrado` flag on a per-day basis (different from `EncerramentoCalculos`
  which closes a *period* globally).

### Period stats for Andressa, 2026-02-26 → 2026-04-25
- 59 total days
- 3 with `Encerrado: true` (carry-over from previous period close on 28/02)
- 8 with `TipoDoDia: 1` (sundays/folga days)
- 2 with `TipoDoDia: 2` (feriados)
- No Ajuste / Abono2-4 set in the period
- Many days with `Compensado: true` (from earlier UI screenshot)

## C. Cartão Ponto UI audit — already capable

Existing files at `apps/web/src/components/human-resources/time-clock-entry/`:

| File | What it gives you |
|---|---|
| `time-clock-entry-table.tsx` | Editable grid; `Compensado`, `Folga`, `AlmocoLivre`, `Refeicao` checkbox columns wired |
| `cells/time-cell.tsx` | In-place edit of Entrada1..Saida5 |
| `cells/checkbox-cell.tsx` | Toggle the boolean flags |
| `context-menu.tsx` | `move-previous` / `move-next` actions per field — supports the "move column / move day" flow described in the legacy DTO comment |
| `add-justification-dialog.tsx` + `justification-dialog.tsx` | Add `Ajuste` / `Abono*` (justification with reason picked from `/Justificativas`) |
| `location-map-dialog.tsx`, `photo-view-dialog.tsx` | View location/photo for each marking |
| `time-clock-entry-detail-modal.tsx` | Per-day deep view |

**Coverage gap:** the existing UI does NOT expose:

- The `Encerrado` checkbox per row. Reason: it shouldn't — that's the global
  period close marker, not a per-day toggle. ✅ correct as-is.
- The `Neutro` and `NBanco` flags. May be intentional (rarely used) or worth
  adding a column visibility toggle.
- A button to trigger `POST /EncerramentoCalculos`. Should be the new admin
  page (proposed below).

## D. New endpoint to add to our service

Implementation in `secullum-cadastros.service.ts` and controller:

```ts
async encerrarCalculos(novaDataEncerramento: string): Promise<void> {
  // Pre-check: skip if already closed past this date (avoid audit pollution).
  const audit = await this.http.get<Array<{ DataEncerramento: string | null }>>(
    '/EncerramentoCalculos/Listar',
  );
  const latestRealClose = (audit.data ?? [])
    .map(e => e.DataEncerramento)
    .filter(Boolean)
    .sort()
    .reverse()[0];
  if (latestRealClose && latestRealClose >= novaDataEncerramento) {
    this.logger.warn(
      `[secullum] skipping encerrarCalculos(${novaDataEncerramento}) — ` +
      `latest real close is ${latestRealClose}`,
    );
    return;
  }
  await this.http.post('/EncerramentoCalculos', {
    NovaDataEncerramento: this.toSecullumDate(novaDataEncerramento),
  });
}

async listEncerramentos() {
  const r = await this.http.get('/EncerramentoCalculos/Listar');
  return r.data ?? [];
}
```

Controller: `GET /integrations/secullum/encerramentos` and
`POST /integrations/secullum/encerramentos {date: 'YYYY-MM-DD'}`. Restricted
to ADMIN.

## E. Outstanding (not blocking)

- `POST /AssinaturaDigitalCartaoPonto` (criar apuração) — heavy, only safe in
  a single-employee filtered window
- Aprovar / Rejeitar endpoints for AssinaturaDigital — likely follow the
  `/Solicitacoes/Aceitar` and `.Descartar` shape
- Confirm on a custom Atividade what happens if you try to apply it to a day
  in cartão ponto (probably no-op; the standard 7 booleans are the only
  rendered columns)
