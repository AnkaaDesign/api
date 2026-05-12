export class BoletoResponseDto {
  nossoNumero: string;
  codigoBarras: string;
  linhaDigitavel: string;
  cooperativa: string;
  posto: string;
  txid?: string;
  qrCode?: string;
  codigoQrCode?: string;
}

export class BoletoQueryDto {
  nossoNumero: string;
  seuNumero?: string;
  situacao: string;
  dataVencimento: string;
  valor: number;
  valorLiquidacao?: number;
  dataLiquidacao?: string;
  tipoCobranca: string;
}

export class PaidBoletoDto {
  nossoNumero: string;
  seuNumero?: string;
  // Sicredi /liquidados/dia actual field names (differ from webhook payload):
  dataPagamento?: string;   // "yyyy-MM-dd HH:mm:ss" — primary date field
  valorLiquidado?: number;  // primary amount field
  valor?: number;           // fallback amount
  // Legacy / alternate field names kept for compatibility:
  dataLiquidacao?: string;
  dataCredito?: string;
  valorLiquidacao?: number;
  valorDesconto?: number;
  valorJuros?: number;
  valorMulta?: number;
  valorAbatimento?: number;
  [key: string]: any;
}

export class PaidBoletosResponseDto {
  items: PaidBoletoDto[];
  hasNext: boolean;
}
