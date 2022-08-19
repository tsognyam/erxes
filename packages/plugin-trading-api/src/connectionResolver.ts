import * as mongoose from 'mongoose';
import {
  ITradingDocument,
  ITradingModel,
  loadTradingClass
} from './models/definitions/tradings';
import { IContext as IMainContext } from '@erxes/api-utils/src';
import { createGenerateModels } from '@erxes/api-utils/src/core';
export interface IModels {
  Tradings: ITradingModel;
}
export interface IContext extends IMainContext {
  subdomain: string;
  models: IModels;
}
export let models: IModels | null = null;
export const loadClasses = (db: mongoose.Connection): IModels => {
  models = {} as IModels;

  models.Tradings = db.model<ITradingDocument, ITradingModel>(
    'tradings',
    loadTradingClass(models)
  );

  return models;
};
export const generateModels = createGenerateModels<IModels>(
  models,
  loadClasses
);
