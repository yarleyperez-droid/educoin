import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ArchivoRespuesta } from './dto/respuestas.schema';
import {
  MIME_POR_EXTENSION,
  RUTA_ARCHIVO_REGEX,
  MENSAJE_ARCHIVO_AJENO,
  MENSAJE_ARCHIVO_INCONSISTENTE,
  MENSAJE_ARCHIVO_NO_DISPONIBLE,
  nombreArchivoInterno,
  type MimePermitido,
} from './validar-archivo';

/**
 * Almacén en DISCO LOCAL de los archivos adjuntos de las entregas
 * (decisión del equipo, AGENTS.md §2): dentro de `UPLOAD_DIR` (variable
 * de entorno, gitignored) la ruta de cada archivo es
 * `{actividadId}/{inscripcionId}/{uuid}.{ext}`.
 *
 * El prefijo actividad/inscripción es la PROPIEDAD del archivo: un
 * estudiante solo puede referenciar (PUT/POST) y descargar archivos de
 * su propia inscripción en esa actividad — una ruta ajena no pasa la
 * verificación aunque su UUID se conociera (anti-IDOR, AGENTS.md §9.6/§9.7).
 *
 * El nombre en disco lo genera el servidor (UUID + extensión del MIME
 * detectado): el nombre original del estudiante jamás se guarda.
 *
 * En la BD (submissions.answers[].files[]) solo vive la metadata
 * `{ path, mime, bytes }` con la ruta RELATIVA al almacén.
 */

/** Valores por defecto si la config no los trae (env.validation ya los valida). */
export const UPLOAD_MAX_BYTES_DEFAULT = 10_485_760; // 10 MB
export const UPLOAD_DIR_DEFAULT = '.data/uploads';

@Injectable()
export class ArchivosService {
  constructor(private readonly config: ConfigService) {}

  /** Tamaño máximo por archivo (UPLOAD_MAX_BYTES, 10 MB por defecto). */
  limiteBytes(): number {
    return (
      this.config.get<number>('UPLOAD_MAX_BYTES') ?? UPLOAD_MAX_BYTES_DEFAULT
    );
  }

  /** Carpeta raíz del almacén (UPLOAD_DIR, relativa al proceso). */
  carpetaArchivos(): string {
    return this.config.get<string>('UPLOAD_DIR') ?? UPLOAD_DIR_DEFAULT;
  }

  /**
   * Guarda el contenido validado en disco con nombre INTERNO (UUID) y
   * devuelve la metadata tal como vivirá en `answers[].files[]`. La
   * carpeta por actividad/inscripción se crea bajo demanda.
   */
  async guardar(
    actividadId: bigint,
    inscripcionId: bigint,
    contenido: Buffer,
    mime: MimePermitido,
  ): Promise<ArchivoRespuesta> {
    const rutaRelativa = `${actividadId}/${inscripcionId}/${nombreArchivoInterno(mime)}`;
    const rutaAbsoluta = join(this.carpetaArchivos(), rutaRelativa);

    await mkdir(dirname(rutaAbsoluta), { recursive: true });
    await writeFile(rutaAbsoluta, contenido);

    return { path: rutaRelativa, mime, bytes: contenido.length };
  }

  /**
   * Verifica que una referencia de archivo (respuestas de PUT/POST)
   * apunte a un archivo REAL y del propio estudiante:
   * 1. Formato de la ruta interna (la que genera el servidor).
   * 2. Prefijo de la propia actividad/inscripción (anti-IDOR).
   * 3. Existencia del archivo en el almacén.
   * 4. Consistencia: el tamaño declarado y el MIME coinciden con lo
   *    que hay en disco (el nombre interno lleva la extensión del MIME).
   *
   * Cualquier fallo es un 400 en español: la referencia no es válida.
   */
  async verificar(
    actividadId: bigint,
    inscripcionId: bigint,
    archivo: ArchivoRespuesta,
  ): Promise<void> {
    if (!RUTA_ARCHIVO_REGEX.test(archivo.path)) {
      throw new BadRequestException(MENSAJE_ARCHIVO_NO_DISPONIBLE);
    }

    if (!archivo.path.startsWith(`${actividadId}/${inscripcionId}/`)) {
      throw new BadRequestException(MENSAJE_ARCHIVO_AJENO);
    }

    let tamañoReal: number;
    try {
      const info = await stat(join(this.carpetaArchivos(), archivo.path));
      tamañoReal = info.size;
    } catch {
      throw new BadRequestException(MENSAJE_ARCHIVO_NO_DISPONIBLE);
    }

    const extension = archivo.path.slice(archivo.path.lastIndexOf('.') + 1);
    const mimeReal = MIME_POR_EXTENSION[extension];
    if (tamañoReal !== archivo.bytes || mimeReal !== archivo.mime) {
      throw new BadRequestException(MENSAJE_ARCHIVO_INCONSISTENTE);
    }
  }

  /**
   * Lee un archivo del almacén para su DESCARGA autorizada. La ruta
   * viene de la propia fila de submissions (no del cliente), pero se
   * re-valida igualmente: formato interno y prefijo de la actividad de
   * la ruta — la defensa en profundidad nunca sobra con rutas de disco.
   * Devuelve null si el archivo no existe o la ruta no es válida.
   */
  async leer(
    actividadId: bigint,
    rutaRelativa: string,
  ): Promise<Buffer | null> {
    if (!RUTA_ARCHIVO_REGEX.test(rutaRelativa)) {
      return null;
    }
    if (!rutaRelativa.startsWith(`${actividadId}/`)) {
      return null;
    }
    try {
      return await readFile(join(this.carpetaArchivos(), rutaRelativa));
    } catch {
      return null;
    }
  }
}
