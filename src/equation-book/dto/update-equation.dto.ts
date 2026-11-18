import { PartialType } from '@nestjs/swagger';
import { CreateEquationDto } from './create-equation.dto';

export class UpdateEquationDto extends PartialType(CreateEquationDto) {}
