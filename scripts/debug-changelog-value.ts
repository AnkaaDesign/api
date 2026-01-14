import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugChangelogValue() {
  const serviceOrderId = '649fd7c2-8b7b-4ae9-897e-efcbec794cf0'; // ADESIVO CABINE

  try {
    console.log('\n🔍 Debugging changelog value for ADESIVO CABINE service order...\n');

    const startedAtChange = await prisma.changeLog.findFirst({
      where: {
        entityType: 'SERVICE_ORDER',
        entityId: serviceOrderId,
        field: 'startedAt',
      },
    });

    if (!startedAtChange) {
      console.log('❌ No startedAt changelog entry found');
      return;
    }

    console.log('✅ Found startedAt changelog entry:\n');
    console.log('Raw Data:');
    console.log(JSON.stringify(startedAtChange, null, 2));

    console.log('\n📊 Type Analysis:');
    console.log(`oldValue type: ${typeof startedAtChange.oldValue}`);
    console.log(`oldValue value: ${JSON.stringify(startedAtChange.oldValue)}`);
    console.log(`newValue type: ${typeof startedAtChange.newValue}`);
    console.log(`newValue value: ${JSON.stringify(startedAtChange.newValue)}`);

    console.log('\n🔬 Parsing Test:');
    if (startedAtChange.newValue) {
      const value = startedAtChange.newValue;
      console.log(`Value as JSON: ${JSON.stringify(value)}`);
      console.log(`Value as string: ${String(value)}`);

      // Try to parse as date
      try {
        const dateValue = typeof value === 'string' ? value : String(value);
        const date = new Date(dateValue);
        console.log(`Parsed date: ${date}`);
        console.log(`Date ISO: ${date.toISOString()}`);
        console.log(`Is valid: ${!isNaN(date.getTime())}`);

        // Format like the frontend would
        if (!isNaN(date.getTime())) {
          const formatted = new Intl.DateTimeFormat('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }).format(date);
          console.log(`Formatted: ${formatted.replace(',', ' -')}`);
        }
      } catch (error) {
        console.error(`❌ Parse error:`, error);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugChangelogValue();
