
import { envSchema } from './env.schema';

export function validate(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => {
        const variable = issue.path.join('.');
        return `${variable}: ${issue.message}`;
      })
      .join('\n');

    throw new Error(`Error en las variables de entorno:\n${errors}`);
  }

  return result.data;
}