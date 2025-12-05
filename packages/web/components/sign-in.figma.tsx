import figma from '@figma/code-connect';
import SignIn from './sign-in';

/**
 * Code Connect mapping for Sign In component
 * This makes the component code visible in Figma Dev Mode
 * 
 * Mapped to: https://www.figma.com/design/kBMg5IBOJ6RYT1DX0yr7kL/Testt?node-id=1-3064
 */

figma.connect(
  SignIn,
  'https://www.figma.com/design/kBMg5IBOJ6RYT1DX0yr7kL/Testt?node-id=7-583',
  {
    example: () => <SignIn />,
    props: {},
  }
);

