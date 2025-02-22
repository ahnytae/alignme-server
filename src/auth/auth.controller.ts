import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import axios from 'axios';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Response, Request } from 'express';
import { AuthService, ReturnValidateUser } from './auth.service';
import { Public } from 'src/public.decorator';
import { UtilsService } from '../utils/utils.service';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { SignInResponse } from './model/auth.response';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly utilsService: UtilsService,
  ) {}

  @ApiOperation({
    description: '카톡 소셜 로그인 인증 + 유저 가입처리',
  })
  @ApiQuery({
    name: 'type',
    description: '어드민 로그인 인지 앱 로그인 인지',
  })
  @ApiQuery({
    name: 'code',
    description: '클라이언트에서 redirect uri에 포함된 code',
  })
  @ApiCreatedResponse({
    description:
      'isAlready: true => 이미 회원가입단계 끝낸 유저, false => ~ 안끝낸유저',
    type: SignInResponse,
  })
  @Get('/user/login')
  async login(
    @Query('type') type: 'admin' | 'user',
    @Query('code') code: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const GET_TOKEN_URL = this.configService.get('GET_TOKEN_URL');
    const GET_USER_INFO_URL = this.configService.get('GET_USER_INFO_URL');
    const GRANT_TYPE = this.configService.get('GRANT_TYPE');
    const CLIENT_ID = this.configService.get('KAKAO_ID');
    const REDIRECT_URI = this.configService.get(
      type === 'user' ? 'KAKAO_REDIRECT_URI_USER' : 'KAKAO_REDIRECT_URI_ADMIN',
    );

    const requestBody = this.utilsService.formUrlEncoded({
      grant_type: GRANT_TYPE,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
    });

    if (!CLIENT_ID || !REDIRECT_URI) {
      throw new HttpException(
        'Kakao credentials are not properly configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      // 1. 토큰 받기
      const { data } = await axios.post(GET_TOKEN_URL, requestBody);
      // 2. 받은 토큰으로 유저 정보 받기
      const { data: userInfo } = await axios.get(GET_USER_INFO_URL, {
        headers: {
          Authorization: 'Bearer ' + data.access_token,
        },
      });

      const authPayload = {
        kakaoMemberId: userInfo.id,
        email: userInfo.kakao_account.email,
        // name: userInfo.kakao_account.name,
        name: userInfo.kakao_account.profile.nickname,
        // profile_image: userInfo.kakao_account.profile.profile_image_url,
      };

      // 기존 유저있는지 확인
      const { isAlready, accessToken, refreshToken }: ReturnValidateUser =
        await this.authService.validateUser(authPayload);

      res.cookie('refreshToken', refreshToken, {
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        domain: 'localhost',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      });

      res.status(200).json({
        message: 'login successful',
        data: {
          isAlready,
          accessToken,
          ...authPayload,
        },
      });
    } catch (error) {
      console.log('error', error);
      throw new NotFoundException('Login failed');
    }
  }

  @ApiOperation({
    description: 'refresh token 갱신',
  })
  @ApiBody({
    description: '호출시 refresh token body에 포함',
    schema: {
      type: 'object',
      properties: {
        refreshToken: {
          type: 'string',
        },
      },
    },
    type: String,
  })
  @Public()
  @Post('refresh')
  async refreshToken(@Req() req: Request) {
    const refreshToken = req.cookies['refreshToken'];
    const tokens = await this.authService.refreshToken(refreshToken);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  // @ApiOperation({
  //   description: '로그아웃',
  // })
  // @ApiBody({
  //   description: '로그아웃할 유저의 kakaoMemberId',
  //   schema: {
  //     type: 'object',
  //     properties: {
  //       kakaoMemberId: {
  //         type: 'string',
  //       },
  //     },
  //   },
  //   type: String,
  // })
  // @Post('logout')
  // async logout(@Req() request: Request) {
  //   const accessToken = request.cookies['accessToken'];
  //
  //   await this.authService.logout(+accessToken);
  //   return { message: 'Logout successful' };
  // }
}
