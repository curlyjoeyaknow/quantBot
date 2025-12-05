'use client';

/**
 * Shipping and Pricing Component
 * Exact replica of Figma design: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=304-543&m=dev
 * Fixed: Input fields now use actual <input> elements for proper interaction
 */

import { useState } from 'react';

// Image assets from Figma
const img1 = 'https://www.figma.com/api/mcp/asset/c10968a3-6eb8-4232-aaa4-555f453eab49';
const img = 'https://www.figma.com/api/mcp/asset/6e25de13-00fb-4bec-9d53-43f10b2fb92a';
const imgFigma = 'https://www.figma.com/api/mcp/asset/c538fa3b-6fb2-4c8e-a9d2-fa36c216ad92';
const imgXLogo = 'https://www.figma.com/api/mcp/asset/2300226d-2617-4c47-bc41-2f898171b2df';
const imgLogoInstagram = 'https://www.figma.com/api/mcp/asset/f7d1a7a0-05d5-4563-8e6f-de3eb1af7f14';
const imgLogoYouTube = 'https://www.figma.com/api/mcp/asset/611fb802-aefc-4f17-990b-f5abc175e1d7';
const imgLinkedIn = 'https://www.figma.com/api/mcp/asset/e4905b4b-e4d3-41c0-8b6f-b675a4ff3ff3';
const imgVector = 'https://www.figma.com/api/mcp/asset/2f262cb0-ac3f-493f-81ef-30363ee38fca';

interface AccountCircleProps {
  className?: string;
  property1?: 'NO STATE' | 'HOVER STATE';
}

function AccountCircle({ className, property1 = 'NO STATE' }: AccountCircleProps) {
  return (
    <div className={className} data-name="Property 1=NO STATE" data-node-id="264:939">
      <div className="absolute inset-0 overflow-clip" data-name="account_circle" data-node-id="264:937">
        <div className="absolute inset-[8.33%]" data-name="icon" data-node-id="I264:937;54616:25460">
          <div className="absolute inset-0" style={{ '--fill-0': 'rgba(29, 27, 32, 1)' } as React.CSSProperties}>
            <img alt="" className="block max-w-none size-full" src={img} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ShippingAndPricing() {
  const [price, setPrice] = useState('39.99');
  const [priceModified, setPriceModified] = useState(false);
  const [shippingType, setShippingType] = useState('Standard Shipping');
  const [deliveryDays, setDeliveryDays] = useState(1);
  const [notes, setNotes] = useState('');

  const shippingOptions = [
    'Same Day Delivery',
    'Next Day Delivery',
    'Express Shipping',
    'Standard Shipping',
    'International Shipping',
    'Free Shipping',
  ];

  const handleShippingTypeChange = (type: string) => {
    setShippingType(type);
    // Auto-set delivery days based on shipping type
    switch (type) {
      case 'Same Day Delivery':
        setDeliveryDays(0);
        break;
      case 'Next Day Delivery':
        setDeliveryDays(1);
        break;
      case 'Express Shipping':
        setDeliveryDays(2);
        break;
      case 'Standard Shipping':
        setDeliveryDays(5);
        break;
      case 'International Shipping':
        setDeliveryDays(10);
        break;
      case 'Free Shipping':
        setDeliveryDays(7);
        break;
      default:
        setDeliveryDays(1);
    }
  };

  const handleDeliveryIncrement = () => {
    setDeliveryDays(prev => Math.min(prev + 1, 30));
  };

  const handleDeliveryDecrement = () => {
    setDeliveryDays(prev => Math.max(prev - 1, 0));
  };

  const handlePriceChange = (newPrice: string) => {
    setPrice(newPrice);
    if (newPrice !== '39.99') {
      setPriceModified(true);
    }
  };

  const getDeliveryText = () => {
    if (deliveryDays === 0) return 'Same Day';
    if (deliveryDays === 1) return '1 Day';
    return `${deliveryDays} Days`;
  };

  return (
    <div
      className="bg-[#0a3a32] content-stretch flex flex-col gap-[10px] items-start relative size-full"
      data-name="SHIPPING AND PRICING"
      data-node-id="304:543"
    >
      {/* Footer */}
      <div
        className="absolute bg-[#b8e0d2] bottom-0 content-stretch flex flex-col h-[65px] items-center justify-center left-[2px] overflow-clip px-6 py-3 rounded-[10px] w-[440px] z-10"
        data-name="Footer"
        data-node-id="304:544"
      >
        <div
          className="content-stretch flex items-center justify-between min-w-[240px] relative shrink-0 w-full"
          data-name="Title"
          data-node-id="304:545"
        >
          <div className="h-[35px] relative shrink-0 w-[23.333px]" data-name="Figma" data-node-id="304:546">
            <div className="absolute inset-[-5%_-7.5%]">
              <img alt="" className="block max-w-none size-full" src={imgFigma} />
            </div>
          </div>
          <div
            className="content-stretch flex gap-[var(--sds-size-space-400,16px)] items-center relative shrink-0"
            data-name="Button List"
            data-node-id="304:548"
          >
            <div className="h-[24px] relative shrink-0 w-[23.98px]" data-name="X Logo" data-node-id="304:549">
              <img alt="" className="block max-w-none size-full" src={imgXLogo} />
            </div>
            <div className="relative shrink-0 size-[24px]" data-name="Logo Instagram" data-node-id="304:551">
              <img alt="" className="block max-w-none size-full" src={imgLogoInstagram} />
            </div>
            <div className="relative shrink-0 size-[24px]" data-name="Logo YouTube" data-node-id="304:553">
              <img alt="" className="block max-w-none size-full" src={imgLogoYouTube} />
            </div>
            <div className="relative shrink-0 size-[24px]" data-name="LinkedIn" data-node-id="304:555">
              <img alt="" className="block max-w-none size-full" src={imgLinkedIn} />
            </div>
          </div>
        </div>
      </div>

      {/* White header 7 */}
      <div
        className="content-stretch flex h-[126px] items-start relative shrink-0 w-full z-0"
        data-name="White header 7"
        data-node-id="322:770"
      >
        <button
          className="bg-[#b8e0d2] border-[var(--sds-color-border-default-default,#d9d9d9)] border-b border-l-0 border-r-0 border-solid border-t-0 content-center cursor-pointer flex flex-[1_0_0] flex-wrap h-full items-center justify-between min-h-px min-w-px overflow-clip p-[var(--sds-size-space-600,24px)] relative shrink-0 pointer-events-auto"
          data-name="White header"
          data-node-id="I322:770;29:837"
        />
      </div>

      {/* Price display - only show if not modified */}
      {!priceModified && (
        <div
          className="absolute content-stretch flex items-end justify-center not-italic left-[93px] top-[334px] text-[#0a3a32] pointer-events-none"
          data-name="Text Price"
          data-node-id="304:719"
        >
          <div
            className="content-stretch flex font-[family-name:var(--sds-typography-title-page-font-family,'Inter:Bold',sans-serif)] font-[var(--sds-typography-title-page-font-weight,700)] items-start leading-none relative shrink-0 tracking-[-0.96px]"
            data-name="Price"
            data-node-id="I304:719;2144:3712"
          >
            <p className="relative shrink-0 text-[48px] m-0">$</p>
            <p className="relative shrink-0 text-[length:var(--sds-typography-title-page-size-base,48px)] m-0">
              {price}
            </p>
          </div>
          <p className="font-[family-name:var(--sds-typography-body-font-family,'Inter:Regular',sans-serif)] font-[var(--sds-typography-body-font-weight-regular,400)] leading-[1.8] relative shrink-0 text-[length:var(--sds-typography-body-size-small,14px)] m-0">
            ea
          </p>
        </div>
      )}

      {/* REVIEW Button */}
      <a
        href="/figma-replicas/review"
        className="absolute content-stretch cursor-pointer flex h-[59px] items-start left-[calc(50%+-2px)] p-0 top-[calc(50%+351px)] translate-x-[-50%] translate-y-[-50%] z-10 no-underline"
        data-name="Button/Default"
        data-node-id="304:562"
      >
        <div
          className="bg-neutral-100 border border-[var(--sds-color-icon-neutral-on-neutral,#f3f3f3)] border-solid content-stretch flex gap-[var(--sds-size-space-200,8px)] h-[47px] items-center justify-center overflow-clip p-[var(--sds-size-space-300,12px)] relative rounded-[var(--sds-size-radius-200,8px)] shrink-0 w-[398px] hover:bg-neutral-200 transition-colors"
          data-name="Button"
          data-node-id="I304:562;233:1916"
        >
          <p
            className="font-['Albert_Sans:Black',sans-serif] font-black leading-[1.2] relative shrink-0 text-[#0a3a32] text-[24px] m-0"
            data-node-id="I304:562;233:1916;4185:3781"
          >
            REVIEW
          </p>
        </div>
      </a>

      {/* Shopify Title */}
      <div
        className="absolute font-['Albert_Sans:Black',sans-serif] font-black h-[76px] leading-[1.2] left-[168.5px] text-[#0a3a32] text-[46px] text-center top-[50px] tracking-[-1.38px] translate-x-[-50%] w-[237px] whitespace-pre-wrap z-10 pointer-events-none"
        data-node-id="304:566"
      >
        <p className="mb-0">Shopify</p>
        <p>&nbsp;</p>
      </div>

      {/* Logo Menu drop down button */}
      <button
        type="button"
        className="absolute bg-[rgba(10,58,50,0)] block cursor-pointer h-[55px] left-[20px] top-[50px] w-[53.571px] z-20 pointer-events-auto"
        data-name="Logo Menu drop down button/Default"
        data-node-id="304:565"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div
          className="absolute border-[#0a3a32] border-[3px] border-solid inset-0 rounded-[30px] pointer-events-none"
          data-name="Logo Menu drop down button"
          data-node-id="I304:565;148:4590"
        >
          <img
            alt=""
            className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none rounded-[30px] size-full"
            src={img1}
          />
        </div>
      </button>

      {/* Progress Bar */}
      <div
        className="absolute h-[27px] left-1/2 top-[150px] translate-x-[-50%] w-[402px] pointer-events-none"
        data-name="Progress Bar"
        data-node-id="304:575"
      >
        <div
          className="absolute bg-neutral-100 h-[4px] left-[16px] right-[16px] top-1/2 translate-y-[-50%]"
          data-name="Track"
          data-node-id="I304:575;495:46303"
        >
          <div
            className="absolute bg-[#1e1e1e] h-[4px] left-0 right-[31.58%] rounded-[100px] top-1/2 translate-y-[-50%]"
            data-name="Filled"
            data-node-id="I304:575;495:46304"
          />
        </div>
      </div>

      {/* Progress text */}
      <p
        className="absolute font-['Albert_Sans:SemiBold',sans-serif] font-semibold leading-none left-[calc(50%+-111px)] text-[20px] text-white top-[135px] pointer-events-none"
        data-node-id="304:576"
      >
        3 OUT OF 4 COMPLETE
      </p>

      {/* Title with Back Button */}
      <div className="absolute flex items-center gap-4 left-[calc(50%+0.5px)] top-[195px] translate-x-[-50%]">
        <a
          href="/figma-replicas/add-product"
          className="flex items-center justify-center w-[40px] h-[40px] bg-white rounded-full hover:bg-neutral-100 transition-colors no-underline z-10"
          aria-label="Go back to add product"
        >
          <span className="text-[#0a3a32] text-[20px]">←</span>
        </a>
        <p
          className="font-['Albert_Sans:Black',sans-serif] font-black text-[42px] text-white m-0 pointer-events-none"
          data-node-id="304:700"
        >{`SHIPPING & PRICING`}</p>
      </div>

      {/* Input Field 1 - Price */}
      <div className="absolute bg-[#b8e0d2] h-[70px] left-[55px] top-[309px] w-[366px] z-10 flex items-center" data-node-id="304:745">
        <span className="text-[#0a3a32] text-[24px] font-bold pl-4">$</span>
        <input
          type="number"
          step="0.01"
          value={price}
          onChange={(e) => handlePriceChange(e.target.value)}
          className="flex-1 h-full bg-transparent border-0 outline-none px-2 text-[#0a3a32] text-[24px] font-bold focus:ring-2 focus:ring-[#0a3a32] focus:ring-inset rounded"
        />
        <span className="text-[#0a3a32] text-[14px] pr-4">ea</span>
      </div>

      {/* Input Field 2 - Shipping Type (Dropdown) */}
      <div className="absolute bg-[#b8e0d2] h-[70px] left-[55px] top-[439px] w-[366px] z-10" data-node-id="304:753">
        <select
          value={shippingType}
          onChange={(e) => handleShippingTypeChange(e.target.value)}
          className="w-full h-full bg-transparent border-0 outline-none px-4 text-[#0a3a32] text-[18px] font-medium focus:ring-2 focus:ring-[#0a3a32] focus:ring-inset rounded cursor-pointer"
        >
          {shippingOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {/* Input Field 3 - Delivery Time (Increment/Decrement) */}
      <div className="absolute bg-[#b8e0d2] h-[70px] left-[55px] top-[569px] w-[366px] z-10 flex items-center justify-between px-4" data-node-id="304:754">
        <button
          type="button"
          onClick={handleDeliveryDecrement}
          className="w-[40px] h-[40px] bg-[#0a3a32] text-white rounded-full hover:bg-[#0d4a3e] transition-colors flex items-center justify-center text-[24px] font-bold"
        >
          −
        </button>
        <span className="text-[#0a3a32] text-[20px] font-semibold">
          {getDeliveryText()}
        </span>
        <button
          type="button"
          onClick={handleDeliveryIncrement}
          className="w-[40px] h-[40px] bg-[#0a3a32] text-white rounded-full hover:bg-[#0d4a3e] transition-colors flex items-center justify-center text-[24px] font-bold"
        >
          +
        </button>
      </div>

      {/* Input Field 4 - Notes */}
      <div className="absolute bg-[#b8e0d2] h-[70px] left-[55px] top-[699px] w-[366px] z-10" data-node-id="304:755">
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Additional notes..."
          className="w-full h-full bg-transparent border-0 outline-none px-4 text-[#0a3a32] text-[16px] focus:ring-2 focus:ring-[#0a3a32] focus:ring-inset rounded placeholder-[#0a3a32]/40"
        />
      </div>

      {/* Number badges */}
      <div className="absolute bg-[#b8e0d2] h-[42px] left-[3px] top-[323px] w-[44px] z-10 flex items-center justify-center" data-node-id="304:778">
        <p className="font-['Inter:Bold',sans-serif] font-bold leading-none not-italic text-[24px] text-black tracking-[-0.48px] m-0">
          1
        </p>
      </div>
      <div className="absolute bg-[#b8e0d2] h-[42px] left-[3px] top-[451px] w-[44px] z-10 flex items-center justify-center" data-node-id="304:779">
        <p className="font-['Inter:Bold',sans-serif] font-bold leading-none not-italic text-[24px] text-black tracking-[-0.48px] m-0">
          2
        </p>
      </div>
      <div className="absolute bg-[#b8e0d2] h-[42px] left-[3px] top-[579px] w-[44px] z-10 flex items-center justify-center" data-node-id="304:780">
        <p className="font-['Inter:Bold',sans-serif] font-bold leading-none not-italic text-[24px] text-black tracking-[-0.48px] m-0">
          3
        </p>
      </div>
      <div className="absolute bg-[#b8e0d2] h-[42px] left-[3px] top-[707px] w-[44px] z-10 flex items-center justify-center" data-node-id="304:781">
        <p className="font-['Inter:Bold',sans-serif] font-bold leading-none not-italic text-[24px] text-black tracking-[-0.48px] m-0">
          4
        </p>
      </div>

      {/* Checkmark icon */}
      <div className="absolute h-[20.33px] left-[93px] top-[334px] w-[92.242px] pointer-events-none z-20" data-name="Vector" data-node-id="341:797">
        <img alt="" className="block max-w-none size-full" src={imgVector} />
      </div>

      <div className="absolute h-[45px] left-[calc(50%+28px)] top-[60px] translate-x-[-50%] w-[296px]" data-node-id="304:848" />
      
      {/* Account Circle */}
      <AccountCircle className="absolute left-[339px] size-[50px] top-[58px] z-20" />
    </div>
  );
}

