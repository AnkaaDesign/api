import { Injectable, Logger } from '@nestjs/common';
import { chromium, type Browser } from 'playwright';

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
   */
  async generate(params: {
    gerarArgs: Record<string, unknown>;
    primeFuncIds: number[];
    dataInicial: string;
    dataFinal: string;
    onProgress?: (atual: number, total: number) => void;
  }): Promise<void> {
    if (!this.email || !this.password) {
      throw new Error('Credenciais do Secullum ausentes (SECULLUM_EMAIL/SECULLUM_PASSWORD).');
    }

    let browser: Browser | null = null;
    try {
      // headless:false + --headless=new ⇒ Chrome's new headless (full render
      // pipeline, no display needed). The flags keep it stable on Linux servers.
      browser = await chromium.launch({
        headless: false,
        args: [
          '--headless=new',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      const ctx = await browser.newContext({ userAgent: this.ua });
      const page = await ctx.newPage();

      // Capture the access token from the OAuth /Token response.
      let token = '';
      page.on('response', async (r) => {
        if (/\/Token$/i.test(r.url())) {
          try {
            const j = await r.json();
            if (j?.access_token) token = j.access_token;
          } catch {
            /* not the JSON token response */
          }
        }
      });

      // 1) Log in through the real OAuth UI.
      const authorizeUrl = `${this.authBase}/Authorization?response_type=code&client_id=${this.webClient}&redirect_uri=${encodeURIComponent(`${this.base}/Auth`)}`;
      await page.goto(authorizeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.fill('input[name="Email"]', this.email);
      await page.fill('input[name="Senha"]', this.password);
      const baseHost = new URL(this.base).host;
      await Promise.all([
        page.waitForURL((u) => u.host.includes(baseHost), { timeout: 30000 }).catch(() => {}),
        page.click('button[name="action:Login"]'),
      ]);
      await page.waitForTimeout(3000);

      if (!token) {
        // Fallback: pull a JWT out of web storage.
        token = await page.evaluate(() => {
          for (const store of [localStorage, sessionStorage]) {
            for (const k of Object.keys(store)) {
              const v = store.getItem(k) || '';
              const m = v.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
              if (k.toLowerCase().includes('token') && m) return m[0];
            }
          }
          return '';
        });
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
      // esbuild/tsx injects a __name helper into transpiled fns; shim it in-page so
      // the serialized evaluate body doesn't ReferenceError.
      await page.evaluate(() => {
        (globalThis as any).__name = (globalThis as any).__name || ((f: any) => f);
      });

      const result = await page.evaluate(
        ({ wsUrl, token, db, gerar }) =>
          new Promise<string>((resolve) => {
            const ws = new WebSocket(wsUrl);
            const done = (s: string) => {
              try {
                ws.close();
              } catch {
                /* noop */
              }
              resolve(s);
            };
            const timer = setTimeout(() => done('TIMEOUT'), 180000);
            ws.onopen = () =>
              ws.send(
                JSON.stringify({
                  accessToken: token,
                  group: 'browser',
                  protocolVersion: 5,
                  headers: { secullumbancoselecionado: db },
                }),
              );
            ws.onmessage = (e: MessageEvent) => {
              let m: any;
              try {
                m = JSON.parse(e.data);
              } catch {
                return;
              }
              if (m.responseAuth !== undefined) {
                if (m.responseAuth !== 'ok') {
                  clearTimeout(timer);
                  return done('AUTH:' + m.responseAuth);
                }
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
                if (m.eventName === 'Sucesso') {
                  clearTimeout(timer);
                  return done('OK');
                }
                if (m.eventName === 'Erro' || m.eventName === 'Falha') {
                  clearTimeout(timer);
                  return done('ERR:' + JSON.stringify(m.arguments));
                }
              }
            };
            ws.onerror = () => {
              clearTimeout(timer);
              done('WS_ERROR');
            };
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
      throw new Error(`Falha na geração da assinatura (${result}).`);
    } finally {
      if (browser) await browser.close().catch(() => undefined);
    }
  }
}
