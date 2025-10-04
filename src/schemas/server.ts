import { z } from "zod";

// System Service schemas
export const systemServiceSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  status: z.enum(["active", "inactive", "failed", "unknown"]),
  enabled: z.boolean(),
  description: z.string().optional(),
  subState: z.string().optional(),
  memory: z.string().optional(),
  pid: z.string().optional(),
  uptime: z.string().optional(),
});

export const serviceActionSchema = z.object({
  serviceName: z.string(),
});

export const serviceLogsQuerySchema = z.object({
  lines: z.string().optional(),
});

// System User schemas
export const systemUserSchema = z.object({
  username: z.string(),
  uid: z.number(),
  gid: z.number(),
  home: z.string(),
  shell: z.string(),
  fullName: z.string().optional(),
  lastLogin: z.date().optional(),
  status: z.enum(["active", "inactive", "locked"]),
});

export const createUserSchema = z.object({
  username: z.string().min(1, "Nome de usuário é obrigatório").max(32, "Nome de usuário muito longo"),
  fullName: z.string().optional(),
  password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres").optional(),
});

export const setUserPasswordSchema = z.object({
  password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
});

// Shared Folder schemas
export const sharedFolderSchema = z.object({
  name: z.string(),
  path: z.string(),
  permissions: z.string(),
  owner: z.string(),
  group: z.string(),
  size: z.string(),
  lastModified: z.date(),
  webdavPath: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  accessible: z.boolean().optional(),
  accessError: z.string().optional(),
  fileCount: z.number().optional(),
  subdirCount: z.number().optional(),
});

// System Metrics schemas
export const cpuInfoSchema = z.object({
  usage: z.number(),
  loadAverage: z.array(z.number()),
  cores: z.number(),
});

export const memoryInfoSchema = z.object({
  total: z.number(),
  used: z.number(),
  available: z.number(),
  percentage: z.number(),
});

export const diskInfoSchema = z.object({
  total: z.number(),
  used: z.number(),
  available: z.number(),
  percentage: z.number(),
});

export const networkInterfaceSchema = z.object({
  name: z.string(),
  ip: z.string(),
  mac: z.string().optional(),
  rx: z.number(),
  tx: z.number(),
});

export const networkInfoSchema = z.object({
  interfaces: z.array(networkInterfaceSchema),
});

export const systemMetricsSchema = z.object({
  cpu: cpuInfoSchema,
  memory: memoryInfoSchema,
  disk: diskInfoSchema,
  network: networkInfoSchema,
  uptime: z.number(),
  hostname: z.string(),
});

// System Status schema
export const systemHealthSchema = z.object({
  overall: z.enum(["healthy", "warning", "critical"]),
  services: z.object({
    healthy: z.number(),
    total: z.number(),
    critical: z.array(systemServiceSchema),
  }),
  resources: z.object({
    cpu: z.number(),
    memory: z.number(),
    disk: z.number(),
  }),
  uptime: z.number(),
  hostname: z.string(),
});

// Response schemas following Ankaa patterns
export const systemServiceResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(systemServiceSchema),
});

export const systemMetricsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: systemMetricsSchema,
});

export const systemUsersResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(systemUserSchema),
});

export const sharedFoldersResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(sharedFolderSchema),
});

export const serviceLogsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.string(),
});

export const systemStatusResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: systemHealthSchema,
});

export const createUserResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    username: z.string(),
    fullName: z.string().optional(),
  }),
});

export const actionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

// Type inference exports
export type SystemService = z.infer<typeof systemServiceSchema>;
export type ServiceAction = z.infer<typeof serviceActionSchema>;
export type ServiceLogsQuery = z.infer<typeof serviceLogsQuerySchema>;
export type SystemUser = z.infer<typeof systemUserSchema>;
export type CreateUserFormData = z.infer<typeof createUserSchema>;
export type SetUserPasswordFormData = z.infer<typeof setUserPasswordSchema>;
export type SharedFolder = z.infer<typeof sharedFolderSchema>;
export type CpuInfo = z.infer<typeof cpuInfoSchema>;
export type MemoryInfo = z.infer<typeof memoryInfoSchema>;
export type DiskInfo = z.infer<typeof diskInfoSchema>;
export type NetworkInterface = z.infer<typeof networkInterfaceSchema>;
export type NetworkInfo = z.infer<typeof networkInfoSchema>;
export type SystemMetrics = z.infer<typeof systemMetricsSchema>;
export type SystemHealth = z.infer<typeof systemHealthSchema>;

// Response types
export type SystemServiceResponse = z.infer<typeof systemServiceResponseSchema>;
export type SystemMetricsResponse = z.infer<typeof systemMetricsResponseSchema>;
export type SystemUsersResponse = z.infer<typeof systemUsersResponseSchema>;
export type SharedFoldersResponse = z.infer<typeof sharedFoldersResponseSchema>;
export type ServiceLogsResponse = z.infer<typeof serviceLogsResponseSchema>;
export type SystemStatusResponse = z.infer<typeof systemStatusResponseSchema>;
export type CreateUserResponse = z.infer<typeof createUserResponseSchema>;
export type ActionResponse = z.infer<typeof actionResponseSchema>;
