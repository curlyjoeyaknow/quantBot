'use client';

/**
 * Desktop Add Product Component
 * ==============================
 * Product addition step with:
 * - Image upload
 * - Product details
 * - Pricing
 * - Multiple products support
 */

import { useState } from 'react';
import { ArrowRight, ArrowLeft, Plus, X, Upload, Image as ImageIcon } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  price: string;
  description: string;
  image?: string;
}

interface DesktopAddProductProps {
  onContinue?: (products: Product[]) => void;
  onBack?: () => void;
  initialProducts?: Product[];
}

export function DesktopAddProduct({ 
  onContinue, 
  onBack, 
  initialProducts = [] 
}: DesktopAddProductProps) {
  const [products, setProducts] = useState<Product[]>(
    initialProducts.length > 0 
      ? initialProducts 
      : [{ id: '1', name: '', price: '', description: '', image: undefined }]
  );

  const addProduct = () => {
    setProducts([
      ...products,
      { id: Date.now().toString(), name: '', price: '', description: '', image: undefined },
    ]);
  };

  const removeProduct = (id: string) => {
    if (products.length > 1) {
      setProducts(products.filter((p) => p.id !== id));
    }
  };

  const updateProduct = (id: string, field: keyof Product, value: string) => {
    setProducts(products.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const handleContinue = () => {
    const validProducts = products.filter((p) => p.name.trim() && p.price.trim());
    if (validProducts.length > 0 && onContinue) {
      onContinue(validProducts);
    }
  };

  const isValid = products.some((p) => p.name.trim() && p.price.trim());

  return (
    <div className="flex h-screen bg-slate-900">
      <div className="flex-1 flex flex-col">
        {/* Progress Header */}
        <div className="bg-slate-800 border-b border-slate-700 p-6">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-2xl font-bold text-white">Add Products</h1>
              <span className="text-sm text-slate-400">Step 2 of 4</span>
            </div>
            
            <div className="relative h-2 bg-slate-700 rounded-full overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-indigo-600 rounded-full transition-all duration-300" style={{ width: '50%' }}></div>
            </div>
            
            <div className="flex justify-between mt-3 text-xs">
              <span className="text-slate-400">Overview</span>
              <span className="text-indigo-400 font-medium">Products</span>
              <span className="text-slate-500">Shipping</span>
              <span className="text-slate-500">Review</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-white mb-2">Your Products</h2>
              <p className="text-slate-400">Add one or more products to your shop</p>
            </div>

            {/* Products Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {products.map((product, index) => (
                <div key={product.id} className="bg-slate-800 border border-slate-700 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white">Product {index + 1}</h3>
                    {products.length > 1 && (
                      <button
                        onClick={() => removeProduct(product.id)}
                        className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-red-400"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    )}
                  </div>

                  <div className="space-y-4">
                    {/* Image Upload */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Product Image
                      </label>
                      <div className="relative">
                        {product.image ? (
                          <div className="relative aspect-video bg-slate-900 rounded-lg overflow-hidden border border-slate-700">
                            <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                            <button
                              onClick={() => updateProduct(product.id, 'image', '')}
                              className="absolute top-2 right-2 p-2 bg-slate-800 hover:bg-slate-700 rounded-lg"
                            >
                              <X className="h-4 w-4 text-slate-400" />
                            </button>
                          </div>
                        ) : (
                          <div className="aspect-video bg-slate-900 border-2 border-dashed border-slate-700 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-indigo-600 transition-colors">
                            <ImageIcon className="h-12 w-12 text-slate-600 mb-2" />
                            <p className="text-sm text-slate-500">Click to upload image</p>
                            <p className="text-xs text-slate-600 mt-1">PNG, JPG up to 10MB</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Product Name */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Product Name
                      </label>
                      <input
                        type="text"
                        value={product.name}
                        onChange={(e) => updateProduct(product.id, 'name', e.target.value)}
                        placeholder="e.g., Premium T-Shirt"
                        className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>

                    {/* Product Price */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Price (USD)
                      </label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={product.price}
                          onChange={(e) => updateProduct(product.id, 'price', e.target.value)}
                          placeholder="0.00"
                          className="w-full pl-8 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                      </div>
                    </div>

                    {/* Product Description */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Description (optional)
                      </label>
                      <textarea
                        value={product.description}
                        onChange={(e) => updateProduct(product.id, 'description', e.target.value)}
                        placeholder="Describe your product..."
                        rows={3}
                        className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Product Button */}
            <button
              onClick={addProduct}
              className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-slate-800 hover:bg-slate-700 border-2 border-dashed border-slate-700 hover:border-indigo-600 text-slate-300 hover:text-white font-semibold rounded-xl transition-all"
            >
              <Plus className="h-5 w-5" />
              Add Another Product
            </button>

            {/* Action Buttons */}
            <div className="flex gap-4 mt-8">
              <button
                onClick={onBack}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold rounded-xl transition-all"
              >
                <ArrowLeft className="h-5 w-5" />
                Back
              </button>
              <button
                onClick={handleContinue}
                disabled={!isValid}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all transform hover:scale-[1.02] disabled:transform-none"
              >
                Continue
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

