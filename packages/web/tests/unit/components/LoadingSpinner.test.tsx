/**
 * Unit tests for LoadingSpinner component
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LoadingSpinner } from '../../../app/components/ui/LoadingSpinner';

describe('LoadingSpinner', () => {
  it('renders loading spinner', () => {
    const { container } = render(<LoadingSpinner />);
    // Check for spinner element (has animate-spin class)
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });
});

