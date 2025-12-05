import ReviewSummary from '@/components/review-summary';
import { MobileViewport } from '@/components/mobile-viewport';

export default function ReviewPage() {
  return (
    <MobileViewport>
      <ReviewSummary />
    </MobileViewport>
  );
}

