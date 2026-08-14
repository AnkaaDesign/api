/**
 * Prepara o cenário de teste da NFS-e do aerografista.
 *
 * O que faz, tudo idempotente (pode rodar de novo sem duplicar nada):
 *   1. Lê o certificado A1 do pintor e extrai CNPJ, razão social e validade de
 *      DENTRO do arquivo — o CNPJ não é digitado, para não haver divergência
 *      entre o cadastro e o certificado (que a SEFIN rejeitaria com E1209).
 *   2. Cria/atualiza o perfil fiscal do pintor.
 *   3. Guarda o certificado cifrado, pelo MESMO serviço que a tela usa.
 *   4. Cria uma tarefa em produção com uma aerografia de R$ 5,00 atribuída a ele,
 *      pronta para ser finalizada pela interface.
 *
 * A emissão em si NÃO é feita aqui: quem dispara é a conclusão da aerografia,
 * que é justamente o que se quer testar.
 *
 * Configuração (em .env.development, que é para onde .env aponta):
 *   PAINTER_TEST_CERT_PATH        caminho do .pfx
 *   PAINTER_TEST_CERT_PASSWORD    senha do .pfx      ← preencher
 *   PAINTER_TEST_PAINTER_NAME     nome do pintor no cadastro
 *   PAINTER_TEST_MUNICIPALITY_IBGE código IBGE do município do CNPJ do pintor
 *   PAINTER_TEST_ENVIRONMENT      1 = Produção (nota real), 2 = Produção Restrita
 *   PAINTER_TEST_PRICE            valor da aerografia
 *
 * Rodar: npm run setup:painter-nfse-test
 */

import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { FiscalCertificateService } from '../modules/integrations/nfse/painter/fiscal-certificate.service';
import { parsePfx } from '../modules/integrations/nfse/painter/fiscal-certificate.crypto';
import { getAirbrushingStatusOrder, getTaskStatusOrder } from '../utils/sortOrder';

const CERT_PATH = process.env.PAINTER_TEST_CERT_PATH;
const CERT_PASSWORD = process.env.PAINTER_TEST_CERT_PASSWORD;
const PAINTER_NAME = process.env.PAINTER_TEST_PAINTER_NAME || 'Marcos Aurelio';
const MUNICIPALITY = process.env.PAINTER_TEST_MUNICIPALITY_IBGE || '4109807';
const ENVIRONMENT = process.env.PAINTER_TEST_ENVIRONMENT === '1' ? 1 : 2;
const PRICE = Number(process.env.PAINTER_TEST_PRICE || '5');

const TASK_NAME = 'TESTE NFS-e — Aerografia';

function fail(message: string): never {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

async function main() {
  console.log('\n▸ Preparando o cenário de teste da NFS-e do aerografista\n');

  if (!CERT_PATH) fail('PAINTER_TEST_CERT_PATH não está definido no .env.');
  if (!CERT_PASSWORD) {
    fail(
      'PAINTER_TEST_CERT_PASSWORD está vazio.\n' +
        `   Preencha a senha do certificado em ${process.cwd()}/.env.development e rode de novo.`,
    );
  }
  if (!process.env.FISCAL_CERT_KEK) {
    fail('FISCAL_CERT_KEK não está definido — sem ele o certificado não pode ser guardado com segurança.');
  }

  let pfx: Buffer;
  try {
    pfx = readFileSync(CERT_PATH);
  } catch {
    fail(`Não foi possível ler o certificado em ${CERT_PATH}.`);
  }

  // Lê o certificado ANTES de subir o Nest: se a senha estiver errada, o erro
  // aparece em um segundo em vez de depois de trinta.
  const parsed = parsePfx(pfx, CERT_PASSWORD);
  if (!parsed.holderDocument) {
    fail('Não foi possível ler o CNPJ de dentro do certificado.');
  }
  if (parsed.holderIsIndividual) {
    fail(
      'O arquivo é um e-CPF. A emissão de NFS-e pelo MEI exige e-CNPJ (o certificado precisa conter o CNPJ).',
    );
  }

  const cnpj = parsed.holderDocument;
  // A convenção ICP-Brasil é CN = "RAZÃO SOCIAL:CNPJ".
  const corporateName = parsed.subjectCommonName.split(':')[0].trim();
  const diasRestantes = Math.floor((parsed.notAfter.getTime() - Date.now()) / 86_400_000);

  console.log('  Certificado lido:');
  console.log(`    Titular ......... ${corporateName}`);
  console.log(`    CNPJ ............ ${cnpj}`);
  console.log(`    Emissor ......... ${parsed.issuer.slice(0, 70)}`);
  console.log(`    Válido até ...... ${parsed.notAfter.toLocaleDateString('pt-BR')} (${diasRestantes} dias)`);

  if (parsed.notAfter <= new Date()) fail('O certificado está vencido.');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    const prisma = app.get(PrismaService, { strict: false });
    const certificates = app.get(FiscalCertificateService, { strict: false });

    // ── 1. O pintor ────────────────────────────────────────────────────────
    const painter = await prisma.user.findFirst({
      where: { name: { contains: PAINTER_NAME, mode: 'insensitive' } },
      select: { id: true, name: true, sector: { select: { name: true, privileges: true } } },
    });
    if (!painter) fail(`Colaborador "${PAINTER_NAME}" não encontrado.`);
    if (painter.sector?.privileges !== 'AIRBRUSHING') {
      console.warn(
        `  ⚠ ${painter.name} não está no setor Aerografia (está em "${painter.sector?.name ?? 'nenhum'}") — o seletor de pintor pode não listá-lo.`,
      );
    }
    console.log(`\n  Pintor .......... ${painter.name}`);

    // ── 2. Perfil fiscal ───────────────────────────────────────────────────
    const profileData = {
      cnpj,
      corporateName,
      municipalityIbgeCode: MUNICIPALITY,
      // MEI: opSimpNac 2 e regEspTrib 0 são obrigatórios (E0174/E0162).
      opSimpNac: 2,
      regEspTrib: 0,
      cTribNac: '141201',
      serviceDescription: 'Prestação de serviços de aerografia e pintura artística em veículos',
      serie: '00001',
      environment: ENVIRONMENT,
      // Ligada para o teste: sem isto a emissão para na pré-condição.
      emissionEnabled: true,
    };

    const profile = await prisma.fiscalEmitterProfile.upsert({
      where: { userId: painter.id },
      create: { ...profileData, userId: painter.id },
      update: profileData,
    });
    console.log(`  Perfil fiscal ... ${profile.id} (ambiente ${ENVIRONMENT === 1 ? 'PRODUÇÃO' : 'produção restrita'})`);

    // ── 3. Certificado ─────────────────────────────────────────────────────
    // Passa pelo serviço real: mesma validação, mesma cifragem, mesmo caminho
    // que a tela de cadastro usa.
    const stored = await certificates.upload({
      profileId: profile.id,
      pfx,
      password: CERT_PASSWORD,
    });
    console.log(`  Certificado ..... guardado cifrado (série ${stored.serialNumber})`);

    // ── 4. Tarefa + aerografia de teste ────────────────────────────────────
    const existingTask = await prisma.task.findFirst({
      where: { name: TASK_NAME },
      select: { id: true, airbrushings: { select: { id: true } } },
    });

    let taskId: string;
    if (existingTask) {
      taskId = existingTask.id;
      await prisma.task.update({
        where: { id: taskId },
        data: { status: 'IN_PRODUCTION', statusOrder: getTaskStatusOrder('IN_PRODUCTION') },
      });
      console.log(`\n  Tarefa .......... reaproveitada (${taskId})`);
    } else {
      const task = await prisma.task.create({
        data: {
          name: TASK_NAME,
          details:
            'Tarefa criada para validar a emissão automática de NFS-e do aerografista. Pode ser excluída depois do teste.',
          status: 'IN_PRODUCTION',
          statusOrder: getTaskStatusOrder('IN_PRODUCTION'),
          entryDate: new Date(),
          startedAt: new Date(),
        },
      });
      taskId = task.id;
      console.log(`\n  Tarefa .......... criada (${taskId})`);
    }

    const existingAirbrushing = await prisma.airbrushing.findFirst({
      where: { taskId },
      select: { id: true, nfse: { select: { id: true, status: true } } },
    });

    let airbrushingId: string;
    if (existingAirbrushing) {
      if (existingAirbrushing.nfse) {
        console.log(
          `  Aerografia ...... já existe e já tem nota (${existingAirbrushing.nfse.status}) — deixada como está.`,
        );
      }
      airbrushingId = existingAirbrushing.id;
      await prisma.airbrushing.update({
        where: { id: airbrushingId },
        data: {
          status: 'IN_PRODUCTION',
          statusOrder: getAirbrushingStatusOrder('IN_PRODUCTION'),
          price: PRICE,
          painterId: painter.id,
          startedAt: new Date(),
          finishedAt: null,
        },
      });
      console.log(`  Aerografia ...... reposta em produção (${airbrushingId})`);
    } else {
      const airbrushing = await prisma.airbrushing.create({
        data: {
          taskId,
          painterId: painter.id,
          price: PRICE,
          description: 'Teste de emissão de NFS-e — aerografia de validação',
          status: 'IN_PRODUCTION',
          statusOrder: getAirbrushingStatusOrder('IN_PRODUCTION'),
          startedAt: new Date(),
        },
      });
      airbrushingId = airbrushing.id;
      console.log(`  Aerografia ...... criada (${airbrushingId})`);
    }

    // ── Resumo ─────────────────────────────────────────────────────────────
    const gateOn = process.env.PAINTER_NFSE_SCHEDULER_ENABLED === 'true';

    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('  Tudo pronto.\n');
    console.log(`  Prestador ....... ${corporateName} — CNPJ ${cnpj}`);
    console.log('  Tomador ......... S. RODRIGUES & G. RODRIGUES LTDA — CNPJ 13636938000144');
    console.log(`  Valor ........... R$ ${PRICE.toFixed(2).replace('.', ',')}`);
    console.log(
      `  Ambiente ........ ${ENVIRONMENT === 1 ? 'PRODUÇÃO — a nota será REAL e válida' : 'produção restrita — a nota NÃO tem validade fiscal'}`,
    );
    console.log(`  Emissão automática ${gateOn ? 'LIGADA' : 'DESLIGADA (PAINTER_NFSE_SCHEDULER_ENABLED)'}`);
    console.log(`\n  Abra:  /producao/aerografia/detalhes/${airbrushingId}`);
    console.log('  Clique em "Finalizar". A nota é emitida logo após a conclusão');
    console.log('  e aparece no card "NFS-e do Aerografista" na mesma tela.');
    if (!gateOn) {
      console.log('\n  ⚠ Com a trava desligada, concluir apenas REGISTRA a intenção.');
      console.log('    Ligue PAINTER_NFSE_SCHEDULER_ENABLED=true, ou use o botão "Reemitir".');
    }
    console.log('─────────────────────────────────────────────────────────────\n');
  } finally {
    await app.close().catch(() => undefined);
  }
}

main()
  .then(() => {
    // Saída explícita: os crons do @nestjs/schedule ficam registrados no event
    // loop mesmo depois do app.close() e seguram o processo indefinidamente.
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Falhou:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
