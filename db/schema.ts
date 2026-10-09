import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const wechatAccounts = sqliteTable(
  "wechat_accounts",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").notNull(),
    openId: text("open_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("wechat_identity").on(t.appId, t.openId)],
);
export const accountLinkCodes = sqliteTable("account_link_codes", {
  hash: text("hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: text("expires_at").notNull(),
  claimedBy: text("claimed_by"),
});
export const gatewayNonces = sqliteTable("gateway_nonces", {
  nonce: text("nonce").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
});
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
});
export const trips = sqliteTable("trips", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  destination: text("destination").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  currency: text("currency").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  archived: integer("archived").notNull().default(0),
  currencyLocked: integer("currency_locked").notNull().default(0),
  version: integer("version").notNull().default(0),
  lastMutation: text("last_mutation").notNull().default(""),
  createdAt: text("created_at").notNull(),
});
export const members = sqliteTable(
  "members",
  {
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    joinedAt: text("joined_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.userId] })],
);
export const invites = sqliteTable("invites", {
  tripId: text("trip_id")
    .primaryKey()
    .references(() => trips.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
});
export const expenses = sqliteTable("expenses", {
  id: text("id").primaryKey(),
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id),
  title: text("title").notNull(),
  amount: integer("amount").notNull(),
  date: text("date").notNull(),
  category: text("category").notNull(),
  payerId: text("payer_id")
    .notNull()
    .references(() => users.id),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at").notNull(),
});
export const shares = sqliteTable(
  "shares",
  {
    expenseId: text("expense_id")
      .notNull()
      .references(() => expenses.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    amount: integer("amount").notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.userId] })],
);
export const repayments = sqliteTable("repayments", {
  id: text("id").primaryKey(),
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id),
  fromId: text("from_id")
    .notNull()
    .references(() => users.id),
  toId: text("to_id")
    .notNull()
    .references(() => users.id),
  amount: integer("amount").notNull(),
  date: text("date").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at").notNull(),
});
export const operations = sqliteTable(
  "operations",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id),
    requestId: text("request_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    result: text("result").notNull(),
  },
  (t) => [uniqueIndex("operation_request").on(t.tripId, t.requestId)],
);
