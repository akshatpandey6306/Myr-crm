import { SetMetadata, Injectable } from '@nestjs/common';

export const GET_USER_KEY = 'userId';

export const GetUser = () => SetMetadata(GET_USER_KEY, true);

@Injectable()
export class GetUserDecorator {}
