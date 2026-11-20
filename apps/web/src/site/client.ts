/**
 * The public site's only JavaScript (FR-34, FR-35), progressive enhancement over working HTML:
 * - switches the card's tabs in place (links to `/?tab=login#signup` without JS);
 * - submits the card's forms with fetch (`Accept: application/json`) and shows errors inline,
 *   switching to Log in with the email filled when the email is taken;
 * - swaps the video thumbnail for the youtube-nocookie iframe on click;
 * - loads the Google Fonts stylesheet without blocking the first paint;
 * - sends a Google Analytics page view (path only) when a measurement ID is set (FR-9).
 *
 * `siteClient` is serialized with `Function.prototype.toString`, so it must be self-contained:
 * no imports, no outer variables.
 */
export function siteClient(): void {
  type Tab = 'signup' | 'login';
  interface ErrorReply {
    error?: { code?: string; message?: string; fields?: Record<string, string> };
    tab?: Tab;
    email?: string;
    redirect?: string;
  }
  const doc = document;

  const fonts = doc.querySelector<HTMLLinkElement>('link[data-fonts]');
  if (fonts) fonts.media = 'all';

  const card = doc.querySelector<HTMLElement>('[data-card]');

  function selectTab(tab: Tab, focus: boolean): void {
    if (!card) return;
    for (const name of ['signup', 'login'] as const) {
      const link = doc.getElementById(`tab-${name}`);
      const panel = doc.getElementById(`panel-${name}`);
      const on = name === tab;
      link?.setAttribute('aria-selected', String(on));
      link?.setAttribute('tabindex', on ? '0' : '-1');
      if (panel) panel.hidden = !on;
    }
    if (focus) doc.querySelector<HTMLInputElement>(`#panel-${tab} input`)?.focus();
  }

  function clearErrors(form: HTMLFormElement): void {
    for (const el of Array.from(form.querySelectorAll<HTMLElement>('[data-field-error]'))) {
      el.textContent = '';
    }
    for (const input of Array.from(form.querySelectorAll('input'))) {
      input.removeAttribute('aria-invalid');
    }
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-form-error]'))) {
      el.textContent = '';
    }
  }

  function showErrors(reply: ErrorReply, from: Tab): void {
    const tab = reply.tab ?? from;
    if (tab !== from) selectTab(tab, false);
    const form = doc.querySelector<HTMLFormElement>(`form[data-site-form="${tab}"]`);
    if (!form) return;
    if (reply.email) {
      const email = form.querySelector<HTMLInputElement>('input[name="email"]');
      if (email) email.value = reply.email;
    }
    const fields = reply.error?.fields ?? {};
    let first: HTMLInputElement | null = null;
    for (const [name, message] of Object.entries(fields)) {
      const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      const slot = form.querySelector<HTMLElement>(`[data-field-error="${name}"]`);
      if (slot) slot.textContent = message;
      input?.setAttribute('aria-invalid', 'true');
      first ??= input;
    }
    const banner = doc.querySelector<HTMLElement>(`[data-form-error="${tab}"]`);
    if (Object.keys(fields).length === 0 && banner) {
      banner.textContent = reply.error?.message ?? '';
    }
    const focusTarget =
      first ?? form.querySelector<HTMLInputElement>('input[type="password"]') ?? null;
    focusTarget?.focus();
  }

  for (const link of Array.from(doc.querySelectorAll<HTMLAnchorElement>('[data-tab-link]'))) {
    link.addEventListener('click', (event) => {
      if (!card) return;
      event.preventDefault();
      const tab = link.dataset.tabLink === 'login' ? 'login' : 'signup';
      const inCard = card.contains(link);
      selectTab(tab, !inCard);
      if (!inCard) card.scrollIntoView({ block: 'start' });
      if (inCard) link.focus();
    });
  }

  for (const form of Array.from(doc.querySelectorAll<HTMLFormElement>('form[data-site-form]'))) {
    const tab: Tab = form.dataset.siteForm === 'login' ? 'login' : 'signup';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      const label = button?.textContent ?? '';
      if (button) {
        button.disabled = true;
        button.textContent = button.dataset.busyLabel ?? label;
      }
      clearErrors(form);
      const body = new URLSearchParams();
      for (const [key, value] of new FormData(form).entries()) {
        if (typeof value === 'string') body.append(key, value);
      }
      fetch(form.action, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        credentials: 'same-origin',
      })
        .then(async (res) => {
          const reply = (await res.json().catch(() => ({}))) as ErrorReply;
          if (res.ok && reply.redirect) {
            window.location.assign(reply.redirect);
            return;
          }
          showErrors(reply, tab);
        })
        .catch(() => {
          // Offline or blocked: fall back to the plain HTML post.
          form.submit();
        })
        .finally(() => {
          if (button) {
            button.disabled = false;
            button.textContent = label;
          }
        });
    });
  }

  for (const video of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[data-video-id]'))) {
    video.addEventListener('click', (event) => {
      const id = video.dataset.videoId ?? '';
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
      event.preventDefault();
      const frame = doc.createElement('iframe');
      frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      frame.title = video.getAttribute('aria-label') ?? 'Video';
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      const box = doc.createElement('div');
      box.className = 'video';
      box.appendChild(frame);
      video.replaceWith(box);
    });
  }

  const gaId = doc.body.dataset.gaId;
  if (gaId && /^G-[A-Z0-9]{4,12}$/.test(gaId)) {
    const w = window as unknown as { dataLayer: unknown[] };
    w.dataLayer = w.dataLayer ?? [];
    // gtag reads the `arguments` object, not an array.
    const gtag = function (..._args: unknown[]) {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer.push(arguments);
    };
    gtag('js', new Date());
    gtag('config', gaId, {
      page_location: window.location.origin + window.location.pathname,
      page_path: window.location.pathname,
    });
    const tag = doc.createElement('script');
    tag.async = true;
    tag.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
    doc.head.appendChild(tag);
  }
}

/**
 * The script the api serves at `/site/client.js`. `__name` covers the helper some transpilers
 * (tsx with keepNames) insert into serialized functions.
 */
export const siteClientScript = `"use strict";var __name=function(f){return f};(${siteClient.toString()})();\n`;
