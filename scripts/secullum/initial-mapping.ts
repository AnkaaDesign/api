/**
 * One-shot bootstrap script: back-fill Sector.secullumDepartamentoId and
 * Position.secullumFuncaoId by matching Ankaa names against the live Secullum
 * /Departamentos and /Funcoes lists.
 *
 * Run after `pnpm db:migrate:deploy` once:
 *   pnpm exec tsx scripts/secullum/initial-mapping.ts
 *
 * Idempotent — re-running just re-syncs. Records that are already linked
 * (secullumXId != null) are left alone.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { SecullumCadastrosService } from '../../src/modules/integrations/secullum/secullum-cadastros.service';
import { PrismaService } from '../../src/modules/common/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const cad = app.get(SecullumCadastrosService);
    const prisma = app.get(PrismaService);

    const [departamentos, funcoes, sectors, positions] = await Promise.all([
      cad.listDepartamentos(),
      cad.listFuncoes(),
      prisma.sector.findMany({
        where: { secullumDepartamentoId: null },
      }),
      prisma.position.findMany({
        where: { secullumFuncaoId: null },
      }),
    ]);

    console.log(
      `\n[secullum] mapping ${sectors.length} sector(s) against ${departamentos.length} departamento(s)...`,
    );
    let sectorMatches = 0;
    for (const { sector, departamento } of cad.matchDepartamentos(
      sectors,
      departamentos,
    )) {
      if (sector) {
        await prisma.sector.update({
          where: { id: sector.id },
          data: { secullumDepartamentoId: departamento.Id },
        });
        sectorMatches++;
        console.log(
          `  ✔ ${sector.name.padEnd(28)} → Departamento #${departamento.Id} (${departamento.Descricao})`,
        );
      } else {
        console.log(
          `  ✘ unmatched Secullum departamento #${departamento.Id} (${departamento.Descricao})`,
        );
      }
    }

    console.log(
      `\n[secullum] mapping ${positions.length} position(s) against ${funcoes.length} função(ões)...`,
    );
    let positionMatches = 0;
    for (const { position, funcao } of cad.matchFuncoes(positions, funcoes)) {
      if (position) {
        await prisma.position.update({
          where: { id: position.id },
          data: { secullumFuncaoId: funcao.Id },
        });
        positionMatches++;
        console.log(
          `  ✔ ${position.name.padEnd(28)} → Função #${funcao.Id} (${funcao.Descricao})`,
        );
      } else {
        console.log(
          `  ✘ unmatched Secullum função #${funcao.Id} (${funcao.Descricao})`,
        );
      }
    }

    console.log(
      `\n[secullum] done. linked ${sectorMatches}/${departamentos.length} departamentos and ${positionMatches}/${funcoes.length} funções.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[secullum] bootstrap failed:', err);
  process.exit(1);
});
