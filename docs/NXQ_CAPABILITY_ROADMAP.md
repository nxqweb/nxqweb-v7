# NXQ Web Capability Roadmap

## Purpose

NXQ Web must not let AI promise every feature automatically.

The AI must classify what a client is asking for, check what NXQ can actually support, and route risky or advanced features to owner review before anything is promised.

Core rule:

NXQ AI does not promise features.
NXQ AI classifies features.
NXQ AI creates safe build plans.
Owner approves anything advanced, expensive, risky, or outside launch scope.

---

## Capability levels

### Level 1 - Standard websites

Launch-ready standard website features.

Examples:
- Home page
- About page
- Services page
- Contact form
- Gallery
- Testimonials
- FAQ
- Basic SEO
- Mobile responsive design
- Client portal
- File uploads
- Owner/client messaging
- Project stage tracking

AI can include these in normal build plans when they fit the package.

---

### Level 2 - Business function websites

More powerful business features that are realistic for launch, but should usually require owner review.

Examples:
- Online booking
- Quote request forms
- Job application forms
- Lead capture
- Email notifications
- Basic product catalog
- Basic ecommerce/order request flow
- Manual payment instructions
- Admin-managed product list
- Simple dashboards
- Blog/news posts
- Service area pages

For launch, clothing brands are in scope as:
- product catalog
- sizes/colors
- order request flow
- checkout later when payment providers are fully enabled

AI can plan these, but owner approval is required before confirming scope.

---

### Level 3 - Advanced interactive builders

Custom interactive systems.

Examples:
- Car customizer
- Outfit builder
- Room designer
- Product configurator
- Custom quote calculator
- Upload image preview tool
- Visual preview system
- Inventory-connected builder

Launch-realistic dealership version:
- customer picks vehicle type/model
- customer picks color/wheels/tint/package
- customer adds notes
- customer uploads inspiration photo
- customer submits custom build request
- dealer receives lead/build summary

Advanced dealership version:
- image changes with selected color/wheels
- price estimate changes
- saved customer builds
- real inventory options

Enterprise version:
- true 3D car rendering
- real manufacturer models
- live inventory sync
- parts compatibility
- financing/payment integrations

AI can draft a plan for Level 3, but must require owner review and usually custom quote.

---

### Level 4 - Enterprise / restricted / not launch-ready

Features that must not be promised automatically.

Examples:
- real-time dealership inventory syncing
- financing applications
- full legal contracts
- insurance quote systems
- medical portals
- banking/loan workflows
- government records
- background checks
- live product scraping from third-party sites
- real manufacturer database access
- anything requiring paid APIs/licenses NXQ does not have
- anything involving sensitive personal data

AI must say this requires owner review and cannot be confirmed automatically.

---

## Capability decision labels

### approved_standard

AI can include this in the build plan.

Examples:
- contact form
- about page
- service page
- gallery

### approved_limited

AI can plan a simple version, but must explain limits.

Examples:
- product catalog
- booking form
- simple car customization request form
- quote calculator

### owner_review_required

AI must create an owner approval request before confirming it.

Examples:
- checkout
- inventory sync
- customer accounts
- dashboards
- configurators

### custom_quote_required

AI must tell the owner this is outside the standard package.

Examples:
- dealership customizer
- advanced ecommerce
- AI-generated previews
- 3D visualization
- custom app workflows

### not_supported_yet

AI must not promise this.

Examples:
- full 3D real-time car configurator with live manufacturer data
- legal/financial automation
- restricted medical/legal/banking workflows
- features needing licenses or paid APIs NXQ does not currently have

---

## Launch support target

By launch, NXQ Web should support:

- premium business websites
- service business websites
- local SEO websites
- portfolio/gallery websites
- lead generation websites
- client portals
- file upload portals
- owner/client messaging
- setup forms
- project build plans
- manual subscription tracking
- basic product catalogs
- basic ecommerce/order-request websites
- simple booking/contact/quote request flows
- simple custom forms
- simple preset-option configurators

Do not advertise full complex app systems as standard yet.

Advanced features should be framed as:

Custom NXQ advanced build — owner reviewed.

---

## Example: dealership client

Client asks:
"I own a dealership. I want customers to customize cars on my website."

Safe AI classification:
- category: configurator
- level: 3
- launch-safe version: preset vehicle build request form
- advanced version: visual/3D builder
- decision: owner_review_required + custom_quote_required

Safe AI recommendation:
Do not promise a full visual or 3D configurator automatically. Offer a limited preset-option vehicle build request system, then ask owner whether to custom quote the advanced version.

---

## Example: clothing brand client

Client asks:
"I want to sell clothes on my website."

Safe AI classification:
- category: ecommerce
- level: 2
- launch-safe version: product catalog + order request flow
- advanced version: full checkout, inventory, customer accounts
- decision: owner_review_required

Safe AI recommendation:
NXQ can support a product catalog and order request system for launch. Full checkout/payment processing requires payment provider setup and owner approval.
