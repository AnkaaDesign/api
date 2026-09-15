/**
 * SUBMETE um template da cerimônia à Meta, para revisão.
 *
 * Usage:
 *   npm run whatsapp:submit-template -- orcamento_recusado
 *   npm run whatsapp:submit-template -- orcamento_recusado --dry-run
 *
 * POR QUE UM SCRIPT, E NÃO O PAINEL
 *   O corpo aprovado e o catálogo do código são um contrato (ver
 *   `verify-signature-whatsapp-templates.ts`). Cadastrar à mão é como as duas
 *   pontas divergem: alguém "melhora" o texto no painel, ganha ou perde uma
 *   variável, e o envio passa a falhar com 132000 para todo mundo. Submetendo
 *   daqui, o texto que vai para revisão é o que está versionado neste arquivo, e
 *   a contagem de variáveis nasce conferida contra o construtor que a cerimônia
 *   usa de verdade.
 *
 * O QUE ESTE SCRIPT NÃO FAZ
 *   Aprovar. A Meta revisa, e leva de minutos a dias. `npm run
 *   test:whatsapp-templates` é quem diz quando ficou `APPROVED`.
 */
import { config } from 'dotenv';
import {
  refusedTemplate,
  SIGNATURE_WHATSAPP_TEMPLATE_NAMES,
} from '../src/modules/common/signature/signature-whatsapp-templates';

config();

const WABA = process.env.WHATSAPP_CLOUD_WABA_ID;
const TOKEN = process.env.WHATSAPP_CLOUD_TOKEN;
const VERSION = process.env.WHATSAPP_CLOUD_API_VERSION || 'v25.0';

/**
 * Os corpos submetidos, versionados.
 *
 * ⚠️ REGRAS DA META que o texto precisa respeitar, e que só falham na revisão:
 *   · variável não pode abrir nem fechar o corpo;
 *   · duas variáveis não podem ser adjacentes;
 *   · a numeração tem de ser contígua a partir de {{1}}.
 * `checkBody` abaixo confere as três antes de gastar uma submissão.
 */
const CATALOGO: Record<
  string,
  { category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'; language: string; body: string; example: string[] }
> = {
  [SIGNATURE_WHATSAPP_TEMPLATE_NAMES.REFUSED]: {
    // ⚠️ O CORPO MUDOU DEPOIS DA PRIMEIRA SUBMISSÃO (id 1812362519805697).
    //
    // A versão submetida dizia "A coleta foi encerrada. Ajuste o orçamento e
    // emita uma nova para seguir." — a semântica ANTERIOR à mudança que tornou a
    // recusa um ato do SIGNATÁRIO e não do envelope. Hoje a coleta continua
    // viva, e mandar o comercial emitir uma nova é mandá-lo destruir as
    // assinaturas que sobreviveram à recusa.
    //
    // Enquanto o template estiver PENDING na Meta, dá para corrigir submetendo
    // de novo. Depois de APROVADO o corpo congela: aí é criar um nome novo
    // (`orcamento_recusado_v2`) e trocar a constante, porque template aprovado
    // não se edita.
    // UTILITY: é atualização de uma transação em curso, não peça de venda.
    category: 'UTILITY',
    language: 'pt_BR',
    body:
      'Olá. {{1}} recusou a assinatura do orçamento nº {{2}}.\n\n' +
      'Motivo informado: {{3}}\n\n' +
      'As assinaturas já colhidas continuam valendo. Peça novamente a assinatura dele no sistema, ou ajuste o orçamento.',
    // O exemplo é OBRIGATÓRIO e é o que o revisor lê. Um exemplo genérico
    // ("texto") é motivo comum de rejeição — este mostra o uso real.
    example: [
      'Kennedy de Campos Teixeira',
      '594',
      'O preço ficou acima do que aprovamos internamente para esta frota.',
    ],
  },
};

function checkBody(body: string, esperadas: number): string[] {
  const erros: string[] = [];
  const indices = [...body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
  const maior = indices.length ? Math.max(...indices) : 0;
  if (maior !== esperadas) {
    erros.push(`o corpo usa ${maior} variáveis e o construtor manda ${esperadas}`);
  }
  for (let i = 1; i <= maior; i++) {
    if (!indices.includes(i)) erros.push(`falta {{${i}}} — a numeração tem de ser contígua`);
  }
  const semEspaco = body.trim();
  if (/^\{\{\d+\}\}/.test(semEspaco)) erros.push('o corpo não pode COMEÇAR com variável');
  if (/\{\{\d+\}\}$/.test(semEspaco)) erros.push('o corpo não pode TERMINAR com variável');
  if (/\}\}\s*\{\{/.test(body)) erros.push('duas variáveis adjacentes');
  return erros;
}

async function main(): Promise<void> {
  const nome = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');

  if (!nome || !CATALOGO[nome]) {
    console.error(`Informe um template. Disponíveis: ${Object.keys(CATALOGO).join(', ')}`);
    process.exit(1);
  }
  const alvo = CATALOGO[nome];

  // As variáveis que o CONSTRUTOR manda — não um número digitado aqui.
  const descritor = refusedTemplate({
    refusedByName: alvo.example[0],
    budgetNumber: alvo.example[1],
    reason: alvo.example[2],
  });
  const erros = checkBody(alvo.body, descritor.bodyParams.length);
  if (erros.length) {
    console.error(`Corpo inválido para "${nome}":`);
    for (const e of erros) console.error(`  · ${e}`);
    process.exit(1);
  }

  const payload = {
    name: nome,
    language: alvo.language,
    category: alvo.category,
    components: [{ type: 'BODY', text: alvo.body, example: { body_text: [alvo.example] } }],
  };

  console.log(`Template : ${nome} (${alvo.category}, ${alvo.language})`);
  console.log(`Variáveis: ${descritor.bodyParams.length} — conferidas contra o construtor`);
  console.log('Corpo:\n');
  console.log(alvo.body.split('\n').map(l => `  ${l}`).join('\n'));
  console.log();

  if (dryRun) {
    console.log('--dry-run: nada foi enviado.');
    return;
  }
  if (!WABA || !TOKEN) {
    console.error(
      'Cloud API não configurada. Preencha WHATSAPP_CLOUD_WABA_ID e WHATSAPP_CLOUD_TOKEN no .env\n' +
        '(token de USUÁRIO DE SISTEMA, permanente, com whatsapp_business_management).',
    );
    process.exit(1);
  }

  const res = await fetch(`https://graph.facebook.com/${VERSION}/${WABA}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as { id?: string; status?: string; error?: { message: string } };

  if (!res.ok) {
    console.error(`Submissão recusada: ${body.error?.message ?? res.status}`);
    process.exit(1);
  }
  console.log(`Submetido. id=${body.id} status=${body.status ?? 'PENDING'}`);
  console.log('A revisão da Meta leva de minutos a dias. Acompanhe com:');
  console.log('  npm run test:whatsapp-templates');
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
