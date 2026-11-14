import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Traduce el 413 de multer (LIMIT_FILE_SIZE: el límite de la petición)
 * al mensaje de la plataforma en español, con la misma forma de error
 * que el resto de la API ({ statusCode, message, error }).
 *
 * Es un filtro de RUTA (no global): se declara con @UseFilters en los
 * endpoints de subida, donde la única fuente de un 413 es multer. El
 * mensaje lo inyecta la ruta al construirlo, así las pruebas comparten
 * la constante exacta (mismo patrón que los MENSAJE_* del Service).
 *
 * El tamaño de negocio (UPLOAD_MAX_BYTES) viaja en las opciones de
 * MulterModule (desde ConfigService) — este filtro solo traduce.
 */
@Catch(PayloadTooLargeException)
export class ArchivoDemasiadoGrandeFilter implements ExceptionFilter {
  constructor(private readonly mensaje: string) {}

  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      message: this.mensaje,
      error: 'Payload Too Large',
    });
  }
}
