import {
  ArgumentsHost,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ArchivoDemasiadoGrandeFilter } from '../src/common/filters/archivo-demasiado-grande.filter';

function createHost(): {
  host: ArgumentsHost;
  response: { status: jest.Mock; json: jest.Mock };
} {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('ArchivoDemasiadoGrandeFilter', () => {
  const MENSAJE =
    'El archivo supera el tamaño máximo permitido por la plataforma.';
  const filter = new ArchivoDemasiadoGrandeFilter(MENSAJE);

  it('traduce el 413 de multer al mensaje de la plataforma (misma forma de error)', () => {
    const { host, response } = createHost();

    filter.catch(
      new PayloadTooLargeException('File too large'), // el inglés de multer
      host,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 413,
      message: MENSAJE,
      error: 'Payload Too Large',
    });
  });

  it('usa el mensaje inyectado por la ruta (compartible con las pruebas)', () => {
    const { host, response } = createHost();
    const propio = new ArchivoDemasiadoGrandeFilter('Otro mensaje de la ruta');

    propio.catch(new PayloadTooLargeException('File too large'), host);

    expect(response.json).toHaveBeenCalledWith({
      statusCode: 413,
      message: 'Otro mensaje de la ruta',
      error: 'Payload Too Large',
    });
  });
});
