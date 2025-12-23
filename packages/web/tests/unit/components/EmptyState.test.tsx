/**
 * Unit tests for EmptyState component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '../../../app/components/ui/EmptyState';

describe('EmptyState', () => {
  it('renders empty state with message', () => {
    render(<EmptyState message="No data available" />);

    expect(screen.getByText('No data available')).toBeTruthy();
  });

  it('renders with description', () => {
    render(
      <EmptyState
        message="No data available"
        description="Please try again later"
      />
    );

    expect(screen.getByText('No data available')).toBeTruthy();
    expect(screen.getByText('Please try again later')).toBeTruthy();
  });
});

