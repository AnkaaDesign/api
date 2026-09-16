import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

/** Nome do banco de teste — clone do acervo local, descartável. */
export const QA_DB_NAME = process.env.QA_DB_NAME ?? 'ankaa_qa_e2e';

/**
 * A URL do banco de teste SAI do `.env` do repositório, trocando só o nome do
 * banco. Nenhuma credencial mora aqui: a bateria é versionada, o `.env` não.
 */
function qaDatabaseUrl(): string {
  if (process.env.QA_DATABASE_URL) return process.env.QA_DATABASE_URL;
  const envFile = path.join(__dirname, '..', '..', '..', '.env');
  const linha = fs
    .readFileSync(envFile, 'utf8')
    .split('\n')
    .find(l => l.startsWith('DATABASE_URL='));
  if (!linha) throw new Error(`DATABASE_URL não encontrada em ${envFile}`);
  const url = linha.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  return url.replace(/\/[^/?]+(\?|$)/, `/${QA_DB_NAME}$1`);
}

export const QA_DB = qaDatabaseUrl();
export const MAILPIT = process.env.QA_MAILPIT ?? 'http://127.0.0.1:8026';
export const SENTINELA = process.env.QA_SENTINELA ?? 'http://127.0.0.1:9988';

export const prisma = new PrismaClient({ datasources: { db: { url: QA_DB } } });

/**
 * A FAIXA DE SÉRIES DE UMA CORRIDA — e por que ela precisou de uma regra.
 *
 * O número de série é ÚNICO no sistema inteiro, e cada fase inventa os seus. A
 * regra antiga era `90000 + (epoch % 9000)`: uma banda de nove mil números que
 * o relógio percorre em DUAS HORAS E MEIA. Duas corridas separadas por 2h30 —
 * ou por um dia, ou por uma semana — caíam exatamente na mesma faixa, e a
 * criação morria com "Número de série já está em uso" no meio de um cenário que
 * não tem nada a ver com séries. O sintoma aparecia como `page.waitForURL:
 * Timeout`, que é a pior forma possível de ler um conflito de dados.
 *
 * Agora cada fase tem a sua BANDA (um milhão de números só dela) e o instante da
 * corrida escolhe a faixa dentro dela, com ciclo de dez dias. `QA_SERIAL_BASE`
 * continua fixando tudo, que é o que permite repetir uma corrida exata.
 */
export function serialBase(banda: number): number {
  const fixo = process.env.QA_SERIAL_BASE;
  if (fixo) return Number(fixo);
  return banda * 1_000_000 + (Math.floor(Date.now() / 1000) % 900_000);
}


// ── Mailpit ────────────────────────────────────────────────────────────────
export interface Mail {
  ID: string;
  From: { Address: string; Name: string };
  To: { Address: string; Name: string }[];
  Subject: string;
  Created: string;
}

export async function mailPurge() {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
}

export async function mailList(): Promise<Mail[]> {
  const r = await fetch(`${MAILPIT}/api/v1/messages?limit=500`);
  const j: any = await r.json();
  return j.messages ?? [];
}

export async function mailBody(id: string): Promise<{ html: string; text: string }> {
  const r = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  const j: any = await r.json();
  return { html: j.HTML ?? '', text: j.Text ?? '' };
}

export async function mailFor(address: string): Promise<Mail[]> {
  const all = await mailList();
  return all.filter(m => (m.To ?? []).some(t => t.Address.toLowerCase() === address.toLowerCase()));
}

/** Espera chegar e-mail para `address` cujo assunto casa, e devolve o corpo. */
export async function waitMail(
  address: string,
  subject: RegExp,
  timeoutMs = 30000,
): Promise<{ mail: Mail; html: string; text: string } | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ms = (await mailFor(address)).filter(m => subject.test(m.Subject));
    if (ms.length) {
      const mail = ms.sort((a, b) => (a.Created < b.Created ? 1 : -1))[0];
      const body = await mailBody(mail.ID);
      return { mail, ...body };
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

// ── Sentinela (gravador das integrações) ──────────────────────────────────
export interface Call {
  seq: number;
  at: string;
  integration: string;
  method: string;
  path: string;
  body: any;
  note?: string;
}

export async function sentinelaReset() {
  await fetch(`${SENTINELA}/__recorder/reset`, { method: 'POST' });
}

export async function sentinelaCalls(integration?: string): Promise<Call[]> {
  const r = await fetch(`${SENTINELA}/__recorder/all`);
  const all: Call[] = (await r.json()) as any;
  return integration ? all.filter(c => c.integration === integration) : all;
}

/** Espera uma chamada que case com o filtro (a emissão é fire-and-forget). */
export async function waitCall(
  pred: (c: Call) => boolean,
  timeoutMs = 45000,
): Promise<Call | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = (await sentinelaCalls()).find(pred);
    if (hit) return hit;
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}
