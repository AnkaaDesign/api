/**
 * SENTINELA QUE GRAVA — substitui TODA integração externa por um servidor local.
 *
 * A blindagem anterior (503 em tudo) tornava o teste seguro e, pelo mesmo gesto,
 * cego: a emissão parava no primeiro passo e nada do que SERIA enviado à
 * prefeitura ou ao banco chegava a existir. Aqui o servidor responde sucesso
 * plausível — a nota é "autorizada", o boleto é "registrado" — e GRAVA o corpo
 * exato de cada chamada. Nada sai da máquina, e mesmo assim dá para afirmar o
 * valor, a discriminação e o vencimento que teriam ido.
 *
 *   ELOTECH_OXY_BASE_URL   → /elotech
 *   SICREDI_API_URL        → /sicredi
 *   NFSE_NACIONAL_BASE_URL → /nfse-nacional
 *   CLICKSIGN_API_URL      → /clicksign
 *   qualquer outro caminho → 599 + gravado como ESCAPE (é um vazamento)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOCK_PORT || 9988);
const LOG = path.join(__dirname, 'artifacts', 'integration-calls.jsonl');
fs.mkdirSync(path.dirname(LOG), { recursive: true });

let seq = 0;
const calls = [];

// PDF mínimo válido — o código baixa e grava o arquivo da nota/boleto.
const TINY_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

function record(integration, req, body, note) {
  const entry = {
    seq: ++seq,
    at: new Date().toISOString(),
    integration,
    method: req.method,
    path: req.url,
    body,
    note,
  };
  calls.push(entry);
  fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
  return entry;
}

function json(res, code, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

/** Cidades que a sentinela conhece — o suficiente para os clientes de teste. */
const CIDADES = [
  { id: 4110003, descricao: 'IBIPORA', descricaoAbreviada: 'IBIPORA', codigoIBGE: 4110003, descricaoUF: 'PR', ativa: 'S' },
  { id: 4113700, descricao: 'LONDRINA', descricaoAbreviada: 'LONDRINA', codigoIBGE: 4113700, descricaoUF: 'PR', ativa: 'S' },
  { id: 4106902, descricao: 'CURITIBA', descricaoAbreviada: 'CURITIBA', codigoIBGE: 4106902, descricaoUF: 'PR', ativa: 'S' },
  { id: 3550308, descricao: 'SAO PAULO', descricaoAbreviada: 'SAO PAULO', codigoIBGE: 3550308, descricaoUF: 'SP', ativa: 'S' },
];

let nfseSeq = 9000;
let boletoSeq = 70000;
const emittedNotes = [];
/** Boletos que já receberam a instrução de baixa — a consulta seguinte confirma. */
const baixados = new Set();

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* mantém cru */ }
    const url = req.url.split('?')[0];

    // ── controle do próprio recorder ──────────────────────────────────────
    if (url === '/__recorder/all') return json(res, 200, calls);
    if (url === '/__recorder/reset') { calls.length = 0; emittedNotes.length = 0; baixados.clear(); try { fs.unlinkSync(LOG); } catch {} return json(res, 200, { ok: true }); }
    if (url === '/__recorder/health') return json(res, 200, { ok: true, calls: calls.length });

    // ── ELOTECH OXY (NFS-e municipal) ─────────────────────────────────────
    if (url.startsWith('/elotech')) {
      const p = url.slice('/elotech'.length);
      record('elotech', req, body);
      if (p === '/authentication/login') return json(res, 200, { id_token: 'mock-elotech-token' });
      if (p === '/acesso-web-empresas/contribuinte-padrao')
        return json(res, 200, {
          id: 1234, cadastro: '000123', cnpjCpf: '12345678000199',
          razaoSocialNome: 'ANKAA (MOCK)', regimeFiscal: 'NORMAL', idCidade: 4110003,
        });
      if (p === '/emissao-nfse/calcular-valores-nota-fiscal') {
        // Devolve o mesmo payload: o serviço só colhe os campos de `formImposto`.
        return json(res, 200, body ?? {});
      }
      if (p === '/emissao-nfse/salvar-nota-fiscal') {
        const id = ++nfseSeq;
        const numero = id;
        const liquido = (body?.formItensNFSe ?? []).reduce((s, i) => s + Number(i.valorLiquido ?? 0), 0);
        emittedNotes.push({ elotechNfseId: id, numeroNfse: numero, valorLiquidoNota: Number(liquido.toFixed(2)), body });
        return json(res, 200, { formDadosNFSe: { id, numeroNfse: numero } });
      }
      if (p.startsWith('/emissao-nfse/nota-fiscal-pdf/')) {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        return res.end(TINY_PDF);
      }
      if (p === '/emissao-nfse/resumo-nota-fiscal')
        return json(res, 200, { content: emittedNotes.map(n => ({
          id: n.elotechNfseId, numeroNfse: n.numeroNfse, valorLiquidoNota: n.valorLiquidoNota,
          valorServico: n.valorLiquidoNota, situacao: 'NORMAL',
        })), totalElements: emittedNotes.length });
      if (p === '/emissao-nfse/iss-retido') return json(res, 200, { issRetido: false });
      // ── CANCELAMENTO ────────────────────────────────────────────────────
      //
      // A REVERSÃO do faturamento não apaga nada sem antes CONFIRMAR, na
      // prefeitura, a situação de cada nota viva. Sem esta rota a sentinela
      // devolvia 599 e a reversão era recusada com "Não foi possível confirmar
      // a NFS-e na Elotech" — um bloqueio correto do sistema que, no teste,
      // impedia de provar o caminho inteiro.
      if (p.startsWith('/solicitacoes-cancelamento/nota-fiscal/')) {
        const id = Number(p.split('/').pop());
        const nota = emittedNotes.find(n => n.elotechNfseId === id);
        return json(res, 200, {
          // `id` e `idCadastroGeralPrestador` são o que o serviço copia para o
          // pedido de cancelamento — devolvê-los em branco faz o POST seguinte
          // sair sem a nota que ele cancela.
          id,
          idCadastroGeralPrestador: 1234,
          situacao: nota?.cancelada ? 'CANCELADA' : 'NORMAL',
          numeroNotaFiscal: nota?.numeroNfse ?? id,
          solicitacaoCancelamento: nota?.cancelada
            ? { id: 1, ultimoStatus: 'AUTORIZADO', motivo: nota.motivoCancelamento ?? null, historicos: [] }
            : null,
        });
      }
      if (p === '/solicitacoes-cancelamento/salvar' && req.method === 'POST') {
        const id = Number(body?.idNotaFiscal ?? 0);
        const nota = emittedNotes.find(n => n.elotechNfseId === id);
        if (nota) { nota.cancelada = true; nota.motivoCancelamento = body?.motivo ?? null; }
        return json(res, 200, { id: 1, ultimoStatus: 'AUTORIZADO', motivo: body?.motivo ?? null });
      }
      if (p === '/emissao-nfse/reenviar-adn') return json(res, 200, {});
      if (p === '/consultar-documentos-fiscais/totais-consulta') {
        // `totalDocumentos` é o campo que o serviço lê para inverter a paginação;
        // devolver só `totalElements` fazia a contagem sair zero e a consulta
        // pedir uma página negativa.
        return json(res, 200, {
          totalDocumentos: emittedNotes.length,
          totalElements: emittedNotes.length,
          valorTotal: 0,
        });
      }
      if (p === '/consultar-documentos-fiscais/consultar') {
        // A CONSULTA DE NOTAS EMITIDAS — é dela que sai o "próximo número de
        // NFS-e" que a prévia do diálogo de aprovação mostra. Sem ela a prévia
        // exibe "‹nº NFS-e›" e o teste não consegue conferir o número que o
        // boleto vai citar em `seuNumero`.
        const first = Number(body?.firstResult ?? 0);
        const max = Number(body?.maxResult ?? 20);
        const page = emittedNotes.slice(first, first + max).map(n => ({
          id: n.elotechNfseId,
          numeroNfse: n.numeroNfse,
          numero: n.numeroNfse,
          valorLiquidoNota: n.valorLiquidoNota,
          valorServico: n.valorLiquidoNota,
          situacao: 'NORMAL',
          dataEmissao: new Date().toISOString().slice(0, 10),
        }));
        return json(res, 200, { data: page, totalDocumentos: emittedNotes.length });
      }
      if (p === '/localidades/cidades-uf') {
        // O serviço resolve a cidade do TOMADOR por esta lista e faz
        // `cities.find(...)`. Devolver `{}` aqui (o antigo catch-all) quebrava a
        // emissão com "cities.find is not a function" — um defeito da sentinela
        // que se disfarçava de defeito do sistema.
        const uf = body?.id?.unidadeFederacao ?? 'PR';
        return json(res, 200, CIDADES.filter(c => c.descricaoUF === uf));
      }
      // Caminho não mapeado da Elotech: RECUSA e grava. Responder 200 com `{}`
      // entrega uma forma errada e o erro aparece longe daqui.
      record('elotech-NAO-MAPEADO', req, body, 'acrescentar à sentinela');
      return json(res, 599, { error: 'rota Elotech não mapeada', path: p });
    }

    // ── SICREDI (boleto) ──────────────────────────────────────────────────
    if (url.startsWith('/sicredi')) {
      const p = url.slice('/sicredi'.length);
      record('sicredi', req, body);
      if (p === '/auth/openapi/token')
        return json(res, 200, { access_token: 'mock-sicredi-token', token_type: 'Bearer', expires_in: 3600 });
      if (p === '/cobranca/boleto/v1/boletos' && req.method === 'POST') {
        const nn = String(++boletoSeq).padStart(9, '0');
        return json(res, 201, {
          nossoNumero: nn,
          codigoBarras: '74893' + nn + '0000000000',
          linhaDigitavel: '74893.00000 00000.000000 00000.000000 0 00000000000000',
          cooperativa: '0101', posto: '01', txid: 'MOCKTX' + nn,
        });
      }
      if (p === '/cobranca/boleto/v1/boletos/pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        return res.end(TINY_PDF);
      }
      if (p === '/cobranca/boleto/v1/boletos/liquidados/dia') return json(res, 200, { items: [] });
      // ── CONSULTA E BAIXA ────────────────────────────────────────────────
      //
      // A reversão do faturamento BAIXA cada boleto e reconsulta até o banco
      // confirmar. O antigo catch-all `{}` deixava `situacao` indefinida, e a
      // guarda — corretamente — recusava a reversão: "O Sicredi não informou a
      // situação do boleto". A sentinela precisa responder como o banco.
      if (p === '/cobranca/boleto/v1/boletos' && req.method === 'GET') {
        const nn = (req.url.split('nossoNumero=')[1] ?? '').split('&')[0];
        return json(res, 200, {
          nossoNumero: nn,
          situacao: baixados.has(nn) ? 'BAIXADO POR SOLICITACAO' : 'EM CARTEIRA',
          valor: 0,
        });
      }
      const baixa = p.match(/^\/cobranca\/boleto\/v1\/boletos\/([^/]+)\/baixa$/);
      if (baixa && req.method === 'PATCH') {
        baixados.add(baixa[1]);
        return json(res, 202, { situacao: 'MOVIMENTO_ENVIADO' });
      }
      return json(res, 200, {});
    }

    // ── demais integrações: aceitas e gravadas, sem efeito ────────────────
    if (url.startsWith('/nfse-nacional') || url.startsWith('/clicksign') || url.startsWith('/tsa') || url.startsWith('/sieg')) {
      record(url.split('/')[1], req, body);
      return json(res, 200, {});
    }

    // ── qualquer outra coisa é VAZAMENTO ──────────────────────────────────
    record('ESCAPE', req, body, 'caminho não mapeado — investigar');
    return json(res, 599, { error: 'rota não mapeada na sentinela', path: url });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[sentinela] gravando em ${LOG} — http://127.0.0.1:${PORT}`);
});
