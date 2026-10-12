import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

const RAISE_EXCEPTION_PATTERN = /RAISE EXCEPTION/i;
const P0001_PATTERN = /`P0001`/;
const RAISE_DETAIL_PATTERN = /Message: `([^`]*)`/;

interface MappedError {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

@Catch()
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const mapped = this.mapException(exception);
    response.status(mapped.status).json(mapped.body);
  }

  private mapException(exception: unknown): MappedError {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.mapKnownRequestError(exception);
      if (mapped) {
        return mapped;
      }
    }

    if (
      exception instanceof Prisma.PrismaClientUnknownRequestError &&
      RAISE_EXCEPTION_PATTERN.test(exception.message)
    ) {
      return this.mapRaiseException(exception.message);
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Error interno del servidor',
        error: 'Internal Server Error',
      },
    };
  }

  private mapKnownRequestError(
    exception: Prisma.PrismaClientKnownRequestError,
  ): MappedError | undefined {
    switch (exception.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          body: {
            statusCode: HttpStatus.CONFLICT,
            message: this.uniqueConstraintMessage(exception.meta),
            error: 'Conflict',
          },
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          body: {
            statusCode: HttpStatus.NOT_FOUND,
            message: 'El registro solicitado no fue encontrado.',
            error: 'Not Found',
          },
        };
      default:
        return this.isRaiseException(exception)
          ? this.mapRaiseException(exception.message)
          : undefined;
    }
  }

  private isRaiseException(
    exception: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    return (
      (exception.code === 'P2039' && P0001_PATTERN.test(exception.message)) ||
      RAISE_EXCEPTION_PATTERN.test(exception.message)
    );
  }

  private mapRaiseException(message: string): MappedError {
    const detail = RAISE_DETAIL_PATTERN.exec(message)?.[1];
    return {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      body: {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        message: detail
          ? `La operación no pudo completarse porque infringe una regla de validación de la base de datos: ${detail}`
          : 'La operación no pudo completarse porque infringe una regla de validación de la base de datos.',
        error: 'Unprocessable Entity',
      },
    };
  }

  private uniqueConstraintMessage(meta?: Record<string, unknown>): string {
    const target = meta?.target;
    const fields = Array.isArray(target)
      ? target.filter((field) => typeof field === 'string').join(', ')
      : undefined;
    return fields
      ? `Ya existe un registro con ese valor único (${fields}).`
      : 'Ya existe un registro con ese valor único.';
  }
}
