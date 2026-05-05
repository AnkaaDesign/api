# Secullum Ponto Web — Reverse-Engineered API Spec

Captured live from `https://pontoweb.secullum.com.br/` while logged in as the
Ankaa admin (kennedy.ankaa@gmail.com). The SPA's `apiClient` (axios) sends all
requests against the same origin and uses **the OAuth bearer token** issued by
`https://autenticador.secullum.com.br/Token` in the `Authorization` header
(plus a `secullumdatabaseid` header on every call).

> ⚠️ The existing `apps/api/src/modules/integrations/secullum/secullum.service.ts`
> already implements ~12 of the endpoints below. This spec is the union: existing
> + NEW (with status). Everything in **bold "NEW"** is missing in our service.

---

## 1. Authentication

### Login (browser SSO flow — OAuth Authorization Code)

```
GET https://autenticador.secullum.com.br/Authorization
    ?response_type=code
    &client_id=3001          # Ponto Web client (different from API integration client_id=3)
    &redirect_uri=https%3A%2F%2Fpontoweb.secullum.com.br%2FAuth
```

After credential entry the autenticador redirects to `…/Auth?code=…`, the SPA
exchanges that code for a bearer token via `https://autenticador.secullum.com.br/Token`.

### API token flow (server-to-server, what our service uses)

```
POST https://autenticador.secullum.com.br/Token
Content-Type: application/x-www-form-urlencoded

grant_type=password
&username={SECULLUM_EMAIL}
&password={SECULLUM_PASSWORD}
&client_id=3                 # API client
&client_secret={SECULLUM_CLIENT_SECRET}   # may be empty
```

Refresh:

```
POST https://autenticador.secullum.com.br/Token
grant_type=refresh_token
&refresh_token={...}
&client_id=3
```

Persist `access_token`, `refresh_token`, `expires_in`, `expires_at` (we use
`SecullumToken` Prisma model with `identifier="default"`).

### Required headers on every request to `pontoweb.secullum.com.br`

```
Authorization: Bearer {access_token}
secullumdatabaseid: 4c8681f2e79a4b7ab58cc94503106736
Content-Type: application/json
Accept: application/json
```

---

## 2. URL inventory (33 unique endpoints captured)

### 2.1 Cadastros (master-data CRUD)

| Method | Endpoint | Status | Notes |
|---|---|---|---|
| GET    | `/Empresas`                   | NEW   | List companies (single tenant returns one) |
| GET    | `/Departamentos`              | NEW   | List departments — `[{Id, Descricao}]` |
| GET    | `/Departamentos/{id}`         | NEW   | One — `{Id, Descricao, Nfolha}` |
| POST   | `/Departamentos`              | NEW   | **Create + Update**: payload `{Descricao, Nfolha?}` (no Id = create, with Id = update). Returns full row. |
| DELETE | `/Departamentos/{id}`         | NEW   | Returns 200 with empty body |
| GET    | `/Funcoes`                    | NEW   | `[{Id, Descricao}]` (17 rows) |
| GET    | `/Funcoes/{id}` POST DELETE   | NEW   | Same upsert pattern as Departamentos (assumed; not yet retested) |
| GET    | `/Atividades`                 | NEW   | `[{Id, Descricao, DescricaoAbreviada, TipoDeAtividade}]` |
| POST/DELETE `/Atividades(/{id})` | NEW | Same upsert pattern |
| GET    | `/Estruturas`                 | NEW   | Org structure tree (empty in this tenant) |
| GET    | `/Estruturas/ListaIdEDescricao` | NEW | Flat list helper |
| GET    | `/CentroDeCustos`             | NEW   | Cost centers (empty here) |
| GET    | `/Escolaridade`               | NEW   | Education levels (enum-like; empty) |
| GET    | `/MotivosDemissao`            | NEW   | Dismissal reasons (empty in this tenant — important: tenant-defined) |
| GET    | `/PerguntasAdicionais`        | low   | Custom-question definitions for funcionario form |
| GET    | `/RestricoesMenus/RestricoesUsuario` | low | Per-user menu restrictions |
| GET    | `/Equipamentos/VerificarEquipamentosCadastrados` | low | `{possuiEquipamentoCadastrado, temControlIdClass, equipamentosBiometriaFacial}` |
| GET    | `/PassoPasso`                 | low   | Onboarding stats `{empresas, horarios, funcionarios}` |

### 2.2 Funcionarios (employees)

| Method | Endpoint | Status |
|---|---|---|
| GET    | `/Funcionarios` | EXISTING — list (lean shape, see §3.2) |
| GET    | `/Funcionarios/{id}` | NEW — full record with Foto (base64), endereço, contatos, dados pessoais |
| POST   | `/Funcionarios` | NEW — create (assumed upsert pattern) |
| POST   | `/Funcionarios` (with Id) | NEW — update |
| DELETE | `/Funcionarios/{id}` | NEW — delete (only when no batidas) |
| GET    | `/FuncionariosDemitidos` | NEW — dismissed list |
| GET    | `/FuncionariosAfastamentos/{id}` | NEW — leave/absence records |
| GET    | `/Horarios/ListarHorariosAlternativosFuncionario` | NEW |

### 2.3 Movimentações (time entries)

| Method | Endpoint | Status |
|---|---|---|
| GET    | `/Batidas/{empId}/{from}/{to}`           | EXISTING |
| GET    | `/Batidas/FotoBatida/{empId}/{fonteDadosId}` | EXISTING |
| POST   | `/Batidas?origem=cartao+ponto`           | EXISTING (Update) |
| GET    | `/CartaoPonto`                           | EXISTING |
| GET    | `/Calculos/{empId}/{from}/{to}`          | EXISTING |
| POST   | `/Solicitacoes/ListaSolicitacoes/{pendingOnly}` | EXISTING |
| POST   | `/Solicitacoes/Aceitar`                  | EXISTING |
| POST   | `/Solicitacoes/Descartar`                | EXISTING |
| GET    | `/Solicitacoes/FotoAtestado/{id}`        | EXISTING |

### 2.4 Configurações

| Method | Endpoint | Status |
|---|---|---|
| GET    | `/Configuracoes`                              | EXISTING |
| GET    | `/Configuracoes/TipoEncerramentoCalculo`      | NEW |
| GET    | `/EncerramentoCalculos/Listar`                | NEW |
| GET    | `/EncerramentoCalculos/ExisteFechamentoEspecifico` | NEW |
| POST   | `/EncerramentoCalculos` (Encerrar)            | NEW (TBD body) |
| GET    | `/AssinaturaDigitalCartaoPonto`               | NEW |
| POST   | `/AssinaturaDigitalCartaoPonto` (apurar)      | NEW (TBD) |
| DELETE | `/AssinaturaDigitalCartaoPonto/{id}`          | NEW (TBD) |
| GET    | `/Justificativas?filtro={0|1}`                | EXISTING (read) |
| POST/PUT/DELETE `/Justificativas`             | NEW |
| GET    | `/Feriados`                                   | EXISTING |
| POST/DELETE `/Feriados`                       | EXISTING |
| GET    | `/Horarios?incluirDesativados=true`           | EXISTING (list) |
| GET    | `/Horarios/{id}`                              | EXISTING |
| POST/PUT/DELETE `/Horarios`                   | EXISTING |
| GET    | `/BancoHoras/`                                | NEW |
| GET    | `/BancoHoras/EstaAtivoFuncionario/{id}`       | NEW |

---

## 3. Confirmed payloads

### 3.1 GET /Departamentos
```json
[
  {"Id":2,"Descricao":"ADMINISTRATIVO"},
  {"Id":4,"Descricao":"ALMOXARIFADO"},
  {"Id":5,"Descricao":"LOGISTICA"},
  {"Id":3,"Descricao":"PRODUÇÃO"}
]
```

### 3.2 POST /Departamentos (CREATE) — confirmed via test
Request:
```json
{"Descricao":"_TEST_CLAUDE_DELETE"}
```
Response 200:
```json
{"Id":6,"Descricao":"_TEST_CLAUDE_DELETE","Nfolha":null}
```

### 3.3 POST /Departamentos (UPDATE — same endpoint, with Id) — confirmed
Request:
```json
{"Id":6,"Descricao":"_TEST_CLAUDE_DELETE","Nfolha":"999"}
```
Response 200: same shape.

### 3.4 DELETE /Departamentos/{id} — confirmed
Returns 200 with empty body.

### 3.5 GET /Funcoes (same shape applies for upsert)
```json
[
  {"Id":3,"Descricao":"ASSISTENTE ADMINISTRATIVO"},
  {"Id":1,"Descricao":"ASSISTENTE DE LOGÍSTICA"},
  {"Id":17,"Descricao":"DESIGNER GRAFICO"},
  {"Id":7,"Descricao":"LETRISTA JUNIOR I"},
  ... 17 total ...
  {"Id":16,"Descricao":"ZELADOR (A)"}
]
```

### 3.6 GET /Atividades
```json
[
  {"Id":2,"Descricao":"Compensado","DescricaoAbreviada":"T. feri","TipoDeAtividade":1},
  {"Id":1,"Descricao":"Fechamento de Ponto","DescricaoAbreviada":"FP","TipoDeAtividade":1}
]
```

### 3.7 GET /Empresas
```json
[
  {"Id":1,"Nome":"S. RODRIGUES & G. RODRIGUES LTDA","Inscricao":"ISENTO",
   "Documento":"13.636.938/0001-44","TipoDocumento":0}
]
```

### 3.8 GET /Horarios?incluirDesativados=true
```json
[
  {"Id":1,"Numero":1,"Descricao":"PINTURA","HorarioIdCopiaExtras":null,
   "HorarioIdCopiaOpcoes":null,"HorarioIdCopiaDescanso":null,"Tipo":"Semanal","Desativar":false},
  {"Id":2,"Numero":2,"Descricao":"ADMINISTRATIVO","HorarioIdCopiaExtras":1,...},
  ...
]
```

### 3.9 GET /Funcionarios (lean — list view)
```json
{
  "Id":31,
  "Nome":"ALESSANDRO JUNIOR SOUZA DE ALMEIDA",
  "NumeroFolha":"57",
  "NumeroIdentificador":"57",
  "NumeroPis":"",
  "Cpf":"144.931.099-04",
  "DepartamentoDescricao":"PRODUÇÃO",
  "EmpresaId":1,
  "DepartamentoId":3,
  "FuncaoId":15,
  "HorarioId":1,
  "EstruturaId":null,
  "Filtro1Id":null,
  "Filtro2Id":null,
  "Invisivel":false,
  "SenhaEquipamento":null,
  "ListaCentroDeCustos":[],
  "BancoHorasId":null,
  "DesabilitarAssinaturaEletronica":false
}
```

### 3.10 GET /Funcionarios/{id} (full — Andressa, Id=1)
```json
{
  "Id":1,
  "Nome":"ANDRESSA RODRIGUES",
  "NumeroFolha":"15",
  "NumeroIdentificador":"15",
  "NumeroPis":"20615171871",
  "Carteira":"",
  "Observacao":"...",
  "Endereco":"Antônio Burim 87",
  "Bairro":"Beltrão Park Residence",
  "CidadeId":1,
  "Uf":"PR",
  "Cep":"86204-306",
  "Telefone":"43984538903",
  "Celular":"43984538903",
  "Email":"andressa.amoriello@gmail.com",
  "Rg":"95148316",
  "ExpedicaoRg":null,
  "Ssp":null,
  "Cpf":"057.374.839-08",
  "Mae":null, "Pai":null,
  "Nascimento":"1986-10-28T00:00:00",
  "NaoVerificarDigital":false,
  "Masculino":false,
  "Master":false,
  "Nacionalidade":null, "Naturalidade":null,
  "EscolaridadeId":null,
  "NumeroProvisorio":null,
  "CodigoHolerite":"15",
  "Admissao":"2020-08-24T00:00:00",
  "Demissao":null,
  "EmpresaId":1,
  "HorarioId":2,
  "DepartamentoId":2,
  "DepartamentoDescricao":"ADMINISTRATIVO",
  "FuncaoId":3,
  "FuncaoDescricao":"ASSISTENTE ADMINISTRATIVO",
  "Filtro1Id":null,
  "Filtro2Id":null,
  "MotivoDemissaoId":null,
  "Foto":"data:image/jpeg;base64,/9j/4AAQ..."
  // …more fields after Foto: NaoVerificarDigital, dados adicionais (DADOS ADICIONAIS tab),
  //    Biometrias, Equipamentos, Afastamentos arrays
}
```

### 3.11 POST /Funcionarios (CREATE) — pattern (NOT YET tested due to seat limit 22/30)
Likely follows the upsert pattern: send full object without `Id`, get back with Id. To validate this we should create one test employee in Andressa's company then immediately dismiss & delete.

### 3.12 GET /Feriados
```json
[
  {"Id":24,"Data":"2026-01-01T00:00:00","Descricao":"Conf. Universal"},
  {"Id":27,"Data":"2026-02-16T00:00:00","Descricao":"Compensado"},
  {"Id":16,"Data":"2026-02-17T00:00:00","Descricao":"CARNAVAL"},
  ...
]
```

### 3.13 POST /Solicitacoes/ListaSolicitacoes/{pendingOnly}
Request:
```json
{
  "DataInicio": null,
  "DataFim": null,
  "FuncionariosIds": [],
  "EmpresaId": 0,
  "DepartamentoId": 0,
  "FuncaoId": 0,
  "EstruturaId": 0,
  "Tipo": null,
  "Ordem": 0,
  "Decrescente": true,
  "Quantidade": 100
}
```

### 3.14 GET /AssinaturaDigitalCartaoPonto
```json
[
  {"NumeroCartoes":20, "Aprovados":16, "Rejeitados":4,
   "Id":44, "Descricao":"Apuração Abril/2026", "Compactada":false,
   "DataInicio":"2026-...", "DataFim":"2026-..."},
  ...
]
```

### 3.15 GET /PassoPasso
```json
{"empresas":1,"horarios":5,"funcionarios":33}
```

### 3.16 GET /Equipamentos/VerificarEquipamentosCadastrados
```json
{"possuiEquipamentoCadastrado":true,"temControlIdClass":false,"equipamentosBiometriaFacial":[]}
```

---

## 4. Conventions observed

- **Upsert via POST**: `/Departamentos`, `/Funcoes`, `/Atividades`, `/Horarios`,
  `/Feriados`, `/Funcionarios` accept POST for both create (no `Id`) and update
  (with `Id`). There is no `PUT` for these resources.
- **Hard DELETE** by id: `DELETE /{Resource}/{id}`, returns 200 + empty body.
- **Data format**: dates are ISO 8601 with `T00:00:00` (no timezone suffix).
  CPF/CNPJ stay formatted with dots/dashes.
- **Multi-tenant**: every call carries `secullumdatabaseid`. Our tenant id is
  `4c8681f2e79a4b7ab58cc94503106736`.
- **Pagination**: list endpoints currently return everything (small tenant).
  `Solicitacoes/ListaSolicitacoes` accepts `Quantidade`.
- **Soft state**: Funcionario has `Demissao`, `MotivoDemissaoId` — dismissed
  funcionarios still exist (visible in `/FuncionariosDemitidos`); they are not
  removed.

---

## 5. Andressa Rodrigues — duplicate record finding

ANDRESSA RODRIGUES appears in two records:

- **Active**: `Id=1`, `NumeroFolha=15`, `NumeroIdentificador=15`,
  CPF `057.374.839-08` — current, ADMINISTRATIVO/ASSISTENTE ADMINISTRATIVO
- **Dismissed list**: `NumeroFolha=1`, `Departamento=ADMINISTRATIVO` — old record

The active one is the test target.
