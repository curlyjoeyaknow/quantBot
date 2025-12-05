# Component to Figma Design Mapping

Since Code Connect requires Organization/Enterprise plan, here's a manual reference:

## Sign In Component

**Code:** `/web/components/sign-in.tsx`
**Figma:** https://www.figma.com/design/kBMg5IBOJ6RYT1DX0yr7kL/Testt?node-id=7-583&m=dev

**Features:**
- Email input with validation
- Password input
- "Forgot password?" link → `/figma-replicas/forgot-password`
- "Create Account" link → `/figma-replicas/register`
- Two buttons: "SIGN IN" and "REGISTER"

**State:**
```typescript
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');
```

---

## Setup Overview Component

**Code:** `/web/components/setup-overview.tsx`
**Figma:** (Original: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=218-739)

**Step:** 1 of 4

---

## Add Product Component

**Code:** `/web/components/add-product.tsx`
**Figma:** (Original: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=218-762)

**Step:** 2 of 4

---

## Shipping & Pricing Component

**Code:** `/web/components/shipping-pricing.tsx`
**Figma:** (Original: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=304-543)

**Step:** 3 of 4

---

## Review Summary Component

**Code:** `/web/components/review-summary.tsx`

**Step:** 4 of 4

---

## Usage

All components are accessible at: http://localhost:3000/figma-replicas/

Direct links:
- `/figma-replicas/sign-in`
- `/figma-replicas/register`
- `/figma-replicas/forgot-password`
- `/figma-replicas/setup-overview`
- `/figma-replicas/add-product`
- `/figma-replicas/shipping-pricing`
- `/figma-replicas/review`

