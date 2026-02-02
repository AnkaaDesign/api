import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SecullumBonusIntegrationService } from '../src/modules/human-resources/bonus/secullum-bonus-integration.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const secullumService = app.get(SecullumBonusIntegrationService);

  const alissonUser = {
    id: 'b80c8281-8ffd-41cf-94fb-07018f275922',
    name: 'Alisson Nantes da Silva',
    pis: '16084326553',
  };

  console.log('\n🔍 Analyzing Alisson Nantes da Silva - Janeiro 2026\n');
  console.log('Expected from UI:');
  console.log('  - Bônus Base: R$ 28,05');
  console.log('  - Assiduidade: +11%');
  console.log('  - Bônus Final: R$ 31,14\n');

  const analysis = await secullumService.analyzeAllUsers(2026, 1, [alissonUser]);

  const alissonAnalysis = analysis.get(alissonUser.id);

  if (!alissonAnalysis) {
    console.log('❌ No analysis found for Alisson');
    await app.close();
    return;
  }

  console.log('📊 Analysis Results:\n');
  console.log(`Total Working Days: ${alissonAnalysis.totalWorkingDays}`);
  console.log(`Holidays Count: ${alissonAnalysis.holidaysCount}`);
  console.log(`Days with Full Electronic Stamps: ${alissonAnalysis.daysWithFullElectronicStamps}`);
  console.log(`Incorrectly Stamped Days: ${alissonAnalysis.incorrectlyStampedDays}`);
  console.log(`Extra Percentage: ${alissonAnalysis.extraPercentage}%`);
  console.log(`Loses Extra: ${alissonAnalysis.losesExtra}`);
  console.log(`Atestado Hours: ${alissonAnalysis.atestadoHours}`);
  console.log(`Unjustified Hours: ${alissonAnalysis.unjustifiedAbsenceHours}`);

  console.log('\n🧮 Formula Breakdown:\n');
  console.log(`incorrectlyStampedDays = totalWorkingDays - daysWithFullElectronicStamps`);
  console.log(`incorrectlyStampedDays = ${alissonAnalysis.totalWorkingDays} - ${alissonAnalysis.daysWithFullElectronicStamps}`);
  console.log(`incorrectlyStampedDays = ${alissonAnalysis.incorrectlyStampedDays}`);
  console.log('');
  console.log(`extraPercentage = totalWorkingDays - incorrectlyStampedDays`);
  console.log(`extraPercentage = ${alissonAnalysis.totalWorkingDays} - ${alissonAnalysis.incorrectlyStampedDays}`);
  console.log(`extraPercentage = ${alissonAnalysis.extraPercentage}%`);

  console.log('\n✅ Verification:\n');
  if (alissonAnalysis.extraPercentage === 11) {
    console.log('✓ Extra percentage matches UI (11%)');
  } else {
    console.log(`✗ Extra percentage MISMATCH: Expected 11%, Got ${alissonAnalysis.extraPercentage}%`);
  }

  const baseBonus = 28.05;
  const calculatedExtra = baseBonus * (alissonAnalysis.extraPercentage / 100);
  const expectedFinal = baseBonus + calculatedExtra;

  console.log(`\nBase Bonus: R$ ${baseBonus.toFixed(2)}`);
  console.log(`Extra (${alissonAnalysis.extraPercentage}%): R$ ${calculatedExtra.toFixed(2)}`);
  console.log(`Final: R$ ${expectedFinal.toFixed(2)}`);
  console.log(`Expected Final from UI: R$ 31.14`);

  if (Math.abs(expectedFinal - 31.14) < 0.01) {
    console.log('✓ Final amount matches!');
  } else {
    console.log(`✗ Final amount MISMATCH`);
  }

  console.log('\n📅 Daily Breakdown (first 10 days):\n');
  alissonAnalysis.dailyBreakdown.slice(0, 10).forEach((day, idx) => {
    console.log(`${idx + 1}. ${day.date}: Working=${day.isWorkingDay}, Holiday=${day.isHoliday}, All4Stamps=${day.hasAllFourStamps}, Electronic=${day.allStampsElectronic}`);
  });

  await app.close();
}

main().catch(console.error);
