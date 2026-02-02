const axios = require('axios');

const API_URL = 'http://localhost:3000';

// Test credentials - you'll need to replace with valid credentials
const testLogin = {
  email: 'admin@example.com',
  password: 'password123'
};

async function getAuthToken() {
  try {
    const response = await axios.post(`${API_URL}/auth/login`, testLogin);
    return response.data.token;
  } catch (error) {
    console.error('Failed to login:', error.response?.data || error.message);
    console.log('Please update the test credentials in test-representatives.js');
    process.exit(1);
  }
}

async function testRepresentatives() {
  console.log('🔐 Getting auth token...');
  const token = await getAuthToken();
  console.log('✅ Auth token obtained');

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // Test 1: Create a representative
  console.log('\n📝 Test 1: Creating a representative...');
  try {
    const createData = {
      name: 'John Doe',
      phone: '+5511999887766',
      email: 'john.doe@example.com',
      password: 'SecurePassword123!',
      customerId: '3ca9b1d3-691d-4725-8369-b2259072d22c',
      role: 'COMMERCIAL'
    };

    const createResponse = await axios.post(
      `${API_URL}/representatives`,
      createData,
      { headers }
    );
    console.log('✅ Representative created:', createResponse.data.id);

    const representativeId = createResponse.data.id;

    // Test 2: Get representative by ID
    console.log('\n📖 Test 2: Getting representative by ID...');
    const getResponse = await axios.get(
      `${API_URL}/representatives/${representativeId}`,
      { headers }
    );
    console.log('✅ Representative retrieved:', getResponse.data.name);

    // Test 3: List all representatives
    console.log('\n📋 Test 3: Listing all representatives...');
    const listResponse = await axios.get(
      `${API_URL}/representatives`,
      { headers }
    );
    console.log(`✅ Found ${listResponse.data.total} representatives`);

    // Test 4: Update representative
    console.log('\n✏️ Test 4: Updating representative...');
    const updateData = {
      name: 'John Smith'
    };
    const updateResponse = await axios.put(
      `${API_URL}/representatives/${representativeId}`,
      updateData,
      { headers }
    );
    console.log('✅ Representative updated:', updateResponse.data.name);

    // Test 5: Delete representative
    console.log('\n🗑️ Test 5: Deleting representative...');
    await axios.delete(
      `${API_URL}/representatives/${representativeId}`,
      { headers }
    );
    console.log('✅ Representative deleted');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }

  // Test 6: Representative Login (Public endpoint)
  console.log('\n🔑 Test 6: Testing representative login...');
  try {
    // First create a representative with system access
    const repData = {
      name: 'Login Test Rep',
      phone: '+5511888776655',
      email: 'rep.test@example.com',
      password: 'RepPassword123!',
      customerId: '3ca9b1d3-691d-4725-8369-b2259072d22c',
      role: 'MARKETING'
    };

    await axios.post(
      `${API_URL}/representatives`,
      repData,
      { headers }
    );
    console.log('✅ Test representative created');

    // Try to login
    const loginData = {
      contact: 'rep.test@example.com',
      password: 'RepPassword123!'
    };

    const loginResponse = await axios.post(
      `${API_URL}/representatives/login`,
      loginData
    );
    console.log('✅ Representative login successful, token:', loginResponse.data.token.substring(0, 20) + '...');

  } catch (error) {
    console.error('❌ Login test failed:', error.response?.data || error.message);
  }

  console.log('\n✨ All tests completed!');
}

testRepresentatives().catch(console.error);