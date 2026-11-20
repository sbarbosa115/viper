import { midnightTokens } from './tokens.js';

const root = Object.entries(midnightTokens)
  .map(([name, value]) => `${name}:${value}`)
  .join(';');

/**
 * The whole stylesheet of the public site, inlined in `<head>` (critical CSS, no extra request).
 * Marketing layout from DESIGN.md section 5: max width 1200, 80px desktop padding, 24px gutter on
 * tablets, 16px on phones, sections separated by `--line` rules.
 */
export const siteCss = `
:root{${root}}
/* Arial with Geist's metrics, so swapping in the web font barely moves text (CLS). */
@font-face{font-family:'Geist Fallback';src:local('Arial'),local('Helvetica'),local('Liberation Sans');size-adjust:104.5%;ascent-override:95%;descent-override:22%;line-gap-override:0%}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:16px}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
body{margin:0;background:var(--bg);color:var(--text-2);font-family:var(--font-family-sans);font-size:16px;line-height:1.6}
a{color:var(--accent)}a:hover{color:var(--accent-hover)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
h1,h2,h3{color:var(--text);font-weight:600;margin:0}
p{margin:0}
.mono{font-family:var(--font-family-mono)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.skip{position:absolute;left:-9999px;top:8px;z-index:10;background:var(--accent);color:var(--accent-ink);padding:8px 12px;border-radius:8px;font-weight:600}
.skip:focus{left:16px}
.page{min-height:100vh;display:flex;flex-direction:column;max-width:1440px;margin:0 auto}
.page>main{flex:1 0 auto}
.overline{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
.dot{color:var(--accent)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font:inherit;font-size:15px;font-weight:600;border-radius:10px;padding:10px 18px;text-decoration:none;cursor:pointer;border:1px solid transparent;min-height:44px}
.btn-primary{background:var(--accent);color:var(--accent-ink)}
.btn-primary:hover{background:var(--accent-hover);color:var(--accent-ink)}
.btn-secondary{background:transparent;border-color:var(--line-control);color:var(--text);font-weight:500}
.btn-secondary:hover{color:var(--text);background:var(--surface-raised)}
.btn-block{width:100%;padding:13px}
.btn[aria-disabled=true],.btn:disabled{opacity:.6;cursor:progress}

/* Header */
.site-header{height:72px;padding:0 80px;display:flex;align-items:center;gap:40px;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px;color:var(--text);text-decoration:none;font-weight:600;font-size:18px}
.brand:hover{color:var(--text)}
.brand-mark rect{fill:var(--accent)}.brand-mark path{stroke:var(--accent-ink)}
.nav{display:flex;gap:28px;font-size:15px;flex-grow:1}
.nav a{color:var(--text-muted);text-decoration:none}.nav a:hover{color:var(--text)}
.header-login{color:var(--text);text-decoration:none;font-size:15px;padding:10px 4px}
.header-login:hover{color:var(--accent-hover)}
.menu{display:none;position:relative}
.menu>summary{list-style:none;width:44px;height:44px;border-radius:10px;border:1px solid var(--line-control);display:flex;align-items:center;justify-content:center;cursor:pointer}
.menu>summary::-webkit-details-marker{display:none}
.menu svg path{stroke:var(--text)}
.menu-panel{position:absolute;right:0;top:52px;z-index:5;min-width:220px;background:var(--surface);border:1px solid var(--line-strong);border-radius:14px;box-shadow:var(--shadow-overlay);padding:8px;display:flex;flex-direction:column}
.menu-panel a{color:var(--text);text-decoration:none;padding:12px;border-radius:8px}
.menu-panel a:hover{background:var(--surface-raised)}

/* Sections */
.section{padding:80px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:36px}
.section-head{display:flex;flex-direction:column;gap:8px}
.section-head h2,.sample-copy h2,.cta h2{font-size:34px;line-height:1.2;letter-spacing:-.02em}
.section-head p{color:var(--text-muted)}
.lead-in{color:var(--text-muted);max-width:520px}

/* Hero */
.hero{padding:72px 80px 88px;display:grid;grid-template-columns:minmax(0,1fr) 440px;grid-template-areas:"intro card" "video card";column-gap:64px;row-gap:24px;align-items:start}
.hero-intro{grid-area:intro;display:flex;flex-direction:column;gap:24px;min-width:0}
.hero h1{font-size:60px;line-height:1.04;letter-spacing:-.04em}
.hero-lede{font-size:19px;max-width:620px}
.perks{display:flex;gap:8px 20px;font-size:14px;color:var(--text-muted);flex-wrap:wrap;margin:0;padding:0;list-style:none}
.hero-card{grid-area:card}
.hero-video{grid-area:video;min-width:0}

/* Video facade */
.video{position:relative;display:block;width:100%;max-width:720px;aspect-ratio:16/9;border-radius:16px;overflow:hidden;border:1px solid var(--line-strong);background:var(--surface);text-decoration:none;color:var(--text)}
.video img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.75}
.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.play{position:absolute;left:50%;top:50%;width:76px;height:76px;margin:-38px 0 0 -38px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center}
.play path{fill:var(--accent-ink)}
.video:hover .play{background:var(--accent-hover)}
.video-caption{position:absolute;left:24px;right:24px;bottom:20px;font-size:14px;font-weight:600;color:var(--text);text-shadow:0 1px 8px var(--overlay)}

/* Auth card */
.card{background:var(--surface);border:1px solid var(--line-strong);border-radius:18px;padding:28px;display:flex;flex-direction:column;gap:18px;box-shadow:var(--shadow-overlay)}
.tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;padding:4px;background:var(--bg-sunken);border:1px solid var(--line);border-radius:10px}
.tab{font-size:14px;padding:10px;min-height:44px;display:flex;align-items:center;justify-content:center;border-radius:7px;color:var(--text-muted);text-decoration:none}
.tab:hover{color:var(--text)}
.tab[aria-selected=true]{background:var(--surface-raised);color:var(--text);font-weight:600}
.panel{display:flex;flex-direction:column;gap:18px}
.panel[hidden]{display:none}
.card-title{font-size:20px;line-height:1.3}
.card-sub{font-size:14px;color:var(--text-muted)}
.form{display:flex;flex-direction:column;gap:14px}
.field{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--text-muted)}
.input{font:inherit;font-size:16px;color:var(--text);background:var(--bg);border:1px solid var(--line-control);border-radius:10px;padding:10px 12px;min-height:44px;width:100%}
.input:focus{outline:2px solid var(--accent);outline-offset:0;border-color:transparent}
.input[aria-invalid=true]{border-color:var(--danger)}
.hint{font-size:12px;color:var(--text-faint)}
.field-error{font-size:13px;color:var(--danger)}
.field-error:empty,.form-error:empty{display:none}
.form-error{font-size:14px;color:var(--text);background:var(--bg-sunken);border:1px solid var(--line-control);border-left:2px solid var(--warn);border-radius:10px;padding:10px 12px}
.form-row{display:flex;justify-content:flex-end;font-size:13px}
.form-row a{color:var(--text-muted)}
.legal-note{font-size:12px;color:var(--text-faint)}
.signed-in{align-items:flex-start}

/* How it works, features */
.grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:0;padding:0;list-style:none}
.step{background:var(--surface);border:1px solid var(--line-strong);border-radius:14px;padding:24px;display:flex;flex-direction:column;gap:10px}
.step-n{font-family:var(--font-family-mono);color:var(--accent);font-size:14px}
.step h3{font-size:19px}
.step p,.feature p{color:var(--text-muted);font-size:15px}
.feature{border-top:1px solid var(--line-control);padding-top:18px;display:flex;flex-direction:column;gap:6px}
.feature h3{font-size:17px}

/* Sample lead */
.sample{display:grid;grid-template-columns:minmax(0,1fr) 560px;gap:64px;align-items:center}
.sample-copy{display:flex;flex-direction:column;gap:14px}
.lead{background:var(--surface);border:1px solid var(--line-strong);border-radius:16px;padding:24px;display:flex;flex-direction:column;gap:16px}
.lead-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.lead-name{display:block;font-size:20px;font-weight:600;color:var(--text)}
.lead-meta{font-size:14px;color:var(--text-muted)}
.score{font-family:var(--font-family-mono);font-size:22px;color:var(--accent);background:var(--accent-tint);border:1px solid var(--accent-line);padding:4px 12px;border-radius:10px}
.contacts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;font-family:var(--font-family-mono);font-size:13px;margin:0;padding:0;list-style:none;overflow-wrap:anywhere}
.contacts .muted{color:var(--text-muted)}
.evidence{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--line);padding-top:14px;font-size:14px;margin:0;list-style:none;padding-left:0}
.evidence li{display:flex;justify-content:space-between;gap:12px}
.points{font-family:var(--font-family-mono);color:var(--accent)}
.sources{font-size:12px;color:var(--text-faint)}
.pitch{background:var(--accent-tint-weak);border:1px solid var(--accent-line);border-radius:10px;padding:12px 14px;font-size:14px}
.pitch b{color:var(--text)}

/* Pricing */
.packs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:0;padding:0;list-style:none}
.pack{background:var(--surface);border:1px solid var(--line-strong);border-radius:16px;padding:28px;display:flex;flex-direction:column;gap:14px}
.pack-featured{border-color:var(--accent-line)}
.pack-name{font-weight:600;color:var(--text);font-size:18px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bonus{font-size:12px;font-weight:600;color:var(--accent-ink);background:var(--accent);padding:2px 8px;border-radius:6px}
.pack-price{font-family:var(--font-family-mono);font-size:44px;color:var(--text);letter-spacing:-.02em;line-height:1.1}
.pack-credits{font-family:var(--font-family-mono);color:var(--text-muted)}
.pack-blurb{color:var(--text-muted);font-size:15px;flex-grow:1}
.price-notes{font-size:13px;color:var(--text-faint)}
.pricing-cta{display:none}

/* FAQ */
.faq{display:grid;grid-template-columns:360px minmax(0,1fr);gap:64px}
.faq-list{display:flex;flex-direction:column}
.faq-item{border-top:1px solid var(--line);padding:18px 0}
.faq-item:last-child{border-bottom:1px solid var(--line)}
.faq-item summary{font-weight:600;color:var(--text);cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:12px}
.faq-item summary::-webkit-details-marker{display:none}
.faq-item summary::after{content:'+';font-family:var(--font-family-mono);color:var(--text-muted)}
.faq-item[open] summary::after{content:'\\2212'}
.faq-item p{color:var(--text-muted);font-size:15px;margin-top:6px}

/* Final call to action */
.cta{margin:0 80px 80px;padding:56px;border-radius:20px;background:var(--surface);border:1px solid var(--line-strong);display:flex;align-items:center;justify-content:space-between;gap:32px}
.cta-copy{display:flex;flex-direction:column;gap:8px}
.cta-copy p{color:var(--text-muted)}
.cta .btn{padding:14px 24px;white-space:nowrap}

/* Footer */
.site-footer{padding:32px 80px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:24px;font-size:14px;color:var(--text-faint);flex-wrap:wrap}
.footer-nav{display:flex;gap:8px 24px;flex-wrap:wrap;align-items:center}
.footer-nav a{color:var(--text-muted);text-decoration:none}
.footer-nav a:hover{color:var(--text)}

/* Legal pages */
.legal{padding:56px 80px;display:grid;grid-template-columns:240px minmax(0,1fr);gap:64px;line-height:1.65}
.legal-nav{display:flex;flex-direction:column;gap:4px;font-size:15px}
.legal-nav .overline{padding:0 12px 8px}
.legal-nav a{padding:8px 12px;border-radius:8px;color:var(--text-muted);text-decoration:none}
.legal-nav a:hover{color:var(--text)}
.legal-nav a[aria-current=page]{background:var(--surface-raised);color:var(--text)}
.legal-doc{max-width:70ch;display:flex;flex-direction:column;gap:18px;min-width:0}
.legal-head{display:flex;flex-direction:column;gap:8px}
.legal-head h1{font-size:34px;line-height:1.2;letter-spacing:-.02em}
.draft{align-self:flex-start;font-size:12px;font-weight:600;color:var(--warn);border:1px solid var(--warn);border-radius:999px;padding:2px 10px}
.updated{font-size:14px;color:var(--text-muted)}
.prose{display:flex;flex-direction:column;gap:14px;overflow-wrap:anywhere}
.prose h2{font-size:19px;margin-top:10px}
.prose h3{font-size:17px;margin-top:6px}
.prose ul,.prose ol{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:6px}
.prose strong{color:var(--text)}
.prose blockquote{margin:0;padding:10px 14px;border-left:2px solid var(--line-control);color:var(--text-muted)}
.prose code{font-family:var(--font-family-mono);font-size:14px}
.prose hr{border:0;border-top:1px solid var(--line);width:100%}

/* Tablet */
@media (max-width:1000px){
.site-header,.hero,.section,.site-footer,.legal{padding-left:24px;padding-right:24px}
.site-header{gap:20px}
.hero{grid-template-columns:minmax(0,1fr);grid-template-areas:"intro" "card" "video";padding-top:48px;padding-bottom:56px;row-gap:28px}
.hero-card{max-width:560px;width:100%}
.sample,.faq{grid-template-columns:minmax(0,1fr);gap:32px}
.cta{margin:0 24px 64px;flex-direction:column;align-items:flex-start}
.legal{grid-template-columns:minmax(0,1fr);gap:32px}
.legal-nav{flex-direction:row;flex-wrap:wrap}
.legal-nav .overline{width:100%}
}
@media (max-width:820px){
.nav,.header-cta{display:none}
.menu{display:block}
.brand{flex-grow:1}
}
/* Phone */
@media (max-width:640px){
.site-header{height:60px;padding:0 16px;gap:12px}
.brand{font-size:17px}
.hero{padding:32px 16px 24px;row-gap:24px}
.hero-intro{gap:16px}
.hero h1{font-size:36px;line-height:1.08;letter-spacing:-.03em}
.hero-lede{font-size:16px}
.perks{font-size:13px;gap:8px 16px}
.hero-card{margin:0}
.card{padding:20px;border-radius:16px;gap:16px;box-shadow:none}
.card-title{font-size:18px}
.btn-block{min-height:48px;font-size:16px}
.video{border-radius:14px}
.play{width:60px;height:60px;margin:-30px 0 0 -30px}
.video-caption{left:14px;bottom:10px;font-size:13px}
.section{padding:40px 16px;gap:20px}
.section-head h2,.sample-copy h2,.cta h2{font-size:26px}
.grid-3{grid-template-columns:minmax(0,1fr);gap:12px}
.step{padding:18px}
.lead{padding:18px}
.contacts{grid-template-columns:minmax(0,1fr)}
.packs{grid-template-columns:minmax(0,1fr);gap:12px}
.pack{padding:18px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:2px 12px}
.pack-name{font-size:16px}
.pack-price{grid-column:2;grid-row:1/span 2;font-size:28px}
.pack-credits{font-size:13px}
.pack-blurb,.pack .btn{display:none}
.pricing-cta{display:flex}
.faq-item summary{min-height:44px;align-items:center}
.cta{margin:0 16px 40px;padding:28px 20px}
.cta .btn{width:100%}
.site-footer{padding:24px 16px;flex-direction:column-reverse;align-items:flex-start}
.legal{padding:32px 16px}
.legal-head h1{font-size:28px}
}
`;
