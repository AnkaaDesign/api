#!/bin/bash

echo "Stopping all Node processes..."
pkill -f "node" 2>/dev/null || true
pkill -f "ts-node" 2>/dev/null || true
sleep 2

echo "Removing Prisma client..."
rm -rf node_modules/.prisma 2>/dev/null || true
rm -rf node_modules/@prisma/client 2>/dev/null || true

echo "Clearing npm cache..."
npm cache clean --force 2>/dev/null || true

echo "Reinstalling Prisma packages..."
npm install @prisma/client prisma --save-exact

echo "Generating Prisma client..."
npx prisma generate

echo "Starting dev server..."
npm run dev