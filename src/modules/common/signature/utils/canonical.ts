/**
 * Canonicalização e hashing para a trilha de assinatura.
 *
 * Todo hash que vai a juízo passa por aqui. A parte difícil NUNCA é o SHA-256 —
 * é garantir que a mesma informação lógica produza sempre os mesmos bytes.
 * `JSON.stringify` não serve: a ordem das chaves segue a ordem de inserção, e o
 * JSONB do PostgreSQL não preserva ordem alguma, então um objeto lido de volta do
 * banco serializa diferente do que foi gravado — e o hash "não confere" sem que
 * nada tenha sido adulterado, que é pior do que não ter hash.
 *
 * Implementa RFC 8785 (JSON Canonicalization Scheme):
 *  · chaves de objeto ordenadas por unidade de código UTF-16 (o `sort()` padrão
 *    do JS é exatamente isso);
 *  · números serializados pelo algoritmo Number::toString do ECMAScript (o
 *    `JSON.stringify` nativo já implementa);
 *  · sem espaços em branco.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8785
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

/**
 * Converte um valor para a forma canônica JCS.
 *
 * Lança em tipos que não têm representação estável (Decimal do Prisma, BigInt,
 * Map, class instances). Isso é deliberado: um hash silenciosamente errado é o
 * pior resultado possível aqui, então o chamador é obrigado a decidir
 * explicitamente como cada valor vira string — dinheiro como string de 2 casas,
 * geo com precisão fixa, datas em ISO-8601 UTC.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): CanonicalValue {
  if (value === null || value === undefined) return null;

  const t = typeof value;

  if (t === 'string' || t === 'boolean') return value as string | boolean;

  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error(`canonicalize: número não finito (${String(value)}) não é serializável`);
    }
    return value as number;
  }

  if (t === 'bigint') {
    throw new Error('canonicalize: BigInt não é suportado — converta para string explicitamente');
  }

  if (value instanceof Date) {
    // Sempre UTC com milissegundos. Único tipo não-primitivo com conversão
    // automática, porque só existe uma resposta certa.
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (t === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const name = (value as object).constructor?.name ?? 'unknown';
      throw new Error(
        `canonicalize: objeto do tipo "${name}" não tem serialização estável. ` +
          'Converta explicitamente (ex.: Decimal → toFixed(2), Buffer → hex).',
      );
    }

    const source = value as Record<string, unknown>;
    // RFC 8785 §3.2.3: ordenar por unidade de código UTF-16. É o comportamento do
    // Array#sort padrão sobre strings.
    const keys = Object.keys(source).sort();
    const out: Record<string, CanonicalValue> = {};
    for (const key of keys) {
      const v = source[key];
      if (v === undefined) continue; // undefined não existe em JSON
      out[key] = normalize(v);
    }
    return out;
  }

  throw new Error(`canonicalize: tipo não suportado "${t}"`);
}

/** SHA-256 hex de uma string, Buffer ou estrutura canonicalizável. */
export function sha256Hex(input: string | Buffer | object): string {
  const data =
    typeof input === 'string' || Buffer.isBuffer(input) ? input : canonicalize(input);
  return createHash('sha256').update(data).digest('hex');
}

/** HMAC-SHA256 hex com pepper do servidor. */
export function hmacSha256Hex(input: string | Buffer | object, secret: string): string {
  const data =
    typeof input === 'string' || Buffer.isBuffer(input) ? input : canonicalize(input);
  return createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Comparação de digests em tempo constante.
 *
 * `timingSafeEqual` exige buffers do mesmo tamanho — comprimentos diferentes
 * retornam false sem comparar, o que é seguro aqui porque ambos os lados são
 * sempre digests hex de tamanho fixo.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/** Elo da cadeia de auditoria: hash = SHA256(prevHash || JCS(campos canônicos)). */
export function chainHash(prevHash: string, canonicalFields: object): string {
  return createHash('sha256').update(prevHash).update(canonicalize(canonicalFields)).digest('hex');
}

/** Elo raiz da cadeia (sequence 0). */
export const CHAIN_GENESIS_HASH = '0'.repeat(64);
