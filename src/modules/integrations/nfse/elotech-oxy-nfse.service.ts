import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ElotechOxyAuthService, ElotechCity } from './elotech-oxy-auth.service';
import axios from 'axios';
import { NfseStatus } from '@prisma/client';

export interface MunicipalEmitNfseInput {
  id: string;
  totalAmount: number;
  customer: {
    cnpj?: string;
    cpf?: string;
    name: string;
    corporateName?: string;
    email?: string;
    phone?: string;
    address?: {
      cityName?: string;
      state?: string;
      zipCode: string;
      street: string;
      number: string;
      complement?: string;
      neighborhood: string;
    };
  };
  task: {
    id: string;
    name: string;
    serialNumber?: string;
  };
  truck?: {
    plate?: string;
    chassisNumber?: string;
    category?: string; // TruckCategory enum value
    implementType?: string; // ImplementType enum value
  };
  orderNumber?: string; // Customer's purchase order number
  services?: Array<{
    description: string;
    amount: number;
  }>;
  /** Global customer discount — distributed proportionally across services for NFSe line items */
  globalDiscount?: {
    type: string; // 'PERCENTAGE' | 'FIXED_VALUE'
    value: number;
  };
  description?: string;
}

/** Live cancellation state of a note at Elotech (note situação + request lifecycle). */
export interface ElotechCancellationState {
  notaSituacao: string;
  notaCancelada: boolean;
  numeroNotaFiscal: number | null;
  request: null | {
    id: number | null;
    /** AGUARDANDO_FISCAL | AUTORIZADO | REJEITADO */
    ultimoStatus: string | null;
    motivo: string | null;
    data: string | null;
    codigoMotivoSituacao: number | null;
    historicos: Array<{
      data: string | null;
      status: string | null;
      descricaoStatus: string | null;
      motivo: string | null;
    }>;
  };
}

/** Outcome of a cancellation request, reflecting the REAL post-submit state at the prefeitura. */
export interface CancelNfseResult {
  /** note is confirmed CANCELADA at the prefeitura */
  cancelled: boolean;
  /** request is registered but awaiting fiscal approval (note still active) */
  pending: boolean;
  /** request was rejected by the fiscal (note still active) */
  rejected: boolean;
  status: NfseStatus;
  elotechNfseId: number;
  /** raw Elotech request status: AGUARDANDO_FISCAL | AUTORIZADO | REJEITADO | null */
  requestStatus: string | null;
  rejectionMessage: string | null;
}

@Injectable()
export class ElotechOxyNfseService {
  private readonly logger = new Logger(ElotechOxyNfseService.name);

  private readonly cnae: string;
  private readonly cnaeCodigo: string;
  private readonly cnaeDescricao: string;
  private readonly servicoLCId: string;
  private readonly servicoLCAliquota: number;
  private readonly servicoLCDescricao: string;
  private readonly servicoLCLocalIncidencia: number;
  private readonly servicoLCTipoServico: number;
  private readonly idServico: number;
  private readonly emissionCityId: number;
  private readonly emissionCityIBGE: number;
  private readonly emissionCityName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly authService: ElotechOxyAuthService,
  ) {
    this.cnae = this.configService.get('ELOTECH_OXY_CNAE', '4520002');
    this.cnaeCodigo = this.cnae;
    this.cnaeDescricao = this.configService.get(
      'ELOTECH_OXY_CNAE_DESCRICAO',
      'Servicos de lanternagem ou funilaria e pintura de veiculos automotores',
    );
    this.servicoLCId = this.configService.get('ELOTECH_OXY_SERVICO_LC_ID', '141201');
    this.servicoLCAliquota = Number(this.configService.get('ELOTECH_OXY_SERVICO_LC_ALIQUOTA', 2));
    this.servicoLCDescricao = this.configService.get(
      'ELOTECH_OXY_SERVICO_LC_DESCRICAO',
      'Funilaria e lanternagem.',
    );
    this.servicoLCLocalIncidencia = Number(
      this.configService.get('ELOTECH_OXY_SERVICO_LC_LOCAL_INCIDENCIA', 2),
    );
    this.servicoLCTipoServico = Number(
      this.configService.get('ELOTECH_OXY_SERVICO_LC_TIPO_SERVICO', 1),
    );
    this.idServico = Number(this.configService.get('ELOTECH_OXY_ID_SERVICO', 2739));
    this.emissionCityId = Number(this.configService.get('ELOTECH_OXY_CITY_ID', 4049));
    this.emissionCityIBGE = Number(this.configService.get('ELOTECH_OXY_CITY_IBGE', 4109807));
    this.emissionCityName = this.configService.get('ELOTECH_OXY_CITY_NAME', 'IBIPORA');
  }

  async emitNfse(invoice: MunicipalEmitNfseInput): Promise<Record<string, any>> {
    this.logger.log(
      `[MUNICIPAL] Emitting NFS-e for invoice ${invoice.id} (task: ${invoice.task.id})`,
    );

    if (!this.authService.isConfigured()) {
      throw new Error('Elotech OXY credentials not configured. Cannot emit municipal NFS-e.');
    }

    let nfseDoc = await this.prisma.nfseDocument.findFirst({
      where: { invoiceId: invoice.id, status: { not: NfseStatus.CANCELLED } },
    });

    if (nfseDoc && nfseDoc.status === NfseStatus.AUTHORIZED) {
      this.logger.warn(`[MUNICIPAL] NFS-e already authorized for invoice ${invoice.id}, skipping`);
      return { skipped: true, reason: 'ALREADY_AUTHORIZED' };
    }

    // H3c: a PROCESSING document is claimed by ANOTHER process (scheduler sweep or a
    // concurrent targeted emission) — proceeding would double-emit at Elotech.
    // emitNfse() is the single claim authority: every caller goes through the atomic
    // claim below and only proceeds when count === 1.
    if (nfseDoc && nfseDoc.status === NfseStatus.PROCESSING) {
      this.logger.warn(
        `[MUNICIPAL] NfseDocument ${nfseDoc.id} is already being processed by another process, skipping`,
      );
      return { skipped: true, reason: 'ALREADY_PROCESSING' };
    }

    // Atomic claim for processing: PENDING/ERROR → PROCESSING, proceed only when count === 1
    if (nfseDoc) {
      const claimed = await this.prisma.nfseDocument.updateMany({
        where: {
          id: nfseDoc.id,
          status: { in: [NfseStatus.PENDING, NfseStatus.ERROR] },
        },
        data: { status: NfseStatus.PROCESSING, errorMessage: null },
      });
      if (claimed.count !== 1) {
        this.logger.warn(`[MUNICIPAL] Could not claim NfseDocument ${nfseDoc.id}, skipping`);
        return { skipped: true, reason: 'CLAIM_FAILED' };
      }
      nfseDoc = await this.prisma.nfseDocument.findUnique({
        where: { id: nfseDoc.id },
      });
    }

    if (!nfseDoc) {
      nfseDoc = await this.prisma.nfseDocument.create({
        data: {
          invoiceId: invoice.id,
          status: NfseStatus.PROCESSING,
        },
      });
    }

    // Durably link the note to its task (from the invoice) so it survives billing reverts
    // and always shows in the task quote NFS-e history. Withdrawal-backed invoices have no
    // task (invoice.taskId is null), so nothing is linked for those — that's expected.
    if (nfseDoc && !nfseDoc.taskId) {
      const inv = await this.prisma.invoice.findUnique({
        where: { id: invoice.id },
        select: { taskId: true },
      });
      if (inv?.taskId) {
        await this.prisma.nfseDocument.update({
          where: { id: nfseDoc.id },
          data: { taskId: inv.taskId },
        });
        nfseDoc.taskId = inv.taskId;
      }
    }

    // Pre-flight customer data validation — fail fast before wasting an API call.
    // These errors will never resolve on their own; set retryAfter: null so the
    // scheduler does not schedule useless exponential-backoff retries.
    const missingFields: string[] = [];
    const hasCnpj = (invoice.customer?.cnpj || '').replace(/\D/g, '').length === 14;
    const hasCpf = (invoice.customer?.cpf || '').replace(/\D/g, '').length === 11;
    if (!hasCnpj && !hasCpf) missingFields.push('CNPJ/CPF');
    if (!invoice.customer?.address?.state?.trim()) missingFields.push('Estado (UF)');
    if (!invoice.customer?.address?.cityName?.trim()) missingFields.push('Cidade');
    if (
      !(invoice.customer?.corporateName?.trim() || invoice.customer?.name?.trim())
    )
      missingFields.push('Razão Social');

    if (missingFields.length > 0) {
      const errorMessage = `Dados do cliente incompletos para emissão de NFS-e. Campos faltantes: ${missingFields.join(', ')}.`;
      await this.prisma.nfseDocument.update({
        where: { id: nfseDoc.id },
        data: {
          status: NfseStatus.ERROR,
          errorMessage,
          errorCount: { increment: 1 },
          retryAfter: null,
        },
      });
      this.logger.warn(
        `[MUNICIPAL] NFS-e emission skipped for invoice ${invoice.id}: ${errorMessage}`,
      );
      return { status: 'ERROR', errorMessage };
    }

    try {
      await this.authService.getToken();
      const headers = this.authService.getAuthHeaders();

      const payload = await this.buildPayload(invoice);

      this.logger.debug(`[MUNICIPAL] Payload: ${JSON.stringify(payload).slice(0, 2000)}`);

      const baseUrl = this.authService.baseUrl;

      // Step 1: Check ISS retention
      try {
        const issRetidoRes = await axios.post(`${baseUrl}/emissao-nfse/iss-retido`, payload, {
          headers,
          timeout: 15000,
        });
        const issRetido = issRetidoRes.data?.marcado === true;
        payload.formImposto.issRetido = issRetido;
        this.logger.log(`[MUNICIPAL] ISS retido check: marcado=${issRetido}`);
      } catch (err) {
        this.logger.warn(
          `[MUNICIPAL] ISS retido check failed (proceeding with issRetido=false): ${err instanceof Error ? err.message : err}`,
        );
        payload.formImposto.issRetido = false;
      }

      // Step 2: Calculate values (server-side validation + computation)
      // IMPORTANT: The calcular response returns stripped-down sections.
      // We must only merge computed values, NOT replace entire sections.
      try {
        const calcRes = await axios.post(
          `${baseUrl}/emissao-nfse/calcular-valores-nota-fiscal`,
          payload,
          { headers, timeout: 15000 },
        );
        const enriched = calcRes.data;
        if (enriched) {
          // Only merge formTotal (all computed values)
          if (enriched.formTotal) {
            payload.formTotal = enriched.formTotal;
          }
          // Merge specific computed values from formImposto
          if (enriched.formImposto) {
            payload.formImposto.valorIss =
              enriched.formImposto.valorIss ?? payload.formImposto.valorIss;
            payload.formImposto.valorCofins =
              enriched.formImposto.valorCofins ?? payload.formImposto.valorCofins;
            payload.formImposto.valorIr =
              enriched.formImposto.valorIr ?? payload.formImposto.valorIr;
            payload.formImposto.valorCpp =
              enriched.formImposto.valorCpp ?? payload.formImposto.valorCpp;
            payload.formImposto.valorPis =
              enriched.formImposto.valorPis ?? payload.formImposto.valorPis;
            payload.formImposto.valorInss =
              enriched.formImposto.valorInss ?? payload.formImposto.valorInss;
            payload.formImposto.valorCsll =
              enriched.formImposto.valorCsll ?? payload.formImposto.valorCsll;
            payload.formImposto.valorOutrasRetencoes =
              enriched.formImposto.valorOutrasRetencoes ?? payload.formImposto.valorOutrasRetencoes;
            payload.formImposto.valorImpostosFederais =
              enriched.formImposto.valorImpostosFederais ??
              payload.formImposto.valorImpostosFederais;
          }
          // Merge enriched servicoLC fields from formDadosNFSe
          if (enriched.formDadosNFSe?.servicoLC) {
            Object.assign(payload.formDadosNFSe.servicoLC, enriched.formDadosNFSe.servicoLC);
          }
          // Merge specific enriched formDadosNFSe fields
          if (enriched.formDadosNFSe) {
            const dadosKeys = [
              'exibeAcessoWeb',
              'exibeDataDigitacao',
              'exibeRps',
              'processadoPrestador',
              'processadoTomador',
              'tipoDocumentoId',
              'tipoMovimento',
              'existsCreditoObraUtilizado',
            ];
            for (const key of dadosKeys) {
              if (enriched.formDadosNFSe[key] !== undefined) {
                payload.formDadosNFSe[key] = enriched.formDadosNFSe[key];
              }
            }
          }
        }
        this.logger.log(
          `[MUNICIPAL] Values calculated: totalNfse=${payload.formTotal.totalNfse}, baseCalculo=${payload.formTotal.baseCalculoIss}`,
        );
      } catch (err: any) {
        const errBody = err?.response?.data;
        this.logger.warn(
          `[MUNICIPAL] Value calculation failed (proceeding with local values): ${err instanceof Error ? err.message : err}`,
        );
        if (errBody) {
          this.logger.warn(
            `[MUNICIPAL] Calc error response: ${JSON.stringify(errBody).slice(0, 1000)}`,
          );
        }
      }

      // Step 3: Save/emit the NFSe
      this.logger.debug(`[MUNICIPAL] Save payload: ${JSON.stringify(payload).slice(0, 3000)}`);

      let saveRes: any;
      try {
        saveRes = await axios.post(`${baseUrl}/emissao-nfse/salvar-nota-fiscal`, payload, {
          headers,
          timeout: 30000,
        });
      } catch (saveErr: any) {
        const saveErrData = saveErr?.response?.data;
        const saveErrStatus = saveErr?.response?.status;
        this.logger.error(
          `[MUNICIPAL] salvar-nota-fiscal failed: status=${saveErrStatus}, data=${JSON.stringify(saveErrData ?? null).slice(0, 2000)}`,
        );
        throw saveErr;
      }

      const result = saveRes.data;
      const nfseId = result?.formDadosNFSe?.id;
      const nfseNumber = result?.formDadosNFSe?.numeroNfse;

      if (!nfseId || !nfseNumber) {
        throw new Error(
          `Elotech OXY returned unexpected response: missing id or numeroNfse. Response: ${JSON.stringify(result).slice(0, 500)}`,
        );
      }

      // Update NfseDocument with the Elotech ID and official NF sequence number
      await this.prisma.nfseDocument.update({
        where: { id: nfseDoc!.id },
        data: {
          elotechNfseId: Number(nfseId),
          nfseNumber: Number(nfseNumber),
          status: NfseStatus.AUTHORIZED,
          errorMessage: null,
        },
      });

      this.logger.log(`[MUNICIPAL] NFS-e authorized: id=${nfseId}, numero=${nfseNumber}`);

      return { nfseId, nfseNumber, status: 'AUTHORIZED' };
    } catch (error) {
      const errResponse = (error as any)?.response?.data;
      let errorMsg: string;
      if (errResponse?.message) {
        errorMsg = errResponse.message;
      } else if (typeof errResponse === 'string') {
        errorMsg = errResponse;
      } else if (errResponse) {
        errorMsg = JSON.stringify(errResponse).slice(0, 800);
      } else {
        errorMsg = error instanceof Error ? error.message : String(error);
      }

      await this.prisma.nfseDocument.update({
        where: { id: nfseDoc!.id },
        data: {
          status: NfseStatus.ERROR,
          errorMessage: errorMsg.slice(0, 1000),
          errorCount: { increment: 1 },
          retryAfter: new Date(Date.now() + 5 * 60 * 1000),
        },
      });

      this.logger.error(`[MUNICIPAL] Failed to emit NFS-e for invoice ${invoice.id}: ${errorMsg}`);
      if (errResponse) {
        this.logger.error(
          `[MUNICIPAL] Full error response: ${JSON.stringify(errResponse).slice(0, 2000)}`,
        );
      }
      throw error;
    }
  }

  /**
   * Submit a cancellation REQUEST for an authorized NFS-e via the Elotech OXY REST API.
   *
   * IMPORTANT: Cancellation at Ibiporã/Elotech is asynchronous and fiscal-approved.
   * POST /solicitacoes-cancelamento/salvar only REGISTERS a "solicitação de cancelamento";
   * it does NOT cancel the note. The request goes:
   *
   *   salvar → AGUARDANDO_FISCAL → AUTORIZADO  (note becomes CANCELADA)
   *                              ↘ REJEITADO   (note stays EMITIDA / active)
   *
   * Recent emissions are usually auto-AUTORIZADO immediately; older ones require a
   * municipal fiscal to review and may be REJEITADO. This method therefore submits the
   * request and then RE-QUERIES the real state, persisting it accurately so the local DB
   * never lies about whether a note is actually cancelled at the prefeitura.
   *
   * @param substituteNfseNumber When cancelling due to duplicity/replacement, the number of
   *   the NF that replaces this one. The municipality requires it in the request motivo;
   *   omitting it is a common rejection cause.
   */
  async cancelNfse(
    nfseDocumentId: string,
    reason: string,
    reasonCode: number = 1,
    substituteNfseNumber?: number | null,
  ): Promise<CancelNfseResult> {
    this.logger.log(`[MUNICIPAL] Requesting cancellation for NFS-e document ${nfseDocumentId}`);

    if (!this.authService.isConfigured()) {
      throw new Error('Elotech OXY credentials not configured. Cannot cancel municipal NFS-e.');
    }

    const nfseDoc = await this.prisma.nfseDocument.findUnique({
      where: { id: nfseDocumentId },
    });

    if (!nfseDoc) {
      throw new Error(`NfseDocument ${nfseDocumentId} not found`);
    }

    if (!nfseDoc.elotechNfseId) {
      throw new Error(`NfseDocument ${nfseDoc.id} has no elotechNfseId. Cannot cancel.`);
    }

    const elotechNfseId = nfseDoc.elotechNfseId;

    // Already confirmed cancelled at the prefeitura — nothing to do.
    if (nfseDoc.status === NfseStatus.CANCELLED) {
      this.logger.warn(`[MUNICIPAL] NFS-e already cancelled: ${nfseDocumentId}`);
      return {
        cancelled: true,
        pending: false,
        rejected: false,
        status: NfseStatus.CANCELLED,
        elotechNfseId,
        requestStatus: nfseDoc.cancelRequestStatus,
        rejectionMessage: null,
      };
    }

    // A request is already in flight — don't double-submit. Re-sync the live state instead
    // so the caller learns whether the fiscal has acted since.
    if (nfseDoc.status === NfseStatus.CANCEL_REQUESTED) {
      this.logger.warn(
        `[MUNICIPAL] Cancellation already pending for ${nfseDocumentId}; re-syncing live state`,
      );
      return this.syncCancellationStatus(nfseDocumentId);
    }

    // AUTHORIZED → first request. CANCEL_REJECTED → a corrected re-submission (e.g. now
    // including the substitute NF number the fiscal demanded). Anything else is invalid.
    if (
      nfseDoc.status !== NfseStatus.AUTHORIZED &&
      nfseDoc.status !== NfseStatus.CANCEL_REJECTED
    ) {
      throw new Error(
        `Cannot cancel NFS-e with status ${nfseDoc.status}. ` +
          `Only AUTHORIZED or CANCEL_REJECTED NFS-e can have a cancellation requested.`,
      );
    }

    // Compose the motivo. The municipality requires the substitute note number inside the
    // free-text motivo (there is no structured field for it in Ibiporã's flow).
    let motivo = (reason || '').trim();
    if (substituteNfseNumber) {
      motivo += `${motivo.endsWith('.') ? '' : '.'} Nota fiscal substituta: Nº ${substituteNfseNumber}.`;
    }

    try {
      await this.authService.getToken();
      const headers = {
        ...this.authService.getAuthHeaders(),
        active_view: '/solicitacao-cancelamento',
      };
      const baseUrl = this.authService.baseUrl;

      // Step 1: Load cancel form data (validates the NFSe exists and is cancellable)
      // The GET endpoint requires the idCadastro header (contribuinte ID)
      const contribuinte = this.authService.getContribuinteData();
      const cancelFormHeaders = {
        ...headers,
        ...(contribuinte?.id ? { idCadastro: String(contribuinte.id) } : {}),
      };
      const cancelFormRes = await axios.get(
        `${baseUrl}/solicitacoes-cancelamento/nota-fiscal/${elotechNfseId}`,
        { headers: cancelFormHeaders, timeout: 15000 },
      );

      const cancelFormData = cancelFormRes.data;
      this.logger.log(
        `[MUNICIPAL] Cancel form loaded for NFSe ${elotechNfseId}: numero=${cancelFormData.numeroNotaFiscal}, situacao=${cancelFormData.situacao}`,
      );

      // Step 2: Submit cancellation request
      // motivoSituacaoEntity codes: 1=Erro na emissão, 2=Serviço não prestado, 4=Duplicidade da nota
      const cancelPayload = {
        motivoSituacaoEntity: { codigo: reasonCode },
        arquivoSelecionado: '',
        motivo,
        ultimoStatus: null,
        arquivos: [],
        idNotaFiscal: cancelFormData.id,
        idCadastroSolicitante: cancelFormData.idCadastroGeralPrestador,
      };

      this.logger.debug(`[MUNICIPAL] Cancel payload: ${JSON.stringify(cancelPayload)}`);

      const cancelRes = await axios.post(
        `${baseUrl}/solicitacoes-cancelamento/salvar`,
        cancelPayload,
        { headers, timeout: 30000 },
      );

      this.logger.log(
        `[MUNICIPAL] Cancel request submitted: status=${cancelRes.status}, data=${JSON.stringify(cancelRes.data).slice(0, 500)}`,
      );

      // Step 3: Re-query the REAL resulting state and persist it accurately.
      // This is the crucial difference from the old optimistic flow: we never assume the
      // note is cancelled just because the request was accepted.
      const state = await this.fetchCancellationState(elotechNfseId);
      const result = await this.persistCancellationState(nfseDoc.id, state, {
        reason,
        reasonCode,
        substituteNfseNumber: substituteNfseNumber ?? null,
        requestedAt: new Date(),
      });

      this.logger.log(
        `[MUNICIPAL] NFS-e ${elotechNfseId} cancellation outcome: localStatus=${result.status}, ` +
          `requestStatus=${result.requestStatus ?? 'N/A'}, notaSituacao=${state.notaSituacao}`,
      );

      return { ...result, elotechNfseId };
    } catch (error) {
      const errResponse = (error as any)?.response?.data;
      let errorMsg: string;
      if (errResponse?.message) {
        errorMsg = errResponse.message;
      } else if (typeof errResponse === 'string') {
        errorMsg = errResponse;
      } else if (errResponse) {
        errorMsg = JSON.stringify(errResponse).slice(0, 800);
      } else {
        errorMsg = error instanceof Error ? error.message : String(error);
      }

      this.logger.error(
        `[MUNICIPAL] Failed to request cancellation for nfseDocument ${nfseDocumentId}: ${errorMsg}`,
      );
      if (errResponse) {
        this.logger.error(
          `[MUNICIPAL] Full cancel error response: ${JSON.stringify(errResponse).slice(0, 2000)}`,
        );
      }
      throw error;
    }
  }

  /**
   * Fetch the live cancellation state of a note from Elotech: whether the note itself is
   * cancelled, and the status/history of any cancellation request (solicitação) on it.
   * Read-only — used both right after submitting a request and by the reconciler.
   */
  async fetchCancellationState(elotechNfseId: number): Promise<ElotechCancellationState> {
    await this.authService.getToken();
    const baseUrl = this.authService.baseUrl;
    const contribuinte = this.authService.getContribuinteData();
    const headers = {
      ...this.authService.getAuthHeaders(),
      active_view: '/solicitacao-cancelamento',
      ...(contribuinte?.id ? { idCadastro: String(contribuinte.id) } : {}),
    };

    const res = await axios.get(
      `${baseUrl}/solicitacoes-cancelamento/nota-fiscal/${elotechNfseId}`,
      { headers, timeout: 15000 },
    );
    const d = res.data ?? {};
    const s = d.solicitacaoCancelamento ?? null;

    return {
      notaSituacao: d.situacao ?? 'DESCONHECIDA',
      notaCancelada: String(d.situacao ?? '').toUpperCase() === 'CANCELADA',
      numeroNotaFiscal: d.numeroNotaFiscal ?? null,
      request: s
        ? {
            id: s.id ?? null,
            ultimoStatus: s.ultimoStatus ?? null,
            motivo: s.motivo ?? null,
            data: s.data ?? null,
            codigoMotivoSituacao: s.codigoMotivoSituacao ?? null,
            historicos: Array.isArray(s.historicos)
              ? s.historicos.map((h: any) => ({
                  data: h.data ?? null,
                  status: h.status ?? null,
                  descricaoStatus: h.descricaoStatus ?? null,
                  motivo: h.motivo ?? null,
                }))
              : [],
          }
        : null,
    };
  }

  /**
   * Map an Elotech cancellation state onto our NfseDocument and persist it.
   * Single source of truth for the AUTORIZADO/AGUARDANDO_FISCAL/REJEITADO → local-status
   * mapping, reused by cancelNfse() and the reconciler.
   */
  private async persistCancellationState(
    nfseDocId: string,
    state: ElotechCancellationState,
    submitted?: {
      reason: string;
      reasonCode: number;
      substituteNfseNumber: number | null;
      requestedAt: Date;
    },
  ): Promise<CancelNfseResult> {
    const req = state.request;
    const ultimoStatus = req?.ultimoStatus ?? null;

    const data: Record<string, any> = {
      cancelRequestId: req?.id ?? undefined,
      cancelRequestStatus: ultimoStatus ?? undefined,
    };
    if (submitted) {
      data.cancelReason = submitted.reason;
      data.cancelReasonCode = submitted.reasonCode;
      data.cancelSubstituteNfseNumber = submitted.substituteNfseNumber ?? undefined;
      data.cancelRequestedAt = submitted.requestedAt;
    }

    let status: NfseStatus;
    let rejectionMessage: string | null = null;

    if (state.notaCancelada || ultimoStatus === 'AUTORIZADO') {
      status = NfseStatus.CANCELLED;
      data.errorMessage = null;
      data.cancelRejectionMessage = null;
      data.cancelResolvedAt = new Date();
    } else if (ultimoStatus === 'REJEITADO') {
      status = NfseStatus.CANCEL_REJECTED;
      rejectionMessage = (
        req?.motivo || 'Solicitação de cancelamento rejeitada pela prefeitura.'
      ).trim();
      data.cancelRejectionMessage = rejectionMessage;
      data.cancelResolvedAt = new Date();
    } else if (ultimoStatus === 'AGUARDANDO_FISCAL') {
      status = NfseStatus.CANCEL_REQUESTED;
      data.cancelResolvedAt = null;
    } else {
      // No request found (or an unknown status) and the note is not cancelled → it is
      // still active. Fall back to AUTHORIZED so we never strand it as "cancelled".
      status = NfseStatus.AUTHORIZED;
    }

    data.status = status;
    await this.prisma.nfseDocument.update({ where: { id: nfseDocId }, data });

    return {
      cancelled: status === NfseStatus.CANCELLED,
      pending: status === NfseStatus.CANCEL_REQUESTED,
      rejected: status === NfseStatus.CANCEL_REJECTED,
      status,
      elotechNfseId: 0, // filled by caller when known
      requestStatus: ultimoStatus,
      rejectionMessage,
    };
  }

  /**
   * Re-query Elotech for a single NfseDocument's cancellation state and reconcile our local
   * status to match reality. Returns the resolved result. Used by the reconciler scheduler
   * and by the detail endpoint so users always see the true prefeitura state.
   */
  async syncCancellationStatus(nfseDocumentId: string): Promise<CancelNfseResult> {
    const nfseDoc = await this.prisma.nfseDocument.findUnique({
      where: { id: nfseDocumentId },
    });
    if (!nfseDoc) throw new Error(`NfseDocument ${nfseDocumentId} not found`);
    if (!nfseDoc.elotechNfseId) {
      throw new Error(`NfseDocument ${nfseDocumentId} has no elotechNfseId.`);
    }

    const state = await this.fetchCancellationState(nfseDoc.elotechNfseId);
    const result = await this.persistCancellationState(nfseDoc.id, state);
    return { ...result, elotechNfseId: nfseDoc.elotechNfseId };
  }

  /**
   * Live cancellation status + full request history for a note, for display in the UI.
   * Read-only; does not mutate local state.
   */
  async getCancellationStatus(elotechNfseId: number): Promise<ElotechCancellationState> {
    return this.fetchCancellationState(elotechNfseId);
  }

  /**
   * List NFSes from Elotech API with filters.
   * Proxies to POST /consultar-documentos-fiscais/consultar
   */
  async listNfses(filters: {
    dataEmissaoInicial?: string;
    dataEmissaoFinal?: string;
    situacao?: number | null;
    cpfCnpj?: string | null;
    numeroDocumentoInicial?: number | null;
    numeroDocumentoFinal?: number | null;
    firstResult?: number;
    maxResult?: number;
  }): Promise<{ data: any[]; totalDocumentos: number }> {
    await this.authService.getToken();
    const headers = {
      ...this.authService.getAuthHeaders(),
      active_view: '/consulta-documentos-fiscais',
    };
    const baseUrl = this.authService.baseUrl;
    const contribuinteId = Number(this.configService.get('ELOTECH_OXY_CONTRIBUINTE_ID', '98895'));

    const payload = {
      tipoServico: 'PRESTADOS',
      homologacao: 'N',
      dataEmissaoInicial: filters.dataEmissaoInicial || null,
      dataEmissaoFinal: filters.dataEmissaoFinal || null,
      dataDigitacaoInicial: null,
      dataDigitacaoFinal: null,
      apenasAtividadesDoCadastro: 'false',
      tipoPessoa: null,
      cpfCnpj: filters.cpfCnpj || null,
      uf: null,
      cidade: null,
      razaoSocial: null,
      intermediario: 'false',
      cnae: '',
      inscricaoMunicipal: null,
      situacao: filters.situacao ?? null,
      naturezaOperacaoId: null,
      issRetido: null,
      possuiImpostoFederal: null,
      entregueNaDMS: null,
      numeroDocumentoInicial: filters.numeroDocumentoInicial ?? null,
      numeroDocumentoFinal: filters.numeroDocumentoFinal ?? null,
      tipoDocumentoFiscalId: null,
      firstResult: filters.firstResult ?? 0,
      maxResult: filters.maxResult ?? 20,
      contribuinteId,
      notasSelecionadas: [],
      sortBy: null,
      sortOrder: null,
    };

    // Step 1: Get total count first (needed to reverse pagination)
    const totalsRes = await axios.post(
      `${baseUrl}/consultar-documentos-fiscais/totais-consulta`,
      payload,
      { headers, timeout: 15000 },
    );
    const totalDocumentos: number = totalsRes.data?.totalDocumentos || 0;

    // Step 2: Calculate reversed offset so newest items come first
    const requestedFirst = filters.firstResult ?? 0;
    const requestedMax = filters.maxResult ?? 20;
    const pageNum = Math.floor(requestedFirst / requestedMax) + 1;

    let reversedFirst = totalDocumentos - pageNum * requestedMax;
    let adjustedMax = requestedMax;
    if (reversedFirst < 0) {
      adjustedMax = requestedMax + reversedFirst;
      reversedFirst = 0;
    }

    // Step 3: Fetch list with reversed offset
    const listPayload = { ...payload, firstResult: reversedFirst, maxResult: adjustedMax };
    const listRes = await axios.post(
      `${baseUrl}/consultar-documentos-fiscais/consultar`,
      listPayload,
      { headers, timeout: 15000 },
    );

    // Reverse page so highest IDs come first
    const data = listRes.data?.data || [];
    data.reverse();

    return {
      data,
      totalDocumentos,
    };
  }

  /**
   * Get detailed NFSe info from Elotech.
   * Proxies to GET /emissao-nfse/resumo-nota-fiscal?idNotaFiscal={id}
   */
  async getNfseDetail(elotechNfseId: number): Promise<any> {
    await this.authService.getToken();
    const headers = {
      ...this.authService.getAuthHeaders(),
      active_view: '/consulta-documentos-fiscais',
    };
    const baseUrl = this.authService.baseUrl;

    const res = await axios.get(`${baseUrl}/emissao-nfse/resumo-nota-fiscal`, {
      headers,
      params: { idNotaFiscal: elotechNfseId },
      timeout: 15000,
    });

    return res.data;
  }

  /**
   * Get NFSe PDF from Elotech.
   * Proxies to GET /emissao-nfse/nota-fiscal-pdf/{id}
   */
  async getNfsePdf(elotechNfseId: number): Promise<Buffer> {
    await this.authService.getToken();
    const headers = {
      ...this.authService.getAuthHeaders(),
      active_view: '/consulta-documentos-fiscais',
    };
    const baseUrl = this.authService.baseUrl;

    const res = await axios.get(`${baseUrl}/emissao-nfse/nota-fiscal-pdf/${elotechNfseId}`, {
      headers,
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    return Buffer.from(res.data);
  }

  private buildFullCityObject(city: ElotechCity, uf: string): Record<string, any> {
    const ufDescriptions: Record<string, string> = {
      AC: 'Acre',
      AL: 'Alagoas',
      AM: 'Amazonas',
      AP: 'Amapa',
      BA: 'Bahia',
      CE: 'Ceara',
      DF: 'Distrito Federal',
      ES: 'Espirito Santo',
      GO: 'Goias',
      MA: 'Maranhao',
      MG: 'Minas Gerais',
      MS: 'Mato Grosso do Sul',
      MT: 'Mato Grosso',
      PA: 'Para',
      PB: 'Paraiba',
      PE: 'Pernambuco',
      PI: 'Piaui',
      PR: 'Parana',
      RJ: 'Rio de Janeiro',
      RN: 'Rio Grande do Norte',
      RO: 'Rondonia',
      RR: 'Roraima',
      RS: 'Rio Grande do Sul',
      SC: 'Santa Catarina',
      SE: 'Sergipe',
      SP: 'Sao Paulo',
      TO: 'Tocantins',
    };

    return {
      id: city.id,
      unidadeFederacao: {
        id: { codigoPais: 32, unidadeFederacao: uf },
        descricao: city.unidadeFederacao?.descricao || ufDescriptions[uf] || uf,
      },
      descricaoAbreviada: city.descricaoAbreviada || city.descricao,
      descricao: city.descricao,
      codigoNacional: city.codigoNacional || String(city.codigoIBGE || ''),
      codigoIBGE: city.codigoIBGE,
      pais: city.pais || {
        id: 32,
        descricao: 'Brasil',
        codigoBacen: '1058',
        siglaPais: 'BR',
      },
      descricaoUF: city.descricaoUF || `${city.descricao} - ${uf}`,
      ativa: city.ativa || 'S',
    };
  }

  private readonly TRUCK_CATEGORY_LABELS: Record<string, string> = {
    MINI: 'Mini',
    VUC: 'VUC',
    THREE_QUARTER: '3/4',
    RIGID: 'Toco',
    TRUCK: 'Truck',
    SEMI_TRAILER: 'Semirreboque',
    SEMI_TRAILER_2_AXLES: 'Semirreboque 2 Eixos',
    B_DOUBLE_FRONT: 'Bitrem Compartimento Frontal',
    B_DOUBLE_REAR: 'Bitrem Compartimento Traseiro',
    BITRUCK: 'Bitruck',
  };

  private readonly IMPLEMENT_TYPE_LABELS: Record<string, string> = {
    DRY_CARGO: 'Carga seca',
    REFRIGERATED: 'Refrigerado',
    INSULATED: 'Isotérmico',
    CURTAIN_SIDE: 'Sider',
    TANK: 'Tanque',
    FLATBED: 'Prancha/Plataforma',
  };

  private async buildPayload(invoice: MunicipalEmitNfseInput): Promise<Record<string, any>> {
    const contribuinte = this.authService.getContribuinteData();
    const providerCnpj = contribuinte?.cnpjCpf || '';
    const providerName = contribuinte?.razaoSocialNome || '';
    const regimeFiscal = contribuinte?.regimeFiscal || 'LUCRO PRESUMIDO';
    const isSimples = contribuinte?.regimeFiscalDto?.simplesNacional === 'S';

    // Build tomador (customer) — must match Elotech OXY portal structure exactly
    const isJuridica = !!invoice.customer.cnpj;
    const cleanDoc = (invoice.customer.cnpj || invoice.customer.cpf || '').replace(/\D/g, '');

    const formTomador: Record<string, any> = {
      tipoTomador: 'I',
      tipoPessoa: isJuridica ? 'J' : 'F',
      cnpjCpf: cleanDoc,
      nif: null,
      motivoNaoNif: null,
      idCadastro: null,
      inscricaoMunicipal: null,
      inscricaoEstadual: null,
      inscricaoOutroMunicipio: null,
      razao: invoice.customer.corporateName || invoice.customer.name,
      cep: invoice.customer.address?.zipCode?.replace(/\D/g, '') || '',
      endereco: invoice.customer.address?.street || '',
      numeroEndereco: invoice.customer.address?.number || 'S/N',
      complementoEndereco: invoice.customer.address?.complement || '',
      bairro: invoice.customer.address?.neighborhood || '',
      cidadeExterior: null,
      pais: null,
      telefone: invoice.customer.phone?.replace(/\D/g, '') || '',
      email: invoice.customer.email || '',
      idUltimaNotaFiscal: null,
      substitutoTributario: false,
      idFavorito: null,
      quantidadeCadastros: null,
      tomadorCarregado: false,
      codigoPostal: null,
      siglaPais: null,
      estadoProvincia: null,
    };

    // Lookup customer city in Elotech
    if (invoice.customer.address?.state) {
      const uf = invoice.customer.address.state;
      formTomador.uf = this.authService.buildUfObject(uf);

      if (invoice.customer.address.cityName) {
        const city = await this.authService.findCity(invoice.customer.address.cityName, uf);
        if (city) {
          formTomador.cidade = this.buildFullCityObject(city, uf);
        } else {
          // City not found for the given UF — this is almost always a wrong state on the customer
          // record (e.g. city=Aimores UF=MS when the city is actually in MG). Fail fast with a
          // human-readable message rather than letting Elotech reject with a generic 500.
          throw new Error(
            `Cidade "${invoice.customer.address.cityName}" não encontrada para o estado ${uf}. ` +
              `Verifique o campo UF no cadastro do cliente.`,
          );
        }
      }
    }

    const totalAmount = invoice.totalAmount;
    const serialNumber = invoice.task.serialNumber || invoice.task.name;

    // Build vehicle description — category/implement first, then identifiers
    // Format: "Referente aos serviços executados no veículo Caminhão Carga seca de n série: X, placa: Y, chassi: Z."
    const vehicleTypeParts: string[] = [];
    if (invoice.truck?.category) {
      vehicleTypeParts.push(
        this.TRUCK_CATEGORY_LABELS[invoice.truck.category] ?? invoice.truck.category,
      );
    }
    if (invoice.truck?.implementType) {
      vehicleTypeParts.push(
        this.IMPLEMENT_TYPE_LABELS[invoice.truck.implementType] ?? invoice.truck.implementType,
      );
    }

    const vehicleIdParts: string[] = [];
    if (invoice.task.serialNumber) vehicleIdParts.push(`n série: ${invoice.task.serialNumber}`);
    if (invoice.truck?.plate) vehicleIdParts.push(`placa: ${invoice.truck.plate}`);
    if (invoice.truck?.chassisNumber) vehicleIdParts.push(`chassi: ${invoice.truck.chassisNumber}`);

    const typePart = vehicleTypeParts.join(' ');
    const idPart = vehicleIdParts.join(', ');

    let vehicleRef: string;
    if (typePart && idPart) {
      vehicleRef = `Referente aos serviços executados no veículo ${typePart} de ${idPart}.`;
    } else if (typePart) {
      vehicleRef = `Referente aos serviços executados no veículo ${typePart}.`;
    } else if (idPart) {
      vehicleRef = `Referente aos serviços executados no veículo de ${idPart}.`;
    } else {
      vehicleRef = `Ref. OS ${serialNumber}`;
    }

    // Build line items — must use exact field names from Elotech portal
    const services = invoice.services;
    let formItensNFSe: Record<string, any>[];
    let discriminacaoServico: string;
    let totalDescontosIncondicionados = 0;

    // Compute the effective discount percentage from globalDiscount
    // For PERCENTAGE: use the value directly
    // For FIXED_VALUE: calculate the equivalent percentage from the PRE-DISCOUNT subtotal
    // (sum of service amounts), NOT from totalAmount (which is post-discount config.total)
    const servicesSubtotal =
      services && services.length > 0
        ? services.reduce((sum, svc) => sum + svc.amount, 0)
        : totalAmount;
    let effectiveDiscountPercent = 0;
    if (invoice.globalDiscount) {
      const gd = invoice.globalDiscount;
      if (gd.type === 'PERCENTAGE' && gd.value) {
        effectiveDiscountPercent = gd.value;
      } else if (gd.type === 'FIXED_VALUE' && gd.value && servicesSubtotal > 0) {
        effectiveDiscountPercent = Math.round((gd.value / servicesSubtotal) * 100 * 100) / 100;
      }
    }

    const buildItem = (description: string, amount: number, index: number) => {
      // Distribute global discount proportionally to each service
      let valorDesconto = 0;
      if (effectiveDiscountPercent > 0) {
        valorDesconto = Math.round(((amount * effectiveDiscountPercent) / 100) * 100) / 100;
      }
      const valorLiquido = Math.max(0, Math.round((amount - valorDesconto) * 100) / 100);
      totalDescontosIncondicionados += valorDesconto;

      return {
        showPainelDeducao: false,
        item: description,
        quantidade: 1,
        valorUnitario: amount,
        valorDesconto,
        valorDescontoCondicionado: 0,
        valorTotal: amount,
        valorLiquido,
        isDeducao: false,
        unidadeMedida: null,
        deducao: {
          tipoDeducao: null,
          numeroNota: null,
          valorNota: null,
          tipoPessoa: null,
          cpfCnpj: null,
        },
        expand: false,
        itemIndex: index,
      };
    };

    const cleanOrderNumber = invoice.orderNumber?.replace(/^PEDIDO\s+NR\s+/i, '').trim() ?? '';

    if (services && services.length > 0) {
      formItensNFSe = services.map((svc, i) => buildItem(svc.description, svc.amount, i));

      const DISCRIMINACAO_MAX_LINES = 11;
      const headerLines: string[] = [];
      if (cleanOrderNumber) headerLines.push(`Pedido: ${cleanOrderNumber}`);
      if (vehicleRef) headerLines.push(vehicleRef);

      const availableLines = Math.max(1, DISCRIMINACAO_MAX_LINES - headerLines.length);
      const packedServices = this.packServiceLines(
        services.map(s => s.description),
        availableLines,
      );

      discriminacaoServico = invoice.description || [...headerLines, ...packedServices].join('\n');
    } else {
      const fallbackDesc =
        invoice.description ||
        `${cleanOrderNumber ? `Pedido: ${cleanOrderNumber}\n` : ''}Serviço ref. OS ${serialNumber}`;
      formItensNFSe = [buildItem(fallbackDesc, totalAmount, 0)];
      discriminacaoServico = fallbackDesc;
    }

    totalDescontosIncondicionados = Math.round(totalDescontosIncondicionados * 100) / 100;

    // ISS computation — base = totalNfse - totalDescontosIncondicionados
    // totalNfse is the GROSS service total (pre-discount), not the post-discount invoice amount
    const totalNfse = servicesSubtotal;
    const baseCalculoIss = Math.max(0, totalNfse - totalDescontosIncondicionados);
    const valorIss = Math.round(baseCalculoIss * this.servicoLCAliquota) / 100;
    // Format date in São Paulo timezone to avoid UTC offset causing wrong day.
    // Elotech expects ISO-like format but with the correct Brazil date.
    const nowDate = new Date();
    const spParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(nowDate);
    const get = (type: string) => spParts.find(p => p.type === type)?.value ?? '';
    const now = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;

    return {
      formTomador,
      formIntermediario: {
        possuiIntermediario: false,
        tipoIntermediario: null,
        cnpj: '',
        cadastroGeral: null,
        cadastros: null,
        razaoSocial: null,
        uf: null,
        cidade: null,
        telefone: null,
        email: null,
        codigoPostal: '',
        siglaPais: '',
        estadoProvincia: '',
        cidadeExterior: '',
        nif: null,
        motivoNaoNif: null,
        cep: '',
        endereco: null,
        numeroEndereco: null,
        complementoEndereco: null,
        bairro: null,
      },
      formDadosNFSe: {
        numeroNfse: null,
        cpfCnpj: providerCnpj,
        nomeRazaoSocial: providerName,
        dataEmissao: now,
        cnae: {
          id: this.cnaeCodigo,
          codigo: this.cnaeCodigo,
          descricao: this.cnaeDescricao,
          habilitado: 'N',
          principal: 'N',
        },
        servicoLC: {
          id: this.servicoLCId,
          aliquota: this.servicoLCAliquota,
          localIncidencia: this.servicoLCLocalIncidencia,
          deducao: 0,
          tipoServico: this.servicoLCTipoServico,
          vetado: 'N',
          descricao: this.servicoLCDescricao,
          construcaoCivil: 0,
          idServico: this.idServico,
          permiteExportacao: 'S',
          retemiss: 'N',
          incorporacao: false,
          vinculoMunicipal: false,
          incidenciaDomicilioEstabelecimentoPrestador: true,
          localIncidenciaDescricao: 'No domicílio do prestador',
          deducaoDescricao: 'Não',
        },
        servicoLCAnterior: null,
        nbs: null,
        localIncidencia: 'No domicílio do prestador',
        permiteDeducao: 'Não',
        regimeFiscal,
        pais: {
          id: 32,
          descricao: 'Brasil',
          codigoBacen: '1058',
          siglaPais: 'BR',
        },
        uf: {
          id: { codigoPais: 32, unidadeFederacao: 'PR' },
        },
        cidade: {
          id: this.emissionCityId,
          descricao: this.emissionCityName,
          codigoIBGE: this.emissionCityIBGE,
          unidadeFederacao: {
            id: { codigoPais: 32, unidadeFederacao: 'PR' },
          },
          idPais: 32,
          descricaoPais: 'Brasil',
        },
        naturezaOperacao: {
          id: 1,
          descricao: 'Tributado no Município',
          exigibilidadeXsd: {
            id: 1,
            codigo: 1,
            descricao: 'Exigível',
            exportacao: false,
            isencao: false,
            imune: false,
          },
          isento: false,
          imune: false,
          exigivel: true,
          tributadoNoMunicipio: true,
          tributadoForaDoMunicipio: false,
          exigibilidadeSuspensa: false,
          exportacao: false,
        },
        codigoObra: null,
        processo: null,
        cnpjCpfResponsavelObra: '',
        numeroProcessoObra: null,
        entidadeProjetoObra: '',
        exercicioProjetoObra: '',
        projetoObra: '',
        opcaoPagamentoObra: '',
        art: null,
        numeroAlvara: null,
        nomeObra: null,
        responsavelObra: null,
        cepObra: null,
        logradouroObra: null,
        bairroObra: null,
        incorporacao: false,
        discriminacaoServico,
        acessoWebNome: null,
        acessoWebCpf: null,
        dataDigitacao: now,
        idRps: null,
        exibeAcessoWeb: false,
        exibeDataDigitacao: false,
        exibeRps: false,
        idNfseSubstituida: null,
        incentivo: null,
        utilizaRps: false,
        numeroRps: null,
        notaGeradaTributosWeb: true,
        listaUnidadeMedida: null,
        utilizaUnidadeMedida: false,
        nfseSubstituida: false,
        numeroNfseSubstituta: null,
        dataEmissaoNfseSubstituta: null,
        nfseSubstituta: false,
        numeroNfseSubstituida: null,
        tipoMovimento: null,
        suspensaoIssqn: false,
        tipoSuspensao: null,
        numeroProcesso: null,
        existeDecisaoAdmJudicial: false,
        utilizaDecisaoAdmJudicial: false,
      },
      formItensNFSe,
      formImposto: {
        anexoSimplesNacional: null,
        valorRbt12: null,
        aliquotaIss: this.servicoLCAliquota,
        valorIss,
        issRetido: false,
        aliquotaCofins: contribuinte?.aliquotaCofins ?? 0,
        valorCofins: 0,
        cofinsRetido: false,
        aliquotaIr: contribuinte?.aliquotaIR ?? 0,
        valorIr: 0,
        irRetido: false,
        aliquotaCpp: contribuinte?.aliquotaCPP ?? 0,
        valorCpp: 0,
        cppRetido: false,
        aliquotaPis: contribuinte?.aliquotaPIS ?? 0,
        valorPis: 0,
        pisRetido: false,
        aliquotaInss: contribuinte?.aliquotaINSS ?? 0,
        valorInss: 0,
        inssRetido: false,
        aliquotaCsll: contribuinte?.aliquotaCSLL ?? 0,
        valorCsll: 0,
        csllRetido: false,
        valorOutrasRetencoes: 0,
        outrasRetencoesRetido: false,
        historicoCenarioSimplesNacional: {
          anexoCenarioSimples: 0,
          faixaCenarioSimples: 0,
          rbt12CenarioSimples: 0,
        },
        contribuinteOptanteSimplesNacional: isSimples,
        simplesNacionalCalculoServicoAutomatico: false,
        valorRba: 0,
        valorRbaa: 0,
        valorReceitaServicoSimplesNacional: 0,
        valorReceitasComercioIndustria: 0,
        valorTotalRetencoes: 0,
        valorImpostosFederais: 0,
      },
      formCreditoObra: {
        creditos: null,
      },
      formComercioExterior: {
        modoPrestacao: '',
        vinculoPartesNegocio: '',
        moeda: null,
        servicoMoedaEstrangeira: null,
        apoioComercioExteriorPrestadorServico: '',
        apoioComercioExteriorTomadorServico: '',
        vinculoOperacaoTemporariaBens: '',
        indicadorMdic: null,
        declaracaoImportacao: null,
        registroExportacao: null,
      },
      formTotal: {
        totalDescontosIncondicionados,
        totalDescontosCondicionados: 0,
        totalDeducoes: 0,
        percentualDeducoes: 0,
        baseCalculoIss,
        valorImpostos: valorIss,
        valorLiquidoNfse: Math.max(0, totalNfse - totalDescontosIncondicionados),
        totalNfse,
      },
    };
  }

  private packServiceLines(descriptions: string[], maxLines: number): string[] {
    const lines: string[] = [];
    let current = '';
    for (const desc of descriptions) {
      if (lines.length >= maxLines) break;
      if (current === '') {
        current = desc;
      } else if (current.length + 2 + desc.length <= 255) {
        current += `, ${desc}`;
      } else {
        lines.push(current);
        if (lines.length >= maxLines) break;
        current = desc;
      }
    }
    if (current && lines.length < maxLines) lines.push(current);
    return lines;
  }
}
