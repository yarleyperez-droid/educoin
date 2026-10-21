import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  ApiUnsupportedMediaTypeResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { PerteneceA } from '../../common/decorators/pertenece-a.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import { ArchivoDemasiadoGrandeFilter } from '../../common/filters/archivo-demasiado-grande.filter';
import { ErrorRespuestaDto } from '../../common/dto/error-respuesta.dto';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { SubmissionsService } from './submissions.service';
import { CrearEntregaDto } from './dto/crear-entrega.dto';
import { GuardarBorradorDto } from './dto/guardar-borrador.dto';
import { ListarEntregasQueryDto } from './dto/listar-entregas.dto';
import { CalificarEntregaDto } from './dto/calificar-entrega.dto';
import { AdjuntarArchivoDto } from './dto/adjuntar-archivo.dto';
import {
  CAMPO_ARCHIVOS,
  MAX_ARCHIVOS_POR_PREGUNTA,
  MENSAJE_ARCHIVO_DEMASIADO_GRANDE,
  type ArchivoSubido,
} from './validar-archivo';
import {
  BorradorGuardadoRespuestaDto,
  CalificacionRespuestaDto,
  EntregaBorradorRespuestaDto,
  EntregaCreadaRespuestaDto,
  EntregaDetalleProfesorDto,
  EntregaRespuestaDto,
  ListadoEntregasDto,
} from './dto/entrega-respuesta.dto';

/**
 * Flujo de ENTREGAS del ESTUDIANTE (rol student) — AGENTS.md §11 y
 * docs/flujo_entregas.md:
 *
 * - PUT  /activities/:id/submissions → guarda/actualiza el BORRADOR
 *   (autosave por cada cambio; 'in_progress' en el enum real). Las
 *   respuestas pueden ser parciales e incluso vacías, y JAMÁS llevan
 *   is_correct/score (§9.5). 409 si la entrega ya fue enviada: nunca se
 *   baja de submitted a borrador.
 * - GET  /activities/:id/submissions → la entrega del estudiante: el
 *   borrador tal cual para retomarlo o el resultado enviado/calificado.
 *   404 si todavía no existe ninguna.
 * - POST /activities/:id/submissions → ENVÍA la entrega definitiva:
 *   zod exige completitud (toda la actividad respondida, menos file) y
 *   la auto-calificación decide si llega a 'graded' con las monedas
 *   (umbral del 80%, trigger fn_award_coins).
 * - POST /activities/:id/submissions/archivos → SUBE archivos
 *   (multipart, campo 'archivos') para una pregunta file del borrador:
 *   valida el MIME real (magic bytes: PDF/JPG/PNG) y el tamaño
 *   (UPLOAD_MAX_BYTES), los guarda en disco con nombre interno UUID y
 *   deja en answers[].files[] solo la metadata { path, mime, bytes }.
 *   415 tipo no permitido · 413 demasiado grande · 409 ya enviada.
 * - GET /activities/:id/submissions/:entregaId/archivos/:posicion/:indice
 *   → DESCARGA autorizada de un archivo adjunto: solo el estudiante
 *   dueño y el profesor de la clase (regla 'entrega'); la ruta del
 *   archivo se deriva de la BD, nunca del cliente.
 *
 * Y la COLA DE CALIFICACIÓN del PROFESOR (rol teacher):
 * - GET  /activities/:id/submissions/queue → TODAS las entregas de su
 *   actividad (paginación estándar, filtro ?estado opcional — el caso
 *   principal es ?estado=submitted para calificar). Filas de resumen
 *   con los datos del estudiante; sin answers.
 * - GET  /activities/:id/submissions/:entregaId → VISTA DE REVISIÓN:
 *   la entrega con sus respuestas (veredicto por respuesta), el
 *   estudiante dueño y el feedback si ya fue calificada.
 * - POST /activities/:id/submissions/:entregaId/calificar → transición
 *   definitiva: submitted → graded (puntaje + feedback) o rejected
 *   (feedback). Las monedas y graded_at las escribe el trigger
 *   fn_award_coins; el UPDATE filtra por status='submitted', así una
 *   'graded' jamás se recalifica y el trigger no paga dos veces.
 *
 * @Roles('student'): teacher/admin reciben 403 (RolesGuard corre antes
 * que PertenenciaGuard). @PerteneceA('actividadVisible', 'id') es la
 * puerta del estudiante — actividad published + inscripción ACTIVA en
 * la clase de la actividad: quien no está inscrito (o la actividad es
 * draft/deleted) recibe el 404 estándar anti-enumeración antes de
 * llegar al handler. La inscripción NO viaja en la petición: el Service
 * la deriva del token, así que no hay id ajeno que suplantar (IDOR).
 * El Service re-verifica la misma regla (segunda capa, AGENTS.md §8) y
 * agrega las validaciones amigables; el INSERT queda protegido por
 * fn_validate_submission (422) y uq_submission (P2002 → 409) como red
 * de seguridad final.
 *
 * La cola invierte los roles (@Roles('teacher') +
 * @PerteneceA('actividad', 'id')): la clase de la actividad es suya —
 * un profesor ajeno recibe el mismo 404 estándar anti-enumeración.
 */
@ApiTags('Submissions')
// Todas las rutas son protegidas: guards GLOBALES (JWT + roles).
@ApiBearerAuth()
@Controller()
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Roles('student')
  @PerteneceA('actividadVisible', 'id')
  @ApiExtraModels(EntregaBorradorRespuestaDto, EntregaRespuestaDto)
  @ApiOperation({
    summary: 'Mi entrega de la actividad',
    description:
      "Solo student inscrito. Devuelve el BORRADOR tal cual para retomarlo ('in_progress', respuestas sin veredicto) o, si ya fue enviada, la entrega con su resultado (veredicto por respuesta, monedas y feedback si ya calificó). Sin ninguna entrega todavía responde 404.",
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la actividad (BigInt como string).',
    example: '7',
  })
  @ApiOkResponse({
    description:
      "El borrador ('in_progress') o la entrega enviada ('submitted'/'graded'/'rejected'), según el estado de la entrega del estudiante.",
    schema: {
      oneOf: [
        { $ref: getSchemaPath(EntregaBorradorRespuestaDto) },
        { $ref: getSchemaPath(EntregaRespuestaDto) },
      ],
    },
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es student.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description:
      'Actividad inexistente/no publicada, sin inscripción activa, o el estudiante aún no tiene entrega.',
  })
  @Get('activities/:id/submissions')
  miEntrega(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EntregaBorradorRespuestaDto | EntregaRespuestaDto> {
    return this.submissionsService.miEntrega(id, usuario);
  }

  @Roles('student')
  @PerteneceA('actividadVisible', 'id')
  @ApiOperation({
    summary: 'Guardar el borrador de mi entrega (autosave)',
    description:
      "Solo student inscrito. Guarda/actualiza el BORRADOR en cada cambio: las respuestas pueden ser parciales o venir vacías (is_correct/score jamás se aceptan). Si no existe, crea la entrega en 'in_progress' y registra started_at. Una entrega ya ENVIADA no baja a borrador: responde 409.",
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la actividad (BigInt como string).',
    example: '7',
  })
  @ApiOkResponse({
    description: 'Borrador guardado (creado o actualizado).',
    type: BorradorGuardadoRespuestaDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description:
      'Respuestas que no pasan la validación zod contra las preguntas reales de la actividad.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es student.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description: 'Actividad inexistente/no publicada o sin inscripción activa.',
  })
  @ApiConflictResponse({
    type: ErrorRespuestaDto,
    description: 'La entrega ya fue enviada: nunca se vuelve a borrador.',
  })
  @Put('activities/:id/submissions')
  guardarBorrador(
    @Param('id') id: string,
    @Body() dto: GuardarBorradorDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BorradorGuardadoRespuestaDto> {
    return this.submissionsService.guardarBorrador(id, dto, usuario);
  }

  @Roles('student')
  @PerteneceA('actividadVisible', 'id')
  @ApiOperation({
    summary: 'Enviar mi entrega definitiva',
    description:
      "Solo student inscrito. Cierra el borrador (o crea la entrega de una vez): exige COMPLETITUD (toda la actividad respondida, excepto preguntas file). La auto-calificación decide: al umbral del 80% pasa a 'graded' y el trigger fn_award_coins acredita las monedas; si no, queda 'submitted' esperando al profesor. La entrega es ÚNICA por actividad (uq_submission): ya enviada responde 409.",
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la actividad (BigInt como string).',
    example: '7',
  })
  @ApiCreatedResponse({
    description: 'Entrega enviada, con su resultado inmediato.',
    type: EntregaCreadaRespuestaDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description:
      'Respuestas inválidas o incompletas (zod exige toda la actividad respondida, menos file).',
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es student.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description: 'Actividad inexistente/no publicada o sin inscripción activa.',
  })
  @ApiConflictResponse({
    type: ErrorRespuestaDto,
    description: 'Ya existe una entrega enviada para esta actividad.',
  })
  @Post('activities/:id/submissions')
  entregar(
    @Param('id') id: string,
    @Body() dto: CrearEntregaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EntregaCreadaRespuestaDto> {
    return this.submissionsService.entregar(id, dto, usuario);
  }

  /**
   * SUBIDA de archivos (multipart/form-data) para una pregunta file de
   * la entrega en borrador: campo de texto question_position + archivos
   * en el campo 'archivos' (hasta MAX_ARCHIVOS_POR_PREGUNTA).
   *
   * El interceptor (multer, MemoryStorage) ya aplica el tope de
   * UPLOAD_MAX_BYTES a la petición; el filtro de ruta traduce su 413
   * (inglés) al mensaje de la plataforma. El Service es la segunda
   * capa: valida el MIME REAL por contenido (magic bytes: solo PDF,
   * JPG y PNG — AGENTS.md §9.6), revalida el tamaño y guarda cada
   * archivo en disco con nombre INTERNO generado por el servidor: el
   * nombre original del estudiante jamás se persiste. En la BD solo
   * queda la metadata { path, mime, bytes } en answers[].files[].
   *
   * 201 como el resto de los POST: puede crear el borrador de la
   * misma forma que lo actualiza (mismo criterio que POST
   * /activities/:id/submissions, que también cierra borradores).
   */
  @Roles('student')
  @PerteneceA('actividadVisible', 'id')
  @UseFilters(
    new ArchivoDemasiadoGrandeFilter(MENSAJE_ARCHIVO_DEMASIADO_GRANDE),
  )
  @UseInterceptors(FilesInterceptor(CAMPO_ARCHIVOS, MAX_ARCHIVOS_POR_PREGUNTA))
  @ApiOperation({
    summary: 'Subir archivos para una pregunta file de mi borrador',
    description:
      'Solo student inscrito. Multipart/form-data con la posición de la pregunta y los archivos en el campo `archivos` (hasta 3). Valida el MIME REAL por contenido (magic bytes: solo PDF, JPG y PNG) y el tamaño; guarda con nombre INTERNO uuid y deja en answers[].files[] solo la metadata { path, mime, bytes } — el nombre original jamás se persiste. Puede crear el borrador si aún no existe.',
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la actividad (BigInt como string).',
    example: '7',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'Campo de texto question_position + archivos en el campo archivos (multipart; los archivos no van en el JSON).',
    schema: {
      type: 'object',
      required: ['question_position', CAMPO_ARCHIVOS],
      properties: {
        question_position: {
          type: 'integer',
          minimum: 1,
          description:
            'Posición de la pregunta de tipo file que recibe los archivos.',
          example: 3,
        },
        [CAMPO_ARCHIVOS]: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          maxItems: MAX_ARCHIVOS_POR_PREGUNTA,
          description:
            'Archivos PDF, JPG o PNG (el tipo se valida por contenido, no por nombre).',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Archivos adjuntados al borrador de la entrega.',
    type: BorradorGuardadoRespuestaDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description:
      'Sin archivos, question_position inválida, o la pregunta no es de tipo file.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es student.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description: 'Actividad inexistente/no publicada o sin inscripción activa.',
  })
  @ApiConflictResponse({
    type: ErrorRespuestaDto,
    description: 'La entrega ya fue enviada.',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorRespuestaDto,
    description: 'Algún archivo supera el tamaño máximo de la plataforma.',
  })
  @ApiUnsupportedMediaTypeResponse({
    type: ErrorRespuestaDto,
    description: 'Contenido no permitido: solo PDF, JPG y PNG (magic bytes).',
  })
  @Post('activities/:id/submissions/archivos')
  adjuntarArchivos(
    @Param('id') id: string,
    @Body() dto: AdjuntarArchivoDto,
    @UploadedFiles() archivos: ArchivoSubido[],
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BorradorGuardadoRespuestaDto> {
    return this.submissionsService.adjuntarArchivos(id, dto, archivos, usuario);
  }

  /**
   * COLA DE CALIFICACIÓN del profesor: TODAS las entregas de SU
   * actividad, paginadas ({ data, meta }) y con filtro ?estado
   * opcional del enum submission_status — el caso principal es
   * ?estado=submitted: las que esperan su calificación. Filas de
   * resumen con los datos del estudiante (join enrollments → users),
   * SIN answers: el listado es un resumen (mismo criterio que el de
   * actividades) y el detalle de cada entrega llegará con el endpoint
   * de calificación (docs/flujo_entregas.md §10).
   *
   * @Roles('teacher'): student/admin reciben 403 (RolesGuard corre
   * antes de PertenenciaGuard). @PerteneceA('actividad', 'id') es la
   * puerta: la clase de la actividad es suya — un profesor ajeno (o un
   * id inexistente) recibe el 404 estándar anti-enumeración antes de
   * llegar al handler. El Service re-verifica la misma regla (segunda
   * capa, AGENTS.md §8).
   */
  @Roles('teacher')
  @PerteneceA('actividad', 'id')
  @ApiOperation({
    summary: 'Cola de calificación de mi actividad',
    description:
      'Solo teacher dueño de la actividad (ajena/inexistente → 404 anti-enumeración). TODAS las entregas, paginado { data, meta } con filtro ?estado opcional — el caso principal es ?estado=submitted: las que esperan calificación. Filas de resumen con los datos del estudiante, SIN answers: el detalle está en GET .../submissions/:entregaId.',
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la actividad (BigInt como string).',
    example: '7',
  })
  @ApiOkResponse({
    description: 'Entregas de la actividad (filas de resumen).',
    type: ListadoEntregasDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description: 'Parámetros de consulta inválidos (paginación/estado).',
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es teacher.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description: 'Actividad inexistente o ajena al profesor del token.',
  })
  @Get('activities/:id/submissions/queue')
  cola(
    @Param('id') id: string,
    @Query() query: ListarEntregasQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoEntregasDto> {
    return this.submissionsService.cola(id, query, usuario);
  }

  /**
   * VISTA DE REVISIÓN de UNA entrega de su actividad: lo que la cola
   * no trae — el answers JSONB con veredicto por respuesta, el
   * estudiante dueño, y el resultado/feedback si ya fue calificada. Es
   * lo que el profesor mira ANTES de decidir la calificación (las
   * preguntas de la actividad, con las correctas, ya las tiene en
   * GET /activities/:id).
   *
   * @Roles('teacher'): student/admin reciben 403.
   * @PerteneceA('actividad', 'id'): la clase de la actividad es suya —
   * un profesor ajeno recibe el 404 estándar anti-enumeración; el
   * Service re-verifica (segunda capa) y exige además que la entrega
   * pertenezca a ESA actividad (si no: el mismo 404).
   */
  @Roles('teacher')
  @PerteneceA('actividad', 'id')
  @ApiOperation({
    summary: 'Vista de revisión de una entrega',
    description:
      'Solo teacher dueño de la actividad. La fila de la cola MÁS lo que hace falta para calificar: las respuestas del estudiante con su veredicto (answers JSONB), el estudiante dueño y el feedback si ya fue calificada. Una entrega de OTRA actividad responde el mismo 404.',
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la actividad (BigInt como string).',
    example: '7',
  })
  @ApiParam({
    name: 'entregaId',
    description: 'Id numérico de la entrega (BigInt como string).',
    example: '23',
  })
  @ApiOkResponse({
    description: 'La entrega con sus respuestas y veredictos.',
    type: EntregaDetalleProfesorDto,
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es teacher.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description:
      'Actividad o entrega inexistente, o la entrega es de otra actividad.',
  })
  @Get('activities/:id/submissions/:entregaId')
  detalle(
    @Param('id') id: string,
    @Param('entregaId') entregaId: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EntregaDetalleProfesorDto> {
    return this.submissionsService.detalle(id, entregaId, usuario);
  }

  /**
   * DESCARGA de un archivo adjunto de una entrega: la metadata vive en
   * answers[].files[] de la entrega y la URL la referencia por
   * posición de pregunta e índice — la ruta del disco NUNCA viaja en
   * la petición, se deriva de la BD (imposible path traversal).
   *
   * @Roles('student', 'teacher') + @PerteneceA('entrega', 'entregaId'):
   * solo el estudiante dueño de la entrega y el profesor de la clase
   * (AGENTS.md §9.6); ajeno o inexistente → el 404 estándar
   * anti-enumeración. El Service re-verifica (segunda capa) y exige
   * que la entrega pertenezca a ESA actividad de la ruta.
   *
   * La respuesta es el archivo en sí: Content-Type del MIME real y
   * Content-Disposition con el nombre INTERNO (uuid.ext) — el
   * original del estudiante no existe en el sistema.
   */
  @Roles('student', 'teacher')
  @PerteneceA('entrega', 'entregaId')
  @ApiOperation({
    summary: 'Descargar un archivo adjunto de una entrega',
    description:
      'El estudiante dueño de la entrega o el profesor de la clase (ajeno/inexistente → 404 anti-enumeración). El archivo se referencia por POSICIÓN de pregunta e índice: la ruta del disco sale de la BD, nunca del cliente. La respuesta es el archivo con su MIME real y el nombre INTERNO (uuid.ext) en Content-Disposition.',
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la actividad (BigInt como string).',
    example: '7',
  })
  @ApiParam({
    name: 'entregaId',
    description: 'Id numérico de la entrega (BigInt como string).',
    example: '23',
  })
  @ApiParam({
    name: 'posicion',
    description:
      'Posición de la pregunta file dentro de la actividad (desde 1).',
    example: 3,
  })
  @ApiParam({
    name: 'indice',
    description:
      'Índice del archivo dentro de los adjuntos de esa pregunta (desde 0).',
    example: 0,
  })
  @ApiOkResponse({
    description:
      'El archivo (PDF, JPG o PNG) con Content-Disposition attachment.',
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es student ni teacher.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description:
      'Entrega inexistente/ajena, o la posición/índice no corresponden a un archivo adjunto.',
  })
  @Get('activities/:id/submissions/:entregaId/archivos/:posicion/:indice')
  async descargarArchivo(
    @Param('id') id: string,
    @Param('entregaId') entregaId: string,
    @Param('posicion') posicion: string,
    @Param('indice') indice: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const archivo = await this.submissionsService.descargarArchivo(
      id,
      entregaId,
      posicion,
      indice,
      usuario,
    );
    respuesta.setHeader(
      'Content-Disposition',
      `attachment; filename="${archivo.nombre}"`,
    );
    return new StreamableFile(archivo.contenido, { type: archivo.mime });
  }

  /**
   * CALIFICA la entrega pendiente: submitted → graded (puntaje dentro
   * de 0..total de la actividad + feedback opcional) o rejected
   * (feedback opcional, sin puntaje). Solo el dueño de la actividad.
   *
   * La transición es ATÓMICA y unilateral (patrón del autosave): el
   * UPDATE filtra por status='submitted' — recalificar una entrega ya
   * 'graded' (o tocar un borrador) queda sin efecto y responde 409,
   * así el trigger fn_award_coins no puede otorgar dos veces las
   * monedas de la misma entrega. El backend JAMÁS escribe monedas ni
   * graded_at: los acredita el trigger en → graded (AGENTS.md §6) y la
   * respuesta devuelve la fila re-leída tal como quedó.
   *
   * Rechazos (precedencia): 400 DTO/condicional → 404 actividad ajena
   * /entrega inexistente o de otra actividad → 409 ya no está
   * 'submitted' → 422 puntaje fuera de 0..total.
   */
  @Roles('teacher')
  @PerteneceA('actividad', 'id')
  // 200 y no el 201 por defecto de POST: no crea un recurso nuevo,
  // transiciona uno existente y lo devuelve (mismo criterio que
  // POST /activities/:id/publicar).
  @ApiOperation({
    summary: 'Calificar una entrega pendiente',
    description:
      "Solo teacher dueño. Transición ATÓMICA desde 'submitted': decision='graded' exige puntaje (0..total de la actividad) y dispara fn_award_coins (monedas + graded_at, escritos por la BD); decision='rejected' rechaza con feedback y PROHÍBE puntaje. Una entrega ya calificada (o un borrador) responde 409 — el trigger no paga dos veces.",
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la actividad (BigInt como string).',
    example: '7',
  })
  @ApiParam({
    name: 'entregaId',
    description: 'Id numérico de la entrega (BigInt como string).',
    example: '23',
  })
  @ApiOkResponse({
    description:
      'La entrega calificada (graded) o rechazada (rejected), tal como quedó.',
    type: CalificacionRespuestaDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description:
      "Puntaje ausente con 'graded' o enviado con 'rejected' (máx. 2 decimales).",
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es teacher.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description:
      'Actividad o entrega inexistente, o la entrega es de otra actividad.',
  })
  @ApiConflictResponse({
    type: ErrorRespuestaDto,
    description: 'La entrega ya no está pendiente (no se recalifica).',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorRespuestaDto,
    description: 'El puntaje está fuera del rango 0..total de la actividad.',
  })
  @HttpCode(HttpStatus.OK)
  @Post('activities/:id/submissions/:entregaId/calificar')
  calificar(
    @Param('id') id: string,
    @Param('entregaId') entregaId: string,
    @Body() dto: CalificarEntregaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CalificacionRespuestaDto> {
    return this.submissionsService.calificar(id, entregaId, dto, usuario);
  }
}
