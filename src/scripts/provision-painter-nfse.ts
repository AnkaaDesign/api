/**
 * Provisiona a emissão de NFS-e de UM aerografista — perfil fiscal, certificado A1
 * e a trava de emissão.
 *
 * Existe porque o `setup-painter-nfse-test` NÃO serve em produção: ele cria tarefa e
 * aerografia de teste. Este aqui não inventa dado nenhum — só grava o perfil, cifra
 * o certificado no banco e liga a chave.
 *
 * IDEMPOTENTE: rodar de novo com os mesmos argumentos reescreve o perfil e reaproveita
 * o certificado já cadastrado (o fingerprint SHA-256 do PFX é @unique, então o mesmo
 * arquivo não entra duas vezes).
 *
 * O certificado vai CIFRADO para o banco (envelope AES-256-GCM sob FISCAL_CERT_KEK).
 * O arquivo .pfx em disco é só a origem da carga — depois de rodar, ele não é mais
 * lido em runtime.
 *
 * Uso:
 *   npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/provision-painter-nfse.ts \
 *     --email pintor@exemplo.com \
 *     --cnpj 51115818000190 \
 *     --razao "NOME DO MEI" \
 *     --ibge 4113700 \
 *     --cert /caminho/cert.pfx \
 *     --senha 'senha' \
 *     --ambiente 1 \
 *     --habilitar
 *
 * Sem `--habilitar` o perfil e o certificado ficam prontos e a emissão continua
 * DESLIGADA — que é exatamente o estado "pronto para quando o certificado chegar".
 */

import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'fs';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { FiscalEmitterProfileService } from '../modules/integrations/nfse/painter/fiscal-emitter-profile.service';
import { FiscalCertificateService } from '../modules/integrations/nfse/painter/fiscal-certificate.service';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const email = arg('email');
  const userIdArg = arg('user-id');
  const cnpj = arg('cnpj');
  const razao = arg('razao');
  const ibge = arg('ibge');
  const certPath = arg('cert');
  const senha = arg('senha');
  const ambiente = arg('ambiente');
  const habilitar = flag('habilitar');
  const listar = flag('listar');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const profiles = app.get(FiscalEmitterProfileService);
    const certificates = app.get(FiscalCertificateService);

    // `--listar` é o modo de conferência: mostra em que pé está cada emitente.
    if (listar) {
      const all = await prisma.fiscalEmitterProfile.findMany({
        include: {
          user: { select: { name: true, email: true } },
          certificates: {
            where: { isActive: true },
            select: { subjectCommonName: true, notAfter: true },
          },
        },
      });
      if (all.length === 0) {
        console.log('Nenhum perfil fiscal cadastrado.');
      }
      for (const p of all) {
        const cert = p.certificates[0];
        console.log(
          [
            `${p.user?.name ?? '(sem usuário)'} <${p.user?.email ?? '-'}>`,
            `  CNPJ ${p.cnpj} · IBGE ${p.municipalityIbgeCode} · série ${p.serie}`,
            `  ambiente ${p.environment} (${p.environment === 1 ? 'Produção' : 'Produção Restrita'})`,
            `  emissão ${p.emissionEnabled ? 'LIGADA' : 'desligada'}`,
            `  certificado ${cert ? `${cert.subjectCommonName}, vence ${cert.notAfter.toLocaleDateString('pt-BR')}` : 'AUSENTE'}`,
          ].join('\n'),
        );
      }
      return;
    }

    if (!email && !userIdArg) throw new Error('Informe --email ou --user-id.');
    if (!cnpj || !razao || !ibge) throw new Error('Informe --cnpj, --razao e --ibge.');

    const user = userIdArg
      ? await prisma.user.findUnique({ where: { id: userIdArg }, select: { id: true, name: true } })
      : await prisma.user.findFirst({
          where: { email: { equals: email!, mode: 'insensitive' } },
          select: { id: true, name: true },
        });
    if (!user) throw new Error(`Colaborador não encontrado (${email ?? userIdArg}).`);

    console.log(`Colaborador: ${user.name} (${user.id})`);

    const profile = await profiles.upsert(user.id, {
      cnpj: cnpj.replace(/\D/g, ''),
      corporateName: razao,
      municipalityIbgeCode: ibge.replace(/\D/g, ''),
      // ambiente só é aplicado se veio no argumento; senão preserva o que já existe
      // (o default do schema é 2 = Produção Restrita).
      ...(ambiente ? { environment: Number(ambiente) } : {}),
    });
    console.log(
      `Perfil fiscal salvo — CNPJ ${profile.cnpj}, IBGE ${profile.municipalityIbgeCode}, ambiente ${profile.environment}.`,
    );

    if (certPath) {
      if (!senha) throw new Error('--cert exige --senha.');
      const existing = await prisma.fiscalCertificate.findFirst({
        where: { profileId: profile.id, isActive: true },
        select: { subjectCommonName: true, notAfter: true },
      });
      if (existing) {
        console.log(
          `Certificado ativo já cadastrado (${existing.subjectCommonName}, vence ${existing.notAfter.toLocaleDateString('pt-BR')}) — mantido.`,
        );
      } else {
        const pfx = readFileSync(certPath);
        const cert = await certificates.upload({ profileId: profile.id, pfx, password: senha });
        console.log(
          `Certificado cadastrado e cifrado no banco — ${cert.subjectCommonName}, vence ${new Date(cert.notAfter).toLocaleDateString('pt-BR')}.`,
        );
      }
    } else {
      console.log('Sem --cert: perfil pronto, aguardando o certificado do colaborador.');
    }

    if (habilitar) {
      // setEmissionEnabled RECUSA ligar sem certificado ativo válido — é a trava que
      // impede um emitente ficar "ligado" e falhando em toda varredura.
      const updated = await profiles.setEmissionEnabled(user.id, true);
      console.log(
        `Emissão automática LIGADA (ambiente ${updated.environment} — ${updated.environment === 1 ? 'notas com validade jurídica' : 'produção restrita'}).`,
      );
    } else {
      console.log('Emissão automática permanece desligada (rode com --habilitar para ligar).');
    }
  } finally {
    // O desligamento do container derruba sockets (Baileys/Redis) e o
    // onModuleDestroy deles estoura "Connection is closed". Isso é ruído de
    // encerramento: deixar propagar marcaria como FALHA um provisionamento que já
    // gravou tudo.
    await app.close().catch(() => undefined);
  }
}

main()
  .then(() => {
    // Saída forçada: o container abre socket de WhatsApp (Baileys) e conexão de
    // Redis que seguram o event loop mesmo depois do close. Sem isto o script
    // termina o trabalho e fica pendurado para sempre.
    process.exit(0);
  })
  .catch(error => {
    console.error(`\nFALHOU: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
