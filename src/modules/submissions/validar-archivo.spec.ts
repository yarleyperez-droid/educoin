import {
  EXTENSION_POR_MIME,
  MAX_ARCHIVOS_POR_PREGUNTA,
  MIMES_PERMITIDOS,
  RUTA_ARCHIVO_REGEX,
  detectarMimeReal,
  nombreArchivoInterno,
} from './validar-archivo';

/**
 * Pruebas de la validación de archivos por CONTENIDO (magic bytes) y de
 * la forma de la ruta interna generada por el servidor. Funciones puras:
 * sin BD y sin Nest (mismo patrón que auto-calificacion.spec.ts).
 */

/** Contenido mínimo con la firma de cada tipo permitido. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);

describe('detectarMimeReal (magic bytes, no extensión)', () => {
  it('detecta un PDF por su contenido', () => {
    expect(detectarMimeReal(PDF)).toBe('application/pdf');
  });

  it('detecta un JPG por su contenido', () => {
    expect(detectarMimeReal(JPEG)).toBe('image/jpeg');
  });

  it('detecta un PNG por su contenido', () => {
    expect(detectarMimeReal(PNG)).toBe('image/png');
  });

  it('null para texto plano (aunque se llame .pdf)', () => {
    expect(detectarMimeReal(Buffer.from('solo texto, no un pdf'))).toBeNull();
  });

  it('null para un ejecutable renombrado (MZ de Windows)', () => {
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);
    expect(detectarMimeReal(exe)).toBeNull();
  });

  it('null para contenido vacío o demasiado corto', () => {
    expect(detectarMimeReal(Buffer.alloc(0))).toBeNull();
    expect(detectarMimeReal(Buffer.from('%P'))).toBeNull();
    expect(detectarMimeReal(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('nombreArchivoInterno (el nombre lo genera el servidor)', () => {
  it('es un UUID v4 con la extensión del MIME detectado', () => {
    for (const mime of MIMES_PERMITIDOS) {
      const nombre = nombreArchivoInterno(mime);
      expect(nombre).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|jpg|png)$/,
      );
      expect(nombre.endsWith(`.${EXTENSION_POR_MIME[mime]}`)).toBe(true);
    }
  });

  it('dos llamadas generan nombres distintos', () => {
    expect(nombreArchivoInterno('application/pdf')).not.toBe(
      nombreArchivoInterno('application/pdf'),
    );
  });
});

describe('RUTA_ARCHIVO_REGEX (ruta interna {actividad}/{inscripción}/{uuid}.{ext})', () => {
  it('acepta la ruta que genera el servidor', () => {
    const ruta = `7/1/${nombreArchivoInterno('application/pdf')}`;
    expect(RUTA_ARCHIVO_REGEX.test(ruta)).toBe(true);
  });

  it('acepta ids grandes (BIGINT) en el prefijo', () => {
    const ruta = `9223372036854775807/42/${nombreArchivoInterno('image/png')}`;
    expect(RUTA_ARCHIVO_REGEX.test(ruta)).toBe(true);
  });

  it('rechaza el nombre original del estudiante como ruta', () => {
    expect(RUTA_ARCHIVO_REGEX.test('mi-archivo.pdf')).toBe(false);
    expect(RUTA_ARCHIVO_REGEX.test('7/1/mi-archivo.pdf')).toBe(false);
  });

  it('rechaza escapar del almacén (traversal) o rutas absolutas', () => {
    expect(RUTA_ARCHIVO_REGEX.test('../../etc/passwd')).toBe(false);
    expect(RUTA_ARCHIVO_REGEX.test('7/1/../../config.pdf')).toBe(false);
    expect(RUTA_ARCHIVO_REGEX.test('C:\\data\\archivo.pdf')).toBe(false);
  });

  it('rechaza UUID en mayúsculas, ids con cero inicial o extensión inventada', () => {
    expect(
      RUTA_ARCHIVO_REGEX.test('7/1/AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE.pdf'),
    ).toBe(false);
    expect(
      RUTA_ARCHIVO_REGEX.test('07/1/11111111-1111-4111-8111-111111111111.pdf'),
    ).toBe(false);
    expect(
      RUTA_ARCHIVO_REGEX.test('7/1/11111111-1111-4111-8111-111111111111.exe'),
    ).toBe(false);
  });
});

describe('constantes exportadas', () => {
  it('el máximo de archivos por pregunta es 3', () => {
    expect(MAX_ARCHIVOS_POR_PREGUNTA).toBe(3);
  });

  it('los MIME permitidos son exactamente PDF, JPG y PNG', () => {
    expect(MIMES_PERMITIDOS).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
    ]);
  });
});
