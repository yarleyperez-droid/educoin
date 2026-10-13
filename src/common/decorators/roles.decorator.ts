import { SetMetadata } from '@nestjs/common';
import type { user_role } from '../../generated/prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Declara los roles (AGENTS.md §5) con acceso a un endpoint o controlador.
 * Úsalo junto a @UseGuards(JwtAuthGuard, RolesGuard): JwtAuthGuard valida el
 * token y RolesGuard comprueba el rol del payload contra esta metadata.
 */
export const Roles = (
  ...roles: user_role[]
): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
