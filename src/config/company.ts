/**
 * Dados institucionais da Ankaa Design usados em documentos gerados pelo servidor.
 *
 * Espelha `web/src/config/company.ts`. Existe aqui porque o servidor passou a ser
 * a fonte da verdade do orçamento assinado e não pode depender do front para
 * saber quem emite o documento.
 *
 * Nota: `PpeDocumentService` (`ppe-document.service.ts:92-98`) carrega um bloco
 * COMPANY_INFO próprio com CNPJ **placeholder** (`00.000.000/0001-00`) impresso
 * nos termos de EPI. Migrar aquele serviço para cá é uma correção pendente e
 * independente deste fluxo.
 */

export const COMPANY = {
  name: 'Ankaa Design',
  corporateName: 'S. RODRIGUES & G. RODRIGUES LTDA',
  cnpj: '13636938000144',
  cnpjFormatted: '13.636.938/0001-44',
  municipalRegistration: '53459',

  address: 'Rua Luis Carlos Zani, 2493 - Jardim Santa Paula, Ibiporã-PR',
  addressShort: 'Rua: Luis Carlos Zani, 2493 - Santa Paula, Ibiporã-PR',
  city: 'Ibiporã',
  state: 'PR',
  zipCode: '86200-000',

  phone: '43 9 8428-3228',
  phoneClean: '5543984283228',
  email: 'ankaadesign@outlook.com',
  website: 'ankaadesign.com.br',
  websiteUrl: 'https://ankaadesign.com.br',

  directorName: 'Sergio Rodrigues',
  directorTitle: 'Diretor Comercial',

  /** Local registrado no dicionário da assinatura PAdES. */
  signatureLocation: 'Ibiporã-PR, Brasil',
} as const;

export const BRAND_COLORS = {
  primaryGreen: '#0a5c1e',
  textDark: '#1a1a1a',
  textGray: '#666666',
} as const;
