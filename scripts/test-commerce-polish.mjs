// Offline test: the client Commerce pages keep the everyday path short. Advanced product fields and menu pages are tucked away (never removed),
// required fields are marked, and the variant price follows the base price until the client changes it.
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const products = fs.readFileSync("src/pages/ClientCommerceProducts.tsx", "utf8");
const nav = fs.readFileSync("src/components/CommerceNav.tsx", "utf8");
const css = fs.readFileSync("src/styles/plan-forms.css", "utf8");

check("products page uses the optional section component", /import \{ OptionalSection \}/.test(products));
check("name and base price are marked required", /Product name <em className="required-mark">\(required\)/.test(products) && /Base price <em className="required-mark">\(required\)/.test(products));
for (const field of ["variant.sku", "variant.reserved_quantity", "variant.incoming_quantity", "variant.low_stock_threshold", "variant.reorder_point", "variant.inventory_location", "variant.inventory_policy", "draft.seo_title", "draft.attributes.map"]) {
  const at = products.indexOf(field === "draft.attributes.map" ? field : `value={${field}}`);
  const before = products.slice(0, at);
  const lastOpen = before.lastIndexOf("<OptionalSection");
  const lastClose = before.lastIndexOf("</OptionalSection>");
  check(`${field} sits inside an optional section`, at > 0 && lastOpen > lastClose, `open ${lastOpen} close ${lastClose}`);
}
check("price, on hand and variant title stay visible", ["Variant title", "<span>Price</span>", "<span>On hand"].every((t) => { const at = products.indexOf(t); const before = products.slice(0, at); return at > 0 && !(before.lastIndexOf("<OptionalSection") > before.lastIndexOf("</OptionalSection>")); }));
check("on hand explains that 0 means sold out", /0 = sold out/.test(products));
check("optional sections open themselves when the draft already has answers", /defaultOpen=\{draft\.attributes\.length > 0\}/.test(products) && /defaultOpen=\{Boolean\(draft\.seo_title \|\| draft\.seo_description\)\}/.test(products) && /variant\.sku !== ""/.test(products));
check("variant 1 follows the base price until edited", /function changeBasePrice/.test(products) && /Number\(first\.price\) === Number\(current\.base_price\)/.test(products) && /onChange=\{\(event\) => changeBasePrice\(/.test(products));
check("every saved field still reaches the save call (draft spread kept)", /\.\.\.draft,/.test(products) && /variants: draft\.variants\.map/.test(products));

check("menu has a More pages toggle with aria-expanded", /aria-expanded=\{showMore\}/.test(nav) && /More pages/.test(nav) && !/aria-controls/.test(nav));
check("advanced pages are hidden on desktop only until toggled", /\.commerce-nav-more:not\(\.is-shown\) \{ display: none; \}/.test(css));
check("on phones every page shows and the toggle is hidden", /@media \(max-width: 640px\)[\s\S]*\.commerce-nav-more:not\(\.is-shown\) \{ display: inline-flex; \}[\s\S]*\.commerce-nav-toggle \{ display: none; \}/.test(css));
check("an advanced current page opens the extra pages by itself", /const \[showMore, setShowMore\] = useState\(onAdvancedPage\)/.test(nav));

const dash = fs.readFileSync("src/pages/ClientCommerceDashboard.tsx", "utf8");
check("dashboard has one quick-actions row and no repeated menu cards", /data-testid="quick-actions"/.test(dash) && !/owner-detail-grid/.test(dash) && (dash.match(/<h2>Store setup<\/h2>/g) || []).length === 1);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll commerce-polish checks passed (offline).");
process.exit(failures ? 1 : 0);
