'use client';

/**
 * Shopify Flow Context
 * Shared state across all Shopify setup pages
 */

import { createContext, useContext, useState, ReactNode } from 'react';

interface Product {
  id: string;
  name: string;
  description: string;
  image: string | null;
}

interface ShopifyFlowState {
  shopName: string;
  products: Product[];
  price: string;
  shippingType: string;
  deliveryDays: number;
  notes: string;
}

interface ShopifyFlowContextType {
  state: ShopifyFlowState;
  setShopName: (name: string) => void;
  addProduct: (product: Omit<Product, 'id'>) => void;
  removeProduct: (id: string) => void;
  setPrice: (price: string) => void;
  setShippingType: (type: string) => void;
  setDeliveryDays: (days: number) => void;
  setNotes: (notes: string) => void;
  resetFlow: () => void;
}

const ShopifyFlowContext = createContext<ShopifyFlowContextType | undefined>(undefined);

export function ShopifyFlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ShopifyFlowState>({
    shopName: '',
    products: [],
    price: '39.99',
    shippingType: 'Standard Shipping',
    deliveryDays: 1,
    notes: '',
  });

  const setShopName = (name: string) => {
    setState(prev => ({ ...prev, shopName: name }));
  };

  const addProduct = (product: Omit<Product, 'id'>) => {
    const newProduct = {
      ...product,
      id: `product-${Date.now()}`,
    };
    setState(prev => ({ ...prev, products: [...prev.products, newProduct] }));
  };

  const removeProduct = (id: string) => {
    setState(prev => ({ ...prev, products: prev.products.filter(p => p.id !== id) }));
  };

  const setPrice = (price: string) => {
    setState(prev => ({ ...prev, price }));
  };

  const setShippingType = (type: string) => {
    setState(prev => ({ ...prev, shippingType: type }));
  };

  const setDeliveryDays = (days: number) => {
    setState(prev => ({ ...prev, deliveryDays: days }));
  };

  const setNotes = (notes: string) => {
    setState(prev => ({ ...prev, notes }));
  };

  const resetFlow = () => {
    setState({
      shopName: '',
      products: [],
      price: '39.99',
      shippingType: 'Standard Shipping',
      deliveryDays: 1,
      notes: '',
    });
  };

  return (
    <ShopifyFlowContext.Provider
      value={{
        state,
        setShopName,
        addProduct,
        removeProduct,
        setPrice,
        setShippingType,
        setDeliveryDays,
        setNotes,
        resetFlow,
      }}
    >
      {children}
    </ShopifyFlowContext.Provider>
  );
}

export function useShopifyFlow() {
  const context = useContext(ShopifyFlowContext);
  if (!context) {
    throw new Error('useShopifyFlow must be used within ShopifyFlowProvider');
  }
  return context;
}

