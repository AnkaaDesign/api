# Secullum API — Captured Endpoints

Captured live via JS interceptor (window.__SECULLUM_CAPTURE__) while navigating
the Secullum Ponto Web SPA logged in as Kennedy/admin. Base URL:
`https://pontoweb.secullum.com.br/`. Auth flow at
`https://autenticador.secullum.com.br/Authorization?response_type=code&client_id=3001&redirect_uri=...`.

## 1. URL inventory (33 unique endpoints, sorted)

```
GET  AssinaturaDigitalCartaoPonto                          → 200, ~10 KB list
GET  Atividades                                            → 200
GET  BancoHoras/                                           → 200, []
GET  BancoHoras/EstaAtivoFuncionario/{id}                  → 200, bool
GET  Batidas/{empId}/{yyyy-mm-dd}/{yyyy-mm-dd}             → 200, full grid
GET  Calculos/{empId}/{yyyy-mm-dd}/{yyyy-mm-dd}            → 200
GET  CentroDeCustos                                        → 200, []
GET  Configuracoes                                         → 200
GET  Configuracoes/TipoEncerramentoCalculo                 → 200
GET  Departamentos                                         → 200
GET  Empresas                                              → 200
GET  EncerramentoCalculos/ExisteFechamentoEspecifico       → 200, bool
GET  EncerramentoCalculos/Listar                           → 200, list
GET  Equipamentos/VerificarEquipamentosCadastrados         → 200
GET  Escolaridade                                          → 200, []
GET  Estruturas                                            → 200, []
GET  Estruturas/ListaIdEDescricao                          → 200, []
GET  Feriados                                              → 200
GET  Funcionarios                                          → 200, employees list
GET  FuncionariosAfastamentos/{empId}                      → 200
GET  FuncionariosDemitidos                                 → 200, dismissed list
GET  Funcoes                                               → 200
GET  Horarios?incluirDesativados={true|false|undefined}    → 200, schedules
GET  Horarios/ListarHorariosAlternativosFuncionario        → 200, []
GET  Justificativas?filtro={0|1}                           → 200, list
GET  MotivosDemissao                                       → 200, []
GET  PassoPasso                                            → 200, onboarding stats
GET  PerguntasAdicionais                                   → 200, []
GET  RestricoesMenus/RestricoesUsuario                     → 200, []
POST Solicitacoes/ListaSolicitacoes/false                  → 200, requests list
```

## 2. Confirmed sample bodies

### GET /Departamentos
```json
[
  {"Id":2,"Descricao":"ADMINISTRATIVO"},
  {"Id":4,"Descricao":"ALMOXARIFADO"},
  {"Id":5,"Descricao":"LOGISTICA"},
  {"Id":3,"Descricao":"PRODUÇÃO"}
]
```

### GET /Funcoes
```json
[
  {"Id":3,"Descricao":"ASSISTENTE ADMINISTRATIVO"},
  {"Id":1,"Descricao":"ASSISTENTE DE LOGÍSTICA"},
  {"Id":17,"Descricao":"DESIGNER GRAFICO"},
  {"Id":7,"Descricao":"LETRISTA JUNIOR I"},
  ... (17 total) ...
  {"Id":15,"Descricao":"LETRISTA TRAINEE"},
  {"Id":16,"Descricao":"ZELADOR (A)"}
]
```

### GET /Atividades
```json
[
  {"Id":2,"Descricao":"Compensado","DescricaoAbreviada":"T. feri","TipoDeAtividade":1},
  {"Id":1,"Descricao":"Fechamento de Ponto","DescricaoAbreviada":"FP","TipoDeAtividade":1}
]
```

### GET /Empresas
```json
[
  {"Id":1,"Nome":"S. RODRIGUES & G. RODRIGUES LTDA","Inscricao":"ISENTO",
   "Documento":"13.636.938/0001-44","TipoDocumento":0}
]
```

### GET /MotivosDemissao
```json
[]
```

### GET /Horarios?incluirDesativados=true
```json
[
  {"Id":1,"Numero":1,"Descricao":"PINTURA","HorarioIdCopiaExtras":null,
   "HorarioIdCopiaOpcoes":null,"HorarioIdCopiaDescanso":null,"Tipo":"Semanal","Desativar":false},
  {"Id":2,"Numero":2,"Descricao":"ADMINISTRATIVO","HorarioIdCopiaExtras":1,
   "HorarioIdCopiaOpcoes":null,"HorarioIdCopiaDescanso":null,"Tipo":"Semanal","Desativar":false},
  {"Id":3,"Numero":3,"Descricao":"ALMOXARIFADO","HorarioIdCopiaExtras":1,...},
  {"Id":4,"Numero":4,"Descricao":"ZELADOR",...},
  {"Id":5,"Numero":5,"Descricao":"ASSISTENTE DE LOGÍSTICA",...}
]
```

### GET /Funcionarios (sample row)
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

### GET /PassoPasso
```json
{"empresas":1,"horarios":5,"funcionarios":33}
```

### GET /Equipamentos/VerificarEquipamentosCadastrados
```json
{"possuiEquipamentoCadastrado":true,"temControlIdClass":false,"equipamentosBiometriaFacial":[]}
```

## 3. Page → endpoints map

| Page                              | Loads                                                                  |
| --------------------------------- | ---------------------------------------------------------------------- |
| #/home                            | PassoPasso, Equipamentos/Verificar                                     |
| #/funcionarios (list)             | Funcionarios, PerguntasAdicionais, Funcoes, Departamentos, Horarios... |
| #/funcionarios-dados/{empresaId}  | Funcionarios, Empresas, Horarios?incluirDesativados, Funcoes, Departamentos, BancoHoras/, BancoHoras/EstaAtivoFuncionario/{id}, CentroDeCustos, Estruturas, Escolaridade, MotivosDemissao, FuncionariosAfastamentos/{id}, Horarios/ListarHorariosAlternativosFuncionario |
| #/departamentos                   | Departamentos                                                          |
| #/funcoes                         | Funcoes                                                                |
| #/atividades                      | Atividades                                                             |
| #/feriados                        | Feriados                                                               |
| #/cartao-ponto                    | Configuracoes, Batidas/{empId}/{from}/{to}                             |
| #/solicitacoes                    | Solicitacoes/ListaSolicitacoes/false (POST)                            |
| #/justificativas                  | Justificativas?filtro=0, Justificativas?filtro=1                       |
| #/calculos                        | Calculos/{empId}/{from}/{to}, Configuracoes                            |
| #/encerramento-calculos           | Configuracoes/TipoEncerramentoCalculo, EncerramentoCalculos/ExisteFechamentoEspecifico, EncerramentoCalculos/Listar |
| #/absenteismo                     | Justificativas, Departamentos, Horarios, Estruturas, Empresas          |
| #/funcionarios-demitidos          | FuncionariosDemitidos, MotivosDemissao                                 |
| #/horarios                        | Horarios?incluirDesativados=true                                       |
| #/assinatura-digital-cartao-ponto | AssinaturaDigitalCartaoPonto                                           |

## 4. NEW endpoints not yet in ankaa-api/secullum.service.ts

The existing service already covers Batidas, Funcionarios (read-only), Calculos,
Feriados (CRUD), Horarios (CRUD), Solicitacoes (list/aceitar/descartar),
Justificativas (read), Configuracoes, sync-user, health.

**Gaps to fill:**

- `GET /Departamentos` — list departments (NEW)
- `POST /Departamentos` — create department (TBD via CRUD test)
- `PUT /Departamentos/{id}` — update (TBD)
- `DELETE /Departamentos/{id}` — delete (TBD)
- `GET /Funcoes` + POST/PUT/DELETE (NEW; same pattern)
- `GET /Atividades` + CRUD (NEW)
- `GET /Empresas` (NEW; needed for FuncionarioCreate)
- `GET /MotivosDemissao` (NEW)
- `GET /Estruturas`, `Estruturas/ListaIdEDescricao` (NEW; org structure)
- `GET /Escolaridade` (NEW; education)
- `GET /CentroDeCustos` (NEW)
- `GET /BancoHoras/`, `BancoHoras/EstaAtivoFuncionario/{id}` (NEW)
- `GET /FuncionariosAfastamentos/{id}` (NEW; absences for an employee)
- `GET /FuncionariosDemitidos` (NEW; dismissed-employees list)
- `POST /Funcionarios` — create employee (TBD via CRUD test)
- `PUT /Funcionarios/{id}` — update employee (TBD)
- `DELETE /Funcionarios/{id}` — dismiss / hard delete (TBD; Demissao flow likely separate)
- `GET /AssinaturaDigitalCartaoPonto` + POST sign / DELETE reject (TBD)
- `GET /EncerramentoCalculos/Listar`, `POST /EncerramentoCalculos` (TBD; fechamento)
- `POST /EncerramentoCalculos/Encerrar` or similar (TBD)
- `GET /Configuracoes/TipoEncerramentoCalculo` (NEW)
- `POST /Justificativas` + PUT/DELETE (NEW; CRUD)
- `GET /PerguntasAdicionais`, `RestricoesMenus/RestricoesUsuario` (low-priority)
- `GET /Equipamentos/VerificarEquipamentosCadastrados` (low-priority)

**To be confirmed via test CRUD on `TEST_DEPT_DELETE_ME`, `TEST_FUNC_DELETE_ME`,
and TEST employee created+dismissed in Andressa's company.**
