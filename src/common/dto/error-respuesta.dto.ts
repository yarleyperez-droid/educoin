import { ApiProperty } from '@nestjs/swagger';

/**
 * Forma estándar de TODOS los errores de la API: { statusCode, message,
 * error } (mismo contrato que producen el ValidationPipe global, los
 * guards de auth/roles, las excepciones de los services y los filtros
 * de Prisma/multer — app.setup.ts).
 *
 * Clase solo-documentación: se referencia como `type` en los
 * @Api*Response de error de cada endpoint; el runtime nunca la
 * instancia.
 */
export class ErrorRespuestaDto {
  @ApiProperty({ example: 404, description: 'Código HTTP del error.' })
  statusCode!: number;

  @ApiProperty({
    type: String,
    example: 'El recurso solicitado no fue encontrado.',
    description:
      'Mensaje del error en español. En los 400 del ValidationPipe llega un ARREGLO de strings (un mensaje por campo inválido); en el resto es un string único.',
  })
  message!: string | string[];

  @ApiProperty({
    example: 'Not Found',
    description: 'Título corto del error (la frase estándar del código HTTP).',
  })
  error!: string;
}
