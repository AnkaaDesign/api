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
// (ela responde pelas formas v1/v2 `task`+`truck` e pela v3+ `vehicles`), e
// reusá-la é o que impede este arquivo de ficar cego para coleta antiga.

import { snapshotVehicles } from '@modules/common/signature/services/quote-diff';
import type {
  QuoteSnapshot,
  QuoteSnapshotVehicle,
} from '@modules/common/signature/services/quote-snapshot.service';

/**
 * Os quatro campos que o documento imprime e que este pacote escreve.
 *
 * ⚠️ `chassisNumber` aqui, `chassis` na chave da lacuna. Os dois nomes existem:
 * a coluna é `Truck.chassisNumber`, e `LateSlotKey`/`LATE_SLOT_LABELS` usam
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
  // Eles são do CLIENTE tanto quanto a placa: quem sabe se o caminhão é um
  // truck ou um bitrem, e se o baú é frigorífico ou sider, é quem opera a
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
  'category',
  'implementType',
] as const;

export type VehicleIdentityField = (typeof VEHICLE_IDENTITY_FIELDS)[number];

/** Como cada campo é chamado para o contato do cliente. */
export const VEHICLE_IDENTITY_LABELS: Record<VehicleIdentityField, string> = {
  serialNumber: 'número de série',
  plate: 'placa',
  chassisNumber: 'chassi',
  orderNumber: 'número do pedido de compra',
  category: 'categoria do veículo',
  implementType: 'tipo de implemento',
};

/** O que o documento CONGELADO diz sobre um veículo. */
export interface FrozenVehicleIdentity {
  serialNumber: string | null;
  plate: string | null;
  chassisNumber: string | null;
  orderNumber: string | null;
  /** Valores de enum, crus — a comparação é de IGUALDADE, não de rótulo. */
  category: string | null;
  implementType: string | null;
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
 * `tolerateLateRegistration`: excluir o caminhão 12 de um orçamento de sessenta
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
    // faltava era alguém compará-los.
    category: v.category ?? null,
    implementType: v.implementType ?? null,
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
