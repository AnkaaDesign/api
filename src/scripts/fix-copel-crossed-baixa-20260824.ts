/**
 * As três baixas manuais da COPEL de agosto foram lançadas às 18:40 de 24/08 com
 * os valores dos débitos — só que os dois menores entraram trocados entre as UCs.
 *
 * O extrato é a autoridade: o memo de cada débito carrega a UC.
 *   UC 0000107981068 → R$ 918,81   (lançado 1.155,13)
 *   UC 0000113926715 → R$ 1.155,13 (lançado 918,81)
 * Julho corrobora: 113926715 (1.181,92) > 107981068 (811,20), a mesma ordem.
 *
 * Troca os dois `paidAmount`, grava ChangeLog em cada ocorrência e liga cada uma
 * ao débito da sua própria UC pelo caminho oficial (`confirmOccurrenceFromBank`).
 * O total da conta não muda (R$ 2.073,94); muda a atribuição por medidor, que é o
 * que alimenta a estimativa por instalação daqui pra frente.
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { RecurrentPayableService } from '../modules/financial/recurrent-payable/recurrent-payable.service';
import { ChangeLogService } from '../modules/common/changelog/changelog.service';
import { CHANGE_ACTION, CHANGE_TRIGGERED_BY, ENTITY_TYPE } from '../constants';

const SWAP: Array<{ occId: string; uc: string; de: number; para: number }> = [
  { occId: 'f65c8e6d-d11b-4c92-9ed7-7037ca07ad2e', uc: '0000107981068', de: 1155.13, para: 918.81 },
  { occId: '185a7586-11df-4d9c-8d9e-d432c199453a', uc: '0000113926715', de: 918.81, para: 1155.13 },
];

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const prisma = app.get(PrismaService);
  const recurrent = app.get(RecurrentPayableService);
  const changelog = app.get(ChangeLogService);

  try {
    for (const s of SWAP) {
      const occ = await prisma.recurrentPayableOccurrence.findUniqueOrThrow({ where: { id: s.occId } });
      if (Number(occ.paidAmount) !== s.de) {
        console.log(`${s.uc}: paidAmount é ${occ.paidAmount}, esperava ${s.de} — abortando.`);
        return 1;
      }
      if (!apply) {
        console.log(`[dry-run] ${s.uc}: R$ ${s.de.toFixed(2)} → R$ ${s.para.toFixed(2)}`);
        continue;
      }
      await prisma.recurrentPayableOccurrence.update({
        where: { id: s.occId },
        data: { paidAmount: s.para },
      });
      await changelog.logChange({
        entityType: ENTITY_TYPE.RECURRENT_PAYABLE_OCCURRENCE,
        entityId: s.occId,
        action: CHANGE_ACTION.UPDATE,
        field: 'paidAmount',
        oldValue: s.de,
        newValue: s.para,
        reason:
          `Correção de 24/08: as baixas manuais das UCs 0000107981068 e 0000113926715 de ` +
          `agosto/2026 foram lançadas trocadas entre si. O extrato nomeia a UC no memo de ` +
          `cada débito (UC ${s.uc} = R$ ${s.para.toFixed(2)}), e julho segue a mesma ordem de ` +
          `grandeza. O total da conta não muda; muda a atribuição por medidor.`,
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
        triggeredById: null,
        userId: null,
        metadata: { uc: s.uc, competence: occ.competence, origem: 'fix-copel-crossed-baixa-20260824' },
      });
      const txId = await recurrent.confirmOccurrenceFromBank(s.occId);
      console.log(`${s.uc}: R$ ${s.de.toFixed(2)} → R$ ${s.para.toFixed(2)} · ${txId ? `ligada ao débito ${txId}` : 'NÃO ligada'}`);
    }
    if (!apply) console.log('DRY-RUN — nada foi escrito. Rode com --apply.');
    return 0;
  } finally {
    await Promise.race([app.close(), new Promise(r => setTimeout(r, 5000))]);
  }
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
