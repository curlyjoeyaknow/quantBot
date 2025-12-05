'use client';

/**
 * Add Product Component
 * Exact replica of Figma design: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=218-762&m=dev
 * Fixed: Image placeholder now triggers file upload on click
 */

import { useRef, useState } from 'react';
import { useShopifyFlow } from './shopify-flow-context';

// Image assets from Figma
const imgLogoMenuDropDownButton = 'https://www.figma.com/api/mcp/asset/ce3a59e7-8436-459b-b04a-205715ee0bcd';
const img1 = 'https://www.figma.com/api/mcp/asset/3674c67b-0e4a-49bd-b529-1fd7cdea7b9b';
const img = 'https://www.figma.com/api/mcp/asset/f3c17a56-0d96-4b72-94e3-fc74f939efeb';
const imgFigma = 'https://www.figma.com/api/mcp/asset/44366798-7086-444d-af51-3ca1fadae1ea';
const imgXLogo = 'https://www.figma.com/api/mcp/asset/e98cb23a-bf0e-4cbf-99ae-1d7c3d8b6dda';
const imgLogoInstagram = 'https://www.figma.com/api/mcp/asset/f19241d4-b917-488b-9679-5165d74c14de';
const imgLogoYouTube = 'https://www.figma.com/api/mcp/asset/dd1d3cf4-1bf0-4227-af72-7af8058c2803';
const imgLinkedIn = 'https://www.figma.com/api/mcp/asset/a485bb7a-fcdc-4ea5-9b6e-5639dfe3af77';
const img2 = 'https://www.figma.com/api/mcp/asset/f33901d6-cdbb-487e-97eb-7f6231afe6b9';

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

function LogoMenuDropDownButtonDefault({ className }: { className?: string }) {
  return (
    <button 
      className={className} 
      data-name="Logo Menu drop down button/Default" 
      data-node-id="153:330"
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        // Add dropdown menu logic here if needed
      }}
    >
      <div className="absolute border-[#0a3a32] border-[3px] border-solid inset-0 rounded-[30px] pointer-events-none" data-name="Logo Menu drop down button" data-node-id="148:4590">
        <img
          alt=""
          className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none rounded-[30px] size-full"
          src={imgLogoMenuDropDownButton}
        />
      </div>
    </button>
  );
}

export default function AddProduct() {
  const { state } = useShopifyFlow();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [productName, setProductName] = useState('');
  const [productPrice, setProductPrice] = useState(39.99);
  const [productDescription, setProductDescription] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePriceSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProductPrice(parseFloat(e.target.value));
  };

  const handlePriceInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value >= 0) {
      setProductPrice(value);
    }
  };

  const handleAddAnother = () => {
    // Save current product and reset form
    setShowSuccess(true);
    setTimeout(() => {
      setUploadedImage(null);
      setProductName('');
      setProductPrice(39.99);
      setProductDescription('');
      setShowSuccess(false);
    }, 1500);
  };

  return (
    <div
      className="bg-[#0a3a32] content-stretch flex flex-col gap-[10px] items-start relative size-full"
      data-name="ADD PRODUCT"
      data-node-id="218:762"
    >
      {/* Footer */}
      <div
        className="absolute bg-[#b8e0d2] bottom-px content-stretch flex flex-col h-[65px] items-center justify-center left-[calc(50%+2px)] overflow-clip px-6 py-3 rounded-[10px] translate-x-[-50%] w-[440px] z-10"
        data-name="Footer"
        data-node-id="266:2631"
      >
        <div
          className="content-stretch flex items-center justify-between min-w-[240px] relative shrink-0 w-full"
          data-name="Title"
          data-node-id="266:2632"
        >
          <div className="h-[35px] relative shrink-0 w-[23.333px]" data-name="Figma" data-node-id="266:2633">
            <div className="absolute inset-[-5%_-7.5%]">
              <img alt="" className="block max-w-none size-full" src={imgFigma} />
            </div>
          </div>
          <div
            className="content-stretch flex gap-[var(--sds-size-space-400,16px)] items-center relative shrink-0"
            data-name="Button List"
            data-node-id="266:2635"
          >
            <div className="h-[24px] relative shrink-0 w-[23.98px]" data-name="X Logo" data-node-id="266:2636">
              <img alt="" className="block max-w-none size-full" src={imgXLogo} />
            </div>
            <div className="relative shrink-0 size-[24px]" data-name="Logo Instagram" data-node-id="266:2638">
              <img alt="" className="block max-w-none size-full" src={imgLogoInstagram} />
            </div>
            <div className="relative shrink-0 size-[24px]" data-name="Logo YouTube" data-node-id="266:2640">
              <img alt="" className="block max-w-none size-full" src={imgLogoYouTube} />
            </div>
            <div className="relative shrink-0 size-[24px]" data-name="LinkedIn" data-node-id="266:2642">
              <img alt="" className="block max-w-none size-full" src={imgLinkedIn} />
            </div>
          </div>
        </div>
      </div>

      {/* White header 6 */}
      <div
        className="content-stretch flex h-[126px] items-start relative shrink-0 w-full z-0"
        data-name="White header 6"
        data-node-id="322:764"
      >
        <button
          className="bg-[#b8e0d2] border-[var(--sds-color-border-default-default,#d9d9d9)] border-b border-l-0 border-r-0 border-solid border-t-0 content-center cursor-pointer flex flex-[1_0_0] flex-wrap h-full items-center justify-between min-h-px min-w-px overflow-clip p-[var(--sds-size-space-600,24px)] relative shrink-0 pointer-events-auto"
          data-name="White header"
          data-node-id="I322:764;29:837"
        />
      </div>

      {/* Logo Menu Drop Down Button */}
      <LogoMenuDropDownButtonDefault className="absolute bg-[rgba(10,58,50,0)] block cursor-pointer h-[55px] left-[20px] top-[50px] w-[53.571px] z-20 pointer-events-auto" />

      {/* Account Circle */}
      <AccountCircle className="absolute left-[347px] size-[50px] top-[53px] z-20" />

      {/* Bottom Action Buttons */}
      <div className="absolute flex gap-4 left-1/2 top-[calc(50%+347.5px)] translate-x-[-50%] translate-y-[-50%] z-10">
        <a
          href="/figma-replicas/setup-overview"
          className="bg-[#2c2c2c] border border-[#2c2c2c] border-solid content-stretch flex gap-[var(--sds-size-space-200,8px)] h-[44px] items-center justify-center overflow-clip p-[var(--sds-size-space-300,12px)] rounded-[var(--sds-size-radius-200,8px)] shrink-0 w-[190px] hover:bg-[#1c1c1c] transition-colors no-underline"
        >
          <p className="font-['Albert_Sans:Black',sans-serif] font-black leading-none text-white text-[16px] m-0">
            ← BACK
          </p>
        </a>
        <a
          href="/figma-replicas/shipping-pricing"
          className="bg-white border-[var(--sds-color-icon-neutral-on-neutral,#f3f3f3)] border-[var(--sds-size-stroke-border,1px)] border-solid content-stretch cursor-pointer flex gap-[var(--sds-size-space-200,8px)] h-[44px] items-center justify-center overflow-clip p-[var(--sds-size-space-300,12px)] rounded-[var(--sds-size-radius-200,8px)] w-[190px] hover:bg-neutral-50 transition-colors no-underline"
          data-name="Button"
          data-node-id="233:1926"
        >
          <p className="font-['Albert_Sans:Black',sans-serif] font-black leading-none text-[#0a3a32] text-[16px] m-0">
            CONTINUE →
          </p>
        </a>
      </div>

      {/* Empty div */}
      <div className="absolute h-[45px] left-[calc(50%+-52.5px)] top-[55px] translate-x-[-50%] w-[187px]" data-node-id="264:440" />

      {/* Shopify Title */}
      <div
        className="absolute font-['Albert_Sans:Black',sans-serif] font-black h-[76px] leading-[1.2] left-[168.5px] text-[#0a3a32] text-[46px] text-center top-[50px] tracking-[-1.38px] translate-x-[-50%] w-[237px] whitespace-pre-wrap z-10 pointer-events-none"
        data-node-id="258:569"
      >
        <p className="mb-0">Shopify</p>
        <p>&nbsp;</p>
      </div>

      {/* Shop Name Display - Above main content */}
      <div className="absolute top-[195px] left-1/2 translate-x-[-50%] z-10 pointer-events-none">
        <p className="font-['Albert_Sans:SemiBold',sans-serif] font-semibold text-[#b8e0d2] text-[18px] text-center">
          {state.shopName ? `Shop: ${state.shopName}` : 'Shop: (not set)'}
        </p>
      </div>

      {/* Progress Bar */}
      <div
        className="absolute h-[44px] left-1/2 top-[140px] translate-x-[-50%] w-[402px]"
        data-name="Progress Bar"
        data-node-id="233:1931"
      >
        <div
          className="absolute bg-neutral-100 h-[4px] left-[16px] right-[16px] top-1/2 translate-y-[-50%]"
          data-name="Track"
          data-node-id="I233:1931;495:46297"
        >
          <div
            className="absolute bg-[#1e1e1e] h-[4px] left-0 right-1/2 rounded-[100px] top-1/2 translate-y-[-50%]"
            data-name="Filled"
            data-node-id="I233:1931;495:46298"
          />
        </div>
      </div>

      {/* Progress Text */}
      <p
        className="absolute font-['Albert_Sans:Medium',sans-serif] font-medium leading-none left-[calc(50%+-113px)] text-[20px] text-white top-[135px]"
        data-node-id="243:635"
      >
        2 OUT OF 4 COMPLETE
      </p>

      {/* Final Step Text */}
      <div
        className="absolute flex items-center gap-4 font-['Albert_Sans:Black',sans-serif] font-black justify-center leading-[0] left-[calc(50%+0.5px)] text-[24px] text-black text-center top-[800px] translate-x-[-50%] translate-y-[-50%] whitespace-nowrap pointer-events-none"
        data-node-id="266:646"
      >
        <p className="leading-[1.2]">FINAL STEP</p>
      </div>

      {/* Add Product Title and Instructions - Compact */}
      <div
        className="absolute flex flex-col font-['Albert_Sans:Medium',sans-serif] font-medium justify-center leading-[1.2] left-[calc(50%+0.5px)] text-center text-white top-[220px] translate-x-[-50%] w-[380px] pointer-events-none"
        data-node-id="266:3204"
      >
        <p className="font-['Albert_Sans:Black',sans-serif] font-black mb-1 text-[34px]">ADD PRODUCT</p>
        <p className="text-[15px] leading-tight">Upload photo, name & price</p>
      </div>

      {/* Card */}
      <div
        className="absolute bg-[#b8e0d2] border-[#444444] border-[var(--sds-size-stroke-border,1px)] border-solid content-stretch flex flex-col gap-[var(--sds-size-space-400,16px)] items-start left-1/2 min-w-[240px] p-[var(--sds-size-space-600,24px)] rounded-[var(--sds-size-radius-200,8px)] top-[300px] translate-x-[-50%] w-[400px]"
        data-name="Card"
        data-node-id="304:678"
      >
        {/* Image */}
        <div 
          className="min-w-[160px] relative shrink-0 size-[160px] cursor-pointer hover:opacity-80 transition-opacity" 
          data-name="Image" 
          data-node-id="I304:678;638:11629"
          onClick={handleImageClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleImageClick();
            }
          }}
        >
          {uploadedImage ? (
            <img
              src={uploadedImage}
              alt="Uploaded product"
              className="absolute inset-0 object-cover size-full rounded"
            />
          ) : (
            <div aria-hidden="true" className="absolute inset-0">
              <div className="absolute bg-[var(--sds-color-slate-200,#e3e3e3)] inset-0 flex items-center justify-center">
                <div className="text-center">
                  <img
                    alt=""
                    className="absolute max-w-none object-50%-50% object-contain opacity-20 size-full"
                    src={img1}
                  />
                  <div className="relative z-10 text-gray-500 text-sm font-medium">
                    Click to upload
                  </div>
                </div>
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
            aria-label="Upload product image"
          />
        </div>

        {/* Body */}
        <div
          className="content-stretch flex flex-col gap-[var(--sds-size-space-400,16px)] items-start min-w-[160px] relative shrink-0 w-full"
          data-name="Body"
          data-node-id="I304:678;2144:2975"
        >
          {/* Product Name Input */}
          <div className="content-stretch flex flex-col gap-2 items-start relative shrink-0 w-full">
            <label
              htmlFor="productName"
              className="font-['Albert_Sans:Medium',sans-serif] font-medium text-[#0a3a32] text-[14px]"
            >
              Product Name
            </label>
            <input
              id="productName"
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="Enter product name"
              className="w-full bg-white border-2 border-[#0a3a32] rounded px-3 py-2 text-[#0a3a32] text-[16px] outline-none focus:ring-2 focus:ring-[#0a3a32]"
            />
          </div>

          {/* Product Price Input with Slider */}
          <div className="content-stretch flex flex-col gap-2 items-start relative shrink-0 w-full">
            <label
              htmlFor="productPrice"
              className="font-['Albert_Sans:Medium',sans-serif] font-medium text-[#0a3a32] text-[14px]"
            >
              Price
            </label>
            <div className="flex gap-3 items-center w-full">
              <input
                id="productPrice"
                type="number"
                step="0.01"
                min="0"
                max="9999"
                value={productPrice}
                onChange={handlePriceInputChange}
                className="w-[100px] bg-white border-2 border-[#0a3a32] rounded px-3 py-2 text-[#0a3a32] text-[16px] font-bold outline-none focus:ring-2 focus:ring-[#0a3a32]"
              />
              <input
                type="range"
                min="0"
                max="200"
                step="0.50"
                value={productPrice}
                onChange={handlePriceSliderChange}
                className="flex-1 h-2 bg-[#0a3a32] rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#0a3a32] [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#0a3a32] [&::-moz-range-thumb]:cursor-pointer"
              />
              <span className="text-[#0a3a32] text-[18px] font-bold w-[80px] text-right">${productPrice.toFixed(2)}</span>
            </div>
          </div>

          {/* Button Group */}
          <div
            className="content-stretch flex gap-[var(--sds-size-space-400,16px)] items-center relative shrink-0 w-full"
            data-name="Button Group"
            data-node-id="I304:678;2144:2979"
          >
            {/* ADD ANOTHER Button */}
            <button
              type="button"
              onClick={handleAddAnother}
              className="bg-[var(--sds-color-background-brand-default,#2c2c2c)] border-[var(--sds-color-border-brand-default,#2c2c2c)] border-[var(--sds-size-stroke-border,1px)] border-solid content-stretch flex flex-[1_0_0] gap-[var(--sds-size-space-200,8px)] items-center justify-center min-h-px min-w-px overflow-clip p-[var(--sds-size-space-300,12px)] relative rounded-[var(--sds-size-radius-200,8px)] shrink-0 cursor-pointer hover:bg-[#1c1c1c] transition-colors"
              data-name="Button"
              data-node-id="I304:678;2144:2979;2072:9460"
            >
              <p
                className="font-['Albert_Sans:Regular',sans-serif] font-[var(--sds-typography-body-font-weight-regular,400)] leading-none relative shrink-0 text-[color:var(--sds-color-text-brand-on-brand,#f5f5f5)] text-[length:var(--sds-typography-body-size-medium,16px)] m-0"
                data-node-id="I304:678;2144:2979;2072:9460;4185:3781"
              >
                {showSuccess ? '✓ ADDED!' : 'ADD ANOTHER'}
              </p>
            </button>

            {/* ADD SHIPPING & PRICING Button */}
            <a
              href="/figma-replicas/shipping-pricing"
              className="bg-white border-[var(--sds-color-border-neutral-secondary,#767676)] border-[var(--sds-size-stroke-border,1px)] border-solid content-stretch flex flex-[1_0_0] gap-[var(--sds-size-space-200,8px)] items-center justify-center min-h-px min-w-px overflow-clip p-[var(--sds-size-space-300,12px)] relative rounded-[10px] shrink-0 no-underline hover:bg-neutral-50 transition-colors"
              data-name="Button"
              data-node-id="I304:678;2144:2979;2072:9461"
            >
              <div
                className="overflow-clip relative shrink-0 size-[16px]"
                data-name="Plus"
                data-node-id="I304:678;2144:2979;2072:9461;9762:5084"
              >
                <div
                  className="absolute inset-[20.83%]"
                  data-name="Icon"
                  data-node-id="I304:678;2144:2979;2072:9461;9762:5084;68:15940"
                >
                  <div
                    className="absolute inset-[-8.57%]"
                    style={{ '--stroke-0': 'rgba(30, 30, 30, 1)' } as React.CSSProperties}
                  >
                    <img alt="" className="block max-w-none size-full" src={img2} />
                  </div>
                </div>
              </div>
              <div
                className="font-[family-name:var(--sds-typography-body-font-family,'Inter:Black',sans-serif)] font-black leading-none not-italic relative shrink-0 text-[14px] text-[color:var(--sds-color-text-default-default,#1e1e1e)] whitespace-nowrap"
                data-node-id="I304:678;2144:2979;2072:9461;9762:5085"
              >
                <p className="mb-0">{`ADD SHIPPING &`}</p>
                <p>PRICING</p>
              </div>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

