import { ApiProperty } from '@nestjs/swagger';

/**
 * DTOs de DOCUMENTACIÓN del JSONB `questions` de las actividades
 * (activities.questions — docs/plataforma_educativa_bd.md §6). La
 * validación REAL la hace zod en dto/preguntas.schema.ts (AGENTS.md §2):
 * estas clases existen solo para que Swagger muestre la estructura,
 * con sus reglas en las descripciones, y nunca se instancian.
 *
 * El JSONB es una unión discriminada por `type` (los 4 tipos del MVP,
 * AGENTS.md §5); aquí se aplana en una sola clase con los campos
 * específicos de cada tipo como opcionales, para que el esquema sea
 * legible en la UI de Swagger.
 */

/** Una opción de pregunta test, tal como la define el profesor. */
export class OpcionDocDto {
  @ApiProperty({
    example: '3',
    description: 'Texto de la opción que ve el estudiante.',
  })
  text!: string;

  @ApiProperty({
    example: true,
    description:
      'Marca la opción correcta. Cada pregunta test exige EXACTAMENTE una opción con is_correct=true. Solo viaja en las vistas del PROFESOR: jamás llega al estudiante (AGENTS.md §9.5).',
  })
  is_correct!: boolean;
}

/** Una pregunta, tal como la define el profesor (con las respuestas correctas). */
export class PreguntaDocDto {
  @ApiProperty({
    example: 1,
    description:
      'Posición de la pregunta: secuencial desde 1 (1, 2, 3…). Las entregas la referencian como question_position.',
  })
  position!: number;

  @ApiProperty({
    enum: ['test', 'completion', 'file', 'minigame'],
    description:
      'Tipo de la pregunta: decide cómo se responde y cómo se califica.',
  })
  type!: string;

  @ApiProperty({
    example: '¿Cuánto es 2 + 2?',
    description: 'Enunciado visible de la pregunta.',
  })
  prompt!: string;

  @ApiProperty({
    example: 5,
    description:
      'Puntaje de la pregunta (mayor que 0). El puntaje total de la actividad es la suma.',
  })
  score!: number;

  @ApiProperty({
    type: [OpcionDocDto],
    required: false,
    description:
      'SOLO type=test (mínimo 2 opciones): las opciones de la pregunta.',
  })
  options?: OpcionDocDto[];

  @ApiProperty({
    required: false,
    description:
      'SOLO type=completion: la respuesta esperada contra la que auto-califica el backend al enviar la entrega. Nunca viaja al estudiante.',
  })
  expected_answer?: string;
}

/** Opción de pregunta test en la vista del ESTUDIANTE: sin is_correct. */
export class OpcionEstudianteDocDto {
  @ApiProperty({
    example: '3',
    description: 'Texto de la opción que ve el estudiante.',
  })
  text!: string;
}

/**
 * Una pregunta tal como la ve el ESTUDIANTE: sin `options[].is_correct`
 * ni `expected_answer` (AGENTS.md §9.5: la respuesta correcta nunca se
 * envía al frontend mientras el estudiante resuelve).
 */
export class PreguntaEstudianteDocDto {
  @ApiProperty({
    example: 1,
    description: 'Posición de la pregunta (secuencial desde 1).',
  })
  position!: number;

  @ApiProperty({
    enum: ['test', 'completion', 'file', 'minigame'],
    description: 'Tipo de la pregunta: decide cómo se responde.',
  })
  type!: string;

  @ApiProperty({
    example: '¿Cuánto es 2 + 2?',
    description: 'Enunciado visible de la pregunta.',
  })
  prompt!: string;

  @ApiProperty({
    example: 5,
    description: 'Puntaje de la pregunta (mayor que 0).',
  })
  score!: number;

  @ApiProperty({
    type: [OpcionEstudianteDocDto],
    required: false,
    description: 'SOLO type=test: las opciones visibles (sin is_correct).',
  })
  options?: OpcionEstudianteDocDto[];
}
