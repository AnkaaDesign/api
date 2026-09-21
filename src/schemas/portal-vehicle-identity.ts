// api/src/schemas/portal-vehicle-identity.ts
//
// A BORDA DE `PATCH /cliente/me/veiculos/:taskId/identificacao`.
//
// O dono pediu isto com estas palavras: *"eles devem ser capazes de definir e
// alterar campos como numero de serie, placa, chassi, plaqueta e numero de
// pedido"*. São cinco campos e cinco naturezas diferentes, e é por isso que
// este arquivo existe em vez de um `z.object` de cinco `z.string()`:
//
//   · SÉRIE é TEXTO (`ABC-123456` é uma série válida) e `@unique` GLOBAL;
//   · PLACA é limpa e validada nos dois padrões brasileiros, e `@unique` GLOBAL;
//   · CHASSI tem 17 caracteres e recusa I/O/Q — com mensagens DIFERENTES para
//     cada caso, porque "17 caracteres" não ajuda quem digitou O no lugar de 0;
//   · PLAQUETA é ARQUIVO, não texto (a coluna de texto morreu na migration
//     `20260727150000`) — sobe por multipart no campo `truckVinPlate`, ou já
//     vem como `File.id` em `vinPlateFileId`;
//   · PEDIDO DE COMPRA tem portão PRÓPRIO (`WRITE_PURCHASE_ORDER`) e escrita
//     dupla — o serviço o delega ao `PurchaseOrderService`, nunca grava a
//     coluna à mão.
//
// ⚠️ TRÊS REGRAS DE `PATCH` QUE ESTE ARQUIVO SUSTENTA
//
//  1. CHAVE AUSENTE ≠ `null`. Ausente é "não toque"; `null` (e `''`, que o
//     formulário manda no lugar dele) é "apague". Um formulário que envia só a
//     placa não pode zerar a série — e zeraria, se a borda colapsasse os dois
//     em `null`. Toda validação abaixo é `.optional()` E `.nullable()`, e o
//     serviço testa `=== undefined`, nunca falsidade.
//
//  2. `.strict()` EXPLÍCITO. Nada em zod é estrito neste repositório, e chave
//     fora do lugar some em SILÊNCIO (contrato §10). Num corpo de cinco chaves
//     isso basta para `chassisNumber` enviado como `chassis` chegar aqui como
//     corpo VAZIO — e a rota responderia 200 sem ter escrito nada. Com
//     `.strict()` a resposta NOMEIA a chave errada.
//
//  3. CORPO VAZIO É ERRO — mas a checagem NÃO é um `.refine`. `{}` sem arquivo
//     seria uma escrita que não escreve, com 200 na cara do cliente; `{}` COM a
//     parte `truckVinPlate` é o `PATCH` legítimo de quem só trocou a foto. Zod
//     não enxerga arquivo, então quem decide é `temAlgoParaMudar()`, no fim
//     deste arquivo — pura, e por isso testável sem Nest.
//
// ⚠️ A FORMA DO MULTIPART é a MESMA da requisição: UMA parte `payload` com o
// JSON inteiro + a parte `truckVinPlate`. É o que `web/src/api-client/portal.ts`
// → `multipart()` manda (`form.append("payload", JSON.stringify(payload))`), e o
// desembrulho é `desempacotarPayload`, REUSADO de `portal-request.ts` — não uma
// segunda cópia. Ver a nota de exportação lá.
//
// ⚠️ E O `payload` CHEGA DE DUAS FORMAS: STRING quando o schema é usado direto
// (o teste, e qualquer chamador que não passe pelo pipe) e OBJETO JÁ
// DESSERIALIZADO quando vem pela rota — `ZodValidationPipe.transform` roda
// `fixArrays` antes de `schema.parse`, e `fixArrays` desserializa toda string
// que seja JSON válido. `desempacotarPayload` trata os dois; tratar só um faria
// a rota e o teste discordarem em silêncio.

import { z } from 'zod';
import { chassisNumberSchema, plateSchema } from './common';
import { desempacotarPayload, portalSerialSchema } from './portal-request';

/** O mesmo teto de `Task.customerOrderNumber` (`String?`, máx. 100 no schema). */
export const PEDIDO_MAXIMO = 100;

/**
 * Texto opcional que o multipart pode ter entregado como `''` ou `'null'`.
 *
 * As duas convenções existem: `web/src/utils/form-data-helper.ts` emite
 * `'null'` para nulo, e chamadores antigos mandavam `''`. `FormData` não tem
 * tipo nulo, então sem esta tradução um campo esvaziado na tela chegaria como a
 * string de quatro letras `null` e seria GRAVADO assim.
 */
const textoOpcional = (max: number, rotulo: string) =>
  z.preprocess(
    valor => {
      if (typeof valor !== 'string') return valor;
      const texto = valor.trim();
      return texto === '' || texto === 'null' ? null : texto;
    },
    z.string().max(max, `${rotulo}: máximo de ${max} caracteres`).nullable().optional(),
  );

/**
 * O CORPO, já desembrulhado.
 *
 * Exportado separado de `portalIdentificacaoSchema` para que o teste possa
 * provar que as DUAS formas (JSON puro e `payload`) produzem o MESMO objeto —
 * que é a propriedade de que `test:portal-identificacao` depende para rodar sem
 * banco e sem Nest.
 */
export const portalIdentificacaoCorpoSchema = z
  .object({
    /**
     * ⚠️ TEXTO, e MAIÚSCULO NA BORDA.
     *
     * `portalSerialSchema` é o mesmo objeto que a requisição usa — o regex
     * `/^[A-Z0-9-]+$/` recusa minúscula, e recusar `abc-1` seria recusar o que
     * o cliente vê escrito no próprio chassi. Reusar o schema, e não copiar o
     * regex, é o que impede uma terceira fonte de verdade sobre o formato.
     */
    serialNumber: portalSerialSchema,

    /** `plateSchema` — limpa (sem hífen/espaço) e aceita antiga e Mercosul. */
    plate: plateSchema,

    /**
     * `chassisNumberSchema` — 17 caracteres, sem I/O/Q.
     *
     * DUAS mensagens distintas, de propósito (`schemas/common.ts:184-195`):
     * comprimento errado e letra proibida são erros diferentes, e dizer "17
     * caracteres" a quem digitou um O num chassi que já tem 17 manda a pessoa
     * conferir o que está certo.
     */
    chassisNumber: chassisNumberSchema,

    /**
     * O NÚMERO DO PEDIDO DE COMPRA — com portão PRÓPRIO.
     *
     * ⛔ Só é aceito de quem tem `WRITE_PURCHASE_ORDER` (Compras e Financeiro).
     * O gestor de frota escreve placa e chassi e NÃO escreve isto: o pedido é o
     * documento que a NFS-e cita e que o `seuNumero` do boleto carrega, e quem
     * o emite é o Compras do cliente. O portão é do SERVIÇO, não daqui — a
     * borda não conhece papel.
     *
     * ⛔ E a escrita é do `PurchaseOrderService`, nunca desta rota: ela tem de
     * continuar sendo DUPLA (`Task.purchaseOrderId` + `customerOrderNumber`),
     * porque a regra de atenção `budget.ibipora-missing-order-number`, a NFS-e
     * e o boleto leem a coluna legada e NENHUM deles conhece `PurchaseOrder`.
     */
    purchaseOrderNumber: textoOpcional(PEDIDO_MAXIMO, 'Número do pedido de compra'),

    /**
     * A PLAQUETA já enviada, por id.
     *
     * A IMAGEM nova sobe por multipart no campo `truckVinPlate` — este campo é
     * o outro lado do mesmo par, e é a forma que `web/src/api-client/portal.ts`
     * declara (`PortalVehicleIdentityInput.vinPlateFileId`). O par é o mesmo
     * que o `task-edit-form` interno já usa.
     *
     * ⚠️ A plaqueta NÃO é texto. A coluna `Truck.vinPlate` de texto foi
     * removida em `20260727150000_truck_vin_plate_image`: "a plaqueta era um
     * campo de texto que ninguém preenchia — o que a produção precisa é da foto
     * legível". Quem mandar texto aqui recebe "uuid inválido", que é honesto.
     */
    vinPlateFileId: z.preprocess(
      valor => {
        if (typeof valor !== 'string') return valor;
        const texto = valor.trim();
        return texto === '' || texto === 'null' ? null : texto;
      },
      z.string().uuid('Plaqueta inválida').nullable().optional(),
    ),
  })
  // Ver a regra 2 no cabeçalho. Sem isto, `chassis` em vez de `chassisNumber`
  // vira um 200 que não escreveu nada.
  .strict();

/**
 * O QUE A ROTA USA — o corpo, com o desembrulho de `payload` por cima.
 *
 * ⚠️ A validação e o contrato de ERRO são os mesmos: o desembrulho é um passo
 * ANTES, e tudo o que já era recusado continua recusado com a mesma mensagem e
 * o mesmo `path`. O único erro novo é o do `payload` ilegível.
 */
export const portalIdentificacaoSchema = z.preprocess(
  desempacotarPayload,
  portalIdentificacaoCorpoSchema,
);

export type PortalIdentificacaoFormData = z.infer<typeof portalIdentificacaoSchema>;

/** As chaves de corpo que, presentes, significam uma escrita. */
export const CAMPOS_DE_IDENTIFICACAO = [
  'serialNumber',
  'plate',
  'chassisNumber',
  'purchaseOrderNumber',
  'vinPlateFileId',
] as const;

/**
 * HÁ ALGO PARA MUDAR? (a regra 3 do cabeçalho, com o arquivo incluído)
 *
 * ⛔ NÃO É UM `.refine` DO SCHEMA, e a razão é o multipart: o upload da
 * plaqueta sozinho — `payload` vazio + a parte `truckVinPlate` — é um `PATCH`
 * PERFEITAMENTE VÁLIDO, e um `.refine` dentro do zod nunca o veria, porque
 * arquivo não atravessa o schema. A checagem viveria numa borda que não conhece
 * metade da entrada, e recusaria a única forma de trocar só a foto.
 *
 * Função pura e exportada para que o teste a exercite sem subir o Nest: é a
 * diferença entre um 400 honesto ("informe ao menos um campo") e um 200 que não
 * escreveu nada — o segundo é indistinguível de sucesso na tela.
 *
 * ⚠️ `=== undefined`, nunca falsidade: `null` é um ato (apagar) e conta como
 * mudança; `!valor` juntaria `null`, `''` e ausência num ramo só.
 */
export function temAlgoParaMudar(
  corpo: PortalIdentificacaoFormData | null | undefined,
  opcoes?: { temPlaqueta?: boolean },
): boolean {
  if (opcoes?.temPlaqueta) return true;
  if (!corpo) return false;
  return CAMPOS_DE_IDENTIFICACAO.some(
    campo => (corpo as Record<string, unknown>)[campo] !== undefined,
  );
}

export const NADA_PARA_MUDAR_MENSAGEM =
  'Informe ao menos um campo para alterar (série, placa, chassi, plaqueta ou pedido de compra).';
