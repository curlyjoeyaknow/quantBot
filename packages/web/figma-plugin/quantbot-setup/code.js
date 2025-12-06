"use strict";
/**
 * Shopify Mobile Figma Replicas
 * Creates mobile screens with working navigation
 */
const specs = {
    signIn: {
        name: 'Sign In', w: 440, h: 956, bg: '#0a3a32',
        els: [
            { t: 'txt', c: 'Sign In', x: 40, y: 200, s: 32, col: '#FFF', bold: true },
            { t: 'inp', l: 'Email', x: 40, y: 280, w: 360, h: 56 },
            { t: 'inp', l: 'Password', x: 40, y: 360, w: 360, h: 56 },
            { t: 'btn', c: 'SIGN IN', x: 40, y: 520, w: 154, h: 47, prim: true },
            { t: 'btn', c: 'REGISTER', x: 214, y: 520, w: 154, h: 47, prim: false },
        ],
    },
    register: {
        name: 'Register', w: 440, h: 956, bg: '#b8e0d2',
        els: [
            { t: 'txt', c: 'Create Account', x: 40, y: 100, s: 32, col: '#0a3a32', bold: true },
            { t: 'inp', l: 'Email', x: 40, y: 200, w: 360, h: 56 },
            { t: 'inp', l: 'Password', x: 40, y: 280, w: 360, h: 56 },
            { t: 'inp', l: 'Confirm', x: 40, y: 360, w: 360, h: 56 },
            { t: 'btn', c: 'REGISTER', x: 40, y: 460, w: 360, h: 56, prim: true },
        ],
    },
    forgotPassword: {
        name: 'Forgot Password', w: 440, h: 956, bg: '#FFF',
        els: [
            { t: 'txt', c: 'Forgot Password?', x: 40, y: 100, s: 32, col: '#0a3a32', bold: true },
            { t: 'inp', l: 'Email', x: 40, y: 240, w: 360, h: 56 },
            { t: 'btn', c: 'SEND RESET LINK', x: 40, y: 320, w: 360, h: 56, prim: true },
        ],
    },
    setup: {
        name: 'Setup Overview', w: 1200, h: 800, bg: '#FFF',
        els: [
            { t: 'txt', c: 'Step 1 of 4', x: 40, y: 40, s: 28, col: '#000', bold: true },
            { t: 'prog', x: 40, y: 100, w: 1120, step: 1, total: 4 },
            { t: 'inp', l: 'Shop Name', x: 40, y: 160, w: 500, h: 56 },
            { t: 'btn', c: '← BACK', x: 40, y: 260, w: 120, h: 44, prim: false },
            { t: 'btn', c: 'CONTINUE →', x: 1040, y: 260, w: 120, h: 44, prim: true },
        ],
    },
    addProduct: {
        name: 'Add Product', w: 1200, h: 800, bg: '#FFF',
        els: [
            { t: 'txt', c: 'Step 2 of 4', x: 40, y: 40, s: 28, col: '#000', bold: true },
            { t: 'prog', x: 40, y: 100, w: 1120, step: 2, total: 4 },
            { t: 'inp', l: 'Product Name', x: 40, y: 160, w: 500, h: 56 },
            { t: 'btn', c: 'ADD ANOTHER', x: 40, y: 260, w: 200, h: 44, prim: true },
        ],
    },
    shipping: {
        name: 'Shipping & Pricing', w: 1200, h: 800, bg: '#FFF',
        els: [
            { t: 'txt', c: 'Step 3 of 4', x: 40, y: 40, s: 28, col: '#000', bold: true },
            { t: 'prog', x: 40, y: 100, w: 1120, step: 3, total: 4 },
            { t: 'btn', c: 'CONTINUE →', x: 1040, y: 260, w: 120, h: 44, prim: true },
        ],
    },
    review: {
        name: 'Review Summary', w: 1200, h: 800, bg: '#FFF',
        els: [
            { t: 'txt', c: 'Step 4 of 4', x: 40, y: 40, s: 28, col: '#000', bold: true },
            { t: 'prog', x: 40, y: 100, w: 1120, step: 4, total: 4 },
            { t: 'btn', c: 'BACK TO PRODUCTS', x: 40, y: 260, w: 200, h: 44, prim: false },
            { t: 'btn', c: 'LAUNCH SHOP', x: 960, y: 260, w: 200, h: 44, prim: true },
        ],
    },
};
function hex(h) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    return r ? { r: parseInt(r[1], 16) / 255, g: parseInt(r[2], 16) / 255, b: parseInt(r[3], 16) / 255 } : { r: 0, g: 0, b: 0 };
}
async function make(s, p) {
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
    const f = figma.createFrame();
    f.name = s.name;
    f.resize(s.w, s.h);
    f.fills = [{ type: 'SOLID', color: hex(s.bg) }];
    for (const e of s.els) {
        if (e.t === 'txt') {
            const t = figma.createText();
            t.characters = e.c;
            t.fontSize = e.s;
            t.fontName = { family: 'Inter', style: e.bold ? 'Bold' : 'Regular' };
            t.fills = [{ type: 'SOLID', color: hex(e.col) }];
            t.x = e.x;
            t.y = e.y;
            f.appendChild(t);
        }
        else if (e.t === 'inp') {
            const i = figma.createFrame();
            i.name = e.l;
            i.resize(e.w, e.h);
            i.fills = [{ type: 'SOLID', color: hex('#FFF') }];
            i.strokes = [{ type: 'SOLID', color: hex('#d9d9d9') }];
            i.strokeWeight = 2;
            i.cornerRadius = 8;
            i.x = e.x;
            i.y = e.y;
            f.appendChild(i);
        }
        else if (e.t === 'btn') {
            const b = figma.createFrame();
            b.name = e.c;
            b.resize(e.w, e.h);
            const bgC = e.prim ? '#0a3a32' : '#FFF';
            const txC = e.prim ? '#FFF' : '#0a3a32';
            b.fills = [{ type: 'SOLID', color: hex(bgC) }];
            if (!e.prim) {
                b.strokes = [{ type: 'SOLID', color: hex('#0a3a32') }];
                b.strokeWeight = 1;
            }
            b.cornerRadius = 8;
            b.x = e.x;
            b.y = e.y;
            const bt = figma.createText();
            bt.characters = e.c;
            bt.fontSize = 14;
            bt.fontName = { family: 'Inter', style: 'Bold' };
            bt.fills = [{ type: 'SOLID', color: hex(txC) }];
            bt.x = (e.w - bt.width) / 2;
            bt.y = (e.h - 18) / 2;
            b.appendChild(bt);
            f.appendChild(b);
        }
        else if (e.t === 'prog') {
            const pr = figma.createFrame();
            pr.name = 'Progress';
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
        const ex = figma.root.children.find(p => p.name === '📱 Figma Replicas');
        if (ex) {
            pg = ex;
            figma.currentPage = pg;
        }
        else {
            pg = figma.createPage();
            pg.name = '📱 Figma Replicas';
            figma.currentPage = pg;
        }
        const all = [specs.signIn, specs.register, specs.forgotPassword, specs.setup, specs.addProduct, specs.shipping, specs.review];
        const fs = {};
        let x = 50;
        for (const sp of all) {
            const fr = await make(sp, pg);
            fr.x = x;
            fs[sp.name] = fr;
            x += sp.w + 50;
        }
        // Add navigation
        function find(fr, nm) {
            for (const ch of fr.children) {
                if (ch.name.includes(nm))
                    return ch;
                if ('children' in ch) {
                    const fd = find(ch, nm);
                    if (fd)
                        return fd;
                }
            }
            return null;
        }
        const nav = [
            [fs['Sign In'], 'SIGN IN', fs['Setup Overview']],
            [fs['Sign In'], 'REGISTER', fs['Register']],
            [fs['Setup Overview'], 'CONTINUE', fs['Add Product']],
            [fs['Setup Overview'], 'BACK', fs['Sign In']],
            [fs['Add Product'], 'ADD ANOTHER', fs['Shipping & Pricing']],
            [fs['Shipping & Pricing'], 'CONTINUE', fs['Review Summary']],
            [fs['Review Summary'], 'BACK', fs['Add Product']],
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
    }
    catch (err) {
        figma.notify('❌ Error: ' + err, { timeout: 5000 });
    }
}
figma.ui.onmessage = (msg) => {
    if (msg.type === 'go')
        run();
    else
        figma.closePlugin();
};
figma.showUI(`<html><head><style>
*{margin:0;padding:0}body{font-family:Inter,sans-serif;background:#0a3a32;color:#FFF;padding:20px}
h1{font-size:24px;margin-bottom:16px}
.btn{width:100%;padding:14px;border:none;border-radius:8px;cursor:pointer;margin-top:12px;font-weight:600}
.p{background:#b8e0d2;color:#0a3a32}.p:hover{background:#d4ede5}
.s{background:transparent;color:#b8e0d2;border:2px solid #b8e0d2}.s:hover{background:#1a5447}
</style></head><body>
<h1>Shopify Mobile Replicas</h1>
<p style="margin-bottom:20px;color:#b8e0d2">7 screens with working navigation</p>
<button class="btn p" onclick="parent.postMessage({pluginMessage:{type:'go'}},'*')">🎨 Create Screens</button>
<button class="btn s" onclick="parent.postMessage({pluginMessage:{type:'cancel'}},'*')">Cancel</button>
</body></html>`, { width: 350, height: 250 });
