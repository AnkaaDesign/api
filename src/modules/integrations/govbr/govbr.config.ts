import { ConfigService } from '@nestjs/config';
import { GovbrEnvironment } from './dto/sign-document.dto';

export interface GovbrEnvConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  signUrl: string;
  certificateUrl: string;
}

const STAGING_URLS = {
  authorizeUrl: 'https://sso.staging.acesso.gov.br/authorize',
  tokenUrl: 'https://cas.staging.iti.br/oauth2.0/token',
  signUrl: 'https://assinatura.staging.iti.br/externo/v2/assinarPKCS7',
  certificateUrl: 'https://assinatura.staging.iti.br/externo/v2/certificadoPublico',
};

const PRODUCTION_URLS = {
  authorizeUrl: 'https://sso.acesso.gov.br/authorize',
  tokenUrl: 'https://cas.iti.br/oauth2.0/token',
  signUrl: 'https://assinatura.iti.br/externo/v2/assinarPKCS7',
  certificateUrl: 'https://assinatura.iti.br/externo/v2/certificadoPublico',
};

export function getGovbrConfig(
  configService: ConfigService,
  environment: GovbrEnvironment,
): GovbrEnvConfig {
  const isProduction = environment === 'production';
  const prefix = isProduction ? 'GOVBR_PRODUCTION' : 'GOVBR_STAGING';
  const urls = isProduction ? PRODUCTION_URLS : STAGING_URLS;

  return {
    clientId: configService.get<string>(`${prefix}_CLIENT_ID`) || '',
    clientSecret: configService.get<string>(`${prefix}_CLIENT_SECRET`) || '',
    ...urls,
  };
}
