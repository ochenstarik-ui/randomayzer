import { NextRequest, NextResponse } from 'next/server';
import { defaultSessionStore, clearSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { handleApiError } from '@/core/errors/http-errors';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (sessionId) {
      await defaultSessionStore.destroySession(sessionId);
    }

    const response = NextResponse.json({
      success: true,
      message: 'Logged out successfully',
    });

    clearSessionCookie(response);
    return response;
  } catch (error: any) {
    return handleApiError(error);
  }
}
