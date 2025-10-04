# Robust Parallel Thumbnail Generation System

This module provides a comprehensive, queue-based thumbnail generation system
for the Ankaa API that supports images, videos, PDFs, and EPS files with
parallel processing, retry mechanisms, and progress tracking.

## Features

### ✅ File Type Support

- **Images**: JPG, PNG, WebP, GIF, BMP, TIFF, SVG
- **Videos**: MP4, AVI, MOV, WMV, FLV, WebM, MKV, M4V, 3GP
- **Documents**: PDF, EPS/PostScript files

### ✅ Queue-Based Processing

- **Bull Queue**: Redis-backed job queue for reliability
- **Parallel Processing**: Configurable concurrency (default: 2 workers)
- **Priority System**: High/Normal/Low priority based on file type
- **Automatic Retry**: Exponential backoff for failed jobs

### ✅ Progress Tracking

- **Real-time Progress**: Job progress updates during processing
- **Database Tracking**: Persistent job status in `thumbnail_jobs` table
- **Monitoring API**: RESTful endpoints for queue management

### ✅ Error Handling & Resilience

- **Timeout Protection**: Configurable timeouts per job type
- **Cleanup on Failure**: Automatic removal of partial thumbnails
- **Stalled Job Recovery**: Automatic detection and recovery
- **Tool Availability Checks**: Graceful fallback when tools missing

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   File Service  │───▶│ Thumbnail Queue │───▶│   Processors    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │                        │
                              ▼                        ▼
                       ┌─────────────┐        ┌─────────────────┐
                       │    Redis    │        │  Thumbnail      │
                       │   Storage   │        │  Generation     │
                       └─────────────┘        └─────────────────┘
                              │                        │
                              ▼                        ▼
                       ┌─────────────┐        ┌─────────────────┐
                       │  Job Status │        │   File System   │
                       │  Database   │        │   & Database    │
                       └─────────────┘        └─────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
npm install bull @nestjs/bull @types/bull fluent-ffmpeg @types/fluent-ffmpeg
```

### 2. Install System Dependencies

**macOS:**

```bash
brew install redis ffmpeg imagemagick ghostscript
# Optional: inkscape for better SVG support
brew install inkscape
```

**Ubuntu/Debian:**

```bash
sudo apt-get update
sudo apt-get install redis-server ffmpeg imagemagick ghostscript
# Optional: inkscape for better SVG support
sudo apt-get install inkscape
```

### 3. Configure Environment Variables

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Thumbnail Queue Settings
THUMBNAIL_CONCURRENCY=2
THUMBNAIL_TIMEOUT=60000
THUMBNAIL_MAX_RETRIES=3
THUMBNAIL_RETRY_DELAY=2000

# Tool Paths (optional, auto-detected)
FFMPEG_PATH=/usr/local/bin/ffmpeg
GHOSTSCRIPT_PATH=/opt/homebrew/bin/gs
```

### 4. Run Database Migration

The system requires a `thumbnail_jobs` table to track job status:

```sql
CREATE TABLE thumbnail_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID UNIQUE NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    job_id VARCHAR,
    status VARCHAR NOT NULL,
    error TEXT,
    progress INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);
```

## Usage

### Automatic Thumbnail Generation

Thumbnails are automatically queued when files are uploaded:

```typescript
// File upload automatically triggers thumbnail generation
const response = await fileService.createFromUpload(uploadedFile);
// Thumbnail generation happens in background
```

### Manual Thumbnail Regeneration

```typescript
// Regenerate thumbnail with high priority
const response = await fileService.regenerateThumbnail(fileId, userId);
```

### Monitoring & Management

```typescript
// Get queue statistics
GET /api/thumbnails/queue/stats
// Response: { active: 2, waiting: 5, completed: 100, failed: 3 }

// Get job status for specific file
GET /api/thumbnails/job/:fileId/status
// Response: { status: 'processing', progress: 65, jobId: 'job_123' }

// Retry failed job
POST /api/thumbnails/job/:fileId/retry

// Pause/Resume queue
POST /api/thumbnails/queue/pause
POST /api/thumbnails/queue/resume

// Clean old jobs
POST /api/thumbnails/queue/clean?type=completed&olderThan=86400000
```

## Configuration

### Queue Configuration

```typescript
// Modify in thumbnail-queue.module.ts
BullModule.registerQueue({
  name: 'thumbnail-generation',
  redis: { ... },
  defaultJobOptions: {
    removeOnComplete: 10,    // Keep 10 completed jobs
    removeOnFail: 50,        // Keep 50 failed jobs
    attempts: 3,             // Retry up to 3 times
    backoff: {
      type: 'exponential',
      delay: 2000,           // Start with 2s delay
    },
  },
})
```

### Priority System

The system automatically assigns priority based on file type:

- **High Priority**: Regular images (JPG, PNG, WebP) - fast to process
- **Normal Priority**: PDFs, EPS files - medium complexity
- **Low Priority**: Videos - slow to process, resource intensive

### Thumbnail Sizes

Default sizes generated:

- **Small**: 150x150px
- **Medium**: 300x300px
- **Large**: 600x600px

## Processing Details

### Image Processing (Sharp)

- **Format**: WebP for optimal compression
- **Quality**: 85% for good balance of size/quality
- **Fit**: `contain` to preserve aspect ratio
- **Background**: White for transparent images

### Video Processing (FFmpeg)

- **Frame Extraction**: At 10% of video duration
- **Resolution**: High-res extraction (2x target size)
- **Post-processing**: Sharp optimization to target size
- **Format**: JPEG for video thumbnails

### PDF Processing (ImageMagick/Ghostscript)

- **Page**: First page only
- **DPI**: 300 DPI for crisp text
- **Background**: White background
- **Optimization**: Sharp post-processing

### EPS Processing (Ghostscript/ImageMagick)

- **Vector Handling**: Maintains vector quality during rasterization
- **Timeout Protection**: 30-second timeout to prevent hanging
- **Fallback Chain**: Ghostscript → ImageMagick → Error
- **Background**: White background for consistent appearance

## Error Handling

### Retry Logic

- **Exponential Backoff**: 2s → 4s → 8s delays
- **Max Attempts**: 3 retries by default
- **Stalled Detection**: 30-second stall detection
- **Job Recovery**: Automatic restart of stalled jobs

### Cleanup on Failure

- **Partial Files**: Automatic removal of incomplete thumbnails
- **Temp Files**: Cleanup of processing intermediates
- **Database Consistency**: Failed jobs marked in database

### Graceful Degradation

- **Missing Tools**: Logs warnings, continues with available tools
- **File Access Issues**: Detailed error logging with file paths
- **Memory Issues**: Timeout protection prevents system overload

## Performance Tuning

### Concurrency Settings

```env
# Increase for more powerful servers
THUMBNAIL_CONCURRENCY=4

# Adjust timeout for large files
THUMBNAIL_TIMEOUT=120000  # 2 minutes
```

### Memory Optimization

- **Stream Processing**: Sharp uses streaming for large images
- **Temp File Cleanup**: Immediate cleanup of intermediate files
- **Queue Limits**: Built-in limits prevent memory overflow

### Redis Optimization

```env
# Use separate Redis DB for queues
REDIS_DB=1

# Configure Redis memory limits
# redis.conf: maxmemory 1gb
# redis.conf: maxmemory-policy allkeys-lru
```

## Monitoring & Logging

### Queue Dashboard

Access the Bull Dashboard for visual queue monitoring:

```typescript
// Add to app module for development
import { ExpressAdapter } from '@bull-board/express';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { createBullBoard } from '@bull-board/api';
```

### Logging

The system provides comprehensive logging:

- **Job Start/Complete**: Processing time tracking
- **Error Details**: Full error context and stack traces
- **Tool Availability**: Startup tool detection results
- **Progress Updates**: Real-time job progress

### Metrics

Track these key metrics:

- **Processing Time**: Average thumbnail generation time
- **Success Rate**: Percentage of successful generations
- **Queue Depth**: Number of pending jobs
- **Error Rate**: Failures by file type

## Troubleshooting

### Common Issues

**Redis Connection Failed**

```bash
# Check Redis is running
redis-cli ping

# Check connection
redis-cli -h localhost -p 6379 ping
```

**FFmpeg Not Found**

```bash
# Install FFmpeg
brew install ffmpeg  # macOS
apt install ffmpeg    # Ubuntu

# Or set custom path
export FFMPEG_PATH=/usr/local/bin/ffmpeg
```

**Ghostscript Permission Issues**

```bash
# Fix Ghostscript security policy (common on ImageMagick 7)
sudo vim /etc/ImageMagick-6/policy.xml
# Comment out or modify the PDF policy line
```

**High Memory Usage**

```bash
# Reduce concurrency
THUMBNAIL_CONCURRENCY=1

# Increase timeout for large files
THUMBNAIL_TIMEOUT=300000
```

### Debug Mode

Enable detailed logging:

```env
LOG_LEVEL=debug
THUMBNAIL_DEBUG=true
```

## API Reference

### ThumbnailQueueService

```typescript
// Add job to queue
addThumbnailJob(data: ThumbnailJobData): Promise<Job>

// Get job status
getJobStatus(fileId: string): Promise<JobStatus>

// Retry failed job
retryThumbnailJob(fileId: string): Promise<Job>

// Queue management
pauseQueue(): Promise<void>
resumeQueue(): Promise<void>
getQueueStats(): Promise<QueueStats>
```

### ThumbnailProcessorService

```typescript
// Main processing entry point
@Process('generate-thumbnail')
processThumbnailGeneration(job: Job<ThumbnailJobData>): Promise<ThumbnailJobResult>
```

### FileService Integration

```typescript
// Queue thumbnail generation (called automatically)
private queueThumbnailGeneration(file: File): Promise<void>

// Manual regeneration
regenerateThumbnail(id: string, userId?: string): Promise<FileUpdateResponse>
```

## Security Considerations

### File Validation

- **MIME Type Checking**: Strict MIME type validation
- **File Size Limits**: Configurable maximum file sizes
- **Path Traversal Protection**: Secure file path handling

### Command Injection Prevention

- **Shell Escaping**: Proper escaping of file paths
- **Timeout Protection**: Prevents resource exhaustion
- **Tool Path Validation**: Validates external tool paths

### Access Control

- **Authentication Required**: All monitoring endpoints require auth
- **File Access Control**: Respects existing file permissions
- **Error Message Sanitization**: No sensitive data in error responses

## Contributing

### Adding New File Types

1. **Update Configuration**:

```typescript
// Add to supportedTypes in thumbnail.config.ts
supportedTypes: {
  newCategory: ['mime/type1', 'mime/type2'];
}
```

2. **Add Processor**:

```typescript
// Add method in thumbnail-processor.service.ts
private async processNewFileType(job: Job, ...): Promise<any> {
  // Implementation
}
```

3. **Update Router**:

```typescript
// Add routing logic in processThumbnailGeneration
else if (this.isNewFileType(mimetype)) {
  result = await this.processNewFileType(job, ...);
}
```

### Testing

```bash
# Unit tests
npm run test thumbnail

# Integration tests
npm run test:e2e thumbnail

# Load testing
npm run test:load thumbnail
```

## License

This thumbnail generation system is part of the Ankaa project and follows the
same license terms.

---

## Quick Reference

### Environment Variables

```env
REDIS_HOST=localhost
REDIS_PORT=6379
THUMBNAIL_CONCURRENCY=2
THUMBNAIL_TIMEOUT=60000
FFMPEG_PATH=/usr/local/bin/ffmpeg
```

### Important Files

- `thumbnail-queue.service.ts` - Queue management
- `thumbnail-processor.service.ts` - Job processing
- `thumbnail-monitoring.controller.ts` - REST API
- `file.service.ts` - Integration with file uploads
- `config/thumbnail.config.ts` - Configuration

### API Endpoints

- `GET /api/thumbnails/queue/stats` - Queue statistics
- `GET /api/thumbnails/job/:fileId/status` - Job status
- `POST /api/thumbnails/job/:fileId/retry` - Retry job
- `POST /api/thumbnails/queue/pause` - Pause queue
- `POST /api/thumbnails/queue/resume` - Resume queue
