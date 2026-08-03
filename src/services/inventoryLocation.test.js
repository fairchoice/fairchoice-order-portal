import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInventoryCountry,resolveOrderInventoryCountry,getCountryLocationStock,applyLocationStockToProducts } from "./locationStock.js";
test("normalizes England and Wales variants",()=>{for(const v of ["England","ENG","GB-ENG"])assert.equal(normalizeInventoryCountry(v),"England");for(const v of ["Wales","WLS","GB-WLS"])assert.equal(normalizeInventoryCountry(v),"Wales");});
test("order country precedence is delivery branch customer order",()=>{assert.equal(resolveOrderInventoryCountry({delivery_country:"Wales",branch_country:"England",customer_country:"England",country:"England"}),"Wales");});
test("missing country stock does not fall back",()=>{assert.equal(getCountryLocationStock({locationStocks:{a:{country:"England",active:true,qty:10}}},"Wales"),null);});

test("legacy global stock is used only when no location rows exist",()=>{
  const stock=getCountryLocationStock({id:"p1",stock:7,availableInWales:true,locationStocks:{}},"Wales");
  assert.equal(stock.qty,7);
  assert.equal(stock.legacyFallback,true);
});
test("legacy stock never fills a missing second country",()=>{
  const product={stock:7,availableInWales:true,locationStocks:{eng:{country:"England",active:true,qty:7}}};
  assert.equal(getCountryLocationStock(product,"Wales"),null);
});
test("product mapping marks legacy inventory for database bootstrap",()=>{
  const [product]=applyLocationStockToProducts([{id:"p1",stock:4,availableInWales:true,locationStocks:{}}],"Wales");
  assert.equal(product.stock,4);
  assert.equal(product.inventoryLocationMissing,false);
  assert.equal(product.inventoryLocationBootstrapRequired,true);
});
