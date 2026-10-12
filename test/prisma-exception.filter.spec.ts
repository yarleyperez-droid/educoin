import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter';

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

function knownError(
  code: string,
  message: string,
  meta?: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    meta,
    clientVersion: 'test',
  });
}

describe('PrismaExceptionFilter', () => {
  let filter: PrismaExceptionFilter;

  beforeEach(() => {
    filter = new PrismaExceptionFilter();
  });

  it('maps P2002 to 409 Conflict', () => {
    const { host, response } = createHost();
    filter.catch(
      knownError('P2002', 'Unique constraint failed on the fields: (`email`)', {
        target: ['email'],
      }),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 409,
      message: 'Ya existe un registro con ese valor único (email).',
      error: 'Conflict',
    });
  });

  it('maps P2025 to 404 Not Found', () => {
    const { host, response } = createHost();
    filter.catch(
      knownError(
        'P2025',
        'An operation failed because it depends on one or more records that were required but not found.',
      ),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 404,
      message: 'El registro solicitado no fue encontrado.',
      error: 'Not Found',
    });
  });

  it('maps a trigger RAISE EXCEPTION (P2039 wrapping P0001) to 422 with the trigger detail', () => {
    const { host, response } = createHost();
    filter.catch(
      knownError(
        'P2039',
        'Database error. Code: `P0001`. Message: `the item is out of stock`',
      ),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 422,
      message:
        'La operación no pudo completarse porque infringe una regla de validación de la base de datos: the item is out of stock',
      error: 'Unprocessable Entity',
    });
  });

  it('maps an unknown error mentioning RAISE EXCEPTION to 422 without detail', () => {
    const { host, response } = createHost();
    filter.catch(
      new Prisma.PrismaClientUnknownRequestError('RAISE EXCEPTION', {
        clientVersion: 'test',
      }),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 422,
      message:
        'La operación no pudo completarse porque infringe una regla de validación de la base de datos.',
      error: 'Unprocessable Entity',
    });
  });

  it('maps any other Prisma error to a generic 500 without leaking details', () => {
    const { host, response } = createHost();
    filter.catch(
      new Prisma.PrismaClientValidationError(
        'Invalid `prisma.users.findMany()` invocation',
        {
          clientVersion: 'test',
        },
      ),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Error interno del servidor',
      error: 'Internal Server Error',
    });
  });

  it('maps a non-Prisma error to a generic 500 without leaking details', () => {
    const { host, response } = createHost();
    filter.catch(new Error('secret internal detail'), host);
    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Error interno del servidor',
      error: 'Internal Server Error',
    });
  });

  it('lets HttpException pass through untouched', () => {
    const { host, response } = createHost();
    const exception = new HttpException(
      { message: 'Bad request', error: 'Bad Request', statusCode: 400 },
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(exception, host);
    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith(exception.getResponse());
  });
});
