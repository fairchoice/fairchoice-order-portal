// Customer VAT mode is independent from code assignment.
const normalise = (value) => String(value || '').trim().toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
export const customerVatMode = (value = 'VAT') => {
 const mode=normalise(value);
 if(mode.startsWith('code:')) return mode.split('|')[1] === 'inc vat' ? 'inc vat' : 'ex vat';
 return ['server','inc vat','incvat','royalty','owner offer','manager','manager offer'].includes(mode) ? 'inc vat' : 'ex vat';
};
export const priceCodeMatchesMode = (code, mode) => {
 if(!code || code.active === false) return false;
 const applies=code.applies_to_price_mode ?? 'both';
 return applies === 'both' || applies === customerVatMode(mode);
};
export const priceCodeMatchesCustomer = (customer,code) => (!code?.customer_account_id || String(code.customer_account_id)===String(customer?.id)) && priceCodeMatchesMode(code,customer?.default_price_mode || 'VAT');
export const priceModeLabel = (mode) => mode === 'both' ? 'Inc.VAT & Ex.VAT' : customerVatMode(mode)==='inc vat' ? 'Inc.VAT' : 'Ex.VAT';
