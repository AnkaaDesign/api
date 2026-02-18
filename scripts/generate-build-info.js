const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packageJson = require('../package.json');

function getGitInfo() {
  try {
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    return { commit, branch };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
}

const gitInfo = getGitInfo();

const buildInfo = {
  buildTime: new Date().toISOString(),
  version: packageJson.version,
  commit: gitInfo.commit,
  branch: gitInfo.branch,
  node: process.version
};

const outputPath = path.join(__dirname, '..', 'src', 'build-info.json');
fs.writeFileSync(outputPath, JSON.stringify(buildInfo, null, 2));

console.log('Build info generated:', buildInfo);
