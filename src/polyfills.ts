// Polyfill for crypto.randomUUID() for Node.js < 19
import { randomUUID } from 'crypto';

if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {
    randomUUID,
  } as any;
} else if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = randomUUID;
}
