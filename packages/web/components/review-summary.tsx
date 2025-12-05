'use client';

/**
 * Review Summary Component
 * Shows summary of all added products and settings before final submission
 */

import { useShopifyFlow } from './shopify-flow-context';

// Image assets from Figma (reusing from other pages)
const imgFigma = 'https://www.figma.com/api/mcp/asset/c538fa3b-6fb2-4c8e-a9d2-fa36c216ad92';
const imgXLogo = 'https://www.figma.com/api/mcp/asset/2300226d-2617-4c47-bc41-2f898171b2df';
const imgLogoInstagram = 'https://www.figma.com/api/mcp/asset/f7d1a7a0-05d5-4563-8e6f-de3eb1af7f14';
const imgLogoYouTube = 'https://www.figma.com/api/mcp/asset/611fb802-aefc-4f17-990b-f5abc175e1d7';
const imgLinkedIn = 'https://www.figma.com/api/mcp/asset/e4905b4b-e4d3-41c0-8b6f-b675a4ff3ff3';
const img1 = 'https://www.figma.com/api/mcp/asset/c10968a3-6eb8-4232-aaa4-555f453eab49';

export default function ReviewSummary() {
  const { state } = useShopifyFlow();

  const getDeliveryText = () => {
    if (state.deliveryDays === 0) return 'Same Day';
    if (state.deliveryDays === 1) return '1 Day';
    return `${state.deliveryDays} Days`;
  };

  return (
    <div
      className="bg-[#0a3a32] content-stretch flex flex-col gap-[10px] items-start relative size-full"
      data-name="REVIEW SUMMARY"
    >
      {/* Footer */}
      <div className="absolute bg-[#b8e0d2] bottom-0 content-stretch flex flex-col h-[65px] items-center justify-center left-[2px] overflow-clip px-6 py-3 rounded-[10px] w-[440px] z-10">
        <div className="content-stretch flex items-center justify-between min-w-[240px] relative shrink-0 w-full">
          <div className="h-[35px] relative shrink-0 w-[23.333px]">
            <div className="absolute inset-[-5%_-7.5%]">
              <img alt="" className="block max-w-none size-full" src={imgFigma} />
            </div>
          </div>
          <div className="content-stretch flex gap-[var(--sds-size-space-400,16px)] items-center relative shrink-0">
            <div className="h-[24px] relative shrink-0 w-[23.98px]">
              <img alt="" className="block max-w-none size-full" src={imgXLogo} />
            </div>
            <div className="relative shrink-0 size-[24px]">
              <img alt="" className="block max-w-none size-full" src={imgLogoInstagram} />
            </div>
            <div className="relative shrink-0 size-[24px]">
              <img alt="" className="block max-w-none size-full" src={imgLogoYouTube} />
            </div>
            <div className="relative shrink-0 size-[24px]">
              <img alt="" className="block max-w-none size-full" src={imgLinkedIn} />
            </div>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="content-stretch flex h-[126px] items-start relative shrink-0 w-full z-0">
        <button className="bg-[#b8e0d2] border-[var(--sds-color-border-default-default,#d9d9d9)] border-b border-l-0 border-r-0 border-solid border-t-0 content-center cursor-pointer flex flex-[1_0_0] flex-wrap h-full items-center justify-between min-h-px min-w-px overflow-clip p-[var(--sds-size-space-600,24px)] relative shrink-0 pointer-events-auto" />
      </div>

      {/* Logo Menu */}
      <button
        type="button"
        className="absolute bg-[rgba(10,58,50,0)] block cursor-pointer h-[55px] left-[20px] top-[50px] w-[53.571px] z-20 pointer-events-auto"
      >
        <div className="absolute border-[#0a3a32] border-[3px] border-solid inset-0 rounded-[30px] pointer-events-none">
          <img alt="" className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none rounded-[30px] size-full" src={img1} />
        </div>
      </button>

      {/* Shopify Title */}
      <div className="absolute font-['Albert_Sans:Black',sans-serif] font-black h-[76px] leading-[1.2] left-[168.5px] text-[#0a3a32] text-[46px] text-center top-[50px] tracking-[-1.38px] translate-x-[-50%] w-[237px] whitespace-pre-wrap z-10 pointer-events-none">
        <p className="mb-0">Shopify</p>
        <p>&nbsp;</p>
      </div>

      {/* Progress */}
      <div className="absolute h-[27px] left-1/2 top-[150px] translate-x-[-50%] w-[402px] pointer-events-none">
        <div className="absolute bg-neutral-100 h-[4px] left-[16px] right-[16px] top-1/2 translate-y-[-50%]">
          <div className="absolute bg-[#1e1e1e] h-[4px] left-0 right-0 rounded-[100px] top-1/2 translate-y-[-50%]" />
        </div>
      </div>
      <p className="absolute font-['Albert_Sans:SemiBold',sans-serif] font-semibold leading-none left-[calc(50%+-111px)] text-[20px] text-white top-[135px] pointer-events-none">
        4 OUT OF 4 COMPLETE
      </p>

      {/* Title with Back Button */}
      <div className="absolute flex items-center gap-4 left-[calc(50%+0.5px)] top-[205px] translate-x-[-50%]">
        <a
          href="/figma-replicas/shipping-pricing"
          className="flex items-center justify-center w-[40px] h-[40px] bg-white rounded-full hover:bg-neutral-100 transition-colors no-underline z-10"
          aria-label="Go back to shipping"
        >
          <span className="text-[#0a3a32] text-[20px]">←</span>
        </a>
        <p className="font-['Albert_Sans:Black',sans-serif] font-black text-[42px] text-white m-0 pointer-events-none">
          REVIEW
        </p>
      </div>

      {/* Summary Card */}
      <div className="absolute bg-[#b8e0d2] left-[20px] top-[260px] w-[400px] rounded-lg p-6 z-10 max-h-[500px] overflow-y-auto">
        {/* Shop Name */}
        <div className="mb-6">
          <h3 className="text-[#0a3a32] font-['Albert_Sans:Black',sans-serif] font-black text-[20px] mb-2">
            Shop Name
          </h3>
          <p className="text-[#0a3a32] text-[16px]">
            {state.shopName || <span className="italic text-[#757575]">Not set</span>}
          </p>
        </div>

        {/* Products */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[#0a3a32] font-['Albert_Sans:Black',sans-serif] font-black text-[20px]">
              Products ({state.products.length})
            </h3>
            <a
              href="/figma-replicas/add-product"
              className="text-[#0a3a32] text-[14px] underline hover:no-underline"
            >
              Edit
            </a>
          </div>
          {state.products.length === 0 ? (
            <p className="text-[#757575] italic text-[14px]">No products added yet</p>
          ) : (
            <div className="space-y-3">
              {state.products.map((product) => (
                <div key={product.id} className="flex gap-3 bg-white/30 p-3 rounded">
                  {product.image && (
                    <img src={product.image} alt={product.name} className="w-[60px] h-[60px] object-cover rounded" />
                  )}
                  <div className="flex-1">
                    <p className="text-[#0a3a32] font-semibold text-[14px]">{product.name}</p>
                    <p className="text-[#0a3a32] text-[12px]">{product.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pricing */}
        <div className="mb-6">
          <h3 className="text-[#0a3a32] font-['Albert_Sans:Black',sans-serif] font-black text-[20px] mb-2">
            Pricing
          </h3>
          <p className="text-[#0a3a32] text-[24px] font-bold">${state.price} ea</p>
        </div>

        {/* Shipping */}
        <div className="mb-6">
          <h3 className="text-[#0a3a32] font-['Albert_Sans:Black',sans-serif] font-black text-[20px] mb-2">
            Shipping
          </h3>
          <div className="space-y-2 text-[#0a3a32]">
            <p><span className="font-semibold">Method:</span> {state.shippingType}</p>
            <p><span className="font-semibold">Delivery:</span> {getDeliveryText()}</p>
            {state.notes && <p><span className="font-semibold">Notes:</span> {state.notes}</p>}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="absolute flex gap-4 left-1/2 top-[calc(50%+350px)] translate-x-[-50%] translate-y-[-50%] z-10">
        <a
          href="/figma-replicas/add-product"
          className="bg-[#2c2c2c] border border-[#2c2c2c] px-6 py-3 rounded-lg text-white font-['Albert_Sans:Black',sans-serif] font-black text-[16px] no-underline hover:bg-[#1c1c1c] transition-colors"
        >
          ← BACK TO PRODUCTS
        </a>
        <button
          type="button"
          className="bg-neutral-100 border border-neutral-100 px-6 py-3 rounded-lg text-[#0a3a32] font-['Albert_Sans:Black',sans-serif] font-black text-[16px] hover:bg-neutral-200 transition-colors"
        >
          LAUNCH SHOP! 🚀
        </button>
      </div>
    </div>
  );
}

