const axios = require('axios');

// Secullum credentials
const SECULLUM_EMAIL = 'kennedy.ankaa@gmail.com';
const SECULLUM_PASSWORD = 'Apx220628522';
const SECULLUM_DATABASE_ID = '4c8681f2e79a4b7ab58cc94503106736';
const SECULLUM_CLIENT_ID = '3';

// Alisson's data
const ALISSON_PIS = '16084326553';
const ALISSON_NAME = 'Alisson Nantes da Silva';

// Period: January 2026 (Dec 26, 2025 to Jan 25, 2026)
const START_DATE = '2025-12-26';
const END_DATE = '2026-01-25';

let secullumToken = null;

async function getSecullumToken() {
  console.log('\n🔐 Authenticating with Secullum...\n');

  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('username', SECULLUM_EMAIL);
  params.append('password', SECULLUM_PASSWORD);
  params.append('client_id', SECULLUM_CLIENT_ID);
  params.append('scope', 'api');

  try {
    const response = await axios.post('https://autenticador.secullum.com.br/Token', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    secullumToken = response.data.access_token;
    console.log('✅ Authentication successful\n');
    return secullumToken;
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
    throw error;
  }
}

async function findSecullumEmployee() {
  console.log('🔍 Finding Alisson in Secullum employees...\n');

  try {
    const response = await axios.get('https://pontoweb.secullum.com.br/Funcionarios', {
      headers: {
        'Authorization': `Bearer ${secullumToken}`,
        'secullumbancoselecionado': SECULLUM_DATABASE_ID
      }
    });

    const employees = response.data;
    const alisson = employees.find(emp => emp.NumeroPis === ALISSON_PIS);

    if (!alisson) {
      console.log('❌ Alisson not found in Secullum');
      return null;
    }

    console.log(`✅ Found: ${alisson.Nome} (ID: ${alisson.Id})`);
    console.log(`   PIS: ${alisson.NumeroPis}`);
    console.log(`   CPF: ${alisson.Cpf || 'N/A'}`);
    console.log(`   Payroll: ${alisson.NumeroFolha || 'N/A'}\n`);

    return alisson;
  } catch (error) {
    console.error('❌ Failed to fetch employees:', error.message);
    throw error;
  }
}

async function getHolidays() {
  console.log('🎄 Fetching holidays from Secullum...\n');

  const holidays = [];

  for (const year of [2025, 2026]) {
    try {
      const response = await axios.get(`https://pontoweb.secullum.com.br/Feriados?year=${year}`, {
        headers: {
          'Authorization': `Bearer ${secullumToken}`,
          'secullumbancoselecionado': SECULLUM_DATABASE_ID
        }
      });

      if (response.data && Array.isArray(response.data)) {
        response.data.forEach(holiday => {
          const holidayDate = new Date(holiday.Data);
          const periodStart = new Date(START_DATE);
          const periodEnd = new Date(END_DATE);

          if (holidayDate >= periodStart && holidayDate <= periodEnd) {
            holidays.push({
              date: holiday.Data,
              description: holiday.Descricao,
              dateObj: holidayDate
            });
          }
        });
      }
    } catch (error) {
      console.log(`⚠️  Failed to fetch holidays for ${year}: ${error.message}`);
    }
  }

  console.log(`Found ${holidays.length} holidays in period:\n`);
  holidays.forEach(h => {
    const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][h.dateObj.getDay()];
    console.log(`  - ${h.date} (${dayOfWeek}): ${h.description}`);
  });
  console.log('');

  return holidays;
}

async function getTimeEntries(employeeId) {
  console.log('⏰ Fetching time entries from Secullum...\n');

  try {
    const response = await axios.get(
      `https://pontoweb.secullum.com.br/Batidas/${employeeId}/${START_DATE}/${END_DATE}`,
      {
        headers: {
          'Authorization': `Bearer ${secullumToken}`,
          'secullumbancoselecionado': SECULLUM_DATABASE_ID
        }
      }
    );

    let entries = response.data;

    // Handle different response formats
    if (!Array.isArray(entries)) {
      if (entries && entries.lista && Array.isArray(entries.lista)) {
        entries = entries.lista;
      } else if (entries && entries.data && Array.isArray(entries.data)) {
        entries = entries.data;
      } else {
        console.log('⚠️  Unexpected response format. Raw response:');
        console.log(JSON.stringify(entries, null, 2).substring(0, 500));
        return [];
      }
    }

    console.log(`✅ Fetched ${entries.length} time entries\n`);
    return entries;
  } catch (error) {
    console.error('❌ Failed to fetch time entries:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data).substring(0, 200));
    }
    throw error;
  }
}

function analyzeTimeEntries(entries, holidays) {
  console.log('📊 DETAILED DAY-BY-DAY ANALYSIS\n');
  console.log('='.repeat(120));
  console.log('');

  let totalWorkingDays = 0;
  let daysWithAllFourElectronicStamps = 0;
  const holidayDates = holidays.map(h => h.date);

  entries.forEach((entry, index) => {
    const date = entry.Data || entry.data;
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getDay(); // 0=Sun, 6=Sat
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek];

    const entrada1 = entry.Entrada1 || entry.entrada1;
    const saida1 = entry.Saida1 || entry.saida1;
    const entrada2 = entry.Entrada2 || entry.entrada2;
    const saida2 = entry.Saida2 || entry.saida2;

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = holidayDates.includes(date);
    const isFerias = [entrada1, saida1, entrada2, saida2].some(
      f => f && typeof f === 'string' && f.toUpperCase().includes('FÉRIAS')
    );
    const isAtestado = [entrada1, saida1, entrada2, saida2].some(
      f => f && typeof f === 'string' && f.toUpperCase().includes('ATESTAD')
    );

    const isValidStamp = (s) => s && typeof s === 'string' && s.trim() !== '' && /\d{1,2}:\d{2}/.test(s);
    const hasAllFourStamps =
      isValidStamp(entrada1) &&
      isValidStamp(saida1) &&
      isValidStamp(entrada2) &&
      isValidStamp(saida2) &&
      !isAtestado;

    // Check if electronic (FonteDadosTipo === 0 means electronic)
    const getOrigin = (field) => {
      const fd = entry[field];
      if (fd && typeof fd === 'object' && fd.Tipo !== undefined) {
        return fd.Tipo;
      }
      return null;
    };

    const origem1E = getOrigin('FonteDadosEntrada1');
    const origem1S = getOrigin('FonteDadosSaida1');
    const origem2E = getOrigin('FonteDadosEntrada2');
    const origem2S = getOrigin('FonteDadosSaida2');

    const allElectronic = hasAllFourStamps &&
      [origem1E, origem1S, origem2E, origem2S].every(o => o === 0);

    const isWorkingDay = (dayOfWeek >= 1 && dayOfWeek <= 5) && !isHoliday && !isFerias;

    if (isWorkingDay) {
      totalWorkingDays++;
      if (allElectronic) {
        daysWithAllFourElectronicStamps++;
      }
    }

    // Print analysis
    const status = [];
    if (isWeekend) status.push('WEEKEND');
    if (isHoliday) status.push('HOLIDAY');
    if (isFerias) status.push('VACATION');
    if (isAtestado) status.push('ATESTADO');
    if (isWorkingDay) status.push('WORKING_DAY');
    if (hasAllFourStamps) status.push('4_STAMPS');
    if (allElectronic) status.push('ALL_ELECTRONIC');

    const stamps = `${entrada1 || '--:--'} | ${saida1 || '--:--'} | ${entrada2 || '--:--'} | ${saida2 || '--:--'}`;
    const origins = `[${origem1E ?? '-'}|${origem1S ?? '-'}|${origem2E ?? '-'}|${origem2S ?? '-'}]`;

    console.log(`${String(index + 1).padStart(3)}. ${date} (${dayName})  ${stamps}  ${origins}  ${status.join(', ')}`);
  });

  console.log('');
  console.log('='.repeat(120));
  console.log('');

  return {
    totalWorkingDays,
    daysWithAllFourElectronicStamps
  };
}

async function main() {
  console.log('\n');
  console.log('═'.repeat(120));
  console.log('  DEEP ANALYSIS: Alisson Nantes da Silva - Janeiro 2026 Bonus Extra');
  console.log('═'.repeat(120));
  console.log('');
  console.log('📋 Expected from UI:');
  console.log('   - Bônus Base: R$ 28,05');
  console.log('   - Assiduidade do Ponto Eletrônico: +11%');
  console.log('   - Bônus Final: R$ 31,14');
  console.log('');
  console.log('🎯 Period: December 26, 2025 to January 25, 2026');
  console.log('');

  try {
    // Step 1: Authenticate
    await getSecullumToken();

    // Step 2: Find employee
    const employee = await findSecullumEmployee();
    if (!employee) {
      console.log('❌ Cannot continue without employee data');
      return;
    }

    // Step 3: Get holidays
    const holidays = await getHolidays();

    // Step 4: Get time entries
    const entries = await getTimeEntries(employee.Id);

    // Step 5: Analyze
    const analysis = analyzeTimeEntries(entries, holidays);

    // Step 6: Calculate
    console.log('🧮 CALCULATION BREAKDOWN\n');
    console.log('─'.repeat(80));
    console.log('');

    const incorrectlyStampedDays = analysis.totalWorkingDays - analysis.daysWithAllFourElectronicStamps;
    const extraPercentage = Math.max(0, analysis.totalWorkingDays - incorrectlyStampedDays);

    console.log(`Total Working Days (Mon-Fri, excluding holidays): ${analysis.totalWorkingDays}`);
    console.log(`Days with All 4 Electronic Stamps: ${analysis.daysWithAllFourElectronicStamps}`);
    console.log(`Incorrectly Stamped Days: ${incorrectlyStampedDays}`);
    console.log('');
    console.log('Formula (Reversed Logic):');
    console.log(`  incorrectlyStampedDays = totalWorkingDays - daysWithAllFourElectronicStamps`);
    console.log(`  incorrectlyStampedDays = ${analysis.totalWorkingDays} - ${analysis.daysWithAllFourElectronicStamps}`);
    console.log(`  incorrectlyStampedDays = ${incorrectlyStampedDays}`);
    console.log('');
    console.log(`  extraPercentage = totalWorkingDays - incorrectlyStampedDays`);
    console.log(`  extraPercentage = ${analysis.totalWorkingDays} - ${incorrectlyStampedDays}`);
    console.log(`  extraPercentage = ${extraPercentage}%`);
    console.log('');
    console.log('─'.repeat(80));
    console.log('');

    // Step 7: Verify
    console.log('✅ VERIFICATION\n');

    if (extraPercentage === 11) {
      console.log('✓ Extra percentage MATCHES UI: 11%');
    } else {
      console.log(`✗ Extra percentage MISMATCH:`);
      console.log(`   Expected (from UI): 11%`);
      console.log(`   Calculated: ${extraPercentage}%`);
      console.log(`   Difference: ${extraPercentage - 11}%`);
    }

    const baseBonus = 28.05;
    const calculatedExtraValue = baseBonus * (extraPercentage / 100);
    const calculatedFinal = baseBonus + calculatedExtraValue;

    console.log('');
    console.log(`Base Bonus: R$ ${baseBonus.toFixed(2)}`);
    console.log(`Extra (${extraPercentage}%): R$ ${calculatedExtraValue.toFixed(2)}`);
    console.log(`Calculated Final: R$ ${calculatedFinal.toFixed(2)}`);
    console.log(`Expected Final (UI): R$ 31.14`);
    console.log('');

    if (Math.abs(calculatedFinal - 31.14) < 0.01) {
      console.log('✓ Final amount MATCHES!');
    } else {
      console.log(`✗ Final amount MISMATCH by R$ ${Math.abs(calculatedFinal - 31.14).toFixed(2)}`);
    }

    console.log('');
    console.log('═'.repeat(120));
    console.log('');

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

main();
