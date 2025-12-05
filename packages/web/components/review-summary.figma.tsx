import figma from '@figma/code-connect';
import ReviewSummary from './review-summary';

/**
 * Code Connect mapping for Review Summary component
 * This makes the component code visible in Figma Dev Mode
 * 
 * UPDATE THIS URL: After duplicating the frame in Figma, replace the node-id
 * with the node-id of your DUPLICATED frame
 */

// Note: Currently set to link to ORIGINAL frame since we don't have a duplicate yet
// If you create a duplicate, update this node-id
figma.connect(
  ReviewSummary,
  'https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=304-543', // Using Shipping as template
  {
    example: () => <ReviewSummary />,
    props: {},
  }
);

