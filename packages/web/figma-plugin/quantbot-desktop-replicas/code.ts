/**
 * Shopify Desktop Figma Replicas
 * Creates desktop screens (1920×1080) with working navigation
 */

const dSpecs = {
  signIn: {
    name: 'Desktop - Sign In', w: 1920, h: 1080, bg: '#0a3a32',
    els: [
      { t: 'box', x: 0, y: 0, w: 800, h: 1080, bg: '#b8e0d2' },
      { t: 'txt', c: 'Shopify', x: 100, y: 200, s: 48, col: '#0a3a32', bold: true },
      { t: 'inp', x: 100, y: 320, w: 600, h: 56 },
      { t: 'inp', x: 100, y: 400, w: 600, h: 56 },
      { t: 'btn', c: 'Sign In', x: 100, y: 500, w: 600, h: 60, prim: true },
      { t: 'btn', c: 'Create Account', x: 100, y: 580, w: 600, h: 60, prim: false },
      { t: 'box', x: 800, y: 0, w: 1120, h: 1080, bg: '#0a3a32' },
      { t: 'txt', c: 'Shopify', x: 1000, y: 450, s: 64, col: '#b8e0d2', bold: true },
    ],
  },
  register: {
    name: 'Desktop - Register', w: 1920, h: 1080, bg: '#0a3a32',
    els: [
      { t: 'box', x: 0, y: 0, w: 800, h: 1080, bg: '#b8e0d2' },
      { t: 'txt', c: 'Create Account', x: 100, y: 150, s: 48, col: '#0a3a32', bold: true },
      { t: 'inp', x: 100, y: 280, w: 600, h: 56 },
      { t: 'inp', x: 100, y: 360, w: 600, h: 56 },
      { t: 'inp', x: 100, y: 440, w: 600, h: 56 },
      { t: 'btn', c: 'REGISTER', x: 100, y: 540, w: 600, h: 60, prim: true },
    ],
  },
  forgotPassword: {
    name: 'Desktop - Forgot Password', w: 1920, h: 1080, bg: '#0a3a32',
    els: [
      { t: 'box', x: 0, y: 0, w: 800, h: 1080, bg: '#b8e0d2' },
      { t: 'txt', c: 'Forgot Password?', x: 100, y: 200, s: 48, col: '#0a3a32', bold: true },
      { t: 'inp', x: 100, y: 320, w: 600, h: 56 },
      { t: 'btn', c: 'SEND RESET LINK', x: 100, y: 420, w: 600, h: 60, prim: true },
    ],
  },
  setup: {
    name: 'Desktop - Setup Overview', w: 1920, h: 1080, bg: '#FFF',
    els: [
      { t: 'box', x: 0, y: 0, w: 1920, h: 120, bg: '#b8e0d2' },
      { t: 'txt', c: 'Shopify', x: 80, y: 42, s: 36, col: '#0a3a32', bold: true },
      { t: 'txt', c: 'Setup - Step 1 of 4', x: 80, y: 180, s: 32, col: '#000', bold: true },
      { t: 'prog', x: 80, y: 240, w: 1760, step: 1, total: 4 },
      { t: 'inp', x: 540, y: 340, w: 840, h: 56 },
      { t: 'btn', c: 'CONTINUE →', x: 1260, y: 900, w: 200, h: 60, prim: true },
    ],
  },
  addProduct: {
    name: 'Desktop - Add Product', w: 1920, h: 1080, bg: '#FFF',
    els: [
      { t: 'box', x: 0, y: 0, w: 1920, h: 120, bg: '#b8e0d2' },
      { t: 'txt', c: 'Shopify', x: 80, y: 42, s: 36, col: '#0a3a32', bold: true },
      { t: 'txt', c: 'Add Product - Step 2 of 4', x: 80, y: 180, s: 32, col: '#000', bold: true },
      { t: 'prog', x: 80, y: 240, w: 1760, step: 2, total: 4 },
      { t: 'inp', x: 120, y: 340, w: 700, h: 56 },
      { t: 'btn', c: 'ADD ANOTHER', x: 120, y: 900, w: 200, h: 60, prim: true },
    ],
  },
  shipping: {
    name: 'Desktop - Shipping & Pricing', w: 1920, h: 1080, bg: '#FFF',
    els: [
      { t: 'box', x: 0, y: 0, w: 1920, h: 120, bg: '#b8e0d2' },
      { t: 'txt', c: 'Shopify', x: 80, y: 42, s: 36, col: '#0a3a32', bold: true },
      { t: 'txt', c: 'Shipping - Step 3 of 4', x: 80, y: 180, s: 32, col: '#000', bold: true },
      { t: 'prog', x: 80, y: 240, w: 1760, step: 3, total: 4 },
      { t: 'btn', c: 'CONTINUE →', x: 1260, y: 900, w: 200, h: 60, prim: true },
    ],
  },
  review: {
    name: 'Desktop - Review Summary', w: 1920, h: 1080, bg: '#FFF',
    els: [
      { t: 'box', x: 0, y: 0, w: 1920, h: 120, bg: '#b8e0d2' },
      { t: 'txt', c: 'Shopify', x: 80, y: 42, s: 36, col: '#0a3a32', bold: true },
      { t: 'txt', c: 'Review - Step 4 of 4', x: 80, y: 180, s: 32, col: '#000', bold: true },
      { t: 'prog', x: 80, y: 240, w: 1760, step: 4, total: 4 },
      { t: 'box', x: 80, y: 340, w: 560, h: 500, bg: '#b8e0d2', bord: true },
      { t: 'box', x: 680, y: 340, w: 560, h: 500, bg: '#b8e0d2', bord: true },
      { t: 'box', x: 1280, y: 340, w: 560, h: 500, bg: '#b8e0d2', bord: true },
      { t: 'btn', c: '← BACK', x: 80, y: 900, w: 200, h: 60, prim: false },
      { t: 'btn', c: 'LAUNCH SHOP', x: 1640, y: 900, w: 200, h: 60, prim: true },
    ],
  },
  error: {
    name: 'Desktop - Error', w: 1920, h: 1080, bg: '#0a3a32',
    els: [
      { t: 'box', x: 735, y: 280, w: 200, h: 200, bg: '#EF4444', round: 100 },
      { t: 'txt', c: '⚠️', x: 795, y: 325, s: 100, col: '#FFF', bold: false },
      { t: 'txt', c: 'Something Went Wrong', x: 710, y: 520, s: 36, col: '#FFF', bold: true },
      { t: 'btn', c: 'TRY AGAIN', x: 710, y: 650, w: 240, h: 60, prim: true, bg: '#EF4444' },
      { t: 'btn', c: 'GO BACK', x: 970, y: 650, w: 240, h: 60, prim: false },
    ],
  },
  emailReg: {
    name: 'Desktop - Email Registered', w: 1920, h: 1080, bg: '#b8e0d2',
    els: [
      { t: 'box', x: 735, y: 220, w: 200, h: 200, bg: '#F59E0B', round: 100 },
      { t: 'txt', c: 'ℹ️', x: 795, y: 265, s: 100, col: '#FFF', bold: false },
      { t: 'txt', c: 'Email Already Registered', x: 680, y: 460, s: 32, col: '#0a3a32', bold: true },
      { t: 'btn', c: 'SIGN IN INSTEAD', x: 710, y: 600, w: 500, h: 60, prim: true },
      { t: 'btn', c: 'RESET PASSWORD', x: 710, y: 680, w: 500, h: 60, prim: false },
      { t: 'btn', c: 'TRY DIFFERENT EMAIL', x: 710, y: 760, w: 500, h: 60, prim: false },
    ],
  },
};

function hex(h: string): RGB {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
  return r ? { r: parseInt(r[1],16)/255, g: parseInt(r[2],16)/255, b: parseInt(r[3],16)/255 } : {r:0,g:0,b:0};
}

async function make(s: any, p: PageNode) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
  
  const f = figma.createFrame();
  f.name = s.name;
  f.resize(s.w, s.h);
  f.fills = [{ type: 'SOLID', color: hex(s.bg) }];
  
  for (const e of s.els) {
    if (e.t === 'box') {
      const b = figma.createFrame();
      b.resize(e.w, e.h);
      b.fills = [{ type: 'SOLID', color: hex(e.bg || '#FFF') }];
      if (e.bord) b.strokes = [{ type: 'SOLID', color: hex('#E0E0E0') }];
      if (e.round) b.cornerRadius = e.round;
      b.x = e.x;
      b.y = e.y;
      f.appendChild(b);
    } else if (e.t === 'txt') {
      const t = figma.createText();
      t.characters = e.c;
      t.fontSize = e.s;
      t.fontName = { family: 'Inter', style: e.bold ? 'Bold' : 'Regular' };
      t.fills = [{ type: 'SOLID', color: hex(e.col) }];
      t.x = e.x;
      t.y = e.y;
      f.appendChild(t);
    } else if (e.t === 'inp') {
      const i = figma.createFrame();
      i.name = 'Input';
      i.resize(e.w, e.h);
      i.fills = [{ type: 'SOLID', color: hex('#FFF') }];
      i.strokes = [{ type: 'SOLID', color: hex('#d9d9d9') }];
      i.strokeWeight = 1;
      i.cornerRadius = 8;
      i.x = e.x;
      i.y = e.y;
      f.appendChild(i);
    } else if (e.t === 'btn') {
      const b = figma.createFrame();
      b.name = e.c;
      b.resize(e.w, e.h);
      const bgC = e.bg || (e.prim ? '#0a3a32' : '#FFF');
      const txC = e.prim ? '#FFF' : '#0a3a32';
      b.fills = [{ type: 'SOLID', color: hex(bgC) }];
      if (!e.prim) {
        b.strokes = [{ type: 'SOLID', color: hex('#0a3a32') }];
        b.strokeWeight = 2;
      }
      b.cornerRadius = 8;
      b.x = e.x;
      b.y = e.y;
      
      const bt = figma.createText();
      bt.characters = e.c;
      bt.fontSize = 16;
      bt.fontName = { family: 'Inter', style: 'Bold' };
      bt.fills = [{ type: 'SOLID', color: hex(txC) }];
      bt.x = (e.w - bt.width) / 2;
      bt.y = (e.h - 20) / 2;
      b.appendChild(bt);
      f.appendChild(b);
    } else if (e.t === 'prog') {
      const pr = figma.createFrame();
      pr.resize(e.w, 8);
      pr.fills = [{ type: 'SOLID', color: hex('#E0E0E0') }];
      pr.cornerRadius = 4;
      pr.x = e.x;
      pr.y = e.y;
      
      const ac = figma.createFrame();
      ac.resize((e.w / e.total) * e.step, 8);
      ac.fills = [{ type: 'SOLID', color: hex('#0a3a32') }];
      ac.cornerRadius = 4;
      pr.appendChild(ac);
      f.appendChild(pr);
    }
  }
  
  p.appendChild(f);
  return f;
}

async function run() {
  try {
    figma.notify('Creating...', { timeout: 1000 });
    
    let pg = figma.currentPage;
    const ex = figma.root.children.find(p => p.name === '🖥️ Desktop Replicas');
    if (ex) {
      pg = ex as PageNode;
      figma.currentPage = pg;
    } else {
      pg = figma.createPage();
      pg.name = '🖥️ Desktop Replicas';
      figma.currentPage = pg;
    }
    
    const all = [dSpecs.signIn, dSpecs.register, dSpecs.forgotPassword, dSpecs.setup, dSpecs.addProduct, dSpecs.shipping, dSpecs.review, dSpecs.error, dSpecs.emailReg];
    const fs: any = {};
    let y = 50;
    
    for (const sp of all) {
      const fr = await make(sp, pg);
      fr.x = 50;
      fr.y = y;
      fs[sp.name] = fr;
      y += sp.h + 100;
    }
    
    // Navigation
    function find(fr: FrameNode, nm: string): any {
      for (const ch of fr.children) {
        if (ch.name.includes(nm)) return ch;
        if ('children' in ch) {
          const fd = find(ch as FrameNode, nm);
          if (fd) return fd;
        }
      }
      return null;
    }
    
    const nav = [
      [fs['Desktop - Sign In'], 'Sign In', fs['Desktop - Setup Overview']],
      [fs['Desktop - Sign In'], 'Create Account', fs['Desktop - Register']],
      [fs['Desktop - Setup Overview'], 'CONTINUE', fs['Desktop - Add Product']],
      [fs['Desktop - Add Product'], 'ADD ANOTHER', fs['Desktop - Shipping & Pricing']],
      [fs['Desktop - Shipping & Pricing'], 'CONTINUE', fs['Desktop - Review Summary']],
      [fs['Desktop - Review Summary'], 'BACK', fs['Desktop - Add Product']],
      [fs['Desktop - Error'], 'GO BACK', fs['Desktop - Sign In']],
      [fs['Desktop - Email Registered'], 'SIGN IN INSTEAD', fs['Desktop - Sign In']],
    ];
    
    for (const [from, btnName, to] of nav) {
      const btn = find(from, btnName);
      if (btn && to && 'reactions' in btn) {
        btn.reactions = [{
          action: { type: 'NODE', destinationId: to.id, navigation: 'NAVIGATE', transition: null },
          trigger: { type: 'ON_CLICK' }
        }];
      }
    }
    
    figma.notify('✅ Done! Press Shift+Space to test', { timeout: 3000 });
  } catch (err) {
    figma.notify('❌ Error: ' + err, { timeout: 5000 });
  }
}

figma.ui.onmessage = (msg) => {
  if (msg.type === 'go') run();
  else figma.closePlugin();
};

figma.showUI(`<html><head><style>
*{margin:0;padding:0}body{font-family:Inter,sans-serif;background:#0a3a32;color:#FFF;padding:20px}
h1{font-size:24px;margin-bottom:16px}
.btn{width:100%;padding:14px;border:none;border-radius:8px;cursor:pointer;margin-top:12px;font-weight:600}
.p{background:#b8e0d2;color:#0a3a32}.p:hover{background:#d4ede5}
.s{background:transparent;color:#b8e0d2;border:2px solid #b8e0d2}.s:hover{background:#1a5447}
</style></head><body>
<h1>Shopify Desktop Replicas</h1>
<p style="margin-bottom:20px;color:#b8e0d2">9 screens (1920×1080) with navigation</p>
<button class="btn p" onclick="parent.postMessage({pluginMessage:{type:'go'}},'*')">🖥️ Create Screens</button>
<button class="btn s" onclick="parent.postMessage({pluginMessage:{type:'cancel'}},'*')">Cancel</button>
</body></html>`, { width: 350, height: 250 });
