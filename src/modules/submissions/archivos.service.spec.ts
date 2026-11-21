import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MENSAJE_ARCHIVO_AJENO,
  MENSAJE_ARCHIVO_INCONSISTENTE,
  MENSAJE_ARCHIVO_NO_DISPONIBLE,
  detectarMimeReal,
} from './validar-archivo';
import { ArchivosService } from './archivos.service';

/**
 * Pruebas del almacén en disco con el SISTEMA DE ARCHIVOS REAL en un
 * directorio temporal por corrida (se borra en afterAll): el servicio
 * es una capa fina de fs y conviene ejercitarla de verdad. La config
 * se simula con UPLOAD_DIR → el directorio temporal.
 */

const ACTIVIDAD = BigInt(7);
const INSCRIPCION = BigInt(1);

/** PDF mínimo válido por magic bytes. */
const CONTENIDO = Buffer.from('%PDF-1.4\n%E2E\n%%EOF');

describe('ArchivosService (disco real)', () => {
  let carpeta: string;
  let service: ArchivosService;

  beforeAll(async () => {
    carpeta = await mkdtemp(join(tmpdir(), 'educoin-archivos-'));
    const config = {
      get: (clave: string): unknown =>
        clave === 'UPLOAD_DIR' ? carpeta : 10_485_760,
    };
    service = new ArchivosService(config as unknown as ConfigService);
  });

  afterAll(async () => {
    await rm(carpeta, { recursive: true, force: true });
  });

  describe('guardar', () => {
    it('guarda el contenido con nombre INTERNO (uuid.ext) y devuelve la metadata', async () => {
      const guardado = await service.guardar(
        ACTIVIDAD,
        INSCRIPCION,
        CONTENIDO,
        'application/pdf',
      );

      // La metadata es la que vive en answers[].files[].
      expect(guardado.mime).toBe('application/pdf');
      expect(guardado.bytes).toBe(CONTENIDO.length);
      expect(guardado.path).toMatch(/^7\/1\/[0-9a-f-]{36}\.pdf$/);
      // El nombre original del estudiante no existe en el sistema: la
      // ruta solo contiene ids del servidor y el UUID generado.
      expect(guardado.path).not.toContain('informe');

      const enDisco = await readFile(join(carpeta, guardado.path));
      expect(enDisco).toEqual(CONTENIDO);
    });

    it('la extensión del nombre interno sale del MIME detectado (jpg/png)', async () => {
      const jpg = await service.guardar(
        ACTIVIDAD,
        INSCRIPCION,
        Buffer.from([0xff, 0xd8, 0xff, 0x00]),
        'image/jpeg',
      );
      const png = await service.guardar(
        ACTIVIDAD,
        INSCRIPCION,
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        'image/png',
      );
      expect(jpg.path.endsWith('.jpg')).toBe(true);
      expect(png.path.endsWith('.png')).toBe(true);
    });
  });

  describe('verificar (referencias de PUT/POST)', () => {
    it('acepta un archivo propio recién guardado', async () => {
      const guardado = await service.guardar(
        ACTIVIDAD,
        INSCRIPCION,
        CONTENIDO,
        'application/pdf',
      );

      await expect(
        service.verificar(ACTIVIDAD, INSCRIPCION, guardado),
      ).resolves.toBeUndefined();
    });

    it('400 cuando la ruta no es la del propio estudiante (anti-IDOR)', async () => {
      const guardado = await service.guardar(
        ACTIVIDAD,
        INSCRIPCION,
        CONTENIDO,
        'application/pdf',
      );

      // La misma actividad pero otra inscripción: ajeno.
      await expect(
        service.verificar(ACTIVIDAD, BigInt(2), guardado),
      ).rejects.toThrow(new BadRequestException(MENSAJE_ARCHIVO_AJENO));
      // Otra actividad, mismo estudiante: también ajeno.
      await expect(
        service.verificar(BigInt(8), INSCRIPCION, guardado),
      ).rejects.toThrow(MENSAJE_ARCHIVO_AJENO);
    });

    it('400 cuando el archivo ya no existe en el almacén', async () => {
      const guardado = await service.guardar(
        ACTIVIDAD,
        INSCRIPCION,
        CONTENIDO,
        'application/pdf',
      );
      await rm(join(carpeta, guardado.path));

      await expect(
        service.verificar(ACTIVIDAD, INSCRIPCION, guardado),
      ).rejects.toThrow(MENSAJE_ARCHIVO_NO_DISPONIBLE);
    });

    it('400 cuando el tamaño declarado no coincide con el real', async () => {
      const guardado = await service.guardar(
        ACTIVIDAD,
        INSCRIPCION,
        CONTENIDO,
        'application/pdf',
      );

      await expect(
        service.verificar(ACTIVIDAD, INSCRIPCION, {
          ...guardado,
          bytes: guardado.bytes + 1,
        }),
      ).rejects.toThrow(MENSAJE_ARCHIVO_INCONSISTENTE);
    });

    it('400 cuando el MIME declarado no coincide con la extensión interna', async () => {
      const guardado = await service.guardar(
        ACTIVIDAD,
        INSCRIPCION,
        Buffer.from([0xff, 0xd8, 0xff, 0x00]),
        'image/jpeg',
      );

      await expect(
        service.verificar(ACTIVIDAD, INSCRIPCION, {
          ...guardado,
          mime: 'application/pdf',
        }),
      ).rejects.toThrow(MENSAJE_ARCHIVO_INCONSISTENTE);
    });
  });

  describe('leer (descarga)', () => {
    it('devuelve el contenido del archivo de la actividad correcta', async () => {
      const guardado = await service.guardar(
        ACTIVIDAD,
        INSCRIPCION,
        CONTENIDO,
        'application/pdf',
      );

      const contenido = await service.leer(ACTIVIDAD, guardado.path);
      expect(contenido).toEqual(CONTENIDO);
      // El contenido sigue siendo un PDF válido (roundtrip íntegro).
      expect(detectarMimeReal(contenido ?? Buffer.alloc(0))).toBe(
        'application/pdf',
      );
    });

    it('null para una ruta de OTRA actividad (la ruta pertenece a la entrega)', async () => {
      const guardado = await service.guardar(
        ACTIVIDAD,
        INSCRIPCION,
        CONTENIDO,
        'application/pdf',
      );

      expect(await service.leer(BigInt(8), guardado.path)).toBeNull();
    });

    it('null para rutas inválidas (traversal, nombre original, inexistente)', async () => {
      expect(await service.leer(ACTIVIDAD, '../../app.ts')).toBeNull();
      expect(await service.leer(ACTIVIDAD, 'mi-archivo.pdf')).toBeNull();
      expect(
        await service.leer(
          ACTIVIDAD,
          '7/1/00000000-0000-4000-8000-000000000000.pdf',
        ),
      ).toBeNull();
    });
  });

  describe('configuración', () => {
    it('el límite de bytes sale de la config (10 MB por defecto)', () => {
      expect(service.limiteBytes()).toBe(10_485_760);
      expect(service.carpetaArchivos()).toBe(carpeta);
    });

    it('sin UPLOAD_MAX_BYTES configurado cae en el default del servicio', () => {
      const config = {
        get: (clave: string): unknown =>
          clave === 'UPLOAD_DIR' ? carpeta : undefined,
      };
      const sinLimite = new ArchivosService(config as unknown as ConfigService);
      expect(sinLimite.limiteBytes()).toBe(10_485_760);
    });
  });
});
