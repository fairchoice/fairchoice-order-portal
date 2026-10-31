import {getProductPriceForMode} from './pricing.js';
export const productCategory=p=>p.main_category || p.category || '';
export const productSeries=p=>p.series || p.product_series || '';
export function filterCodeProducts(products,{category='All',brand='All',series='All',search=''}={}) {
 const term=search.trim().toLowerCase();
 return products.filter(p=>p.active!==false && (category==='All' || productCategory(p)===category) &&
  (brand==='All' || p.brand===brand) && (series==='All' || productSeries(p)===series) &&
  (!term || [p.productCode,p.product_code,p.product_name,p.name,p.brand,productSeries(p)].some(v=>String(v || '').toLowerCase().includes(term))));
}
export function codeProductPreview(product,codes,mode,pricingSettings={}) {
 const map=product.priceCodePrices || product.price_code_prices || {};
 const calculatedProduct={...product,priceCodePrices:{},price_code_prices:{}};
 const settings={...pricingSettings,price_codes:codes};
 const calculated=codes.map(code=>getProductPriceForMode(calculatedProduct,`code:${code.id}|${mode}`,'',settings));
 const exact=codes.map(code=>{const entry=map[code.id];const price=Number(entry && typeof entry==='object'?entry.price:entry);const scope=entry && typeof entry==='object'?String(entry.price_mode || 'both').toLowerCase():'both';return price>0 && (scope==='both' || scope===mode)?price:null;});
 return {calculated,exact,status:!codes.length?'Select customer code':exact.every(v=>v===null)?'Calculated':exact.every(v=>v!==null)?'Exact override':'Mixed'};
}
