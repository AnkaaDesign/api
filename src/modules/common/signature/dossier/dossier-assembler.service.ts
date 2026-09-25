/**
 * Dossiê do orçamento — orçamento assinado + notas fiscais + boletos num PDF só.
 *
 * ORDEM DAS DECISÕES, porque elas não são intercambiáveis:
 *
 * 1. **O documento assinado NÃO é remontado.** Uma assinatura PDF cobre os bytes
 *    do arquivo; o pdf-lib reescreve o arquivo inteiro no `save()`, de modo que
 *    *qualquer* merge feito com ele destrói o selo A1 — não é questão de
 *    cuidado, é garantido. Por isso os bytes assinados entram aqui como ANEXO
 *    (`/EmbeddedFiles`), idênticos ao original, e continuam validando sozinhos.
 *
 *    Com a assinatura diversificada são VÁRIOS anexos: a coleta congela um PDF
 *    por recorte, cada um com o seu selo, e todos eles são o instrumento. Anexar
 *    só o completo esconderia justamente a prova de que o financeiro assinou —
 *    porque o que ele assinou foi o PDF sem o layout, e é esse que carrega o
 *    selo dele.
 *
 * 2. **Boleto e NFS-e NÃO recebem o selo da Ankaa.** Selar documento de terceiro
 *    com o nosso certificado afirmaria algo que não é verdade: o A1 atesta que a
 *    Ankaa emitiu aquele documento. Boleto se valida pelo código de barras e
 *    NFS-e pelo portal da prefeitura e pelo XML — nunca pela assinatura do PDF.
 *    Logo o dossiê inteiro NÃO é selado: ele é um invólucro de transmissão, e o
 *    instrumento jurídico é o anexo do item 1.
 *
 * 3. **O documento assinado VIRA PÁGINA, e a cópia legível continua ao lado
 *    dele.** Um anexo não é exibido ao abrir o PDF na maioria dos visualizadores
 *    — menos ainda no celular, que é onde o cliente abre o que chega por
 *    WhatsApp. Um dossiê em que o orçamento assinado só existe como anexo é, na
 *    prática, um dossiê que não mostra a assinatura: foi o que se viu no
 *    orçamento nº 0984, cuja página do layout exibia três traços em branco para
 *    assinar à mão num documento que já tinha sido assinado eletronicamente.
 *
 *    São DUAS peças, e nenhuma substitui a outra:
 *
 *    · O CORPO DO ARTEFATO SELADO, copiado página a página — um por recorte, o
 *      completo primeiro. Copiar todos resolve a objeção que antes impedia
 *      copiar qualquer um: escolher um recorte para representar o orçamento
 *      exibiria o que aquele signatário viu no lugar do documento. A cópia
 *      perde o A1 (é uma cópia), e é por isso que o anexo do item 1 continua
 *      existindo.
 *
 *      O CORPO, e não o artefato inteiro: a trilha que o `finalize` fundiu ao
 *      recorte fica FORA das páginas do dossiê. Ela não some — segue dentro do
 *      anexo selado, sob o mesmo PAdES, que é onde ela é prova —, e o item 4
 *      explica por que a versão consolidada do fim é a que se lê.
 *
 *    · A CÓPIA LEGÍVEL renderizada agora, que é a única que imprime as PARCELAS
 *      emitidas e a chave Pix — o documento foi congelado antes de existir
 *      cobrança, e nunca as teve. Quando o assinado vai junto, ela sai SEM as
 *      linhas de assinatura em branco (`hideSignatureBlock`): colher à caneta um
 *      ato já praticado não é redundância, é sugerir que a coleta não valeu.
 *      Sem envelope selado, o bloco continua ali — é o ponto do documento.
 *
 *    Elas não podem divergir no que é material: qualquer alteração material do
 *    orçamento INVALIDA a coleta e obriga a recolher as assinaturas. O que sobra
 *    são correções cosméticas, que só a cópia legível reflete.
 *
 * 4. **Sem capa, COM trilha de auditoria.** O que o cliente recebe é orçamento,
 *    fotos, nota e boleto — nada de sumário administrativo. Mas a trilha deixou
 *    de ser tratada como peça exclusiva de disputa judicial: quem recebe o
 *    dossiê de um orçamento assinado é PARTE da cerimônia, e a pergunta que ele
 *    faz ao abrir o PDF — quem assinou, quando, autenticado como — não pode
 *    exigir extrair um anexo e abri-lo noutro programa.
 *
 *    Ela existe em dois lugares, e cada um tem função:
 *
 *    · CONGELADA dentro de cada artefato selado (o `finalize` funde as páginas
 *      de trilha ao documento antes do PAdES). É prova: não se toca. Fica no
 *      ANEXO, e só nele — as páginas do dossiê copiam o corpo do recorte e
 *      param onde a trilha começa (ver a decisão 3 e `bodyPageCount`).
 *    · CONSOLIDADA no fim do dossiê, montada agora — um bloco por recorte, com o
 *      hash do arquivo SELADO e as partes daquele documento, mais o log
 *      encadeado do envelope inteiro. É o índice que a congelada não pode ser,
 *      porque ela é anterior ao próprio hash final e se repete N vezes num
 *      envelope de N recortes.
 *
 *    Copiar a congelada TAMBÉM para o corpo era imprimir o mesmo log encadeado
 *    N+1 vezes. No dossiê do orçamento nº 0984, 31 eventos saíram três vezes em
 *    quatro folhas, com hashes idênticos. Redundância desse tamanho não reforça
 *    a prova — ela esconde a peça que alguém deveria ler.
 *
 *    O manifesto de componentes continua sendo calculado e voltando na resposta
 *    HTTP, sem virar página.
 *
 * 5. **Ordem: orçamento, dossiê fotográfico, boletos, notas, trilha.** É a ordem da
 *    conversa com o cliente — o que foi combinado, o que foi feito, como pagar e,
 *    por último, o documento fiscal que fica para a contabilidade dele. A trilha
 *    fecha o maço como anexo: ela não se interpõe entre o cliente e o boleto.
 *
 *    O boleto vem ANTES da nota porque é a única página do dossiê sobre a qual o
 *    cliente precisa AGIR, e num PDF longo o que se procura primeiro tem de estar
 *    mais perto do começo. A nota é comprovação, não instrução. É também a ordem
 *    que a página pública do dossiê (`/cliente/dossie/:id`) sempre teve — o PDF é
 *    que divergia dela, e o cliente que lia a página e depois baixava o PDF
 *    encontrava outra sequência.
 *
 * 6. **Sem envelope concluído, o dossiê existe assim mesmo.** O orçamento é
 *    renderizado sob demanda, com as linhas de assinatura em branco, e o
 *    componente é rotulado "SEM assinatura eletrônica". Recusar nesse caso
 *    deixaria sem documento justamente as tarefas antigas — que nunca passaram
 *    pela assinatura e são a maioria hoje. Nesse modo não há anexo: não existe
 *    artefato assinado para preservar.
 *
 * 7. **Faturamento com mais de um cliente: `customerId` recorta o dossiê.**
 *    Entram só a NFS-e e o boleto da fatura DAQUELE cliente — mandar ao cliente
 *    A a nota e o título de cobrança do cliente B é vazar documento fiscal
 *    alheio. E o ORÇAMENTO também é recortado (serviços, subtotal, desconto,
 *    total e condição de pagamento daquela configuração), porém SOMENTE no
 *    caminho não assinado, onde o documento é montado agora a partir dos dados.
 *
 *    O corpo legível é sempre renderizado, então o recorte por cliente vale
 *    para ele em qualquer caso. Os ANEXOS continuam saindo inteiros: um PDF
 *    assinado não se recorta — remover uma página quebra o A1 —, e o que foi
 *    assinado é o instrumento com o escopo inteiro.
 *
 *    E é exatamente por isso que as PÁGINAS do assinado ficam de fora quando o
 *    recorte por cliente está em vigor num faturamento com mais de um pagador:
 *    exibir o instrumento inteiro na fatia do cliente A mostraria a ele os
 *    serviços, o total e a condição de pagamento do cliente B. Ali o corpo
 *    segmentado MANTÉM as linhas de assinatura, porque nenhuma outra prova da
 *    coleta acompanha aquele PDF.
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { PDFDocument, PDFName, PDFDict, PDFArray, StandardFonts, rgb } from 'pdf-lib';
import PDFKitDocument from 'pdfkit';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { COMPANY, BRAND_COLORS } from '@/config/company';
import { winAnsi } from '../document/quote-assembler.service';
import { canonicalSections, describeSections, variantFilenameSuffix } from '../quote-sections';
import { dossierPdfFilename } from '../document/document-filename';
import { formatDateBR, formatDateTimeBR } from '../document/quote-text';
import { maskCpf, maskEmail, maskPhone } from '../utils/identity';
import { AUTH_METHOD_LABELS, EVENT_DESCRIPTIONS } from '../signature.constants';
import { SignatureEnvelopeService } from '../services/signature-envelope.service';
import { ElotechOxyNfseService } from '@modules/integrations/nfse/elotech-oxy-nfse.service';
import { SicrediService } from '@modules/integrations/sicredi/sicredi.service';

/**
 * Altura do carimbo de paginação do dossiê, em pontos, medida da borda inferior.
 *
 * ACIMA da faixa de verificação que o documento assinado traz a 12pt (corpo 6),
 * e não sobre ela. Ver `stampDossierPages` para o histórico — este número já
 * custou duas rodadas de rodapé ilegível.
 */
const DOSSIER_STAMP_Y = 24;

/** Como cada componente se chama no pé da folha — curto, porque divide a linha. */
const DOSSIER_KIND_LABEL: Record<string, string> = {
  ORCAMENTO: 'Orçamento',
  ORCAMENTO_ASSINADO: 'Orçamento assinado',
  FOTOS: 'Dossiê fotográfico',
  ADITIVO: 'Aditivo de identificação',
  BOLETO: 'Boleto',
  NFSE: 'NFS-e',
  TRILHA: 'Trilha de auditoria',
};

export type DossierComponentKind =
  | 'ORCAMENTO'
  | 'ORCAMENTO_ASSINADO'
  | 'ADITIVO'
  | 'FOTOS'
  | 'NFSE'
  | 'BOLETO'
  | 'TRILHA';

/**
 * O que a trilha do dossiê lê de cada signatário.
 *
 * Um só objeto para os dois lugares que o consultam (o recorte e o recuo pelo
 * envelope): divergir as duas listas faria a trilha de um envelope antigo
 * imprimir menos do que a de um novo, em silêncio.
 */
const DOSSIER_SIGNER_SELECT = {
  declaredName: true,
  declaredCpf: true,
  declaredEmail: true,
  declaredPhone: true,
  informedCpf: true,
  informedCargo: true,
  orderGroup: true,
  status: true,
  authMethod: true,
  signedAt: true,
  refusedAt: true,
  refusalReason: true,
  ipAddress: true,
  userAgent: true,
} as const;

/** O signatário como a trilha do dossiê precisa dele. */
interface DossierSignerRow {
  declaredName: string;
  declaredCpf: string | null;
  declaredEmail: string | null;
  declaredPhone: string | null;
  informedCpf: string | null;
  informedCargo: string | null;
  orderGroup: number;
  status: string;
  authMethod: string;
  signedAt: Date | null;
  refusedAt: Date | null;
  refusalReason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Um recorte SELADO, já normalizado.
 *
 * Envelope anterior à assinatura diversificada não tem linha em
 * `EnvelopeDocument`: ali o próprio envelope é o recorte completo. Normalizar na
 * entrada é o que permite a um único laço servir as páginas, os anexos e a
 * trilha sem repetir o recuo três vezes.
 */
interface SealedArtifact {
  isFull: boolean;
  sections: string[];
  path: string;
  /**
   * O PDF CONGELADO deste recorte — o que foi assinado, antes dos selos e antes
   * da trilha que o `finalize` fundiu a ele.
   *
   * Serve a uma coisa só: contar folhas. `stampSeals` desenha SOBRE as páginas
   * do congelado e não cria nenhuma, e `mergeWithAudit` só acrescenta a trilha
   * no fim — logo o nº de páginas deste arquivo é exatamente onde o CORPO do
   * artefato selado termina e a trilha começa. Ver `bodyPageCount`.
   */
  originalPath: string;
  finalSha256: string | null;
  sealedAt: Date | null;
  padesLevel: string | null;
  certSubject: string | null;
  certCnpj: string | null;
  tsaGenTime: Date | null;
  signers: DossierSignerRow[];
}

export interface DossierComponent {
  kind: DossierComponentKind;
  label: string;
  /** SHA-256 do arquivo de ORIGEM, não das páginas copiadas. */
  sha256: string | null;
  pages: number;
  included: boolean;
  /** Por que não entrou. Impresso na capa. */
  note?: string;
}

export interface DossierResult {
  pdf: Buffer;
  filename: string;
  components: DossierComponent[];
  /**
   * O primeiro anexo (o recorte completo), para quem só sabe lidar com um.
   * @deprecated Use `attachmentNames` — a coleta pode ter congelado vários.
   */
  attachmentName: string | null;
  /** Nome de cada artefato assinado anexado. Vazio quando nenhum foi. */
  attachmentNames: string[];
  /** Null quando o orçamento ainda não foi assinado. */
  verificationCode: string | null;
  budgetNumber: number;
}

@Injectable()
export class DossierAssemblerService {
  private readonly logger = new Logger(DossierAssemblerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    // forwardRef dos DOIS lados: o SignatureEnvelopeService passou a injetar este
    // serviço para congelar o dossiê no selamento, então o par virou cíclico. Marcar
    // só um lado não basta — o Nest falha ao resolver o outro.
    @Inject(forwardRef(() => SignatureEnvelopeService))
    private readonly envelopes: SignatureEnvelopeService,
    private readonly elotech: ElotechOxyNfseService,
    private readonly sicredi: SicrediService,
  ) {}

  /**
   * @param options.attachSigned  Anexar os PDFs assinados (padrão: sim).
   *
   *   Governa o ANEXO (`/EmbeddedFiles`), e só ele. As PÁGINAS do documento
   *   assinado entram de qualquer modo (decisão 3): são o que o leitor vê ao
   *   abrir o PDF, e foi a falta delas que fez o dossiê de um orçamento assinado
   *   parecer não assinado. O que muda com `false` é a prova: sem o anexo, o
   *   dossiê passa a ser um pacote apenas legível — nenhuma assinatura digital
   *   validável viaja nele, e o instrumento fica só no servidor.
   *
   *   Ele também deixou de ser a chave da trilha. Ela era carregada pelo anexo
   *   por construção (selada junto do orçamento, indivisível dele); agora o
   *   dossiê monta a sua própria, consolidada, no fim do maço.
   *
   * @param options.customerId  Segmenta o orçamento, a nota e o boleto por cliente
   *   do faturamento (ver decisão 7). Omitido = dossiê completo, que é o que o
   *   congelamento no selo e a tela da tarefa pedem.
   *
   * @param options.dropAuditTrail  @deprecated Sem efeito. Nunca houve como
   *   cortar a trilha do que importa: dentro do artefato selado ela é indivisível
   *   do documento (tirar um byte quebra o A1), e a consolidada existe
   *   justamente para ser lida. Mantido na assinatura para que a rota
   *   `?trilha=0`, que existe em links salvos e no app instalado, não passe a
   *   devolver 400.
   */
  async build(
    quoteId: string,
    options: { attachSigned?: boolean; dropAuditTrail?: boolean; customerId?: string | null } = {},
  ): Promise<DossierResult> {
    const attachSigned = options.attachSigned !== false;
    // `''` chega da query string quando o front manda o parâmetro vazio, e
    // tratá-lo como id faria a validação abaixo recusar um pedido que é, na
    // verdade, "dossiê completo".
    const customerId = options.customerId?.trim() || null;
    const quote = await this.prisma.budget.findUnique({
      where: { id: quoteId },
      select: {
        id: true,
        budgetNumber: true,
        customerConfigs: {
          orderBy: { createdAt: 'asc' },
          select: {
            customerId: true,
            customer: { select: { corporateName: true, fantasyName: true } },
          },
        },
        tasks: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            serialNumber: true,
            customer: { select: { corporateName: true, fantasyName: true, cnpj: true, cpf: true } },
            implement: { select: { plate: true } },
          },
        },
      },
    });
    if (!quote) throw new NotFoundException('Orçamento não encontrado.');

    // Cliente que não está no faturamento é RECUSADO, não ignorado. Cair no
    // dossiê completo em silêncio é justamente o defeito que a segmentação
    // corrige: quem pediu a fatia de um cliente receberia os documentos de
    // todos sem nenhum sinal de que o filtro não valeu.
    const selectedConfig = customerId
      ? (quote.customerConfigs.find(c => c.customerId === customerId) ?? null)
      : null;
    if (customerId && !selectedConfig) {
      throw new BadRequestException('Este cliente não faz parte do faturamento deste orçamento.');
    }

    // A chave é `finalFileId`, NÃO `status: COMPLETED`. O que o dossiê precisa
    // saber é "existe artefato assinado", e só o `finalize()` grava esse campo —
    // junto do selo PAdES, do `finalSha256` e do `sealedAt`. O status é uma
    // dimensão à parte que continua se movendo depois: um envelope selado passa a
    // `SUPERSEDED` quando uma reemissão é aberta, e chavear por `COMPLETED` faria
    // o dossiê perder o orçamento assinado EM SILÊNCIO, caindo no render não
    // assinado e entregando ao cliente um "SEM assinatura eletrônica" de um
    // documento que foi assinado e selado.
    const envelope = await this.prisma.signatureEnvelope.findFirst({
      where: { quoteId, finalFileId: { not: null } },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        status: true,
        verificationCode: true,
        originalSha256: true,
        finalSha256: true,
        sealedAt: true,
        padesLevel: true,
        certSubject: true,
        certCnpj: true,
        tsaGenTime: true,
        finalFile: { select: { path: true, filename: true } },
        originalFile: { select: { path: true } },
        // O ADITIVO de identificação do veículo, quando já emitido.
        addendumSha256: true,
        addendumSealedAt: true,
        addendumFile: { select: { path: true } },
        // Os SIGNATÁRIOS do envelope. Servem ao RECUO dos envelopes anteriores
        // à assinatura diversificada, que não têm linha em `EnvelopeDocument` e
        // por isso também não têm signatários pendurados num recorte.
        signers: {
          orderBy: [{ orderGroup: 'asc' }, { createdAt: 'asc' }],
          select: DOSSIER_SIGNER_SELECT,
        },
        // Os RECORTES selados — uma seção de páginas, um anexo e um bloco de
        // trilha cada. Ver as decisões 1 e 3 no cabeçalho.
        documents: {
          where: { finalFileId: { not: null } },
          orderBy: [{ isFull: 'desc' }, { variantKey: 'asc' }],
          select: {
            isFull: true,
            sections: true,
            finalSha256: true,
            sealedAt: true,
            padesLevel: true,
            certSubject: true,
            certCnpj: true,
            tsaGenTime: true,
            finalFile: { select: { path: true } },
            // Onde o CORPO deste recorte termina — ver `SealedArtifact.originalPath`.
            originalFile: { select: { path: true } },
            signers: {
              orderBy: [{ orderGroup: 'asc' }, { createdAt: 'asc' }],
              select: DOSSIER_SIGNER_SELECT,
            },
          },
        },
      },
    });
    // SEM envelope concluído o dossiê continua existindo, com o orçamento
    // renderizado sob demanda e as linhas de assinatura em branco. Recusar aqui
    // deixaria sem documento justamente as tarefas antigas, que nunca passaram
    // pela assinatura eletrônica — e são a maioria. O rótulo do componente diz
    // que não está assinado, e não há anexo a preservar.
    const assinado = Boolean(envelope?.finalFile);

    // Os artefatos selados, normalizados. Um por recorte; o completo primeiro.
    // Recuo para envelopes anteriores ao recurso, que não têm linha em
    // `EnvelopeDocument`: ali o próprio envelope é o recorte completo.
    const signedArtifacts: SealedArtifact[] = assinado
      ? (envelope!.documents.length
          ? envelope!.documents.map(d => ({
              isFull: d.isFull,
              sections: d.sections,
              path: d.finalFile?.path ?? '',
              originalPath: d.originalFile?.path ?? '',
              finalSha256: d.finalSha256,
              sealedAt: d.sealedAt,
              padesLevel: d.padesLevel,
              certSubject: d.certSubject,
              certCnpj: d.certCnpj,
              tsaGenTime: d.tsaGenTime,
              signers: d.signers,
            }))
          : [
              {
                isFull: true,
                sections: [] as string[],
                path: envelope!.finalFile?.path ?? '',
                originalPath: envelope!.originalFile?.path ?? '',
                finalSha256: envelope!.finalSha256,
                sealedAt: envelope!.sealedAt,
                padesLevel: envelope!.padesLevel,
                certSubject: envelope!.certSubject,
                certCnpj: envelope!.certCnpj,
                tsaGenTime: envelope!.tsaGenTime,
                signers: envelope!.signers,
              },
            ]
        ).filter(a => !!a.path)
      : [];

    // ── AS PÁGINAS DO DOCUMENTO ASSINADO ENTRAM NO DOSSIÊ ────────────────────
    //
    // Menos num caso: o RECORTE POR CLIENTE de um faturamento com mais de um
    // pagador. O artefato assinado é o instrumento INTEIRO e não se recorta —
    // tirar uma página quebra o A1 —, então exibi-lo na fatia do cliente A
    // mostraria a ele os serviços, o total e a condição de pagamento do cliente
    // B. Ali o corpo continua sendo a renderização segmentada, e é ela que
    // mantém as linhas de assinatura, porque nenhuma outra prova da coleta
    // acompanha aquele PDF.
    //
    // Com um pagador só, `customerId` não recorta nada: o gate não vale.
    const segmentado = Boolean(customerId) && quote.customerConfigs.length > 1;
    const showSignedPages = assinado && signedArtifacts.length > 0 && !segmentado;

    // O CORPO LEGÍVEL continua sendo renderizado — é ele que imprime as PARCELAS
    // e a chave Pix, que o documento congelado nunca teve (ele foi assinado
    // antes de existir cobrança emitida). Quando o assinado vai junto, ele perde
    // as linhas de assinatura em branco: três traços para assinar à mão ao lado
    // do documento que JÁ foi assinado convidam o cliente a refazer à caneta um
    // ato praticado, e sugerem que a coleta eletrônica não valeu.
    const readablePdf = await this.envelopes.renderUnsignedQuoteDocument(
      quoteId,
      customerId,
      showSignedPages,
    );

    const components: DossierComponent[] = [];
    const bodies: Array<{
      bytes: Buffer;
      component: DossierComponent;
      /** Quantas folhas copiar. Ausente = o arquivo inteiro. */
      maxPages?: number;
    }> = [];

    // ---- 1. Orçamento (cópia legível, sem selos) ----
    const budgetComponent: DossierComponent = {
      kind: 'ORCAMENTO',
      label: showSignedPages
        ? `Orçamento nº ${quote.budgetNumber} — cópia legível, com as condições de pagamento`
        : assinado
          ? `Orçamento nº ${quote.budgetNumber} — cópia legível; o documento assinado vai anexado`
          : `Orçamento nº ${quote.budgetNumber} — SEM assinatura eletrônica`,
      sha256: sha256(readablePdf),
      pages: 0,
      included: true,
    };
    bodies.push({ bytes: readablePdf, component: budgetComponent });
    components.push(budgetComponent);

    // ---- 1b. O ORÇAMENTO ASSINADO, como saiu da cerimônia ----
    //
    // As páginas do artefato selado: os selos de cada signatário no lugar onde
    // ele assinou e, logo depois, a trilha de auditoria que o `finalize` fundiu
    // ao documento antes do PAdES. É esta cópia que responde "o que foi
    // assinado" LENDO — o anexo (item 6, abaixo) continua sendo o instrumento,
    // porque só ele preserva os bytes e o selo A1.
    //
    // UM POR RECORTE. Escolher um deles seria exibir o que aquele signatário viu
    // no lugar do orçamento; omitir os demais esconderia justamente a prova de
    // quem assinou um recorte. Vão todos, o completo primeiro.
    //
    // SÓ O CORPO, sem a trilha que o `finalize` fundiu a cada recorte. A trilha
    // congelada continua onde ela é PROVA — dentro do anexo selado, byte a byte,
    // sob o mesmo PAdES — e o dossiê já fecha com a trilha consolidada (item 4
    // do cabeçalho), que descreve TODOS os recortes com o hash de cada arquivo
    // selado e o log encadeado do envelope inteiro.
    //
    // Copiá-la aqui imprimia o mesmo log uma vez por recorte MAIS uma no fim: no
    // dossiê do orçamento nº 0984 os 31 eventos saíram TRÊS vezes, com os mesmos
    // hashes, em quatro folhas — duas delas 85% em branco, porque a cláusula de
    // aceitação de cada recorte pulava de página sozinha. Repetição não é prova;
    // é o que faz ninguém ler nenhuma das cópias.
    //
    // Os bytes lidos aqui são MEMORIZADOS: o anexo do item 6 quer os mesmos
    // arquivos, e reler significa reconferir o hash contra um disco que pode ter
    // mudado no meio da montagem — o dossiê passaria a exibir uma página e
    // anexar outra, sem ninguém perceber.
    const sealedBytes = new Map<string, Buffer>();
    let anySignedPage = false;
    if (showSignedPages) {
      for (const artifact of signedArtifacts) {
        const variante = artifact.isFull
          ? 'documento completo'
          : describeSections(canonicalSections(artifact.sections));
        const component: DossierComponent = {
          kind: 'ORCAMENTO_ASSINADO',
          label: `Orçamento nº ${quote.budgetNumber} assinado eletronicamente — ${variante}`,
          sha256: artifact.finalSha256,
          pages: 0,
          included: false,
        };
        components.push(component);
        try {
          const bytes = this.readSignedDocument(artifact.path, artifact.finalSha256);
          sealedBytes.set(artifact.path, bytes);
          component.included = true;
          anySignedPage = true;
          bodies.push({ bytes, component, maxPages: await this.bodyPageCount(artifact) });
        } catch (error) {
          // Um recorte ilegível não derruba o dossiê: os demais, a cópia legível,
          // a nota e o boleto continuam valendo, e a falta aparece no rótulo e no
          // cabeçalho `X-Dossie-Incompleto`.
          component.note = `PDF assinado indisponível (${msg(error)})`;
          this.logger.warn(
            `Recorte assinado do orçamento ${quote.budgetNumber} fora das páginas ` +
              `do dossiê: ${msg(error)}`,
          );
        }
      }
    }

    // ---- 2. Dossiê fotográfico ----
    const dossierTaskIds = (quote.tasks ?? []).map(t => t.id);
    const fotos = await this.renderPhotoDossier(dossierTaskIds, quote.budgetNumber);
    if (fotos) {
      const component: DossierComponent = {
        kind: 'FOTOS',
        label: 'Dossiê fotográfico — antes e depois por ordem de serviço',
        sha256: sha256(fotos),
        pages: 0,
        included: true,
      };
      components.push(component);
      bodies.push({ bytes: fotos, component });
    }

    // ---- 3. Boletos ----
    for (const slip of await this.listBankSlips(quote.id, dossierTaskIds, customerId)) {
      const n = slip.installment?.number;
      const component: DossierComponent = {
        kind: 'BOLETO',
        label:
          // `toLocaleDateString` lê a data gravada pelo fuso do PROCESSO — o
          // vencimento é data de calendário (meio-dia UTC) e não pode depender
          // de onde o serviço roda. `formatDateBR` é a mesma formatação do
          // corpo do orçamento, então rótulo e cláusula nunca divergem.
          `Boleto${n ? ` ${n}` : ''} — vencimento ` +
          `${formatDateBR(slip.dueDate)} — ${formatBRL(Number(slip.amount))}`,
        sha256: null,
        pages: 0,
        included: false,
      };
      components.push(component);
      try {
        const bytes = await this.loadBankSlipPdf(slip);
        component.sha256 = sha256(bytes);
        component.included = true;
        bodies.push({ bytes, component });
      } catch (error) {
        component.note = `PDF indisponível (${msg(error)})`;
        this.logger.warn(`Boleto ${slip.id} fora do dossiê: ${msg(error)}`);
      }
    }

    // ---- 4. Notas fiscais ----
    for (const nfse of await this.listNfse(quote.id, dossierTaskIds, customerId)) {
      const component: DossierComponent = {
        kind: 'NFSE',
        label: `NFS-e nº ${nfse.nfseNumber ?? nfse.elotechNfseId}`,
        sha256: null,
        pages: 0,
        included: false,
      };
      components.push(component);
      try {
        const bytes = await this.elotech.getNfsePdf(nfse.elotechNfseId!);
        component.sha256 = sha256(bytes);
        component.included = true;
        bodies.push({ bytes, component });
      } catch (error) {
        // A NFS-e vive na Elotech, não em disco: uma indisponibilidade do
        // provedor não pode impedir o envio do dossiê, mas tem de aparecer.
        component.note = `não foi possível obter o PDF junto à prefeitura (${msg(error)})`;
        this.logger.warn(`NFS-e ${nfse.elotechNfseId} fora do dossiê: ${msg(error)}`);
      }
    }

    // ---- 4b. Aditivo de identificação do veículo ----
    //
    // Entra como PÁGINA, não como anexo, e a diferença importa: o orçamento
    // assinado de um implemento 0 km diz "a registrar" onde deveria estar o
    // chassi, e quem abrir o dossiê precisa encontrar a resposta LENDO, não
    // extraindo um anexo. Ele também vai anexo, logo abaixo, porque é o anexo que
    // carrega o selo — a cópia legível aqui perde o A1 como qualquer outra.
    if (envelope?.addendumFile?.path) {
      const component: DossierComponent = {
        kind: 'ADITIVO',
        label: `Aditivo de identificação do veículo — orçamento nº ${quote.budgetNumber}`,
        sha256: envelope.addendumSha256,
        pages: 0,
        included: false,
      };
      components.push(component);
      try {
        const bytes = this.readSignedDocument(envelope.addendumFile.path, envelope.addendumSha256);
        component.included = true;
        bodies.push({ bytes, component });
      } catch (error) {
        component.note = `PDF indisponível (${msg(error)})`;
        this.logger.warn(
          `Aditivo do orçamento ${quote.budgetNumber} fora do dossiê: ${msg(error)}`,
        );
      }
    }

    // ---- 4c. Trilha de auditoria da coleta (ANEXO, no fim) ----
    //
    // A decisão 4 deste arquivo dizia que a trilha não vira página: instrumento
    // de disputa, não de comunicação comercial. Ela foi REVISTA — quem recebe o
    // dossiê de um orçamento assinado é parte da cerimônia, e a pergunta que ele
    // faz ao abrir o PDF ("quem assinou isto, quando, e como foi autenticado?")
    // não pode exigir extrair um anexo.
    //
    // POR QUE TAMBÉM AQUI, se cada artefato selado já traz a sua. A trilha
    // impressa DENTRO do artefato foi congelada no selo: ela não pode ganhar o
    // hash final do arquivo (que só existe depois dela) nem o user-agent, e num
    // envelope de vários recortes ela se repete N vezes sem nunca dizer o
    // conjunto. Esta é o ÍNDICE consolidado: um bloco por recorte, com o hash do
    // arquivo selado e as partes daquele documento, mais o log encadeado do
    // envelope inteiro. Uma é prova congelada, a outra é leitura.
    //
    // NO FIM de propósito: a ordem da decisão 5 é a da conversa comercial — o que
    // foi combinado, o que foi feito, como pagar, a nota. A trilha é anexo, e
    // anexo não se interpõe entre o cliente e o boleto.
    //
    // FORA do recorte por cliente, pelo mesmo motivo das páginas: a trilha lista
    // as partes de TODOS os recortes, e o contato do cliente B não é assunto do
    // cliente A. Ali o dossiê segue exatamente como era.
    if (assinado && !segmentado && signedArtifacts.length) {
      const events = await this.prisma.signatureAuditEvent.findMany({
        where: { envelopeId: envelope!.id },
        orderBy: { sequence: 'asc' },
        select: {
          sequence: true,
          occurredAt: true,
          eventType: true,
          actorLabel: true,
          ipAddress: true,
          hash: true,
        },
      });
      const component: DossierComponent = {
        kind: 'TRILHA',
        label: `Trilha de auditoria — envelope ${envelope!.verificationCode}`,
        sha256: null,
        pages: 0,
        included: false,
      };
      components.push(component);
      try {
        const bytes = await this.renderAuditTrail({
          budgetNumber: quote.budgetNumber,
          envelopeId: envelope!.id,
          version: envelope!.version,
          verificationCode: envelope!.verificationCode,
          originalSha256: envelope!.originalSha256,
          artifacts: signedArtifacts,
          events,
          /**
           * O documento assinado veio junto? Muda uma frase, e a frase importa:
           * sem as páginas seladas no maço, esta é a ÚNICA prova da coleta que
           * o leitor tem em mãos, e dizer "ver o documento assinado adiante"
           * apontaria para algo que não está ali.
           */
          signedPagesIncluded: anySignedPage,
        });
        component.sha256 = sha256(bytes);
        component.included = true;
        bodies.push({ bytes, component });
      } catch (error) {
        component.note = `não foi possível montar a trilha (${msg(error)})`;
        this.logger.warn(
          `Trilha do orçamento ${quote.budgetNumber} fora do dossiê: ${msg(error)}`,
        );
      }
    }

    // ---- 5. Montagem ----
    const container = await PDFDocument.create();
    container.setTitle(`Dossiê do Orçamento nº ${quote.budgetNumber}`);
    container.setProducer(COMPANY.name);
    container.setCreator(COMPANY.name);

    // Capa depois dos corpos? Não: ela precisa contar as páginas de cada
    // componente, então os corpos entram primeiro numa lista e a capa é
    // prependida ao final.
    //
    // `firstPage` é anotado enquanto se monta: é o que permite numerar as
    // páginas e montar os marcadores depois, sem reabrir o documento.
    const placed: Array<{ component: DossierComponent; firstPage: number; ours: boolean }> = [];
    for (const body of bodies) {
      const firstPage = container.getPageCount();
      const pageCount = await this.appendPdf(
        container,
        body.bytes,
        body.component,
        body.maxPages,
      );
      body.component.pages = pageCount;
      if (pageCount > 0) {
        placed.push({
          component: body.component,
          firstPage,
          // NOSSAS páginas são as que este servidor desenhou: o orçamento
          // renderizado agora, o dossiê fotográfico e o aditivo. Boleto e NFS-e
          // são documentos de TERCEIROS — ver a decisão 2 — e não se escreve
          // sobre a folha de outro.
          ours: body.component.kind !== 'BOLETO' && body.component.kind !== 'NFSE',
        });
      }
    }

    // Sem capa: ver a decisão 4 no cabeçalho deste arquivo.
    await this.stampDossierPages(container, quote.budgetNumber, placed);
    this.addOutline(container, placed);

    // ---- 6. Os documentos assinados, byte a byte ----
    // DEPOIS das páginas e ANTES do save: o anexo é um objeto do documento, e é
    // ele que preserva a assinatura A1 e a cadeia de auditoria intactas.
    //
    // UM ANEXO POR RECORTE. Cada um tem selo próprio e prova a assinatura das
    // pessoas que o receberam — anexar só o completo deixaria de fora exatamente
    // a prova de quem assinou um recorte.
    const attachedNames: string[] = [];
    if (attachSigned && assinado) {
      // O aditivo primeiro: ele é o menor e o mais recente, e quem procura o
      // chassi numa lista de anexos o encontra antes de abrir o contrato inteiro.
      if (envelope?.addendumFile?.path) {
        try {
          const bytes = this.readSignedDocument(
            envelope.addendumFile.path,
            envelope.addendumSha256,
          );
          const name = `orcamento-${quote.budgetNumber}-aditivo-identificacao.pdf`;
          await container.attach(new Uint8Array(bytes), name, {
            mimeType: 'application/pdf',
            description:
              `Aditivo de identificação do veículo do orçamento nº ${quote.budgetNumber} — ` +
              `envelope ${envelope.verificationCode}. Declara a placa e o chassi que só ` +
              'existiram depois da assinatura; selado com o mesmo certificado ICP-Brasil.',
            creationDate: envelope.addendumSealedAt ?? undefined,
            modificationDate: envelope.addendumSealedAt ?? undefined,
          });
          attachedNames.push(name);
        } catch (error) {
          this.logger.error(
            `Aditivo fora dos anexos do dossiê do orçamento ${quote.budgetNumber}: ${msg(error)}`,
          );
        }
      }

      for (const artifact of signedArtifacts) {
        let bytes: Buffer;
        try {
          bytes =
            sealedBytes.get(artifact.path) ??
            this.readSignedDocument(artifact.path, artifact.finalSha256);
        } catch (error) {
          // Um anexo que falta não pode derrubar o dossiê inteiro: as páginas
          // legíveis, a nota e o boleto continuam valendo. Fica no log e o nome
          // não entra em `attachmentNames`, que é o que a resposta HTTP anuncia.
          this.logger.error(
            `Artefato assinado fora do dossiê do orçamento ${quote.budgetNumber}: ${msg(error)}`,
          );
          continue;
        }
        const label = artifact.isFull
          ? ''
          : variantFilenameSuffix(canonicalSections(artifact.sections));
        // Desde 24/09/2026 cada responsável assina o SEU documento, e dois que
        // recebem tudo produzem dois artefatos de mesmo recorte — o mesmo nome
        // de anexo, e o segundo apagaria o primeiro no leitor de PDF. O nome de
        // quem assinou desempata.
        let name = `orcamento-${quote.budgetNumber}-assinado${label}.pdf`;
        if (attachedNames.includes(name)) {
          const who = artifact.signers.find(s => s.orderGroup === 0)?.declaredName ?? '';
          const slug =
            who
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '')
              .slice(0, 40) || String(attachedNames.length + 1);
          name = `orcamento-${quote.budgetNumber}-assinado${label}-${slug}.pdf`;
        }
        await container.attach(new Uint8Array(bytes), name, {
          mimeType: 'application/pdf',
          description:
            `Orçamento nº ${quote.budgetNumber} assinado eletronicamente — ` +
            `envelope ${envelope!.verificationCode}` +
            (artifact.isFull
              ? ''
              : ` (${describeSections(canonicalSections(artifact.sections))})`) +
            '. Este é o documento com validade jurídica: extraia-o para validar a ' +
            'assinatura ICP-Brasil.',
          creationDate: artifact.sealedAt ?? undefined,
          modificationDate: artifact.sealedAt ?? undefined,
        });
        attachedNames.push(name);
      }
    }

    const pdf = Buffer.from(await container.save({ useObjectStreams: false }));

    return {
      pdf,
      // Razão social + "Dossiê" + número: ver `document-filename.ts`. O número é
      // o `budgetNumber` porque não existe sequência separada para o dossiê. No
      // modo segmentado quem nomeia é o cliente do RECORTE, não o da tarefa:
      // baixar os dois dossiês de um faturamento com dois clientes gravava dois
      // arquivos de mesmo nome, e o segundo sobrescrevia o primeiro.
      filename: dossierPdfFilename(
        selectedConfig?.customer ?? quote.tasks?.[0]?.customer,
        quote.budgetNumber,
      ),
      components,
      attachmentName: attachedNames[0] ?? null,
      attachmentNames: attachedNames,
      verificationCode: envelope?.verificationCode ?? null,
      budgetNumber: quote.budgetNumber,
    };
  }

  // ---------------------------------------------------------------------------

  /**
   * Lê os bytes assinados e CONFERE o hash contra o que o envelope registrou.
   *
   * O arquivo em disco é mutável; `finalSha256` foi gravado no momento do selo.
   * Divergir significa que o artefato não é mais aquele que foi assinado — e
   * seguir montando o dossiê distribuiria um documento que a trilha não cobre.
   */
  /**
   * ONDE O CORPO DE UM RECORTE SELADO TERMINA — em folhas.
   *
   * O artefato final é `congelado + selos + trilha`, nesta ordem e sem exceção:
   * `stampSeals` desenha SOBRE as páginas do congelado (selo, valor tardio,
   * faixa de verificação) e não cria nenhuma; `mergeWithAudit` acrescenta a
   * trilha ao FIM. Logo o nº de páginas do congelado é o índice exato da
   * primeira folha de trilha, e contá-las é medir o documento, não adivinhar.
   *
   * Derivado do arquivo em vez de gravado numa coluna de propósito: isto vale
   * RETROATIVAMENTE, para todo envelope já selado, sem migração e sem um campo
   * que envelopes antigos teriam nulo — e o dossiê que o cliente rebaixa hoje é
   * justamente o de um envelope antigo.
   *
   * `null` quando não dá para saber (arquivo ausente, ilegível, ou uma contagem
   * que não faz sentido contra o selado). Aí copia-se o artefato INTEIRO: uma
   * trilha repetida é feia, uma página de documento faltando é grave.
   */
  private async bodyPageCount(artifact: SealedArtifact): Promise<number | undefined> {
    if (!artifact.originalPath || !existsSync(artifact.originalPath)) return undefined;
    try {
      const frozen = await PDFDocument.load(readFileSync(artifact.originalPath), {
        updateMetadata: false,
        ignoreEncryption: true,
      });
      const pages = frozen.getPageCount();
      return pages > 0 ? pages : undefined;
    } catch (error) {
      this.logger.warn(
        `Não foi possível contar as folhas do congelado (${artifact.originalPath}): ${msg(error)}` +
          ' — o recorte selado entra no dossiê inteiro, com a trilha congelada junto.',
      );
      return undefined;
    }
  }

  private readSignedDocument(path: string, expectedSha256: string | null): Buffer {
    if (!existsSync(path)) {
      throw new BadRequestException(
        'O PDF assinado deste orçamento não está mais disponível no servidor.',
      );
    }
    const bytes = readFileSync(path);
    const actual = sha256(bytes);
    if (expectedSha256 && actual !== expectedSha256) {
      throw new BadRequestException(
        'O arquivo assinado em disco não confere com o hash registrado no envelope. ' +
          'O dossiê não será gerado.',
      );
    }
    return bytes;
  }

  /**
   * Dossiê fotográfico: uma página por ordem de serviço, "ANTES" (check-in) e
   * "DEPOIS" (check-out).
   *
   * Porte FIEL de `web/src/utils/dossie-pdf-generator.ts` — mesmas margens
   * (62/28/50), mesmo cabeçalho com logo e régua verde, mesmo rodapé da empresa,
   * mesmo cartão de canto arredondado com barra verde, e a mesma regra de
   * encaixe da foto: largura da célula primeiro, altura só se estourar. As fotos
   * ficam ancoradas no topo-esquerda da célula, NÃO centralizadas — centralizar
   * abria vãos enormes em foto larga, que é o formato de quase toda foto de
   * implemento.
   *
   * A diferença real em relação ao gerador do browser é a fonte das imagens:
   * aqui saem do disco pelo `File.path`, sem requisição autenticada — é o que
   * permite servir o dossiê a quem não tem sessão.
   */
  private async renderPhotoDossier(
    /**
     * TODAS as tarefas do orçamento, na ordem do documento.
     *
     * Era uma tarefa só. Num orçamento de sessenta caminhões, mandar as fotos de
     * um e omitir as dos outros cinquenta e nove entregaria ao cliente um dossiê
     * que parece completo e não é — o pior formato possível para uma peça que
     * existe para provar o que foi feito.
     */
    taskIds: string[],
    budgetNumber: number,
  ): Promise<Buffer | null> {
    if (!taskIds.length) return null;

    const orders = await this.prisma.serviceOrder.findMany({
      where: { taskId: { in: taskIds } },
      // Agrupado POR TAREFA antes de por posição: o dossiê fotográfico se lê
      // caminhão a caminhão, e intercalar as ordens de sessenta veículos por
      // número de posição produziria sessenta blocos de "Logomarca Laterais"
      // seguidos de sessenta de "Logomarca Traseira".
      orderBy: [{ taskId: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
      select: {
        description: true,
        observation: true,
        taskId: true,
        task: { select: { serialNumber: true, implement: { select: { plate: true } } } },
        checkinFiles: { select: { path: true, mimetype: true } },
        checkoutFiles: { select: { path: true, mimetype: true } },
      },
    });
    const comFotos = orders.filter(o => o.checkinFiles.length > 0 || o.checkoutFiles.length > 0);
    if (!comFotos.length) return null;

    /** O orçamento cobre mais de um veículo? Decide o rótulo por folha. */
    const multiVehicle = new Set(comFotos.map(o => o.taskId)).size > 1 || taskIds.length > 1;

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const GREEN = hexToRgb(BRAND_COLORS.primaryGreen);
    const GRAY = rgb(0.33, 0.33, 0.33);
    const DARK = rgb(0.2, 0.2, 0.2);
    const WHITE = rgb(1, 1, 1);
    const ANTES = rgb(0.15, 0.39, 0.92);
    const DEPOIS = rgb(0.09, 0.64, 0.26);

    const W = 595.28;
    const H = 841.89;
    const ML = 62;
    const MR = 62;
    const MT = 28;
    const MB = 50;
    const CW = W - ML - MR;
    const CARD_RADIUS = 6;
    const FOOTER_TOP_Y = MB + 38;

    const logo = await this.embedLogo(doc);

    for (const [soIndex, so] of comFotos.entries()) {
      const page = doc.addPage([W, H]);

      // ---- cabeçalho ----
      let y = H - MT;
      if (logo) {
        const logoH = 42;
        page.drawImage(logo, {
          x: ML,
          y: y - logoH,
          width: logoH * (logo.width / logo.height),
          height: logoH,
        });
      }
      const titulo = winAnsi(`Dossie No ${budgetNumber}`);
      page.drawText(titulo, {
        x: W - MR - bold.widthOfTextAtSize(titulo, 16),
        y: y - 14,
        size: 16,
        font: bold,
        color: DARK,
      });
      const data = winAnsi(`Emissao: ${new Date().toLocaleDateString('pt-BR')}`);
      page.drawText(data, {
        x: W - MR - font.widthOfTextAtSize(data, 9),
        y: y - 28,
        size: 9,
        font,
        color: GRAY,
      });
      y -= 46;
      page.drawRectangle({ x: ML, y, width: CW, height: 1, color: GREEN });
      y -= 22;

      // ---- rodapé ----
      const lineY = MB + 26;
      page.drawRectangle({ x: ML, y: lineY, width: CW, height: 1, color: GREEN });
      page.drawText(winAnsi(COMPANY.name), {
        x: ML,
        y: lineY - 14,
        size: 10,
        font: bold,
        color: GREEN,
      });
      page.drawText(winAnsi(COMPANY.address ?? ''), {
        x: ML,
        y: lineY - 26,
        size: 8,
        font,
        color: GRAY,
      });
      page.drawText(winAnsi(COMPANY.phone ?? ''), {
        x: ML,
        y: lineY - 38,
        size: 8,
        font,
        color: GREEN,
      });
      page.drawText(winAnsi(COMPANY.websiteUrl ?? ''), {
        x: ML,
        y: lineY - 50,
        size: 8,
        font,
        color: GREEN,
      });

      if (soIndex === 0) {
        page.drawText(winAnsi('Dossie Fotografico'), {
          x: ML,
          y,
          size: 12,
          font: bold,
          color: GREEN,
        });
        y -= 20;
      }

      // ── DE QUE VEÍCULO É ESTA FOLHA ─────────────────────────────────────
      //
      // Só sai quando o orçamento cobre mais de um. Com um veículo, dizer o
      // número de série em cada folha é repetir na sessenta e primeira vez o que
      // a capa já disse; com sessenta, é a ÚNICA coisa que distingue duas folhas
      // de "Logomarca Laterais" cujas fotos são de caminhões diferentes.
      //
      // O rótulo vai acima do cartão, e não dentro: dentro ele competiria com a
      // descrição do serviço, que é o título do cartão.
      if (multiVehicle) {
        const vehicleLine = winAnsi(
          [
            so.task?.serialNumber ? `No de serie ${so.task.serialNumber}` : null,
            so.task?.implement?.plate ? `Placa ${so.task.implement.plate}` : null,
          ]
            .filter(Boolean)
            .join('  ·  ') || 'Veiculo sem identificacao',
        );
        page.drawText(vehicleLine, { x: ML, y, size: 9.5, font: bold, color: DARK });
        y -= 16;
      }

      // ---- cartão: verde arredondado + corpo branco por cima ----
      const base =
        so.description?.trim().toLowerCase() === 'outros' && so.observation
          ? so.observation
          : so.description || 'Servico';
      const desc =
        so.observation && so.description?.trim().toLowerCase() !== 'outros'
          ? `${base} ${so.observation}`
          : base;

      const cardPad = 8;
      const contentW = CW - cardPad * 2;
      const cardTop = y;
      const barH = 20;
      const cardH = cardTop - FOOTER_TOP_Y;

      page.drawSvgPath(roundedRectAllPath(CW, cardH, CARD_RADIUS), {
        x: ML,
        y: cardTop,
        color: GREEN,
        borderColor: rgb(0.85, 0.85, 0.85),
        borderWidth: 0.75,
      });
      page.drawSvgPath(roundedRectBottomPath(CW, cardH - barH, CARD_RADIUS), {
        x: ML,
        y: cardTop - barH,
        color: WHITE,
        borderWidth: 0,
      });
      page.drawText(winAnsi(desc), {
        x: ML + 10,
        y: cardTop - barH + 6,
        size: 10,
        font: bold,
        color: WHITE,
      });
      y = cardTop - barH - 10;

      // ---- fatiamento vertical entre ANTES e DEPOIS ----
      const secoes = [
        { rotulo: 'ANTES', cor: ANTES, arquivos: so.checkinFiles },
        { rotulo: 'DEPOIS', cor: DEPOIS, arquivos: so.checkoutFiles },
      ].filter(s => s.arquivos.length > 0);

      const labelH = 12;
      const postLabelGap = 6;
      const interSectionGap = 14;
      const interTotal = Math.max(0, secoes.length - 1) * interSectionGap;
      const alturaFotos =
        y - FOOTER_TOP_Y - secoes.length * (labelH + postLabelGap) - interTotal - 4;
      const slotH = secoes.length > 0 ? alturaFotos / secoes.length : 0;

      for (const [i, secao] of secoes.entries()) {
        if (slotH <= 20) break;
        page.drawText(winAnsi(secao.rotulo), {
          x: ML + cardPad,
          y,
          size: 8.5,
          font: bold,
          color: secao.cor,
        });
        y -= labelH;

        const cols = secao.arquivos.length === 1 ? 1 : 2;
        const gap = 6;
        const cellW = (contentW - (cols - 1) * gap) / cols;
        const rows = Math.ceil(secao.arquivos.length / cols);
        const cellH = (slotH - (rows - 1) * gap) / rows;

        for (let k = 0; k < secao.arquivos.length; k += cols) {
          for (const [c, file] of secao.arquivos.slice(k, k + cols).entries()) {
            const img = await this.embedImage(doc, file);
            if (!img) continue;
            const ratio = img.width / img.height;
            let w = cellW;
            let h = cellW / ratio;
            if (h > cellH) {
              h = cellH;
              w = cellH * ratio;
            }
            page.drawImage(img, {
              x: ML + cardPad + c * (cellW + gap),
              y: y - h,
              width: w,
              height: h,
            });
          }
          y -= cellH + gap;
        }
        y -= postLabelGap;
        if (i < secoes.length - 1) y -= interSectionGap;
      }
    }

    return Buffer.from(await doc.save({ useObjectStreams: false }));
  }

  /**
   * A TRILHA DE AUDITORIA CONSOLIDADA — um bloco por recorte, mais o log.
   *
   * PDFKit e não pdf-lib, como em `buildAuditPages`: isto é texto corrido de
   * altura imprevisível (o log de um envelope reaberto passa de cem linhas), e
   * paginar texto à mão com `drawText` é escrever um motor de fluxo.
   *
   * CPF MASCARADO (`***.999.999-**`, a convenção do repositório). O número
   * inteiro não se perde: ele está impresso na trilha SELADA dentro de cada
   * artefato assinado, que viaja neste mesmo PDF e é a peça probatória. Esta
   * página é índice de leitura, e um índice não precisa multiplicar cópias do
   * documento de ninguém.
   *
   * O HASH que sai aqui é o `finalSha256` do arquivo SELADO, gravado no momento
   * do selo — nunca um hash calculado agora sobre o que o dossiê montou. Este
   * PDF carimba o pé de cada folha nossa (`stampDossierPages`), e um hash
   * recalculado depois do carimbo descreveria bytes que ninguém assinou.
   */
  private async renderAuditTrail(input: {
    budgetNumber: number;
    envelopeId: string;
    version: number;
    verificationCode: string;
    originalSha256: string;
    artifacts: SealedArtifact[];
    events: Array<{
      sequence: number;
      occurredAt: Date;
      eventType: string;
      actorLabel: string | null;
      ipAddress: string | null;
      hash: string;
    }>;
    signedPagesIncluded: boolean;
  }): Promise<Buffer> {
    // Margem inferior alta de propósito: o pé desta folha recebe o carimbo do
    // dossiê ("Dossiê · Orçamento nº … · Página N de M", em `DOSSIER_STAMP_Y`),
    // e texto que descesse até a margem padrão colidiria com ele. 60pt contra os
    // ~31pt que o carimbo ocupa deixa quase 30pt de respiro — e é a MARGEM que
    // reserva o espaço, não um limiar solto (ver logo abaixo).
    const doc = new PDFKitDocument({
      size: 'A4',
      margins: { top: 48, bottom: 60, left: 50, right: 50 },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>(resolve =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    const green = BRAND_COLORS.primaryGreen;
    const gray = BRAND_COLORS.textGray;
    const dark = '#1a1a1a';
    /**
     * O piso é o da CAIXA DE TEXTO, e não um número escolhido à parte.
     *
     * Era 748 fixo — 33,89pt acima da margem que a própria folha declara
     * (841,89 − 60 = 781,89). Cada folha da trilha perdia essa faixa sem que
     * nada a ocupasse, e a conta ainda ficava errada duas vezes: quem mexesse na
     * margem não mexeria no limiar, e o limiar não sabia dizer de onde veio.
     *
     * Derivando da margem, "cabe nesta folha?" passa a ser a mesma pergunta que
     * o PDFKit faz sozinho, e a reserva para o carimbo do dossiê fica onde
     * deveria estar desde o começo: na margem inferior.
     */
    const PAGE_BREAK_Y = doc.page.height - doc.page.margins.bottom;
    const breakIfNeeded = (needed: number) => {
      if (doc.y + needed > PAGE_BREAK_Y) doc.addPage();
    };

    doc.font('Helvetica-Bold').fontSize(14).fillColor(green).text('Trilha de auditoria');
    doc.moveDown(0.2);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(gray)
      .text(
        winAnsi(
          'Datas e horários em GMT-03:00 (Brasília). ' +
            (input.signedPagesIncluded
              ? 'Os documentos assinados que esta trilha descreve estão nas páginas ' +
                'anteriores deste dossiê e, byte a byte, nos anexos do PDF.'
              : 'Os documentos assinados que esta trilha descreve permanecem no ' +
                'servidor da Ankaa e podem ser obtidos pelo código de verificação abaixo.'),
        ),
      );
    doc.moveDown(0.8);

    doc.font('Helvetica').fontSize(9).fillColor(dark);
    doc.text(winAnsi(`Orçamento nº ${input.budgetNumber}`));
    doc.text(winAnsi(`Envelope ${input.envelopeId} (versão ${input.version})`));
    doc.text(winAnsi(`Código de verificação: ${input.verificationCode}`));
    doc.font('Helvetica').fontSize(7.5).fillColor(gray);
    doc.text(winAnsi(`Hash SHA-256 do documento original: ${input.originalSha256}`));
    if (input.events.length) {
      doc.text(
        winAnsi(`Hash final da cadeia de auditoria: ${input.events[input.events.length - 1].hash}`),
      );
    }
    doc.moveDown(1);

    // ---- Um bloco por documento selado ----
    for (const artifact of input.artifacts) {
      breakIfNeeded(90);
      const variante = artifact.isFull
        ? 'documento completo (o instrumento)'
        : describeSections(canonicalSections(artifact.sections));
      doc.font('Helvetica-Bold').fontSize(11).fillColor(green);
      doc.text(winAnsi(`Documento assinado — ${variante}`));
      doc.moveDown(0.25);

      doc.font('Helvetica').fontSize(7.5).fillColor(gray);
      if (artifact.finalSha256) {
        doc.text(winAnsi(`SHA-256 do arquivo selado: ${artifact.finalSha256}`));
      }
      const selo: string[] = [];
      if (artifact.sealedAt) selo.push(`Selado em ${formatDateTimeBR(artifact.sealedAt)}`);
      if (artifact.padesLevel) selo.push(`PAdES ${artifact.padesLevel}`);
      if (artifact.tsaGenTime) {
        selo.push(`Carimbo do tempo ${formatDateTimeBR(artifact.tsaGenTime)}`);
      }
      if (selo.length) doc.text(winAnsi(selo.join('  |  ')));
      if (artifact.certSubject) {
        doc.text(
          winAnsi(
            `Certificado ICP-Brasil: ${artifact.certSubject}` +
              (artifact.certCnpj ? ` — CNPJ ${artifact.certCnpj}` : ''),
          ),
        );
      }
      doc.moveDown(0.5);

      if (!artifact.signers.length) {
        doc.font('Helvetica-Oblique').fontSize(8).fillColor(gray);
        doc.text(winAnsi('Sem signatários registrados para este documento.'), { indent: 10 });
        doc.moveDown(0.6);
        continue;
      }

      for (const signer of artifact.signers) {
        breakIfNeeded(56);
        // O ESTADO vem do carimbo de tempo, não só do `status`: um signatário
        // reaberto depois de recusar volta a PENDING e continua tendo recusado
        // antes — a trilha tem de narrar os dois fatos.
        const estado = signer.signedAt
          ? '[ASSINADO]'
          : signer.refusedAt
            ? '[RECUSOU]'
            : `[${signer.status}]`;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(dark);
        doc.text(winAnsi(`${estado} ${signer.declaredName}`));

        doc.font('Helvetica').fontSize(7.5).fillColor(gray);
        const identidade: string[] = [];
        identidade.push(`CPF: ${maskCpf(signer.informedCpf ?? signer.declaredCpf)}`);
        if (signer.informedCargo) identidade.push(`Cargo: ${signer.informedCargo}`);
        identidade.push(signer.orderGroup === 1 ? 'Parte: Ankaa' : 'Parte: cliente');
        doc.text(winAnsi(identidade.join('  |  ')), { indent: 10 });

        const canal: string[] = [];
        canal.push(`Autenticação: ${AUTH_METHOD_LABELS[signer.authMethod] ?? signer.authMethod}`);
        if (signer.declaredEmail) canal.push(`E-mail: ${maskEmail(signer.declaredEmail)}`);
        if (signer.declaredPhone) canal.push(`Telefone: ${maskPhone(signer.declaredPhone)}`);
        doc.text(winAnsi(canal.join('  |  ')), { indent: 10 });

        const ato: string[] = [];
        if (signer.signedAt) ato.push(`Assinou em ${formatDateTimeBR(signer.signedAt)}`);
        if (signer.refusedAt) ato.push(`Recusou em ${formatDateTimeBR(signer.refusedAt)}`);
        if (signer.ipAddress) ato.push(`IP ${signer.ipAddress}`);
        if (ato.length) doc.text(winAnsi(ato.join('  |  ')), { indent: 10 });
        if (signer.refusalReason) {
          doc.text(winAnsi(`Motivo da recusa: ${signer.refusalReason}`), { indent: 10 });
        }
        if (signer.userAgent) {
          // Truncado: o user-agent é uma linha de diagnóstico, e um Chrome de
          // Android passa de 180 caracteres e rouba três linhas da folha.
          const ua =
            signer.userAgent.length > 120
              ? `${signer.userAgent.slice(0, 117)}...`
              : signer.userAgent;
          doc.fontSize(6.5).text(winAnsi(`Navegador: ${ua}`), { indent: 10 });
          doc.fontSize(7.5);
        }
        doc.moveDown(0.5);
      }
      doc.moveDown(0.4);
    }

    // ---- Log encadeado do envelope ----
    if (input.events.length) {
      breakIfNeeded(70);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(green).text('Log de eventos');
      doc.moveDown(0.3);
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor(gray)
        .text(
          winAnsi(
            'O log é do ENVELOPE, não de um recorte: ele narra a cerimônia inteira. Cada ' +
              'evento carrega o hash do anterior — remover, reordenar ou editar qualquer ' +
              'linha quebra todos os elos seguintes, e a quebra é verificável de forma ' +
              'independente.',
          ),
        );
      doc.moveDown(0.5);

      for (const event of input.events) {
        breakIfNeeded(14);
        doc.font('Helvetica').fontSize(7.5).fillColor(dark);
        const quem = event.actorLabel ? `  ${event.actorLabel}` : '';
        const ip = event.ipAddress ? `  IP ${event.ipAddress}` : '';
        doc.text(
          winAnsi(
            `${String(event.sequence).padStart(3, '0')}  ` +
              `${formatDateTimeBR(event.occurredAt)}  ` +
              `${EVENT_DESCRIPTIONS[event.eventType] ?? event.eventType}${quem}${ip}`,
          ),
        );
        doc.fontSize(6).fillColor(gray);
        doc.text(winAnsi(`hash ${event.hash}`), { indent: 10 });
      }
    }

    doc.end();
    return done;
  }

  /** Logo da empresa em `assets/logo.png`, a mesma que o orçamento usa. */
  private async embedLogo(doc: PDFDocument) {
    try {
      const p = resolve(process.cwd(), 'assets', 'logo.png');
      if (!existsSync(p)) return null;
      return await doc.embedPng(readFileSync(p));
    } catch {
      return null;
    }
  }

  /** JPEG/PNG por magic bytes. Qualquer outro formato é ignorado em silêncio. */
  private async embedImage(doc: PDFDocument, file: { path: string; mimetype: string }) {
    try {
      if (!existsSync(file.path)) return null;
      const bytes = readFileSync(file.path);
      if (bytes[0] === 0xff && bytes[1] === 0xd8) return await doc.embedJpg(bytes);
      if (bytes[0] === 0x89 && bytes[1] === 0x50) return await doc.embedPng(bytes);
      return null;
    } catch (error) {
      this.logger.warn(`Foto ignorada (${file.path}): ${msg(error)}`);
      return null;
    }
  }

  /**
   * Notas AUTORIZADAS da tarefa — e só as do cliente pedido, quando há um.
   *
   * No modo segmentado a nota SEM fatura sai fora, mesmo estando ligada à
   * tarefa: é por `Invoice.customerId` que uma NFS-e se atribui a um cliente
   * (o `NfseDocument` não guarda cliente nenhum), e nota órfã — o histórico
   * religado pelo id da tarefa — não tem a quem pertencer. Mandá-la no dossiê
   * de um dos clientes seria atribuí-la a ele por omissão. No modo completo ela
   * continua entrando, como sempre entrou.
   */
  /**
   * As notas do ORÇAMENTO — e só as do cliente pedido, quando há um.
   *
   * O escopo era a tarefa. Passou a ser o orçamento porque uma nota pode não ter
   * tarefa: quando os sessenta caminhões são faturados juntos, `NfseDocument.taskId`
   * é NULO de propósito (a nota não é de nenhum deles em particular) e quem liga é
   * `quoteId`. Buscar por tarefa deixaria o dossiê de um faturamento conjunto SEM
   * nota fiscal nenhuma.
   */
  private async listNfse(
    quoteId: string,
    taskIds: string[],
    customerId: string | null,
  ) {
    return this.prisma.nfseDocument.findMany({
      where: {
        status: 'AUTHORIZED',
        elotechNfseId: { not: null },
        // A nota pertence ao orçamento por `quoteId` (forma nova) ou por
        // `taskId` (notas emitidas antes desta coluna existir, e notas
        // reconciliadas da Elotech que só têm a tarefa).
        OR: [
          { quoteId },
          ...(taskIds.length ? [{ taskId: { in: taskIds } }] : []),
          ...(taskIds.length ? [{ invoice: { taskId: { in: taskIds } } }] : []),
          { invoice: { customerConfig: { quoteId } } },
        ],
        ...(customerId ? { invoice: { is: { customerId } } } : {}),
      },
      select: { id: true, elotechNfseId: true, nfseNumber: true },
      orderBy: { nfseNumber: 'asc' },
    });
  }

  /**
   * Boletos vivos da tarefa — e só os do cliente pedido, quando há um.
   *
   * O corte é por `Invoice.customerId` e não por `customerConfigId` da parcela:
   * a fatura é quem carrega o pagador de forma obrigatória (coluna NOT NULL),
   * enquanto o vínculo da parcela com a configuração é opcional e some numa
   * reversão de faturamento — e um boleto sem lastro de configuração cairia no
   * dossiê de todo mundo.
   */
  private async listBankSlips(
    quoteId: string,
    taskIds: string[],
    customerId: string | null,
  ) {
    return this.prisma.bankSlip.findMany({
      where: {
        // Mesmo motivo do `listNfse`: numa cobrança conjunta a fatura não tem
        // tarefa, e o vínculo com o orçamento é pela configuração de faturamento.
        installment: {
          invoice: {
            is: {
              ...(customerId ? { customerId } : {}),
              OR: [
                { customerConfig: { quoteId } },
                ...(taskIds.length ? [{ taskId: { in: taskIds } }] : []),
              ],
            },
          },
        },
        // CANCELLED/REJECTED não são cobrança viva: mandá-los ao cliente junto
        // do orçamento assinado seria pedir pagamento de um título morto.
        status: { in: ['ACTIVE', 'OVERDUE', 'PAID', 'REGISTERING'] },
      },
      select: {
        id: true,
        amount: true,
        dueDate: true,
        digitableLine: true,
        pdfFile: { select: { path: true } },
        installment: { select: { number: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  /** Disco primeiro (o agendador já baixa e guarda), Sicredi como recurso. */
  private async loadBankSlipPdf(slip: {
    digitableLine: string | null;
    pdfFile: { path: string } | null;
  }): Promise<Buffer> {
    if (slip.pdfFile?.path && existsSync(slip.pdfFile.path)) {
      return readFileSync(slip.pdfFile.path);
    }
    if (!slip.digitableLine) {
      throw new Error('sem arquivo local e sem linha digitável');
    }
    return this.sicredi.downloadBoletoPdf(slip.digitableLine);
  }

  /**
   * Copia as páginas de um PDF para o container.
   *
   * Remove widgets de ASSINATURA das páginas copiadas: o `copyPages` arrasta as
   * anotações junto, e um campo /Sig órfão faria o visualizador anunciar uma
   * assinatura que não existe neste arquivo — exatamente a confusão que este
   * desenho quer evitar.
   */

  /**
   * IDENTIFICAÇÃO E NUMERAÇÃO EM TODA FOLHA NOSSA.
   *
   * O dossiê de um orçamento de quatro veículos é o orçamento (quatro folhas),
   * as fotos, quatro boletos e quatro notas: passa de quinze páginas. Sem nada
   * no pé, uma folha solta não diz de que dossiê é, quem lê não sabe em que
   * componente está, e a falta de uma página é indetectável.
   *
   * ⚠️ SÓ NAS NOSSAS. Boleto e NFS-e são documentos de terceiros (decisão 2):
   * escrever na folha deles seria alterar documento alheio dentro do nosso
   * invólucro — e a margem inferior de um boleto não é nossa para usar. Eles
   * aparecem nos MARCADORES, que não tocam no conteúdo.
   *
   * A contagem é a do DOSSIÊ inteiro ("Página 7 de 19"), não a do componente: o
   * que se procura ao folhear é onde se está no maço.
   *
   * ⚠️ A ALTURA NÃO É LIVRE — a folha do assinado JÁ TEM um rodapé.
   *
   * O montador do documento assinado escreve a faixa de verificação (envelope,
   * SHA-256, `pag. i/n`) a 12pt da borda, em corpo 6. Este carimbo estava a 5mm
   * = 14,17pt, em corpo 7: 2,17pt de distância para dois textos que precisam de
   * ~6. No orçamento nº 0984 as duas linhas saíram impressas UMA SOBRE A OUTRA,
   * ilegíveis, nas páginas 3 e 4.
   *
   * É a segunda vez que este bug aparece, e por caminhos diferentes — ver o
   * bloco "A PAGINAÇÃO NÃO É CARIMBADA AQUI" em `quote-renderer.service.ts`,
   * que o corrigiu no orçamento nº 0594 removendo um carimbo do RENDERIZADOR.
   * O dossiê depois acrescentou o seu na mesma altura e o reintroduziu. Daí a
   * constante nomeada: quem for mexer no pé de uma folha nossa precisa esbarrar
   * no motivo antes de escolher um número.
   *
   * 24pt deixa ~6pt de respiro sobre a faixa e continua dentro da margem
   * inferior de TODO componente nosso — 25mm no orçamento renderizado pelo
   * Chromium, 50pt nas folhas de pdf-lib (fotos, aditivo), 60pt na trilha
   * consolidada.
   */
  private async stampDossierPages(
    container: PDFDocument,
    budgetNumber: number,
    placed: Array<{ component: DossierComponent; firstPage: number; ours: boolean }>,
  ): Promise<void> {
    const total = container.getPageCount();
    if (total <= 1) return; // uma folha não se perde no meio de nada

    const font = await container.embedFont(StandardFonts.Helvetica);
    const size = 7;
    const gray = rgb(0.45, 0.45, 0.45);
    const pages = container.getPages();

    for (const entry of placed) {
      if (!entry.ours) continue;
      for (let i = 0; i < entry.component.pages; i++) {
        const index = entry.firstPage + i;
        const page = pages[index];
        if (!page) continue;
        const label =
          `Dossiê · Orçamento nº ${String(budgetNumber).padStart(4, '0')} · ` +
          `${DOSSIER_KIND_LABEL[entry.component.kind] ?? entry.component.kind} · ` +
          `Página ${index + 1} de ${total}`;
        const width = font.widthOfTextAtSize(label, size);
        page.drawText(label, {
          x: (page.getWidth() - width) / 2,
          y: DOSSIER_STAMP_Y,
          size,
          font,
          color: gray,
        });
      }
    }
  }

  /**
   * MARCADORES (a árvore lateral do leitor de PDF), um por componente.
   *
   * É a navegação que um documento de vinte páginas precisa e a única que não
   * custa uma folha: a decisão 4 recusou a CAPA, e com razão — o que o cliente
   * recebe é orçamento, fotos, nota e boleto, não um sumário administrativo.
   * Marcador é invisível até ser usado e funciona em todo leitor sério,
   * inclusive no celular, que é onde isto é aberto.
   *
   * Montado à mão porque o pdf-lib não tem API de outline: `/Outlines` é um
   * dicionário com lista duplamente encadeada de itens, cada um apontando para
   * a página por `/Dest [page /Fit]`.
   */
  private addOutline(
    container: PDFDocument,
    placed: Array<{ component: DossierComponent; firstPage: number }>,
  ): void {
    if (placed.length < 2) return; // um componente só não tem o que navegar

    const context = container.context;
    const pages = container.getPages();
    const outlinesRef = context.nextRef();

    const itemRefs = placed.map(() => context.nextRef());
    placed.forEach((entry, i) => {
      const page = pages[entry.firstPage];
      if (!page) return;
      const dict = new Map<PDFName, any>();
      dict.set(PDFName.of('Title'), context.obj(entry.component.label));
      dict.set(PDFName.of('Parent'), outlinesRef);
      if (i > 0) dict.set(PDFName.of('Prev'), itemRefs[i - 1]);
      if (i < placed.length - 1) dict.set(PDFName.of('Next'), itemRefs[i + 1]);
      dict.set(
        PDFName.of('Dest'),
        context.obj([page.ref, PDFName.of('Fit')]),
      );
      context.assign(itemRefs[i], PDFDict.fromMapWithContext(dict, context));
    });

    const outlines = new Map<PDFName, any>();
    outlines.set(PDFName.of('Type'), PDFName.of('Outlines'));
    outlines.set(PDFName.of('First'), itemRefs[0]);
    outlines.set(PDFName.of('Last'), itemRefs[itemRefs.length - 1]);
    outlines.set(PDFName.of('Count'), context.obj(placed.length));
    context.assign(outlinesRef, PDFDict.fromMapWithContext(outlines, context));
    container.catalog.set(PDFName.of('Outlines'), outlinesRef);
  }

  private async appendPdf(
    container: PDFDocument,
    bytes: Buffer,
    component: DossierComponent,
    /**
     * Copiar só as N PRIMEIRAS folhas. Usado pelo recorte selado, cujo fim é a
     * trilha congelada — ver `bodyPageCount`. Ausente ou maior que o arquivo
     * copia tudo: cortar é decisão de quem chama, e o piso é o arquivo inteiro.
     */
    maxPages?: number,
  ): Promise<number> {
    try {
      const src = await PDFDocument.load(bytes, {
        updateMetadata: false,
        // Boletos e NFS-e de terceiros às vezes vêm com criptografia de dono
        // (sem senha de abertura). Sem isto o pdf-lib recusa o arquivo inteiro.
        ignoreEncryption: true,
      });
      const indices = src.getPageIndices();
      const wanted =
        maxPages && maxPages > 0 && maxPages < indices.length
          ? indices.slice(0, maxPages)
          : indices;
      const pages = await container.copyPages(src, wanted);
      for (const page of pages) {
        stripSignatureWidgets(page.node);
        container.addPage(page);
      }
      return pages.length;
    } catch (error) {
      component.included = false;
      component.note = `arquivo não pôde ser lido (${msg(error)})`;
      this.logger.warn(`Componente "${component.label}" fora do dossiê: ${msg(error)}`);
      return 0;
    }
  }

  /**
   * MESMA fonte do `webBase()` do SignatureEnvelopeService, e na mesma ordem.
   * O rodapé impresso em cada página do orçamento assinado já aponta para esta
   * base; a capa apontando para outra faria o mesmo envelope ter dois endereços
   * de verificação no mesmo PDF.
   */
  private publicBaseUrl(): string {
    const base =
      this.config.get<string>('SIGNATURE_WEB_URL') ||
      this.config.get<string>('WEB_APP_URL') ||
      COMPANY.websiteUrl;
    return base.replace(/\/+$/, '');
  }
}

// -----------------------------------------------------------------------------

/** Retângulo com os QUATRO cantos arredondados (SVG usa Y para baixo). */
function roundedRectAllPath(w: number, h: number, r: number): string {
  return [
    `M ${r} 0`,
    `L ${w - r} 0`,
    `A ${r} ${r} 0 0 1 ${w} ${r}`,
    `L ${w} ${h - r}`,
    `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
    `L ${r} ${h}`,
    `A ${r} ${r} 0 0 1 0 ${h - r}`,
    `L 0 ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    'Z',
  ].join(' ');
}

/** Só os cantos de BAIXO arredondados — o corpo branco sob a barra verde. */
function roundedRectBottomPath(w: number, h: number, r: number): string {
  return [
    `M 0 0`,
    `L ${w} 0`,
    `L ${w} ${h - r}`,
    `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
    `L ${r} ${h}`,
    `A ${r} ${r} 0 0 1 0 ${h - r}`,
    'Z',
  ].join(' ');
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function msg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Remove anotações de campo de assinatura de uma página copiada. */
function stripSignatureWidgets(pageNode: PDFDict): void {
  try {
    const annots = pageNode.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) return;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = pageNode.context.lookupMaybe(annots.get(i), PDFDict);
      if (!annot) continue;
      const ft = annot.lookup(PDFName.of('FT'));
      const subtype = annot.lookup(PDFName.of('Subtype'));
      const isSigWidget =
        ft === PDFName.of('Sig') || (subtype === PDFName.of('Widget') && String(ft) === '/Sig');
      if (isSigWidget) annots.remove(i);
    }
  } catch {
    // Uma anotação exótica não pode derrubar o dossiê inteiro.
  }
}
