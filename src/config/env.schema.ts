
import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL debe ser una URL valida'),

  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET es obligatorio'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET es obligatorio'),

  JWT_ACCESS_EXPIRES_IN: z.string().min(1, 'JWT_ACCESS_EXPIRES_IN es obligatorio'),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1, 'JWT_REFRESH_EXPIRES_IN es obligatorio'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  FRONTEND_URL: z.string().min(1, 'FRONTEND_URL es obligatoria'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive(),
});

export type Env = z.infer<typeof envSchema>;
