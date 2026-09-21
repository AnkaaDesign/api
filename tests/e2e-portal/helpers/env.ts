/**
 * AMBIENTE DA BATERIA DO PORTAL DO RESPONSÁVEL.
 *
 * Diferença deliberada para `tests/e2e-ui/helpers/env.ts`: aquela bateria roda
 * contra um CLONE descartável (`ankaa_qa_e2e`), porque ela CRIA e APAGA acervo
 * à vontade. Esta roda contra o banco que a pilha de desenvolvimento já serve —
 * é o único lugar onde existem os 118 orçamentos que a Furgões Ibiporã PAGA e
 * os 7 de que ela é DONA, e é exatamente esse contraste que o escopo do portal
 * existe para resolver. Um clone vazio provaria o caminho e não provaria a
 * regra.
 *
 * ⚠️ Por isso mesmo: esta bateria NUNCA apaga acervo. Ela cria o seu e deixa.
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const RAIZ = path.join(__dirname, '..', '..', '..');

function urlDoEnv(): string {
  if (process.env.PORTAL_DATABASE_URL) return process.env.PORTAL_DATABASE_URL;
  const linha = fs
    .readFileSync(path.join(RAIZ, '.env'), 'utf8')
    .split('\n')
    .find(l => l.startsWith('DATABASE_URL='));
  if (!linha) throw new Error('DATABASE_URL não encontrada no .env');
  return linha.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}

export const prisma = new PrismaClient({ datasources: { db: { url: urlDoEnv() } } });

export const WEB = process.env.PORTAL_WEB ?? 'http://localhost:5174';
export const API = process.env.PORTAL_API ?? 'http://localhost:3031';

/**
 * ONDE O CÓDIGO DE ACESSO APARECE — e por que só aí.
 *
 * O OTP do responsável é guardado como HMAC: é irrecuperável do banco, por
 * desenho. Ele também não volta na resposta HTTP, por desenho. Com
 * `RESPONSIBLE_DEV_ECHO_OTP=true` ele é ESCRITO NO LOG DA API, e o log é a
 * única superfície de onde um teste consegue lê-lo sem enfraquecer o produto.
 */
export const API_LOG =
  process.env.PORTAL_API_LOG ?? path.join(__dirname, '..', 'artifacts', 'api.log');

/** Senha dos usuários QA do acervo local. */
export const SENHA_INTERNA = process.env.QA_PASS ?? 'Teste@2026';

/** Os cinco contatos que `pnpm demo:portal` semeia, um por perfil de papel. */
export const CONTATOS = {
  vendedor: { fone: '43999000001', email: 'vendedor@portal.teste', nome: 'Vendedor Demo (Furgões)' },
  compras: { fone: '43999000002', email: 'compras@portal.teste', nome: 'Compras Demo (Furgões)' },
  comercialCompras: {
    fone: '43999000003',
    email: 'comercial-compras@portal.teste',
    nome: 'Comercial e Compras Demo (Furgões)',
  },
  frota: { fone: '43999000004', email: 'frota@portal.teste', nome: 'Gestor de Frota Demo (Marquespan)' },
  marketing: { fone: '43999000005', email: 'marketing@portal.teste', nome: 'Marketing Demo (Marquespan)' },
} as const;

export const FUNCIONARIOS = {
  comercial: 'qa.comercial@ankaa.test',
  admin: 'qa.admin@ankaa.test',
  financeiro: 'qa.financeiro@ankaa.test',
} as const;

/**
 * O código de acesso MAIS RECENTE do log, opcionalmente filtrado por nome.
 *
 * Lê o arquivo inteiro a cada chamada de propósito: o log cresce durante a
 * corrida e guardar um offset faria o teste ler o código da tentativa
 * ANTERIOR — que é válido, expira em 10 minutos, e produz um "código inválido"
 * impossível de diagnosticar.
 */
export function ultimoCodigo(nome?: string): string {
  const log = fs.readFileSync(API_LOG, 'utf8');
  const re = nome
    ? new RegExp(`Código de acesso de ${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^:]*: (\\d{6})`, 'g')
    : /Código de acesso de [^:]*: (\d{6})/g;
  const achados = [...log.matchAll(re)];
  if (!achados.length) throw new Error(`nenhum código no log${nome ? ` para ${nome}` : ''} (${API_LOG})`);
  return achados[achados.length - 1][1];
}

/** Uma faixa de séries só desta bateria (banda 42), pelo mesmo motivo da e2e-ui. */
export function serie(offset = 0): string {
  const fixo = process.env.PORTAL_SERIAL_BASE;
  const base = fixo ? Number(fixo) : 42_000_000 + (Math.floor(Date.now() / 1000) % 900_000);
  return String(base + offset);
}
