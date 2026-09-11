/**
 * Confere o CATÁLOGO do código contra os templates aprovados na Meta.
 *
 * Usage: npm run test:whatsapp-templates
 * Sai 0 se tudo confere, 1 na primeira divergência. Sem configuração da Cloud
 * API, sai 0 avisando que não havia o que conferir.
 *
 * POR QUE ISTO EXISTE
 *   O template é um contrato com um sistema de FORA, e o `tsc` não enxerga nada
 *   dele. Três divergências silenciosas, todas já vistas em produção alheia:
 *
 *     1. O template é editado no painel (alguém "melhora" o texto) e ganha ou
 *        perde uma variável. O envio passa a falhar com 132000 para TODO cliente,
 *        e o primeiro a notar é quem não recebeu o orçamento.
 *     2. A Meta PAUSA o template por qualidade baixa. Ele continua existindo,
 *        continua aparecendo no painel, e simplesmente para de entregar.
 *     3. O botão de URL guarda o prefixo do link. Se o domínio mudar no código e
 *        não no template — ou o contrário —, o convite chega bonito e leva o
 *        cliente para uma página que não existe.
 *
 *   Nenhuma dessas quebra o build, e as três só aparecem na conversa do cliente.
 */
import { config } from 'dotenv';
import {
  invitationTemplate,
  otpTemplate,
  voidedTemplate,
  type SignatureWhatsAppTemplate,
} from '../src/modules/common/signature/signature-whatsapp-templates';

config();

const WABA = process.env.WHATSAPP_CLOUD_WABA_ID;
const TOKEN = process.env.WHATSAPP_CLOUD_TOKEN;
const VERSION = process.env.WHATSAPP_CLOUD_API_VERSION || 'v25.0';
const WEB_BASE = process.env.SIGNATURE_WEB_URL || process.env.WEB_APP_URL || '';

/** O prefixo que o botão do convite TEM de carregar — ver `signingUrl`. */
const SIGNING_URL_PREFIX = `${WEB_BASE.replace(/\/$/, '')}/cliente/assinar/`;

interface MetaTemplate {
  name: string;
  status: string;
  language: string;
  components?: Array<{
    type: string;
    text?: string;
    buttons?: Array<{ type: string; url?: string }>;
  }>;
}

const failures: string[] = [];

function check(label: string, ok: boolean, detail: string): void {
  console.log(`[${ok ? '  ok  ' : ' FALHA'}] ${label} — ${detail}`);
  if (!ok) failures.push(label);
}

/** Maior `{{n}}` do corpo aprovado: quantas variáveis a Meta espera receber. */
function bodyVariableCount(template: MetaTemplate): number {
  const body = template.components?.find(c => c.type === 'BODY')?.text ?? '';
  const indexes = [...body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
  return indexes.length ? Math.max(...indexes) : 0;
}

async function main(): Promise<void> {
  if (!WABA || !TOKEN) {
    console.log('Cloud API não configurada (WHATSAPP_CLOUD_WABA_ID/TOKEN) — nada a conferir.');
    process.exit(0);
  }

  const response = await fetch(
    `https://graph.facebook.com/${VERSION}/${WABA}/message_templates?limit=100&access_token=${TOKEN}`,
  );
  const payload = (await response.json()) as { data?: MetaTemplate[]; error?: { message: string } };
  if (!response.ok || !payload.data) {
    console.error(`Não foi possível ler os templates: ${payload.error?.message ?? response.status}`);
    process.exit(1);
  }

  const approved = new Map(payload.data.map(t => [t.name, t]));

  // Os MESMOS construtores que a cerimônia usa. Conferir contra valores
  // inventados aqui só provaria que este script concorda consigo mesmo.
  const esperados: Array<{ rotulo: string; descritor: SignatureWhatsAppTemplate }> = [
    {
      rotulo: 'convite/reenvio',
      descritor: invitationTemplate({
        signerName: 'Sérgio Rodrigues',
        budgetNumber: 1459,
        deadlineDate: '18/09/2026',
        accessToken: 'token-de-exemplo',
      }),
    },
    { rotulo: 'código de uso único', descritor: otpTemplate({ code: '000000' }) },
    {
      rotulo: 'coleta cancelada',
      descritor: voidedTemplate({ signerName: 'Sérgio Rodrigues', budgetNumber: 1459 }),
    },
  ];

  for (const { rotulo, descritor } of esperados) {
    const meta = approved.get(descritor.name);

    if (!meta) {
      check(`${rotulo}: existe na Meta`, false, `template "${descritor.name}" não encontrado`);
      continue;
    }

    check(
      `${rotulo}: aprovado`,
      meta.status === 'APPROVED',
      `${descritor.name} está ${meta.status}`,
    );
    check(
      `${rotulo}: idioma`,
      meta.language === descritor.language,
      `código envia ${descritor.language}, Meta tem ${meta.language}`,
    );

    const esperadas = bodyVariableCount(meta);
    check(
      `${rotulo}: variáveis do corpo`,
      esperadas === descritor.bodyParams.length,
      `template pede ${esperadas}, código envia ${descritor.bodyParams.length}`,
    );

    const botoes = meta.components?.find(c => c.type === 'BUTTONS')?.buttons ?? [];
    const mandaBotao = Boolean(descritor.urlButtonParam ?? descritor.otpButtonParam);
    check(
      `${rotulo}: botão`,
      mandaBotao === botoes.length > 0,
      mandaBotao ? `código manda parâmetro, template tem ${botoes.length} botão(ões)` : 'sem botão dos dois lados',
    );

    // Só o convite tem link. O prefixo mora no template, e é ele que decide
    // para onde o cliente vai ao tocar no botão.
    const urlDoBotao = botoes.find(b => b.type === 'URL')?.url;
    if (descritor.urlButtonParam && urlDoBotao) {
      check(
        `${rotulo}: destino do botão`,
        urlDoBotao.startsWith(SIGNING_URL_PREFIX),
        `template aponta para ${urlDoBotao}`,
      );
    }
  }

  console.log('');
  if (failures.length) {
    console.error(`${failures.length} divergência(s): ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('Templates da assinatura conferem com o catálogo do código.');
  process.exit(0);
}

main().catch(error => {
  console.error('Falha na verificação:', error);
  process.exit(1);
});
