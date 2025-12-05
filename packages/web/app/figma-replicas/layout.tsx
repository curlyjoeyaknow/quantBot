import { ShopifyFlowProvider } from '@/components/shopify-flow-context';

export default function FigmaReplicasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ShopifyFlowProvider>{children}</ShopifyFlowProvider>;
}

