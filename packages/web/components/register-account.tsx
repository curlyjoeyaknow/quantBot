'use client';

/**
 * Register Account Component
 * New account registration with confirmation popup
 */

import { useState } from 'react';

// Image assets from Figma (reusing from sign-in page)
const imgLogoMenuDropDownButton = 'https://www.figma.com/api/mcp/asset/d83b9705-7103-4787-9fb5-bc32cd783b2e';
const imgIcon = 'https://www.figma.com/api/mcp/asset/e4afdbca-5bb5-4bfb-888d-eb4e13120792';
const imgFigma = 'https://www.figma.com/api/mcp/asset/86935ead-5f49-4239-883d-9d5e87493a40';
const imgXLogo = 'https://www.figma.com/api/mcp/asset/319872ce-4242-4068-9d1e-60e558349e2a';
const imgLogoInstagram = 'https://www.figma.com/api/mcp/asset/7564e343-fc7b-4b58-9622-4319f1966b40';
const imgLogoYouTube = 'https://www.figma.com/api/mcp/asset/ddce94a2-9144-43f0-82ea-a9eba7fb89a0';
const imgLinkedIn = 'https://www.figma.com/api/mcp/asset/8774370f-b646-4886-bf7f-82b0bca0a9a5';

function AccountCircle({ className }: { className?: string }) {
  return (
    <div className={className} data-name="account_circle">
      <div className="absolute inset-[8.33%]">
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
      type="button"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <div className="absolute border-[#0a3a32] border-[3px] border-solid inset-0 rounded-[30px] pointer-events-none">
        <img
          alt=""
          className="absolute inset-0 max-w-none object-50%-50% object-cover pointer-events-none rounded-[30px] size-full"
          src={imgLogoMenuDropDownButton}
        />
      </div>
    </button>
  );
}

export default function RegisterAccount() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const validateEmail = (email: string): boolean => {
    // Check for @ and at least one . after @
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: { email?: string; password?: string } = {};

    // Email validation
    if (!email) {
      newErrors.email = 'Email is required';
    } else if (!validateEmail(email)) {
      newErrors.email = 'Please enter a valid email (e.g., user@domain.com)';
    }

    // Password validation
    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password !== confirmPassword) {
      newErrors.password = 'Passwords do not match';
    }

    // If there are errors, show them and don't proceed
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Clear errors and show success popup
    setErrors({});
    setShowSuccess(true);
  };

  return (
    <div
      className="bg-[#0a3a32] content-stretch flex flex-col gap-[60px] items-start relative size-full"
      data-name="REGISTER ACCOUNT"
    >
      {/* Success Popup */}
      {showSuccess && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSuccess(false)}>
          <div className="bg-[#b8e0d2] rounded-lg p-8 w-[380px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="text-[60px] mb-4">✓</div>
              <h2 className="text-[#0a3a32] font-['Albert_Sans:Black',sans-serif] font-black text-[28px] mb-2">
                Account Registered!
              </h2>
              <p className="text-[#0a3a32] text-[16px] mb-4">
                Your account has been created successfully
              </p>
              <div className="bg-white/40 rounded p-4 mb-6 text-left">
                <p className="text-[#0a3a32] text-[14px]"><span className="font-semibold">Email:</span> {email}</p>
                <p className="text-[#0a3a32] text-[14px]"><span className="font-semibold">Password:</span> {'•'.repeat(password.length)}</p>
                <p className="text-[#0a3a32] text-[14px]"><span className="font-semibold">Status:</span> Active</p>
              </div>
            </div>
            <a
              href="/figma-replicas/setup-overview"
              className="block w-full bg-[#2c2c2c] text-white text-center py-3 rounded-lg font-['Albert_Sans:Black',sans-serif] font-black text-[18px] hover:bg-[#1c1c1c] transition-colors no-underline"
            >
              CONTINUE TO SETUP →
            </a>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="absolute bg-[#b8e0d2] bottom-0 content-stretch flex flex-col h-[65px] items-center justify-center left-1/2 overflow-clip px-6 py-3 rounded-[10px] translate-x-[-50%] w-[440px] z-10">
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
      <LogoMenuDropDownButtonDefault className="absolute bg-[rgba(10,58,50,0)] block cursor-pointer h-[55px] left-[20px] top-[50px] w-[53.571px] z-20 pointer-events-auto" />

      {/* Shopify Title */}
      <div className="absolute font-['Albert_Sans:Black',sans-serif] font-black h-[55px] leading-[1.2] left-[159px] text-[#0a3a32] text-[46px] text-center top-[50px] tracking-[-1.38px] translate-x-[-50%] w-[178px] whitespace-pre-wrap z-10 pointer-events-none">
        <p className="mb-0">Shopify</p>
        <p>&nbsp;</p>
      </div>

      {/* Tagline */}
      <div className="absolute font-['Albert_Sans:Italic',sans-serif] font-normal italic leading-[57px] left-[calc(50%+-3.5px)] text-[#b8e0d2] text-[28px] text-center top-[calc(50%+-339.5px)] tracking-[var(--static\/display-small\/tracking,0px)] translate-x-[-50%] w-[223px] whitespace-pre-wrap pointer-events-none">
        <p className="mb-0">{`Start building. `}</p>
        <p className="mb-0">{`Ship products. `}</p>
        <p>Launch today.</p>
      </div>

      {/* Registration Form */}
      <div className="absolute content-stretch flex flex-col items-start left-0 rounded-[10px] top-[calc(50%+10.5px)] translate-y-[-50%] z-10">
        <form
          id="register-form"
          onSubmit={handleRegister}
          className="bg-[#b8e0d2] border-[var(--sds-color-border-default-default,#d9d9d9)] border-[var(--sds-size-stroke-border,1px)] border-solid content-stretch flex flex-col gap-[var(--sds-size-space-600,24px)] items-start min-w-[320px] p-[var(--sds-size-space-600,24px)] relative rounded-[var(--sds-size-radius-200,8px)] shrink-0 w-[446px]"
        >
          {/* Email Input */}
          <div className="content-stretch flex flex-col gap-[var(--sds-size-space-200,8px)] items-start relative shrink-0 w-full">
            <label
              htmlFor="email"
              className="font-[family-name:var(--sds-typography-body-font-family,'Inter:Regular',sans-serif)] font-[var(--sds-typography-body-font-weight-regular,400)] leading-[1.4] min-w-full not-italic relative shrink-0 text-[color:var(--sds-color-text-default-default,#1e1e1e)] text-[length:var(--sds-typography-body-size-medium,16px)] w-[min-content] whitespace-pre-wrap"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) setErrors({ ...errors, email: undefined });
              }}
              className={`bg-[#b8e0d2] border-2 border-solid content-stretch flex h-[40px] items-center min-w-[120px] overflow-clip px-[var(--sds-size-space-400,16px)] py-[var(--sds-size-space-300,12px)] rounded-[var(--sds-size-radius-200,8px)] shrink-0 w-full outline-none focus:ring-2 focus:ring-offset-0 font-[family-name:var(--sds-typography-body-font-family,'Inter:Regular',sans-serif)] font-[var(--sds-typography-body-font-weight-regular,400)] text-[color:var(--sds-color-text-default-default,#1e1e1e)] text-[length:var(--sds-typography-body-size-medium,16px)] ${
                errors.email ? 'border-red-600 focus:ring-red-600 focus:border-red-600' : 'border-[#0a3a32] focus:ring-[#0a3a32] focus:border-[#0a3a32]'
              }`}
              required
            />
            {errors.email && (
              <p className="text-red-600 text-[12px] font-medium mt-1">{errors.email}</p>
            )}
          </div>

          {/* Password Input */}
          <div className="content-stretch flex flex-col gap-[var(--sds-size-space-200,8px)] items-start relative shrink-0 w-full">
            <label
              htmlFor="password"
              className="font-[family-name:var(--sds-typography-body-font-family,'Inter:Regular',sans-serif)] font-[var(--sds-typography-body-font-weight-regular,400)] leading-[1.4] min-w-full not-italic relative shrink-0 text-[color:var(--sds-color-text-default-default,#1e1e1e)] text-[length:var(--sds-typography-body-size-medium,16px)] w-[min-content] whitespace-pre-wrap"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-[#b8e0d2] border-[#0a3a32] border-2 border-solid content-stretch flex h-[40px] items-center min-w-[120px] overflow-clip px-[var(--sds-size-space-400,16px)] py-[var(--sds-size-space-300,12px)] relative rounded-[var(--sds-size-radius-200,8px)] shrink-0 w-full outline-none focus:ring-2 focus:ring-[#0a3a32] focus:border-[#0a3a32] focus:ring-offset-0 font-[family-name:var(--sds-typography-body-font-family,'Inter:Regular',sans-serif)] font-[var(--sds-typography-body-font-weight-regular,400)] text-[color:var(--sds-color-text-default-default,#1e1e1e)] text-[length:var(--sds-typography-body-size-medium,16px)]"
              required
            />
          </div>

          {/* Confirm Password Input */}
          <div className="content-stretch flex flex-col gap-[var(--sds-size-space-200,8px)] items-start relative shrink-0 w-full">
            <label
              htmlFor="confirmPassword"
              className="font-[family-name:var(--sds-typography-body-font-family,'Inter:Regular',sans-serif)] font-[var(--sds-typography-body-font-weight-regular,400)] leading-[1.4] min-w-full not-italic relative shrink-0 text-[color:var(--sds-color-text-default-default,#1e1e1e)] text-[length:var(--sds-typography-body-size-medium,16px)] w-[min-content] whitespace-pre-wrap"
            >
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (errors.password) setErrors({ ...errors, password: undefined });
              }}
              className={`bg-[#b8e0d2] border-2 border-solid content-stretch flex h-[40px] items-center min-w-[120px] overflow-clip px-[var(--sds-size-space-400,16px)] py-[var(--sds-size-space-300,12px)] relative rounded-[var(--sds-size-radius-200,8px)] shrink-0 w-full outline-none focus:ring-2 focus:ring-offset-0 font-[family-name:var(--sds-typography-body-font-family,'Inter:Regular',sans-serif)] font-[var(--sds-typography-body-font-weight-regular,400)] text-[color:var(--sds-color-text-default-default,#1e1e1e)] text-[length:var(--sds-typography-body-size-medium,16px)] ${
                errors.password ? 'border-red-600 focus:ring-red-600 focus:border-red-600' : 'border-[#0a3a32] focus:ring-[#0a3a32] focus:border-[#0a3a32]'
              }`}
              required
            />
            {errors.password && (
              <p className="text-red-600 text-[12px] font-medium mt-1">{errors.password}</p>
            )}
          </div>

        </form>
      </div>

      {/* Action Buttons Row */}
      <div className="absolute flex gap-4 left-1/2 top-[calc(50%+230px)] translate-x-[-50%] translate-y-[-50%] z-10">
        {/* Already have account? Button */}
        <a
          href="/figma-replicas/sign-in"
          className="bg-[#2c2c2c] border border-[#2c2c2c] border-solid content-stretch flex gap-[var(--sds-size-space-200,8px)] h-[47px] items-center justify-center overflow-clip p-[var(--sds-size-space-300,12px)] relative rounded-[var(--sds-size-radius-200,8px)] shrink-0 w-[190px] hover:bg-[#1c1c1c] transition-colors no-underline"
        >
          <p className="font-['Albert_Sans:Black',sans-serif] font-black leading-none relative shrink-0 text-white text-[16px] m-0">
            SIGN IN
          </p>
        </a>

        {/* Register Button */}
        <button
          type="submit"
          form="register-form"
          className="bg-neutral-100 border border-[var(--sds-color-icon-neutral-on-neutral,#f3f3f3)] border-solid content-stretch flex gap-[var(--sds-size-space-200,8px)] h-[47px] items-center justify-center overflow-clip p-[var(--sds-size-space-300,12px)] relative rounded-[var(--sds-size-radius-200,8px)] shrink-0 w-[190px] hover:bg-neutral-200 transition-colors cursor-pointer"
        >
          <p className="font-['Albert_Sans:Black',sans-serif] font-black leading-none relative shrink-0 text-[#0a3a32] text-[16px] m-0">
            REGISTER →
          </p>
        </button>
      </div>

      {/* Account Circle */}
      <div className="absolute left-[336px] size-[50px] top-[53px] z-20">
        <AccountCircle className="absolute inset-0 overflow-clip" />
      </div>
    </div>
  );
}

