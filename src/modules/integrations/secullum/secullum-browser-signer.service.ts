import { Injectable, Logger } from '@nestjs/common';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * Drives Secullum's signature generation through a REAL Chrome (Chrome's "new
 * headless" mode), because Secullum's report service rejects the write from a
 * server-side WebSocket client / legacy headless browser with a generic
 * "An error occurred while updating the entries" DbUpdateException.
 *
 * Proven empirically (see scripts/secullum/playwright-poc.ts): a byte-identical
 * RelatorioCartaoPonto.Gerar succeeds from a real headed/new-headless Chrome but
 * fails from Node `ws`, plain headless, headless+stealth, or headless+clean-UA.
 * `--headless=new` uses Chrome's full render pipeline (no display / xvfb needed)
 * and passes Secullum's detection.
 *
 * Flow per call: launch Chrome → log in via the OAuth UI → prime /Calculos in the
 * page session → open the report WS from the page context → send Gerar → resolve
 * on Sucesso (forwarding Progresso events), reject on Erro.
 *
 * Requires the Chromium binary on the host: `npx playwright install chromium`.
 */
@Injectable()
export class SecullumBrowserSignerService {
  private readonly logger = new Logger(SecullumBrowserSignerService.name);

  private readonly authBase = (
    process.env.SECULLUM_AUTH_URL || 'https://autenticador.secullum.com.br/Token'
  ).replace(/\/Token$/i, '');
  private readonly base = process.env.SECULLUM_BASE_URL || 'https://pontoweb.secullum.com.br';
  private readonly wsUrl =
    process.env.SECULLUM_REPORT_WS_URL || 'wss://pontowebrelatorios.secullum.com.br/';
  private readonly webClient =
    process.env.SECULLUM_WEB_CLIENT_ID || process.env.SECULLUM_CLIENT_ID || '3001';
  private readonly email = process.env.SECULLUM_EMAIL || '';
  private readonly password = process.env.SECULLUM_PASSWORD || '';
  private readonly databaseId =
    process.env.SECULLUM_DATABASE_ID || '4c8681f2e79a4b7ab58cc94503106736';
  private readonly ua =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

  /**
   * Generates one signature apuração. `gerarArgs` is the full Secullum
   * `RelatorioCartaoPonto.Gerar` payload (built by SecullumService.buildGerarArgs).
   * `primeFuncIds` are the funcionário ids to GET /Calculos for (in-session warm-up)
   * before generating. `onProgress(atual, total)` forwards Secullum's Progresso.
   * Resolves on Sucesso; throws with Secullum's message on Erro.
   *
   * Resilience: new-headless Chrome can die mid-flow on a server (a renderer or
   * browser crash surfaces as "Target page, context or browser has been closed"),
   * and the report WebSocket can drop or stall before authenticating. Both are
   * transient, so we relaunch a clean browser and retry — but ONLY while the Gerar
   * write hasn't left the socket yet. Once Gerar is dispatched, Secullum may have
   * already created the apuração, so a retry could duplicate it; past that point we
   * surface the error instead (the caller's description-suffix retry handles a real
   * duplicate). Deterministic Secullum outcomes (Erro/Falha) never retry here.
   */
  async generate(params: {
    gerarArgs: Record<string, unknown>;
    primeFuncIds: number[];
    dataInicial: string;
    dataFinal: string;
    onProgress?: (atual: number, total: number) => void;
  }): Promise<void> {
    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Reset per attempt: a relaunch only happens when Gerar was NOT dispatched.
      let gerarDispatched = false;
      try {
        await this.generateOnce({
          ...params,
          onGerarDispatched: () => {
            gerarDispatched = true;
          },
        });
        return;
      } catch (err) {
        lastErr = err;
        const retryable =
          !gerarDispatched &&
          (this.isTransientBrowserCrash(err) || this.isRetryableConnection(err));
        if (!retryable || attempt === maxAttempts) throw err;
        this.logger.warn(
          `Browser signer attempt ${attempt}/${maxAttempts} failed before dispatch (${(err as Error)?.message}); relaunching Chrome and retrying.`,
        );
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    throw lastErr;
  }

  // Transient infrastructure crashes (Chrome/renderer death, browser disconnect,
  // navigation timeout / net error during login) — safe to retry by relaunching.
  private isTransientBrowserCrash(err: unknown): boolean {
    const m = ((err as Error)?.message || '').toLowerCase();
    return (
      m.includes('target page, context or browser has been closed') ||
      m.includes('target closed') ||
      m.includes('browser has been closed') ||
      m.includes('browser has disconnected') ||
      m.includes('page crashed') ||
      m.includes('net::err') ||
      (m.includes('timeout') && m.includes('exceeded'))
    );
  }

  // Transient report-WebSocket failures that happen BEFORE Gerar is sent (connect
  // dropped, auth rejected/stalled). A fresh browser gets a fresh token + socket,
  // so retrying is safe here — the caller gates these on !gerarDispatched.
  private isRetryableConnection(err: unknown): boolean {
    const m = ((err as Error)?.message || '').toLowerCase();
    return (
      m.includes('ws_error') ||
      m.includes('ws_closed') ||
      m.includes('autenticação do websocket') ||
      m.includes('tempo esgotado aguardando')
    );
  }

  // Pulls a JWT out of the page's web storage (the OAuth flow stashes the access
  // token there). Returns '' when no token-like value is present yet.
  private async readTokenFromStorage(page: Page): Promise<string> {
    return page.evaluate(() => {
      for (const store of [localStorage, sessionStorage]) {
        for (const k of Object.keys(store)) {
          const v = store.getItem(k) || '';
          const jwt = v.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
          if (k.toLowerCase().includes('token') && jwt) return jwt[0];
        }
      }
      return '';
    });
  }

  private async generateOnce(params: {
    gerarArgs: Record<string, unknown>;
    primeFuncIds: number[];
    dataInicial: string;
    dataFinal: string;
    onProgress?: (atual: number, total: number) => void;
    onGerarDispatched?: () => void;
  }): Promise<void> {
    if (!this.email || !this.password) {
      throw new Error('Credenciais do Secullum ausentes (SECULLUM_EMAIL/SECULLUM_PASSWORD).');
    }

    let browser: Browser | null = null;
    try {
      // headless:false + --headless=new ⇒ Chrome's new headless (full render
      // pipeline, no display needed). The extra flags keep new-headless stable on
      // Linux servers (no /dev/shm starvation, no renderer backgrounding/throttling
      // that can kill the tab mid-flow, no back/forward cache serving a stale page).
      browser = await chromium.launch({
        headless: false,
        timeout: 60000,
        args: [
          '--headless=new',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI,BackForwardCache',
          '--mute-audio',
        ],
      });
      const ctx = await browser.newContext({ userAgent: this.ua });
      const page = await ctx.newPage();
      // Cap every page-level action (goto/fill/click/waitFor) so a hung step fails
      // fast and is retried, instead of stalling the whole job.
      page.setDefaultTimeout(30000);

      // Capture the access token from the OAuth /Token response.
      let token = '';
      page.on('response', (r) => {
        if (/\/Token$/i.test(r.url())) {
          r.json()
            .then((j) => {
              if (j?.access_token) token = j.access_token;
            })
            .catch(() => undefined /* not the JSON token response */);
        }
      });

      // 1) Log in through the real OAuth UI.
      const authorizeUrl = `${this.authBase}/Authorization?response_type=code&client_id=${this.webClient}&redirect_uri=${encodeURIComponent(`${this.base}/Auth`)}`;
      await page.goto(authorizeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const baseHost = new URL(this.base).host;

      // The OAuth form can take a moment to render — wait for it explicitly rather
      // than filling blind (a blind fill throws the instant the input is absent).
      // If we already landed on the app (a live session), there's no form to fill.
      const hasLoginForm = await page
        .waitForSelector('input[name="Email"]', { state: 'visible', timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      if (hasLoginForm) {
        await page.fill('input[name="Email"]', this.email);
        await page.fill('input[name="Senha"]', this.password);
        await Promise.all([
          page
            .waitForURL((u) => u.host.includes(baseHost), { timeout: 30000 })
            .catch(() => undefined),
          page.click('button[name="action:Login"]'),
        ]);
      }

      // Wait for the access token to arrive — from the /Token response hook or web
      // storage — polling up to ~20s instead of a fixed sleep, so we neither race a
      // slow login nor over-wait a fast one. A closed page here is a transient
      // crash; surface it so the outer loop relaunches and retries.
      const tokenDeadline = Date.now() + 20000;
      while (!token && Date.now() < tokenDeadline) {
        if (page.isClosed()) {
          throw new Error('Target page, context or browser has been closed durante o login.');
        }
        const fromStorage = await this.readTokenFromStorage(page).catch(() => '');
        if (fromStorage) {
          token = fromStorage;
          break;
        }
        await page.waitForTimeout(500);
      }
      if (!token) {
        throw new Error('Falha no login do Secullum (token de sessão não obtido).');
      }

      // 2) Prime /Calculos for each target employee, in the page session.
      for (const fid of params.primeFuncIds) {
        await page
          .evaluate(
            async ({ base, db, token, fid, ini, fim }) => {
              await fetch(`${base}/Calculos/${fid}/${ini}/${fim}`, {
                headers: { Authorization: `Bearer ${token}`, secullumbancoselecionado: db },
              }).catch(() => undefined);
            },
            {
              base: this.base,
              db: this.databaseId,
              token,
              fid,
              ini: params.dataInicial,
              fim: params.dataFinal,
            },
          )
          .catch(() => undefined);
      }

      // 3) Run Gerar over the report WS from the page context, forwarding progress.
      await page.exposeFunction('__secullumProgress', (atual: number, total: number) => {
        try {
          params.onProgress?.(atual, total);
        } catch {
          /* ignore progress sink errors */
        }
      });
      // Signalled (and awaited in-page) the instant before the Gerar write leaves
      // the socket, so the outer retry loop knows never to relaunch past this point
      // — a relaunch after dispatch could duplicate the apuração.
      await page.exposeFunction('__secullumGerarDispatched', () => {
        try {
          params.onGerarDispatched?.();
        } catch {
          /* ignore */
        }
      });
      // esbuild/tsx injects a __name helper into transpiled fns; shim it in-page so
      // the serialized evaluate body doesn't ReferenceError.
      await page.evaluate(() => {
        (globalThis as any).__name = (globalThis as any).__name || ((f: any) => f);
      });

      const result = await page.evaluate(
        ({ wsUrl, token, db, gerar }) =>
          new Promise<string>((resolve) => {
            const ws = new WebSocket(wsUrl);
            let settled = false;
            let dispatched = false;
            // Overall cap (covers the slow server-side generation after dispatch).
            let timer: ReturnType<typeof setTimeout>;
            // Pre-auth watchdog: if the socket connects but never authenticates and
            // we never dispatch Gerar, bail early so the caller can relaunch fast.
            let connectTimer: ReturnType<typeof setTimeout>;
            const done = (s: string) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              clearTimeout(connectTimer);
              try {
                ws.close();
              } catch {
                /* noop */
              }
              resolve(s);
            };
            timer = setTimeout(() => done('TIMEOUT'), 180000);
            connectTimer = setTimeout(() => {
              if (!dispatched) done('WS_CLOSED');
            }, 45000);
            ws.onopen = () =>
              ws.send(
                JSON.stringify({
                  accessToken: token,
                  group: 'browser',
                  protocolVersion: 5,
                  headers: { secullumbancoselecionado: db },
                }),
              );
            ws.onmessage = async (e: MessageEvent) => {
              let m: any;
              try {
                m = JSON.parse(e.data);
              } catch {
                return;
              }
              if (m.responseAuth !== undefined) {
                if (m.responseAuth !== 'ok') return done('AUTH:' + m.responseAuth);
                // Record dispatch in Node BEFORE the write goes out (awaited), so a
                // crash after this is treated as "already sent" and never retried.
                try {
                  await (globalThis as any).__secullumGerarDispatched();
                } catch {
                  /* ignore signalling failures */
                }
                dispatched = true;
                ws.send(
                  JSON.stringify({
                    hubName: 'RelatorioCartaoPonto',
                    methodName: 'Gerar',
                    arguments: [gerar],
                  }),
                );
                return;
              }
              if (m.hubName === '--PING--') {
                ws.send(JSON.stringify({ hubName: '--PONG--', arguments: [] }));
                return;
              }
              if (m.hubName === 'RelatorioCartaoPonto') {
                if (m.eventName === 'Progresso') {
                  const p = m.arguments?.[0];
                  if (p && typeof p.total === 'number') {
                    (globalThis as any).__secullumProgress(
                      Number(p.atual) || 0,
                      Number(p.total) || 0,
                    );
                  }
                  return;
                }
                if (m.eventName === 'Sucesso') return done('OK');
                if (m.eventName === 'Erro' || m.eventName === 'Falha') {
                  return done('ERR:' + JSON.stringify(m.arguments));
                }
              }
            };
            ws.onerror = () => done('WS_ERROR');
            // Socket closed without a terminal event ⇒ resolve instead of hanging
            // until the 180s cap (a no-op if we already settled via done()).
            ws.onclose = () => done('WS_CLOSED');
          }),
        { wsUrl: this.wsUrl, token, db: this.databaseId, gerar: params.gerarArgs },
      );

      if (result === 'OK') return;
      if (result === 'TIMEOUT') {
        throw new Error('Tempo esgotado aguardando a geração da assinatura no Secullum.');
      }
      if (result.startsWith('ERR:')) {
        let msg = result;
        try {
          const arr = JSON.parse(result.slice(4));
          msg = arr?.[0]?.message || result;
        } catch {
          /* keep raw */
        }
        throw new Error(msg);
      }
      if (result.startsWith('AUTH:')) {
        throw new Error(`Falha na autenticação do WebSocket do Secullum (${result}).`);
      }
      if (result === 'WS_ERROR' || result === 'WS_CLOSED') {
        throw new Error(
          `Conexão com o serviço de relatórios do Secullum caiu (${result}).`,
        );
      }
      throw new Error(`Falha na geração da assinatura (${result}).`);
    } finally {
      if (browser) await browser.close().catch(() => undefined);
    }
  }
}
