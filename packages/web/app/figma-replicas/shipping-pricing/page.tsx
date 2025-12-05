import ShippingPricing from '@/components/shipping-pricing';
import { MobileViewport } from '@/components/mobile-viewport';

export default function ShippingPricingPage() {
  return (
    <MobileViewport>
      <ShippingPricing />
    </MobileViewport>
  );
}

