import { items } from '@wix/data';
import { COLLECTION_ID } from './configuration';
import type { DepositRule } from '../types';

export async function listDepositRules(query = items.query): Promise<DepositRule[]> {
  const result = await query(COLLECTION_ID).eq('_id', 'configuration').find({ consistentRead: true });
  return (result.items[0]?.payload?.entries as DepositRule[] | undefined) ?? [];
}
