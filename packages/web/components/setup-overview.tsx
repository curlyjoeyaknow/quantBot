'use client';

/**
 * Setup Overview Component
 * Exact replica of Figma design: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=218-739&m=dev
 * Fixed: Input field now uses actual <input> element instead of div for proper interaction
 */

import { useState } from 'react';
import { useShopifyFlow } from './shopify-flow-context';

// Image assets from Figma
const img = 'https://www.figma.com/api/mcp/asset/ff93021e-5e0d-43c8-ba06-916d137ebe23';
const imgInputText = 'https://www.figma.com/api/mcp/asset/aaa47902-3571-42c2-a5e2-c316a1da5d8a';
const imgFigma = 'https://www.figma.com/api/mcp/asset/0e577535-0922-4918-b45b-71fdbb4fb1ef';
const imgXLogo = 'https://www.figma.com/api/mcp/asset/1ddbb664-a7f4-4ae5-b6bf-302fcd24c5c5';
const imgLogoInstagram = 'https://www.figma.com/api/mcp/asset/2ba69602-b948-4068-bdc1-60d656c19bd4';
const imgLogoYouTube = 'https://www.figma.com/api/mcp/asset/d4204d56-8c73-42d1-8c10-b0794a3033af';
const imgLinkedIn = 'https://www.figma.com/api/mcp/asset/eb00033f-0a37-4699-b45d-7add530a1d93';

function SetUpPageReview({ className }: { className?: string }) {
  const { state, setShopName } = useShopifyFlow();
  const [localShopName, setLocalShopName] = useState(state.shopName);

  const handleShopNameChange = (value: string) => {
    setLocalShopName(value);
    setShopName(value);
  };

  return (
    <div className={className} data-name="SET UP PAGE REVIEW" data-node-id="331:908">
      <div
        className="h-[172px] relative rounded-tl-[4px] rounded-tr-[4px] shrink-0 w-[434px]"
        data-name="State-layer"
        data-node-id="229:2637"
      >
        <div
          className="absolute h-[40px] left-[16px] top-[4px] w-[415px]"
          data-name="REQUEST FOR SHOP NAME"
          data-node-id="229:2652"
        >
          <div
            className="absolute left-0 overflow-clip rounded-[100px] size-[40px] top-0"
            data-name="Content"
            data-node-id="229:2653"
          >
            <div
              className="absolute left-[6px] size-[40px] top-0"
              data-name="State-layer"
              data-node-id="229:2654"
            />
          </div>
        </div>
        <p
          className="absolute font-['Albert_Sans:Medium',sans-serif] font-medium leading-[41px] left-[31px] text-[#b8e0d2] text-[24px] top-[-5px] tracking-[var(--static\/body-small\/tracking,0.4px)] w-[358px] whitespace-pre-wrap pointer-events-none"
          data-node-id="229:2640"
        >
          Almost done! What should we call your shop?
        </p>
        <div
          className="absolute h-[56px] left-[36px] top-[85px] w-[376px]"
          data-name="INPUT TEXT"
          data-node-id="238:738"
        >
          <input
            type="text"
            value={localShopName}
            onChange={(e) => handleShopNameChange(e.target.value)}
            placeholder="Enter shop name"
            className="w-full h-full bg-transparent border-0 border-b-2 border-[#b8e0d2] outline-none text-[#d9d9d9] text-[30px] font-[family-name:var(--sds-typography-body-font-family,'Inter:Light',sans-serif)] font-light px-1 focus:border-[#ffffff] transition-colors placeholder-[#d9d9d9]/40"
            style={{ caretColor: '#d9d9d9' }}
          />
        </div>
      </div>
    </div>
  );
}

// Removed - ButtonDefault component no longer needed

export default function SetupOverview() {
  return (
    <div
      className="bg-[#0a3a32] content-stretch flex flex-col gap-[10px] items-start relative size-full"
      data-name="SETUP OVERVIEW"
      data-node-id="218:739"
    >
      {/* Footer */}
      <div
        className="absolute bg-[#b8e0d2] bottom-0 content-stretch flex flex-col h-[65px] items-center justify-center left-[calc(50%+-0.5px)] overflow-clip px-6 py-3 rounded-[10px] translate-x-[-50%] w-[437px] z-10"
        data-name="Footer"
        data-node-id="322:790"
      >
        <div
          className="content-stretch flex items-center justify-between min-w-[240px] relative shrink-0 w-full"
          data-name="Title"
          data-node-id="322:791"
        >
          <div className="h-[35px] relative shrink-0 w-[23.333px]" data-name="Figma" data-node-id="322:792">
            <div className="absolute inset-[-5%_-7.5%]">
              <img alt="" className="block max-w-none size-full" src={imgFigma} />
            </div>
          </div>
          <div
            className="content-stretch flex gap-[var(--sds-size-space-400,16px)] items-center relative shrink-0"
            data-name="Button List"
            data-node-id="322:794"
          >
            <div className="h-[24px] relative shrink-0 w-[23.98px]" data-name="X Logo" data-node-id="322:795">
              <img alt="" className="block max-w-none size-full" src={imgXLogo} />
            </div>
            <div className="relative shrink-0 size-[24px]" data-name="Logo Instagram" data-node-id="322:797">
              <img alt="" className="block max-w-none size-full" src={imgLogoInstagram} />
            </div>
            <div className="relative shrink-0 size-[24px]" data-name="Logo YouTube" data-node-id="322:799">
              <img alt="" className="block max-w-none size-full" src={imgLogoYouTube} />
            </div>
            <div className="relative shrink-0 size-[24px]" data-name="LinkedIn" data-node-id="322:801">
              <img alt="" className="block max-w-none size-full" src={imgLinkedIn} />
            </div>
          </div>
        </div>
      </div>

      {/* White header 7 */}
      <div
        className="content-stretch flex h-[126px] items-start relative shrink-0 w-full z-0"
        data-name="White header 7"
        data-node-id="341:798"
      >
        <button
          className="bg-[#b8e0d2] border-[var(--sds-color-border-default-default,#d9d9d9)] border-b border-l-0 border-r-0 border-solid border-t-0 content-center cursor-pointer flex flex-[1_0_0] flex-wrap h-full items-center justify-between min-h-px min-w-px overflow-clip p-[var(--sds-size-space-600,24px)] relative shrink-0 pointer-events-auto"
          data-name="White header"
          data-node-id="I341:798;29:837"
        />
      </div>

      {/* Background card - Reduced height */}
      <div
        className="absolute bg-[#b8e0d2] border border-black border-solid h-[220px] left-1/2 rounded-[10px] top-[480px] translate-x-[-50%] w-[360px] z-0"
        data-node-id="266:3203"
      />

      {/* Action Buttons Row */}
      <div className="absolute flex gap-4 left-1/2 top-[calc(50%+349px)] translate-x-[-50%] translate-y-[-50%] z-10">
        {/* Back Button */}
        <a
          href="/figma-replicas/sign-in"
          className="bg-[#2c2c2c] border border-[#2c2c2c] border-solid content-stretch flex gap-[var(--sds-size-space-200,8px)] h-[47px] items-center justify-center overflow-clip p-[var(--sds-size-space-300,12px)] relative rounded-[var(--sds-size-radius-200,8px)] shrink-0 w-[190px] hover:bg-[#1c1c1c] transition-colors no-underline"
        >
          <p className="font-['Albert_Sans:Black',sans-serif] font-black leading-none relative shrink-0 text-white text-[20px] m-0">
            ← BACK
          </p>
        </a>

        {/* Continue Button */}
        <a
          href="/figma-replicas/add-product"
          className="bg-neutral-100 border border-[var(--sds-color-icon-neutral-on-neutral,#f3f3f3)] border-solid content-stretch flex gap-[var(--sds-size-space-200,8px)] h-[47px] items-center justify-center overflow-clip p-[var(--sds-size-space-300,12px)] relative rounded-[var(--sds-size-radius-200,8px)] shrink-0 w-[190px] hover:bg-neutral-200 transition-colors no-underline"
        >
          <p className="font-['Albert_Sans:Black',sans-serif] font-black leading-none relative shrink-0 text-[#0a3a32] text-[20px] m-0">
            CONTINUE →
          </p>
        </a>
      </div>

      {/* Next steps list - Compact */}
      <div
        className="absolute font-['Albert_Sans:SemiBold',sans-serif] font-semibold left-[calc(50%+-150px)] text-[#0a3a32] text-[18px] top-[calc(50%+20px)] w-[330px] z-10 pointer-events-none px-6 py-4"
        data-node-id="238:733"
      >
        <p className="leading-tight mb-2 text-[20px]">Next steps:</p>
        <ul className="space-y-1.5 ml-5 text-[16px]">
          <li className="list-disc leading-tight">Add Product</li>
          <li className="list-disc leading-tight">Pricing + Shipping</li>
          <li className="list-disc leading-tight">Review</li>
          <li className="list-disc leading-tight">TIME TO LAUNCH!</li>
        </ul>
      </div>

      {/* Logo Menu drop down button */}
      <button
        type="button"
        className="absolute bg-[rgba(10,58,50,0)] block cursor-pointer h-[55px] left-[20px] top-[50px] w-[53.571px] z-20 pointer-events-auto"
        data-name="Logo Menu drop down button/Default"
        data-node-id="218:743"
        onClick={(e) => {
          e.stopPropagation();
          // Add dropdown menu logic here if needed
        }}
      >
        <div
          className="absolute border-[#0a3a32] border-[3px] border-solid inset-0 rounded-[30px] pointer-events-none"
          data-name="Logo Menu drop down button"
          data-node-id="I218:743;148:4590"
        >
          <img
            alt=""
            className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none rounded-[30px] size-full"
            src={img}
          />
        </div>
      </button>

      {/* Shopify Title */}
      <div
        className="absolute font-['Albert_Sans:Black',sans-serif] font-black h-[76px] leading-[1.2] left-[168.5px] text-[#0a3a32] text-[46px] text-center top-[50px] tracking-[-1.38px] translate-x-[-50%] w-[237px] whitespace-pre-wrap z-10 pointer-events-none"
        data-node-id="218:741"
      >
        <p className="mb-0">Shopify</p>
        <p>&nbsp;</p>
      </div>

      {/* Setup page review (input section) */}
      <SetUpPageReview className="absolute content-stretch flex flex-col gap-[10px] h-[172px] items-start left-[calc(50%+4px)] rounded-tl-[4px] rounded-tr-[4px] top-[calc(50%+-134.5px)] translate-x-[-50%] translate-y-[-50%] w-[440px] z-10" />

      {/* Progress Bar */}
      <div
        className="absolute h-[27px] left-1/2 top-[150px] translate-x-[-50%] w-[402px] pointer-events-none"
        data-name="Progress Bar"
        data-node-id="218:831"
      >
        <div
          className="absolute bg-neutral-100 h-[4px] left-[16px] right-[16px] top-1/2 translate-y-[-50%]"
          data-name="Track"
          data-node-id="I218:831;495:46287"
        >
          <div
            className="absolute bg-[#1e1e1e] h-[4px] left-0 right-[77.56%] rounded-[100px] top-1/2 translate-y-[-50%]"
            data-name="Filled"
            data-node-id="I218:831;495:46288"
          />
        </div>
      </div>

      {/* Progress text */}
      <p
        className="absolute font-['Albert_Sans:Medium',sans-serif] font-medium leading-none left-[calc(50%+-102px)] text-[20px] text-white top-[133px] pointer-events-none"
        data-node-id="238:736"
      >
        1 OUT OF 4 COMPLETE
      </p>

      {/* SHOP NAME title with Back Button */}
      <div className="absolute flex items-center gap-3 left-[calc(50%+-0.5px)] top-[185px] translate-x-[-50%]">
        <a
          href="/figma-replicas/sign-in"
          className="flex items-center justify-center w-[35px] h-[35px] bg-white rounded-full hover:bg-neutral-100 transition-colors no-underline z-10"
          aria-label="Go back to sign in"
        >
          <span className="text-[#0a3a32] text-[18px]">←</span>
        </a>
        <p
          className="font-['Albert_Sans:ExtraBold',sans-serif] font-extrabold text-[36px] text-white tracking-[0.2px] m-0 pointer-events-none whitespace-nowrap"
          data-node-id="304:699"
        >
          SHOP NAME
        </p>
      </div>
    </div>
  );
}

