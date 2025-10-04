import axios from 'axios';

async function testPayrollEndpoints() {
  try {
    // First, login to get a token
    console.log('1. Logging in to get auth token...');
    const loginResponse = await axios.post('http://localhost:3030/api/auth/login', {
      contact: 'admin@ankaa.com.br',  // Can be email or phone
      password: 'Admin@123'           // Update with valid password
    });

    const token = loginResponse.data.data.token;
    console.log('✅ Login successful!\n');

    // Test bonuses endpoint
    console.log('2. Testing /api/payroll/bonuses endpoint...');
    const bonusesResponse = await axios.get('http://localhost:3030/api/payroll/bonuses', {
      params: {
        year: 2025,
        month: 9
      },
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('✅ Bonuses endpoint success!');
    console.log('Data:', JSON.stringify(bonusesResponse.data, null, 2));
    console.log('\n---\n');

    // Test details endpoint
    console.log('3. Testing /api/payroll/details endpoint...');
    const detailsResponse = await axios.get('http://localhost:3030/api/payroll/details', {
      params: {
        year: 2025,
        month: 9
      },
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('✅ Details endpoint success!');
    console.log('Data:', JSON.stringify(detailsResponse.data, null, 2));

  } catch (error: any) {
    console.log('\n❌ Error:', error.response?.status || error.code);
    console.log('Message:', error.response?.data?.message || error.message);
    console.log('Details:', JSON.stringify(error.response?.data, null, 2));
  }
}

testPayrollEndpoints();