import RegisterAccount from '@/components/register-account';
import { MobileViewport } from '@/components/mobile-viewport';

export default function RegisterPage() {
  return (
    <MobileViewport>
      <RegisterAccount />
    </MobileViewport>
  );
}

