/**
 * Diagnóstico de emissão de NFS-e de uma aerografia — ANTES de emitir.
 *
 * Responde três perguntas sem tocar em nada:
 *   1. a emissão AUTOMÁTICA sairia? (corte histórico + pré-condições)
 *   2. o botão "Emitir agora" funcionaria?
 *   3. qual descrição exata iria no xDescServ?
 *
 * A descrição é gerada pela MESMA função da emissão (`buildServiceDescription`),
 * não por uma reimplementação — prever com código paralelo é como não prever.
 *
 * SÓ LEITURA. Não usa o container do Nest (o builder é puro), então sobe rápido e
 * não fica pendurado em socket de WhatsApp.
 *
 * Uso:
 *   npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/nfse-diagnose.ts --tarefa "Confiança"
 */

import { PrismaClient } from '@prisma/client';
import { buildServiceDescription } from '../modules/integrations/nfse/painter/dps.builder';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const prisma = new PrismaClient();

async function main() {
  const filtro = arg('tarefa');
  if (!filtro) throw new Error('Informe --tarefa "parte do nome".');

  const cutoffRaw = process.env.PAINTER_NFSE_EMIT_FROM;
  const cutoff = cutoffRaw ? new Date(cutoffRaw) : null;
  const schedulerOn = process.env.PAINTER_NFSE_SCHEDULER_ENABLED === 'true';

  console.log(`corte histórico ..... ${cutoff ? cutoff.toISOString() : '(sem corte)'}`);
  console.log(`cron global ......... ${schedulerOn ? 'LIGADO' : 'desligado'}`);

  const airbrushings = await prisma.airbrushing.findMany({
    where: { task: { name: { contains: filtro, mode: 'insensitive' } } },
    select: {
      id: true,
      status: true,
      price: true,
      description: true,
      finishedAt: true,
      createdAt: true,
      painterId: true,
      painter: { select: { name: true, email: true } },
      nfse: { select: { status: true, accessKey: true, errorMessage: true } },
      task: {
        select: {
          name: true,
          serialNumber: true,
          customer: { select: { fantasyName: true, corporateName: true } },
          truck: {
            select: { plate: true, chassisNumber: true, category: true, implementType: true },
          },
        },
      },
    },
  });

  if (airbrushings.length === 0) {
    console.log(`\nNenhuma aerografia em tarefa contendo "${filtro}".`);
    return;
  }

  for (const ab of airbrushings) {
    console.log(`\n${'='.repeat(72)}`);
    console.log(`TAREFA: ${ab.task?.name ?? '(sem tarefa)'}`);
    console.log(`aerografia .......... ${ab.id}`);
    console.log(`status .............. ${ab.status}`);
    console.log(`preço ............... ${ab.price ?? '(sem preço)'}`);
    console.log(`finalizada em ....... ${ab.finishedAt?.toISOString() ?? '(não finalizada)'}`);
    console.log(`pintor .............. ${ab.painter?.name ?? '(sem pintor)'} <${ab.painter?.email ?? '-'}>`);
    console.log(`nota atual .......... ${ab.nfse ? `${ab.nfse.status} ${ab.nfse.accessKey ?? ''}` : '(nenhuma)'}`);

    const profile = ab.painterId
      ? await prisma.fiscalEmitterProfile.findUnique({
          where: { userId: ab.painterId },
          select: {
            id: true,
            environment: true,
            emissionEnabled: true,
            serviceDescription: true,
            cnpj: true,
            certificates: { where: { isActive: true }, select: { notAfter: true } },
          },
        })
      : null;

    const cert = profile?.certificates[0] ?? null;
    const certValid = cert ? cert.notAfter > new Date() : false;

    // ── Pré-condições da emissão (mesma ordem de performEmission) ──
    const problemas: string[] = [];
    if (ab.status !== 'COMPLETED') problemas.push('aerografia não está CONCLUÍDA');
    if (!ab.price || ab.price <= 0) problemas.push('sem preço');
    if (!ab.painterId) problemas.push('sem pintor');
    if (!profile) problemas.push('pintor sem perfil fiscal');
    else {
      if (!profile.emissionEnabled) problemas.push('emissão desligada no perfil');
      if (!cert) problemas.push('pintor sem certificado A1');
      else if (!certValid) problemas.push('certificado vencido');
    }

    // ── Corte histórico: só afeta a criação da INTENÇÃO automática ──
    const referencia = ab.finishedAt ?? ab.createdAt;
    const anteriorAoCorte = Boolean(cutoff && referencia && referencia < cutoff);

    console.log(`perfil fiscal ....... ${profile ? `CNPJ ${profile.cnpj}, ambiente ${profile.environment} (${profile.environment === 1 ? 'PRODUÇÃO' : 'homologação'}), emissão ${profile.emissionEnabled ? 'LIGADA' : 'desligada'}` : 'AUSENTE'}`);
    console.log(`certificado ......... ${cert ? `vence ${cert.notAfter.toLocaleDateString('pt-BR')}${certValid ? '' : ' (VENCIDO)'}` : 'AUSENTE'}`);

    console.log(`\n  AUTOMÁTICA (ao concluir):`);
    if (ab.nfse) {
      console.log(`    já existe intenção (${ab.nfse.status}) — o corte não se aplica.`);
    } else if (anteriorAoCorte) {
      console.log(`    NÃO — finalizada em ${referencia?.toISOString()}, antes do corte. Sem emissão retroativa.`);
      console.log(`    (concluir de novo HOJE carimba finishedAt=agora e passa a valer)`);
    } else {
      console.log(`    sim, o corte não bloqueia.`);
    }
    console.log(`  MANUAL ("Emitir agora"): ${problemas.length === 0 ? 'SIM — registra a intenção na hora, ignorando o corte.' : 'NÃO'}`);
    if (problemas.length > 0) {
      for (const p of problemas) console.log(`    ✗ ${p}`);
    }

    const fallback =
      profile?.serviceDescription ??
      'Prestação de serviços de aerografia e pintura artística em veículos';
    console.log(`\n  DESCRIÇÃO QUE IRIA NA NOTA (xDescServ):`);
    console.log(`  ┌${'─'.repeat(70)}`);
    for (const linha of buildServiceDescription(fallback, ab as never).match(/.{1,68}(\s|$)/g) ?? []) {
      console.log(`  │ ${linha.trim()}`);
    }
    console.log(`  └${'─'.repeat(70)}`);
  }
}

main()
  .catch(error => {
    console.error(`\nFALHOU: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
