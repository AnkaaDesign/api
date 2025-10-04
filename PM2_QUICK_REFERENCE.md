# PM2 Quick Reference Card

## 🚀 Start Commands

| Command | Description |
|---------|-------------|
| `./pm2-start-both.sh` | Start both production (3030) and staging (3031) |
| `./pm2-start-production.sh` | Start production only |
| `./pm2-start-staging.sh` | Start staging only |
| `pm2 start ecosystem.config.js` | Start all from config |
| `pm2 start ecosystem.config.js --only ankaa-api-production` | Start specific app |

## 📊 Status & Monitoring

| Command | Description |
|---------|-------------|
| `./pm2-status.sh` | Show detailed status |
| `pm2 status` | Show all processes |
| `pm2 monit` | Real-time monitoring dashboard |
| `pm2 describe ankaa-api-production` | Detailed app info |
| `pm2 list` | List all processes |

## 📋 Logs

| Command | Description |
|---------|-------------|
| `./pm2-logs.sh` | View all logs |
| `./pm2-logs.sh production` | View production logs |
| `./pm2-logs.sh staging` | View staging logs |
| `pm2 logs ankaa-api-production --lines 100` | Last 100 lines |
| `pm2 logs --err` | Error logs only |
| `pm2 flush` | Clear all logs |

## 🔄 Restart & Reload

| Command | Description |
|---------|-------------|
| `pm2 restart ankaa-api-production` | Restart production (with downtime) |
| `pm2 reload ankaa-api-production` | Reload production (zero-downtime) |
| `pm2 restart all` | Restart all processes |
| `pm2 reload all` | Reload all (zero-downtime) |

## 🛑 Stop & Delete

| Command | Description |
|---------|-------------|
| `./pm2-stop-all.sh` | Stop all environments |
| `pm2 stop ankaa-api-production` | Stop production |
| `pm2 stop all` | Stop all processes |
| `pm2 delete ankaa-api-production` | Delete production from PM2 |
| `pm2 delete all` | Delete all processes |

## 🔧 Configuration

| Command | Description |
|---------|-------------|
| `./pm2-validate.sh` | Validate PM2 setup |
| `pm2 save` | Save current process list |
| `pm2 resurrect` | Restore saved processes |
| `pm2 startup` | Generate startup script |
| `pm2 unstartup` | Disable startup script |

## 🗄️ Database

| Command | Description |
|---------|-------------|
| `./setup-staging-db.sh` | Setup staging database |
| `psql -U docker -d ankaa` | Connect to production DB |
| `psql -U docker -d ankaa_staging` | Connect to staging DB |

## 📝 File Locations

| Path | Description |
|------|-------------|
| `/home/kennedy/ankaa/apps/api/ecosystem.config.js` | PM2 config |
| `/home/kennedy/ankaa/apps/api/logs/production-*.log` | Production logs |
| `/home/kennedy/ankaa/apps/api/logs/staging-*.log` | Staging logs |
| `/home/kennedy/ankaa/apps/api/uploads/` | Production uploads |
| `/home/kennedy/ankaa/apps/api/uploads-staging/` | Staging uploads |

## 🌐 Endpoints

| Environment | URL |
|-------------|-----|
| Production API | http://localhost:3030/api |
| Staging API | http://localhost:3031/api |
| Production Health | http://localhost:3030/api/health |
| Staging Health | http://localhost:3031/api/health |

## 🔍 Troubleshooting

| Issue | Solution |
|-------|----------|
| Process won't start | `./pm2-validate.sh` then check logs |
| Port in use | `lsof -i :3030` or `lsof -i :3031` |
| Build missing | `npm run build` |
| High memory | Check `pm2 describe` and adjust `max_memory_restart` |
| Logs not appearing | Check `logs/` permissions: `chmod -R 755 logs` |

## 📦 Common Workflows

### Deploy to Production
```bash
npm run build
pm2 reload ankaa-api-production
pm2 logs ankaa-api-production --lines 50
```

### Test in Staging
```bash
npm run build
pm2 restart ankaa-api-staging
curl http://localhost:3031/api/health
```

### View Real-time Stats
```bash
pm2 monit
# or
watch -n 1 'pm2 status'
```

### Setup Auto-start on Boot
```bash
pm2 startup
pm2 save
```

### Rotate Logs
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

## ⚙️ Environment Variables

### Production (Port 3030)
- `NODE_ENV=production`
- `DATABASE_URL=postgresql://docker:docker@localhost:5432/ankaa`
- `LOG_LEVEL=info`
- `RATE_LIMIT_MAX=100`
- `USE_MOCK_SECULLUM=false`

### Staging (Port 3031)
- `NODE_ENV=staging`
- `DATABASE_URL=postgresql://docker:docker@localhost:5432/ankaa_staging`
- `LOG_LEVEL=debug`
- `DISABLE_RATE_LIMITING=true`
- `USE_MOCK_SECULLUM=true`

## 🎯 Key Differences

| Feature | Production | Staging |
|---------|-----------|---------|
| Port | 3030 | 3031 |
| Database | `ankaa` | `ankaa_staging` |
| Memory Limit | 1GB | 512MB |
| Watch Mode | Disabled | Enabled |
| Log Level | info | debug |
| Rate Limiting | Enabled | Disabled |
| Mock Secullum | No | Yes |

## 📞 Support

- PM2 Docs: https://pm2.keymetrics.io/
- Check logs: `pm2 logs`
- Validate setup: `./pm2-validate.sh`
- Full guide: `PM2_SETUP.md`
