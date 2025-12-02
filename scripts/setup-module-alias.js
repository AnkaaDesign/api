const fs = require('fs');
const path = require('path');

function setupModuleAlias() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

  if (packageJson._moduleAliases) {
    console.log('Module aliases are already configured in package.json');
    console.log('Runtime paths setup completed');
  } else {
    console.warn('No _moduleAliases found in package.json');
  }
}

setupModuleAlias();
