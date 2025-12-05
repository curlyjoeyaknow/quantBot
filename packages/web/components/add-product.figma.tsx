import figma from '@figma/code-connect';
import AddProduct from './add-product';

/**
 * Code Connect mapping for Add Product component
 * This makes the component code visible in Figma Dev Mode
 */

figma.connect(
  AddProduct,
  'https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=218-762',
  {
    example: () => <AddProduct />,
    props: {},
  }
);

