require('dotenv/config');

const { Pool } = require('pg');

module.exports = async () => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'La preparacion E2E solo puede ejecutarse en modo test.',
    );
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'No se encontro DATABASE_URL. Revisa el archivo .env.',
    );
  }

  const databaseUrl = new URL(connectionString);
  const databaseName = decodeURIComponent(
    databaseUrl.pathname.replace(/^\//, ''),
  );

  const hostsPermitidos = ['localhost', '127.0.0.1', '::1'];
  const basesPermitidas = ['educoin', 'educoins'];

  if (
    !hostsPermitidos.includes(databaseUrl.hostname) ||
    !basesPermitidas.includes(databaseName)
  ) {
    throw new Error(
      'Base de datos no permitida para las pruebas E2E. Se cancelo la preparacion.',
    );
  }

  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
  });

  try {
    await pool.query(
      'UPDATE users SET must_change_password = FALSE',
    );

    console.log('Preparacion E2E completada correctamente.');
  } catch (error) {
    console.error(
      'No fue posible preparar la base E2E:',
      error.message,
    );
    throw error;
  } finally {
    await pool.end();
  }
};
