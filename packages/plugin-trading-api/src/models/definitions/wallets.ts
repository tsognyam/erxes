import { field, schemaHooksWrapper } from './utils';
import { Document, Schema } from 'mongoose';

export interface IWallet {
  createdBy: string;
  createdAt: Date;
  date: Date;
}
export interface IWalletDocument extends IWallet, Document {
  _id: string;
}
export const walletSchema = schemaHooksWrapper(
  new Schema({
    _id: field({ pkey: true }),
    createdBy: field({ type: String, label: 'Created By' }),
    createdAt: field({
      type: Date,
      default: new Date(),
      label: 'Created at'
    }),
    date: field({ type: Date, label: 'Wallet Created Date' })
  }),
  'erxes_tradingWallet'
);
