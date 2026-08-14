/**
 * Cliente da API do Sistema Nacional da NFS-e (SEFIN Nacional).
 *
 * Autenticação é mTLS: não há token nem chave de API. O certificado apresentado
 * no handshake TLS É a credencial, e a SEFIN só devolve a chave de acesso se o
 * certificado da conexão corresponder a um dos atores declarados na DPS. Por isso
 * o agente HTTPS vem por chamada, montado a partir do A1 do pintor, em vez de
 * ficar fixo numa instância axios.
 *
 * Troca de mensagens: JSON, com os XMLs sempre GZip + base64.
 */

import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, type AxiosInstance } from 'axios';
import { gunzipSync } from 'node:zlib';
import type * as https from 'node:https';

/** 1 = Produção, 2 = Produção Restrita. */
export type NfseEnvironment = 1 | 2;

const BASE_URLS: Record<NfseEnvironment, string> = {
  1: 'https://sefin.nfse.gov.br/SefinNacional',
  2: 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional',
};

export interface SefinEmissionResult {
  chaveAcesso: string;
  idDps: string | null;
  nfseXml: string;
  tipoAmbiente: number | null;
  versaoAplicativo: string | null;
  dataHoraProcessamento: string | null;
  alertas: unknown[];
}

export interface SefinErrorDetail {
  codigo: string | null;
  mensagem: string;
}

/**
 * Falha vinda da SEFIN, já classificada.
 *
 * `permanent` é o que decide se a varredura tenta de novo. Rejeição de leiaute,
 * regra de negócio ou certificado não se cura sozinha: repetir só queima
 * tentativa e polui log. Já 5xx, timeout e queda de rede são transitórios.
 */
export class SefinError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
    readonly code: string | null = null,
    readonly httpStatus: number | null = null,
    readonly details: SefinErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'SefinError';
  }
}

@Injectable()
export class SefinNacionalClient {
  private readonly logger = new Logger(SefinNacionalClient.name);

  private client(environment: NfseEnvironment, agent: https.Agent): AxiosInstance {
    return axios.create({
      baseURL: process.env.NFSE_NACIONAL_BASE_URL || BASE_URLS[environment],
      timeout: Number(process.env.NFSE_NACIONAL_TIMEOUT_MS || 60_000),
      httpsAgent: agent,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      // Nunca lançar por status: a classificação é nossa, feita em parseError.
      validateStatus: () => true,
    });
  }

  /** Transmite a DPS assinada. Emissão é síncrona: ou volta a NFS-e, ou a rejeição. */
  async emit(params: {
    environment: NfseEnvironment;
    agent: https.Agent;
    dpsXmlGZipB64: string;
  }): Promise<SefinEmissionResult> {
    const http = this.client(params.environment, params.agent);

    const response = await http
      .post('/nfse', { dpsXmlGZipB64: params.dpsXmlGZipB64 })
      .catch((error: unknown) => {
        throw this.fromTransportError(error);
      });

    if (response.status !== 200 && response.status !== 201) {
      throw this.parseError(response.status, response.data);
    }

    const data = response.data ?? {};
    const chaveAcesso = String(data.chaveAcesso ?? '').trim();
    if (!chaveAcesso) {
      throw new SefinError(
        'A SEFIN respondeu sucesso mas sem chave de acesso — resposta inesperada.',
        false,
        null,
        response.status,
      );
    }

    return {
      chaveAcesso,
      idDps: data.idDps ? String(data.idDps) : null,
      nfseXml: this.unpack(data.nfseXmlGZipB64),
      tipoAmbiente: typeof data.tipoAmbiente === 'number' ? data.tipoAmbiente : null,
      versaoAplicativo: data.versaoAplicativo ? String(data.versaoAplicativo) : null,
      dataHoraProcessamento: data.dataHoraProcessamento
        ? String(data.dataHoraProcessamento)
        : null,
      alertas: Array.isArray(data.alertas) ? data.alertas : [],
    };
  }

  /** Consulta a NFS-e pela chave de acesso. Usada na recuperação de notas presas. */
  async query(params: {
    environment: NfseEnvironment;
    agent: https.Agent;
    chaveAcesso: string;
  }): Promise<{ chaveAcesso: string; nfseXml: string }> {
    const http = this.client(params.environment, params.agent);
    const response = await http
      .get(`/nfse/${encodeURIComponent(params.chaveAcesso)}`)
      .catch((error: unknown) => {
        throw this.fromTransportError(error);
      });

    if (response.status !== 200) {
      throw this.parseError(response.status, response.data);
    }

    return {
      chaveAcesso: String(response.data?.chaveAcesso ?? params.chaveAcesso),
      nfseXml: this.unpack(response.data?.nfseXmlGZipB64),
    };
  }

  /**
   * Verifica se uma DPS já foi processada, sem gerar nota nova.
   *
   * É o que desfaz a ambiguidade quando a resposta se perde depois da SEFIN já ter
   * autorizado: reenviar cegamente arriscaria duplicidade; o HEAD responde se
   * aquele idDps já existe. 200 = existe, 404 = não existe.
   */
  async dpsExists(params: {
    environment: NfseEnvironment;
    agent: https.Agent;
    dpsId: string;
  }): Promise<boolean> {
    const http = this.client(params.environment, params.agent);
    const response = await http
      .head(`/dps/${encodeURIComponent(params.dpsId)}`)
      .catch((error: unknown) => {
        throw this.fromTransportError(error);
      });

    if (response.status === 200) return true;
    if (response.status === 404) return false;
    throw this.parseError(response.status, response.data);
  }

  /** Recupera a chave de acesso gerada a partir de uma DPS já processada. */
  async findByDpsId(params: {
    environment: NfseEnvironment;
    agent: https.Agent;
    dpsId: string;
  }): Promise<{ chaveAcesso: string } | null> {
    const http = this.client(params.environment, params.agent);
    const response = await http
      .get(`/dps/${encodeURIComponent(params.dpsId)}`)
      .catch((error: unknown) => {
        throw this.fromTransportError(error);
      });

    if (response.status === 404) return null;
    if (response.status !== 200) throw this.parseError(response.status, response.data);

    const chave = String(response.data?.chaveAcesso ?? '').trim();
    return chave ? { chaveAcesso: chave } : null;
  }

  /**
   * Registra um evento (usado para cancelamento).
   *
   * O nome do campo — `pedidoRegistroEventoXmlGZipB64` — foi CONFIRMADO contra a
   * SEFIN em produção restrita: o nome alternativo da documentação
   * (`pedRegEventoXmlGZipB64`) devolve HTTP 500.
   */
  async registerEvent(params: {
    environment: NfseEnvironment;
    agent: https.Agent;
    chaveAcesso: string;
    eventXmlGZipB64: string;
  }): Promise<{ eventoXml: string | null }> {
    const http = this.client(params.environment, params.agent);
    const response = await http
      .post(`/nfse/${encodeURIComponent(params.chaveAcesso)}/eventos`, {
        pedidoRegistroEventoXmlGZipB64: params.eventXmlGZipB64,
      })
      .catch((error: unknown) => {
        throw this.fromTransportError(error);
      });

    if (response.status !== 200 && response.status !== 201) {
      throw this.parseError(response.status, response.data);
    }

    return {
      eventoXml: response.data?.eventoXmlGZipB64
        ? this.unpack(response.data.eventoXmlGZipB64)
        : null,
    };
  }

  /** Serializa qualquer coisa sem lançar — inclusive ciclos e BigInt. */
  private safeJson(value: unknown): string {
    try {
      const seen = new WeakSet<object>();
      return JSON.stringify(value, (_key, val) => {
        if (typeof val === 'bigint') return val.toString();
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[circular]';
          seen.add(val);
        }
        return val;
      });
    } catch {
      return String(value);
    }
  }

  private unpack(value: unknown): string {
    if (!value || typeof value !== 'string') return '';
    try {
      return gunzipSync(Buffer.from(value, 'base64')).toString('utf-8');
    } catch (error) {
      this.logger.warn(
        `[SEFIN] Não foi possível descompactar XML da resposta: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return '';
    }
  }

  private fromTransportError(error: unknown): SefinError {
    const axiosError = error as AxiosError;

    if (axiosError?.code === 'ECONNABORTED' || axiosError?.code === 'ETIMEDOUT') {
      return new SefinError('Tempo esgotado ao falar com a SEFIN.', false, axiosError.code, null);
    }
    if (axiosError?.code === 'ENOTFOUND' || axiosError?.code === 'ECONNREFUSED') {
      return new SefinError('SEFIN inacessível no momento.', false, axiosError.code, null);
    }

    // Erros de TLS aparecem aqui e são, na prática, problema de certificado —
    // repetir não resolve enquanto o certificado não for trocado.
    const message = axiosError?.message ?? String(error);
    if (/certificate|SSL|TLS|EPROTO|DEPTH_ZERO/i.test(message)) {
      return new SefinError(
        `Falha de TLS com o certificado do prestador: ${message}`,
        true,
        axiosError?.code ?? null,
        null,
      );
    }

    return new SefinError(`Falha de comunicação com a SEFIN: ${message}`, false, null, null);
  }

  /**
   * Traduz o corpo de erro da SEFIN.
   *
   * O formato varia — `{erros:[{codigo,descricao,complemento}]}`, `{mensagem}`,
   * RFC 7807 (`{title,detail}`), lista no topo — e a documentação não fixa um.
   *
   * A regra aqui é: **nunca perder o corpo**. A primeira versão fazia
   * `String(item)` como último recurso e, quando a SEFIN respondeu com chaves
   * fora da lista prevista, o erro persistido virou "[object Object]" — que é o
   * pior resultado possível, porque descarta exatamente o dado necessário para
   * descobrir o que estava errado. Agora um formato desconhecido é serializado
   * como JSON e sobrevive inteiro.
   */
  private parseError(status: number, body: unknown): SefinError {
    const details: SefinErrorDetail[] = [];
    const data = (body ?? {}) as Record<string, any>;

    /** Texto legível de um item de erro, seja qual for o formato. */
    const describe = (item: unknown): string => {
      if (item === null || item === undefined) return '';
      if (typeof item === 'string') return item;
      if (typeof item !== 'object') return String(item);

      const obj = item as Record<string, any>;
      // Chaves conhecidas, comparadas sem diferenciar maiúsculas: a SEFIN já
      // respondeu com "Mensagem" e com "mensagem" em endpoints diferentes.
      for (const key of Object.keys(obj)) {
        if (/^(descricao|descrição|mensagem|message|detail|erro|error|motivo)$/i.test(key)) {
          const value = obj[key];
          if (typeof value === 'string' && value.trim()) return value.trim();
        }
      }
      return this.safeJson(obj);
    };

    const rawList = Array.isArray(body)
      ? (body as unknown[])
      : Array.isArray(data.erros)
        ? data.erros
        : Array.isArray(data.errors)
          ? data.errors
          : Array.isArray(data.alertas)
            ? data.alertas
            : [];

    for (const item of rawList) {
      const obj = (item ?? {}) as Record<string, any>;
      const codigo = obj.codigo ?? obj.code ?? obj.Codigo ?? null;
      const complemento = obj.complemento ?? obj.Complemento;
      const texto = describe(item);
      details.push({
        codigo: codigo ? String(codigo) : null,
        mensagem: `${texto}${complemento ? ` (${complemento})` : ''}`,
      });
    }

    if (details.length === 0) {
      const fallback =
        data.mensagem ?? data.message ?? data.detail ?? data.title ?? data.erro ?? null;
      if (fallback) {
        details.push({ codigo: data.codigo ? String(data.codigo) : null, mensagem: describe(fallback) });
      } else if (typeof body === 'string' && body.trim()) {
        details.push({ codigo: null, mensagem: body.trim() });
      } else if (body && typeof body === 'object' && Object.keys(data).length > 0) {
        // Formato inesperado: preserva o corpo cru em vez de engolir.
        details.push({ codigo: null, mensagem: this.safeJson(data) });
      }
    }

    // O corpo cru também vai para o log: a mensagem persistida é truncada em
    // 1000 caracteres e uma rejeição com muitos itens pode passar disso.
    this.logger.warn(`[SEFIN] HTTP ${status} — corpo: ${this.safeJson(body).slice(0, 4000)}`);

    const code = details.find(d => d.codigo)?.codigo ?? null;
    const message =
      details.map(d => (d.codigo ? `[${d.codigo}] ${d.mensagem}` : d.mensagem)).join(' | ') ||
      `SEFIN respondeu HTTP ${status} sem detalhamento.`;

    // 496 é o status que o servidor da SEFIN devolve quando NENHUM certificado
    // cliente foi apresentado no handshake.
    if (status === 496) {
      return new SefinError(
        'A SEFIN exigiu certificado cliente e nenhum foi apresentado (HTTP 496).',
        true,
        '496',
        status,
        details,
      );
    }

    // 4xx é rejeição de leiaute/regra/certificado: não se cura com repetição.
    // 5xx e 429 são do lado deles.
    const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;

    return new SefinError(message, permanent, code, status, details);
  }
}
