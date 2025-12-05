import type { Mock, MockInstance, Mocked, SpyInstance, Vi } from 'vitest';

declare global {
  // Provide a Jest-compatible global that is backed by Vitest's `vi` mock API.
  // This keeps existing Jest-style tests working while we gradually migrate
  // them to idiomatic Vitest.
  // eslint-disable-next-line no-var
  var jest: Vi;

  namespace jest {
    // Re-export common Jest utility types in terms of Vitest equivalents.
    // These are intentionally minimal and can be extended as needed.
    type Mock<TArgs extends any[] = any[], TReturn = any> = Mock<TArgs, TReturn>;
    type SpyInstance<TArgs extends any[] = any[], TReturn = any> = SpyInstance<
      TArgs,
      TReturn
    >;
    type MockInstance<TArgs extends any[] = any[], TReturn = any> = MockInstance<
      TArgs,
      TReturn
    >;
    type Mocked<T> = Mocked<T>;
    type MockedFunction<T extends (...args: any[]) => any> = MockInstance<
      Parameters<T>,
      ReturnType<T>
    >;
    type MockedClass<T> = Mocked<T>;
  }
}

export {};


