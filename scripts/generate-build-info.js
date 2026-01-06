const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function generateBuildInfo() {
  const buildInfo = {
    buildTime: new Date().toISOString(),
    version: process.env.npm_package_version || '0.0.1',
    commit: '',
    branch: '',
    node: process.version,
  };

  try {
    buildInfo.commit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch (error) {
    buildInfo.commit = 'unknown';
  }

  try {
    buildInfo.branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch (error) {
    buildInfo.branch = 'unknown';
  }

  const outputPath = path.join(__dirname, '..', 'src', 'build-info.json');
  fs.writeFileSync(outputPath, JSON.stringify(buildInfo, null, 2));

  if (process.env.NODE_ENV !== 'production') {
    console.log('Build info generated:', buildInfo);
  }
}

generateBuildInfo();
