/**
 * Guarda de saída do WhatsApp — o código de uso único não pode ficar preso.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 *   A guarda existe para não repetir o padrão que fez o número anterior ser
 *   banido: conversa NOVA em rajada. Ela acerta nisso. O que ela errava era o
 *   outro lado — barrar o código de uso único, que não abre conversa nenhuma
 *   porque foi o próprio destinatário quem pediu, segundos antes, com a tela
 *   aberta.
 *
 *   Aconteceu de verdade: um signatário que já havia recebido convite,
 *   lembrete e avisos chegou ao botão "Enviar código" e bateu no teto por
 *   destinatário. A assinatura ficou impossível de concluir até o dia virar, e
 *   a tela ainda mandava "tente novamente em instantes" — contra uma parede
 *   diária.
 *
 *   Os dois lados são verificados aqui: o CRITICAL passa onde o NORMAL para, e
 *   tudo o que de fato protege a conta continua valendo para ele.
 *
 * Rodar: pnpm tsx tests/whatsapp-outbound-guard.test.ts
 */

import { WhatsAppOutboundGuard } from '../src/modules/common/whatsapp/whatsapp-outbound-guard';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Redis de mentira: só o que a guarda usa. */
class FakeCache {
  store = new Map<string, string>();
  async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T) ?? null;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, String(value));
  }
  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }
  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
  async incr(key: string): Promise<number> {
    const next = parseInt(this.store.get(key) ?? '0', 10) + 1;
    this.store.set(key, String(next));
    return next;
  }
  async expire(): Promise<boolean> {
    return true;
  }
  async getObject<T>(key: string): Promise<T | null> {
    const raw = this.store.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  async setObject(key: string, value: unknown): Promise<void> {
    this.store.set(key, JSON.stringify(value));
  }
}

function newGuard() {
  const cache = new FakeCache();
  return { cache, guard: new WhatsAppOutboundGuard(cache as never) };
}

/** Enche o contador do dia daquele número com `n` envios já aceitos. */
async function fill(guard: WhatsAppOutboundGuard, phone: string, n: number) {
  for (let i = 0; i < n; i++) {
    await guard.recordSent(phone, `mensagem ${i}`, false);
  }
}

const PHONE = '5543999990000';

// `tsx` compila para CJS, onde não há await de topo — daí o `main()`.
async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  console.log('\nO teto por destinatário e o código de uso único');
  {
    const { guard } = newGuard();
    const { caps } = await guard.usage();

    check(
      'o CRITICAL tem folga maior que o comum',
      caps.perRecipientPerDayCritical > caps.perRecipientPerDay,
      `${caps.perRecipientPerDayCritical} vs ${caps.perRecipientPerDay}`,
    );

    await fill(guard, PHONE, caps.perRecipientPerDay);

    const normal = await guard.evaluate({
      phone: PHONE,
      message: 'lembrete do orçamento',
      priority: 'NORMAL',
    });
    check('no teto, a mensagem comum para', !normal.allowed, normal.code);
    check('e o motivo é o teto por destinatário', normal.code === 'RECIPIENT_DAILY_CAP');

    // O BUG: era aqui que a cerimônia morria.
    const critical = await guard.evaluate({
      phone: PHONE,
      message: 'seu código é 123456',
      priority: 'CRITICAL',
    });
    check('mas o código de uso único passa', critical.allowed, critical.reason);
    check('e nunca conta como primeiro contato', critical.cold === false);
  }

  // ---------------------------------------------------------------------------
  console.log('\nA folga do CRITICAL é folga, não isenção');
  {
    const { guard } = newGuard();
    const { caps } = await guard.usage();
    await fill(guard, PHONE, caps.perRecipientPerDayCritical);

    const verdict = await guard.evaluate({
      phone: PHONE,
      message: 'seu código é 654321',
      priority: 'CRITICAL',
    });
    check('no teto dele, o CRITICAL também para', !verdict.allowed, verdict.code);
    check('com o mesmo código de motivo', verdict.code === 'RECIPIENT_DAILY_CAP');
  }

  // ---------------------------------------------------------------------------
  console.log('\nO que protege a conta continua valendo para o CRITICAL');
  {
    // Disjuntor ALL: sequência de recusas é sinal de conta ou sessão com
    // problema, e aí insistir com qualquer coisa é o que agrava.
    const { guard } = newGuard();
    for (let i = 0; i < 3; i++) await guard.noteRejection('500');

    const verdict = await guard.evaluate({
      phone: PHONE,
      message: 'seu código é 111111',
      priority: 'CRITICAL',
    });
    check('o disjuntor geral segura o CRITICAL', !verdict.allowed, verdict.code);
    check('e diz que é o disjuntor', verdict.code === 'BREAKER_ALL');
  }
  {
    // Corpo idêntico: dois OTPs iguais seriam o mesmo código duas vezes, então
    // repetição ali é repetição de verdade.
    const { guard } = newGuard();
    const body = 'seu código é 222222';
    await guard.recordSent(PHONE, body, false);

    const verdict = await guard.evaluate({ phone: PHONE, message: body, priority: 'CRITICAL' });
    check('corpo repetido ainda é recusado', !verdict.allowed, verdict.code);
    check('e diz que é duplicata', verdict.code === 'DUPLICATE_BODY');
  }
  {
    // O 463 trava PRIMEIRO CONTATO. O código de uso único não é primeiro
    // contato, e derrubá-lo junto prenderia o cliente no meio da cerimônia.
    const { guard } = newGuard();
    await guard.noteRejection('463');

    const cold = await guard.evaluate({
      phone: '5543911112222',
      message: 'convite de assinatura',
      priority: 'NORMAL',
    });
    check('o 463 barra o primeiro contato', !cold.allowed, cold.code);
    check('pelo disjuntor de frio', cold.code === 'BREAKER_COLD');

    const critical = await guard.evaluate({
      phone: '5543911112222',
      message: 'seu código é 333333',
      priority: 'CRITICAL',
    });
    check('e não barra o código de uso único', critical.allowed, critical.reason);
  }
}

awaitMain();

function awaitMain(): void {
  main().then(
    () => {
      console.log(
        failures === 0 ? '\n✅ Todas as verificações passaram.\n' : `\n❌ ${failures} verificação(ões) falharam.\n`,
      );
      process.exit(failures === 0 ? 0 : 1);
    },
    error => {
      console.error(error);
      process.exit(1);
    },
  );
}
