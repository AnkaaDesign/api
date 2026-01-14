# Artwork Approval System Implementation

## Overview

This document describes the implementation of an artwork approval system that allows COMMERCIAL and ADMIN users to approve or reprove artworks associated with tasks.

## Key Features

1. **Permission-Based Approval**: Only users with COMMERCIAL or ADMIN roles can change artwork status
2. **Status Tracking**: Each artwork can have one of three statuses:
   - `DRAFT` - Default for new uploads (needs review)
   - `APPROVED` - Artwork approved for use
   - `REPROVED` - Artwork rejected/needs changes

3. **Default Behavior**: All new artwork uploads default to DRAFT status
4. **Backward Compatibility**: System maintains file IDs in frontend while managing Artwork entities in backend

## Backend Implementation

### 1. Schema Changes (`/api/src/schemas/task.ts`)

Added `artworkStatuses` field to both CREATE and UPDATE schemas:

```typescript
artworkStatuses: z
  .record(
    z.string().uuid(),
    z.enum(['DRAFT', 'APPROVED', 'REPROVED'], {
      errorMap: () => ({ message: 'Status de artwork inválido' }),
    }),
  )
  .optional(),
```

**Purpose**: Maps File ID → artwork status for approval workflow

Updated `mapTaskToFormData` helper (lines 1955-1961):
```typescript
artworkStatuses: task.artworks?.reduce((acc, artwork) => {
  const fileId = artwork.fileId || (artwork as any).file?.id;
  if (fileId && artwork.status) {
    acc[fileId] = artwork.status as 'DRAFT' | 'APPROVED' | 'REPROVED';
  }
  return acc;
}, {} as Record<string, 'DRAFT' | 'APPROVED' | 'REPROVED'>),
```

### 2. Service Changes (`/api/src/modules/production/task/task.service.ts`)

#### Permission Checking (lines 82-89)

```typescript
private canApproveArtworks(userRole?: string): boolean {
  const allowedRoles = [SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.ADMIN];
  return userRole ? allowedRoles.includes(userRole as any) : false;
}
```

#### Updated `convertFileIdsToArtworkIds` (lines 102-174)

**New Signature**:
```typescript
private async convertFileIdsToArtworkIds(
  fileIds: string[],
  taskId?: string | null,
  airbrushingId?: string | null,
  artworkStatuses?: Record<string, 'DRAFT' | 'APPROVED' | 'REPROVED'>,
  userRole?: string,
  tx?: PrismaTransaction,
): Promise<string[]>
```

**Key Logic**:
```typescript
// When creating new Artwork
if (!artwork) {
  const requestedStatus = artworkStatuses?.[fileId];
  const status = requestedStatus || 'DRAFT';

  // Check permissions if trying to set APPROVED/REPROVED
  if (status !== 'DRAFT' && !this.canApproveArtworks(userRole)) {
    this.logger.warn(`User without permission tried to set status ${status}. Using DRAFT.`);
    // Force DRAFT if user doesn't have permission
    artwork = await prisma.artwork.create({ /* ... with DRAFT status */ });
  } else {
    // User has permission or status is DRAFT
    artwork = await prisma.artwork.create({ /* ... with requested status */ });
  }
}

// When updating existing Artwork status
else if (requestedStatus && artwork.status !== requestedStatus) {
  if (!this.canApproveArtworks(userRole)) {
    this.logger.warn(`User without permission tried to change status. Ignoring.`);
  } else {
    artwork = await prisma.artwork.update({ /* ... update status */ });
  }
}
```

#### Updated `createArtworkForFile` (lines 188-211)

**New Signature**:
```typescript
private async createArtworkForFile(
  fileRecord: { id: string },
  taskId?: string | null,
  airbrushingId?: string | null,
  status: 'DRAFT' | 'APPROVED' | 'REPROVED' = 'DRAFT',
  tx?: PrismaTransaction,
): Promise<string>
```

**Default**: All new uploads create Artwork with DRAFT status

#### Task Update Method (lines 1656-1720)

Extracts and passes artworkStatuses:
```typescript
const artworkStatuses = (data as any).artworkStatuses;

// Convert existing File IDs with status updates
const existingArtworkIds = await this.convertFileIdsToArtworkIds(
  fileIdsFromRequest,
  id,
  null,
  artworkStatuses,  // Pass status map
  userPrivilege,    // Pass user role for permission check
  tx,
);

// Create new uploads with DRAFT status (or from artworkStatuses if provided)
const newFileStatus = (artworkStatuses?.[fileRecord.id] || 'DRAFT') as 'DRAFT' | 'APPROVED' | 'REPROVED';
const artworkEntityId = await this.createArtworkForFile(
  fileRecord,
  id,
  null,
  newFileStatus,
  tx,
);
```

## Frontend Implementation (Required)

### 1. Web Form Status Display (`/web/src/components/production/task/form/task-edit-form.tsx`)

**Add Status Field to File Type**:
```typescript
interface FileWithPreview extends File {
  uploaded?: boolean;
  uploadProgress?: number;
  uploadedFileId?: string;
  thumbnailUrl?: string;
  status?: 'DRAFT' | 'APPROVED' | 'REPROVED'; // NEW
}
```

**Initialize with Status**:
```typescript
const [uploadedFiles, setUploadedFiles] = useState<FileWithPreview[]>(
  (task.artworks || []).map(artwork => {
    const file = (artwork as any).file || artwork;
    return {
      id: file.id,
      name: file.filename || file.name || 'artwork',
      // ... other properties
      status: artwork.status || 'DRAFT', // Extract status from Artwork entity
    } as FileWithPreview;
  })
);

// Track artwork statuses for submission
const [artworkStatuses, setArtworkStatuses] = useState<Record<string, 'DRAFT' | 'APPROVED' | 'REPROVED'>>(
  task.artworks?.reduce((acc, artwork) => {
    const fileId = artwork.fileId || artwork.file?.id;
    if (fileId) {
      acc[fileId] = artwork.status || 'DRAFT';
    }
    return acc;
  }, {} as Record<string, 'DRAFT' | 'APPROVED' | 'REPROVED'>) || {}
);
```

**Status Badge Component** (recommended):
```tsx
import { Badge } from '@/components/ui/badge';

function ArtworkStatusBadge({ status }: { status?: string }) {
  if (!status || status === 'DRAFT') return null;

  const styles = {
    APPROVED: 'bg-green-100 text-green-800',
    REPROVED: 'bg-red-100 text-red-800',
  };

  const labels = {
    APPROVED: 'Aprovado',
    REPROVED: 'Reprovado',
  };

  return (
    <Badge className={styles[status as keyof typeof styles]}>
      {labels[status as keyof typeof labels]}
    </Badge>
  );
}
```

**Status Selector Component** (recommended):
```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';

function ArtworkStatusSelector({
  value,
  onChange,
  disabled
}: {  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { user } = useAuth();

  // Only COMMERCIAL and ADMIN can change status
  const canApprove = user?.role === 'COMMERCIAL' || user?.role === 'ADMIN';

  return (
    <Select
      value={value}
      onValueChange={onChange}
      disabled={disabled || !canApprove}
    >
      <SelectTrigger className="w-[140px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="DRAFT">Rascunho</SelectItem>
        <SelectItem value="APPROVED">Aprovado</SelectItem>
        <SelectItem value="REPROVED">Reprovado</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

**Render in File List**:
```tsx
{uploadedFiles.map((file) => (
  <div key={file.uploadedFileId} className="flex items-center gap-2">
    {/* File preview and name */}
    <div className="flex-1">{file.name}</div>

    {/* Status badge (always visible) */}
    <ArtworkStatusBadge status={file.status} />

    {/* Status selector (only for COMMERCIAL/ADMIN) */}
    <ArtworkStatusSelector
      value={file.status || 'DRAFT'}
      onChange={(newStatus) => {
        // Update file status in state
        setUploadedFiles(prev => prev.map(f =>
          f.uploadedFileId === file.uploadedFileId
            ? { ...f, status: newStatus as any }
            : f
        ));

        // Update artworkStatuses map for submission
        if (file.uploadedFileId) {
          setArtworkStatuses(prev => ({
            ...prev,
            [file.uploadedFileId!]: newStatus as any,
          }));
        }
      }}
    />

    {/* Delete button */}
    <Button onClick={() => handleRemoveFile(file.uploadedFileId)} />
  </div>
))}
```

**Submit Form with Statuses**:
```typescript
const onSubmit = async (values: TaskFormData) => {
  const formData = new FormData();

  // ... other form data

  // Add artworkIds (File IDs)
  values.artworkIds?.forEach(id => formData.append('artworkIds[]', id));

  // Add artworkStatuses map
  formData.append('artworkStatuses', JSON.stringify(artworkStatuses));

  await updateTask(formData);
};
```

### 2. Task Detail Page Status Display

**Show Status Badge Next to Artworks**:
```tsx
<div className="artworks-section">
  <h3>Artworks</h3>
  {task.artworks?.map(artwork => (
    <div key={artwork.id} className="flex items-center gap-2">
      <img src={artwork.file?.thumbnailUrl} alt={artwork.file?.filename} />
      <span>{artwork.file?.filename}</span>
      <ArtworkStatusBadge status={artwork.status} />
    </div>
  ))}
</div>
```

### 3. Constants Definition (`/web/src/constants/enums.ts`)

```typescript
export enum ARTWORK_STATUS {
  DRAFT = "DRAFT",
  APPROVED = "APPROVED",
  REPROVED = "REPROVED",
}

export const ARTWORK_STATUS_LABELS: Record<ARTWORK_STATUS, string> = {
  [ARTWORK_STATUS.DRAFT]: "Rascunho",
  [ARTWORK_STATUS.APPROVED]: "Aprovado",
  [ARTWORK_STATUS.REPROVED]: "Reprovado",
};
```

## API Request/Response Format

### Task Update Request

```typescript
PUT /api/tasks/:id

FormData:
- artworkIds[]: ["file-id-1", "file-id-2", "file-id-3"]  // File IDs to keep
- artworkStatuses: {                                      // Status for each file
    "file-id-1": "APPROVED",
    "file-id-2": "DRAFT",
    "file-id-3": "REPROVED"
  }
- artworks: [File, File]                                  // New files to upload
```

### Task Read Response

```typescript
{
  "data": {
    "id": "task-id",
    "name": "Task Name",
    "artworks": [
      {
        "id": "artwork-entity-id",
        "fileId": "file-id-1",
        "status": "APPROVED",
        "file": {
          "id": "file-id-1",
          "filename": "artwork1.png",
          "thumbnailUrl": "/uploads/...",
          // ... other file properties
        }
      }
    ]
  }
}
```

## Permission Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ User Uploads Artwork                                             │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ├─► Status = DRAFT (default)
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ COMMERCIAL/ADMIN Reviews Artwork                                 │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ├─► Can change to APPROVED
                 ├─► Can change to REPROVED
                 ├─► Can change back to DRAFT
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ Other Users (PRODUCTION, DESIGNER, etc.)                         │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ├─► Can see status badges
                 ├─► Cannot change status
                 ├─► Upload creates DRAFT status
                 │
                 └─► If they try to set APPROVED/REPROVED:
                     Backend automatically changes to DRAFT
```

## Status Badge Styling

Recommended colors:

- **DRAFT**: Gray/neutral (or no badge)
  - `bg-gray-100 text-gray-800`
  - Not urgent, waiting for review

- **APPROVED**: Green (success)
  - `bg-green-100 text-green-800`
  - Ready to use

- **REPROVED**: Red (danger/error)
  - `bg-red-100 text-red-800`
  - Needs revision

## Testing Checklist

### Backend
- [ ] Create task with artwork uploads (should default to DRAFT)
- [ ] Update task artwork status as COMMERCIAL user (should succeed)
- [ ] Update task artwork status as PRODUCTION user (should be ignored, stay DRAFT)
- [ ] Update task artwork status as ADMIN user (should succeed)
- [ ] Create Artwork entity with APPROVED status as non-privileged user (should force DRAFT)
- [ ] API build completes successfully

### Frontend
- [ ] Artwork status badges display correctly in task detail page
- [ ] Status selector is visible only to COMMERCIAL/ADMIN users
- [ ] Status selector works correctly (changes reflected in UI)
- [ ] Form submission includes artworkStatuses
- [ ] Non-privileged users see read-only status badges
- [ ] New uploads show DRAFT badge by default

## Migration Notes

**Existing Artworks**: All existing Artwork entities created before this implementation will have status = `APPROVED` (from schema default). This ensures backward compatibility.

**New Uploads**: From now on, all new artwork uploads will have status = `DRAFT` by default, requiring explicit approval.

## Summary

This implementation provides a complete artwork approval workflow with:
- ✅ Permission-based status changes (COMMERCIAL + ADMIN only)
- ✅ Default DRAFT status for new uploads
- ✅ Backend validation and permission enforcement
- ✅ Frontend status display and editing (implementation required)
- ✅ Backward compatibility with existing code
- ✅ Clear visual indicators for artwork status

The system ensures that artwork quality is controlled by authorized users while maintaining a smooth workflow for all team members.
