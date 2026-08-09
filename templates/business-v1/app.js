import { siteConfig } from './site.config.js';

const $ = (id) => document.getElementById(id);
const text = (id, value) => { const node = $(id); if (node) node.textContent = value || ''; };

function safeTel(value = '') {
  return value.replace(/[^0-9+]/g, '');
}

function render() {
  const { business, brand, services = [], trust, about, seo } = siteConfig;

  document.title = seo?.title || `${business.name} | Professional Services`;
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
