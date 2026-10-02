import * as https from 'https';

// Minimal IPP/2.0 client (RFC 8010/8011) — just the operations the label printer needs:
// Get-Printer-Attributes, Validate-Job, Print-Job, Get-Job-Attributes and Cancel-Job.
// Hand-written instead of a dependency: the wire format is small and fully specified, and the
// printer (Epson L3250) only speaks IPP over TLS with a self-signed certificate.

const TAG = {
  operation: 0x01,
  job: 0x02,
  end: 0x03,
  printer: 0x04,
  unsupported: 0x05,
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  resolution: 0x32,
  rangeOfInteger: 0x33,
  begCollection: 0x34,
  textWithLanguage: 0x35,
  nameWithLanguage: 0x36,
  endCollection: 0x37,
  text: 0x41,
  name: 0x42,
  keyword: 0x44,
  uri: 0x45,
  charset: 0x47,
  naturalLanguage: 0x48,
  mimeMediaType: 0x49,
  memberAttrName: 0x4a,
} as const;

const OPERATION = {
  printJob: 0x0002,
  validateJob: 0x0004,
  cancelJob: 0x0008,
  getJobAttributes: 0x0009,
  getPrinterAttributes: 0x000b,
} as const;

/** A value to send: the tag decides how it is encoded. Collections nest members by name. */
export type IppOutValue =
  | { tag: 'integer' | 'enum'; value: number }
  | { tag: 'boolean'; value: boolean }
  | {
      tag: 'keyword' | 'name' | 'text' | 'uri' | 'charset' | 'naturalLanguage' | 'mimeMediaType';
      value: string;
    }
  | { tag: 'collection'; value: Record<string, IppOutValue | IppOutValue[]> };

export type IppValue =
  | string
  | number
  | boolean
  | { x: number; y: number; units: number }
  | IppCollection;
export interface IppCollection {
  [member: string]: IppValue[];
}
export type IppAttributes = Record<string, IppValue[]>;

export interface IppResponse {
  statusCode: number;
  operation: IppAttributes;
  printer: IppAttributes;
  job: IppAttributes;
  unsupported: IppAttributes;
}

export class IppError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly kind: 'unreachable' | 'timeout' | 'protocol' | 'rejected' = 'protocol',
  ) {
    super(message);
  }
}

// --- encoding ---

class Writer {
  private chunks: Buffer[] = [];
  u8(n: number) {
    const b = Buffer.alloc(1);
    b.writeUInt8(n);
    this.chunks.push(b);
  }
  u16(n: number) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    this.chunks.push(b);
  }
  i32(n: number) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n);
    this.chunks.push(b);
  }
  bytes(b: Buffer) {
    this.chunks.push(b);
  }
  text(s: string) {
    const b = Buffer.from(s, 'utf8');
    this.u16(b.length);
    this.bytes(b);
  }
  done() {
    return Buffer.concat(this.chunks);
  }
}

function writeValue(w: Writer, name: string, v: IppOutValue) {
  if (v.tag === 'collection') {
    w.u8(TAG.begCollection);
    w.text(name);
    w.u16(0);
    for (const [member, mv] of Object.entries(v.value)) {
      const list = Array.isArray(mv) ? mv : [mv];
      // the member name travels as the memberAttrName's VALUE; extra values follow with no name
      w.u8(TAG.memberAttrName);
      w.u16(0);
      w.text(member);
      list.forEach(item => writeValue(w, '', item));
    }
    w.u8(TAG.endCollection);
    w.u16(0);
    w.u16(0);
    return;
  }
  w.u8(TAG[v.tag]);
  w.text(name);
  switch (v.tag) {
    case 'integer':
    case 'enum':
      w.u16(4);
      w.i32(v.value);
      break;
    case 'boolean':
      w.u16(1);
      w.u8(v.value ? 1 : 0);
      break;
    default:
      w.text(v.value);
  }
}

function writeAttribute(w: Writer, name: string, value: IppOutValue | IppOutValue[]) {
  const list = Array.isArray(value) ? value : [value];
  list.forEach((v, i) => writeValue(w, i === 0 ? name : '', v));
}

function encodeRequest(
  operationId: number,
  requestId: number,
  operationAttrs: Record<string, IppOutValue | IppOutValue[]>,
  jobAttrs?: Record<string, IppOutValue | IppOutValue[]>,
): Buffer {
  const w = new Writer();
  w.u8(2); // IPP/2.0
  w.u8(0);
  w.u16(operationId);
  w.i32(requestId);
  w.u8(TAG.operation);
  // charset and natural language must come first, in this order (RFC 8011 §4.1.4)
  writeAttribute(w, 'attributes-charset', { tag: 'charset', value: 'utf-8' });
  writeAttribute(w, 'attributes-natural-language', { tag: 'naturalLanguage', value: 'pt-br' });
  for (const [name, value] of Object.entries(operationAttrs)) writeAttribute(w, name, value);
  if (jobAttrs && Object.keys(jobAttrs).length) {
    w.u8(TAG.job);
    for (const [name, value] of Object.entries(jobAttrs)) writeAttribute(w, name, value);
  }
  w.u8(TAG.end);
  return w.done();
}

// --- decoding ---

function decodeResponse(buf: Buffer): IppResponse {
  if (buf.length < 8) throw new IppError('Resposta IPP incompleta da impressora.');
  let pos = 0;
  const u8 = () => buf.readUInt8(pos++);
  const u16 = () => {
    const v = buf.readUInt16BE(pos);
    pos += 2;
    return v;
  };
  const take = (n: number) => {
    if (pos + n > buf.length) throw new IppError('Resposta IPP truncada da impressora.');
    const b = buf.subarray(pos, pos + n);
    pos += n;
    return b;
  };

  pos = 2; // version
  const statusCode = u16();
  pos += 4; // request id

  const res: IppResponse = { statusCode, operation: {}, printer: {}, job: {}, unsupported: {} };
  const groups: Record<number, IppAttributes> = {
    [TAG.operation]: res.operation,
    [TAG.printer]: res.printer,
    [TAG.job]: res.job,
    [TAG.unsupported]: res.unsupported,
  };

  const readValue = (tag: number, raw: Buffer): IppValue => {
    switch (tag) {
      case TAG.integer:
      case TAG.enum:
        return raw.readInt32BE(0);
      case TAG.boolean:
        return raw.readUInt8(0) !== 0;
      case TAG.resolution:
        return { x: raw.readInt32BE(0), y: raw.readInt32BE(4), units: raw.readUInt8(8) };
      case TAG.rangeOfInteger:
        return `${raw.readInt32BE(0)}-${raw.readInt32BE(4)}`;
      case TAG.textWithLanguage:
      case TAG.nameWithLanguage: {
        const langLen = raw.readUInt16BE(0);
        const textLen = raw.readUInt16BE(2 + langLen);
        return raw.subarray(4 + langLen, 4 + langLen + textLen).toString('utf8');
      }
      default:
        return raw.toString('utf8');
    }
  };

  // collections are read recursively; returns after the matching endCollection
  const readCollection = (): IppCollection => {
    const col: IppCollection = {};
    let member = '';
    for (;;) {
      const tag = u8();
      const nameLen = u16();
      take(nameLen);
      const valueLen = u16();
      const raw = take(valueLen);
      if (tag === TAG.endCollection) return col;
      if (tag === TAG.memberAttrName) {
        member = raw.toString('utf8');
        continue;
      }
      const value = tag === TAG.begCollection ? readCollection() : readValue(tag, raw);
      (col[member] ??= []).push(value);
    }
  };

  let group: IppAttributes | undefined;
  let lastName = '';
  while (pos < buf.length) {
    const tag = u8();
    if (tag === TAG.end) break;
    if (tag <= 0x0f) {
      group = groups[tag] ?? {};
      continue;
    }
    const nameLen = u16();
    const name = take(nameLen).toString('utf8');
    const valueLen = u16();
    const raw = take(valueLen);
    if (name) lastName = name;
    const value = tag === TAG.begCollection ? readCollection() : readValue(tag, raw);
    if (group) (group[lastName] ??= []).push(value);
  }
  return res;
}

// --- transport ---

export interface IppClientOptions {
  /** e.g. ipps://192.168.10.121:631/ipp/print */
  printerUri: string;
  timeoutMs?: number;
}

const STATUS_MESSAGES: Record<number, string> = {
  0x0400: 'A impressora recusou o pedido (requisição inválida).',
  0x0401: 'A impressora recusou o pedido (acesso proibido).',
  0x040a: 'A impressora não aceita esse formato de documento.',
  0x040b: 'A impressora não aceita uma das configurações pedidas.',
  0x040e: 'A impressora recusou a combinação de configurações (papel × qualidade).',
  0x0500: 'Erro interno da impressora.',
  0x0506: 'A impressora não está aceitando trabalhos agora.',
  0x0507: 'A impressora está ocupada. Tente de novo em instantes.',
};

export class IppClient {
  private requestId = 1;
  private readonly url: URL;
  private readonly timeoutMs: number;

  constructor(options: IppClientOptions) {
    this.url = new URL(options.printerUri.replace(/^ipps:/, 'https:').replace(/^ipp:/, 'http:'));
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  get printerUri() {
    return `ipps://${this.url.host}${this.url.pathname}`;
  }

  private send(body: Buffer, timeoutMs = this.timeoutMs): Promise<IppResponse> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: this.url.hostname,
          port: this.url.port || 631,
          path: this.url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/ipp', 'Content-Length': body.length },
          // LAN printer with a self-signed certificate: TLS is required by it, identity can't be verified
          rejectUnauthorized: false,
          timeout: timeoutMs,
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(
                new IppError(
                  `A impressora respondeu HTTP ${res.statusCode}.`,
                  undefined,
                  'protocol',
                ),
              );
              return;
            }
            try {
              resolve(decodeResponse(Buffer.concat(chunks)));
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('timeout', () =>
        req.destroy(new IppError('A impressora não respondeu a tempo.', undefined, 'timeout')),
      );
      req.on('error', (e: NodeJS.ErrnoException) => {
        if (e instanceof IppError) return reject(e);
        const unreachable = [
          'ECONNREFUSED',
          'EHOSTUNREACH',
          'ENETUNREACH',
          'ETIMEDOUT',
          'EHOSTDOWN',
          'ENOTFOUND',
        ].includes(e.code ?? '');
        reject(
          new IppError(
            unreachable
              ? 'Impressora inacessível: confira se está ligada e na rede.'
              : `Falha ao falar com a impressora: ${e.message}`,
            undefined,
            unreachable ? 'unreachable' : 'protocol',
          ),
        );
      });
      req.end(body);
    });
  }

  private async call(
    operationId: number,
    operationAttrs: Record<string, IppOutValue | IppOutValue[]>,
    jobAttrs?: Record<string, IppOutValue | IppOutValue[]>,
    document?: Buffer,
    timeoutMs?: number,
  ): Promise<IppResponse> {
    const head = encodeRequest(
      operationId,
      this.requestId++,
      { 'printer-uri': { tag: 'uri', value: this.printerUri }, ...operationAttrs },
      jobAttrs,
    );
    const res = await this.send(document ? Buffer.concat([head, document]) : head, timeoutMs);
    if (res.statusCode >= 0x0400) {
      const detail = res.operation['status-message']?.[0];
      throw new IppError(
        STATUS_MESSAGES[res.statusCode] ??
          `A impressora recusou o pedido (código 0x${res.statusCode.toString(16)}${detail ? `: ${detail}` : ''}).`,
        res.statusCode,
        'rejected',
      );
    }
    return res;
  }

  getPrinterAttributes(requested: string[]) {
    return this.call(OPERATION.getPrinterAttributes, {
      'requested-attributes': requested.map(value => ({ tag: 'keyword' as const, value })),
    });
  }

  validateJob(
    operationAttrs: Record<string, IppOutValue | IppOutValue[]>,
    jobAttrs: Record<string, IppOutValue | IppOutValue[]>,
  ) {
    return this.call(OPERATION.validateJob, operationAttrs, jobAttrs);
  }

  printJob(
    document: Buffer,
    operationAttrs: Record<string, IppOutValue | IppOutValue[]>,
    jobAttrs: Record<string, IppOutValue | IppOutValue[]>,
  ) {
    // a full A4 raster takes a while to stream to the printer
    return this.call(
      OPERATION.printJob,
      operationAttrs,
      jobAttrs,
      document,
      Math.max(this.timeoutMs, 120_000),
    );
  }

  getJobAttributes(jobId: number) {
    return this.call(OPERATION.getJobAttributes, {
      'job-id': { tag: 'integer', value: jobId },
      'requested-attributes': [
        'job-state',
        'job-state-reasons',
        'job-state-message',
        'job-impressions-completed',
      ].map(value => ({ tag: 'keyword' as const, value })),
    });
  }

  cancelJob(jobId: number) {
    return this.call(OPERATION.cancelJob, { 'job-id': { tag: 'integer', value: jobId } });
  }
}
