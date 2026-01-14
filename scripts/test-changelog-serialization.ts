import { PrismaClient } from '@prisma/client';
import { serializeChangelogValue } from '../src/modules/common/changelog/utils/serialize-changelog-value';

const prisma = new PrismaClient();

async function testSerialization() {
  try {
    console.log('\n🧪 Testing Changelog Serialization\n');

    // Test 1: Serialize a Date object
    const testDate = new Date('2026-01-14T12:32:56.050Z');
    console.log('1. Original Date object:');
    console.log(`   ${testDate}`);
    console.log(`   ISO: ${testDate.toISOString()}`);

    const serialized = serializeChangelogValue(testDate);
    console.log('\n2. After serializeChangelogValue():');
    console.log(`   Type: ${typeof serialized}`);
    console.log(`   Value: ${serialized}`);
    console.log(`   JSON.stringify: ${JSON.stringify(serialized)}`);

    // Test 2: Create a test changelog entry
    console.log('\n3. Creating test changelog entry...');

    const testEntry = await prisma.changeLog.create({
      data: {
        entityType: 'SERVICE_ORDER',
        entityId: 'test-id-' + Date.now(),
        action: 'UPDATE',
        field: 'testField',
        oldValue: null,
        newValue: serialized, // This is the ISO string
        reason: 'Test entry',
        triggeredBy: 'USER_ACTION',
        userId: '345cd001-37de-469b-a184-fb0e729d4401',
        metadata: {
          timestamp: new Date().toISOString(),
        },
      },
    });

    console.log('\n4. Created changelog entry:');
    console.log(`   ID: ${testEntry.id}`);
    console.log(`   newValue type: ${typeof testEntry.newValue}`);
    console.log(`   newValue: ${JSON.stringify(testEntry.newValue)}`);

    // Test 3: Retrieve it back
    const retrieved = await prisma.changeLog.findUnique({
      where: { id: testEntry.id },
    });

    console.log('\n5. Retrieved changelog entry:');
    console.log(`   newValue type: ${typeof retrieved?.newValue}`);
    console.log(`   newValue: ${JSON.stringify(retrieved?.newValue)}`);
    console.log(`   Raw value: ${retrieved?.newValue}`);

    // Test 4: Try to parse it as a date
    if (retrieved?.newValue) {
      const value = retrieved.newValue;
      console.log('\n6. Parsing as date:');
      console.log(`   Value as string: ${String(value)}`);

      try {
        const parsedDate = new Date(String(value));
        console.log(`   Parsed date: ${parsedDate}`);
        console.log(`   Is valid: ${!isNaN(parsedDate.getTime())}`);
      } catch (error) {
        console.log(`   ❌ Failed to parse: ${error.message}`);
      }
    }

    // Clean up
    await prisma.changeLog.delete({
      where: { id: testEntry.id },
    });

    console.log('\n✅ Test complete\n');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testSerialization();
