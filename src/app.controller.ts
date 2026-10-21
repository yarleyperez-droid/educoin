import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Publico } from './common/decorators/publico.decorator';

@ApiTags('Sistema')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Healthcheck público: confirma que la API responde, sin exponer datos.
  // Es la sonda que usan los tests e2e y los smoke para verificar el arranque.
  @Publico()
  @ApiOperation({
    summary: 'Healthcheck de la API',
    description:
      'Confirma que la API responde (sin datos ni autenticación). Es la sonda de los smoke tests.',
  })
  @ApiOkResponse({ type: String, description: 'La API está en línea.' })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
