const jwt = require('jsonwebtoken');

const JWT_SECRET = '3f32ab2d1d32390cbacea5840894204f353ccd6d044f0ea6997528a64e7f81a5';

// Create a test token with a real user
const payload = {
  sub: 'f88dd544-131f-4225-88b0-a1f604c2a163',
  userId: 'f88dd544-131f-4225-88b0-a1f604c2a163',
  email: 'matheus@gmail.com',
  sectorId: 'c8cd9fab-25b9-4fff-a0da-6b396d262a1a',
  sectorPrivileges: 'PRODUCTION',
  roles: ['ADMIN'],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
};

const token = jwt.sign(payload, JWT_SECRET);
console.log('Token:', token);