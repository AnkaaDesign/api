#!/bin/bash
cd /home/kennedy/ankaa/apps/api
exec /home/kennedy/ankaa/node_modules/.bin/ts-node-dev -r tsconfig-paths/register --transpile-only --respawn src/main.ts