import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class WebhookEventDto {
  @IsString()
  @IsNotEmpty()
  idEventoWebhook: string;

  @IsString()
  @IsNotEmpty()
  nossoNumero: string;

  @IsString()
  @IsNotEmpty()
  movimento: string;

  // Sicredi sends these as strings (e.g. "101.01")
  @IsOptional()
  valorLiquidacao?: string;

  @IsOptional()
  valorDesconto?: string;

  @IsOptional()
  valorJuros?: string;

  @IsOptional()
  valorMulta?: string;

  @IsOptional()
  valorAbatimento?: string;

  // Sicredi sends dataEvento as array: [YYYY,MM,DD,HH,mm,ss,nanoseconds]
  @IsOptional()
  dataEvento?: number[] | string;

  // Sicredi sends dataPrevisaoPagamento as array: [YYYY,MM,DD]
  @IsOptional()
  dataPrevisaoPagamento?: number[] | string;

  @IsOptional()
  @IsString()
  agencia?: string;

  @IsOptional()
  @IsString()
  posto?: string;

  @IsOptional()
  @IsString()
  beneficiario?: string;

  @IsOptional()
  @IsString()
  carteira?: string;

  @IsOptional()
  @IsString()
  idTituloEmpresa?: string;
}
