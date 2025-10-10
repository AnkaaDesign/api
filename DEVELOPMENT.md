# Development Environment Setup

## File Upload Configuration

The system supports both production WebDAV file storage and local development storage.

### Production Setup (with WebDAV)

In production, files are stored on a WebDAV server at `/srv/webdav`:

```bash
# .env or .env.production
WEBDAV_ROOT="/srv/webdav"
WEBDAV_BASE_URL="https://arquivos.ankaa.live"
USE_WEBDAV="true"
```

### Development Setup (Local Storage)

In development, you don't need a WebDAV server. Files are stored locally in `./uploads/webdav`:

```bash
# .env.development
# Comment out or remove WEBDAV_ROOT to use local storage
# WEBDAV_ROOT="/srv/webdav"  # <- Comment this out
WEBDAV_BASE_URL="http://localhost:3030"
USE_WEBDAV="true"
UPLOAD_DIR="./uploads"
```

#### How It Works

1. **Without WEBDAV_ROOT set**: Files are stored in `./uploads/webdav/` with the same directory structure as production
2. **File paths generated**: The system generates the same paths as production (e.g., `Logos/Fornecedores/CompanyName/logo.png`)
3. **Local directory creation**: The `uploads/webdav/` directory and subdirectories are created automatically
4. **Thumbnail generation**: Works the same way as production

#### Directory Structure in Development

```
./uploads/
├── webdav/                    # Simulates /srv/webdav in production
│   ├── Logos/
│   │   ├── Clientes/
│   │   └── Fornecedores/
│   ├── Projetos/
│   ├── Orcamentos/
│   ├── NFs/
│   ├── Comprovantes/
│   └── ...
└── thumbnails/                # Thumbnail cache
```

### Starting Development

1. **Copy the development environment file:**
   ```bash
   cp .env.development .env
   ```

2. **Update DATABASE_URL and other required variables:**
   ```bash
   DATABASE_URL="postgresql://user:pass@localhost:5432/ankaa_dev"
   JWT_SECRET="your-development-secret-at-least-32-chars"
   ```

3. **Ensure WEBDAV_ROOT is commented out or not set:**
   ```bash
   # WEBDAV_ROOT="/srv/webdav"  # <- Should be commented out
   ```

4. **Run the application:**
   ```bash
   npm run start:dev
   ```

5. **Files will be stored locally in:**
   ```
   ./uploads/webdav/
   ```

### File Access in Development

Files are served through the API at:
- **File URL**: `http://localhost:3030/api/files/{fileId}`
- **Thumbnail URL**: `http://localhost:3030/api/files/thumbnail/{fileId}`

The system automatically detects whether files are in WebDAV or local uploads and serves them accordingly.

### Switching Between Environments

#### Development → Production

1. Set `WEBDAV_ROOT` in `.env`:
   ```bash
   WEBDAV_ROOT="/srv/webdav"
   WEBDAV_BASE_URL="https://arquivos.ankaa.live"
   ```

2. Ensure `/srv/webdav` exists and is writable

#### Production → Development

1. Comment out `WEBDAV_ROOT` in `.env`:
   ```bash
   # WEBDAV_ROOT="/srv/webdav"
   ```

2. Files will now be stored in `./uploads/webdav/`

### Troubleshooting

#### Files not uploading in development

**Problem**: Upload fails with "Failed to move file to WebDAV"

**Solution**:
- Ensure `WEBDAV_ROOT` is not set or commented out in `.env`
- Check that the `./uploads` directory is writable
- The system will automatically create subdirectories

#### Thumbnails not generating

**Problem**: Thumbnails fail to generate in development

**Solution**:
- Ensure ImageMagick is installed: `sudo apt-get install imagemagick`
- Check that `./uploads/thumbnails` directory exists and is writable
- For PDFs, ensure Ghostscript is installed: `sudo apt-get install ghostscript`

#### Different file paths between dev and production

**Issue**: File paths differ between environments

**Solution**:
- The system uses the same directory structure in both environments
- In development: `./uploads/webdav/Logos/...`
- In production: `/srv/webdav/Logos/...`
- The relative path structure is identical

### Environment Variables Reference

| Variable | Development | Production | Description |
|----------|------------|------------|-------------|
| `WEBDAV_ROOT` | Not set or `./uploads/webdav` | `/srv/webdav` | Root directory for file storage |
| `WEBDAV_BASE_URL` | `http://localhost:3030` | `https://arquivos.ankaa.live` | Public URL for file access |
| `UPLOAD_DIR` | `./uploads` | `./uploads` | Temporary upload directory |
| `USE_WEBDAV` | `true` | `true` | Enable WebDAV integration |

### Best Practices

1. **Never commit `.env` files** - Use `.env.example` or `.env.development` as templates
2. **Keep the same directory structure** - Ensures consistency between environments
3. **Test file uploads locally** - Verify everything works before deploying
4. **Use environment-specific URLs** - Different base URLs for dev/staging/prod
