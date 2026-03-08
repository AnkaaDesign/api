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
  valorLiquidacao: number;
  dataLiquidacao: string;
  dataCredito: string;
  valorDesconto?: number;
  valorJuros?: number;
  valorMulta?: number;
  valorAbatimento?: number;
  seuNumero?: string;
}

export class PaidBoletosResponseDto {
  items: PaidBoletoDto[];
  hasNext: boolean;
}
