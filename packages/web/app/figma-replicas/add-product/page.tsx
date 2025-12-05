import AddProduct from '@/components/add-product';
import { MobileViewport } from '@/components/mobile-viewport';

export default function AddProductPage() {
  return (
    <MobileViewport>
      <AddProduct />
    </MobileViewport>
  );
}

