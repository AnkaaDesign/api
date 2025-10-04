#!/usr/bin/env node

/**
 * Build Information Generator
 *
 * Generates a build-info.json file containing version, git, and deployment metadata.
 * This script is called during the build process to embed version tracking information.
 *
 * Usage:
 *   node scripts/generate-build-info.js
 *
 * Environment Variables:
 *   GIT_COMMIT_SHA     - Full git commit SHA (from CI/CD)
 *   GIT_COMMIT_SHORT   - Short git commit SHA (from CI/CD)
 *   GIT_BRANCH         - Git branch name (from CI/CD)
 *   BUILD_NUMBER       - CI/CD build number
 *   NODE_ENV           - Environment (production, staging, development)
 *   DEPLOYED_BY        - Username/actor who triggered deployment
 *   DEPLOYMENT_METHOD  - Method of deployment (ci-cd, manual, docker)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function execCommand(command, fallback = 'unknown') {
  try {
    return execSync(command, { encoding: 'utf-8' }).trim();
  } catch (error) {
    console.warn(`Failed to execute: ${command}, using fallback: ${fallback}`);
    return fallback;
  }
}

function getGitInfo() {
  return {
    commitSha: process.env.GIT_COMMIT_SHA || process.env.GITHUB_SHA || execCommand('git rev-parse HEAD', 'local-dev'),
    commitShort: process.env.GIT_COMMIT_SHORT || execCommand('git rev-parse --short HEAD', 'local'),
    branch: process.env.GIT_BRANCH || process.env.GITHUB_REF_NAME || execCommand('git rev-parse --abbrev-ref HEAD', 'main'),
    commitMessage: execCommand('git log -1 --pretty=%B', 'No commit message'),
    commitAuthor: execCommand('git log -1 --pretty=%an', 'Unknown'),
    commitDate: execCommand('git log -1 --pretty=%ci', new Date().toISOString()),
  };
}

function getPackageVersion() {
  try {
    const packageJson = require('../package.json');
    return packageJson.version || '0.0.1';
  } catch (error) {
    console.warn('Failed to read package.json version, using default');
    return '0.0.1';
  }
}

function generateBuildInfo() {
  const gitInfo = getGitInfo();
  const now = new Date();

  const buildInfo = {
    // Version information
    version: getPackageVersion(),
    gitCommitSha: gitInfo.commitSha,
    gitCommitShort: gitInfo.commitShort,
    gitBranch: gitInfo.branch,
    gitCommitMessage: gitInfo.commitMessage,
    gitCommitAuthor: gitInfo.commitAuthor,
    gitCommitDate: gitInfo.commitDate,

    // Build information
    buildTimestamp: now.toISOString(),
    buildNumber: process.env.BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || 'local',
    buildId: process.env.BUILD_ID || process.env.GITHUB_RUN_ID || `local-${Date.now()}`,
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,

    // Deployment information
    deployedBy: process.env.DEPLOYED_BY || process.env.GITHUB_ACTOR || process.env.USER || 'unknown',
    deployedAt: now.toISOString(),
    deploymentId: process.env.DEPLOYMENT_ID || process.env.GITHUB_RUN_ID || `local-${Date.now()}`,
    deploymentMethod: process.env.DEPLOYMENT_METHOD ||
                      (process.env.GITHUB_ACTIONS ? 'ci-cd' : 'manual'),

    // CI/CD specific
    ciPlatform: process.env.GITHUB_ACTIONS ? 'github-actions' :
                process.env.GITLAB_CI ? 'gitlab-ci' :
                process.env.CIRCLECI ? 'circleci' : 'local',
    workflowName: process.env.GITHUB_WORKFLOW || undefined,
    runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined,
  };

  return buildInfo;
}

function main() {
  console.log('🔨 Generating build information...');

  const buildInfo = generateBuildInfo();

  // Output directory (dist root or current directory)
  const outputDir = path.join(__dirname, '..', 'dist');
  const srcOutputDir = path.join(__dirname, '..', 'src');

  // Ensure output directories exist
  [outputDir, srcOutputDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Write to both locations for maximum compatibility
  const outputFiles = [
    path.join(outputDir, 'build-info.json'),
    path.join(srcOutputDir, 'build-info.json'),
  ];

  outputFiles.forEach(outputPath => {
    fs.writeFileSync(outputPath, JSON.stringify(buildInfo, null, 2));
    console.log(`✅ Build info written to: ${outputPath}`);
  });

  // Print summary
  console.log('\n📦 Build Information Summary:');
  console.log(`   Version: ${buildInfo.version}`);
  console.log(`   Commit: ${buildInfo.gitCommitShort} (${buildInfo.gitBranch})`);
  console.log(`   Environment: ${buildInfo.environment}`);
  console.log(`   Build Number: ${buildInfo.buildNumber}`);
  console.log(`   Deployed By: ${buildInfo.deployedBy}`);
  console.log(`   Build Time: ${buildInfo.buildTimestamp}`);
  console.log('');
}

main();
