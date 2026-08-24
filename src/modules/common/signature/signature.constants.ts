/**
 * Textos jurídicos da cerimônia.
 *
 * Versionados: o que importa em juízo é o texto que AQUELA pessoa leu, então
 * `EnvelopeSigner.declarations` guarda o conteúdo exato exibido, e não um
 * booleano. Alterar qualquer texto aqui exige incrementar a versão.
 */

/**
 * v2 (2026-07-29): o código de uso único passou a ser entregue por e-mail, não
 * mais por WhatsApp. Mudaram a `ACCEPTANCE_CLAUSE` e a declaração `identity`,
 * e a regra do topo deste arquivo obriga a incrementar a versão junto.
 *
 * v3 (2026-08-24): os dois textos deixaram de citar um canal FIXO e passaram a
 * ser função do canal da coleta.
 *
 * POR QUE ISTO ERA UM DEFEITO, E NÃO UM DETALHE
 *   Entre 29/07 e hoje o canal virou configuração (`SIGNATURE_DELIVERY_CHANNEL`)
 *   enquanto estes dois textos continuaram dizendo "e-mail" em toda coleta. Um
 *   envelope colhido por WhatsApp saía com uma cláusula de aceitação declarando
 *   que o código fora enviado ao e-mail cadastrado, e com o signatário
 *   declarando verdadeiro um e-mail que ele nunca informou — enquanto o selo do
 *   PDF, que lê `AUTH_METHOD_LABELS` pelo `authMethod`, imprimia "via WhatsApp".
 *   O artefato contradizia a si mesmo no ponto exato em que ele existe para
 *   provar algo: o art. 10, §2º da MP 2.200-2 pede que as partes tenham aceitado
 *   AQUELE método, e um documento que descreve errado o método que usou entrega
 *   ao adversário a primeira linha de defesa de graça.
 *
 * Envelopes já assinados não são afetados: `EnvelopeSigner.declarations` guarda
 * o texto exato que aquela pessoa leu, e `SignatureEnvelope.acceptanceClause` é
 * persistida por envelope. Nenhum dos dois é retroalimentado.
 */
export const DECLARATIONS_VERSION = 3;

/** O canal de uma coleta, no vocabulário de `signature-delivery.ts`. */
type ClauseChannel = 'WHATSAPP' | 'EMAIL';

/**
 * Cláusula impressa no corpo do orçamento.
 *
 * É o gancho do art. 10, §2º da MP 2.200-2/2001, que condiciona a validade do
 * meio não-ICP a ele ser "admitido pelas partes como válido ou aceito pela pessoa
 * a quem for oposto o documento". Sem esta cláusula resta litigar aceitação
 * tácita — vencível depois do STJ REsp 2.197.156, mas é uma briga que dá para não
 * comprar. Foi exatamente o que decidiu o REsp 2.159.442, onde as partes haviam
 * contratado "assinatura eletrônica via plataforma indicada pelo credor".
 *
 * O trecho que descreve o MEIO segue o canal: é ele que precisa bater com o que
 * a trilha de auditoria e o selo do PDF registram.
 */
export function acceptanceClauseFor(channel: ClauseChannel): string {
  const delivery =
    channel === 'WHATSAPP'
      ? 'enviado por WhatsApp ao número de telefone celular cadastrado do signatário'
      : 'enviado ao endereço de e-mail cadastrado do signatário';

  return (
    'ACEITAÇÃO DO MEIO ELETRÔNICO. As partes reconhecem e aceitam, para todos os fins do ' +
    'art. 10, § 2º, da Medida Provisória nº 2.200-2/2001, a assinatura eletrônica deste ' +
    'orçamento por meio da plataforma da CONTRATADA, mediante autenticação por código de uso ' +
    `único ${delivery} e registro de trilha de auditoria, ` +
    'admitindo tal método como meio válido de comprovação de autoria e integridade, com os ' +
    'mesmos efeitos da assinatura manuscrita, e renunciando a impugná-lo exclusivamente em ' +
    'razão de sua forma eletrônica ou da ausência de certificação ICP-Brasil.'
  );
}

export interface DeclarationDef {
  key: string;
  /** `{}` são substituídos no momento da exibição e o texto final é persistido. */
  template: string;
}

/**
 * Quatro declarações SEPARADAS, nunca uma só.
 *
 * A terceira — poderes de representação — é a que será efetivamente necessária em
 * juízo: a disputa provável em B2B não é "um impostor assinou", é "o gestor de
 * frota assinou mas não podia obrigar a empresa". Ela precisa ser ato afirmativo
 * próprio, com timestamp e IP próprios. O CC art. 118 já põe sobre o
 * representante o ônus de provar sua qualidade e a extensão de seus poderes, sob
 * pena de responder pessoalmente pelo excesso.
 */
export function declarationsFor(channel: ClauseChannel): DeclarationDef[] {
  return [
    {
      key: 'reviewed',
      template:
        'Declaro que li e revisei integralmente este orçamento nº {budgetNumber}, no valor ' +
        'total de {total}, e que concordo com seu conteúdo.',
    },
    {
      key: 'identity',
      // O contato declarado é o do CANAL da coleta — é ele que recebeu o código
      // e é a posse dele que a assinatura opõe ao signatário. Pedir declaração
      // sobre um e-mail numa coleta por WhatsApp é pedir que ele afirme algo que
      // não informou e que a cerimônia nunca usou.
      template:
        channel === 'WHATSAPP'
          ? 'Declaro que os dados de identificação por mim informados (nome, CPF e telefone ' +
            'celular) são verdadeiros e me pertencem, e que o número de telefone celular em ' +
            'que recebo o código de uso único está sob a minha posse.'
          : 'Declaro que os dados de identificação por mim informados (nome, CPF e e-mail) são ' +
            'verdadeiros e me pertencem, e que a caixa de e-mail em que recebo o código de uso ' +
            'único está sob o meu controle.',
    },
    {
      key: 'authority',
      template:
        'Declaro que exerço o cargo de {cargo} na {company} e que detenho poderes para ' +
        'representá-la e aprovar este orçamento neste ato.',
    },
    {
      key: 'method',
      template:
        'Reconheço que esta assinatura eletrônica produz os mesmos efeitos da assinatura ' +
        'manuscrita, nos termos do art. 10, § 2º, da MP nº 2.200-2/2001, e autorizo o registro ' +
        'de meu nome, CPF, endereço IP, data e hora na trilha de auditoria deste documento.',
    },
  ];
}

/**
 * As CHAVES não dependem do canal — só os textos dependem.
 *
 * Separá-las importa: a validação do POST de assinatura confere se o signatário
 * aceitou todas as declarações, e derivar essa lista de um canal exigiria
 * resolver o canal para responder "faltou alguma?". Uma divergência ali
 * recusaria assinaturas legítimas.
 */
export const DECLARATION_KEYS: readonly string[] = [
  'reviewed',
  'identity',
  'authority',
  'method',
];

export function renderDeclaration(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '—'));
}

/** Base legal registrada em cada envelope (LGPD art. 7º IX + VI; nunca consentimento). */
export const LEGAL_BASIS = 'MP 2.200-2/2001, art. 10, §2º';

/**
 * Rótulos de método de autenticação impressos no selo e na trilha.
 *
 * WHATSAPP_OTP e SMS_OTP ficam aqui PARA SEMPRE. O selo é reestampado a cada
 * download do PDF interno (`stampSeals`), lendo este mapa ao vivo — remover a
 * chave faria um documento antigo passar a imprimir o nome cru do enum no lugar
 * do método que de fato autenticou aquela pessoa.
 */
export const AUTH_METHOD_LABELS: Record<string, string> = {
  EMAIL_OTP: 'Código de uso único via e-mail',
  WHATSAPP_OTP: 'Código de uso único via WhatsApp',
  SMS_OTP: 'Código de uso único via SMS',
  INTERNAL_SESSION: 'Sessão autenticada Ankaa',
};

/** Descrições em português dos eventos, usadas na página de trilha de auditoria. */
export const EVENT_DESCRIPTIONS: Record<string, string> = {
  ENVELOPE_CREATED: 'Envelope criado e documento congelado',
  DOCUMENT_FROZEN: 'Bytes do documento congelados e hasheados',
  INVITATION_SENT: 'Convite enviado ao signatário',
  INVITATION_FAILED: 'Falha ao enviar o convite',
  DOCUMENT_VIEWED: 'Documento visualizado',
  DOCUMENT_SCROLLED_END: 'Signatário percorreu o documento até o fim',
  CPF_SUBMITTED: 'CPF e cargo informados pelo signatário',
  CPF_MISMATCH: 'CPF informado diverge do declarado pela Ankaa',
  OTP_SENT: 'Código de uso único enviado',
  OTP_DELIVERY_FAILED: 'Falha na entrega do código',
  OTP_VERIFIED: 'Código validado',
  OTP_FAILED: 'Tentativa de código inválida',
  OTP_LOCKED: 'Código bloqueado por excesso de tentativas',
  DECLARATIONS_ACCEPTED: 'Declarações aceitas',
  SIGNATURE_APPLIED: 'Assinatura aplicada',
  SIGNATURE_REFUSED: 'Assinatura recusada',
  SIGNER_VOIDED: 'Assinatura invalidada por alteração do orçamento',
  CONTACT_CHANGED: 'Contato do signatário alterado pela Ankaa',
  ENVELOPE_INVALIDATED: 'Envelope invalidado por alteração material do orçamento',
  ENVELOPE_EXPIRED: 'Envelope expirado',
  ENVELOPE_CANCELLED: 'Envelope cancelado',
  DOCUMENT_ASSEMBLED: 'Documento final montado',
  PADES_SEALED: 'Selo PAdES ICP-Brasil aplicado',
  PADES_FAILED: 'Falha ao aplicar o selo PAdES',
  TSA_STAMPED: 'Carimbo do tempo aplicado',
  TSA_FAILED: 'Falha ao obter carimbo do tempo',
  DOCUMENT_FINALIZED: 'Documento finalizado',
  DOCUMENT_DOWNLOADED: 'Documento baixado',
  VERIFICATION_VIEWED: 'Consulta pública de verificação',
};

/**
 * Marca d'água do PDF servido, por status de envelope.
 *
 * O histórico de versões continua acessível: é ele que mostra o que foi
 * colhido, quando, e por que caiu. O risco é o artefato circular sozinho — um
 * PDF antigo tem os mesmos selos "ASSINADO ELETRONICAMENTE" de um válido e,
 * fora da tela que o listou, nada o distingue. A marca resolve no próprio
 * arquivo.
 *
 * COMPLETED não aparece aqui de propósito: aquele caminho serve o artefato
 * selado em PAdES, byte a byte, e carimbar qualquer coisa por cima quebraria a
 * assinatura criptográfica.
 */
export const VOID_WATERMARK_LABELS: Record<string, string> = {
  INVALIDATED: 'Sem validade',
  SUPERSEDED: 'Versão substituída',
  CANCELLED: 'Coleta cancelada',
  EXPIRED: 'Prazo expirado',
  REFUSED: 'Assinatura recusada',
};
