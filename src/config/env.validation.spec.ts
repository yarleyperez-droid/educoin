import { validarEnv } from './env.validation';

describe('Validacion de variables de entorno', () => {
  it('debe rechazar las variables obligatorias cuando faltan', () => {
    expect(() => validarEnv({})).toThrow(
      'Configuración de variables de entorno inválida:',
    );
  });

  it('debe aceptar una configuracion completa y valida', () => {
    const config = {
      DATABASE_URL: 'postgresql://user:password@localhost:5432/educoin',
      JWT_ACCESS_SECRET: 'access-secret-test',
      JWT_REFRESH_SECRET: 'refresh-secret-test',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      PORT: '3000',
      FRONTEND_URL: 'http://localhost:3001',
      UPLOAD_MAX_BYTES: '5242880',
    };

    const result = validarEnv(config);

    expect(result.DATABASE_URL).toBe(config.DATABASE_URL);
    expect(result.PORT).toBe(3000);
    expect(result.UPLOAD_MAX_BYTES).toBe(5242880);
  });

  it('debe rechazar una URL de base de datos invalida', () => {
    const config = {
      DATABASE_URL: 'esto-no-es-una-url',
      JWT_ACCESS_SECRET: 'access-secret-test',
      JWT_REFRESH_SECRET: 'refresh-secret-test',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      FRONTEND_URL: 'http://localhost:3001',
      UPLOAD_MAX_BYTES: '5242880',
    };

    expect(() => validarEnv(config)).toThrow(
      'Configuración de variables de entorno inválida:',
    );
  });
});