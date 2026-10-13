import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { PerteneceA } from '../../common/decorators/pertenece-a.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { ClassesService } from './classes.service';
import { CrearClaseDto } from './dto/crear-clase.dto';
import { ActualizarClaseDto } from './dto/actualizar-clase.dto';
import type {
  ClaseCreadaRespuestaDto,
  ClaseRespuestaDto,
} from './dto/clase-respuesta.dto';

/**
 * Endpoints de clases bajo /api/v1/classes (AGENTS.md §8):
 * - POST  /     → crea una clase con código de unión generado por la BD.
 * - PATCH /:id  → edita nombre y/o estado (archivar/reactivar) de la
 *                 clase OWN :id del profesor autenticado.
 *
 * La creación NO declara @PerteneceA: ese guard verifica recursos
 * EXISTENTES por id de ruta y aquí la clase aún no existe (no hay :id),
 * así que solo exigiría un parámetro ausente y fallaría siempre
 * (docs/guard_pertenencia.md §3). La autorización se resuelve con el rol
 * teacher (@Roles) y la identidad del token (@UsuarioActual): el
 * teacher_id nunca se acepta del body.
 *
 * La edición sí declara @PerteneceA('clase', 'id'): una clase ajena o
 * inexistente responde 404 estándar antes de llegar al handler, y el
 * service re-verifica con la misma regla (segunda capa, AGENTS.md §8).
 */
@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

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
