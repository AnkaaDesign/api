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
  /**
   * CEP por rua. Ibiporã trocou o CEP geral único (86200-000) por CEPs de
   * logradouro, e o cadastro do CNPJ ainda carrega o antigo.
   *
   * Não é detalhe cosmético: o CEP geral não existe na base dos Correios como
   * CEP de entrega, e a SEFIN recusa a NFS-e com E0240 ("o CEP não existe ou
   * não pertence ao município") ao validar o endereço do tomador.
   */
  zipCode: '86204-020',

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

/**
 * AS CONTAS QUE RECEBEM — de quem é a chave Pix impressa no dossiê.
 *
 * Não existia. O documento dizia "via depósito em conta" e parava aí: quem
 * recebia o dossiê não tinha para onde pagar, e a chave viajava por WhatsApp,
 * digitada à mão, uma vez por cobrança.
 *
 * A CHAVE DE SELEÇÃO é `Installment.paymentMethod`, que já distingue as contas
 * (`ACCOUNT_GENIVALDO`, `ACCOUNT_SERGIO`) do Pix da empresa (`PIX`). Em produção,
 * 17/09/2026: 85 parcelas `PIX`, 35 `ACCOUNT_SERGIO`, 9 `ACCOUNT_GENIVALDO` — as
 * três formas são usadas de verdade, e o enum já sabia de qual conta se trata.
 * O que faltava era ligá-lo a um cadastro.
 *
 * `BANK_SLIP` NÃO tem entrada aqui, e a ausência é a regra: o boleto carrega a
 * própria linha digitável e vai anexado ao dossiê. Imprimir uma chave Pix ao lado
 * de um boleto é convidar ao pagamento em duplicidade.
 */
export interface ReceivingAccount {
  /** A chave, já formatada para leitura humana — é para ser copiada do papel. */
  key: string;
  /**
   * O TIPO, impresso entre parênteses: o pagador confere antes de colar.
   *
   * ⚠️ A CAIXA É A DO DOCUMENTO, não uma convenção de código. Os dossiês reais
   * saem "Chave Pix (CPF)" e "Chave Pix (telefone)" — sigla em maiúsculas,
   * substantivo comum em minúsculas. Normalizar tudo mudaria o papel.
   */
  keyKind: 'CNPJ' | 'CPF' | 'telefone' | 'e-mail' | 'aleatória';
  /** O favorecido que o app do banco vai mostrar na confirmação. */
  holder: string;
}

export const RECEIVING_ACCOUNTS: Record<string, ReceivingAccount> = {
  /** O padrão: a conta da empresa, chave CNPJ. */
  PIX: {
    key: COMPANY.cnpjFormatted,
    keyKind: 'CNPJ',
    holder: COMPANY.corporateName,
  },
  /**
   * Conta do sócio. A chave é o CPF dele — a mesma que o dossiê do orçamento
   * nº 0904 já trazia impressa.
   */
  ACCOUNT_GENIVALDO: {
    key: '073.329.609-23',
    keyKind: 'CPF',
    holder: 'Genivaldo Rodrigues',
  },
  /**
   * Conta do outro sócio. A chave é o TELEFONE — o mesmo número que a empresa
   * publica no rodapé (ele é o Diretor Comercial, e a linha da Ankaa é o celular
   * dele). Confirmado no dossiê do orçamento nº 0915.
   *
   * ⚠️ NÃO é o CPF. O cadastro tem um (`User.cpf`), e usá-lo por dedução
   * mandaria o cliente pagar numa chave que não existe no banco do favorecido —
   * o Pix recusa, e quem descobre é o financeiro do cliente.
   */
  ACCOUNT_SERGIO: {
    key: '43 98428-3228',
    keyKind: 'telefone',
    holder: 'Sergio Rodrigues',
  },
};

/** A conta desta forma de pagamento, ou nulo quando a forma não é Pix. */
export function receivingAccountFor(method: string | null | undefined): ReceivingAccount | null {
  if (!method) return null;
  return RECEIVING_ACCOUNTS[method] ?? null;
}

/**
 * QUEM RECEBE O COMPROVANTE.
 *
 * O dossiê pede que o comprovante do Pix seja encaminhado, e até aqui não dizia
 * a quem — a frase morria em "encaminhe o comprovante". É uma pessoa, com nome e
 * WhatsApp, e o número é impresso como LINK: no PDF do Chrome um `<a href>`
 * sobrevive ao `printToPDF`, então o cliente toca no número e cai na conversa.
 *
 * ⚠️ `phoneClean` tem o NONO DÍGITO. O número circula escrito como
 * "43 8834-9545", com oito dígitos, e o `wa.me` montado assim não abre conversa
 * nenhuma — celular de DDD 43 tem nove. Confirmado pelo dono em 17/09/2026.
 */
export const BILLING_CONTACT = {
  name: 'Grasiele',
  role: 'Faturamento',
  phone: '+55 43 9 8834-9545',
  phoneClean: '5543988349545',
} as const;

/**
 * O link do WhatsApp de um número já limpo (só dígitos, com DDI).
 *
 * Existe porque `https://wa.me/${x}` estava copiado em mais de dez arquivos
 * entre api e web, cada um com a sua ideia de normalização.
 */
export function whatsappLinkFor(phoneClean: string): string {
  return `https://wa.me/${phoneClean.replace(/\D/g, '')}`;
}

export const BRAND_COLORS = {
  primaryGreen: '#0a5c1e',
  textDark: '#1a1a1a',
  textGray: '#666666',
} as const;

/**
 * Clientes com regra de negócio própria, referenciados pelo **id** (UUID imutável) e não pelo CNPJ:
 * o CNPJ de um Customer já foi sobrescrito em produção uma vez, então não é chave estável.
 *
 * Espelhado em `web/src/config/company.ts`.
 */
export const PINNED_CUSTOMERS = {
  /**
   * Ibiporã Implementos Rodoviários — "Industria de Carrocerias Metalicas Ibipora LTDA",
   * CNPJ 85462471000174. Fatura contra pedido de compra, portanto
   * `BudgetPayer.orderNumber` é obrigatório para ela.
   */
  IBIPORA: '93dfbeb1-aec0-4829-a297-6a2f09fcfe08',
} as const;
