import { pgTable, text, serial, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  tokenBalance: integer("token_balance").notNull().default(0),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const tokens = pgTable("tokens", {
  id: text("id").primaryKey(),
  creator: text("creator").notNull(),
  owner: text("owner").notNull(),
  mintedInBlock: text("minted_in_block").notNull(),
  metadata: jsonb("metadata").$type<{
    createdAt: Date;
    previousTransfers: Array<{
      id: string;
      from: string;
      to: string;
      timestamp: number;
      transactionId: string;
    }>;
    purchaseInfo?: {
      paymentId?: string;
      price?: number;
      purchaseDate: Date;
    };
  }>(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const tokenTransactions = pgTable("token_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  amount: integer("amount").notNull(),
  type: text("type", {
    enum: ["mint", "transfer", "purchase"]
  }).notNull(),
  status: text("status", {
    enum: ["pending", "completed", "failed"]
  }).notNull().default("completed"),
  paymentId: text("payment_id"),
  fromAddress: text("from_address"),
  toAddress: text("to_address"),
  blockHash: text("block_hash"),
  tokenIds: text("token_ids").array(),
  metadata: jsonb("metadata"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  transactions: many(tokenTransactions),
  ownedTokens: many(tokens, { relationName: "ownership" }),
  createdTokens: many(tokens, { relationName: "creation" }),
}));

export const tokensRelations = relations(tokens, ({ one }) => ({
  owner: one(users, {
    fields: [tokens.owner],
    references: [users.username],
    relationName: "ownership",
  }),
  creator: one(users, {
    fields: [tokens.creator],
    references: [users.username],
    relationName: "creation",
  }),
}));

export const tokenTransactionsRelations = relations(tokenTransactions, ({ one }) => ({
  user: one(users, {
    fields: [tokenTransactions.userId],
    references: [users.id],
  }),
}));

// Schemas for validation
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export const insertTokenSchema = createInsertSchema(tokens);
export const selectTokenSchema = createSelectSchema(tokens);
export const insertTokenTransactionSchema = createInsertSchema(tokenTransactions);
export const selectTokenTransactionSchema = createSelectSchema(tokenTransactions);


// Types
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Token = typeof tokens.$inferSelect;
export type InsertToken = typeof tokens.$inferInsert;
export type TokenTransaction = typeof tokenTransactions.$inferSelect;
export type InsertTokenTransaction = typeof tokenTransactions.$inferInsert;