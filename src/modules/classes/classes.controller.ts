import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { PerteneceA } from '../../common/decorators/pertenece-a.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { ClassesService } from './classes.service';
import { CrearClaseDto } from './dto/crear-clase.dto';
import { ActualizarClaseDto } from './dto/actualizar-clase.dto';
import { BuscarClasesQueryDto } from './dto/buscar-clases.dto';
import { ListarEstudiantesQueryDto } from './dto/listar-estudiantes.dto';
import type {
  ClaseCreadaRespuestaDto,
  ClaseRespuestaDto,
  ListadoClasesDto,
} from './dto/clase-respuesta.dto';
import type { ListadoEstudiantesDto } from './dto/estudiante-inscrito-respuesta.dto';

/**
 * Endpoints de clases bajo /api/v1/classes (AGENTS.md §8):
 * - GET   /                → busca clases por nombre (pg_trgm) paginado.
 * - GET   /:id             → devuelve la clase OWN :id del profesor.
 * - GET   /:id/estudiantes → lista los estudiantes inscritos en la clase
 *                            OWN :id del profesor autenticado.
 * - POST  /                → crea una clase con código de unión generado por la BD.
 * - PATCH /:id             → edita nombre y/o estado (archivar/reactivar).
 *
 * La creación NO declara @PerteneceA: ese guard verifica recursos
 * EXISTENTES por id de ruta y aquí la clase aún no existe (no hay :id),
 * así que solo exigiría un parámetro ausente y fallaría siempre
 * (docs/guard_pertenencia.md §3). La autorización se resuelve con el rol
 * teacher (@Roles) y la identidad del token (@UsuarioActual): el
 * teacher_id nunca se acepta del body.
 *
 * La lectura del detalle y la edición sí declaran @PerteneceA('clase',
 * 'id'): una clase ajena o inexistente responde 404 estándar antes de
 * llegar al handler, y el service re-verifica con la misma regla
 * (segunda capa, AGENTS.md §8).
 *
 * La búsqueda tampoco usa @PerteneceA (es una COLECCIÓN sin :id): la
 * pertenencia del profesor se aplica como filtro de la consulta
 * (teacher_id = usuario.id, misma regla de AutorizacionService) y el
 * estudiante queda acotado a su organización. Sin @Roles: los tres roles
 * pueden buscar; el rol cambia el FILTRO, no el permiso de entrada.
 */
@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Get()
  buscar(
    @Query() query: BuscarClasesQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoClasesDto> {
    return this.classesService.buscar(query, usuario);
  }

  // Detalle de UNA clase. Va antes de ':id/estudiantes' para que el orden
  // de declaración de rutas sea el natural (del más simple al más anidado).
  @Roles('teacher')
  @PerteneceA('clase', 'id')
  @Get(':id')
  obtener(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ClaseRespuestaDto> {
    return this.classesService.obtener(id, usuario);
  }

  @Roles('teacher')
  @PerteneceA('clase', 'id')
  @Get(':id/estudiantes')
  listarEstudiantes(
    @Param('id') id: string,
    @Query() query: ListarEstudiantesQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoEstudiantesDto> {
    return this.classesService.listarEstudiantes(id, query, usuario);
  }

  @Roles('teacher')
  @Post()
  crear(
    @Body() dto: CrearClaseDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ClaseCreadaRespuestaDto> {
    return this.classesService.crear(dto.nombre, usuario);
  }

  @Roles('teacher')
  @PerteneceA('clase', 'id')
  @Patch(':id')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarClaseDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ClaseRespuestaDto> {
    return this.classesService.actualizar(id, dto, usuario);
  }
}
