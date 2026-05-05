# Secullum — Final live-test findings (2026-05-02 session)

This consolidates ALL CRUD verifications run against the live Secullum tenant
(database `4c8681f2e79a4b7ab58cc94503106736`, empresa `1` —
"S. RODRIGUES & G. RODRIGUES LTDA"). All test records were created and removed
by Claude during this session.

## DELETE convention is **NOT uniform** across resources

| Resource         | Create                 | Update                                          | Delete                                          | Result |
| ---------------- | ---------------------- | ----------------------------------------------- | ----------------------------------------------- | ------ |
| `Departamentos`  | `POST` no Id           | `POST` with Id                                  | `DELETE /Departamentos/{id}` → 200 empty        | full CRUD ✅ |
| `Funcoes`        | `POST` no Id           | `POST` with Id                                  | `DELETE /Funcoes/{id}` → 200 empty              | full CRUD ✅ |
| `Atividades`     | `POST` no Id           | `POST` with Id                                  | `DELETE /Atividades/{id}` → 200 empty           | full CRUD ✅ |
| `Feriados`       | `POST` no Id (returns empty body!) | `POST` with Id (probably) | `DELETE /Feriados/{id}` → 200 empty             | full CRUD ✅ (id from list re-read) |
| **`Justificativas`** | `POST` no Id (returns full row) | `POST` with Id          | **`DELETE /Justificativas` BODY=`[14]`** → 200  | **batch-only DELETE** |
| **`Funcionarios`**   | `POST` no Id (returns `{funcionarioId, exibirMensagemEnvioAutomatico}`) | `POST` with Id (same response) | **No DELETE** — soft-dismiss via `POST` with `Demissao` set; hard delete needs operator password through UI | upsert + soft-dismiss only |

Calls `DELETE /Justificativas/{id}` and `DELETE /Funcionarios/{id}` both
return **HTTP 405** — confirmed twice each.

## Confirmed payload shapes

### POST /Funcoes (full record echoed)
```jsonc
// Request
{ "Descricao": "_TEST_CLAUDE_FUNC" }
// Response 200
{ "Id": 18, "Descricao": "_TEST_CLAUDE_FUNC" }
```

### POST /Atividades (full record echoed)
```jsonc
// Request
{ "Descricao": "_TEST_CLAUDE_ATV", "DescricaoAbreviada": "_TST", "TipoDeAtividade": 1 }
// Response 200
{ "Id": 3, "Descricao": "_TEST_CLAUDE_ATV", "DescricaoAbreviada": "_TST", "TipoDeAtividade": 1 }
```

### POST /Justificativas (huge full record echoed)
```jsonc
// Request — minimal accepted body
{
  "NomeAbreviado": "_TST",
  "NomeCompleto": "_TEST CLAUDE JUST",
  "Ajuste": false,
  "Abono2": false, "Abono3": false, "Abono4": false,
  "Desativado": false
}
// Response 200 — has 30+ extra default-false flags:
{
  "Id": 14, "NomeAbreviado": "_TST", "NomeCompleto": "_TEST CLAUDE JUST",
  "ValorDia": null,
  "Ajuste": false, "Abono2": false, "Abono3": false, "Abono4": false,
  "LancarComoHorasFalta": false, "NaoAbonarHorasNoturnas": false,
  "DescontarHorasBancoDeHoras": false,
  "NaoPermitirFuncionariosUtilizar": false, "ExigirFotoAtestado": false,
  "MarcarAutomaticamenteNaoAlterarHorasEmAjuste": false,
  "DescontarDsr": false, "DescontarDsrIncluirF...":  false,
  // …more flags…
}
```

### DELETE /Justificativas (batch)
```jsonc
// Request body
[14]
// Response 200, empty body
```

### POST /Feriados (NO body echoed!)
```jsonc
// Request
{ "Data": "2026-12-31T00:00:00", "Descricao": "_TEST CLAUDE FERIADO" }
// Response 200, empty body — must re-read GET /Feriados to find new Id
```

### POST /Funcionarios — minimal create
```jsonc
// Request (minimum required)
{
  "Nome": "_TEST CLAUDE FUNC",
  "Cpf": "432.987.512-86",         // valid format, no real person
  "NumeroFolha": "999",
  "NumeroIdentificador": "999",
  "Admissao": "2026-05-02T00:00:00",
  "EmpresaId": 1,
  "HorarioId": 1,                  // PINTURA (any active horario id is fine)
  "FuncaoId": 16,                  // ZELADOR (A)
  "DepartamentoId": 5              // LOGISTICA
}
// Response 200
{ "funcionarioId": 38, "exibirMensagemEnvioAutomatico": false }
```

> ⚠️ Funcionarios POST does **NOT** return the full record — only the new Id.
> Always follow up with `GET /Funcionarios/{funcionarioId}` if you need the
> complete object (e.g., for round-trip dismiss).

### POST /Funcionarios — soft dismiss (NOT a separate endpoint)
The "−" button on `/funcionarios` opens a dialog with two modes:

1. **Preencher data de demissão e tornar os funcionários invisíveis** —
   triggers `POST /Funcionarios` with the full record + `Demissao` set.
   `Invisivel` was observed staying `false` despite the dialog wording. No
   password required.
2. **Excluir funcionários definitivamente** — needs operator password input.
   Endpoint TBD; do NOT automate.

### GET /Funcionarios/{id} — full record (~60 fields, top of list)
```
Id, Nome, NumeroFolha, NumeroIdentificador, NumeroPis,
Carteira, Observacao,
Endereco, Bairro, CidadeId, Uf, Cep,
Telefone, Celular, Email,
Rg, ExpedicaoRg, Ssp,
Cpf, Mae, Pai, Nascimento,
NaoVerificarDigital, Masculino, Master,
Nacionalidade, Naturalidade, EscolaridadeId,
NumeroProvisorio, CodigoHolerite,
Admissao, Demissao,
EmpresaId, HorarioId, DepartamentoId, FuncaoId,
DepartamentoDescricao, FuncaoDescricao,
Filtro1Id, Filtro2Id, MotivoDemissaoId,
Foto (base64 data URL), AlterouFoto, DataUltimoEnvio,
RespostasPerguntasAdicionais (array),
SenhaEquipamento, SenhaApp,
BancoHorasId, Invisivel,
DataAlteracao, PeriodoEncerrado,
NivelPermissaoId, PerfilId, PerfilFuncionarioId,
DataUltimoLogin,
PermiteInclusaoPontoManual, PermiteInclusaoDispositivosAutorizados,
ApelidoDispositivoUltimoLogin, IdentificacaoDispositivoUltimoLogin,
PlataformaUltimoLogin,
DesabilitarAssinaturaEletronica,
EstruturaId,
ConfigEspecificaInclusaoManualPonto,
ConfigEspecificaInclusaoManualPontoFusoHorarioI…
(more device/permission overrides)
```

## Auth headers (verified)

```
Authorization:           Bearer {access_token}      // JWT, ~50 min lifetime
secullumbancoselecionado: 4c8681f2e79a4b7ab58cc94503106736
```

The existing `SecullumService.apiClient` interceptor (line 80) already sets the
header correctly — no patch needed.

localStorage keys used by the SPA (for direct browser-side calls during testing):
- `axpw_acc` — bearer (gets refreshed automatically by SPA on stale)
- `axpw_rfs` — refresh token
- `axpw_dbs` — database id

## Encerramento + Assinatura — NOT live-tested (destructive)

Both buttons trigger month-wide actions on real production data and were
deliberately skipped:

- **POST /EncerramentoCalculos** — locks calculations up to a chosen date.
  Field name is `NovaDataEncerramento`. Capture must be done in a controlled
  window (set the new date to the same as the existing close date so nothing
  changes).
- **POST /AssinaturaDigitalCartaoPonto** (apurar) — recomputes the period for
  every employee. Heavy. Capture during off-hours or with a single-employee
  filter.

## Ankaa code already updated to match

| File | Change |
| --- | --- |
| `apps/api/src/modules/integrations/secullum/secullum-cadastros.service.ts` | Added `deleteJustificativas(ids: number[])` (batch) and `upsertJustificativa(...)`. Existing CRUD methods for Dept/Funcao/Atividade unchanged. |
| `apps/api/src/modules/integrations/secullum/dto/index.ts` | Added 11 interfaces. |
| `apps/api/src/modules/integrations/secullum/user-secullum-sync.service.ts` | Bridge service. Listens to `secullum.user.created` / `.updated` on the global Node EventEmitter. Always syncs `Demissao` from `User.dismissedAt`. |
| `apps/api/src/modules/people/user/user.service.ts` | Added `EventEmitter` injection + emits both events after each transaction commits. |
| `apps/api/src/schemas/user.ts` + `apps/web/src/schemas/user.ts` | Added `secullumSyncEnabled` to user create + update zod schemas. |
| `apps/api/prisma/schema.prisma` + migration | Added `User.secullumEmployeeId`, `User.secullumSyncEnabled`, `Sector.secullumDepartamentoId`, `Position.secullumFuncaoId`. |
| `apps/web/src/components/administration/user/form/secullum-sync-switch.tsx` + `user-form.tsx` | New "Criar / sincronizar no Secullum" toggle wired into the user form. |
| `apps/web/src/api-client/services/secullum-mapping.ts` + `hooks/integrations/use-secullum-mapping.ts` + `pages/integrations/secullum/mapping.tsx` | New mapping admin page (Departamentos ↔ Setores, Funções ↔ Cargos, Funcionários overview). |

## Outstanding (next session)

1. Wire `apps/web/src/pages/integrations/secullum/mapping.tsx` into the router
   (the `useSectors`/`usePositions` placeholders need to point at the real
   hooks once their import paths are verified).
2. Add a "Secullum ID" column to the existing Sector list-page table
   (`apps/web/src/components/administration/sector/list/sector-table.tsx`) and
   the existing Position list-page table.
3. Capture the actual POST payloads for `/EncerramentoCalculos` and
   `/AssinaturaDigitalCartaoPonto` in a controlled window.
4. (Optional) Extend `SecullumFuncionarioFull` interface with the additional
   ~25 device/permission fields shown in §"Full Funcionario field list" once
   the front-end form needs them.
