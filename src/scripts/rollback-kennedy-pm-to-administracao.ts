/**
 * rollback-kennedy-pm-to-administracao.ts
 * ---------------------------------------------------------------------------
 * Reverte a conta Kennedy Campos (identidade de smoke-test do Secullum,
 * Funcionario 18) do setor "Gerente de Produção" (PRODUCTION_MANAGER), usado
 * para testes, de volta para "Administração" (ADMIN).
 *
 * Diferente do rollback anterior (rollback-kennedy-to-administracao.ts), aqui
 * NÃO é preciso mexer no contrato: o contrato ACTIVE (e1b9a682) já está com
 * sectorId = Administração — só a linha do User foi movida para PM. Ou seja,
 * o mirror de syncUserCurrentContract já aponta para Administração.
 *
 * Vai pelo UserService.update() (não SQL cru) para gerar ChangeLog e passar
 * pelas validações. `secullumSyncEnabled` está FALSE hoje, então nenhuma
 * chamada ao Secullum é disparada e as prerequisites não são revalidadas.
 *
 * Não mexe em: cpf, payrollNumber (150), secullumEmployeeId (18),
 * secullumSyncEnabled (false), secullumHorarioId (2), contratos.
 *
 * Backup da linha antes da mudança: tabela "User_knpmbackup20260812".
 *
 * Run:  npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/rollback-kennedy-pm-to-administracao.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { UserService } from '../modules/people/user/user.service';

const KENNEDY_USER_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100';
const ADMINISTRACAO_SECTOR_ID = '35ddaa9e-071d-465e-8589-96dd476e6259'; // ADMIN
// Ator do ChangeLog: NÃO pode ser o próprio Kennedy — UserService.update tem
// guarda de auto-edição ("Você não pode alterar seu próprio setor, cargo,
// status ou nível de desempenho"). E não pode ser 'system' (FK do ChangeLog
// reverte a transação). Usa o outro ADMIN real.
const ACTOR_USER_ID = 'b51aa644-a242-41d3-8417-a073cd5ae448'; // Genivaldo Rodrigues (ADMIN)

async function main(): Promise<void> {
  const logger = new Logger('RollbackKennedyPmToAdministracao');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const userService = app.get(UserService);

    logger.log(`Updating user ${KENNEDY_USER_ID}: sectorId -> ${ADMINISTRACAO_SECTOR_ID} (Administração)`);
    const user = await userService.update(
      KENNEDY_USER_ID,
      { sectorId: ADMINISTRACAO_SECTOR_ID } as any,
      { sector: true } as any,
      ACTOR_USER_ID,
    );
    const data = (user as any)?.data ?? user;
    logger.log(`Result: sector = ${data?.sector?.name} (${data?.sector?.privileges})`);
  } catch (err) {
    exitCode = 1;
    logger.error('Failed', err instanceof Error ? err.stack : String(err));
  } finally {
    await app.close();
    process.exit(exitCode);
  }
}

main();
