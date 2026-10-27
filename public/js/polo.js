// Polo dibujado en SVG con volumen: sobre el color de la tela se mezclan sombras, brillos de pliegues,
// costuras, cuello acanalado y una textura de algodón.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const PRINTS = {
  ninguno: 'Sin estampado',
  logo: 'Logo POLOLAB',
  lima26: 'Lima 26 college',
  atardecer: 'Atardecer neón',
  ola: 'Ola del Pacífico',
};

function luminance(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  if (Number.isNaN(n)) return 0;
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const isLight = (hex) => luminance(hex) > 0.45;
export { luminance };

const HEX = /^#[0-9a-f]{6}$/i;
const FONT = `font-family="'Barlow Condensed', 'Arial Narrow', Impact, sans-serif"`;

// Silueta (viewBox 400 x 440). Solo cambia el cuello entre la vista frontal y la espalda.
const NECK_FRONT = 'M158 40C166 66 184 76 200 76C216 76 234 66 242 40';
const NECK_BACK = 'M158 40C176 47 224 47 242 40';
const OUTLINE =
  'C268 46 296 54 318 66C336 76 356 112 370 150Q346 168 316 178C308 166 302 156 298 146C300 220 302 330 304 404' +
  'Q200 414 96 404C98 330 100 220 102 146C98 156 92 166 84 178Q54 168 30 150C44 112 64 76 82 66C104 54 132 46 158 40Z';
const BODY = { front: NECK_FRONT + OUTLINE, back: NECK_BACK + OUTLINE };

// Mapa de sombreado: gris medio = tela sin cambio, claro = brillo de un pliegue, oscuro = sombra.
// Se difumina y se mezcla con "hard-light" sobre el color, así funciona igual en polos negros y blancos.
const FOLDS = `
  <path d="M106 170C116 216 122 276 118 368M294 170C284 216 278 276 282 368" stroke="#4a4a4a" stroke-width="12"/>
  <path d="M126 186C136 238 138 296 132 372M274 186C264 238 262 296 268 372" stroke="#a6a6a6" stroke-width="8"/>
  <path d="M138 292C172 290 204 306 242 330" stroke="#969696" stroke-width="7"/>
  <path d="M146 308C178 308 206 322 238 344" stroke="#707070" stroke-width="5"/>
  <path d="M232 238C246 262 258 286 262 316" stroke="#8e8e8e" stroke-width="6"/>
  <path d="M78 80C68 100 56 124 46 146M322 80C332 100 344 124 354 146" stroke="#ababab" stroke-width="12"/>
  <path d="M84 70C92 98 98 122 102 146M316 70C308 98 302 122 298 146" stroke="#555" stroke-width="7"/>
  <ellipse cx="104" cy="160" rx="14" ry="24" fill="#474747"/><ellipse cx="296" cy="160" rx="14" ry="24" fill="#474747"/>
  <path d="M100 390Q200 401 300 390" stroke="#949494" stroke-width="5"/>`;

const SHADES = {
  front: `${FOLDS}
    <path d="M110 150C140 168 160 186 178 214M290 150C260 168 240 186 222 214" stroke="#646464" stroke-width="6"/>
    <path d="M152 40C162 72 184 82 200 82C216 82 238 72 248 40" stroke="#b8b8b8" stroke-width="6"/>
    <path d="M148 45C160 82 182 94 200 94C218 94 240 82 252 45" stroke="#5c5c5c" stroke-width="6"/>`,
  back: `${FOLDS}
    <ellipse cx="150" cy="130" rx="42" ry="30" fill="#9a9a9a"/><ellipse cx="250" cy="130" rx="42" ry="30" fill="#949494"/>
    <path d="M200 66C198 140 202 240 200 400" stroke="#6a6a6a" stroke-width="6"/>
    <path d="M154 42C176 50 224 50 246 42" stroke="#b8b8b8" stroke-width="6"/>
    <path d="M150 49C174 59 226 59 250 49" stroke="#606060" stroke-width="6"/>`,
};

const MOUNTAIN = 'M-42 27-9-27 9 0 21-18 42 27Z';

function printMarkup(print, { id, a, ink, base }) {
  switch (print) {
    case 'logo':
      return `<g transform="translate(200 150)">
        <path d="${MOUNTAIN}" fill="${a}"/>
        <text y="66" text-anchor="middle" ${FONT} font-weight="800" font-size="36" letter-spacing="7" fill="${ink}">POLOLAB</text>
        <text y="86" text-anchor="middle" ${FONT} font-weight="600" font-size="10.5" letter-spacing="5" fill="${a}">EST. 2026 · LIMA, PERÚ</text>
      </g>`;
    case 'lima26':
      return `<path id="${id}-arc" d="M118 172Q200 112 282 172" fill="none"/>
        <text ${FONT} font-weight="800" font-size="54" letter-spacing="5" fill="${a}" stroke="${ink}" stroke-width="2.5" paint-order="stroke">
          <textPath href="#${id}-arc" startOffset="50%" text-anchor="middle">LIMA</textPath></text>
        <text x="200" y="262" text-anchor="middle" ${FONT} font-weight="800" font-size="96" fill="none" stroke="${a}" stroke-width="3.5">26</text>
        <text x="200" y="284" text-anchor="middle" ${FONT} font-weight="600" font-size="10.5" letter-spacing="4" fill="${ink}">CIUDAD DE LOS REYES</text>`;
    case 'atardecer':
      return `<linearGradient id="${id}-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffd23f"/><stop offset=".55" stop-color="${a}"/><stop offset="1" stop-color="${a}"/>
        </linearGradient>
        <clipPath id="${id}-sc"><circle cx="200" cy="196" r="60"/></clipPath>
        <g clip-path="url(#${id}-sc)">
          <rect x="138" y="134" width="124" height="124" fill="url(#${id}-sun)"/>
          <path d="M138 204h124v3H138zM138 216h124v4H138zM138 228h124v5H138zM138 241h124v7H138z" fill="${base}"/>
          <path d="M128 240V218h10v-8h8v14h10v-26h8v-8h6v8h8v14h12v-10h8v-22h6v22h8v6h10v-14h10v20h10v-12h10v16h10v-8h10v32z" fill="${base}"/>
        </g>
        <path d="M118 250H282M134 260H266M152 270H248" stroke="${a}" stroke-width="2.6" stroke-linecap="round"/>
        <text x="200" y="300" text-anchor="middle" ${FONT} font-weight="800" font-size="24" letter-spacing="12" fill="${ink}">LIMA</text>`;
    case 'ola':
      return `<path id="${id}-ring" d="M136 204a64 64 0 1 1 128 0a64 64 0 1 1-128 0" fill="none"/>
        <circle cx="200" cy="204" r="80" fill="none" stroke="${a}" stroke-width="3"/>
        <clipPath id="${id}-oc"><circle cx="200" cy="204" r="50"/></clipPath>
        <circle cx="200" cy="204" r="50" fill="${a}"/>
        <g clip-path="url(#${id}-oc)" fill="none" stroke="${base}" stroke-width="5" stroke-linecap="round">
          <path d="M140 196q15-16 30 0t30 0 30 0 30 0 30 0"/>
          <path d="M140 214q15-16 30 0t30 0 30 0 30 0 30 0"/>
          <path d="M140 232q15-16 30 0t30 0 30 0 30 0 30 0"/>
          <circle cx="222" cy="176" r="9" fill="${base}" stroke="none"/>
        </g>
        <text ${FONT} font-weight="700" font-size="14" letter-spacing="3.2" fill="${ink}">
          <textPath href="#${id}-ring" startOffset="2%">PACÍFICO · LIMA · PERÚ · OLAS ·</textPath></text>`;
    default:
      return '';
  }
}

let seq = 0;

export function poloSVG({
  color = '#1a1a1c', accent = '#ff2a2a', design = 'liso', print = 'ninguno', text = '',
  view = 'front', className = '', label = '', flat = false,
} = {}) {
  const c = HEX.test(color) ? color : '#1a1a1c';
  const a = HEX.test(accent) ? accent : '#ff2a2a';
  const side = view === 'back' ? 'back' : 'front';
  const id = `polo${++seq}`;
  const light = isLight(c);
  const ink = light ? '#141414' : '#f4f4f4';
  const stitch = light ? 'rgba(0,0,0,.22)' : 'rgba(255,255,255,.2)';
  const body = BODY[side];

  // ----- Detalles de diseño -----
  let deco = '';
  if (design === 'franja') {
    deco = `<rect x="186" y="20" width="28" height="420" fill="${a}"/><rect x="197" y="20" width="6" height="420" fill="${ink}" opacity=".85"/>`;
  } else if (design === 'lineas') {
    deco = `<g id="${id}-ln" fill="none" stroke="${a}" stroke-width="5.5" stroke-linecap="round">
        <path d="M160 49C134 55 108 63 89 75C72 86 55 117 42 150"/>
        <path d="M162 59C138 64 114 72 96 84C82 94 66 124 55 156"/>
        <path d="M30 150Q54 168 84 178L88 167Q60 158 36 140Z" fill="${a}" stroke="none"/>
      </g>
      <use href="#${id}-ln" transform="translate(400 0) scale(-1 1)"/>`;
  }

  const hasPrint = side === 'front' && PRINTS[print] && print !== 'ninguno';
  const art = hasPrint ? printMarkup(print, { id, a, ink, base: c }) : '';
  const emblem = side === 'front' && !hasPrint
    ? `<path d="M228 130 239 112l6 9 4-6 7 15z" fill="${design === 'franja' ? ink : a}"/>`
    : '';

  // Espalda: logo pequeño bajo el cuello y el nombre personalizado como en una camiseta de fútbol.
  const name = String(text || '').toUpperCase().slice(0, 12);
  const backArt = side === 'back'
    ? `${design === 'franja' ? '' : `<text x="200" y="76" text-anchor="middle" ${FONT} font-weight="700" font-size="11" letter-spacing="4" fill="${ink}" opacity=".85">POLOLAB</text>`}
       ${name ? `<text x="200" y="150" text-anchor="middle" ${FONT} font-weight="800" font-size="50" letter-spacing="3"
          fill="${design === 'franja' ? ink : a}" stroke="${c}" stroke-width="5" paint-order="stroke"
          ${name.length > 7 ? 'textLength="196" lengthAdjust="spacingAndGlyphs"' : ''}>${esc(name)}</text>` : ''}`
    : '';

  // ----- Cuello acanalado y costuras -----
  const ribPath = side === 'front'
    ? 'M158 40C166 66 184 76 200 76C216 76 234 66 242 40L252 37C242 72 222 86 200 86C178 86 158 72 148 37Z'
    : 'M158 40C176 47 224 47 242 40L252 37C230 50 170 50 148 37Z';
  const ribLine = side === 'front'
    ? 'M153 39C162 70 184 81 200 81C216 81 238 70 247 39'
    : 'M153 39C174 48 226 48 247 39';
  const rib = `<path d="${ribPath}" fill="${design === 'lineas' ? a : c}"/>
    <path d="${ribLine}" fill="none" stroke="${light ? 'rgba(0,0,0,.2)' : 'rgba(0,0,0,.35)'}" stroke-width="9" stroke-dasharray="1.1 1.7"/>`;
  const seams = `
    <path d="M158 41C132 47 104 55 82 67M242 41C268 47 296 55 318 67M82 66C92 96 98 122 102 146M318 66C308 96 302 122 298 146"
      fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1.2"/>
    <path d="M100 395Q200 405 300 395M100 399Q200 409 300 399M36 142Q58 159 87 170M364 142Q342 159 313 170"
      fill="none" stroke="${stitch}" stroke-width="1" stroke-dasharray="3 2.4"/>
    <path d="${side === 'front' ? 'M150 40C160 75 182 88 200 88C218 88 240 75 250 40' : 'M150 39C172 52 228 52 250 39'}"
      fill="none" stroke="${stitch}" stroke-width="1" stroke-dasharray="3 2.4"/>`;

  // ----- Interior visible por el cuello (solo de frente) -----
  const inside = side === 'front'
    ? `<path d="M158 40C166 66 184 76 200 76C216 76 234 66 242 40C226 30 174 30 158 40Z" fill="${c}"/>
       <path d="M158 40C166 66 184 76 200 76C216 76 234 66 242 40C226 30 174 30 158 40Z" fill="url(#${id}-in)"/>
       <path d="M150 38C172 26 228 26 250 38L242 41C224 33 176 33 158 41Z" fill="${c}"/>
       <path d="M150 38C172 26 228 26 250 38L242 41C224 33 176 33 158 41Z" fill="#000" opacity=".25"/>
       <rect x="187" y="41" width="26" height="14" rx="1.5" fill="#f1f1f1"/>
       <text x="200" y="50.5" text-anchor="middle" ${FONT} font-weight="700" font-size="6" letter-spacing=".8" fill="#111">POLOLAB</text>`
    : '';

  const lighting = flat
    ? `<rect width="400" height="440" fill="url(#${id}-fh)"/>`
    : `<g filter="url(#${id}-b)" style="mix-blend-mode:hard-light" fill="none" stroke-linecap="round">
         <rect width="400" height="440" fill="url(#${id}-base)"/>
         <rect width="400" height="440" fill="url(#${id}-bulge)"/>
         <path d="${body}" stroke="#262626" stroke-width="30"/>
         <path d="${body}" stroke="#c8c8c8" stroke-width="8" transform="translate(7 5)"/>
         ${SHADES[side]}
       </g>
       <rect width="400" height="440" filter="url(#${id}-n)" opacity="${light ? '.1' : '.16'}" style="mix-blend-mode:hard-light"/>`;

  return `<svg class="polo ${esc(className)}" viewBox="0 0 400 440" role="img" aria-label="${esc(label || 'Polo')}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="${id}-c"><path d="${body}"/></clipPath>
      <radialGradient id="${id}-sh"><stop offset="0" stop-color="#000" stop-opacity=".65"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <linearGradient id="${id}-in" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></linearGradient>
      <linearGradient id="${id}-v" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".06"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/>
      </linearGradient>
      ${flat
        ? `<linearGradient id="${id}-fh" x1="0" x2="1">
             <stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".25" stop-color="#000" stop-opacity=".05"/>
             <stop offset=".45" stop-color="#fff" stop-opacity=".1"/><stop offset=".75" stop-color="#000" stop-opacity=".08"/>
             <stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>`
        : `<linearGradient id="${id}-base" x1="0" y1="0" x2="1" y2="1">
             <stop offset="0" stop-color="#9c9c9c"/><stop offset=".5" stop-color="#808080"/><stop offset="1" stop-color="#686868"/>
           </linearGradient>
           <radialGradient id="${id}-bulge" cx="178" cy="${side === 'front' ? 150 : 130}" r="120" gradientUnits="userSpaceOnUse">
             <stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
           </radialGradient>
           <filter id="${id}-b" filterUnits="userSpaceOnUse" x="0" y="0" width="400" height="440">
             <feGaussianBlur stdDeviation="7"/>
           </filter>
           <filter id="${id}-n" filterUnits="userSpaceOnUse" x="0" y="0" width="400" height="440">
             <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="5"/>
             <feColorMatrix values=".33 .33 .33 0 0 .33 .33 .33 0 0 .33 .33 .33 0 0 0 0 0 0 1"/>
           </filter>`}
    </defs>
    <ellipse cx="200" cy="424" rx="150" ry="11" fill="url(#${id}-sh)"/>
    ${inside}
    <g clip-path="url(#${id}-c)">
      <rect width="400" height="440" fill="${c}"/>
      ${deco}${art}${emblem}${backArt}${rib}${seams}
      ${lighting}
      <rect width="400" height="440" fill="url(#${id}-v)"/>
    </g>
    <path class="polo-rim" d="${body}" fill="none" stroke="${a}" stroke-width="2.5"/>
  </svg>`;
}
