// Mobile "download your gallery" page. Bilingual (Hebrew default), styled to
// match the gallery site: cream surfaces, bordeaux accents, Playfair + Montserrat.

type Item = Record<string, any>;

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const icon = (d: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const ICONS = {
  back: "M19 12H5m6-6-6 6 6 6",
  download: "M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14",
  save: "M12 4v10m0 0-4-4m4 4 4-4M6 15v4h12v-4",
  play: "M8 5.5v13l10.5-6.5z",
};

const COPY = {
  he: {
    back: "חזרה לגלריה",
    eyebrow: "קבצים מקוריים · איכות מלאה",
    photos: "תמונות",
    films: "סרטים",
    zip: "הורדת הכל כקובץ ZIP",
    preparing: "מכינים את ההורדה…",
    started: "ההורדה התחילה",
    guideTitle: "איך שומרים לגלריה בטלפון",
    guideHint: "אחרי ההורדה, פתחו את הקובץ לפי השלבים:",
    ios: [
      "לחצו על “הורדת הכל” והמתינו לסיום ההורדה.",
      "פתחו את אפליקציית Files ← Downloads, ולחצו פעם אחת על קובץ ה־ZIP כדי לפתוח אותו.",
      "היכנסו לתיקייה שנוצרה, לחצו על ⋯ ואז Select ← Select All.",
      "לחצו Share ובחרו Save Images. התמונות יופיעו באפליקציית Photos.",
    ],
    android: [
      "לחצו על “הורדת הכל” והמתינו לסיום ההורדה.",
      "פתחו את Files או My Files ← Downloads, ולחצו על קובץ ה־ZIP.",
      "בחרו Extract כדי לפתוח את הקבצים לתיקייה חדשה.",
      "העבירו את הקבצים לתיקיית Pictures או DCIM והם יופיעו בגלריה.",
    ],
    singleTitle: "שמירה אחת־אחת",
    singleHint: "לחצו על תמונה כדי לשמור אותה ישירות לגלריה בטלפון.",
    preparingOne: "מכינים את הקובץ…",
    chooseSave: "בחרו Save Image או Save Video",
    photo: "תמונה",
    film: "סרט",
  },
  en: {
    back: "Back to gallery",
    eyebrow: "Original files · Full quality",
    photos: "photos",
    films: "films",
    zip: "Download everything as ZIP",
    preparing: "Preparing your download…",
    started: "Your download has started",
    guideTitle: "Saving to your phone's photos",
    guideHint: "Once the download finishes, follow these steps:",
    ios: [
      "Tap “Download everything” and wait for it to finish.",
      "Open the Files app → Downloads, and tap the ZIP once to open it.",
      "Open the new folder, tap ⋯ then Select → Select All.",
      "Tap Share and choose Save Images. They'll appear in Photos.",
    ],
    android: [
      "Tap “Download everything” and wait for it to finish.",
      "Open Files or My Files → Downloads, and tap the ZIP file.",
      "Choose Extract to unpack the files into a new folder.",
      "Move the files to Pictures or DCIM so they appear in Gallery.",
    ],
    singleTitle: "Save one by one",
    singleHint: "Tap any photo to save it straight to your phone.",
    preparingOne: "Preparing the file…",
    chooseSave: "Choose Save Image or Save Video",
    photo: "Photo",
    film: "Film",
  },
};

export function renderDownloadsPage(opts: {
  names: string;
  galleryUrl: string;
  archiveHref: string;
  media: Item[];
  safeName: (name: string) => string;
}) {
  const { names, galleryUrl, archiveHref, media, safeName } = opts;
  const photoCount = media.filter((item) => item.type === "photo").length;
  const filmCount = media.length - photoCount;
  const tiles = media
    .map((item, index) => {
      const name = safeName(item.filename || `${item.type}-${index + 1}`);
      const href = `/api/download?key=${encodeURIComponent(item.originalKey)}&name=${encodeURIComponent(name)}`;
      const preview = item.type === "photo" ? item.url : item.posterUrl;
      return `<li><button class="tile" data-href="${esc(href)}" data-name="${esc(name)}" aria-label="${esc(name)}">${
        preview ? `<img src="${esc(preview)}" alt="" loading="lazy" decoding="async">` : ""
      }${item.type === "video" ? `<span class="tile-film">${icon(ICONS.play)}</span>` : ""}<span class="tile-save">${icon(ICONS.save)}</span></button></li>`;
    })
    .join("");
  const steps = (key: "ios" | "android") =>
    `<ol class="steps" data-steps="${key}">${[0, 1, 2, 3].map((i) => `<li><b>${i + 1}</b><span data-i18n="${key}.${i}"></span></li>`).join("")}</ol>`;
  const counts = [
    photoCount ? `<span>${photoCount} <i data-i18n="photos"></i></span>` : "",
    filmCount ? `<span>${filmCount} <i data-i18n="films"></i></span>` : "",
  ].filter(Boolean).join('<em aria-hidden="true">·</em>');

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#fffdf8"><title>${esc(names)} · RZ</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&family=Playfair+Display:ital,wght@0,400;1,400&family=Frank+Ruhl+Libre:wght@400&family=Heebo:wght@400;500;600&display=swap">
<style>
:root{--cream:#fffdf8;--paper:#f4efe7;--ink:#231c17;--muted:#7a6d62;--line:#e6dccf;--wine:rgb(75,11,16);--wine-2:#6a1820}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{background:var(--paper)}
body{margin:0;min-height:100svh;background:var(--paper);color:var(--ink);font-family:Montserrat,Heebo,Arial,sans-serif;font-size:15px;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;cursor:pointer}
svg{width:18px;height:18px;flex:none}
.top{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(12px + env(safe-area-inset-top)) 18px 12px;background:rgba(255,253,248,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.back{display:inline-flex;align-items:center;gap:8px;color:var(--ink);text-decoration:none;font-size:13px;font-weight:500}
[dir=rtl] .back svg{transform:scaleX(-1)}
.lang{display:inline-flex;padding:3px;border-radius:999px;background:var(--paper);border:1px solid var(--line)}
.lang button{min-width:64px;padding:7px 12px;border:0;border-radius:999px;background:none;font-size:12px;font-weight:500;color:var(--muted);transition:background .2s,color .2s}
.lang button.active{background:var(--ink);color:#fff}
main{width:min(720px,100%);margin:0 auto;padding:34px 18px calc(60px + env(safe-area-inset-bottom))}
.hero{text-align:center}
.seal{width:56px;height:56px;margin:0 auto 18px;display:grid;place-items:center;border-radius:50%;background:var(--wine);color:var(--cream);font-family:"Playfair Display",Georgia,serif;font-size:17px;letter-spacing:.02em;box-shadow:0 0 0 4px rgba(75,11,16,.1)}
.eyebrow{margin:0;color:var(--muted);font-size:11px;font-weight:500;letter-spacing:.16em;text-transform:uppercase}
[dir=rtl] .eyebrow{letter-spacing:.04em}
h1{margin:10px 0 8px;font-family:"Playfair Display",Georgia,serif;font-weight:400;font-size:clamp(34px,10vw,52px);line-height:1.08}
.counts{display:inline-flex;gap:8px;align-items:center;color:var(--muted);font-size:13px}
.counts i{font-style:normal}.counts em{font-style:normal;opacity:.6}
.cta{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:56px;margin:28px 0 0;border-radius:999px;background:var(--wine);color:#fff;text-decoration:none;font-size:15px;font-weight:600;box-shadow:0 14px 30px rgba(75,11,16,.22);transition:transform .2s,background .2s}
.cta:active{transform:scale(.98);background:var(--wine-2)}
.cta.is-busy{pointer-events:none;opacity:.92}
.spin{width:18px;height:18px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.card{margin-top:28px;padding:22px 20px;border-radius:20px;background:var(--cream);border:1px solid var(--line)}
h2{margin:0;font-family:"Playfair Display","Frank Ruhl Libre",Georgia,serif;font-weight:400;font-size:24px;line-height:1.2}
.hint{margin:6px 0 0;color:var(--muted);font-size:13px;line-height:1.6}
.seg{display:flex;padding:3px;margin:18px 0 6px;border-radius:999px;background:var(--paper);border:1px solid var(--line)}
.seg button{flex:1;padding:10px;border:0;border-radius:999px;background:none;font-size:13px;font-weight:500;color:var(--muted);transition:background .2s,color .2s}
.seg button.active{background:var(--cream);color:var(--ink);box-shadow:0 2px 8px rgba(35,28,23,.1)}
.steps{display:none;margin:0;padding:0;list-style:none}
.steps.active{display:block}
.steps li{display:grid;grid-template-columns:28px 1fr;gap:14px;align-items:start;padding:14px 0;border-bottom:1px solid #f0e9df;line-height:1.6;font-size:14px}
.steps li:last-child{border-bottom:0;padding-bottom:0}
.steps b{width:28px;height:28px;display:grid;place-items:center;border-radius:50%;background:rgba(75,11,16,.08);color:var(--wine);font-size:12px;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:18px 0 0;padding:0;list-style:none}
.tile{position:relative;display:block;width:100%;padding:0 0 100%;border:0;border-radius:10px;overflow:hidden;background:#e7dfd4}
.tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.tile-save,.tile-film{position:absolute;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:rgba(20,14,12,.55);color:#fff;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.tile-save{bottom:6px;inset-inline-end:6px}.tile-film{top:6px;inset-inline-start:6px}
.tile-save svg,.tile-film svg{width:14px;height:14px}.tile-film svg{fill:currentColor;stroke:none}
.tile.is-busy::after{content:"";position:absolute;inset:0;background:rgba(255,253,248,.55) center/26px no-repeat}
.toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));z-index:20;display:none;align-items:center;gap:10px;padding:12px 18px;border-radius:999px;background:rgba(20,14,12,.9);color:#fff;font-size:13px;font-weight:500;transform:translateX(-50%);box-shadow:0 14px 40px rgba(0,0,0,.3);white-space:nowrap}
.toast.show{display:inline-flex}
@media(min-width:620px){.grid{grid-template-columns:repeat(4,1fr);gap:8px}main{padding-top:48px}}
</style></head><body>
<header class="top">
  <a class="back" href="${esc(galleryUrl)}">${icon(ICONS.back)}<span data-i18n="back"></span></a>
  <div class="lang" role="group" aria-label="Language"><button data-lang="he">עברית</button><button data-lang="en">English</button></div>
</header>
<main>
  <section class="hero">
    <div class="seal">RZ</div>
    <p class="eyebrow" data-i18n="eyebrow"></p>
    <h1>${esc(names)}</h1>
    <div class="counts">${counts}</div>
    <a class="cta" id="zip" href="${esc(archiveHref)}">${icon(ICONS.download)}<span data-i18n="zip"></span></a>
  </section>
  <section class="card">
    <h2 data-i18n="guideTitle"></h2>
    <p class="hint" data-i18n="guideHint"></p>
    <div class="seg" role="tablist"><button data-tab="ios">iPhone</button><button data-tab="android">Android</button></div>
    ${steps("ios")}${steps("android")}
  </section>
  <section class="card">
    <h2 data-i18n="singleTitle"></h2>
    <p class="hint" data-i18n="singleHint"></p>
    <ul class="grid">${tiles}</ul>
  </section>
</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>
const COPY=${JSON.stringify(COPY)};
let lang=localStorage.getItem('rz-lang')||'he',device=/Android/i.test(navigator.userAgent)?'android':'ios';
const t=k=>k.split('.').reduce((o,p)=>o&&o[p],COPY[lang])||'';
const toast=document.getElementById('toast');let toastTimer;
const say=(text,ms)=>{toast.innerHTML=text;toast.classList.add('show');clearTimeout(toastTimer);if(ms)toastTimer=setTimeout(()=>toast.classList.remove('show'),ms)};
const render=()=>{document.documentElement.lang=lang;document.documentElement.dir=lang==='he'?'rtl':'ltr';
document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));
document.querySelectorAll('[data-lang]').forEach(b=>b.classList.toggle('active',b.dataset.lang===lang));
document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===device));
document.querySelectorAll('[data-steps]').forEach(s=>s.classList.toggle('active',s.dataset.steps===device));};
document.querySelectorAll('[data-lang]').forEach(b=>b.onclick=()=>{lang=b.dataset.lang;try{localStorage.setItem('rz-lang',lang)}catch(e){}render()});
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{device=b.dataset.tab;render()});
const zip=document.getElementById('zip');
zip.addEventListener('click',()=>{zip.classList.add('is-busy');const label=zip.querySelector('span');label.textContent=t('preparing');zip.querySelector('svg').outerHTML='<i class="spin"></i>';
setTimeout(()=>{zip.classList.remove('is-busy');zip.querySelector('.spin').outerHTML=${JSON.stringify(icon(ICONS.download))};label.textContent=t('zip');say(t('started'),2600)},4000)});
document.querySelectorAll('.tile').forEach(tile=>tile.onclick=async()=>{if(tile.classList.contains('is-busy'))return;tile.classList.add('is-busy');say('<i class="spin"></i>'+t('preparingOne'));
try{const r=await fetch(tile.dataset.href);if(!r.ok)throw new Error();const blob=await r.blob();const file=new File([blob],tile.dataset.name,{type:blob.type||'application/octet-stream'});
if(navigator.canShare&&navigator.canShare({files:[file]})){toast.classList.remove('show');await navigator.share({files:[file]});}else{location.href=tile.dataset.href;toast.classList.remove('show')}}
catch(e){toast.classList.remove('show');if(!(e&&e.name==='AbortError'))location.href=tile.dataset.href}finally{tile.classList.remove('is-busy')}});
render();
</script></body></html>`;
}
