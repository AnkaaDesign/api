/**
 * Exclusão de orçamentos que carregam envelope de assinatura.
 *
 * ---------------------------------------------------------------------------
 * O PROBLEMA
 * ---------------------------------------------------------------------------
 * `SignatureAuditEvent` é append-only por trigger (migration
 * `20260726150000_budget_signature_envelope`). O `onDelete: Cascade` de
 * `TaskQuote → SignatureEnvelope → SignatureAuditEvent` faz o Postgres emitir um
 * DELETE naquela tabela, o trigger levanta `restrict_violation` e a exclusão do
 * orçamento morre em 500 — sem mensagem útil, e com a transação inteira abortada.
 *
 * A migration prevê exatamente uma válvula para isso:
 *
 *     SET LOCAL ankaa.allow_signature_audit_delete = 'on'
 *
 * `SET LOCAL`, e não `SET`: o valor vive só até o COMMIT/ROLLBACK daquela
 * transação. Não existe caminho em que a válvula "vaze" para a próxima consulta
 * da mesma conexão do pool, nem em que um erro no meio do caminho deixe o banco
 * destravado — é o próprio fim da transação que fecha a torneira. É por isso que
 * não há `try/finally` aqui: seria mais fraco, não mais forte.
 *
 * ---------------------------------------------------------------------------
 * A POLÍTICA — e por que ela cancela em vez de apagar
 * ---------------------------------------------------------------------------
 * Apagar um orçamento assinado destrói prova. Sob o **CPC art. 429, II**, se o
 * cliente impugnar a autenticidade da assinatura, o ônus da prova é da Ankaa: o
 * que sustenta a defesa é justamente o conjunto `final.pdf` + trilha encadeada +
 * evidência do signatário. Um DELETE apaga os três de uma vez, em silêncio, a
 * partir de um clique numa listagem.
 *
 * Então a regra, na fronteira que a migration declara (linhas 266-269):
 *
 *   PROTEGIDO quando →  algum envelope está `COMPLETED`  (documento selado, com
 *                       PAdES e hash publicados no portal de verificação)
 *                  ou →  algum signatário chegou a `SIGNED` (ato de uma pessoa
 *                       real, autenticado por OTP, com IP e timestamp)
 *
 *   APAGÁVEL quando  →  todo o resto: DRAFT, RUNNING sem nenhuma assinatura
 *                       colhida, REFUSED, EXPIRED, CANCELLED, INVALIDATED,
 *                       SUPERSEDED.
 *
 * A assimetria é deliberada. Um envelope `RUNNING` sem assinatura é uma
 * cerimônia que ninguém atendeu — não há ato de vontade a preservar. Um
 * envelope `REFUSED` também não vincula ninguém: a recusa está registrada no
 * changelog do orçamento, e o orçamento recusado é exatamente o que o
 * comercial quer poder apagar.
 *
 * Um alvo PROTEGIDO não é excluído nem a exclusão é recusada com erro: o fluxo
 * de exclusão **degrada para cancelamento automático** (tarefa/orçamento viram
 * CANCELLED via `cancelForTaskCancellation`, cerimônias RUNNING são
 * canceladas), preservando envelope, trilha e PDFs. `findProtectedQuoteIds` /
 * `findProtectedTaskIds` são a consulta dessa fronteira. Se um dia surgir uma
 * obrigação legal de eliminação (LGPD art. 18, VI), ela é um procedimento
 * auditado e explícito, não um efeito colateral de um botão de lixeira.
 *
 * ---------------------------------------------------------------------------
 * ORDEM DA LIMPEZA
 * ---------------------------------------------------------------------------
 * A purga é feita ANTES do delete do alvo. Assim, quando o `taskQuote.delete()`
 * roda, não sobrou nenhuma linha de auditoria para o cascade tocar — o trigger
 * nem chega a ser acionado, e a válvula já voltou para 'off' dentro da mesma
 * transação.
 *
 * Os bytes congelados (`original.pdf` / `final.pdf`) NÃO são apagados aqui: um
 * `unlink` não faz rollback. Se a transação falhasse depois, o envelope
 * continuaria no banco apontando para um arquivo inexistente — que é exatamente
 * o estado quebrado (ENOENT permanente nas duas rotas de PDF) encontrado nos
 * envelopes de teste dos orçamentos #580-582. As linhas `File` são removidas na
 * transação, e o caminho físico é devolvido para o chamador apagar DEPOIS do
 * commit, em melhor esforço.
 */

import { Injectable, Logger } from '@nestjs/common';
import { unlink } from 'fs/promises';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type { PrismaTransaction } from '@modules/common/base/base.repository';

/** Nome do setting de sessão criado pela migration do envelope. */
export const SIGNATURE_AUDIT_DELETE_FLAG = 'ankaa.allow_signature_audit_delete';

const FLAG_ON = `SET LOCAL ${SIGNATURE_AUDIT_DELETE_FLAG} = 'on'`;
const FLAG_OFF = `SET LOCAL ${SIGNATURE_AUDIT_DELETE_FLAG} = 'off'`;

/** Resultado da purga: o que sair daqui ainda precisa ser apagado do disco. */
export interface SignaturePurgeResult {
  envelopesRemoved: number;
  auditEventsRemoved: number;
  /** Caminhos absolutos dos PDFs congelados. Apague só APÓS o commit. */
  frozenDocumentPaths: string[];
}

const EMPTY_PURGE: SignaturePurgeResult = {
  envelopesRemoved: 0,
  auditEventsRemoved: 0,
  frozenDocumentPaths: [],
};

/** Aceita tanto o cliente normal quanto o de transação. */
type PrismaLike = PrismaTransaction;

@Injectable()
export class SignatureDeletionService {
  private readonly logger = new Logger(SignatureDeletionService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ===========================================================================
  // FRONTEIRA DE PROTEÇÃO
  // ===========================================================================

  /**
   * IDs dos orçamentos (dentre os informados) protegidos por assinatura já
   * colhida ou envelope selado. Os fluxos de exclusão usam isto para DEGRADAR
   * para cancelamento automático — o registro assinado é preservado e o
   * orçamento vira CANCELLED — em vez de recusar a operação com erro.
   */
  async findProtectedQuoteIds(
    quoteIds: string[],
    client: PrismaLike = this.prisma,
  ): Promise<string[]> {
    if (!quoteIds.length) return [];
    const envelopes = await client.signatureEnvelope.findMany({
      where: {
        quoteId: { in: quoteIds },
        OR: [{ status: 'COMPLETED' }, { signers: { some: { status: 'SIGNED' } } }],
      },
      select: { quoteId: true },
    });
    return [...new Set(envelopes.map(e => e.quoteId).filter((id): id is string => Boolean(id)))];
  }

  /** Mesma consulta, partindo das tarefas: devolve os IDs de tarefa protegidos. */
  async findProtectedTaskIds(
    taskIds: string[],
    client: PrismaLike = this.prisma,
  ): Promise<string[]> {
    if (!taskIds.length) return [];
    const envelopes = await client.signatureEnvelope.findMany({
      where: {
        quote: { task: { id: { in: taskIds } } },
        OR: [{ status: 'COMPLETED' }, { signers: { some: { status: 'SIGNED' } } }],
      },
      select: { quote: { select: { task: { select: { id: true } } } } },
    });
    return [
      ...new Set(
        envelopes
          .map(e => e.quote?.task?.id)
          .filter((id): id is string => Boolean(id))
          .filter(id => taskIds.includes(id)),
      ),
    ];
  }

  // ===========================================================================
  // PURGA
  // ===========================================================================

  /** Purga os envelopes dos orçamentos indicados. Deve rodar DENTRO da transação. */
  async purgeForQuotes(tx: PrismaTransaction, quoteIds: string[]): Promise<SignaturePurgeResult> {
    if (!quoteIds.length) return EMPTY_PURGE;
    return this.purge(tx, { quoteId: { in: quoteIds } });
  }

  /** Purga os envelopes dos orçamentos ligados às tarefas indicadas. */
  async purgeForTasks(tx: PrismaTransaction, taskIds: string[]): Promise<SignaturePurgeResult> {
    if (!taskIds.length) return EMPTY_PURGE;
    return this.purge(tx, { quote: { task: { id: { in: taskIds } } } });
  }

  /** Purga envelopes por id — usado pela limpeza operacional de envelopes órfãos. */
  async purgeEnvelopes(
    tx: PrismaTransaction,
    envelopeIds: string[],
  ): Promise<SignaturePurgeResult> {
    if (!envelopeIds.length) return EMPTY_PURGE;
    return this.purge(tx, { id: { in: envelopeIds } });
  }

  private async purge(
    tx: PrismaTransaction,
    where: Record<string, unknown>,
  ): Promise<SignaturePurgeResult> {
    const envelopes = await tx.signatureEnvelope.findMany({
      where,
      select: {
        id: true,
        status: true,
        verificationCode: true,
        originalFileId: true,
        finalFileId: true,
        originalFile: { select: { id: true, path: true } },
        finalFile: { select: { id: true, path: true } },
        // Os RECORTES congelados. Cada um tem `File` próprio, com a mesma FK
        // RESTRICT do envelope — sem apagá-los aqui, a purga de uma coleta
        // diversificada quebraria no `file.deleteMany` com violação de chave
        // estrangeira, e o orçamento voltaria a ser inapagável.
        documents: {
          select: {
            id: true,
            originalFileId: true,
            finalFileId: true,
            originalFile: { select: { id: true, path: true } },
            finalFile: { select: { id: true, path: true } },
          },
        },
      },
    });
    if (!envelopes.length) return EMPTY_PURGE;

    const envelopeIds = envelopes.map(e => e.id);

    // Válvula ABERTA. Vale só até o fim desta transação — não há como esquecê-la
    // aberta, e um erro abaixo aborta a transação (que a descarta de qualquer
    // forma). Por isso o reset é feito só no caminho de sucesso: numa transação
    // já abortada, qualquer statement extra falharia e mascararia o erro real.
    await tx.$executeRawUnsafe(FLAG_ON);

    const audit = await tx.signatureAuditEvent.deleteMany({
      where: { envelopeId: { in: envelopeIds } },
    });
    // Filhos explícitos antes do pai: o cascade faria o mesmo, mas explicitar
    // mantém a ordem previsível e permite contar o que saiu.
    await tx.signingChallenge.deleteMany({
      where: { signer: { envelopeId: { in: envelopeIds } } },
    });
    await tx.envelopeSigner.deleteMany({ where: { envelopeId: { in: envelopeIds } } });
    // Depois dos signatários (que apontam para o documento) e antes do envelope.
    await tx.envelopeDocument.deleteMany({ where: { envelopeId: { in: envelopeIds } } });
    // `previousEnvelopeId` é auto-referência com onDelete: SetNull, então apagar
    // v1 e v2 no mesmo deleteMany é seguro em qualquer ordem.
    await tx.signatureEnvelope.deleteMany({ where: { id: { in: envelopeIds } } });

    // Linhas `File` do PDF congelado: só podem sair DEPOIS do envelope, porque a
    // FK `originalFileId` é RESTRICT (é o que impede perder os bytes de um
    // envelope vivo).
    // `Set`: o recorte completo compartilha o `File` com as colunas espelhadas do
    // envelope, então o mesmo id aparece duas vezes. `deleteMany` não se importa,
    // mas a contagem e o log ficariam mentindo.
    const fileIds = [
      ...new Set(
        [
          ...envelopes.map(e => e.originalFileId),
          ...envelopes.map(e => e.finalFileId),
          ...envelopes.flatMap(e => e.documents.map(d => d.originalFileId)),
          ...envelopes.flatMap(e => e.documents.map(d => d.finalFileId)),
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
    if (fileIds.length) {
      await tx.file.deleteMany({ where: { id: { in: fileIds } } });
    }

    await tx.$executeRawUnsafe(FLAG_OFF);

    const frozenDocumentPaths = [
      ...new Set(
        envelopes
          .flatMap(e => [
            e.originalFile?.path,
            e.finalFile?.path,
            ...e.documents.flatMap(d => [d.originalFile?.path, d.finalFile?.path]),
          ])
          .filter((p): p is string => Boolean(p)),
      ),
    ];

    this.logger.log(
      `Purgados ${envelopes.length} envelope(s) [${envelopes
        .map(e => `${e.verificationCode}:${e.status}`)
        .join(', ')}] e ${audit.count} evento(s) de auditoria.`,
    );

    return {
      envelopesRemoved: envelopes.length,
      auditEventsRemoved: audit.count,
      frozenDocumentPaths,
    };
  }

  // ===========================================================================
  // DISCO
  // ===========================================================================

  /**
   * Apaga os PDFs congelados do disco. Chame APÓS o commit — nunca dentro da
   * transação: `unlink` não faz rollback, e um rollback posterior deixaria o
   * envelope vivo apontando para um arquivo inexistente.
   */
  async unlinkFrozenDocuments(paths: string[]): Promise<void> {
    for (const path of paths) {
      try {
        await unlink(path);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        // ENOENT é normal: o registro pode ter sobrevivido ao arquivo.
        if (code !== 'ENOENT') {
          this.logger.warn(`Não foi possível remover ${path}: ${code ?? error}`);
        }
      }
    }
  }
}
