#!/usr/bin/env node

// Load environment variables from .env.production
require('dotenv').config({ path: '.env.production' });

// Start the application
require('./dist/main.js');
