import figma from '@figma/code-connect';
import ShippingPricing from './shipping-pricing';

/**
 * Code Connect mapping for Shipping & Pricing component
 * This makes the component code visible in Figma Dev Mode
 */

figma.connect(
  ShippingPricing,
  'https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=304-543',
  {
    example: () => <ShippingPricing />,
    props: {},
  }
);

