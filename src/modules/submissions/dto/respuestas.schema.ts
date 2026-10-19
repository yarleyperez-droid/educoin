import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { Pregunta } from '../../activities/dto/preguntas.schema';
import {
  MAX_ARCHIVOS_POR_PREGUNTA,
  MIMES_PERMITIDOS,
  RUTA_ARCHIVO_REGEX,
} from '../validar-archivo';

/**
 * Validación de `submissions.answers` (JSONB) con zod (AGENTS.md §2: zod
 * es la herramienta designada para validar el JSONB).
 *
 * Estructura de referencia — docs/plataforma_educativa_bd.md §6:
 *
 *   [
 *     { "question_position": 1, "option": "3" },   // pregunta test
 *     { "question_position": 2, "text": "4" },     // completion
 *     { "question_position": 3,                    // pregunta file
 *       "files": [{ "path": "7/1/uuid.pdf", "mime": "application/pdf",
 *                   "bytes": 12345 }] }
 *   ]
 *
 * Lo que el estudiante envía es EXACTAMENTE lo que se guarda, salvo los
 * campos de calificación (`is_correct`, `score`): los objetos de zod
 * descartan las claves desconocidas, así que jamás se persisten (los
 * añade el backend al calificar, AGENTS.md §11.2).
 *
 * Los archivos de una pregunta `file` SOLO se referencian por la ruta
 * que devolvió la subida (POST .../archivos): el Service re-valida cada
 * referencia contra el disco y el prefijo de la propia inscripción
 * (anti-IDOR) antes de guardar. `path` es la ruta interna generada por
 * el servidor, no el nombre original del archivo.
 *
 * La BD solo exige que answers sea un arreglo JSON (CHECK jsonb_typeof);
 * la coherencia con las preguntas reales de la actividad (posiciones
 * existentes, opción válida según el tipo) se valida aquí, antes de
 * guardar, para dar un mensaje claro (AGENTS.md §6: validación doble).
 */

const campoPosicion = z
  .number({
    error:
      'La posición de la pregunta respondida (question_position) debe ser un número.',
  })
  .int({
    error:
      'La posición de la pregunta respondida (question_position) debe ser un número entero.',
  })
  .positive({
    error:
      'La posición de la pregunta respondida (question_position) debe ser un entero positivo (desde 1).',
  });

const campoOpcion = z
  .string({ error: 'La opción elegida (option) debe ser un texto.' })
  .min(1, { error: 'La opción elegida (option) no puede estar vacía.' });

const campoTexto = z
  .string({ error: 'La respuesta (text) debe ser un texto.' })
  .min(1, { error: 'La respuesta (text) no puede estar vacía.' });

/** Ruta interna del archivo (la que devolvió la subida), no el nombre original. */
const campoRutaArchivo = z
  .string({ error: 'La ruta (path) del archivo debe ser un texto.' })
  .regex(RUTA_ARCHIVO_REGEX, {
    error:
      'La ruta (path) del archivo no es válida: debe ser exactamente la que devolvió el servidor al subirlo.',
  });

/** Tipo del archivo subido: solo los tres permitidos (AGENTS.md §9.6). */
const campoMimeArchivo = z.enum(MIMES_PERMITIDOS, {
  error:
    'El tipo (mime) del archivo debe ser application/pdf, image/jpeg o image/png.',
});

/** Tamaño en bytes, tal como lo reportó el servidor al subirlo. */
const campoBytesArchivo = z
  .number({ error: 'El tamaño (bytes) del archivo debe ser un número.' })
  .int({ error: 'El tamaño (bytes) del archivo debe ser un número entero.' })
  .positive({ error: 'El tamaño (bytes) del archivo debe ser mayor que 0.' });

/**
 * Metadata de UN archivo adjunto, tal como vive en el JSONB answers
 * (docs/plataforma_educativa_bd.md §6): la referencia al archivo subido.
 */
const archivoSchema = z.object({
  path: campoRutaArchivo,
  mime: campoMimeArchivo,
  bytes: campoBytesArchivo,
});

/** Archivo referenciado en una respuesta, ya validado por zod. */
export type ArchivoRespuesta = z.infer<typeof archivoSchema>;

/**
 * Respuesta individual tal como la envía el estudiante: la posición de la
 * pregunta que responde y, según el TIPO de esa pregunta, la opción
 * elegida (test), el texto de la respuesta (completion/minigame) o los
 * archivos subidos (file — referencias a archivos ya guardados por el
 * endpoint de subida, nunca el contenido).
 */
const respuestaSchema = z.object({
  question_position: campoPosicion,
  option: campoOpcion.optional(),
  text: campoTexto.optional(),
  files: z
    .array(archivoSchema, {
      error: 'files debe ser un arreglo de archivos subidos.',
    })
    .max(MAX_ARCHIVOS_POR_PREGUNTA, {
      error: `Se permiten como máximo ${MAX_ARCHIVOS_POR_PREGUNTA} archivos por pregunta.`,
    })
    .optional(),
});

/** Respuesta ya validada, tal como se guarda en el JSONB answers. */
export type RespuestaEntrega = z.infer<typeof respuestaSchema>;

/**
 * Arreglo de respuestas SIN mínimo: el vacío (`[]`) es válido en esta
 * capa porque el mínimo lo decide el FLUJO — el borrador admite
 * guardar sin responder nada todavía; al ENVIAR, exigirCompletitud
 * garantiza que no falte ninguna respuesta de la actividad.
 */
const respuestasSchema = z.array(respuestaSchema, {
  error: 'respuestas debe ser un arreglo de respuestas.',
});

/**
 * Valida las respuestas del cliente CONTRA LAS PREGUNTAS REALES de la
 * actividad (la Service ya cargó activities.questions):
 * - Cada question_position debe existir en la actividad y no repetirse
 *   (una respuesta por pregunta).
 * - test       → exige option y esta debe ser el texto de una opción.
 * - completion → exige text (respuesta abierta).
 * - minigame   → exige text (describe el resultado alcanzado; los
 *   minijuegos aún no existen, docs/post_mvp.md).
 * - file       → exige files: referencias a archivos ya subidos con el
 *   endpoint de subida (POST .../archivos); puede venir vacío para
 *   desadjuntar lo subido. option/text no se admiten.
 * - Los archivos solo se aceptan en preguntas file: una respuesta de
 *   otro tipo con files responde 400.
 *
 * Devuelve las respuestas saneadas (sin claves desconocidas) o lanza un
 * 400 con el primer problema encontrado y su ubicación, para que el
 * estudiante sepa exactamente qué corregir.
 */
export function validarRespuestas(
  valor: unknown,
  preguntas: Pregunta[],
): RespuestaEntrega[] {
  const resultado = respuestasSchema.safeParse(valor);
  if (!resultado.success) {
    const primerProblema = resultado.error.issues[0];
    if (primerProblema === undefined) {
      throw new BadRequestException(
        'Las respuestas de la entrega no son válidas.',
      );
    }
    const ubicacion =
      primerProblema.path.length > 0
        ? ` (campo: ${primerProblema.path.join('.')})`
        : '';
    throw new BadRequestException(
      `Las respuestas de la entrega no son válidas: ${primerProblema.message}${ubicacion}.`,
    );
  }

  const respuestas = resultado.data;
  const respondidas = new Set<number>();

  for (const respuesta of respuestas) {
    const pregunta = preguntas.find(
      (candidata) => candidata.position === respuesta.question_position,
    );
    if (pregunta === undefined) {
      throw new BadRequestException(
        `La respuesta con question_position ${respuesta.question_position} no corresponde a ninguna pregunta de la actividad.`,
      );
    }
    if (respondidas.has(pregunta.position)) {
      throw new BadRequestException(
        `Solo se permite una respuesta por pregunta: la pregunta ${pregunta.position} llega respondida dos veces.`,
      );
    }
    respondidas.add(pregunta.position);

    switch (pregunta.type) {
      case 'test':
        if (respuesta.option === undefined) {
          throw new BadRequestException(
            `La pregunta ${pregunta.position} (test) se responde con option: el texto de la opción elegida.`,
          );
        }
        if (respuesta.text !== undefined) {
          throw new BadRequestException(
            `La pregunta ${pregunta.position} (test) no admite text: responde solo con option.`,
          );
        }
        if (respuesta.files !== undefined) {
          throw new BadRequestException(
            `La pregunta ${pregunta.position} (test) no admite files: los archivos solo se adjuntan a preguntas de tipo file.`,
          );
        }
        if (
          !pregunta.options.some((opcion) => opcion.text === respuesta.option)
        ) {
          throw new BadRequestException(
            `La opción "${respuesta.option}" no es una de las opciones de la pregunta ${pregunta.position}.`,
          );
        }
        break;
      case 'completion':
      case 'minigame':
        if (respuesta.text === undefined) {
          throw new BadRequestException(
            `La pregunta ${pregunta.position} (${pregunta.type}) se responde con text.`,
          );
        }
        if (respuesta.option !== undefined) {
          throw new BadRequestException(
            `La pregunta ${pregunta.position} (${pregunta.type}) no admite option: responde solo con text.`,
          );
        }
        if (respuesta.files !== undefined) {
          throw new BadRequestException(
            `La pregunta ${pregunta.position} (${pregunta.type}) no admite files: los archivos solo se adjuntan a preguntas de tipo file.`,
          );
        }
        break;
      case 'file':
        if (respuesta.option !== undefined) {
          throw new BadRequestException(
            `La pregunta ${pregunta.position} (file) no admite option: se responde con files.`,
          );
        }
        if (respuesta.text !== undefined) {
          throw new BadRequestException(
            `La pregunta ${pregunta.position} (file) no admite text: se responde con files.`,
          );
        }
        if (respuesta.files === undefined) {
          throw new BadRequestException(
            `La pregunta ${pregunta.position} (file) se responde con files: las rutas que devolvió el servidor al subir cada archivo (puede ser un arreglo vacío para desadjuntarlos).`,
          );
        }
        break;
    }
  }

  return respuestas;
}

/**
 * Completitud al ENVIAR (regla del equipo): la entrega no puede
 * faltarle ninguna respuesta — toda pregunta de la actividad debe
 * estar respondida, EXCEPTO las de tipo `file` (regla del equipo
 * mantenida: aunque ya se pueden responder con archivos subidos, la
 * decisión de exigirlas es del profesor al calificar; una actividad
 * solo-file sigue siendo enviable sin respuestas).
 *
 * Debe correr DESPUÉS de validarRespuestas (posiciones válidas, sin
 * repetir). Lanza un 400 con las posiciones que faltan para que el
 * estudiante sepa exactamente qué completar.
 */
export function exigirCompletitud(
  respuestas: RespuestaEntrega[],
  preguntas: Pregunta[],
): void {
  const respondidas = new Set(
    respuestas.map((respuesta) => respuesta.question_position),
  );
  const faltantes = preguntas
    .filter(
      (pregunta) =>
        pregunta.type !== 'file' && !respondidas.has(pregunta.position),
    )
    .map((pregunta) => pregunta.position);

  if (faltantes.length > 0) {
    throw new BadRequestException(
      `Falta responder ${
        faltantes.length === 1 ? 'la pregunta' : 'las preguntas'
      } ${faltantes.join(', ')} de la actividad antes de enviar la entrega.`,
    );
  }
}
