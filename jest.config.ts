import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';
import ts from 'typescript';

// Path aliases (e.g. the ones added by `nest g library`) live in tsconfig.json,
// so they are read from there instead of being duplicated here.
const { config: tsconfig } = ts.readConfigFile(
  './tsconfig.json',
  ts.sys.readFile,
);
const paths = tsconfig?.compilerOptions?.paths ?? {};

/**
 * Configuración de Jest en modo **CommonJS** — resolución del merge entre
 * `main` y `Alejandro` (T5.4.3 / H2.x).
 *
 * Por qué NO modo ESM (que era la rama de `main`):
 * - `@nestjs/common@12` es ESM-only (`"type": "module"`) mientras que
 *   `@nestjs/throttler@6.7.1` se publica en CJS. En un grafo ESM de Jest,
 *   el `require()` de CJS hacia un ESM del mismo grafo lanza
 *   `ERR_REQUIRE_CYCLE_MODULE` ("Cannot require() ES Module … in a cycle"),
 *   que **ninguna versión de Node arregla**: es una limitación del loader.
 *   Eso rompía `auth-throttler.guard.spec.ts` y las 5 suites e2e (la app
 *   completa importa el throttler vía `AuthModule`).
 * - En CJS, `require()` de un ESM aislado sí funciona en Node >= 24.9
 *   (requisito de Jest 30 + Nest 12; `engines.node` lo declara).
 * - Verificado empíricamente tras el merge: con esta config pasan las 11
 *   suites unitarias (ambos autores) y con la ESM solo 6.
 *
 * Por qué se conserva el resto: `moduleNameMapper` (resuelve los
 * especificadores `./archivo.js` del cliente Prisma generado) viene de la
 * rama `Alejandro`, igual que `collectCoverageFrom`.
 */
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '/frontend/', '/dist/'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    // Resuelve especificadores estilo ESM (`.js`) a sus fuentes TypeScript
    // cuando las pruebas corren como CommonJS (cliente Prisma generado).
    '^(\\.{1,2}/.*)\\.js$': '$1',
    ...pathsToModuleNameMapper(paths, { prefix: '<rootDir>/' }),
  },
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    'libs/**/*.(t|j)s',
    'apps/**/*.(t|j)s',
  ],
  coverageDirectory: './coverage',
  /**
   * Piso de cobertura unitaria (H6.3 / T6.3.4): ~1 pp bajo el medido en
   * la implementación (60.98 / 54.44 / 63.12 / 61.64) para no castigar
   * refactorizaciones legítimas, pero hacer fallar al PR que la baje.
   * Se evalúa con `pnpm test:cov` (es lo que corre el CI).
   */
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 53,
      functions: 61,
      lines: 60,
    },
  },
  testEnvironment: 'node',
};

export default config;
