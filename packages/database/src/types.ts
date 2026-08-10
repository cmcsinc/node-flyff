import type { Knex as KnexType } from 'knex';

export type Knex = KnexType<Record<string, unknown>, unknown[]>;
export type TableBuilder = KnexType.CreateTableBuilder;
