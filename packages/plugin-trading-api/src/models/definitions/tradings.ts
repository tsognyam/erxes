import { Document, Schema } from 'mongoose';
import { field, schemaHooksWrapper } from './utils';
export interface ITrading {
  name: string;
}

export interface ITradingDocument extends ITrading, Document {
  _id: string;
  createdAt: Date;
  order?: string;
  relatedIds?: string[];
}
export const tagSchema = schemaHooksWrapper(
  new Schema({
    _id: field({ pkey: true }),
    name: field({ type: String, label: 'name' }),
    createdAt: field({ type: Date, label: 'Created at' }),
    relatedIds: field({
      type: [String],
      optional: true,
      label: 'Children tag ids'
    })
  }),
  'erxes_tradings'
);
