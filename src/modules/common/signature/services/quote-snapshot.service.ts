/**
 * Recorte canônico do orçamento — a definição operacional de "alteração material".
 *
 * REGRA CENTRAL: o snapshot contém **exatamente o que o documento exibe**, nada a
 * mais e nada a menos. Isso não é uma escolha estética; é o que torna a pergunta
 * "o orçamento mudou?" decidível por igualdade de hash em vez de por uma lista de
 * campos mantida à mão, que inevitavelmente ficaria dessincronizada do template.
 *
 * Se algo aparece no PDF, entra aqui. O que fica DE FORA de propósito: status,
 * statusOrder, billingApprovedAt, createdAt/updatedAt, ids internos de linha.
 * Nada disso é exibido, e incluí-los geraria invalidações espúrias a cada toque
 * administrativo no registro.
 *
 * DOIS NÍVEIS, DUAS CONSEQUÊNCIAS
 * ------------------------------------------------------------------------
 * "Aparece no documento" e "muda a proposta" não são a mesma coisa, e tratar as
 * duas como uma só foi o que fez o orçamento nº 590 ser invalidado porque alguém
 * corrigiu "Paulo Cvarvalho" para "Paulo Carvalho". Uma assinatura juridicamente
 * válida foi destruída por um typo.
 *
 * - MATERIAL (`materialProjection`): as condições comerciais — preços, desconto,
 *   pagamento, garantia, prazo, validade, layout, quem se vincula e sobre qual
 *   veículo. Mudou ⇒ o envelope é INVALIDADO e as assinaturas viram VOIDED. É o
 *   CC art. 431 (aceitação com modificações importa nova proposta) e a OWASP
 *   Transaction Authorization §2.6: ninguém fica preso a termos que se moveram.
 *
 * - COSMÉTICO (todo o resto do snapshot): grafia de nomes, nome fantasia do
 *   cliente, nome/série da tarefa, categoria e CHASSI do veículo. Mudou ⇒ apenas um
 *   evento `SNAPSHOT_DRIFTED` na trilha. Nada é invalidado: o PDF assinado já
 *   está congelado em disco e continua exibindo exatamente o que o signatário
 *   viu — corrigir o cadastro depois não reescreve o documento nem altera uma
 *   vírgula das condições aceitas.
 *
 * A regra prática: se a correção não daria ao cliente motivo para reconsiderar a
 * assinatura, ela não pode custar a assinatura.
 *
 * CADASTRO TARDIO — um terceiro caso, entre os dois
 * ------------------------------------------------------------------------
 * Alguns campos materiais chegam DEPOIS da assinatura por natureza do negócio:
 * implemento 0 km é orçado sem placa e sem chassi, que só existem quando o
 * veículo fica pronto. Preencher o que estava em branco não é mudar a proposta —
 * é completar o cadastro do mesmo veículo. Trocar um valor por OUTRO continua
 * material. Como hash é comparação simétrica e essa regra não é, a assimetria
 * mora em `tolerateLateRegistration`, não no recorte.
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { sha256Hex } from '../utils/canonical';
import { onlyDigits } from '../utils/identity';
import { sectionsForRoles } from '../quote-sections';
// `normText` mora em `quote-diff` para que aquele módulo não precise importar
// nada de runtime daqui — o import de lá para cá é só de tipos, e é isso que
// mantém o ciclo entre os dois arquivos inofensivo.
import {
  describeQuoteChange,
  describeQuoteChanges,
  diffQuoteSnapshots,
  normText,
  type QuoteChange,
} from './quote-diff';

/** Dinheiro sempre como string de 2 casas — nunca float. */
function money(value: Prisma.Decimal | number | null | undefined): string {
  if (value === null || value === undefined) return '0.00';
  const n = typeof value === 'number' ? value : Number(value.toString());
  return n.toFixed(2);
}

export interface QuoteSnapshotSigner {
  responsibleId: string;
  name: string;
  phoneDigits: string;
  /** Minúsculo e sem espaços — é o CANAL do OTP desde a troca de WhatsApp para e-mail. */
  emailNormalized: string;
  roles: string[];
}

export interface QuoteSnapshot {
  /** Versão do formato. Incrementar quando o template mudar o que é exibido. */
  schemaVersion: number;
  budgetNumber: number;
  issuedAt: string;
  expiresAt: string;
  customer: {
    id: string | null;
    corporateName: string | null;
    fantasyName: string | null;
    document: string | null;
  } | null;
  task: {
    id: string;
    name: string | null;
    serialNumber: string | null;
  } | null;
  truck: {
    plate: string | null;
    chassisNumber: string | null;
    category: string | null;
    implementType: string | null;
  } | null;
  services: Array<{
    description: string;
    amount: string;
    observation: string | null;
    position: number;
  }>;
  subtotal: string;
  total: string;
  discount: {
    type: string;
    value: string | null;
    reference: string | null;
  };
  paymentCondition: string | null;
  customPaymentText: string | null;
  guaranteeYears: number | null;
  customGuaranteeText: string | null;
  customForecastDays: number | null;
  simultaneousTasks: number | null;
  layoutFileIds: string[];
  signers: QuoteSnapshotSigner[];
  commercialUserId: string | null;
}

export const QUOTE_SNAPSHOT_SCHEMA_VERSION = 2;

/**
 * Versão do RECORTE MATERIAL — versionada à parte de propósito.
 *
 * `QUOTE_SNAPSHOT_SCHEMA_VERSION` sobe sempre que o template muda o que exibe,
 * inclusive por mexidas cosméticas. Se o hash material dependesse dela, um ajuste
 * de layout invalidaria toda coleta em andamento no país. Só incrementar aqui
 * quando o CONJUNTO de campos materiais mudar — aí a invalidação em massa é
 * exatamente o comportamento correto.
 */
/**
 * v2 (2026-07-29): o canal do OTP passou de telefone para e-mail, então o que
 * entra no recorte material passou de `phoneDigits` para `emailNormalized`.
 *
 * v3 (2026-08-14): o CHASSI saiu do recorte. Ele é cadastro do veículo, não
 * condição comercial: o implemento costuma estar em fabricação quando o
 * orçamento é assinado, e o número só é registrado depois. Enquanto era
 * material, preencher esse campo derrubava a coleta — ou marcava um orçamento
 * já assinado como alterado — sem que uma vírgula da proposta tivesse mudado.
 * A PLACA continua no recorte: é ela que identifica materialmente o objeto do
 * contrato.
 *
 * As versões antigas continuam calculáveis — `materialProjection` aceita a
 * versão — porque envelope congelado sob a v1 tinha o telefone como canal de
 * verdade, e o congelado sob v1/v2 tinha o chassi como termo. Reavaliá-los pela
 * regra nova derrubaria assinaturas por mudanças que, para eles, nunca foram
 * materiais.
 */
export const QUOTE_MATERIAL_SCHEMA_VERSION = 4;

/** Versões de recorte material que ainda sabemos recalcular. Ordem: mais nova primeiro. */
export const SUPPORTED_MATERIAL_VERSIONS = [4, 3, 2, 1] as const;

/**
 * O recorte que decide invalidação. Espelha a regra de negócio: condições
 * comerciais, identidade de quem se vincula e do objeto, e o layout.
 */
export interface QuoteMaterialProjection {
  materialVersion: number;
  services: Array<{
    description: string | null;
    amount: string;
    observation: string | null;
    position: number;
  }>;
  subtotal: string;
  total: string;
  discount: { type: string; value: string | null; reference: string | null };
  paymentCondition: string | null;
  customPaymentText: string | null;
  guaranteeYears: number | null;
  customGuaranteeText: string | null;
  customForecastDays: number | null;
  simultaneousTasks: number | null;
  expiresAt: string;
  layoutFileIds: string[];
  /** Quem se vincula: id + documento. Razão social e nome fantasia são cosméticos. */
  customer: { id: string | null; document: string | null } | null;
  /**
   * O objeto do contrato — a PLACA. Categoria, tipo de implemento e, desde a
   * v3, o CHASSI são cosméticos. A placa é material na TROCA, não no
   * preenchimento: ver `tolerateLateRegistration`.
   *
   * `chassisNumber` é opcional porque só é emitido ao recalcular um hash v1/v2:
   * a chave precisa continuar existindo naquelas versões para que o hash antigo
   * seja reproduzível, e precisa desaparecer na v3 (o canonicalizador descarta
   * `undefined`, exatamente como faz com o canal do OTP nos signatários).
   */
  truck: { plate: string | null; chassisNumber?: string | null } | null;
  /**
   * Identidade dos signatários e o CANAL do OTP — não a grafia do nome.
   *
   * O canal entra por segurança, não por exibição: ele não aparece no documento,
   * mas é para onde vai o código de assinatura. Trocá-lo durante uma coleta
   * redireciona a prova de autoria para outra caixa, e isso PRECISA derrubar o
   * envelope.
   *
   * Na v1 o canal era o telefone (OTP por WhatsApp). Na v2/v3 é o e-mail. Na
   * **v4 são os dois**: o canal deixou de ser uma constante do código e passou a
   * ser configuração (`SIGNATURE_DELIVERY_CHANNEL`) mais escolha do operador por
   * envelope, então o recorte não tem como saber qual dos contatos carrega o
   * código — e proteger só um deixaria a outra metade livre para ser trocada no
   * meio de uma coleta.
   *
   * A projeção é calculada na versão em que o envelope foi CONGELADO — ver
   * `materialProjection` —, porque avaliar um envelope antigo pela regra nova
   * derrubaria assinaturas por uma mudança que, à época dele, não era material.
   * É por isso que as três versões anteriores continuam sendo emitidas
   * byte-a-byte como antes: envelope v3 em andamento tem de continuar batendo.
   */
  signers: Array<{ responsibleId: string; phoneDigits?: string; emailNormalized?: string }>;
}

/** Include compartilhado — o renderizador e o snapshot precisam ver o MESMO grafo. */
export const QUOTE_SNAPSHOT_INCLUDE = {
  services: { orderBy: { position: 'asc' } },
  layoutFiles: { orderBy: { createdAt: 'asc' } },
  customerConfigs: {
    orderBy: { createdAt: 'asc' },
    include: {
      customer: true,
      // Nem o responsável entra no snapshot, pela mesma razão das parcelas: ele
      // serve ao renderizador do orçamento RECORTADO por cliente, que endereça o
      // documento ao contato daquela configuração — no faturamento dividido, o
      // contato da tarefa é o de UM dos clientes, e usá-lo nos dois documentos
      // endereça o orçamento de um cliente à pessoa do outro.
      responsible: true,
      // As parcelas NÃO entram no snapshot (ver `build`, que escolhe campo a
      // campo) — não mudam o hash nem a materialidade. Elas existem aqui só para
      // o renderizador poder citar o vencimento REAL na cláusula de pagamento
      // quando o faturamento já as gerou. Na assinatura ainda não existem, e a
      // cláusula continua saindo do `specificDate`, como antes.
      installments: { orderBy: { number: 'asc' } },
    },
  },
  task: {
    include: {
      customer: true,
      truck: true,
      responsibles: { orderBy: { name: 'asc' } },
    },
  },
} satisfies Prisma.TaskQuoteInclude;

export type QuoteWithSnapshotGraph = Prisma.TaskQuoteGetPayload<{
  include: typeof QUOTE_SNAPSHOT_INCLUDE;
}>;

@Injectable()
export class QuoteSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async loadQuoteGraph(quoteId: string): Promise<QuoteWithSnapshotGraph | null> {
    return this.prisma.taskQuote.findUnique({
      where: { id: quoteId },
      include: QUOTE_SNAPSHOT_INCLUDE,
    });
  }

  /**
   * Constrói o snapshot canônico.
   *
   * A primeira `customerConfig` (por createdAt) é a que governa desconto e
   * condição de pagamento exibidos — mesma regra que o gerador do web usa hoje
   * (`firstConfig`). Documentado aqui porque é uma escolha de negócio implícita
   * que agora tem consequência jurídica.
   */
  build(quote: QuoteWithSnapshotGraph): QuoteSnapshot {
    const task = quote.task ?? null;
    const customer = task?.customer ?? null;
    const truck = task?.truck ?? null;
    const firstConfig = quote.customerConfigs[0] ?? null;

    return {
      schemaVersion: QUOTE_SNAPSHOT_SCHEMA_VERSION,
      budgetNumber: quote.budgetNumber,
      // Data de emissão é a criação da quote, NUNCA `new Date()`. O gerador antigo
      // usava a data corrente em um dos caminhos, o que fazia o mesmo orçamento
      // renderizar diferente a cada dia.
      issuedAt: quote.createdAt.toISOString(),
      expiresAt: quote.expiresAt.toISOString(),
      customer: customer
        ? {
            id: customer.id,
            corporateName: customer.corporateName ?? null,
            fantasyName: customer.fantasyName ?? null,
            document: onlyDigits(customer.cnpj ?? customer.cpf ?? '') || null,
          }
        : null,
      task: task
        ? { id: task.id, name: task.name ?? null, serialNumber: task.serialNumber ?? null }
        : null,
      truck: truck
        ? {
            plate: truck.plate ?? null,
            chassisNumber: truck.chassisNumber ?? null,
            category: truck.category ?? null,
            implementType: truck.implementType ?? null,
          }
        : null,
      services: quote.services.map(s => ({
        description: s.description,
        amount: money(s.amount),
        observation: s.observation ?? null,
        position: s.position,
      })),
      subtotal: money(quote.subtotal),
      total: money(quote.total),
      discount: {
        type: firstConfig?.discountType ?? 'NONE',
        value: firstConfig?.discountValue != null ? money(firstConfig.discountValue) : null,
        reference: firstConfig?.discountReference ?? null,
      },
      paymentCondition: firstConfig?.paymentCondition ?? null,
      customPaymentText: firstConfig?.customPaymentText ?? null,
      guaranteeYears: quote.guaranteeYears ?? null,
      customGuaranteeText: quote.customGuaranteeText ?? null,
      customForecastDays: quote.customForecastDays ?? null,
      simultaneousTasks: quote.simultaneousTasks ?? null,
      // Ordenado: a ordem de leitura do Prisma não é garantida entre versões, e
      // uma permutação mudaria o hash sem que nada tivesse mudado de fato.
      layoutFileIds: quote.layoutFiles.map(f => f.id).sort(),
      // Os signatários aparecem no documento (uma linha de assinatura cada), logo
      // adicionar ou remover um responsável É alteração material.
      signers: (task?.responsibles ?? [])
        .map(r => ({
          responsibleId: r.id,
          name: r.name,
          phoneDigits: onlyDigits(r.phone),
          emailNormalized: (r.email ?? '').trim().toLowerCase(),
          roles: [...r.roles].sort(),
        }))
        .sort((a, b) => a.responsibleId.localeCompare(b.responsibleId)),
      commercialUserId: quote.commercialUserId ?? null,
    };
  }

  hash(snapshot: QuoteSnapshot): string {
    return sha256Hex(snapshot as unknown as object);
  }

  /**
   * Extrai do snapshot completo apenas o que, mudando, justifica derrubar
   * assinaturas já coletadas.
   *
   * Deriva do snapshot em vez de reler o banco: assim o recorte material de um
   * envelope antigo pode ser recalculado a partir do JSONB congelado, sem
   * depender do estado atual do orçamento — o que é o que torna a migração
   * possível e a auditoria reproduzível.
   */
  materialProjection(
    s: QuoteSnapshot,
    version: number = QUOTE_MATERIAL_SCHEMA_VERSION,
  ): QuoteMaterialProjection {
    return {
      materialVersion: version,
      services: s.services.map(svc => ({
        description: normText(svc.description),
        amount: svc.amount,
        observation: normText(svc.observation),
        position: svc.position,
      })),
      subtotal: s.subtotal,
      total: s.total,
      discount: {
        type: s.discount.type,
        value: s.discount.value,
        reference: normText(s.discount.reference),
      },
      paymentCondition: s.paymentCondition,
      customPaymentText: normText(s.customPaymentText),
      guaranteeYears: s.guaranteeYears,
      customGuaranteeText: normText(s.customGuaranteeText),
      customForecastDays: s.customForecastDays,
      simultaneousTasks: s.simultaneousTasks,
      expiresAt: s.expiresAt,
      layoutFileIds: [...s.layoutFileIds].sort(),
      customer: s.customer ? { id: s.customer.id, document: s.customer.document } : null,
      truck: s.truck
        ? {
            plate: normText(s.truck.plate),
            // Igual aos signatários: emitir a chave da OUTRA versão quebraria a
            // reprodutibilidade do hash antigo, que é o que permite reconhecer
            // um envelope não-alterado depois da mudança de recorte.
            ...(version >= 3 ? {} : { chassisNumber: normText(s.truck.chassisNumber) }),
          }
        : null,
      // O canal muda com a versão. Emitir a chave da OUTRA versão quebraria a
      // reprodutibilidade do hash antigo, que é justamente o que permite
      // reconhecer um envelope não-alterado depois da migração de canal.
      signers: s.signers
        .map(sig => {
          // v4: o canal virou ESCOLHA por envelope (SIGNATURE_DELIVERY_CHANNEL /
          // seletor da tarefa), então os DOIS contatos são materiais — não dá
          // mais para saber, olhando só o recorte, por qual deles o código sai.
          // Emitir ambos é o que faz uma troca de telefone derrubar uma coleta
          // por WhatsApp e uma troca de e-mail derrubar uma por e-mail.
          if (version >= 4) {
            return {
              responsibleId: sig.responsibleId,
              emailNormalized: (sig.emailNormalized ?? '').trim().toLowerCase(),
              phoneDigits: sig.phoneDigits,
            };
          }
          if (version >= 2) {
            return {
              responsibleId: sig.responsibleId,
              emailNormalized: (sig.emailNormalized ?? '').trim().toLowerCase(),
            };
          }
          return { responsibleId: sig.responsibleId, phoneDigits: sig.phoneDigits };
        })
        .sort((a, b) => a.responsibleId.localeCompare(b.responsibleId)),
    };
  }

  materialHash(
    snapshot: QuoteSnapshot,
    version: number = QUOTE_MATERIAL_SCHEMA_VERSION,
  ): string {
    return sha256Hex(this.materialProjection(snapshot, version) as unknown as object);
  }

  /**
   * O recorte material bate com o hash congelado em ALGUMA versão conhecida?
   *
   * Existe porque o envelope não guarda sob qual versão foi congelado: a
   * `materialVersion` vive dentro da projeção (que é hasheada), não numa coluna.
   * Testar as versões conhecidas responde a pergunta que de fato importa — "isto
   * mudou?" — sem precisar de migração de dados nem de adivinhação.
   *
   * Devolve a versão que casou, ou `null` quando nenhuma casa (aí mudou mesmo).
   *
   * `frozen` é o snapshot congelado do envelope, e existe por causa do CADASTRO
   * TARDIO do veículo — ver `tolerateLateRegistration`. Opcional porque nem todo
   * chamador tem o snapshot em mãos; sem ele o comportamento é o estrito.
   */
  matchesFrozenTerms(
    snapshot: QuoteSnapshot,
    frozenHash: string,
    frozen?: QuoteSnapshot | null,
    /**
     * Os `Responsible.id` que de fato assinam ESTE envelope.
     *
     * Sem eles, a tolerância de não-signatários não roda e o comportamento é o
     * estrito de sempre — que é o certo para quem não tem o envelope em mãos.
     */
    signingResponsibleIds?: readonly string[] | null,
  ): number | null {
    const reconciled: QuoteSnapshot[] = [];
    if (frozen) {
      const late = this.tolerateLateRegistration(snapshot, frozen);
      reconciled.push(late);
      if (signingResponsibleIds) {
        // As duas tolerâncias são independentes e podem incidir juntas (um
        // implemento 0 km cujo motorista foi trocado na mesma semana), então a
        // combinada entra na lista além de cada uma sozinha.
        reconciled.push(this.tolerateNonSigners(snapshot, frozen, signingResponsibleIds));
        reconciled.push(this.tolerateNonSigners(late, frozen, signingResponsibleIds));
      }
    }
    for (const version of SUPPORTED_MATERIAL_VERSIONS) {
      if (this.materialHash(snapshot, version) === frozenHash) return version;
      // As tolerâncias são os ÚNICOS desvios: qualquer outra diferença no
      // recorte continua derrubando, porque o resto da projeção segue intacto.
      for (const candidate of reconciled) {
        if (this.materialHash(candidate, version) === frozenHash) return version;
      }
    }
    return null;
  }

  /**
   * O snapshot atual com os contatos que NÃO ASSINAM esta coleta devolvidos ao
   * estado congelado.
   *
   * POR QUE PASSOU A SER NECESSÁRIO
   *   Até a assinatura diversificada, todo responsável da tarefa virava
   *   signatário e ganhava uma linha no documento — então mexer no elenco mudava
   *   o documento, e invalidar era exatamente certo. Agora o gestor de frota e o
   *   motorista, por padrão, não assinam: eles não têm linha no documento
   *   congelado, e o documento não muda uma vírgula quando um deles entra, sai ou
   *   corrige o próprio telefone. Manter a regra antiga faria uma coleta viva
   *   morrer — com as assinaturas já colhidas anuladas e um e-mail de "o
   *   orçamento foi alterado" para o cliente — porque a logística cadastrou o
   *   motorista da entrega.
   *
   * O QUE CONTINUA DERRUBANDO
   *   Quem assina. Trocar o telefone ou o e-mail de um signatário muda o destino
   *   do código de uso único, e é material. Tirar um signatário apaga uma linha
   *   de assinatura do documento, e é material.
   *
   *   E o contato NOVO que assinaria por padrão também derruba: acrescentar um
   *   comercial à tarefa no meio da coleta é justamente o caso em que se quer
   *   reemitir, para que ele assine. Só é tolerado quem não assina por padrão E
   *   não foi incluído à mão nesta coleta — os dois juntos, porque a inclusão à
   *   mão é uma decisão do operador que o cadastro sozinho não revela.
   */
  private tolerateNonSigners(
    current: QuoteSnapshot,
    frozen: QuoteSnapshot,
    signingResponsibleIds: readonly string[],
  ): QuoteSnapshot {
    const signing = new Set(signingResponsibleIds);
    const frozenById = new Map(frozen.signers.map(s => [s.responsibleId, s]));
    const currentById = new Map(current.signers.map(s => [s.responsibleId, s]));

    // Quem NÃO assina por padrão, pelas funções que o snapshot registra.
    // Lê-se do snapshot (e não do banco) de propósito: é o que torna o cálculo
    // reproduzível a partir do JSONB congelado, anos depois.
    const signsByDefault = (id: string): boolean => {
      const entry = currentById.get(id) ?? frozenById.get(id);
      return sectionsForRoles(entry?.roles ?? []).length > 0;
    };

    const ids = new Set([...frozenById.keys(), ...currentById.keys()]);
    const signers: QuoteSnapshotSigner[] = [];
    for (const id of ids) {
      const tolerated = !signing.has(id) && !signsByDefault(id);
      const chosen = tolerated ? frozenById.get(id) : currentById.get(id);
      if (chosen) signers.push(chosen);
    }

    return {
      ...current,
      // Mesma ordenação de `build`: a projeção reordena, mas o snapshot é
      // hasheado inteiro em outros caminhos e não pode depender da ordem do Set.
      signers: signers.sort((a, b) => a.responsibleId.localeCompare(b.responsibleId)),
    };
  }

  /**
   * O snapshot atual com os campos de CADASTRO TARDIO do veículo devolvidos ao
   * valor congelado — a pergunta que ele responde é "tirando o que não é
   * alteração material, este envelope mudou?".
   *
   * Existe porque a comparação por hash é simétrica e a regra não é. Duas
   * situações, ambas reais na oficina:
   *
   *  · CHASSI — deixou de ser material na v3, mas todo envelope congelado sob
   *    v1/v2 ainda o carrega dentro do hash, e a v3 nunca reproduz um hash v2.
   *    Sem reinjetar o valor congelado, uma coleta viva morreria ao alguém
   *    preencher o chassi, apesar de o campo não ser mais material.
   *
   *  · PLACA — continua material: trocar uma placa por outra é outro veículo.
   *    Mas implemento 0 km é orçado e assinado sem emplacar, e a placa chega
   *    semanas depois. Preencher o que estava VAZIO não muda a proposta, então
   *    só esse caso é tolerado — se havia placa congelada, ela tem de bater.
   */
  private tolerateLateRegistration(
    current: QuoteSnapshot,
    frozen: QuoteSnapshot,
  ): QuoteSnapshot {
    if (!current.truck) return current;
    const hadPlate = normText(frozen.truck?.plate) !== null;
    return {
      ...current,
      truck: {
        ...current.truck,
        chassisNumber: frozen.truck?.chassisNumber ?? null,
        plate: hadPlate ? current.truck.plate : (frozen.truck?.plate ?? null),
      },
    };
  }

  /** Carrega, monta e hasheia num passo — o caminho usado pela detecção de mudança. */
  async buildForQuote(quoteId: string): Promise<{
    snapshot: QuoteSnapshot;
    hash: string;
    materialHash: string;
    quote: QuoteWithSnapshotGraph;
  } | null> {
    const quote = await this.loadQuoteGraph(quoteId);
    if (!quote) return null;
    const snapshot = this.build(quote);
    return {
      snapshot,
      hash: this.hash(snapshot),
      materialHash: this.materialHash(snapshot),
      quote,
    };
  }

  /**
   * Diferença legível entre dois snapshots, separada por consequência.
   *
   * Antes isto devolvia uma lista plana de rótulos e o chamador invalidava se ela
   * não estivesse vazia — foi assim que "responsáveis" (um typo corrigido) matou
   * uma assinatura. Agora cada mudança sai classificada, e só `material` derruba
   * o envelope.
   *
   * O DETALHE VIVE EM `entries`. As duas listas de string continuam existindo
   * porque a trilha append-only e o e-mail as consomem, mas elas são um RESUMO:
   * "serviços" nunca disse se um item entrou, saiu ou mudou de preço. `entries`
   * traz cada diferença separada, com assunto e antes/depois formatados, e é o
   * que as telas e a página pública renderizam.
   */
  classify(before: QuoteSnapshot, after: QuoteSnapshot): SnapshotChanges {
    const entries = diffQuoteSnapshots(before, after);
    return {
      entries,
      material: entries.filter(c => c.severity === 'MATERIAL').map(describeQuoteChange),
      cosmetic: entries.filter(c => c.severity === 'COSMETIC').map(describeQuoteChange),
    };
  }

  /** Só as diferenças estruturadas — o caminho que as interfaces consomem. */
  changes(before: QuoteSnapshot, after: QuoteSnapshot): QuoteChange[] {
    return diffQuoteSnapshots(before, after);
  }

  /** O motivo em uma frase, a partir das diferenças materiais. */
  describeMaterial(entries: QuoteChange[]): string {
    return describeQuoteChanges(entries.filter(c => c.severity === 'MATERIAL'));
  }
}

export interface SnapshotChanges {
  /**
   * A lista estruturada, material e cosmética juntas e já ordenada para leitura.
   * É esta que as telas renderizam; as duas abaixo são o resumo em texto que a
   * trilha append-only e o e-mail consomem.
   */
  entries: QuoteChange[];
  /** Muda a proposta ⇒ invalida o envelope. */
  material: string[];
  /** Aparece no documento congelado, mas não muda a proposta ⇒ só registra. */
  cosmetic: string[];
}
