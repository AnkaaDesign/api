/**
 * Script to regenerate October 2025 payrolls
 * This will populate the new dsrDays field
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PayrollService } from '../src/modules/human-resources/payroll/payroll.service';

async function main() {
  console.log('Creating NestJS application context...');
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const payrollService = app.get(PayrollService);

    console.log('Generating payrolls for October 2025...');

    // Use a system user ID (empresário ID from the JWT token)
    const systemUserId = '8b65323a-e06e-4c82-a167-d81e34b77638';

    const result = await payrollService.generateForMonth(2025, 10, systemUserId);

    console.log('Payroll generation completed!');
    console.log(`Created: ${result.created}`);
    console.log(`Skipped: ${result.skipped}`);
    console.log(`Errors: ${result.errors?.length || 0}`);

    if (result.errors && result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach((error: any) => {
        console.log(`  - ${error.userId}: ${error.error}`);
      });
    }
  } catch (error) {
    console.error('Error generating payrolls:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

main();
