import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { VkClientError } from '@/integrations/vk/vk-errors';

export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  readonly details?: any;

  constructor(message: string, details?: any) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
}

export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
  readonly code = 'UNAUTHORIZED';
}

export class VkReauthenticationRequiredError extends AppError {
  readonly statusCode = 401;
  readonly code = 'VK_REAUTHENTICATION_REQUIRED';
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';
}

export class VkPermissionRequiredError extends AppError {
  readonly statusCode = 403;
  readonly code = 'VK_PERMISSION_REQUIRED';
}

export class VkResourcePrivateError extends AppError {
  readonly statusCode = 403;
  readonly code = 'VK_RESOURCE_PRIVATE';
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';
}

export class IdempotencyKeyReusedError extends AppError {
  readonly statusCode = 409;
  readonly code = 'IDEMPOTENCY_KEY_REUSED';

  constructor(
    message: string = 'Idempotency key was previously used with different request parameters',
    details?: any
  ) {
    super(message, details);
  }
}

export class DrawAlreadyCompletedError extends AppError {
  readonly statusCode = 409;
  readonly code = 'DRAW_ALREADY_COMPLETED';

  constructor(
    message: string = 'Giveaway has already been drawn and finalized. Repeat draws are not permitted.',
    details?: any
  ) {
    super(message, details);
  }
}

export class RateLimitError extends AppError {
  readonly statusCode = 429;
  readonly code = 'RATE_LIMIT_EXCEEDED';
}

export class DependencyUnavailableError extends AppError {
  readonly statusCode = 503;
  readonly code = 'DEPENDENCY_UNAVAILABLE';
}

export class InternalError extends AppError {
  readonly statusCode = 500;
  readonly code = 'INTERNAL_SERVER_ERROR';
}

/**
 * Normalizes any error into a consistent JSON response
 */
export function handleApiError(error: unknown): NextResponse {
  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const formattedIssues = error.issues.map(i => ({
      path: i.path.join('.'),
      message: i.message,
    }));

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request payload',
          details: formattedIssues,
        },
      },
      { status: 400 }
    );
  }

  // Handle known AppErrors
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details || null,
        },
      },
      { status: error.statusCode }
    );
  }

  // Handle typed VK client errors safely without exposing tokens or internal structures
  if (error instanceof VkClientError) {
    switch (error.category) {
      case 'AUTH':
      case 'REAUTHENTICATION_REQUIRED':
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VK_REAUTHENTICATION_REQUIRED',
              message: 'VK authorization expired or required. Please reconnect your VK account.',
            },
          },
          { status: 401 }
        );

      case 'PERMISSION':
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VK_PERMISSION_REQUIRED',
              message: 'Insufficient VK permissions to access this resource or perform this action.',
            },
          },
          { status: 403 }
        );

      case 'PRIVATE_RESOURCE':
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VK_RESOURCE_PRIVATE',
              message: 'This VK resource or post is in a private/restricted community or profile.',
            },
          },
          { status: 403 }
        );

      case 'NOT_FOUND':
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VK_RESOURCE_NOT_FOUND',
              message: 'VK post or resource was not found. Please check the post URL.',
            },
          },
          { status: 404 }
        );

      case 'RATE_LIMIT':
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VK_RATE_LIMIT_EXCEEDED',
              message: 'VK API rate limit reached. Please retry in a few moments.',
            },
          },
          { status: 429 }
        );

      case 'TIMEOUT':
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VK_GATEWAY_TIMEOUT',
              message: 'VK API did not respond in time. Please try again.',
            },
          },
          { status: 504 }
        );

      default:
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VK_UPSTREAM_ERROR',
              message: 'A temporary error occurred while communicating with VK API.',
            },
          },
          { status: 502 }
        );
    }
  }

  // Handle SyntaxError (Malformed JSON in request body)
  if (error instanceof SyntaxError && 'body' in error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Malformed JSON payload in request body',
        },
      },
      { status: 400 }
    );
  }

  // Handle Prisma Known Request Errors
  const anyErr = error as any;
  if (anyErr?.code === 'P2002') {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'Resource conflict or duplicate constraint violation',
        },
      },
      { status: 409 }
    );
  }

  // Unexpected runtime errors
  console.error('Unhandled server error:', error);

  const isProd = process.env.NODE_ENV === 'production';
  const errorMessage = isProd
    ? 'An unexpected internal server error occurred'
    : (error instanceof Error ? error.message : 'Internal Server Error');

  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: errorMessage,
      },
    },
    { status: 500 }
  );
}
