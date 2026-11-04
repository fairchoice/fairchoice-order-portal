const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPTIONAL_COLUMNS = new Set(['price_mode', 'created_by_name', 'created_by_role', 'branch_name']);

export const returnStaffId = (user = {}) =>
  [user.staff_id, user.id].find(value => UUID.test(String(value || ''))) || null;

export async function insertReturnHeader(client, payload) {
  if (!UUID.test(String(payload.customer_account_id || ''))) {
    throw new Error('Select a customer account before creating a return.');
  }
  const candidate = { ...payload };
  for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.size; attempt += 1) {
    const { data, error } = await client.from('customer_returns').insert(candidate).select().single();
    if (!error) return data;
    // Retry only a named, optional missing column. Never remove financial scope.
    const column = error.code === 'PGRST204'
      ? String(error.message || '').match(/Could not find the '([^']+)' column/i)?.[1]
      : error.code === '42703'
        ? String(error.message || '').match(/column\s+"([^".]+)"(?:\s+of relation\s+"customer_returns")?\s+does not exist/i)?.[1]
        : null;
    if (!OPTIONAL_COLUMNS.has(column) || !Object.hasOwn(candidate, column)) throw error;
    delete candidate[column];
  }
  throw new Error('Could not save the return with its customer account intact.');
}

export const isActiveReturnCredit = (row = {}) =>
  !row.reversed_at && row.financial_disposition === 'CUSTOMER_CREDIT' &&
  ['confirmed', 'credited'].includes(String(row.status || '').trim().toLowerCase());

export const returnDisplayStatus = (row = {}) => row.reversed_at ? 'Reversed' : row.status || 'Pending';
