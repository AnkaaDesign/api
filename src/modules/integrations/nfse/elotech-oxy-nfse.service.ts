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
  };
  services?: Array<{
    description: string;
    amount: number;
    discountType?: string;
    discountValue?: number | null;
  }>;
  description?: string;
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
    this.servicoLCId = this.configService.get(
      'ELOTECH_OXY_SERVICO_LC_ID',
      '141201',
    );
    this.servicoLCAliquota = Number(
      this.configService.get('ELOTECH_OXY_SERVICO_LC_ALIQUOTA', 2),
    );
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
    this.idServico = Number(
      this.configService.get('ELOTECH_OXY_ID_SERVICO', 2739),
    );
    this.emissionCityId = Number(
      this.configService.get('ELOTECH_OXY_CITY_ID', 4049),
    );
    this.emissionCityIBGE = Number(
      this.configService.get('ELOTECH_OXY_CITY_IBGE', 4109807),
    );
    this.emissionCityName = this.configService.get(
      'ELOTECH_OXY_CITY_NAME',
      'IBIPORA',
    );
  }

  async emitNfse(
    invoice: MunicipalEmitNfseInput,
  ): Promise<Record<string, any>> {
    this.logger.log(
      `[MUNICIPAL] Emitting NFS-e for invoice ${invoice.id} (task: ${invoice.task.id})`,
    );

    if (!this.authService.isConfigured()) {
      throw new Error(
        'Elotech OXY credentials not configured. Cannot emit municipal NFS-e.',
      );
    }

    let nfseDoc = await this.prisma.nfseDocument.findFirst({
      where: { invoiceId: invoice.id, status: { not: NfseStatus.CANCELLED } },
    });

    if (nfseDoc && nfseDoc.status === NfseStatus.AUTHORIZED) {
      this.logger.warn(
        `[MUNICIPAL] NFS-e already authorized for invoice ${invoice.id}, skipping`,
      );
      return { skipped: true, reason: 'ALREADY_AUTHORIZED' };
    }

    // Claim for processing
    if (nfseDoc && nfseDoc.status !== NfseStatus.PROCESSING) {
      const claimed = await this.prisma.nfseDocument.updateMany({
        where: {
          id: nfseDoc.id,
          status: { in: [NfseStatus.PENDING, NfseStatus.ERROR] },
        },
        data: { status: NfseStatus.PROCESSING, errorMessage: null },
      });
      if (claimed.count === 0) {
        this.logger.warn(
          `[MUNICIPAL] Could not claim NfseDocument ${nfseDoc.id}, skipping`,
        );
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

    try {
      await this.authService.getToken();
      const headers = this.authService.getAuthHeaders();

      const payload = await this.buildPayload(invoice);

      this.logger.debug(
        `[MUNICIPAL] Payload: ${JSON.stringify(payload).slice(0, 2000)}`,
      );

      const baseUrl = this.authService.baseUrl;

      // Step 1: Check ISS retention
      try {
        const issRetidoRes = await axios.post(
          `${baseUrl}/emissao-nfse/iss-retido`,
          payload,
          { headers, timeout: 15000 },
        );
        const issRetido = issRetidoRes.data?.marcado === true;
        payload.formImposto.issRetido = issRetido;
        this.logger.log(
          `[MUNICIPAL] ISS retido check: marcado=${issRetido}`,
        );
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
            payload.formImposto.valorIss = enriched.formImposto.valorIss ?? payload.formImposto.valorIss;
            payload.formImposto.valorCofins = enriched.formImposto.valorCofins ?? payload.formImposto.valorCofins;
            payload.formImposto.valorIr = enriched.formImposto.valorIr ?? payload.formImposto.valorIr;
            payload.formImposto.valorCpp = enriched.formImposto.valorCpp ?? payload.formImposto.valorCpp;
            payload.formImposto.valorPis = enriched.formImposto.valorPis ?? payload.formImposto.valorPis;
            payload.formImposto.valorInss = enriched.formImposto.valorInss ?? payload.formImposto.valorInss;
            payload.formImposto.valorCsll = enriched.formImposto.valorCsll ?? payload.formImposto.valorCsll;
            payload.formImposto.valorOutrasRetencoes = enriched.formImposto.valorOutrasRetencoes ?? payload.formImposto.valorOutrasRetencoes;
            payload.formImposto.valorImpostosFederais = enriched.formImposto.valorImpostosFederais ?? payload.formImposto.valorImpostosFederais;
          }
          // Merge enriched servicoLC fields from formDadosNFSe
          if (enriched.formDadosNFSe?.servicoLC) {
            Object.assign(payload.formDadosNFSe.servicoLC, enriched.formDadosNFSe.servicoLC);
          }
          // Merge specific enriched formDadosNFSe fields
          if (enriched.formDadosNFSe) {
            const dadosKeys = [
              'exibeAcessoWeb', 'exibeDataDigitacao', 'exibeRps',
              'processadoPrestador', 'processadoTomador',
              'tipoDocumentoId', 'tipoMovimento', 'existsCreditoObraUtilizado',
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
      this.logger.debug(
        `[MUNICIPAL] Save payload: ${JSON.stringify(payload).slice(0, 3000)}`,
      );

      let saveRes: any;
      try {
        saveRes = await axios.post(
          `${baseUrl}/emissao-nfse/salvar-nota-fiscal`,
          payload,
          { headers, timeout: 30000 },
        );
      } catch (saveErr: any) {
        const saveErrData = saveErr?.response?.data;
        const saveErrStatus = saveErr?.response?.status;
        this.logger.error(
          `[MUNICIPAL] salvar-nota-fiscal failed: status=${saveErrStatus}, data=${JSON.stringify(saveErrData).slice(0, 2000)}`,
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

      // Update NfseDocument with the Elotech ID
      await this.prisma.nfseDocument.update({
        where: { id: nfseDoc!.id },
        data: {
          elotechNfseId: Number(nfseId),
          status: NfseStatus.AUTHORIZED,
          errorMessage: null,
        },
      });

      this.logger.log(
        `[MUNICIPAL] NFS-e authorized: id=${nfseId}, numero=${nfseNumber}`,
      );

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

      this.logger.error(
        `[MUNICIPAL] Failed to emit NFS-e for invoice ${invoice.id}: ${errorMsg}`,
      );
      if (errResponse) {
        this.logger.error(
          `[MUNICIPAL] Full error response: ${JSON.stringify(errResponse).slice(0, 2000)}`,
        );
      }
      throw error;
    }
  }

  /**
   * Cancel an authorized NFS-e via the Elotech OXY REST API.
   *
   * Flow:
   * 1. Load the NfseDocument for the invoice and validate it's AUTHORIZED
   * 2. Authenticate with Elotech OXY
   * 3. GET /solicitacoes-cancelamento/nota-fiscal/{elotechNfseId} to load cancel form data
   * 4. POST /solicitacoes-cancelamento/salvar to submit the cancellation request
   * 5. Update the NfseDocument status to CANCELLED
   */
  async cancelNfse(
    nfseDocumentId: string,
    reason: string,
    reasonCode: number = 1,
  ): Promise<{ cancelled: boolean; elotechNfseId: number }> {
    this.logger.log(
      `[MUNICIPAL] Cancelling NFS-e document ${nfseDocumentId}`,
    );

    if (!this.authService.isConfigured()) {
      throw new Error(
        'Elotech OXY credentials not configured. Cannot cancel municipal NFS-e.',
      );
    }

    const nfseDoc = await this.prisma.nfseDocument.findUnique({
      where: { id: nfseDocumentId },
    });

    if (!nfseDoc) {
      throw new Error(`NfseDocument ${nfseDocumentId} not found`);
    }

    if (nfseDoc.status === NfseStatus.CANCELLED) {
      this.logger.warn(
        `[MUNICIPAL] NFS-e already cancelled: ${nfseDocumentId}`,
      );
      return { cancelled: true, elotechNfseId: nfseDoc.elotechNfseId || 0 };
    }

    if (nfseDoc.status !== NfseStatus.AUTHORIZED) {
      throw new Error(
        `Cannot cancel NFS-e with status ${nfseDoc.status}. Only AUTHORIZED NFS-e can be cancelled.`,
      );
    }

    if (!nfseDoc.elotechNfseId) {
      throw new Error(
        `NfseDocument ${nfseDoc.id} has no elotechNfseId. Cannot cancel.`,
      );
    }

    const elotechNfseId = nfseDoc.elotechNfseId;

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
        motivo: reason,
        ultimoStatus: null,
        arquivos: [],
        idNotaFiscal: cancelFormData.id,
        idCadastroSolicitante: cancelFormData.idCadastroGeralPrestador,
      };

      this.logger.debug(
        `[MUNICIPAL] Cancel payload: ${JSON.stringify(cancelPayload)}`,
      );

      const cancelRes = await axios.post(
        `${baseUrl}/solicitacoes-cancelamento/salvar`,
        cancelPayload,
        { headers, timeout: 30000 },
      );

      this.logger.log(
        `[MUNICIPAL] Cancel response: status=${cancelRes.status}, data=${JSON.stringify(cancelRes.data).slice(0, 500)}`,
      );

      // Step 3: Update NfseDocument status
      await this.prisma.nfseDocument.update({
        where: { id: nfseDoc.id },
        data: {
          status: NfseStatus.CANCELLED,
          errorMessage: null,
        },
      });

      this.logger.log(
        `[MUNICIPAL] NFS-e ${elotechNfseId} cancelled successfully for nfseDocument ${nfseDocumentId}`,
      );

      return { cancelled: true, elotechNfseId };
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
        `[MUNICIPAL] Failed to cancel NFS-e for nfseDocument ${nfseDocumentId}: ${errorMsg}`,
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

    const res = await axios.get(
      `${baseUrl}/emissao-nfse/resumo-nota-fiscal`,
      { headers, params: { idNotaFiscal: elotechNfseId }, timeout: 15000 },
    );

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

    const res = await axios.get(
      `${baseUrl}/emissao-nfse/nota-fiscal-pdf/${elotechNfseId}`,
      { headers, responseType: 'arraybuffer', timeout: 30000 },
    );

    return Buffer.from(res.data);
  }

  private buildFullCityObject(
    city: ElotechCity,
    uf: string,
  ): Record<string, any> {
    const ufDescriptions: Record<string, string> = {
      AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapa',
      BA: 'Bahia', CE: 'Ceara', DF: 'Distrito Federal', ES: 'Espirito Santo',
      GO: 'Goias', MA: 'Maranhao', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul',
      MT: 'Mato Grosso', PA: 'Para', PB: 'Paraiba', PE: 'Pernambuco',
      PI: 'Piaui', PR: 'Parana', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
      RO: 'Rondonia', RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina',
      SE: 'Sergipe', SP: 'Sao Paulo', TO: 'Tocantins',
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

  private async buildPayload(
    invoice: MunicipalEmitNfseInput,
  ): Promise<Record<string, any>> {
    const contribuinte = this.authService.getContribuinteData();
    const providerCnpj = contribuinte?.cnpjCpf || '';
    const providerName = contribuinte?.razaoSocialNome || '';
    const regimeFiscal = contribuinte?.regimeFiscal || 'LUCRO PRESUMIDO';
    const isSimples = contribuinte?.regimeFiscalDto?.simplesNacional === 'S';

    // Build tomador (customer) — must match Elotech OXY portal structure exactly
    const isJuridica = !!invoice.customer.cnpj;
    const cleanDoc = (invoice.customer.cnpj || invoice.customer.cpf || '')
      .replace(/\D/g, '');

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
        const city = await this.authService.findCity(
          invoice.customer.address.cityName,
          uf,
        );
        if (city) {
          formTomador.cidade = this.buildFullCityObject(city, uf);
        }
      }
    }

    const totalAmount = invoice.totalAmount;
    const serialNumber = invoice.task.serialNumber || invoice.task.name;

    // Build vehicle identification for description
    const vehicleParts: string[] = [];
    if (invoice.task.serialNumber) {
      vehicleParts.push(`nº série: ${invoice.task.serialNumber}`);
    }
    if (invoice.truck?.chassisNumber) {
      vehicleParts.push(`chassi: ${invoice.truck.chassisNumber}`);
    }
    if (invoice.truck?.plate) {
      vehicleParts.push(`placa: ${invoice.truck.plate}`);
    }
    const vehicleRef = vehicleParts.length > 0
      ? `Referente aos serviços executados no veículo ${vehicleParts.join(', ')}.`
      : `Ref. OS ${serialNumber}`;

    // Build line items — must use exact field names from Elotech portal
    const services = invoice.services;
    let formItensNFSe: Record<string, any>[];
    let discriminacaoServico: string;
    let totalDescontosIncondicionados = 0;

    const buildItem = (
      description: string,
      amount: number,
      index: number,
      discountType?: string,
      discountValue?: number | null,
    ) => {
      let valorDesconto = 0;
      if (discountType === 'PERCENTAGE' && discountValue) {
        valorDesconto = Math.round((amount * discountValue / 100) * 100) / 100;
      } else if (discountType === 'FIXED_VALUE' && discountValue) {
        valorDesconto = Math.min(discountValue, amount);
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

    if (services && services.length > 0) {
      formItensNFSe = services.map((svc, i) =>
        buildItem(svc.description, svc.amount, i, svc.discountType, svc.discountValue),
      );
      const serviceLines = services.map((s) => s.description).join('\n');
      discriminacaoServico =
        invoice.description || `${vehicleRef}\n\n${serviceLines}`;
    } else {
      const fallbackDesc = invoice.description || `Serviço ref. OS ${serialNumber}`;
      formItensNFSe = [buildItem(fallbackDesc, totalAmount, 0)];
      discriminacaoServico = fallbackDesc;
    }

    totalDescontosIncondicionados = Math.round(totalDescontosIncondicionados * 100) / 100;

    // ISS computation — base = totalNfse - totalDescontosIncondicionados
    const totalNfse = totalAmount;
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
}
