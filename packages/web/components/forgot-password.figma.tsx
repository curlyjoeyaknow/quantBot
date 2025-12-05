import figma from '@figma/code-connect';
import ForgotPassword from './forgot-password';

/**
 * Code Connect mapping for Forgot Password component
 * This makes the component code visible in Figma Dev Mode
 * 
 * UPDATE THIS URL: After duplicating the frame in Figma, replace the node-id
 * with the node-id of your DUPLICATED frame
 */

// Note: Currently set to link to ORIGINAL frame since we don't have a duplicate yet
// If you create a duplicate, update this node-id
figma.connect(
  ForgotPassword,
  'https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=144-2360', // Using Sign In as template
  {
    example: () => <ForgotPassword />,
    props: {},
  }
);

