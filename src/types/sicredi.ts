// =====================
// Sicredi OAuth2
// =====================

export interface SicrediAuthResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  refresh_expires_in?: number;
  scope?: string;
}

// =====================
// Sicredi Boleto API
// =====================

export interface SicrediCreateBoletoRequest {
  tipoCobranca: 'NORMAL' | 'HIBRIDO';
  pagador: {
    tipoPessoa: 'PESSOA_FISICA' | 'PESSOA_JURIDICA';
    documento: string;
    nome: string;
    endereco: string;
    cidade: string;
    uf: string;
    cep: string;
    telefone?: string;
    email?: string;
  };
  beneficiarioFinal?: {
    tipoPessoa: 'PESSOA_FISICA' | 'PESSOA_JURIDICA';
    documento: string;
    nome: string;
  };
  especieDocumento: string;
  seuNumero?: string;
  dataVencimento: string; // dd/MM/yyyy
  valor: number;
  tipoDesconto?: 'VALOR' | 'PERCENTUAL';
  valorDesconto1?: number;
  dataDesconto1?: string;
  tipoJuros?: 'VALOR' | 'PERCENTUAL';
  juros?: number;
  tipoMulta?: 'VALOR' | 'PERCENTUAL';
  multa?: number;
  dataMulta?: string;
  informativos?: string[];
  mensagem?: string;
}

export interface SicrediCreateBoletoResponse {
  nossoNumero: string;
  codigoBarra: string;
  linhaDigitavel: string;
  cooperativa: string;
  posto: string;
  txid?: string;
  qrCode?: string;
}

export interface SicrediQueryBoletoResponse {
  nossoNumero: string;
  seuNumero?: string;
  situacao: string;
  dataVencimento: string;
  valor: number;
  valorLiquidacao?: number;
  dataLiquidacao?: string;
  tipoCobranca: string;
}

export interface SicrediPaidBoletosResponse {
  boletos: SicrediPaidBoleto[];
}

export interface SicrediPaidBoleto {
  nossoNumero: string;
  valorLiquidacao: number;
  dataLiquidacao: string;
  dataCredito: string;
  valorDesconto?: number;
  valorJuros?: number;
  valorMulta?: number;
  valorAbatimento?: number;
}

// =====================
// Sicredi Webhook
// =====================

export interface SicrediWebhookPayload {
  idEventoWebhook: string;
  nossoNumero: string;
  movimento: string;
  valorLiquidacao?: number;
  valorDesconto?: number;
  valorJuros?: number;
  valorMulta?: number;
  valorAbatimento?: number;
  dataEvento?: string;
  dataPrevisaoPagamento?: string;
  agencia?: string;
  posto?: string;
  beneficiario?: string;
  carteira?: string;
}
