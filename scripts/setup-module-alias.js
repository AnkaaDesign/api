const fs = require('fs');
const path = require('path');

function setupModuleAlias() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

  if (!packageJson._moduleAliases && process.env.NODE_ENV !== 'production') {
    console.warn('No _moduleAliases found in package.json');
  }
}

setupModuleAlias();
