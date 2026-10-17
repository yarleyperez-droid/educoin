import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Publico } from './common/decorators/publico.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Healthcheck público: confirma que la API responde, sin exponer datos.
  // Es la sonda que usan los tests e2e y los smoke para verificar el arranque.
  @Publico()
  @ApiOkResponse({ description: 'Mensaje de bienvenida (healthcheck, 200).' })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
