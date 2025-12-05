import figma from '@figma/code-connect';
import SetupOverview from './setup-overview';

/**
 * Code Connect mapping for Setup Overview component
 * This makes the component code visible in Figma Dev Mode
 */

figma.connect(
  SetupOverview,
  'https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=218-739',
  {
    example: () => <SetupOverview />,
    props: {},
  }
);

