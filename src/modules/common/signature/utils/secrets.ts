/**
 * Segredos da cerimônia de assinatura — verificados, nunca presumidos.
 *
 * O defeito que este arquivo fecha: `SIGNATURE_HMAC_SECRET` ausente fazia
 * `hmacSignature = null` e a assinatura seguia normalmente. Ou seja, a evidência
 * perdia o único elemento que prova que ELA saiu deste servidor (o `evidenceHash`
 * sozinho é recomputável por qualquer um que tenha o JSON), e ninguém percebia —
 * nem o operador, nem o cliente, nem o log. O primeiro a descobrir seria o perito
 * da parte contrária, anos depois.
 *
 * Degradação silenciosa em prova é o pior modo de falha possível: ela não avisa,
 * não recupera e só aparece quando o documento é contestado. Daí a escolha de
 * falhar no boot do módulo, alto e cedo, em vez de "funcionar" pela metade.
 *
 * Nenhum valor de segredo é logado, nem em erro — apenas o NOME da variável e a
 * natureza do problema.
 */

/** 32 caracteres = 16 bytes em hex. Piso, não recomendação (use 32 bytes). */
export const SIGNATURE_SECRET_MIN_LENGTH = 32;

export interface SignatureSecretProblem {
  variable: string;
  problem: string;
}

export type EnvReader = (key: string) => string | undefined;

/**
 * Confere os segredos e devolve a lista de problemas (vazia = tudo certo).
 *
 * Recebe um leitor em vez do `ConfigService` para poder ser chamado do módulo,
 * dos serviços e de um teste sem carregar o Nest.
 */
export function inspectSignatureSecrets(read: EnvReader): SignatureSecretProblem[] {
  const problems: SignatureSecretProblem[] = [];

  const hmac = (read('SIGNATURE_HMAC_SECRET') ?? '').trim();
  const pepper = (read('SIGNATURE_OTP_PEPPER') ?? '').trim();
  const ppe = (read('PPE_SIGNATURE_HMAC_SECRET') ?? '').trim();

  for (const [variable, value, purpose] of [
    ['SIGNATURE_HMAC_SECRET', hmac, 'selo HMAC da evidência de cada assinatura'],
    ['SIGNATURE_OTP_PEPPER', pepper, 'pepper do HMAC dos códigos OTP'],
  ] as const) {
    if (!value) {
      problems.push({ variable, problem: `não configurado (${purpose})` });
      continue;
    }
    if (value.length < SIGNATURE_SECRET_MIN_LENGTH) {
      problems.push({
        variable,
        problem: `curto demais — mínimo de ${SIGNATURE_SECRET_MIN_LENGTH} caracteres (${purpose})`,
      });
    }
  }

  // Os dois pepperizam coisas diferentes (evidência × código OTP). Reusar o
  // mesmo valor faz um comprometimento valer pelos dois.
  if (hmac && pepper && hmac === pepper) {
    problems.push({
      variable: 'SIGNATURE_OTP_PEPPER',
      problem: 'idêntico a SIGNATURE_HMAC_SECRET — use segredos distintos',
    });
  }

  // `PPE_SIGNATURE_HMAC_SECRET` está COMMITADO no repositório (`.env.example`),
  // então seu valor é público. Reaproveitá-lo aqui equivale a não ter segredo:
  // qualquer um com o clone forja o HMAC da evidência.
  if (ppe && hmac && hmac === ppe) {
    problems.push({
      variable: 'SIGNATURE_HMAC_SECRET',
      problem:
        'igual a PPE_SIGNATURE_HMAC_SECRET, cujo valor está commitado no repositório — gere um novo com `openssl rand -hex 32`',
    });
  }
  if (ppe && pepper && pepper === ppe) {
    problems.push({
      variable: 'SIGNATURE_OTP_PEPPER',
      problem:
        'igual a PPE_SIGNATURE_HMAC_SECRET, cujo valor está commitado no repositório — gere um novo com `openssl rand -hex 32`',
    });
  }

  return problems;
}

/** Texto único, acionável, para log e para a exceção de boot. */
export function describeSignatureSecretProblems(problems: SignatureSecretProblem[]): string {
  return (
    'Assinatura eletrônica mal configurada:\n' +
    problems.map(p => `  · ${p.variable}: ${p.problem}`).join('\n') +
    '\nGere cada segredo com `openssl rand -hex 32` e defina-o no .env do servidor. ' +
    'Sem eles a trilha de auditoria perde a prova de origem, e uma assinatura sem prova ' +
    'de origem é pior do que nenhuma.'
  );
}

/** Lança quando algo está errado. Usado no boot do `SignatureModule`. */
export function assertSignatureSecrets(read: EnvReader): void {
  const problems = inspectSignatureSecrets(read);
  if (problems.length) {
    throw new Error(describeSignatureSecretProblems(problems));
  }
}
