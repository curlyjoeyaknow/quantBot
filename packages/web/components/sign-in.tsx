'use client';

/**
 * Sign In Component
 * Figma replica of the login page
 */

import { useState } from 'react';

// Image assets from Figma
const imgIcon = 'https://www.figma.com/api/mcp/asset/aa79b16a-f0e8-4bc8-ac54-4d76aebbb863';
const imgLogoMenuDropDownButton = 'https://www.figma.com/api/mcp/asset/4be2e2a6-fe31-4c75-856a-da3dd9c3b653';
const imgFigma = 'https://www.figma.com/api/mcp/asset/c538fa3b-6fb2-4c8e-a9d2-fa36c216ad92';
const imgXLogo = 'https://www.figma.com/api/mcp/asset/2300226d-2617-4c47-bc41-2f898171b2df';
const imgLogoInstagram = 'https://www.figma.com/api/mcp/asset/f7d1a7a0-05d5-4563-8e6f-de3eb1af7f14';
const imgLogoYouTube = 'https://www.figma.com/api/mcp/asset/ddce94a2-9144-43f0-82ea-a9eba7fb89a0';
const imgLinkedIn = 'https://www.figma.com/api/mcp/asset/8774370f-b646-4886-bf7f-82b0bca0a9a5';

function AccountCircle({ className }: { className?: string }) {
  return (
    <div className={className} data-name="account_circle" data-node-id="264:932">
      <div className="absolute inset-[8.33%]" data-name="icon" data-node-id="264:933">
        <div className="absolute inset-0" style={{ '--fill-0': 'rgba(29, 27, 32, 1)' } as React.CSSProperties}>
          <img alt="" className="block max-w-none size-full" src={imgIcon} />
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
      <div
        className="absolute border-[#0a3a32] border-[3px] border-solid inset-0 rounded-[30px] pointer-events-none"
        data-name="Logo Menu drop down button"
        data-node-id="148:4590"
      >
        <img
          alt=""
          className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none rounded-[30px] size-full"
          src={imgLogoMenuDropDownButton}
        />
      </div>
    </button>
  );
}

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div
      className="bg-[#0a3a32] content-stretch flex flex-col gap-[60px] items-start relative size-full"
      data-name="SIGN IN"
      data-node-id="144:2360"
    >
      {/* Footer */}
      <div
        className="absolute bg-[#b8e0d2] bottom-0 content-stretch flex flex-col h-[65px] items-center justify-center left-1/2 overflow-clip px-6 py-3 rounded-[10px] translate-x-[-50%] w-[440px] z-10"
        data-name="Footer"
        data-node-id="322:807"
      >
        <div
          className="content-stretch flex items-center justify-between min-w-[240px] relative shrink-0 w-full"
          data-name="Title"
          data-node-id="322:808"
        >
          <div className="h-[35px] relative shrink-0 w-[23.333px]" data-name="Figma" data-node-id="322:809">
            <div className="absolute inset-[-5%_-7.5%]">
              <img alt="" className="block max-w-none size-full" src={imgFigma} />
            </div>
          </div>
          <div
            className="content-stretch flex gap-[var(--sds-size-space-400,16px)] items-center relative shrink-0"
            data-name="Button List"
            data-node-id="322:811"
          >
            <div className="h-[24px] relative shrink-0 w-[23.98px]" data-name="X Logo" data-node-id="322:812">
              <img alt="" className="block max-w-none size-full" src={imgXLogo} />
            </div>
            <div className="relative shrink-0 size-[24px]" data-name="Logo Instagram" data-node-id="322:814">
              <img alt="" className="block max-w-none size-full" src={imgLogoInstagram} />
            </div>
            <div className="relative shrink-0 size-[24px]" data-name="Logo YouTube" data-node-id="322:816">
              <img alt="" className="block max-w-none size-full" src={imgLogoYouTube} />
            </div>
            <div className="relative shrink-0 size-[24px]" data-name="LinkedIn" data-node-id="322:818">
              <img alt="" className="block max-w-none size-full" src={imgLinkedIn} />
            </div>
          </div>
        </div>
      </div>

      {/* White header 8 */}
      <div
        className="content-stretch flex h-[126px] items-start relative shrink-0 w-full z-0"
        data-name="White header 8"
        data-node-id="341:804"
      >
        <button
          className="bg-[#b8e0d2] border-[var(--sds-color-border-default-default,#d9d9d9)] border-b border-l-0 border-r-0 border-solid border-t-0 content-center cursor-pointer flex flex-[1_0_0] flex-wrap h-full items-center justify-between min-h-px min-w-px overflow-clip p-[var(--sds-size-space-600,24px)] relative shrink-0 pointer-events-auto"
          data-name="White header"
          data-node-id="I341:804;29:837"
        />
      </div>

      {/* Logo Menu Drop Down Button */}
      <LogoMenuDropDownButtonDefault className="absolute bg-[rgba(10,58,50,0)] h-[55px] left-[20px] top-[50px] w-[53.571px] z-20" />

      {/* Shopify Title */}
      <div
        className="absolute font-['Albert_Sans:Black',sans-serif] font-black h-[55px] leading-[1.2] left-[159px] text-[#0a3a32] text-[46px] text-center top-[50px] tracking-[-1.38px] translate-x-[-50%] w-[178px] whitespace-pre-wrap z-20"
        data-node-id="153:539"
      >
        <p className="mb-0">Shopify</p>
        <p>&nbsp;</p>
      </div>

      {/* Tagline */}
      <div
        className="absolute font-['Albert_Sans:Italic',sans-serif] font-normal italic leading-[57px] left-[calc(50%+-3.5px)] text-[#b8e0d2] text-[28px] text-center top-[calc(50%+-339.5px)] tracking-[var(--static\/display-small\/tracking,0px)] translate-x-[-50%] w-[223px] whitespace-pre-wrap"
        data-node-id="144:2416"
      >
        <p className="mb-0">{`Build fast. `}</p>
        <p className="mb-0">{`Ship easy. `}</p>
        <p>Launch sooner.</p>
      </div>

      {/* Form Container */}
      <div
        className="absolute bg-[#b8e0d2] border-[#d9d9d9] border-[1px] border-solid flex flex-col gap-[24px] h-[294px] items-start left-0 min-w-[320px] overflow-visible p-[24px] rounded-[8px] top-[340px] w-[446px]"
        data-name="Form Log In"
        data-node-id="341:1841"
      >
        {/* Email Input */}
        <div className="flex flex-col gap-[8px] w-full">
          <label className="font-['Inter'] font-normal text-[16px] text-[#1e1e1e]">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="123abc@gmail.com"
            className="bg-white border-2 border-[#d9d9d9] rounded-[8px] px-[16px] py-[12px] text-[16px] font-['Inter'] text-[#1e1e1e] placeholder:text-[#b3b3b3] focus:outline-none focus:border-[#0a3a32]"
          />
        </div>

        {/* Password Input */}
        <div className="flex flex-col gap-[8px] w-full">
          <label className="font-['Inter'] font-normal text-[16px] text-[#1e1e1e]">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="bg-white border-2 border-[#d9d9d9] rounded-[8px] px-[16px] py-[12px] text-[16px] font-['Inter'] text-[#1e1e1e] placeholder:text-[#b3b3b3] focus:outline-none focus:border-[#0a3a32]"
          />
        </div>

        {/* Forgot Password Link */}
        <a
          href="/figma-replicas/forgot-password"
          className="self-end underline decoration-solid font-['Inter'] font-normal text-[16px] text-[#1e1e1e] hover:text-[#0a3a32] transition-colors"
        >
          Forgot password?
        </a>
      </div>

      {/* Create Account Link */}
      <a
        href="/figma-replicas/register"
        className="absolute underline decoration-solid font-['Inter'] font-normal left-[calc(50%-181px)] text-[16px] text-black top-[540px] w-[277px] hover:text-[#0a3a32] transition-colors no-underline"
        data-node-id="218:589"
      >
        Create Account
      </a>

      {/* Sign In and Register Buttons */}
      <div className="absolute flex gap-[calc(10%)] items-center justify-center left-[calc(5%+12px)] top-[653px] w-[calc(90%-24px)]">
        {/* Sign In Button */}
        <a
          href="/figma-replicas/setup-overview"
          className="bg-[#0a3a32] flex items-center justify-center h-[47px] rounded-[8px] w-[35%] hover:bg-[#0d4d42] transition-colors no-underline"
        >
          <span className="font-['Albert_Sans'] font-black text-neutral-100 text-[20px]">SIGN IN</span>
        </a>

        {/* Register Button */}
        <a
          href="/figma-replicas/register"
          className="bg-neutral-100 flex items-center justify-center h-[47px] rounded-[8px] w-[35%] hover:bg-neutral-200 transition-colors no-underline"
        >
          <span className="font-['Albert_Sans'] font-black text-[#0a3a32] text-[20px]">REGISTER</span>
        </a>
      </div>

      {/* Account Circle Icon */}
      <div className="absolute left-[336px] size-[50px] top-[53px] z-20" data-name="account_circle" data-node-id="341:814">
        <AccountCircle className="absolute inset-0 overflow-clip" />
      </div>
    </div>
  );
}
