/**
 * Mini App Strategies API
 * ======================
 * Handles strategy CRUD operations for the Mini App.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { withValidation } from '@/lib/middleware/validation';
import { z } from 'zod';

const StrategySchema = z.object({
  userId: z.number(),
  name: z.string().min(1),
  description: z.string().optional(),
  strategy: z.array(z.object({
    percent: z.number().min(0).max(1),
    target: z.number().positive(),
  })),
  stopLossConfig: z.object({
    initial: z.number().min(-0.99).max(0),
    trailing: z.union([z.number().min(0).max(10), z.literal('none')]).default('none'),
  }).optional(),
  isDefault: z.boolean().optional(),
});

export const GET = withErrorHandling(async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams;
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json(
      { error: { message: 'userId is required' } },
      { status: 400 }
    );
  }

  try {
    // TODO: Fetch from database
    // const strategies = await getUserStrategies(parseInt(userId, 10));

    return NextResponse.json({
      data: [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: { message: error.message || 'Failed to fetch strategies' } },
      { status: 500 }
    );
  }
});

export const POST = withErrorHandling(
  withValidation({ body: StrategySchema })(async (request: NextRequest, validated) => {
    const data = validated.body!;
    try {
      // TODO: Save to database
      // const id = await saveStrategy(data);

      return NextResponse.json({
        data: { id: Date.now(), ...data },
      });
    } catch (error: any) {
      return NextResponse.json(
        { error: { message: error.message || 'Failed to save strategy' } },
        { status: 500 }
      );
    }
  })
);

export const PUT = withErrorHandling(
  withValidation({ body: StrategySchema.extend({ id: z.number() }) })(async (request: NextRequest, validated) => {
    const data = validated.body!;
    try {
      // TODO: Update in database
      // await updateStrategy(data.id, data);

      return NextResponse.json({
        data: { ...data },
      });
    } catch (error: any) {
      return NextResponse.json(
        { error: { message: error.message || 'Failed to update strategy' } },
        { status: 500 }
      );
    }
  })
);

export const DELETE = withErrorHandling(async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams;
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json(
      { error: { message: 'id is required' } },
      { status: 400 }
    );
  }

  try {
    // TODO: Delete from database
    // await deleteStrategy(parseInt(id, 10));

    return NextResponse.json({
      data: { success: true },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: { message: error.message || 'Failed to delete strategy' } },
      { status: 500 }
    );
  }
});

