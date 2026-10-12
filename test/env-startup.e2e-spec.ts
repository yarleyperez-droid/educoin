import { spawn } from 'node:child_process';
import { join } from 'node:path';

describe('Inicio de la aplicación con variables de entorno', () => {
const appPath = join(process.cwd(), 'dist', 'main.js');

const envValido = {
...process.env,
DATABASE_URL: 'postgresql://user:password@localhost:5432/educoin',
JWT_ACCESS_SECRET: 'test-access-secret',
JWT_REFRESH_SECRET: 'test-refresh-secret',
JWT_ACCESS_EXPIRES_IN: '15m',
JWT_REFRESH_EXPIRES_IN: '7d',
PORT: '3101',
FRONTEND_URL: 'http://localhost:3001',
UPLOAD_MAX_BYTES: '5242880',
};

it('debe rechazar el inicio cuando faltan variables obligatorias', (done) => {
const proceso = spawn(process.execPath, [appPath], {
env: {
...envValido,
DATABASE_URL: '',
JWT_ACCESS_SECRET: '',
JWT_REFRESH_SECRET: '',
},
stdio: ['ignore', 'pipe', 'pipe'],
});

let salida = '';

proceso.stdout.on('data', (dato) => {
  salida += dato.toString();
});

proceso.stderr.on('data', (dato) => {
  salida += dato.toString();
});

proceso.on('error', (error) => {
  done(error);
});

proceso.on('close', (codigo) => {
  expect(codigo).not.toBe(0);
  expect(salida).toContain('Error en las variables de entorno');
  expect(salida).toContain('DATABASE_URL');
  expect(salida).toContain('JWT_ACCESS_SECRET');
  done();
});


});

it('debe iniciar correctamente con variables válidas', (done) => {
const proceso = spawn(process.execPath, [appPath], {
env: envValido,
stdio: ['ignore', 'pipe', 'pipe'],
});

let salida = '';
let terminado = false;

const finalizar = () => {
  if (terminado) return;
  terminado = true;
  proceso.kill();
};

const temporizador = setTimeout(() => {
  finalizar();
}, 5000);

proceso.stdout.on('data', (dato) => {
  salida += dato.toString();

  if (salida.includes('Nest application successfully started')) {
    clearTimeout(temporizador);
    finalizar();
  }
});

proceso.stderr.on('data', (dato) => {
  salida += dato.toString();
});

proceso.on('error', (error) => {
  clearTimeout(temporizador);
  done(error);
});

proceso.on('close', () => {
  clearTimeout(temporizador);
  expect(salida).toContain('Nest application successfully started');
  done();
});


});
});
