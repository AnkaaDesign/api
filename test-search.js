const axios = require('axios');

async function testSearch() {
  try {
    console.log('Testing search for serial number 36000...');

    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmODhkZDU0NC0xMzFmLTQyMjUtODhiMC1hMWY2MDRjMmExNjMiLCJ1c2VySWQiOiJmODhkZDU0NC0xMzFmLTQyMjUtODhiMC1hMWY2MDRjMmExNjMiLCJlbWFpbCI6Im1hdGhldXNAZ21haWwuY29tIiwic2VjdG9ySWQiOiJjOGNkOWZhYi0yNWI5LTRmZmYtYTBkYS02YjM5NmQyNjJhMWEiLCJzZWN0b3JQcml2aWxlZ2VzIjoiUFJPRFVDVElPTiIsInJvbGVzIjpbIkFETUlOIl0sImlhdCI6MTc2MDYyMjk1MSwiZXhwIjoxNzYxMjI3NzUxfQ.bLgs0q_1kTH74qd2iPlsEx5Og4XIC4ryhOTNKiHaF50';

    // Test with auth
    const response = await axios.get('http://localhost:3030/tasks', {
      params: {
        searchingFor: '36000',
        limit: 5
      },
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('Response status:', response.status);
    console.log('Total results:', response.data.total);
    console.log('Number of results:', response.data.data?.length || 0);

    if (response.data.data && response.data.data.length > 0) {
      console.log('First task serial:', response.data.data[0].serialNumber);
    }
  } catch (error) {
    console.error('Error:', error.response?.status, error.response?.data || error.message);
  }
}

testSearch();