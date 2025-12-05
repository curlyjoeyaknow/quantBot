import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth/users';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { withErrorHandling } from '@/lib/middleware/error-handler';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const loginHandler = async (request: NextRequest) => {
  try {
    const body = await request.json();
    const validation = loginSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: validation.error.issues,
          },
        },
        { status: 400 }
      );
    }

    const { email, password } = validation.data;

    try {
      const { token, user } = await authenticateUser(email, password);

      return NextResponse.json({
        token,
        user: {
          id: user.userId,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (error: any) {
      return NextResponse.json(
        {
          error: {
            code: 'AUTHENTICATION_ERROR',
            message: error.message || 'Authentication failed',
          },
        },
        { status: 401 }
      );
    }
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      },
      { status: 500 }
    );
  }
};

export const POST = rateLimit(RATE_LIMITS.AUTH)(
  withErrorHandling(loginHandler)
);

