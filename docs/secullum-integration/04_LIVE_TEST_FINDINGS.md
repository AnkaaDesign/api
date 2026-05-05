# Secullum Funcionarios — Live test findings (2026-05-02)

Created `_TEST CLAUDE FUNC` (CPF `432.987.512-86`, Folha 999) directly via the
Secullum REST API while logged in as Ankaa admin, then dismissed and removed.
Below is the **ground-truth payload shape and protocol** observed.

## A. Auth headers (browser SPA)

```
Authorization: Bearer {access_token}
secullumbancoselecionado: 4c8681f2e79a4b7ab58cc94503106736
```

> ⚠️ Header name is **`secullumbancoselecionado`**, NOT `secullumdatabaseid`.
> Update the existing `SecullumService` axios interceptor accordingly.
> localStorage keys used by the SPA: `axpw_acc` (access), `axpw_rfs` (refresh),
> `axpw_dbs` (database id).

## B. POST /Funcionarios — CREATE confirmed

Minimal body that succeeded:

```json
{
  "Nome": "_TEST CLAUDE FUNC",
  "NumeroFolha": "999",
  "NumeroIdentificador": "999",
  "Cpf": "432.987.512-86",
  "NumeroPis": "",
  "Email": "claude.test@example.com",
  "Admissao": "2026-05-02T00:00:00",
  "EmpresaId": 1,
  "HorarioId": 1,
  "FuncaoId": 16,
  "DepartamentoId": 5
}
```

Response 200:
```json
{"funcionarioId": 38, "exibirMensagemEnvioAutomatico": false}
```

> Note: response is **NOT** the full record (unlike Departamentos). Only
> `{funcionarioId, exibirMensagemEnvioAutomatico}`. To get the full record do a
> follow-up `GET /Funcionarios/{funcionarioId}`.

## C. POST /Funcionarios — UPDATE / DISMISS confirmed

Same endpoint, full body with `Id` set (or any subset of fields you want
preserved — the SPA always re-sends the full record). To dismiss, just set
`Demissao` (and optionally `MotivoDemissaoId`):

Request (excerpt — full body has 60+ fields, all carried over from GET):
```jsonc
{
  "Id": 38,
  "Nome": "_TEST CLAUDE FUNC",
  ...all GET fields...,
  "Demissao": "2026-05-02T00:00:00",
  "MotivoDemissaoId": null,
  "Invisivel": false      // SPA leaves this false even when dismissing!
}
```

Response 200: `{"funcionarioId":38,"exibirMensagemEnvioAutomatico":false}`

After this call, the funcionário disappears from `/Funcionarios` (active list)
but **was not yet visible in `/FuncionariosDemitidos`** in our test (likely a
caching/index lag, or requires the same-day Demissao to be in the past).

## D. DELETE /Funcionarios/{id}

Returns **HTTP 405** Method Not Allowed.

The SPA's "−" button on `/funcionarios` opens a confirmation dialog with two
modes:

1. **"Preencher data de demissão e tornar os funcionários invisíveis"** (default)
   → fires `POST /Funcionarios` with `Demissao` set (mode used in our test).
   This is **soft dismiss**. No password required.
2. **"Excluir funcionários definitivamente"** → REQUIRES the operator's
   password (input field `Senha usuário`). Endpoint TBD; we did not run this
   path because we'd have to enter a password (the user's, not ours).

For the integration we should **always use the soft-dismiss path** — record
preservation is required for batidas/cálculos.

## E. Full Funcionario field list (60+ keys, observed via GET /Funcionarios/38)

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
EmpresaId, HorarioId,
DepartamentoId, DepartamentoDescricao,
FuncaoId, FuncaoDescricao,
Filtro1Id, Filtro2Id,
MotivoDemissaoId,
Foto, AlterouFoto, DataUltimoEnvio,
RespostasPerguntasAdicionais,
SenhaEquipamento, SenhaApp,
BancoHorasId, Invisivel,
DataAlteracao, PeriodoEncerrado,
NivelPermissaoId, PerfilId, PerfilFuncionarioId,
DataUltimoLogin,
PermiteInclusaoPontoManual,
PermiteInclusaoDispositivosAutorizados,
ApelidoDispositivoUltimoLogin, IdentificacaoDispositivoUltimoLogin,
PlataformaUltimoLogin,
DesabilitarAssinaturaEletronica,
EstruturaId,
ConfigEspecificaInclusaoManualPonto,
ConfigEspecificaInclusaoManualPontoFusoHorarioI...
(truncated at ~3KB; remaining keys are device/permission overrides)
```

Update `SecullumFuncionarioFull` interface to include all of the above; the
existing one only has the most common 30.

## F. What this means for our service

1. `SecullumCadastrosService.createFuncionario` already sends the right shape
   (no Id, returns `{funcionarioId}`). We need to:
   - Change return type from `SecullumFuncionarioFull` to
     `{ funcionarioId: number; exibirMensagemEnvioAutomatico: boolean }`.
   - When the caller needs the full record, do a follow-up `getFuncionarioFull`.
2. `dismissFuncionario` (already implemented as GET-then-POST-with-Demissao) is
   exactly the right protocol. ✅
3. Never call `deleteFuncionario` from automation (returns 405 anyway). Mark it
   as `@deprecated` or remove.
4. Update `SecullumService.apiClient` interceptor to use the
   `secullumbancoselecionado` header name (not `secullumdatabaseid`).

## G. UI delete dialog parameters

When the "Excluir definitivamente" branch is selected, the SPA enables a
password input. Hard-delete is therefore an interactive admin action — keep it
out of automation.
