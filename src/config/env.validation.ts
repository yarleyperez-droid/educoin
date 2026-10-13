import { z } from 'zod';

// Variables de entorno permitidas y validadas al arrancar (AGENTS.md §13).
// Cualquier valor ausente o inválido detiene el arranque con un mensaje claro.
const esquemaEnv = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url(),
  JWT_ACCESS_SECRET: z.string().trim().min(16),
  JWT_REFRESH_SECRET: z.string().trim().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().trim().min(1).default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().trim().min(1).default('7d'),
  FRONTEND_URL: z.url().default('http://localhost:3001'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().optional(),
  NEXT_PUBLIC_API_URL: z.string().trim().min(1).optional(),
});

export type Env = z.infer<typeof esquemaEnv>;

export function validarEnv(config: Record<string, unknown>): Env {
  // Ignora claves vacías para que los defaults del esquema apliquen.
  const depurado = Object.fromEntries(
    Object.entries(config).filter(
      ([, valor]) => typeof valor === 'string' && valor.trim() !== '',
    ),
  );

  const resultado = esquemaEnv.safeParse(depurado);
  if (!resultado.success) {
    const detalles = resultado.error.issues
      .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Configuración de variables de entorno inválida:\n${detalles}`,
    );
  }
  return resultado.data;
}
