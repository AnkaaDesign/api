# Secullum — Final live captures (2026-05-04, post-login session)

All captures done with Andressa Rodrigues (Funcionario.Id=1) and read-only
GETs. Andressa was edited (`Observacao` swapped twice) and **fully restored**
to her original state — verified by re-reading after revert.

## A. Funcionario edit POST — full 76-key payload (Andressa, Id=1)

The SPA always sends the **full record** even for a one-field edit. Captured
keys (all 76):

```
Id, Nome, NumeroFolha, NumeroIdentificador, NumeroPis, Carteira, Observacao,
Endereco, Bairro, CidadeId, Uf, Cep, Telefone, Celular, Email, Rg,
ExpedicaoRg, Ssp, Cpf, Mae, Pai, Nascimento, NaoVerificarDigital, Masculino,
Master, Nacionalidade, Naturalidade, EscolaridadeId, NumeroProvisorio,
CodigoHolerite, Admissao, Demissao, EmpresaId, HorarioId, DepartamentoId,
DepartamentoDescricao, FuncaoId, FuncaoDescricao, Filtro1Id, Filtro2Id,
MotivoDemissaoId, Foto, AlterouFoto, DataUltimoEnvio,
RespostasPerguntasAdicionais, SenhaEquipamento, SenhaApp, BancoHorasId,
Invisivel, DataAlteracao, PeriodoEncerrado, NivelPermissaoId, PerfilId,
PerfilFuncionarioId, DataUltimoLogin, PermiteInclusaoPontoManual,
PermiteInclusaoDispositivosAutorizados, ApelidoDispositivoUltimoLogin,
IdentificacaoDispositivoUltimoLogin, PlataformaUltimoLogin,
DesabilitarAssinaturaEletronica, EstruturaId,
ConfigEspecificaInclusaoManualPonto,
ConfigEspecificaInclusaoManualPontoFusoHorarioId,
ConfigEspecificaInclusaoManualPontoOrigem,
ConfigEspecificaDesativarVerificacaoLocalFicticio,
ConfigEspecificaInclusaoPontoSemLocalizacao,
ConfigEspecificaInclusaoPontoOffline, TokenDispositivo,
HorarioAlternativo2Id, HorarioAlternativo3Id, HorarioAlternativo4Id,
PossuiFoto, DesconsiderarPerimetrosGlobais, ListaCentroDeCustos,
BloquearRegistroPontoTeclado
```

**Implication for our bridge** — `UserSecullumSyncService.onUserUpdated` does
`{...current, ...overrides}` after a `getFuncionarioFull(id)`, so it preserves
all 76 keys including device/permission ones we never touch. ✅ no
behavioural change needed.

Response shape (same as create): `{"funcionarioId": 1, "exibirMensagemEnvioAutomatico": false}`.

## B. Encerramento de Cálculos

### GET /Configuracoes/TipoEncerramentoCalculo
```
"0"
```
Just a string `"0"` (auto) or `"1"` (manual). Drives the radio in the form.

### GET /EncerramentoCalculos/Listar — historical closes (read-only audit log)
```jsonc
[
  { "Id": 15, "UsuarioNome": "(SYSTEM)", "DataHora": "02/05/2026 00:03:34",
    "Encerramento": "28/02/2026", "DataEncerramento": "2026-02-28T00:00:00" },
  { "Id": 14, "UsuarioNome": "(SYSTEM)", "DataHora": "04/04/2026 00:03:34",
    "Encerramento": "28/01/2026", "DataEncerramento": "2026-01-28T00:00:00" },
  ...
]
```
Fields: `Id`, `UsuarioNome` (who triggered the close — `"(SYSTEM)"` for the
auto monthly job, otherwise the operator name), `DataHora` (when the close
ran), `Encerramento` (display date dd/mm/yyyy), `DataEncerramento` (ISO).

### GET /EncerramentoCalculos/ExisteFechamentoEspecifico
```
false
```

### POST /EncerramentoCalculos — NOT live-tested (destructive)
The "Encerrar" button likely sends `{ NovaDataEncerramento: "yyyy-mm-ddT00:00:00" }`.
We did not POST because re-closing a date that's already closed could create
a duplicate entry in the audit log even if the calculations are unaffected.
Capture this in a controlled window by clicking the button manually with the
interceptor running.

## C. Assinatura Digital Cartão Ponto

### GET /AssinaturaDigitalCartaoPonto — list of "Apurações"
44 records. Sample:
```jsonc
{
  "NumeroCartoes": 20,
  "Aprovados": 16,
  "Rejeitados": 4,
  "Id": 44,
  "Descricao": "Apuração Abril/2026",
  "Compactada": false,
  "DataInicio": "2026-03-26T00:00:00",
  "DataFim":    "2026-04-25T00:00:00",
  "DataInclusao": "0001-01-01T00:00:00"
}
```

### GET /AssinaturaDigitalCartaoPonto/{id} — detail with per-employee status
```jsonc
{
  "ListaItensAssinatura": [
    { "Id": 314, "FuncionarioId": 31,
      "Funcionario": "ALESSANDRO JUNIOR SOUZA DE ALMEIDA",
      "Status": 1, "DataResposta": "2026-04-27T10:42:50.7365411",
      "Resposta": null, "RespostasGerentes": [] },
    { "Id": 315, "FuncionarioId": 35,
      "Funcionario": "ALEX JUNIOR DA SILVA",
      "Status": 1, "DataResposta": "2026-04-27T14:14:52.8187802",
      "Resposta": null, "RespostasGerentes": [] },
    ...
  ]
}
```
Fields per item:
- `Id` — internal apuração-item id (different from `FuncionarioId`)
- `FuncionarioId` + `Funcionario` (name) — employee
- `Status` — observed `1`. Likely enum: `0` pending, `1` approved, `2`
  rejected. Confirm by reading an item known to be rejected.
- `DataResposta` — when the employee responded
- `Resposta` — free-text justification when rejecting (null when approved)
- `RespostasGerentes` — array of manager comments

### POST /AssinaturaDigitalCartaoPonto — NOT tested (destructive)
The "+" button creates an "Apuração" for a period — recomputes for every
employee, very heavy. Likely body: `{ DataInicio, DataFim, EmpresaId,
DepartamentoId?, FuncionarioId? }`. Capture in a controlled window with a
single-employee filter.

## D. Bridge code is consistent with all observations

`UserSecullumSyncService` continues to be correct:

- `onUserCreated` sends the 14 minimum fields needed; Secullum fills the
  other 62 with defaults (we observed this on `_TEST CLAUDE FUNC`: it came
  back with `Carteira: null`, `Observacao: null`, `RespostasPerguntasAdicionais: []`
  — all the configEspecifica/permission flags default false).
- `onUserUpdated` does a GET-then-merge so all 76 keys round-trip cleanly.
- Idempotency: re-sending the same payload produces the same `funcionarioId`
  response with no side-effects (verified by Andressa modify→revert→verify).

## E. Outstanding (still in `06_FINAL_LIVE_FINDINGS.md` §Outstanding)

1. `POST /EncerramentoCalculos` — body confirmation
2. `POST /AssinaturaDigitalCartaoPonto` — body for "criar apuração"
3. `POST /AssinaturaDigitalCartaoPonto/Aprovar` and `.../Rejeitar` (or
   whatever the actual endpoint names are — likely follow the
   `/Solicitacoes/Aceitar` / `/Solicitacoes/Descartar` pattern)
4. Funcionario hard-delete endpoint (needs operator password — out of scope
   for automation)

None block production usage of the integration; all are admin-only
month-end actions that should stay manual until an explicit need arises.
