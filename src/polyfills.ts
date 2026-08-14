// Polyfill for crypto.randomUUID() for Node.js < 19
import { randomUUID } from 'crypto';

if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {
    randomUUID,
  } as any;
} else if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = randomUUID;
}

/**
 * BigInt não tem representação em JSON, então `JSON.stringify` LANÇA ao topar
 * com um — e no Express isso vira 500 na hora de serializar a resposta, sem
 * relação aparente com o dado que causou.
 *
 * O schema tem três colunas BigInt (`File.size`, `FiscalDpsSequence.lastNumber`,
 * `AirbrushingNfse.nDps`). Qualquer endpoint que devolva uma delas quebrava —
 * era uma armadilha latente que só apareceu quando a listagem de aerografias
 * passou a incluir a NFS-e.
 *
 * Serializar como string (e não como número) é deliberado: BigInt existe
 * justamente para valores que podem passar de Number.MAX_SAFE_INTEGER, e
 * convertê-los para number os corromperia em silêncio.
 */
if (!(BigInt.prototype as any).toJSON) {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function toJSON(this: bigint) {
      return this.toString();
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
