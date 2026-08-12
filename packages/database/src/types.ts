import type { Knex as KnexType } from 'knex';

// Loads the `knex/types/tables` augmentation so `db('accounts')` resolves to
// `AccountRow` instead of `any`. Side-effect import: the module has no runtime
// exports, only the `declare module` block.
import './tables';

// ponytail: knex's own default type params rather than an explicit generic map
// -- table row shapes come from the `Tables` augmentation in `./tables`, which
// knex applies to `db('<name>')` automatically. Upgrade path: none needed
// unless a repo starts querying a table absent from that map (which degrades
// that call to `any`).
export type Knex = KnexType;
export type TableBuilder = KnexType.CreateTableBuilder;
