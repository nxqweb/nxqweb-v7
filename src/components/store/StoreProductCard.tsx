import { Store } from "lucide-react";
import { formatMoney, isPurchasable, priceSummary, productImages, productInStock, saleInfo, stockLabel, type StoreProduct, type StoreVariant } from "../../lib/storeCatalog";

// One product in the grid. The photo and the name open the detail view; the button adds straight to the cart when there is just one option,
// and otherwise opens the detail view so the customer can choose.
// viewOnly is a menu: the price and description only, no stock labels and no buttons (nothing to add to a cart).
export function StoreProductCard({ product, currency, onOpen, onAdd, viewOnly = false }: { product: StoreProduct; currency: string; onOpen: (product: StoreProduct) => void; onAdd: (product: StoreProduct, variant: StoreVariant) => void; viewOnly?: boolean }) {
  const photo = productImages(product)[0];
  const price = priceSummary(product);
  const sale = saleInfo(product);
  const inStock = productInStock(product);
  const options = (product.variants || []).filter(isPurchasable);
  const single = options.length === 1 && (product.variants || []).length === 1 ? options[0] : null;
  const lowest = options.map((v) => ({ v, label: stockLabel(v) })).find((x) => x.label.startsWith("Only"));
  const blurb = (product.short_description || product.description || "").trim();

  return (
    <article className="settings-card store-product-card" data-testid="store-product-card">
      <button type="button" className="store-product-open" onClick={() => onOpen(product)} aria-label={`View ${product.name}`}>
        {photo ? <img className="store-product-photo" src={photo} alt="" loading="lazy" /> : <span className="store-product-photo store-product-photo-empty" aria-hidden="true"><Store size={28} /></span>}
        <span className="store-badges">
          {!viewOnly && !inStock ? <span className="store-badge store-badge-soldout">Sold out</span> : null}
          {(viewOnly || inStock) && sale.onSale ? <span className="store-badge store-badge-sale">{sale.percentOff}% off</span> : null}
          {!viewOnly && inStock && lowest ? <span className="store-badge store-badge-low">{lowest.label}</span> : null}
        </span>
      </button>
      <div className="store-product-body">
        <h2><button type="button" className="store-name-button" onClick={() => onOpen(product)}>{product.name}</button></h2>
        <p className="store-price">
          {price.varies ? <span>From <strong>{formatMoney(price.from, currency)}</strong></span> : <strong>{formatMoney(price.from, currency)}</strong>}
          {sale.onSale && product.compare_at_price ? <s className="store-compare-price" aria-label={`was ${formatMoney(Number(product.compare_at_price), currency)}`}>{formatMoney(Number(product.compare_at_price), currency)}</s> : null}
        </p>
        {blurb ? <p className="store-product-blurb">{blurb}</p> : null}
        {viewOnly ? null : !inStock ? <button className="wide-btn" type="button" disabled>Sold out</button>
          : single ? <button className="wide-btn" type="button" onClick={() => onAdd(product, single)}>Add to cart</button>
          : <button className="wide-btn" type="button" onClick={() => onOpen(product)}>Choose options</button>}
      </div>
    </article>
  );
}
