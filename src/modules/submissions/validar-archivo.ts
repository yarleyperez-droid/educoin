import { randomUUID } from 'node:crypto';

/**
 * Validación de ARCHIVOS adjuntos a las entregas (preguntas de tipo
 * `file`): tipos permitidos por CONTENIDO real (magic bytes, no por
 * extensión) y nombre interno generado por el servidor.
 *
 * Reglas (AGENTS.md §9.6 y docs/flujo_entregas.md §4):
 * - Solo `application/pdf`, `image/jpeg` e `image/png`; cualquier otra
 *   cosa responde 415 con mensaje en español.
 * - El nombre en disco lo genera el servidor (UUID + extensión del
 *   MIME detectado): el nombre original del estudiante NUNCA se usa,
 *   ni en disco ni en la BD.
 * - En la BD (submissions.answers[].files[], docs/plataforma_educativa_bd.md
 *   §6) solo vive la metadata: `{ path, mime, bytes }` con la ruta
 *   RELATIVA al almacén en disco:
 *   `{actividadId}/{inscripcionId}/{uuid}.{ext}` — el prefijo identifica
 *   al dueño de la entrega y es la barrera anti-IDOR al volver a
 *   referenciar el archivo desde PUT/POST.
 *
 * Funciones PURAS, sin BD y sin Nest: los mensajes se exportan para que
 * Service, filtro de multer y pruebas compartan el texto exacto (mismo
 * patrón que los MENSAJE_* de submissions.service.ts).
 */

/** MIME permitidos (AGENTS.md §9.6): PDF, JPG y PNG. */
export const MIMES_PERMITIDOS = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type MimePermitido = (typeof MIMES_PERMITIDOS)[number];

/** Tope de archivos por pregunta file (constante del equipo). */
export const MAX_ARCHIVOS_POR_PREGUNTA = 3;

/** Nombre del campo multipart que transporta los archivos. */
export const CAMPO_ARCHIVOS = 'archivos';

/** Extensión del nombre interno según el MIME detectado. */
export const EXTENSION_POR_MIME: Record<MimePermitido, 'pdf' | 'jpg' | 'png'> =
  {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
  };

/** MIME según la extensión del nombre interno (inverso del anterior). */
export const MIME_POR_EXTENSION: Readonly<Record<string, MimePermitido>> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
};

/** Firmas binarias (magic bytes) de los tres tipos permitidos. */
const FIRMA_PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // '%PDF-'
const FIRMA_JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Detecta el MIME REAL de un archivo por su contenido (magic bytes):
 * no confía en la extensión ni en el Content-Type declarados por el
 * cliente (AGENTS.md §9.6). Devuelve null cuando el contenido no es
 * PDF, JPG ni PNG — un archivo renombrado no pasa por su nombre.
 */
export function detectarMimeReal(contenido: Buffer): MimePermitido | null {
  if (contenido.subarray(0, FIRMA_PDF.length).equals(FIRMA_PDF)) {
    return 'application/pdf';
  }
  if (contenido.subarray(0, FIRMA_JPEG.length).equals(FIRMA_JPEG)) {
    return 'image/jpeg';
  }
  if (contenido.subarray(0, FIRMA_PNG.length).equals(FIRMA_PNG)) {
    return 'image/png';
  }
  return null;
}

/**
 * Nombre INTERNO del archivo en disco: UUID v4 + extensión del MIME
 * detectado (AGENTS.md §9.6). El nombre original del estudiante jamás
 * se usa: el archivo no se guarda con el nombre que tenía al subirlo.
 */
export function nombreArchivoInterno(mime: MimePermitido): string {
  return `${randomUUID()}.${EXTENSION_POR_MIME[mime]}`;
}

/**
 * Ruta relativa (separadores POSIX: portable dentro del JSONB) de un
 * archivo subido: `{actividadId}/{inscripcionId}/{uuid}.{ext}`. El
 * prefijo actividad/inscripción ES la propiedad del archivo: al validar
 * una respuesta que lo referencia, una ruta de otra entrega no pasa
 * (anti-IDOR) aunque el UUID se conociera.
 */
export const RUTA_ARCHIVO_REGEX =
  /^[1-9]\d*\/[1-9]\d*\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:pdf|jpg|png)$/;

/**
 * Archivo multipart tal como lo entrega multer con MemoryStorage: del
 * original SOLO interesa el contenido (el nombre del estudiante no se
 * usa para nada, §9.6).
 */
export interface ArchivoSubido {
  buffer: Buffer;
}

/** 415: el contenido del archivo no es de un tipo permitido. */
export const MENSAJE_MIME_INVALIDO =
  'El archivo no es de un tipo permitido: solo se aceptan PDF, JPG y PNG (el tipo se valida por el contenido real del archivo, no por su nombre o extensión).';

/** 413: supera UPLOAD_MAX_BYTES. Comparten el filtro de multer y el Service. */
export const MENSAJE_ARCHIVO_DEMASIADO_GRANDE =
  'El archivo supera el tamaño máximo permitido por la plataforma.';

/** 400: multipart sin ningún archivo. */
export const MENSAJE_SIN_ARCHIVOS =
  'No se envió ningún archivo: adjunta al menos un archivo PDF, JPG o PNG.';

/** 400: la pregunta existe pero no es de tipo file. */
export const MENSAJE_PREGUNTA_NO_ES_FILE =
  'Los archivos solo se pueden adjuntar a preguntas de tipo file.';

/** Éxito de POST /activities/:id/submissions/archivos. */
export const MENSAJE_ARCHIVOS_ADJUNTADOS =
  'Archivos adjuntados: quedan guardados en el borrador de la entrega hasta que la envíes.';

/** 400: la respuesta referencia un archivo de OTRA entrega (anti-IDOR). */
export const MENSAJE_ARCHIVO_AJENO =
  'La respuesta referencia un archivo que no pertenece a tu entrega de esta actividad.';

/** 400: el archivo referenciado ya no existe en el almacén. */
export const MENSAJE_ARCHIVO_NO_DISPONIBLE =
  'La respuesta referencia un archivo que ya no está disponible.';

/** 400: la metadata declarada no coincide con el archivo guardado. */
export const MENSAJE_ARCHIVO_INCONSISTENTE =
  'La respuesta referencia un archivo cuyo tipo o tamaño no coincide con el archivo guardado.';
