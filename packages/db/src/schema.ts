import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  customType,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const userRole = pgEnum('user_role', ['buyer', 'creator', 'admin']);
export const category = pgEnum('category', [
  'userscript',
  'wallet_list',
  'filter',
  'setup',
  'strategy',
  'alerts',
]);
export const licenseKind = pgEnum('license_kind', ['single', 'multi3', 'subscription']);
export const versionStatus = pgEnum('version_status', [
  'uploading',
  'scanning',
  'needs_creator',
  'in_review',
  'live',
  'rejected',
  'superseded',
  'delisted',
]);
export const orderStatus = pgEnum('order_status', [
  'pending',
  'paid',
  'released',
  'refunded',
  'disputed',
  'expired',
]);
export const tier = pgEnum('tier', ['none', 'scout', 'trencher', 'og']);
export const bondStatus = pgEnum('bond_status', [
  'pending',
  'active',
  'unlocking',
  'released',
  'slashed',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  wallet: text('wallet').notNull(),
  roles: userRole('roles').array().notNull(),
  handle: text('handle'),
  xHandle: text('x_handle'),
  bannedAt: timestamp('banned_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const config = pgTable('config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

export const listings = pgTable('listings', {
  id: uuid('id').primaryKey().defaultRandom(),
  creatorId: uuid('creator_id').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  description: text('description').notNull(),
  category: category('category').notNull(),
  terminals: text('terminals').array().notNull(),
  price: bigint('price', { mode: 'bigint' }).notNull(),
  search: tsvector('search').generatedAlwaysAs(
    sql`to_tsvector('english', title || ' ' || summary || ' ' || description)`,
  ),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  buyerId: uuid('buyer_id').notNull(),
  listingId: uuid('listing_id').notNull(),
  status: orderStatus('status').notNull(),
  total: bigint('total', { mode: 'bigint' }).notNull(),
  memo: text('memo').notNull(),
});

export const ledger = pgTable('ledger', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  account: text('account').notNull(),
  delta: bigint('delta', { mode: 'bigint' }).notNull(),
  refType: text('ref_type').notNull(),
  refId: uuid('ref_id').notNull(),
});

export const bonds = pgTable('bonds', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  amount: bigint('amount', { mode: 'bigint' }).notNull(),
  status: bondStatus('status').notNull(),
});

export const tokenBalances = pgTable('token_balances', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  wallet: text('wallet').notNull(),
  amount: numeric('amount', { precision: 40, scale: 0 }).notNull(),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  source: text('source').notNull(),
});
