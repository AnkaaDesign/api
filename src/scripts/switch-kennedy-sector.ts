/**
 * switch-kennedy-sector.ts
 * ---------------------------------------------------------------------------
 * Troca TEMPORÁRIA do setor da conta Kennedy para ver o sistema com os olhos
 * de outro setor (ex.: o menu do Financeiro) — e a volta para Administração.
 *
 *   ... switch-kennedy-sector.ts financeiro       → Financeiro (FINANCIAL)
 *   ... switch-kennedy-sector.ts contabilidade    → Contabilidade (ACCOUNTING)
 *   ... switch-kennedy-sector.ts comercial        → Comercial (COMMERCIAL)
 *   ... switch-kennedy-sector.ts administracao    → Administração (ADMIN), o estado real
 *
 * Só a linha do User muda. O contrato ACTIVE (e1b9a682) segue com
 * sectorId = Administração, então qualquer update futuro de contrato também
 * devolveria o usuário à Administração (syncUserCurrentContract) — a volta
 * definitiva é o argumento `administracao`.
 *
 * Vai pelo UserService.update() (ChangeLog + validações). `secullumSyncEnabled`
 * é FALSE para este usuário: nada é enviado ao Secullum.
 *
 * Ator: Genivaldo (outro ADMIN) — UserService recusa auto-edição de setor.
 *
 * Depois da troca é preciso SAIR e ENTRAR de novo: o JWT carrega o privilégio
 * do login (ver auth.guard.ts).
 *
 * Backup antes da ida de 2026-09-29: tabela "User_knfinbackup20260929".
 *
 * Run:
 *   set -a; . ./.env.production; set +a
 *   DISABLE_WHATSAPP=true npx ts-node -r tsconfig-paths/register --transpile-only \
 *     src/scripts/switch-kennedy-sector.ts <financeiro|contabilidade|comercial|administracao>
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { UserService } from '../modules/people/user/user.service';

const KENNEDY_USER_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100';
const ACTOR_USER_ID = 'b51aa644-a242-41d3-8417-a073cd5ae448'; // Genivaldo Rodrigues (ADMIN)

const TARGETS: Record<string, { id: string; label: string }> = {
  financeiro: { id: '1cd80f49-e07e-4c91-adbb-0e7d30322dec', label: 'Financeiro (FINANCIAL)' },
  contabilidade: { id: '627f8cb2-7364-43b0-9653-59958791f2e9', label: 'Contabilidade (ACCOUNTING)' },
  comercial: { id: 'd8968b27-350a-453d-9c7e-6d83c350622e', label: 'Comercial (COMMERCIAL)' },
  administracao: { id: '35ddaa9e-071d-465e-8589-96dd476e6259', label: 'Administração (ADMIN)' },
};

async function main(): Promise<void> {
  const logger = new Logger('SwitchKennedySector');
  const target = TARGETS[process.argv[2] ?? ''];
  if (!target) {
    logger.error(`Uso: switch-kennedy-sector.ts <${Object.keys(TARGETS).join('|')}>`);
    process.exit(2);
  }
  if (process.env.DISABLE_WHATSAPP !== 'true') {
    logger.error('Rode com DISABLE_WHATSAPP=true (senão derruba a sessão do WhatsApp da produção).');
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const userService = app.get(UserService);
    logger.log(`Kennedy → ${target.label}`);
    const user = await userService.update(
      KENNEDY_USER_ID,
      { sectorId: target.id } as any,
      { sector: true } as any,
      ACTOR_USER_ID,
    );
    const data = (user as any)?.data ?? user;
    logger.log(`Resultado: setor = ${data?.sector?.name} (${data?.sector?.privileges})`);
  } catch (err) {
    exitCode = 1;
    logger.error('Falhou', err instanceof Error ? err.stack : String(err));
  } finally {
    // close() pode pendurar (Redis/Baileys) — e um script vivo é uma segunda
    // instância da produção. Prazo curto e saída forçada.
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(resolve, 10_000).unref()),
    ]);
    process.exit(exitCode);
  }
}

main();
