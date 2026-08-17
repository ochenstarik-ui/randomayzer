import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { handleApiError } from '@/core/errors/http-errors';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionFromRequest(req);

    if (!user) {
      return NextResponse.json({
        authenticated: false,
        user: null,
      });
    }

    // Return safe user profile only (NO access token, refresh token, or secrets)
    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        vkUserId: user.vkUserId,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
