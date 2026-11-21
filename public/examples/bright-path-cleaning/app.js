import { siteConfig } from './site.config.js';

const $ = (id) => document.getElementById(id);
const text = (id, value) => { const node = $(id); if (node) node.textContent = value || ''; };

function safeTel(value = '') {
  return value.replace(/[^0-9+]/g, '');
}

// ---- Options the client chose in their website brief (see docs/CLIENT_FLOW_V2_PLAN.md) ----
const MODE_KEY = 'nxq-site-mode';
const GALLERY_SRC = /^\.\/gallery\/[a-z0-9][a-z0-9._-]{0,80}\.(?:jpe?g|png|webp)$/i;

function readStoredMode() {
  try { const value = window.localStorage.getItem(MODE_KEY); return value === 'light' || value === 'dark' ? value : ''; } catch { return ''; }
}
function storeMode(value) {
  try { window.localStorage.setItem(MODE_KEY, value); } catch { /* private window: the choice just is not remembered */ }
}
function prefersLight() {
  try { return window.matchMedia('(prefers-color-scheme: light)').matches; } catch { return false; }
}

// Dark (default), Light, or Both: with Both a button lets the visitor switch, and the choice is remembered on their device.
function applyColorMode(design) {
  const configured = ['dark', 'light', 'both'].includes(design?.colorMode) ? design.colorMode : 'dark';
  const toggle = $('mode-toggle');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const set = (mode) => {
    document.documentElement.dataset.mode = mode;
    if (themeColor) themeColor.setAttribute('content', mode === 'light' ? '#f5f6fa' : '#070b12');
    if (toggle) {
      toggle.textContent = mode === 'light' ? 'Dark mode' : 'Light mode';
      toggle.setAttribute('aria-label', mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    }
  };
  if (configured !== 'both') {
    set(configured);
    if (toggle) toggle.hidden = true;
    return;
  }
  set(readStoredMode() || (prefersLight() ? 'light' : 'dark'));
  if (toggle) {
    toggle.hidden = false;
    toggle.addEventListener('click', () => {
      const next = document.documentElement.dataset.mode === 'light' ? 'dark' : 'light';
      set(next);
      storeMode(next);
    });
  }
}

function addMeta(attribute, name, content) {
  const node = document.createElement('meta');
  node.setAttribute(attribute, name);
  node.setAttribute('content', content);
  document.head.append(node);
}

// SEO on (default): Open Graph tags and LocalBusiness structured data built only from facts the client gave us.
// SEO off: the page asks search engines not to list it, and adds nothing extra.
function applySeo(business, seo) {
  if (seo?.enabled === false) {
    addMeta('name', 'robots', 'noindex, nofollow');
    return;
  }
  const title = seo?.title || business.name;
  const description = seo?.description || '';
  addMeta('property', 'og:type', 'website');
  addMeta('property', 'og:title', title);
  if (description) addMeta('property', 'og:description', description);
  const data = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: business.name };
  if (description) data.description = description;
  if (business.phone) data.telephone = business.phone;
  if (business.email) data.email = business.email;
  if (business.serviceArea) data.areaServed = business.serviceArea;
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(data);
  document.head.append(script);
}

// "Our work" photos: only files under ./gallery/ with an image extension are shown, and every caption is set as plain text.
function renderGallery(gallery) {
  const section = $('work');
  const grid = $('work-grid');
  const items = (Array.isArray(gallery?.items) ? gallery.items : [])
    .filter((item) => item && typeof item.src === 'string' && GALLERY_SRC.test(item.src))
    .slice(0, 12);
  if (!section || !grid || items.length === 0) return;
  const label = String(gallery?.label || 'Our work').slice(0, 40);
  const eyebrow = section.querySelector('.eyebrow');
  if (eyebrow) eyebrow.textContent = label;
  const navLink = $('nav-work');
  if (navLink) { navLink.textContent = label; navLink.hidden = false; }
  text('work-heading', String(gallery?.title || 'Recent work').slice(0, 80));
  text('work-intro', String(gallery?.intro || '').slice(0, 240));
  const dialog = $('work-dialog');
  grid.innerHTML = '';
  items.forEach((item) => {
    const alt = String(item.alt || '').slice(0, 160);
    const caption = String(item.caption || '').slice(0, 160);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'work-item';
    const image = document.createElement('img');
    image.src = item.src;
    image.alt = alt;
    image.loading = 'lazy';
    image.decoding = 'async';
    button.append(image);
    if (caption) {
      const note = document.createElement('span');
      note.textContent = caption;
      button.append(note);
    }
    button.addEventListener('click', () => {
      const large = $('work-dialog-img');
      if (!dialog || !large || typeof dialog.showModal !== 'function') return;
      large.src = item.src;
      large.alt = alt;
      text('work-dialog-caption', caption);
      dialog.showModal();
    });
    grid.append(button);
  });
  section.hidden = false;
}

function render() {
  const { business, brand, services = [], trust, about, seo, design, site, gallery } = siteConfig;
  applyColorMode(design);
  if (site?.smoothScroll === false) document.documentElement.dataset.smooth = 'off';
  const allowedThemes = new Set(['midnight_blue', 'charcoal_gold', 'forest_emerald', 'royal_violet']);
  const themeKey = allowedThemes.has(design?.themeKey) ? design.themeKey : 'midnight_blue';
  document.documentElement.dataset.theme = themeKey;

  document.title = seo?.title || `${business.name} | Local Services`;
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', seo?.description || brand.subheadline || '');

  text('brand-name', business.name);
  text('footer-name', business.name);
  text('contact-business-name', business.name);
  text('business-type', business.type);
  text('service-area', business.serviceArea || 'Serving the local area');
  text('hero-eyebrow', brand.eyebrow);
  text('hero-headline', brand.headline);
  text('hero-subheadline', brand.subheadline);
  text('primary-cta', brand.primaryCta || 'Request a Quote');
  text('header-cta', brand.primaryCta || 'Request a Quote');
  text('secondary-cta', brand.secondaryCta || 'View Services');
  text('about-heading', about?.heading);
  text('about-body', about?.body);

  const serviceGrid = $('service-grid');
  if (serviceGrid) {
    serviceGrid.innerHTML = '';
    services.slice(0, 8).forEach((service, index) => {
      const article = document.createElement('article');
      article.className = 'service-card';
      const number = document.createElement('span');
      number.textContent = String(index + 1).padStart(2, '0');
      const heading = document.createElement('h3');
      heading.textContent = service.title || 'Service';
      const body = document.createElement('p');
      body.textContent = service.description || '';
      article.append(number, heading, body);
      serviceGrid.append(article);
    });
  }

  const trustPoints = $('trust-points');
  if (trustPoints) {
    trustPoints.innerHTML = '';
    (trust?.points || []).slice(0, 6).forEach((point) => {
      const item = document.createElement('span');
      item.textContent = point;
      trustPoints.append(item);
    });
  }

  renderGallery(gallery);
  applySeo(business, seo);

  const phone = $('phone-link');
  if (phone) {
    if (business.phone) {
      phone.href = `tel:${safeTel(business.phone)}`;
      phone.textContent = `Call ${business.phone}`;
    } else {
      phone.hidden = true;
    }
  }

  const email = $('email-link');
  if (email) {
    if (business.email) {
      email.href = `mailto:${business.email}`;
      email.textContent = `Email ${business.email}`;
    } else {
      email.hidden = true;
    }
  }
}

render();
