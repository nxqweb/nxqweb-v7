import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { formatMoney, isPurchasable, priceSummary, productImages, saleInfo, stockLabel, type StoreProduct, type StoreVariant } from "../../lib/storeCatalog";

// The product detail view: all photos, the full description, the options and Add to cart. A native <dialog> gives a proper focus trap,
// the Escape key and a backdrop for free, and it works with keyboard and screen readers.
// viewOnly is a menu: sizes and prices are listed, with no choosing, no stock notes and no Add to cart.
export function StoreProductDialog({ product, currency, onClose, onAdd, viewOnly = false }: { product: StoreProduct; currency: string; onClose: () => void; onAdd: (product: StoreProduct, variant: StoreVariant) => void; viewOnly?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const images = useMemo(() => productImages(product), [product]);
  const variants = product.variants || [];
  const [photo, setPhoto] = useState(0);
  const [variantId, setVariantId] = useState(() => (variants.find(isPurchasable) ?? variants[0])?.id ?? "");
  const selected = variants.find((v) => v.id === variantId) ?? variants[0];
  const sale = saleInfo(product);
  const price = priceSummary(product);
  const showOptions = variants.length > 1 || (variants.length === 1 && variants[0].title.trim().toLowerCase() !== "default");

  // Open as a modal when it appears. No cleanup that closes it: removing the dialog from the page already ends the modal, and closing it from
  // a cleanup would fire the close handler (and un-select the product) when React re-runs effects in development.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const go = (delta: number) => { if (images.length > 1) setPhoto((current) => (current + delta + images.length) % images.length); };

  return (
    <dialog
      ref={ref}
      className="store-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => { if (event.target === ref.current) ref.current?.close(); }}
      onKeyDown={(event) => { if (event.key === "ArrowRight") go(1); if (event.key === "ArrowLeft") go(-1); }}
    >
      <div className="store-dialog-card">
        <button type="button" className="store-dialog-close icon-btn" onClick={() => ref.current?.close()} aria-label="Close"><X size={18} /></button>
        <div className="store-gallery">
          {images.length > 0
            ? <img className="store-gallery-main" src={images[photo]} alt={`${product.name}, photo ${photo + 1} of ${images.length}`} />
            : <div className="store-gallery-main store-gallery-empty" aria-hidden="true" />}
          {images.length > 1 ? <>
            <button type="button" className="store-gallery-nav store-gallery-prev icon-btn" onClick={() => go(-1)} aria-label="Previous photo"><ChevronLeft size={20} /></button>
            <button type="button" className="store-gallery-nav store-gallery-next icon-btn" onClick={() => go(1)} aria-label="Next photo"><ChevronRight size={20} /></button>
            <div className="store-thumbs" role="group" aria-label="Product photos">
              {images.map((src, index) => (
                <button type="button" key={src} className={`store-thumb${index === photo ? " store-thumb-on" : ""}`} onClick={() => setPhoto(index)} aria-label={`Show photo ${index + 1} of ${images.length}`} aria-current={index === photo ? "true" : undefined}>
                  <img src={src} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </> : null}
        </div>
        <div className="store-dialog-info">
          <h2 id={titleId}>{product.name}</h2>
          <p className="store-price store-price-large">
            {price.varies ? <span>From <strong>{formatMoney(price.from, currency)}</strong></span> : <strong>{formatMoney(selected ? Number(selected.price) : price.from, currency)}</strong>}
            {sale.onSale && product.compare_at_price ? <> <s className="store-compare-price">{formatMoney(Number(product.compare_at_price), currency)}</s> <span className="store-badge store-badge-sale">{sale.percentOff}% off</span></> : null}
          </p>
          {(product.description || product.short_description) ? <p className="store-description">{product.description || product.short_description}</p> : null}
          {viewOnly && showOptions ? (
            <ul className="menu-options" aria-label="Sizes and prices">
              {variants.map((variant) => <li key={variant.id}><span>{variant.title}</span><strong>{formatMoney(Number(variant.price), currency)}</strong></li>)}
            </ul>
          ) : null}
          {!viewOnly && showOptions ? (
            <fieldset className="store-options">
              <legend>Choose an option</legend>
              {variants.map((variant) => {
                const sold = !isPurchasable(variant);
                const note = stockLabel(variant);
                return (
                  <label key={variant.id} className={`store-option${variant.id === variantId ? " store-option-on" : ""}${sold ? " store-option-off" : ""}`}>
                    <input type="radio" name={`option-${titleId}`} value={variant.id} checked={variant.id === variantId} disabled={sold} onChange={() => setVariantId(variant.id)} />
                    <span className="store-option-name">{variant.title}</span>
                    <span className="store-option-price">{formatMoney(Number(variant.price), currency)}</span>
                    {note ? <span className="store-option-note">{note}</span> : null}
                  </label>
                );
              })}
            </fieldset>
          ) : null}
          {viewOnly ? null : selected && !isPurchasable(selected) ? <p className="store-stock-note">{stockLabel(selected)}</p> : selected && stockLabel(selected) ? <p className="store-stock-note">{stockLabel(selected)}</p> : null}
          {viewOnly ? <button className="wide-btn" type="button" onClick={() => ref.current?.close()}>Close</button> : <button className="wide-btn" type="button" disabled={!selected || !isPurchasable(selected)} onClick={() => { if (selected) { onAdd(product, selected); ref.current?.close(); } }}>
            {!selected || !isPurchasable(selected) ? "Sold out" : "Add to cart"}
          </button>}
        </div>
      </div>
    </dialog>
  );
}
