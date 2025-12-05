import { NextRequest, NextResponse } from 'next/server';
import { userStore } from '@/lib/auth/users';
import { UserRole } from '@/lib/middleware/auth';
import { generateToken } from '@/lib/middleware/auth';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { withErrorHandling } from '@/lib/middleware/error-handler';

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
  role: z.nativeEnum(UserRole).optional().default(UserRole.USER),
});

const registerHandler = async (request: NextRequest) => {
  try {
    const body = await request.json();
    const validation = registerSchema.safeParse(body);

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

    const { email, password, name, role } = validation.data;

    try {
      const user = await userStore.createUser(email, password, name, role);
      const token = await generateToken({
        userId: user.id,
        role: user.role,
        email: user.email,
        name: user.name,
      });

      return NextResponse.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      }, { status: 201 });
    } catch (error: any) {
      if (error.message.includes('already exists')) {
        return NextResponse.json(
          {
            error: {
              code: 'USER_EXISTS',
              message: error.message,
            },
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          error: {
            code: 'REGISTRATION_ERROR',
            message: error.message || 'Registration failed',
          },
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Registration error:', error);
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
  withErrorHandling(registerHandler)
);

