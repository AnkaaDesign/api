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
// `normText` mora em `quote-diff` para que aquele módulo não precise importar
// nada de runtime daqui — o import de lá para cá é só de tipos, e é isso que
// mantém o ciclo entre os dois arquivos inofensivo.
import { sortQuoteTasks } from '@utils/quote-tasks';
import {
  snapshotVehicles,
  describeQuoteChange,
  describeQuoteChanges,
  diffQuoteSnapshots,
  normText,
  type QuoteChange,
  type QuoteDiffOptions,
} from './quote-diff';

/** Deduplica por `id` preservando a primeira ocorrência. */
function dedupeById<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

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

/** Um veículo do orçamento, como o documento o identifica. */
export interface QuoteSnapshotVehicle {
  /** `Task.id` — a chave estável que pareia o congelado com o atual. */
  taskId: string;
  taskName: string | null;
  serialNumber: string | null;
  plate: string | null;
  chassisNumber: string | null;
  category: string | null;
  implementType: string | null;
}

/**
 * Os veículos de um snapshot — reexportado.
 *
 * A IMPLEMENTAÇÃO mora em `quote-diff` pelo mesmo motivo que `normText`: aquele
 * módulo precisa dela e não pode importar nada de RUNTIME daqui (este importa
 * `diffQuoteSnapshots` de lá, e o ciclo em runtime derrubaria o módulo). O
 * import de lá para cá é só de tipos, e é isso que mantém o ciclo inofensivo.
 */
export { snapshotVehicles } from './quote-diff';

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
  /**
   * OS VEÍCULOS, na ordem em que o documento os lista — um por tarefa.
   *
   * Substituiu `task` + `truck` singulares na v3 do snapshot, quando um
   * orçamento passou a poder cobrir sessenta caminhões. Os dois campos antigos
   * continuam DECLARADOS abaixo porque todo envelope congelado antes disso os
   * tem gravados no JSONB, e reler coleta de meses atrás é rotina (o portal de
   * verificação faz isso). Quem consome deve ir por `snapshotVehicles()`, que
   * responde nas duas formas.
   */
  vehicles: QuoteSnapshotVehicle[];
  /**
   * Junto ou separado. Entra no snapshot porque APARECE no documento — a frase
   * das parcelas diz "para cada um dos 60 veículos" ou não diz — e é material:
   * um plano único de R$ 730.224,00 e sessenta planos de R$ 12.170,40 são
   * obrigações diferentes para quem assina.
   */
  billingSplit: string;
  /** @deprecated Forma v1/v2. Só existe em snapshots congelados antes da v3. */
  task?: {
    id: string;
    name: string | null;
    serialNumber: string | null;
  } | null;
  /** @deprecated Forma v1/v2. Só existe em snapshots congelados antes da v3. */
  truck?: {
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

/**
 * v3 (2026-09-03): `task`/`truck` singulares deram lugar a `vehicles[]`, e
 * `billingSplit` entrou — o orçamento passou a poder cobrir N veículos.
 */
export const QUOTE_SNAPSHOT_SCHEMA_VERSION = 3;

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
/**
 * v5 (2026-09-03): o recorte material passou a levar a LISTA de veículos e o
 * `billingSplit`, porque um orçamento passou a poder cobrir sessenta caminhões.
 *
 * Acrescentar um veículo à lista muda o total e muda o objeto do contrato;
 * trocar `JOINT` por `PER_TASK` troca um plano de quatro parcelas de
 * R$ 182.556,00 por sessenta planos de quatro parcelas de R$ 3.042,60. As duas
 * coisas são exatamente o que o art. 431 chama de proposta nova.
 *
 * As versões 1–4 continuam sendo emitidas com `truck` no SINGULAR, tirado do
 * primeiro veículo — e como todo envelope congelado sob elas pertence a um
 * orçamento de uma tarefa só, a reprodução é byte a byte a de antes. É isso que
 * permite reconhecer um envelope NÃO alterado depois desta mudança de recorte.
 */
export const QUOTE_MATERIAL_SCHEMA_VERSION = 5;

/** Versões de recorte material que ainda sabemos recalcular. Ordem: mais nova primeiro. */
export const SUPPORTED_MATERIAL_VERSIONS = [5, 4, 3, 2, 1] as const;

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
   *
   * Só é emitido até a v4. Na v5 quem responde é `vehicles`, e esta chave
   * desaparece — mesmo mecanismo, mesma razão.
   */
  truck?: { plate: string | null; chassisNumber?: string | null } | null;
  /**
   * A LISTA de placas, na ordem do documento — emitida só na v5.
   *
   * A ordem entra no recorte de propósito: ela é a ordem em que a tabela de
   * identificação lista os veículos, e é o que faz "acrescentei o caminhão 61"
   * sair do diff como UM veículo novo no fim, em vez de sessenta e uma linhas
   * deslocadas.
   */
  vehicles?: Array<{ plate: string | null }>;
  /** Junto ou separado — emitido só na v5. Ver `QuoteSnapshot.billingSplit`. */
  billingSplit?: string;
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
  tasks: {
    // A MESMA ordem canônica de `QUOTE_TASKS_ORDER_BY`, escrita aqui porque este
    // objeto tem de satisfazer `Prisma.TaskQuoteInclude` literalmente. A ordem
    // dos veículos entra no documento assinado E no hash do snapshot: deixá-la
    // para o plano do Postgres faria o mesmo orçamento hashear diferente entre
    // duas leituras.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
    const tasks = sortQuoteTasks(quote.tasks ?? []);
    // A tarefa ÂNCORA só responde por cliente: o cadastro do tomador é do
    // orçamento, não do veículo, e num orçamento de sessenta caminhões os
    // sessenta são do mesmo cliente por construção (a tela de criação parte de um
    // cliente só). Tudo o mais que era `task.*` virou lista.
    const anchor = tasks[0] ?? null;
    const customer = anchor?.customer ?? null;
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
      vehicles: tasks.map(t => ({
        taskId: t.id,
        taskName: t.name ?? null,
        serialNumber: t.serialNumber ?? null,
        plate: t.truck?.plate ?? null,
        chassisNumber: t.truck?.chassisNumber ?? null,
        category: t.truck?.category ?? null,
        implementType: t.truck?.implementType ?? null,
      })),
      billingSplit: (quote as any).billingSplit ?? 'JOINT',
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
      //
      // UNIÃO das tarefas, deduplicada por `Responsible.id`. Na prática as
      // sessenta tarefas de um orçamento carregam o mesmo elenco — a tela de
      // criação replica os contatos da primeira nas demais —, mas nada no banco
      // obriga: um contato acrescentado depois a UMA das tarefas passaria a
      // constar do documento, e ler só a primeira o esconderia do recorte
      // material justamente no campo que existe para pegá-lo.
      signers: dedupeById(tasks.flatMap(t => t.responsibles ?? []))
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
      // O OBJETO DO CONTRATO, na versão pedida.
      //
      // v5 emite a LISTA e o modo de faturamento; v1–v4 emitem `truck` no
      // singular a partir do PRIMEIRO veículo — e como todo envelope congelado
      // sob elas pertence a um orçamento de uma tarefa só, "o primeiro" é "o
      // único" e o hash sai byte a byte igual ao de antes desta feature. Emitir
      // a chave da outra versão quebraria essa reprodutibilidade, que é
      // justamente o que permite reconhecer um envelope NÃO alterado.
      ...(version >= 5
        ? {
            vehicles: snapshotVehicles(s).map(v => ({ plate: normText(v.plate) })),
            billingSplit: s.billingSplit ?? 'JOINT',
          }
        : (() => {
            const first = snapshotVehicles(s)[0] ?? null;
            return {
              truck: first
                ? {
                    plate: normText(first.plate),
                    ...(version >= 3 ? {} : { chassisNumber: normText(first.chassisNumber) }),
                  }
                : null,
            };
          })()),
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
     * Os `Responsible.id` dos signatários deste envelope que AINDA NÃO
     * ASSINARAM.
     *
     * Sem eles a tolerância de elenco não roda e o comportamento é o estrito de
     * sempre — que é o certo para quem não tem o envelope em mãos.
     */
    pendingSignerIds?: readonly string[] | null,
  ): number | null {
    const reconciled: QuoteSnapshot[] = [];
    if (frozen) {
      const late = this.tolerateLateRegistration(snapshot, frozen);
      reconciled.push(late);
      if (pendingSignerIds) {
        // As duas tolerâncias são independentes e podem incidir juntas (um
        // implemento 0 km cujo motorista foi trocado na mesma semana), então a
        // combinada entra na lista além de cada uma sozinha.
        reconciled.push(this.tolerateSettledRoster(snapshot, frozen, pendingSignerIds));
        reconciled.push(this.tolerateSettledRoster(late, frozen, pendingSignerIds));
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
   * O snapshot atual com todo o elenco JÁ RESOLVIDO devolvido ao estado
   * congelado — sobra apenas quem tem assinatura pendente.
   *
   * A PERGUNTA QUE ESTA FUNÇÃO RESPONDE
   *   "Esta mexida no elenco pode estragar uma assinatura que ainda não foi
   *   colhida?" Só o que responde SIM derruba a coleta. Tudo o mais é registro.
   *
   *   · tirar da tarefa quem ainda tem linha em branco deixa o envelope sem como
   *     concluir — derruba;
   *   · trocar o e-mail de quem ainda vai assinar mexe no canal do ato — derruba;
   *   · tirar quem JÁ assinou não deixa buraco nenhum: o ato está colhido e o
   *     documento é imutável — não derruba;
   *   · ACRESCENTAR alguém nunca derruba. O documento foi congelado sem esse
   *     contato, ele não tem linha de assinatura nele, e nenhuma alteração de
   *     cadastro pode lhe dar uma. Quem precisa que ele assine reemite a coleta.
   *
   * O QUE ISTO CONSERTOU
   *   Até a assinatura diversificada, todo responsável da tarefa virava
   *   signatário, então mexer no elenco de fato mudava o documento. Com o
   *   recorte isso deixou de ser verdade, e a regra antiga anulava as
   *   assinaturas JÁ COLHIDAS de todo mundo porque alguém acrescentou um contato
   *   à tarefa — inclusive num envelope já selado, onde não havia sequer o que
   *   anular, e a tela apenas alarmava.
   */
  private tolerateSettledRoster(
    current: QuoteSnapshot,
    frozen: QuoteSnapshot,
    pendingSignerIds: readonly string[],
  ): QuoteSnapshot {
    const pending = new Set(pendingSignerIds);
    const frozenById = new Map(frozen.signers.map(s => [s.responsibleId, s]));
    const currentById = new Map(current.signers.map(s => [s.responsibleId, s]));

    const ids = new Set([...frozenById.keys(), ...currentById.keys()]);
    const signers: QuoteSnapshotSigner[] = [];
    for (const id of ids) {
      const chosen = pending.has(id) ? currentById.get(id) : frozenById.get(id);
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
    const currentVehicles = snapshotVehicles(current);
    if (currentVehicles.length === 0) return current;
    const frozenVehicles = snapshotVehicles(frozen);

    // PAREADO POR `taskId`, nunca por posição.
    //
    // Com um veículo os dois critérios coincidiam. Com sessenta, não: excluir o
    // caminhão 12 desloca os quarenta e oito seguintes, e a comparação por
    // posição passaria a confrontar a placa do 13 com a congelada do 12 — o que
    // leria como "a placa mudou" em quarenta e oito veículos que ninguém tocou,
    // e ao mesmo tempo deixaria de ver a exclusão, que é a mudança real.
    //
    // `taskId` é imutável e existe nos dois lados (nos snapshots v1/v2 ele vem de
    // `task.id`, pelo normalizador). Veículo sem par no congelado é veículo NOVO:
    // nada a tolerar nele, e o hash divergir é exatamente o que se quer.
    const frozenByTask = new Map(frozenVehicles.map(v => [v.taskId, v]));

    return {
      ...current,
      vehicles: currentVehicles.map(v => {
        const was = frozenByTask.get(v.taskId);
        if (!was) return v;
        const hadPlate = normText(was.plate) !== null;
        return {
          ...v,
          chassisNumber: was.chassisNumber ?? null,
          plate: hadPlate ? v.plate : (was.plate ?? null),
        };
      }),
      // Um snapshot v1/v2 tolerado tem de continuar reproduzindo o hash v1–v4, e
      // a projeção daquelas versões lê o PRIMEIRO veículo. Como ela passa por
      // `snapshotVehicles`, que prefere `vehicles` quando existe, as duas formas
      // já convergem — mas as chaves antigas ficam no objeto e seriam hasheadas
      // no caminho do snapshot COMPLETO (`hash()`), que cobre tudo. Zerá-las
      // aqui manteria a divergência; reescrevê-las a partir do veículo tolerado é
      // o que faz as duas projeções contarem a mesma história.
      ...(current.truck
        ? {
            truck: (() => {
              const v = currentVehicles[0];
              const was = v ? frozenByTask.get(v.taskId) : null;
              if (!v || !was) return current.truck;
              const hadPlate = normText(was.plate) !== null;
              return {
                ...current.truck,
                chassisNumber: was.chassisNumber ?? null,
                plate: hadPlate ? v.plate : (was.plate ?? null),
              };
            })(),
          }
        : {}),
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
  classify(
    before: QuoteSnapshot,
    after: QuoteSnapshot,
    options: QuoteDiffOptions = {},
  ): SnapshotChanges {
    const entries = diffQuoteSnapshots(before, after, options);
    return {
      entries,
      material: entries.filter(c => c.severity === 'MATERIAL').map(describeQuoteChange),
      cosmetic: entries.filter(c => c.severity === 'COSMETIC').map(describeQuoteChange),
    };
  }

  /** Só as diferenças estruturadas — o caminho que as interfaces consomem. */
  changes(
    before: QuoteSnapshot,
    after: QuoteSnapshot,
    options: QuoteDiffOptions = {},
  ): QuoteChange[] {
    return diffQuoteSnapshots(before, after, options);
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
