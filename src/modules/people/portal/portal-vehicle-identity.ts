// api/src/modules/people/portal/portal-vehicle-identity.ts
//
// ⛔ A REGRA MAIS CARA DESTE PACOTE — quando escrever a identidade do veículo
//    DESTRÓI uma coleta de assinaturas que o cliente não tem como refazer.
//
// ─────────────────────────────────────────────────────────────────────────────
// O QUE O DOCUMENTO ASSINADO FAZ COM PLACA, CHASSI, SÉRIE E PEDIDO
// ─────────────────────────────────────────────────────────────────────────────
// O orçamento é renderizado em HTML, medido e CONGELADO em PDF no envio para
// assinatura. Os quatro campos de identificação do veículo aparecem na folha,
// e o construtor do documento escolhe entre duas formas
// (`quote-html.builder.ts:556-577`):
//
//   · campo PREENCHIDO na emissão → `vehicleValueHtml(valor)`: o valor vai
//     IMPRESSO no PDF, byte a byte, e o hash desses bytes é o que liga a trilha
//     de OTP àquele documento. Não há como reescrever a frase: reflui o
//     parágrafo e desloca as âncoras dos selos, que são coordenadas absolutas.
//
//   · campo VAZIO na emissão → `lateSlotHtml(campo, taskId)`: uma LACUNA
//     visível ("a registrar"), com a largura do maior valor possível reservada.
//     O dado é CARIMBADO nela quando chega (`stampLateValues`), pela mesma
//     mecânica do selo de assinatura. Quem assinou viu a lacuna em branco e não
//     estranha que apareça um valor nela depois — é o mesmo contrato visual de
//     uma linha de assinatura ainda não assinada.
//
// Daí a assimetria que este arquivo implementa, e que NÃO é simétrica por acaso:
//
//   PREENCHER O QUE ESTAVA EM BRANCO  → legítimo. É literalmente o caso de uso
//   para o qual a lacuna foi reservada (implemento 0 km é orçado e assinado sem
//   emplacar; a placa chega semanas depois), e `tolerateLateRegistration`
//   (`quote-snapshot.service.ts:792`) existe só para que isso NÃO derrube nada.
//
//   TROCAR UM VALOR QUE JÁ ESTAVA LÁ  → alteração MATERIAL. A folha que as
//   pessoas leram e assinaram diz `ABC1D23`; o cadastro passaria a dizer outra
//   coisa. `matchesFrozenTerms` não tolera (`hadPlate ? v.plate : was.plate` —
//   havendo placa congelada, ela TEM de bater), e `onQuoteContentChanged`
//   invalida o envelope: todo signatário vira `VOIDED`, as assinaturas já
//   colhidas são jogadas fora e a coleta tem de ser reemitida.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE O PORTAL RECUSA EM VEZ DE DEIXAR INVALIDAR
// ─────────────────────────────────────────────────────────────────────────────
// Do lado de DENTRO, invalidar é a resposta certa: quem trocou o preço sabe o
// que fez, tem a tela do envelope na frente e pode reemitir num clique.
//
// Do lado do CLIENTE não é. O contato do portal não emite envelope, não vê a
// tela da cerimônia e não tem como reconvocar as outras três pessoas que já
// assinaram. Um gestor de frota corrigindo um dígito da placa apagaria, sem
// nenhum aviso que ele pudesse entender, um trabalho de dias — e descobriria
// pelo comercial, depois.
//
// Então a rota RECUSA (409) e NOMEIA quem procurar. É a diferença entre uma
// porta trancada e um alçapão.
//
// ⚠️ E a recusa é só ENQUANTO houver coleta viva ou selada. Sem envelope
// `RUNNING`/`COMPLETED` no orçamento não há documento a contradizer, e trocar
// uma placa digitada errada é exatamente o que esta rota existe para permitir.
//
// ─────────────────────────────────────────────────────────────────────────────
// A ASSIMETRIA DO Nº DO PEDIDO — decisão registrada, não descuido
// ─────────────────────────────────────────────────────────────────────────────
// Os quatro campos são tratados igual AQUI, e três deles têm um motivo a mais:
// `plate` está no recorte MATERIAL (`materialProjection` emite
// `vehicles[].plate`) e `chassisNumber` esteve até a v3 — trocá-los invalida de
// verdade. `serialNumber` e `orderNumber` NÃO estão no recorte material: mudá-los
// não derruba assinatura nenhuma.
//
// Ainda assim os quatro são recusados, porque a pergunta desta guarda não é só
// "isto invalida?" — é "o documento que as pessoas assinaram passaria a mentir?".
// Os quatro são IMPRESSOS na tabela de identificação do veículo, e um cadastro
// que diverge da folha assinada é o mesmo defeito do orçamento nº 973 (layout
// trocado depois do selo): o dado existia na memória de quem olhava a tela e em
// lugar nenhum do artefato.
//
// ✅ E A LACUNA QUE ESTE PARÁGRAFO DENUNCIAVA FOI FECHADA (20/09/2026):
// `POST /cliente/me/pedidos` escreve o MESMO `customerOrderNumber` e passou
// MESES sem esta guarda — um contato com `WRITE_PURCHASE_ORDER` trocava por lá,
// com 201 na cara, um número que o documento assinado imprime. Hoje os dois
// caminhos chamam `assertIdentidadeNaoContradizDocumento`
// (`portal-frozen-document.ts`), que é esta regra aplicada contra o banco.
//
// ⚠️ E É UMA FUNÇÃO SÓ DE PROPÓSITO. Duas cópias divergem no primeiro conserto,
// e a que ficar para trás é a que um cliente encontra. `tests/portal-
// identificacao.test.ts` prova a igualdade dos veredictos com um `prisma` de
// mentira, exercitando os dois caminhos com a MESMA entrada.
//
// ─────────────────────────────────────────────────────────────────────────────
// MÓDULO PURO, DE PROPÓSITO
// ─────────────────────────────────────────────────────────────────────────────
// Nenhum import do Nest, do Prisma ou de serviço. A regra acima é a coisa mais
// cara de errar neste pacote e tem de ser testável sem banco e sem container —
// `tests/portal-identificacao.test.ts` a exercita direto, nos dois ramos.
// `snapshotVehicles` é a ÚNICA porta de entrada para os veículos de um snapshot
// (ela responde pelas formas v1/v2 `task`+`implement` e pela v3+ `vehicles`), e
// reusá-la é o que impede este arquivo de ficar cego para coleta antiga.

import { snapshotVehicles } from '@modules/common/signature/services/quote-diff';
import type {
  QuoteSnapshot,
  QuoteSnapshotVehicle,
} from '@modules/common/signature/services/quote-snapshot.service';
import { IMPLEMENT_FACE_LABELS, type ImplementFace } from '../../../constants/implement-faces';

/**
 * Os quatro campos que o documento imprime e que este pacote escreve.
 *
 * ⚠️ `chassisNumber` aqui, `chassis` na chave da lacuna. Os dois nomes existem:
 * a coluna é `Implement.chassisNumber`, e `LateSlotKey`/`LATE_SLOT_LABELS` usam
 * `chassis`. Este arquivo fala a língua da COLUNA, porque é ela que o corpo da
 * requisição carrega; a tradução, quando precisar, é de quem lê lacuna.
 */
export const VEHICLE_IDENTITY_FIELDS = [
  'serialNumber',
  'plate',
  'chassisNumber',
  'orderNumber',
  // ── CATEGORIA E IMPLEMENTO ENTRAM AQUI, e não numa rota à parte ──────────
  //
  // Eles são do CLIENTE tanto quanto a placa: quem sabe se o implemento é um
  // implement ou um bitrem, e se o baú é frigorífico ou sider, é quem opera a
  // frota — a Ankaa só repete o que lhe disseram. Até aqui o portal os MOSTRAVA
  // e não deixava corrigir, o que é a pior das combinações: o erro fica à
  // vista do dono do dado e a correção depende de telefonar para o comercial.
  //
  // ⚠️ E ENTRAM NESTA LISTA, que é a lista da GUARDA DO DOCUMENTO CONGELADO,
  // porque `quote-html.builder.ts` IMPRIME os dois na folha que o cliente
  // assina (`categoryLabel`, `implementLabel`) e o snapshot já os congela
  // (`QuoteSnapshotVehicle.category/implementType`). Sem isso, mudar "Sider"
  // para "Frigorífico" depois da assinatura passaria em silêncio e o cadastro
  // divergiria do documento — exatamente o buraco que a guarda existe para
  // fechar na placa e no chassi. Com isso, o comportamento é o mesmo e de
  // graça: em branco na folha → preenchimento tardio, permitido; impresso e
  // diferente → 409, com a frase que nomeia o campo.
  //
  // ⚠️ `type` é o nome da COLUNA (`Implement.type`, NOMENCLATURA §1). No
  // snapshot SELADO a chave continua `implementType` (v1–v4: mudar uma letra do
  // JSON muda o hash) — a tradução é de `frozenIdentityOf`, e só dela. Os
  // VALORES não mudaram, então a comparação continua de valor cru, sem tabela.
  'category',
  'type',
  // ⛔ A FRENTE E A PORTA TRASEIRA NÃO ENTRAM (P13a, PLANO §7.3). A folha
  // assinada não imprime medida nem porta, e o snapshot não as guarda: não há o
  // que contradizer, e um 409 aqui seria recusa sem documento por trás. O que
  // as protege depois da produção é a TRAVA DE PRODUÇÃO, mais abaixo.
] as const;

export type VehicleIdentityField = (typeof VEHICLE_IDENTITY_FIELDS)[number];

/** Como cada campo é chamado para o contato do cliente. */
export const VEHICLE_IDENTITY_LABELS: Record<VehicleIdentityField, string> = {
  serialNumber: 'número de série',
  plate: 'placa',
  chassisNumber: 'chassi',
  orderNumber: 'número do pedido de compra',
  category: 'categoria do veículo',
  type: 'tipo de implemento',
};

/** O que o documento CONGELADO diz sobre um veículo. */
export interface FrozenVehicleIdentity {
  serialNumber: string | null;
  plate: string | null;
  chassisNumber: string | null;
  orderNumber: string | null;
  /** Valores de enum, crus — a comparação é de IGUALDADE, não de rótulo. */
  category: string | null;
  type: string | null;
}

/**
 * O que a requisição quer escrever.
 *
 * ⚠️ `undefined` é "NÃO TOQUE", e `null` é "APAGUE" — as duas coisas mais
 * diferentes que este tipo exprime. Num `PATCH` a distinção é o contrato
 * inteiro: tratar `undefined` como `null` faria um formulário que manda só a
 * placa apagar a série e o chassi em silêncio. Por isso toda comparação abaixo
 * testa `=== undefined` explicitamente e NUNCA usa falsidade (`!valor`), que
 * confundiria `null`, `''` e `undefined` num só ramo.
 */
export type DesiredVehicleIdentity = Partial<Record<VehicleIdentityField, string | null>>;

/** O que aconteceria com UM campo, se a escrita fosse adiante. */
export type VehicleIdentitySlotKind =
  /** Estava em branco no documento congelado: é a LACUNA sendo preenchida. */
  | 'LATE_FILL'
  /** Já havia valor impresso, e o novo é outro: alteração MATERIAL. */
  | 'OVERWRITE'
  /** O valor pedido é o que já está lá — nada muda no documento. */
  | 'UNCHANGED';

export interface VehicleIdentitySlotDecision {
  field: VehicleIdentityField;
  /** O valor impresso no documento congelado. */
  before: string | null;
  /** O valor que a requisição quer gravar. */
  after: string | null;
  kind: VehicleIdentitySlotKind;
}

/**
 * Normaliza para COMPARAR — nunca para gravar.
 *
 * `trim` + caixa alta porque caixa não é identidade: um cadastro antigo com
 * `abc1d23` e uma requisição com `ABC1D23` descrevem o MESMO veículo, e tratar
 * isso como troca produziria um 409 sobre nada. O valor GRAVADO continua sendo
 * o que a borda (`plateSchema`, `chassisNumberSchema`, `portalSerialSchema`)
 * produziu, não este.
 *
 * `''` vira `null` pelo mesmo motivo que no banco: string vazia e ausência são
 * o mesmo fato, e só um deles sobrevive a uma ida e volta pelo formulário.
 */
function comparavel(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  return texto === '' ? null : texto.toUpperCase();
}

/**
 * A identificação congelada DE UM VEÍCULO, pareada por `taskId`.
 *
 * ⛔ POR `taskId`, NUNCA POR POSIÇÃO — a mesma lição de
 * `tolerateLateRegistration`: excluir o implemento 12 de um orçamento de sessenta
 * desloca os quarenta e oito seguintes, e a comparação por posição confrontaria
 * a placa do 13 com a congelada do 12. Leria como "a placa mudou" em quarenta e
 * oito veículos que ninguém tocou.
 *
 * Devolve `null` quando o veículo NÃO ESTAVA no documento congelado. É o caso
 * de uma tarefa acrescentada ao orçamento depois da emissão: ela não tem linha
 * nem lacuna naquela folha, então escrever a identidade dela não contradiz
 * nada — e recusar seria barrar por associação.
 *
 * `orderNumber` é opcional no snapshot (entrou depois dos outros três): num
 * envelope congelado antes dessa chave existir, a ausência é lida como BRANCO,
 * que é o que a folha de fato mostrava.
 */
export function frozenIdentityOf(
  vehicles: readonly QuoteSnapshotVehicle[] | null | undefined,
  taskId: string,
): FrozenVehicleIdentity | null {
  const alvo = taskId?.trim();
  if (!alvo) return null;
  const v = (vehicles ?? []).find(item => item?.taskId === alvo);
  if (!v) return null;
  return {
    serialNumber: v.serialNumber ?? null,
    plate: v.plate ?? null,
    chassisNumber: v.chassisNumber ?? null,
    orderNumber: v.orderNumber ?? null,
    // ⚠️ Já vinham no snapshot desde sempre (o documento os imprime); o que
    // faltava era alguém compará-los. A chave SELADA é `implementType`; aqui
    // ela vira o nome da coluna.
    category: v.category ?? null,
    type: v.implementType ?? null,
  };
}

/** O mesmo, partindo do snapshot inteiro. Passa pela única porta de entrada. */
export function frozenIdentityInSnapshot(
  snapshot: QuoteSnapshot | null | undefined,
  taskId: string,
): FrozenVehicleIdentity | null {
  return frozenIdentityOf(snapshotVehicles(snapshot), taskId);
}

/**
 * A CLASSIFICAÇÃO, campo a campo. Uma linha por campo TOCADO — os demais nem
 * aparecem, porque um campo que a requisição não menciona não pode contradizer
 * documento nenhum.
 */
export function classifyVehicleIdentityWrite(
  frozen: FrozenVehicleIdentity | null | undefined,
  desired: DesiredVehicleIdentity,
): VehicleIdentitySlotDecision[] {
  const decisoes: VehicleIdentitySlotDecision[] = [];

  for (const field of VEHICLE_IDENTITY_FIELDS) {
    const pedido = desired?.[field];
    // ⚠️ `undefined` = campo não mencionado. Ver a nota em
    // `DesiredVehicleIdentity`: `null` é ato (apagar) e cai nos ramos abaixo.
    if (pedido === undefined) continue;

    const before = frozen ? (frozen[field] ?? null) : null;
    const after = pedido;

    const a = comparavel(before);
    const b = comparavel(after);

    const kind: VehicleIdentitySlotKind =
      a === b ? 'UNCHANGED' : a === null ? 'LATE_FILL' : 'OVERWRITE';

    decisoes.push({ field, before, after, kind });
  }

  return decisoes;
}

/** Só as que derrubariam a coleta. */
export function overwritesAmong(
  decisoes: readonly VehicleIdentitySlotDecision[],
): VehicleIdentitySlotDecision[] {
  return decisoes.filter(d => d.kind === 'OVERWRITE');
}

/** O estado do envelope que a mensagem precisa distinguir. */
export type LiveEnvelopeKind = 'RUNNING' | 'COMPLETED';

/**
 * A FRASE DA RECUSA — e ela tem de fazer três coisas.
 *
 *  1. dizer QUAL campo e QUAL valor impresso está no caminho (sem isso o
 *     contato tenta de novo, idêntico, e recebe o mesmo erro);
 *  2. dizer POR QUE (o documento está em coleta / já foi assinado), porque a
 *     recusa tem de parecer uma regra e não um defeito da tela;
 *  3. dizer A QUEM RECORRER, nominalmente quando se sabe o nome. "Fale com o
 *     comercial" é o que o contato de cliente NÃO consegue resolver sozinho —
 *     ele não sabe quem é o comercial dele.
 */
export function vehicleIdentityConflictMessage(
  overwrites: readonly VehicleIdentitySlotDecision[],
  envelope: LiveEnvelopeKind,
  contato: string | null,
): string {
  const partes = overwrites.map(
    d =>
      `${VEHICLE_IDENTITY_LABELS[d.field]} (o documento traz "${d.before}", ` +
      `você enviou "${d.after ?? '—'}")`,
  );
  const lista =
    partes.length > 1
      ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`
      : partes[0];

  const situacao =
    envelope === 'COMPLETED'
      ? 'O orçamento deste veículo JÁ FOI ASSINADO e o documento está selado'
      : 'O orçamento deste veículo está EM COLETA DE ASSINATURAS';

  const quem = contato?.trim()
    ? `Fale com ${contato.trim()} para corrigir o cadastro e reemitir o documento.`
    : 'Fale com o comercial da Ankaa para corrigir o cadastro e reemitir o documento.';

  return (
    `${situacao}, e ele imprime ${lista}. ` +
    'Alterar um dado que já consta do documento invalidaria as assinaturas já ' +
    `colhidas. ${quem}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ⛔ A TRAVA DE PRODUÇÃO — medida, porta e série param de mudar pelo portal
// ─────────────────────────────────────────────────────────────────────────────
// DD5 ("o responsável não edita medida depois de `IN_PRODUCTION`") e a pergunta
// 15 do plano (a série também). Com a tarefa em produção a oficina já corta o
// adesivo, dobra a chapa e pinta pela medida que está no cadastro; uma face
// trocada pelo cliente nessa hora não corrige nada — produz um implemento
// diferente do que está sendo feito, e ninguém do lado de dentro é avisado.
// A série sai na nota e no boleto: trocá-la com o veículo na linha é trocar o
// que o documento fiscal vai dizer.
//
// Então a rota RECUSA (409) e diz com quem falar, como na guarda do documento
// congelado — a correção continua possível, pelo lado de dentro, que tem a
// produção na frente.
//
// ⚠️ SÓ O QUE DE FATO MUDA É TRAVADO. Reenviar o formulário com a medida que já
// está gravada não é mudança, e um 409 sobre nada ensinaria o contato a não
// salvar mais nada. Placa, chassi, plaqueta, categoria, tipo, pedido e a
// previsão seguem as regras de antes (placa e chassi chegam depois, com o
// veículo já na linha — é para isso que a lacuna do documento existe).
//
// ⚠️ `CANCELLED` NÃO trava: o veículo cancelado não está sendo produzido, e a
// frase "já está em produção" seria falsa. A trava é sobre a oficina, não
// sobre a ordem dos estados.

/** Os estados da tarefa em que medida, porta e série não mudam mais pelo portal. */
export const STATUS_QUE_TRAVAM_O_IMPLEMENTO = ['IN_PRODUCTION', 'COMPLETED'] as const;

export function emProducao(status: string | null | undefined): boolean {
  return (STATUS_QUE_TRAVAM_O_IMPLEMENTO as readonly string[]).includes(status ?? '');
}

/** O começo fixo da frase — a tela pode procurá-lo; o resto nomeia os campos. */
export const TRAVA_DE_PRODUCAO_MENSAGEM =
  'O veículo já está em produção: fale com a Ankaa para corrigir';

/** Uma mudança pedida que a trava julga. `chave` é a do CORPO (`frente`, …). */
export type MudancaTravavel =
  | { campo: 'medida'; face: ImplementFace; chave: string }
  | { campo: 'portaTraseira' }
  | { campo: 'serialNumber' };

export interface TravaDeProducao {
  message: string;
  /** Os caminhos no corpo do `PATCH` (`medidas.frente`, `portaTraseira`, `serialNumber`). */
  fields: string[];
}

function rotuloDaMudanca(m: MudancaTravavel): string {
  if (m.campo === 'medida') return `a medida (${IMPLEMENT_FACE_LABELS[m.face]})`;
  if (m.campo === 'portaTraseira') return 'a porta traseira';
  return 'o número de série';
}

/**
 * O VEREDICTO: `null` = pode escrever; senão a frase e os campos culpados.
 *
 * Recebe as mudanças JÁ REDUZIDAS ao que difere do gravado — ver a nota no
 * cabeçalho desta seção.
 */
export function travaDeProducao(
  status: string | null | undefined,
  mudancas: readonly MudancaTravavel[],
): TravaDeProducao | null {
  if (!emProducao(status) || mudancas.length === 0) return null;
  const rotulos = mudancas.map(rotuloDaMudanca);
  const lista =
    rotulos.length > 1
      ? `${rotulos.slice(0, -1).join(', ')} e ${rotulos[rotulos.length - 1]}`
      : rotulos[0];
  return {
    message: `${TRAVA_DE_PRODUCAO_MENSAGEM} ${lista}.`,
    fields: mudancas.map(m => (m.campo === 'medida' ? `medidas.${m.chave}` : m.campo)),
  };
}

/** Uma face como o banco a guarda ou como o portal a pede — já em METROS. */
export interface MedidaComparavel {
  height: number;
  sections: ReadonlyArray<{
    width: number;
    isDoor: boolean;
    doorHeight: number | null;
    position: number | null;
  }>;
}

/** Um décimo de milímetro, a mesma resolução de `centimetrosParaMetros`. */
const TOLERANCIA_EM_METROS = 1e-5;

const perto = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? a == null && b == null : Math.abs(a - b) < TOLERANCIA_EM_METROS;

/**
 * A face pedida é a que já está gravada?
 *
 * Compara altura e seções NA ORDEM (pela posição), com tolerância de 0,1 mm —
 * o banco guarda `Float`, e uma linha escrita por outro editor pode ter o ruído
 * binário que a borda do portal arredonda. A altura da porta só conta na seção
 * que É porta: seção sem porta com `doorHeight` gravado (editor interno) não
 * transforma o reenvio do mesmo desenho numa mudança.
 */
export function mesmaMedida(
  gravada: MedidaComparavel | null | undefined,
  pedida: MedidaComparavel | null | undefined,
): boolean {
  if (!gravada || !pedida) return !gravada && !pedida;
  if (!perto(gravada.height, pedida.height)) return false;
  const ordem = (s: { position: number | null }, t: { position: number | null }) =>
    (s.position ?? 0) - (t.position ?? 0);
  const a = [...gravada.sections].sort(ordem);
  const b = [...pedida.sections].sort(ordem);
  if (a.length !== b.length) return false;
  return a.every(
    (s, i) =>
      perto(s.width, b[i].width) &&
      Boolean(s.isDoor) === Boolean(b[i].isDoor) &&
      (!s.isDoor || perto(s.doorHeight, b[i].doorHeight)),
  );
}
