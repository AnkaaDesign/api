/**
 * Verificação EM EXECUÇÃO de duas garantias operacionais:
 *
 *   1. NENHUMA notificação sai por WhatsApp para colaborador.
 *   2. O convite de assinatura de orçamento SAI por e-mail.
 *
 * POR QUE EM EXECUÇÃO, E NÃO POR LEITURA DE CÓDIGO
 *   A trava do WhatsApp nunca foi observada bloqueando em produção — só foi
 *   provada lendo o fonte. E o caminho de e-mail da assinatura foi exercitado
 *   pela última vez em 03/08. Ler o código prova a intenção; rodar prova o
 *   estado (env carregada, allowlist vazia, SMTP de pé, template renderizando).
 *
 * POR QUE NÃO CRIO UMA NOTIFICAÇÃO DE TESTE
 *   Um `POST /notifications` com `channel: ['WHATSAPP']` é exatamente o gatilho
 *   que arma o laço de re-despacho de 1 minuto: uma notificação WhatsApp-only
 *   nunca tem `successCount > 0`, então `sentAt` fica NULL para sempre e o cron
 *   `processScheduledNotifications` a repesca eternamente, criando uma
 *   `NotificationDelivery` nova a cada volta. Testar assim deixaria lixo
 *   perpétuo no banco. Aqui a decisão da política é interrogada DIRETAMENTE, com
 *   as chaves reais dos 204 configs — mesma função que o dispatch consulta.
 *
 * EFEITO COLATERAL: envia UM e-mail real para o endereço passado. Nada mais.
 *
 * Rodar:
 *   pnpm exec ts-node -r tsconfig-paths/register --transpile-only \
 *     src/scripts/verify-channels-live.ts destino@exemplo.com
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { EmailService } from '../modules/common/mailer/services/email.service';
import {
  isWhatsAppNotificationAllowed,
  whatsAppNotificationAllowlist,
  describeWhatsAppNotificationPolicy,
} from '../modules/common/notification/whatsapp-notification-policy';
import { generateSignatureInvitationEmail } from '../templates/signature-emails';

async function main() {
  const destino = process.argv[2];
  if (!destino || !destino.includes('@')) {
    console.error('Uso: … verify-channels-live.ts destino@exemplo.com');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const email = app.get(EmailService);

  // ---------------------------------------------------------------- 1. WhatsApp
  console.log('\n═══ 1. TRAVA DO WHATSAPP NAS NOTIFICAÇÕES ═══\n');
  console.log(describeWhatsAppNotificationPolicy());

  const allowlist = whatsAppNotificationAllowlist();
  console.log(`allowlist carregada do ambiente: ${allowlist.size} chave(s)`);

  // Interroga a política com as chaves REAIS de produção, uma a uma.
  const configs = await prisma.notificationConfiguration.findMany({
    select: { key: true, name: true },
  });
  const liberadas = configs.filter(c => isWhatsAppNotificationAllowed(c.key, allowlist));

  console.log(`configs consultados            : ${configs.length}`);
  console.log(`configs que passariam por WhatsApp: ${liberadas.length}`);
  if (liberadas.length) {
    for (const c of liberadas) console.log(`   ⚠ ${c.key} — ${c.name}`);
  }

  // O caminho que ignora o registro: POST /notifications com canal explícito.
  // Ele produz metadata sem configKey, e a política precisa bloquear isso.
  const semConfigKey = isWhatsAppNotificationAllowed(null, allowlist);
  console.log(`notificação SEM configKey (POST direto) passaria? ${semConfigKey ? 'SIM ⚠' : 'não'}`);

  // Estado do banco, que é a segunda camada (a primeira é a allowlist).
  const canais = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `select count(*)::int as total,
            count(*) filter (where enabled)::int as habilitados
       from "NotificationChannelConfig" where channel = 'WHATSAPP'`,
  );
  console.log(`NotificationChannelConfig WHATSAPP: ${JSON.stringify(canais[0])}`);

  const ok1 = liberadas.length === 0 && !semConfigKey && Number(canais[0].habilitados) === 0;
  console.log(`\n→ ${ok1 ? '✅ NENHUMA notificação sai por WhatsApp.' : '❌ HÁ BRECHA — ver acima.'}`);

  // ------------------------------------------------------------------ 2. E-mail
  console.log('\n═══ 2. CONVITE DE ASSINATURA POR E-MAIL ═══\n');

  // Template REAL da cerimônia, não um texto inventado.
  const { subject, html } = generateSignatureInvitationEmail({
    signerName: 'Teste de Canal',
    budgetNumber: 0,
    signingUrl: 'https://ankaadesign.com.br/assinatura/teste-de-canal',
    deadlineDate: new Date().toLocaleDateString('pt-BR'),
  });
  console.log(`assunto : ${subject}`);
  console.log(`html    : ${html.length} bytes renderizados`);

  // Mesmo método que a ponte de e-mail da assinatura usa (signature.module.ts).
  const r = await email.sendEmailWithRetry(destino, `[TESTE] ${subject}`, html, 'SIGNATURE');
  console.log(`envio para ${destino}: ${r.success ? '✅ aceito pelo servidor' : `❌ ${r.error}`}`);

  // ------------------------------------------------------- 3. Lastro do cadastro
  console.log('\n═══ 3. COBERTURA DE E-MAIL DOS RESPONSÁVEIS ═══\n');
  const cobertura = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `select count(*)::int as total,
            count(*) filter (where email is not null and email like '%@%')::int as com_email
       from "Representative"`,
  );
  const { total, com_email } = cobertura[0] as { total: number; com_email: number };
  console.log(`responsáveis: ${total} | com e-mail: ${com_email} | sem: ${total - com_email}`);
  console.log(
    `→ ${com_email === total ? '✅ todos cobertos' : `⚠ ${total - com_email} emissões falhariam com 400 na validação de contato`}`,
  );

  await app.close();
  process.exit(ok1 && r.success ? 0 : 2);
}

main().catch(err => {
  console.error('FALHOU:', err);
  process.exit(1);
});
