import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

// List of users that need to be created (from your error output)
const missingUsers = [
  { name: 'Kennedy Campos', email: 'plotter.ankaa@gmail.com' },
  { name: 'Gleverton Armangni Costa', email: 'armangni96@gmail.com' },
  { name: 'José Antônio de Almeida Júnior', email: 'almeidajunior0237@gmail.com' },
  { name: 'Eronildo Kauan dos Santos', email: 'kauaansantoss31@gmail.com' },
  { name: 'Pedro Antônio de Oliveira', email: 'pedroantoniio04@icloud.com' },
  { name: 'Alisson Nantes da Silva', email: 'alissonnantes1@gmail.com' },
  { name: 'Gabriel Storck', email: 'storck22@icloud.com' },
  { name: 'Célio Lourenço', email: 'celiolourenco300@gmail.com' },
  { name: 'Michael Alves Ferreira', email: 'maycon99691662@gmail.com' },
  { name: 'Davyd Jefferson Sobral Alves', email: 'davydsobralalves@gmail.com' },
  { name: 'Breno Willian dos Santos Silva', email: 'brenowillian530@gmail.com' },
  { name: 'Matheus Felipe dos Santos', email: 'mathheuslondrina@hotmail.com' },
  { name: 'Kayo Kenjy Iba da Silva', email: 'kayokenjy14@gmail.com' },
  { name: 'João Vitor Neves Silva', email: 'joaovitor2004dograu@gmail.com' },
  { name: 'Guilherme de Souza Bolteri', email: 'guilhermebolteri800@gmail.com' },
  { name: 'Pedro Henrique Canheti', email: 'pedrohenriquecanheti@gmail.com' },
  { name: 'Igor Santos Faria', email: 'igorsantosdefarias806@gmail.com' },
  { name: 'Almoxarifado', email: 'almoxarifado@ankaadesign.com.br' }, // Added a default email
  { name: 'Fábio Aparecido Rodrigues', email: '1603fabiorodrigues@gmail.com' },
  { name: 'Diego do Nascimento Francisco', email: 'dn735621@gmail.com' },
  { name: 'Genivaldo Rodrigues', email: 'genny_321@hotmail.com' },
  { name: 'Kennedy Campos', email: 'kennedy.kobra@gmail.com' }, // Different email
  { name: 'Sergio Rodrigues', email: 'sergio_ankaa@hotmail.com' },
  { name: 'Wellington Modenuti', email: 'we1993.www@gmail.com' },
  { name: 'Guilherme Felipe Gomes Martins', email: 'guilhermefelipegomesmartins7@gmail.com' },
  { name: 'Fabio Aparecido Rodrigues', email: '1603fabiorodrigues@email.com' }, // Different email
  { name: 'Lucas Dhiovane Gonçalves Maia', email: 'lucasmaia12345678910@gmail.com' },
  { name: 'Fernanda', email: 'fernanda@gmail.com' },
  { name: 'Paulo Batista', email: 'paulo@gmail.com' },
  { name: 'Matheus Henrique', email: 'matheus@gmail.com' },
  { name: 'Lucas Gabriel', email: 'lucas@gmail.com' }, // Fixed typo in email
  { name: 'Fábio Martins Nunes', email: 'fabio@gmail.com' },
  { name: 'João Paulo Santos', email: 'p.jaum9@gmail.com' },
  { name: 'Luiz Guilherme Teles Prado', email: 'lguitelesprado90@gmail.com' },
  { name: 'Gabriel Aparecido', email: 'gabrielapsantos13@gmail.com' },
  { name: 'Gustavo Costa', email: 'gusta021006@gmail.com' },
  { name: 'Henrique Natan', email: 'hnatan047@gmail.com' },
  { name: 'Gabriel Kaick', email: 'gkaick28@gmail.com' },
];

async function createMissingUsers() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('🔧 Starting to create missing users...\n');
  }

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const userData of missingUsers) {
    try {
      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { email: userData.email },
            { name: userData.name },
          ],
        },
      });

      if (existingUser) {
        if (process.env.NODE_ENV !== 'production') {
          console.log(`⏭️  Skipped (already exists): ${userData.name} (${userData.email})`);
        }
        skipped++;
        continue;
      }

      // Create user
      const defaultPassword = await hash('ankaa123', 10); // Default password

      const newUser = await prisma.user.create({
        data: {
          name: userData.name,
          email: userData.email,
          login: userData.email.split('@')[0], // Use email prefix as login
          cpf: null,
          active: true,
          password: defaultPassword,
          phone: null,
          birthDate: null,
          imageUrl: null,
          isTemporaryPassword: true, // Flag to force password change on first login
        },
      });

      if (process.env.NODE_ENV !== 'production') {
        console.log(`✅ Created user: ${newUser.name} (${newUser.email})`);
      }
      created++;
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`❌ Error creating user ${userData.name}:`, error);
      }
      errors++;
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('\n📊 Summary:');
    console.log(`  ✅ Created: ${created}`);
    console.log(`  ⏭️  Skipped: ${skipped}`);
    console.log(`  ❌ Errors: ${errors}`);
  }
}

async function migratePlatesFromTasksToTrucks() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('\n🚗 Starting plate migration from tasks to trucks...\n');
  }

  try {
    // Find all tasks that might have plate data
    const tasks = await prisma.task.findMany({
      include: {
        truck: true,
      },
    });

    let updated = 0;
    let skipped = 0;
    let created = 0;

    for (const task of tasks) {
      // Check if this task has a serialNumber that looks like a plate
      const platePattern = /^[A-Z]{3}[-\s]?\d{1}[A-Z0-9]{1}\d{2}$|^[A-Z]{3}[-\s]?\d{4}$/i;

      if (task.serialNumber && platePattern.test(task.serialNumber)) {
        if (task.truck) {
          // Update existing truck with the plate
          if (!task.truck.plate) {
            await prisma.truck.update({
              where: { id: task.truck.id },
              data: { plate: task.serialNumber },
            });
            if (process.env.NODE_ENV !== 'production') {
              console.log(`✅ Updated truck for task "${task.name}" with plate: ${task.serialNumber}`);
            }
            updated++;
          } else {
            if (process.env.NODE_ENV !== 'production') {
              console.log(`⏭️  Skipped task "${task.name}" - truck already has plate: ${task.truck.plate}`);
            }
            skipped++;
          }
        } else {
          // Create a new truck for this task with the plate
          await prisma.truck.create({
            data: {
              plate: task.serialNumber,
              chassisNumber: null,
              taskId: task.id,
            },
          });
          if (process.env.NODE_ENV !== 'production') {
            console.log(`✅ Created truck for task "${task.name}" with plate: ${task.serialNumber}`);
          }
          created++;
        }

        // Clear the serialNumber from task if it's a plate (optional)
        // await prisma.task.update({
        //   where: { id: task.id },
        //   data: { serialNumber: null },
        // });
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('\n📊 Plate Migration Summary:');
      console.log(`  ✅ Updated existing trucks: ${updated}`);
      console.log(`  ✅ Created new trucks: ${created}`);
      console.log(`  ⏭️  Skipped: ${skipped}`);
    }

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('❌ Error during plate migration:', error);
    }
  }
}

async function main() {
  try {
    if (process.env.NODE_ENV !== 'production') {
      console.log('🚀 Starting migration fixes...\n');
      console.log('=' .repeat(50));
    }

    // Step 1: Create missing users
    await createMissingUsers();

    if (process.env.NODE_ENV !== 'production') {
      console.log('\n' + '='.repeat(50));
    }

    // Step 2: Migrate plates from tasks to trucks
    await migratePlatesFromTasksToTrucks();

    if (process.env.NODE_ENV !== 'production') {
      console.log('\n' + '='.repeat(50));
      console.log('\n✨ Migration fixes completed successfully!');
    }

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('❌ Fatal error:', error);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
main();