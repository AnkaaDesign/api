export class WebhookEventDto {
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
