/**
 * Email Configuration Verification Script
 * Checks that all email-related environment variables are properly configured
 */

const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

console.log('\n=== Email SMTP Configuration Verification ===\n');

// Check required environment variables
const requiredVars = {
  'SMTP_HOST': process.env.SMTP_HOST,
  'SMTP_PORT': process.env.SMTP_PORT,
  'SMTP_SECURE': process.env.SMTP_SECURE,
  'SMTP_USER': process.env.SMTP_USER,
  'SMTP_PASSWORD': process.env.SMTP_PASSWORD,
  'SMTP_FROM_EMAIL': process.env.SMTP_FROM_EMAIL,
  'SMTP_FROM_NAME': process.env.SMTP_FROM_NAME,
};

const optionalVars = {
  'EMAIL_TEMPLATES_DIR': process.env.EMAIL_TEMPLATES_DIR,
  'EMAIL_USER': process.env.EMAIL_USER,
  'EMAIL_PASS': process.env.EMAIL_PASS,
};

let allValid = true;

console.log('Required Environment Variables:');
console.log('━'.repeat(70));

for (const [key, value] of Object.entries(requiredVars)) {
  const status = value ? '✓' : '✗';
  const color = value ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';

  if (!value) allValid = false;

  const displayValue = value
    ? (key.includes('PASSWORD') ? '***' : value)
    : 'NOT SET';

  console.log(`${color}${status}${reset} ${key.padEnd(25)} = ${displayValue}`);
}

console.log('\nOptional Environment Variables:');
console.log('━'.repeat(70));

for (const [key, value] of Object.entries(optionalVars)) {
  const status = value ? '✓' : '-';
  const color = value ? '\x1b[32m' : '\x1b[33m';
  const reset = '\x1b[0m';

  const displayValue = value
    ? (key.includes('PASS') ? '***' : value)
    : 'NOT SET (using defaults)';

  console.log(`${color}${status}${reset} ${key.padEnd(25)} = ${displayValue}`);
}

// Check template directory
console.log('\nTemplate Directory:');
console.log('━'.repeat(70));

const templatesDir = process.env.EMAIL_TEMPLATES_DIR || path.join(process.cwd(), 'src', 'templates', 'emails');
const templatesExist = fs.existsSync(templatesDir);

if (templatesExist) {
  console.log(`\x1b[32m✓\x1b[0m Templates directory exists: ${templatesDir}`);

  // Check for template files
  const subdirs = ['layouts', 'partials', 'notifications'];

  subdirs.forEach(subdir => {
    const dirPath = path.join(templatesDir, subdir);
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.hbs'));
      console.log(`  \x1b[32m✓\x1b[0m ${subdir.padEnd(15)} ${files.length} template(s)`);
      files.forEach(file => {
        console.log(`    - ${file}`);
      });
    } else {
      console.log(`  \x1b[31m✗\x1b[0m ${subdir} directory not found`);
      allValid = false;
    }
  });
} else {
  console.log(`\x1b[31m✗\x1b[0m Templates directory not found: ${templatesDir}`);
  allValid = false;
}

// Check module files
console.log('\nEmail Module Files:');
console.log('━'.repeat(70));

const moduleFiles = [
  'src/modules/common/mailer/repositories/nodemail.repository.ts',
  'src/modules/common/mailer/services/handlebars-template.service.ts',
  'src/modules/common/mailer/services/mailer.service.ts',
  'src/modules/common/mailer/mailer.module.ts',
];

moduleFiles.forEach(filePath => {
  const fullPath = path.join(process.cwd(), filePath);
  const exists = fs.existsSync(fullPath);
  const status = exists ? '✓' : '✗';
  const color = exists ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';

  if (!exists) allValid = false;

  console.log(`${color}${status}${reset} ${filePath}`);
});

// Check documentation files
console.log('\nDocumentation Files:');
console.log('━'.repeat(70));

const docFiles = [
  'docs/EMAIL_SETUP.md',
  'docs/SMTP_PROVIDERS.md',
  'docs/EMAIL_SUMMARY.md',
  'src/templates/emails/README.md',
];

docFiles.forEach(filePath => {
  const fullPath = path.join(process.cwd(), filePath);
  const exists = fs.existsSync(fullPath);
  const status = exists ? '✓' : '✗';
  const color = exists ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';

  console.log(`${color}${status}${reset} ${filePath}`);
});

// Validate configuration
console.log('\nConfiguration Validation:');
console.log('━'.repeat(70));

if (requiredVars.SMTP_PORT && isNaN(parseInt(requiredVars.SMTP_PORT))) {
  console.log('\x1b[31m✗\x1b[0m SMTP_PORT must be a number');
  allValid = false;
} else if (requiredVars.SMTP_PORT) {
  const port = parseInt(requiredVars.SMTP_PORT);
  if (port === 465) {
    if (requiredVars.SMTP_SECURE !== 'true') {
      console.log('\x1b[33m⚠\x1b[0m Port 465 typically requires SMTP_SECURE=true (SSL)');
    }
  } else if (port === 587) {
    if (requiredVars.SMTP_SECURE === 'true') {
      console.log('\x1b[33m⚠\x1b[0m Port 587 typically uses SMTP_SECURE=false (STARTTLS)');
    }
  }
  console.log(`\x1b[32m✓\x1b[0m SMTP_PORT is valid: ${port}`);
}

if (requiredVars.SMTP_HOST) {
  console.log(`\x1b[32m✓\x1b[0m SMTP_HOST is set: ${requiredVars.SMTP_HOST}`);
}

if (requiredVars.SMTP_USER && requiredVars.SMTP_PASSWORD) {
  console.log('\x1b[32m✓\x1b[0m SMTP credentials are configured');
}

// Email validation
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (requiredVars.SMTP_FROM_EMAIL) {
  if (emailRegex.test(requiredVars.SMTP_FROM_EMAIL)) {
    console.log(`\x1b[32m✓\x1b[0m SMTP_FROM_EMAIL is valid: ${requiredVars.SMTP_FROM_EMAIL}`);
  } else {
    console.log(`\x1b[31m✗\x1b[0m SMTP_FROM_EMAIL is invalid: ${requiredVars.SMTP_FROM_EMAIL}`);
    allValid = false;
  }
}

// Summary
console.log('\n' + '═'.repeat(70));
if (allValid) {
  console.log('\x1b[32m✓ Email configuration is complete and valid!\x1b[0m');
  console.log('\nNext steps:');
  console.log('1. Test email sending with your SMTP provider');
  console.log('2. Review documentation in docs/EMAIL_SETUP.md');
  console.log('3. Customize templates in src/templates/emails/');
} else {
  console.log('\x1b[31m✗ Email configuration has issues that need to be resolved.\x1b[0m');
  console.log('\nPlease:');
  console.log('1. Set all required environment variables in your .env file');
  console.log('2. Ensure all module files exist');
  console.log('3. Review docs/EMAIL_SETUP.md for setup instructions');
}
console.log('═'.repeat(70) + '\n');

process.exit(allValid ? 0 : 1);
