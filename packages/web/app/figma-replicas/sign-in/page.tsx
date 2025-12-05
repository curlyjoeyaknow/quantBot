import SignIn from '@/components/sign-in';
import { MobileViewport } from '@/components/mobile-viewport';

export default function SignInPage() {
  return (
    <MobileViewport>
      <SignIn />
    </MobileViewport>
  );
}

