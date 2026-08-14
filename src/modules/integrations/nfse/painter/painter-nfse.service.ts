/**
 * Emissão da NFS-e do aerografista.
 *
 * O aerografista (MEI) é o PRESTADOR e a Ankaa é a TOMADORA — inverso do
 * `NfseDocument`/Elotech, onde a Ankaa presta para o Customer.
 *
 * ─── O contrato de idempotência ───
 * Sete caminhos distintos concluem uma aerografia, dois deles escrevendo direto
 * em `tx.airbrushing.*` dentro do TaskService, e a reabertura
 * (COMPLETED → IN_PRODUCTION → COMPLETED) é permitida. Nada disso pode gerar duas
 * notas. A trava é a linha `AirbrushingNfse`, cuja coluna `airbrushingId` é
 * UNIQUE: registrar intenção é um upsert que não faz nada se já existe, e a
 * emissão em si só avança para quem conseguir reivindicar a linha
 * (PENDING|ERROR → PROCESSING) com `updateMany` retornando count === 1.
 *
 * ─── Transação ───
 * A intenção nasce DENTRO da transação que conclui a aerografia; a chamada à
 * SEFIN acontece SEMPRE fora. Chamada externa dentro de transação Prisma segura
 * conexão do pool pelo tempo de rede e é justamente o que a convenção do
 * repositório evita (task-quote.service.ts faz o mesmo com boletos).
 *
 * ─── Numeração ───
 * O nDPS é alocado UMA vez e reaproveitado nas retentativas. Isso é o que permite
 * perguntar à SEFIN "essa DPS já virou nota?" (GET /dps/{id}) quando a resposta se
 * perde: com número novo a cada tentativa, uma resposta perdida viraria duplicidade.
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_ACTION, CHANGE_TRIGGERED_BY, ENTITY_TYPE } from '@constants/enums';
import { COMPANY } from '@config/company';
import { AirbrushingStatus, FiscalDocumentStatus, NfseStatus, type Prisma } from '@prisma/client';
import { FiscalCertificateService } from './fiscal-certificate.service';
import { DpsSignerService } from './dps.signer';
import { SefinError, SefinNacionalClient, type NfseEnvironment } from './sefin-nacional.client';
import {
  CANCEL_REASON,
  buildCancelEventXml,
  buildDpsId,
  buildDpsXml,
  buildServiceDescription,
} from './dps.builder';
import { PainterNfseArtifactsService } from './painter-nfse-artifacts.service';

/** Código IBGE de Ibiporã-PR, onde fica a oficina — local da prestação. */
const COMPANY_MUNICIPALITY_IBGE = '4109807';

/**
 * Bloco do tomador (a Ankaa). O CNPJ é a identificação que importa; o endereço
 * é opcional e só entra quando há um CEP de ENTREGA válido.
 *
 * Um CEP geral de cidade (terminado em -000) não existe na base dos Correios
 * como CEP de entrega e faz a SEFIN recusar a nota com E0240. Por isso o grupo
 * é omitido quando o CEP não tem 8 dígitos, em vez de ir incompleto.
 * `NFSE_TOMADOR_CEP` existe como escape para corrigir sem alterar código.
 */
export function buildCompanyTomador() {
  const cep = (process.env.NFSE_TOMADOR_CEP || COMPANY.zipCode || '').replace(/\D/g, '');
  const temCepValido = cep.length === 8;

  return {
    cnpj: COMPANY.cnpj,
    nome: COMPANY.corporateName,
    email: COMPANY.email,
    ...(temCepValido
      ? {
          municipioIbge: COMPANY_MUNICIPALITY_IBGE,
          cep,
          logradouro: 'Rua Luis Carlos Zani',
          numero: '2493',
          bairro: 'Jardim Santa Paula',
        }
      : {}),
  };
}

/**
 * Backoff entre retentativas de falha TRANSITÓRIA, indexado pela tentativa já feita.
 *
 * Era um intervalo FIXO de 5 min com teto de 3 tentativas. Como a varredura roda a
 * cada 15 min, as três tentativas se esgotavam dentro de ~1 hora: qualquer queda da
 * SEFIN mais longa que isso matava PERMANENTEMENTE toda nota concluída na janela, e
 * elas só reapareciam no alerta das 08:00, exigindo intervenção manual. Emissão
 * fiscal depende de um terceiro que sai do ar por horas — o backoff tem de cobrir
 * isso sozinho.
 *
 * Esta curva cobre ~17h de indisponibilidade sem intervenção. Falha PERMANENTE
 * (rejeição de schema, E0041, E0240…) não entra aqui: continua com retryAfter null
 * na primeira ocorrência, porque retentar não cura erro de conteúdo.
 */
const RETRY_BACKOFF_MS = [
  5 * 60 * 1000, // 5 min
  15 * 60 * 1000, // 15 min
  60 * 60 * 1000, // 1 h
  4 * 60 * 60 * 1000, // 4 h
  12 * 60 * 60 * 1000, // 12 h
];
/** Teto de tentativas: a curva inteira mais a tentativa inicial. */
export const MAX_EMISSION_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;
/** Tempo em PROCESSING a partir do qual a linha é considerada presa. */
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

export interface EmissionOutcome {
  nfseId: string;
  status: 'AUTHORIZED' | 'SKIPPED' | 'ERROR';
  reason?: string;
  accessKey?: string;
}

@Injectable()
export class PainterNfseService {
  private readonly logger = new Logger(PainterNfseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certificates: FiscalCertificateService,
    private readonly signer: DpsSignerService,
    private readonly sefin: SefinNacionalClient,
    private readonly changeLogService: ChangeLogService,
    private readonly artifacts: PainterNfseArtifactsService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Registro de intenção
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Registra a intenção de emitir a nota de uma aerografia concluída.
   *
   * Chamado de dentro da transação que conclui a aerografia. É idempotente: se a
   * linha já existe (inclusive de uma conclusão anterior que foi reaberta), não
   * faz nada — em particular, NÃO reabre uma nota já autorizada.
   *
   * Não lança: uma falha aqui não pode impedir a aerografia de ser concluída.
   */
  /**
   * Data a partir da qual a emissão automática vale, vinda de
   * `PAINTER_NFSE_EMIT_FROM` (ISO-8601). Ausente ou inválida = sem corte, que é o
   * comportamento de uma instalação nova, sem histórico para trás.
   */
  private emitFromCutoff(): Date | null {
    const raw = process.env.PAINTER_NFSE_EMIT_FROM;
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      this.logger.warn(
        `[PAINTER_NFSE] PAINTER_NFSE_EMIT_FROM inválida ("${raw}") — ignorada, sem corte histórico.`,
      );
      return null;
    }
    return parsed;
  }

  /**
   * Cria a intenção de nota para uma emissão pedida À MÃO, mesmo que a aerografia
   * seja anterior ao corte histórico.
   *
   * O corte impede que trabalho antigo vire nota SOZINHO. Um operador que abre a
   * aerografia e clica em "Emitir" está declarando o contrário — e sem esta porta
   * ele receberia "não há intenção de NFS-e", sem nenhum caminho para emitir.
   */
  async ensureIntentForManualEmission(airbrushingId: string): Promise<void> {
    const airbrushing = await this.prisma.airbrushing.findUnique({
      where: { id: airbrushingId },
      select: { id: true, status: true, painterId: true },
    });
    if (!airbrushing) {
      throw new NotFoundException('Aerografia não encontrada.');
    }
    if (airbrushing.status !== AirbrushingStatus.COMPLETED) {
      throw new BadRequestException('Conclua a aerografia antes de emitir a NFS-e.');
    }

    await this.registerIntent(this.prisma as unknown as Prisma.TransactionClient, {
      airbrushingId,
      painterId: airbrushing.painterId ?? null,
      resetFailed: true,
      ignoreCutoff: true,
    });
  }

  async registerIntent(
    tx: Prisma.TransactionClient,
    params: {
      airbrushingId: string;
      painterId: string | null;
      /**
       * true apenas quando a aerografia ACABOU de entrar em COMPLETED. Uma
       * edição qualquer de aerografia já concluída não deve zerar o contador de
       * tentativas de uma nota que falhou por motivo permanente — senão cada
       * salvamento reabre três tentativas fadadas ao mesmo erro.
       */
      resetFailed: boolean;
      /**
       * Ignora o corte histórico. Só o pedido MANUAL de emissão usa isto: o corte
       * existe para impedir emissão retroativa AUTOMÁTICA, não para tirar do
       * operador a chance de emitir uma nota antiga que ele decidiu emitir.
       */
      ignoreCutoff?: boolean;
    },
  ): Promise<void> {
    try {
      const existing = await tx.airbrushingNfse.findUnique({
        where: { airbrushingId: params.airbrushingId },
        select: { id: true, status: true },
      });

      // ── Corte histórico ──────────────────────────────────────────────────
      // A emissão vale do corte para frente. Sem isto, ligar a chave num sistema
      // que já rodava anos emitiria nota retroativa de trabalho antigo: este
      // registro dispara em QUALQUER salvamento cujo status seja COMPLETED, não
      // só na transição, então bastava alguém abrir e salvar uma aerografia
      // concluída em 2025 para nascer uma NFS-e real com competência daquele mês.
      //
      // O corte só barra a CRIAÇÃO. Linha que já existe segue seu curso normal —
      // senão mexer no corte abandonaria notas legítimas no meio do caminho.
      if (!existing && !params.ignoreCutoff) {
        const cutoff = this.emitFromCutoff();
        if (cutoff) {
          const ab = await tx.airbrushing.findUnique({
            where: { id: params.airbrushingId },
            select: { finishedAt: true, createdAt: true },
          });
          // finishedAt é a referência; quando ele falta (linhas antigas que
          // concluíram sem carimbo) o createdAt evita liberar por omissão.
          const reference = ab?.finishedAt ?? ab?.createdAt ?? null;
          if (reference && reference < cutoff) {
            this.logger.log(
              `[PAINTER_NFSE] Aerografia ${params.airbrushingId} concluída em ${reference.toISOString()} é anterior ao corte ${cutoff.toISOString()} — sem emissão retroativa.`,
            );
            return;
          }
        }
      }

      if (existing) {
        // Reabrir e reconcluir uma aerografia cuja nota falhou dá nova chance;
        // se já foi autorizada ou está em voo, não se toca.
        if (params.resetFailed && existing.status === NfseStatus.ERROR) {
          await tx.airbrushingNfse.update({
            where: { id: existing.id },
            data: { status: NfseStatus.PENDING, retryAfter: null, errorCount: 0 },
          });
        }
        return;
      }

      const profile = params.painterId
        ? await tx.fiscalEmitterProfile.findUnique({
            where: { userId: params.painterId },
            select: { id: true, environment: true },
          })
        : null;

      await tx.airbrushingNfse.create({
        data: {
          airbrushingId: params.airbrushingId,
          painterId: params.painterId,
          profileId: profile?.id ?? null,
          environment: profile?.environment ?? 2,
          status: NfseStatus.PENDING,
        },
      });
    } catch (error) {
      // Corrida entre dois caminhos de conclusão cai no unique e é benigna.
      this.logger.warn(
        `[PAINTER_NFSE] Não foi possível registrar intenção para aerografia ${params.airbrushingId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Emissão
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Emissão imediata depois de uma conclusão JÁ COMMITADA — o gancho único que
   * todo caminho de conclusão chama.
   *
   * Existe porque a conclusão acontece em quatro lugares (`update`, `create`,
   * `batchUpdate` e `batchCreate` do AirbrushingService) mais dois `tx.airbrushing.*`
   * crus dentro do TaskService, e cada um deles repetia — ou esquecia — as três
   * regras que valem aqui:
   *
   *  1. NUNCA dentro de `$transaction`. É chamada de rede: seguraria uma conexão do
   *     pool pelo tempo da SEFIN e, num timeout, derrubaria a conclusão junto.
   *  2. A MESMA trava mestra do cron (`PAINTER_NFSE_SCHEDULER_ENABLED`). Se o inline
   *     passasse por cima dela, desligar a trava não pararia a emissão automática —
   *     só a atrasaria até alguém concluir uma aerografia, que é a pior forma
   *     possível de uma trava falhar. Desligada, a intenção fica registrada e
   *     visível, e o botão "Reemitir" continua funcionando.
   *  3. Falha é engolida. A linha PENDING sobrevive e a varredura de 15 minutos
   *     assume; o inline existe só para a nota aparecer na hora.
   *
   * O TaskService chamava `registerIntent` e parava aí, então concluir uma aerografia
   * pelo formulário da TAREFA só emitia na varredura seguinte, enquanto a mesma
   * conclusão pelo app do pintor emitia na hora.
   */
  async flushAfterCompletion(airbrushingIds: string[]): Promise<void> {
    if (airbrushingIds.length === 0) return;
    if (process.env.PAINTER_NFSE_SCHEDULER_ENABLED !== 'true') return;

    try {
      await this.emitForAirbrushings(airbrushingIds);
    } catch (error) {
      this.logger.warn(
        `[PAINTER_NFSE] Emissão imediata falhou (a varredura tentará novamente): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Emite as notas das aerografias indicadas. Nunca lança — devolve o resultado por linha. */
  async emitForAirbrushings(airbrushingIds: string[]): Promise<EmissionOutcome[]> {
    if (airbrushingIds.length === 0) return [];

    const rows = await this.prisma.airbrushingNfse.findMany({
      where: { airbrushingId: { in: airbrushingIds } },
      select: { id: true },
    });

    const outcomes: EmissionOutcome[] = [];
    for (const row of rows) {
      outcomes.push(await this.emit(row.id));
    }
    return outcomes;
  }

  /**
   * Prepara a linha para uma NOVA emissão depois de um cancelamento.
   *
   * Cancelar não desfaz o serviço: a aerografia continua concluída e ainda
   * precisa de nota. Sem isto, "Reemitir" numa nota cancelada não fazia nada —
   * o `emit()` devolvia SKIPPED e a tela não explicava por quê.
   *
   * A nota cancelada NÃO se perde: o XML, o DANFSe e o documento fiscal são
   * registros próprios e continuam arquivados; a chave cancelada fica no
   * changelog. O que se limpa aqui é só o vínculo da LINHA, para que a nova
   * emissão receba numeração nova — reaproveitar o nDPS anterior seria pedir
   * uma duplicidade (E0014).
   */
  async prepareReissue(nfseId: string): Promise<{ prepared: boolean; message?: string }> {
    const row = await this.prisma.airbrushingNfse.findUnique({
      where: { id: nfseId },
      select: { id: true, status: true, accessKey: true },
    });
    if (!row) return { prepared: false, message: 'NFS-e não encontrada.' };
    if (row.status !== NfseStatus.CANCELLED) {
      return { prepared: false, message: 'Só uma nota cancelada precisa ser preparada para reemissão.' };
    }

    await this.prisma.airbrushingNfse.update({
      where: { id: nfseId },
      data: {
        status: NfseStatus.PENDING,
        dpsId: null,
        nDps: null,
        serie: null,
        accessKey: null,
        nfseNumber: null,
        nfseXml: null,
        dpsXml: null,
        issuedAt: null,
        alerts: undefined,
        errorMessage: null,
        errorCode: null,
        errorCount: 0,
        retryAfter: null,
        // Os artefatos da nota cancelada continuam existindo como File e
        // FiscalDocument; aqui só se solta o vínculo desta linha com eles.
        pdfFileId: null,
        xmlFileId: null,
        fiscalDocumentId: null,
        cancelledAt: null,
        cancelReasonCode: null,
        cancelReason: null,
        cancelEventXml: null,
      },
    });

    await this.logChange(
      nfseId,
      CHANGE_ACTION.UPDATE,
      `Preparada para reemissão após cancelamento da chave ${row.accessKey ?? '(sem chave)'}`,
    );

    return { prepared: true };
  }

  /**
   * Emite uma nota. É a ÚNICA autoridade de reivindicação — tanto a chamada
   * inline quanto a varredura passam por aqui, e por isso não podem duplicar.
   */
  async emit(nfseId: string): Promise<EmissionOutcome> {
    const current = await this.prisma.airbrushingNfse.findUnique({
      where: { id: nfseId },
      select: { id: true, status: true, accessKey: true },
    });

    if (!current) {
      return { nfseId, status: 'SKIPPED', reason: 'NOT_FOUND' };
    }
    if (current.status === NfseStatus.AUTHORIZED) {
      return { nfseId, status: 'SKIPPED', reason: 'ALREADY_AUTHORIZED', accessKey: current.accessKey ?? undefined };
    }
    if (current.status === NfseStatus.CANCELLED) {
      return { nfseId, status: 'SKIPPED', reason: 'CANCELLED' };
    }
    if (current.status === NfseStatus.PROCESSING) {
      return { nfseId, status: 'SKIPPED', reason: 'ALREADY_PROCESSING' };
    }

    // A reivindicação. Só quem levar count === 1 segue adiante.
    const claim = await this.prisma.airbrushingNfse.updateMany({
      where: { id: nfseId, status: { in: [NfseStatus.PENDING, NfseStatus.ERROR] } },
      data: { status: NfseStatus.PROCESSING, lastAttemptAt: new Date(), errorMessage: null },
    });
    if (claim.count !== 1) {
      return { nfseId, status: 'SKIPPED', reason: 'CLAIM_FAILED' };
    }

    try {
      return await this.performEmission(nfseId);
    } catch (error) {
      const permanent = error instanceof SefinError ? error.permanent : false;
      const code = error instanceof SefinError ? error.code : null;
      const message = error instanceof Error ? error.message : String(error);
      await this.markError(nfseId, message, code, permanent);
      this.logger.error(
        `[PAINTER_NFSE] Falha ao emitir ${nfseId} (${permanent ? 'permanente' : 'transitória'}): ${message}`,
      );
      return { nfseId, status: 'ERROR', reason: message };
    }
  }

  private async performEmission(nfseId: string): Promise<EmissionOutcome> {
    const row = await this.prisma.airbrushingNfse.findUniqueOrThrow({
      where: { id: nfseId },
      include: {
        airbrushing: {
          select: {
            id: true,
            status: true,
            price: true,
            description: true,
            finishedAt: true,
            finishDate: true,
            task: {
              select: {
                id: true,
                name: true,
                serialNumber: true,
                customer: { select: { fantasyName: true, corporateName: true } },
                truck: {
                  select: {
                    plate: true,
                    chassisNumber: true,
                    category: true,
                    implementType: true,
                  },
                },
              },
            },
          },
        },
        profile: true,
      },
    });

    const airbrushing = row.airbrushing;

    // ── Pré-condições. Todas permanentes: não se curam com retentativa. ──
    if (airbrushing.status !== AirbrushingStatus.COMPLETED) {
      throw new SefinError(
        'A aerografia não está concluída — a nota só é emitida após a conclusão.',
        true,
      );
    }
    if (!airbrushing.price || airbrushing.price <= 0) {
      throw new SefinError('A aerografia não tem preço definido — sem valor não há nota.', true);
    }
    if (!row.painterId) {
      throw new SefinError('A aerografia não tem pintor atribuído.', true);
    }

    const profile =
      row.profile ??
      (await this.prisma.fiscalEmitterProfile.findUnique({ where: { userId: row.painterId } }));

    if (!profile) {
      throw new SefinError(
        'O pintor não tem perfil fiscal cadastrado (CNPJ, município e código de serviço).',
        true,
      );
    }
    if (!profile.emissionEnabled) {
      throw new SefinError(
        'A emissão automática está desligada para este pintor. Habilite no perfil fiscal depois de validar em homologação.',
        true,
      );
    }

    const certificate = await this.certificates.getActive(profile.id);
    if (!certificate) {
      throw new SefinError('O pintor não tem certificado digital A1 cadastrado.', true);
    }
    if (certificate.isExpired) {
      throw new SefinError(
        `O certificado digital do pintor venceu em ${certificate.notAfter.toLocaleDateString('pt-BR')}.`,
        true,
      );
    }

    // Amarra o perfil à linha, caso a intenção tenha nascido sem ele.
    if (!row.profileId) {
      await this.prisma.airbrushingNfse.update({
        where: { id: nfseId },
        data: { profileId: profile.id, environment: profile.environment },
      });
    }

    const environment = (profile.environment === 1 ? 1 : 2) as NfseEnvironment;
    const { material, agent } = await this.certificates.getSigningContext(certificate.id);

    // ── Numeração: reaproveita a já alocada; só numera na primeira vez. ──
    let serie = row.serie ?? profile.serie;
    let nDps = row.nDps;
    let dpsId = row.dpsId;

    if (nDps === null || !dpsId) {
      const allocated = await this.allocateDpsNumber(profile.id, profile.serie, environment);
      serie = profile.serie;
      nDps = allocated;
      dpsId = buildDpsId({
        municipioIbge: profile.municipalityIbgeCode,
        documento: profile.cnpj,
        serie,
        nDps: allocated,
      });
      await this.prisma.airbrushingNfse.update({
        where: { id: nfseId },
        data: { serie, nDps, dpsId },
      });
    } else if (row.errorCount > 0) {
      // Retentativa com número já alocado: pode ser que a tentativa anterior
      // tenha chegado e só a resposta se perdido. Perguntar antes de reenviar
      // é o que evita nota duplicada.
      const found = await this.sefin
        .findByDpsId({ environment, agent, dpsId })
        .catch(() => null);
      if (found?.chaveAcesso) {
        this.logger.warn(
          `[PAINTER_NFSE] DPS ${dpsId} já havia sido autorizada na SEFIN — vinculando em vez de reemitir.`,
        );
        return this.linkExisting(nfseId, environment, agent, found.chaveAcesso, certificate.id);
      }
    }

    // ── Monta, assina, envia ──
    const competence = airbrushing.finishedAt ?? airbrushing.finishDate ?? new Date();

    const built = buildDpsXml({
      ambiente: environment,
      emitidoEm: new Date(),
      competencia: competence,
      serie,
      nDps,
      emitente: {
        cnpj: profile.cnpj,
        inscricaoMunicipal: profile.municipalRegistration,
        municipioIbge: profile.municipalityIbgeCode,
        opSimpNac: profile.opSimpNac,
        regEspTrib: profile.regEspTrib,
      },
      tomador: buildCompanyTomador(),
      servico: {
        // O serviço é executado na oficina, em Ibiporã. Para o código 141201 o
        // ISS incide no domicílio do PRESTADOR de qualquer forma (regra E1325),
        // então este campo não muda a tributação — só descreve o fato.
        municipioPrestacaoIbge: COMPANY_MUNICIPALITY_IBGE,
        cTribNac: profile.cTribNac,
        cTribMun: profile.cTribMun,
        descricao: buildServiceDescription(profile.serviceDescription, airbrushing),
      },
      valorServico: airbrushing.price,
    });

    const { signedXml, packed } = this.signer.signAndPack(built.xml, material, 'infDPS');

    const result = await this.sefin.emit({
      environment,
      agent,
      dpsXmlGZipB64: packed,
    });

    const updated = await this.prisma.airbrushingNfse.update({
      where: { id: nfseId },
      data: {
        status: NfseStatus.AUTHORIZED,
        accessKey: result.chaveAcesso,
        nfseNumber: this.extractNfseNumber(result.nfseXml),
        issuedAt: new Date(),
        competence,
        serviceAmount: airbrushing.price,
        dpsXml: signedXml,
        nfseXml: result.nfseXml || null,
        alerts: result.alertas.length ? (result.alertas as Prisma.InputJsonValue) : undefined,
        certificateId: certificate.id,
        environment,
        errorMessage: null,
        errorCode: null,
        errorCount: 0,
        retryAfter: null,
      },
    });

    await this.logChange(
      updated.id,
      CHANGE_ACTION.CREATE,
      `NFS-e emitida pelo aerografista — chave ${result.chaveAcesso}`,
    );

    // Arquiva XML, DANFSe e documento fiscal. Best-effort de propósito: a nota
    // já está autorizada e é irreversível — falhar ao gerar um PDF não pode
    // transformar uma emissão bem-sucedida em erro. O que faltar é refeito no
    // próximo `persist`, que é idempotente.
    await this.artifacts.persist(nfseId).catch(error => {
      this.logger.warn(
        `[PAINTER_NFSE] Arquivamento dos artefatos falhou (a nota está emitida): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    this.logger.log(
      `[PAINTER_NFSE] Nota autorizada para aerografia ${airbrushing.id}: chave ${result.chaveAcesso} (ambiente ${environment}).`,
    );

    return { nfseId, status: 'AUTHORIZED', accessKey: result.chaveAcesso };
  }

  /**
   * Aloca o próximo nDPS de forma transacional.
   *
   * `upsert` + `increment` numa transação própria e curta: o contador não pode
   * ficar preso à transação longa da emissão, e dois emissores concorrentes do
   * mesmo perfil precisam serializar aqui.
   */
  private async allocateDpsNumber(
    profileId: string,
    serie: string,
    environment: NfseEnvironment,
  ): Promise<bigint> {
    return this.prisma.$transaction(async tx => {
      const sequence = await tx.fiscalDpsSequence.upsert({
        where: { profileId_serie_environment: { profileId, serie, environment } },
        create: { profileId, serie, environment, lastNumber: BigInt(1) },
        update: { lastNumber: { increment: 1 } },
      });
      return sequence.lastNumber;
    });
  }

  /** Vincula uma nota que já existia na SEFIN (resposta perdida na tentativa anterior). */
  private async linkExisting(
    nfseId: string,
    environment: NfseEnvironment,
    agent: import('node:https').Agent,
    chaveAcesso: string,
    certificateId: string,
  ): Promise<EmissionOutcome> {
    const queried = await this.sefin
      .query({ environment, agent, chaveAcesso })
      .catch(() => ({ chaveAcesso, nfseXml: '' }));

    await this.prisma.airbrushingNfse.update({
      where: { id: nfseId },
      data: {
        status: NfseStatus.AUTHORIZED,
        accessKey: chaveAcesso,
        nfseNumber: this.extractNfseNumber(queried.nfseXml),
        nfseXml: queried.nfseXml || null,
        issuedAt: new Date(),
        certificateId,
        errorMessage: null,
        errorCode: null,
        errorCount: 0,
        retryAfter: null,
      },
    });

    await this.logChange(
      nfseId,
      CHANGE_ACTION.UPDATE,
      `NFS-e reconciliada com a SEFIN — chave ${chaveAcesso}`,
    );

    return { nfseId, status: 'AUTHORIZED', accessKey: chaveAcesso };
  }

  /** Número da NFS-e dentro do XML autorizado (infNFSe/nNFSe). */
  private extractNfseNumber(nfseXml: string): string | null {
    if (!nfseXml) return null;
    return nfseXml.match(/<nNFSe>\s*([^<]+?)\s*<\/nNFSe>/)?.[1]?.trim() ?? null;
  }

  private async markError(
    nfseId: string,
    message: string,
    code: string | null,
    permanent: boolean,
  ): Promise<void> {
    // Lê o contador ANTES para escolher o degrau do backoff: `increment` não devolve
    // o valor novo a tempo de compor o retryAfter no mesmo write. É o caminho de
    // erro, de volume baixo — a leitura extra não pesa.
    const current = await this.prisma.airbrushingNfse
      .findUnique({ where: { id: nfseId }, select: { errorCount: true } })
      .catch(() => null);
    const attempt = (current?.errorCount ?? 0) + 1;
    const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)];

    await this.prisma.airbrushingNfse
      .update({
        where: { id: nfseId },
        data: {
          status: NfseStatus.ERROR,
          errorMessage: message.slice(0, 1000),
          errorCode: code,
          errorCount: { increment: 1 },
          // retryAfter null tira a linha da janela da varredura para sempre:
          // é como um erro permanente para de queimar tentativa mas continua
          // visível como ERROR na tela.
          retryAfter: permanent ? null : new Date(Date.now() + backoff),
          lastAttemptAt: new Date(),
        },
      })
      .catch(() => undefined);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Varreduras
  // ───────────────────────────────────────────────────────────────────────────

  /** Linhas elegíveis à varredura de emissão. */
  async findPending(limit = 50): Promise<{ id: string }[]> {
    const now = new Date();
    return this.prisma.airbrushingNfse.findMany({
      where: {
        OR: [
          { status: NfseStatus.PENDING },
          {
            status: NfseStatus.ERROR,
            errorCount: { lt: MAX_EMISSION_ATTEMPTS },
            retryAfter: { lte: now },
          },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Destrava linhas paradas em PROCESSING.
   *
   * Um crash entre a reivindicação e a resposta deixa a linha em PROCESSING para
   * sempre: sem erro, sem retentativa e sem botão. Aqui perguntamos à SEFIN se
   * aquela DPS virou nota — se virou, vincula; se não, volta para PENDING.
   */
  async recoverStuck(): Promise<{ linked: number; reset: number }> {
    const threshold = new Date(Date.now() - STUCK_THRESHOLD_MS);
    const stuck = await this.prisma.airbrushingNfse.findMany({
      where: { status: NfseStatus.PROCESSING, updatedAt: { lte: threshold } },
      select: { id: true, dpsId: true, environment: true, profileId: true },
      take: 25,
    });

    let linked = 0;
    let reset = 0;

    for (const row of stuck) {
      try {
        if (!row.dpsId || !row.profileId) {
          await this.prisma.airbrushingNfse.update({
            where: { id: row.id },
            data: { status: NfseStatus.PENDING },
          });
          reset += 1;
          continue;
        }

        const certificate = await this.certificates.getActive(row.profileId);
        if (!certificate || certificate.isExpired) {
          await this.prisma.airbrushingNfse.update({
            where: { id: row.id },
            data: { status: NfseStatus.PENDING },
          });
          reset += 1;
          continue;
        }

        const { agent } = await this.certificates.getSigningContext(certificate.id);
        const environment = (row.environment === 1 ? 1 : 2) as NfseEnvironment;
        const found = await this.sefin.findByDpsId({ environment, agent, dpsId: row.dpsId });

        if (found?.chaveAcesso) {
          await this.linkExisting(row.id, environment, agent, found.chaveAcesso, certificate.id);
          linked += 1;
        } else {
          await this.prisma.airbrushingNfse.update({
            where: { id: row.id },
            data: { status: NfseStatus.PENDING },
          });
          reset += 1;
        }
      } catch (error) {
        this.logger.warn(
          `[PAINTER_NFSE] Recuperação falhou para ${row.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { linked, reset };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Cancelamento
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Cancela uma NFS-e autorizada (evento e101101).
   *
   * O prazo NÃO é nacional: a regra E0822 delega ao "prazo limite conforme
   * parametrização do município emissor". Por isso não há validação de janela
   * aqui — quem diz que passou do prazo é a SEFIN.
   */
  async cancel(params: {
    nfseId: string;
    reasonCode: number;
    reason: string;
    userId?: string | null;
  }): Promise<{ cancelled: boolean; message?: string }> {
    const row = await this.prisma.airbrushingNfse.findUniqueOrThrow({
      where: { id: params.nfseId },
      include: { profile: true },
    });

    if (row.status !== NfseStatus.AUTHORIZED) {
      return { cancelled: false, message: 'Só é possível cancelar uma nota autorizada.' };
    }
    if (!row.accessKey || !row.profile) {
      return { cancelled: false, message: 'Nota sem chave de acesso ou sem emitente.' };
    }
    if (![CANCEL_REASON.ERRO_NA_EMISSAO, CANCEL_REASON.SERVICO_NAO_PRESTADO, CANCEL_REASON.OUTROS].includes(
      params.reasonCode as 1 | 2 | 9,
    )) {
      return { cancelled: false, message: 'Motivo de cancelamento inválido.' };
    }
    if (params.reason.trim().length < 15) {
      return { cancelled: false, message: 'A justificativa precisa ter ao menos 15 caracteres.' };
    }

    const certificate = await this.certificates.getActive(row.profile.id);
    if (!certificate) {
      return { cancelled: false, message: 'O pintor não tem certificado ativo para assinar o cancelamento.' };
    }

    const { material, agent } = await this.certificates.getSigningContext(certificate.id);
    const environment = (row.environment === 1 ? 1 : 2) as NfseEnvironment;

    const event = buildCancelEventXml({
      ambiente: environment,
      chaveAcesso: row.accessKey,
      cnpjAutor: row.profile.cnpj,
      ocorridoEm: new Date(),
      descricao: 'Cancelamento de NFS-e',
      motivoCodigo: params.reasonCode,
      motivo: params.reason.trim().slice(0, 255),
    });

    const { signedXml, packed } = this.signer.signAndPack(event.xml, material, 'infPedReg');

    try {
      await this.sefin.registerEvent({
        environment,
        agent,
        chaveAcesso: row.accessKey,
        eventXmlGZipB64: packed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { cancelled: false, message };
    }

    const cancelledAt = new Date();

    await this.prisma.airbrushingNfse.update({
      where: { id: row.id },
      data: {
        status: NfseStatus.CANCELLED,
        cancelledAt,
        cancelReasonCode: params.reasonCode,
        cancelReason: params.reason.trim(),
        cancelEventXml: signedXml,
      },
    });

    // O documento fiscal gerado a partir desta nota tem de acompanhar o
    // cancelamento. Sem isto ele continua AUTHORIZED e a tela de Notas Fiscais
    // mostra como autorizada uma nota que já foi cancelada — e a conciliação
    // segue considerando o valor como devido.
    if (row.fiscalDocumentId) {
      await this.prisma.fiscalDocument
        .update({
          where: { id: row.fiscalDocumentId },
          data: { status: FiscalDocumentStatus.CANCELLED, cancelledAt },
        })
        .catch(error =>
          this.logger.warn(
            `[PAINTER_NFSE] Não foi possível marcar o documento fiscal ${row.fiscalDocumentId} como cancelado: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
    }

    await this.logChange(
      row.id,
      CHANGE_ACTION.CANCEL,
      `NFS-e cancelada — ${params.reason.trim()}`,
      params.userId ?? null,
    );

    return { cancelled: true };
  }

  private async logChange(
    nfseId: string,
    action: CHANGE_ACTION,
    reason: string,
    userId: string | null = null,
  ): Promise<void> {
    try {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.AIRBRUSHING_NFSE,
        entityId: nfseId,
        action,
        field: null,
        oldValue: null,
        newValue: null,
        reason,
        // userId precisa ser null (e não 'system'): é FK para User, e sentinela
        // de texto já derrubou transação com P2025 neste repositório.
        triggeredBy: userId ? CHANGE_TRIGGERED_BY.USER_ACTION : CHANGE_TRIGGERED_BY.SYSTEM,
        triggeredById: nfseId,
        userId,
      });
    } catch (error) {
      this.logger.warn(
        `[PAINTER_NFSE] Changelog falhou para ${nfseId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
