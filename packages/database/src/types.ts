/**
 * Knex instance type.
 *
 * Knex's type export is tricky in ESM, so we define this inline.
 * This matches the return type of knex() constructor.
 */
export type Knex = {
  (query: any): any;
  schema: any;
  migrate: any;
  destroy: () => Promise<void>;
  transaction: (callback: any) => Promise<any>;
  [key: string]: any;
};
