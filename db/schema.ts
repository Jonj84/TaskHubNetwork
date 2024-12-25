import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
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
  id: text("id").primaryKey(), // UUID for the token
  creator: text("creator").notNull(), // Username of token creator
  owner: text("owner").notNull(), // Current owner's username
  status: text("status", {
    enum: ["active", "escrow", "burned"]
  }).notNull().default("active"),
  escrowTaskId: integer("escrow_task_id"), // If token is in escrow
  mintedInBlock: text("minted_in_block").notNull(),
  metadata: jsonb("metadata").$type<{
    createdAt: Date;
    previousTransfers: Array<{
      from: string;
      to: string;
      timestamp: number;
      transactionId: string;
      type: 'transfer' | 'escrow' | 'release' | 'burn';
      taskId?: number;
    }>;
    purchaseInfo?: {
      paymentId?: string;
      price: number;
      purchaseDate: Date;
      reason?: 'purchase' | 'bonus';
    };
  }>(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
  transactionId: integer("transaction_id"),
});

export const tokenTransactions = pgTable("token_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type", {
    enum: ["mint", "transfer", "escrow", "release", "burn"]
  }).notNull(),
  status: text("status", {
    enum: ["pending", "completed", "failed"]
  }).notNull().default("completed"),
  paymentId: text("payment_id"),
  fromAddress: text("from_address"),
  toAddress: text("to_address"),
  tokenIds: text("token_ids").array(), // Array of token IDs involved in this transaction
  metadata: jsonb("metadata").$type<{
    baseTokens: number;
    bonusTokens: number;
    pricePerToken?: number;
    totalPrice?: number;
    timestamp: string;
  }>(),
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
  transaction: one(tokenTransactions, {
    fields: [tokens.transactionId],
    references: [tokenTransactions.id],
  }),
}));

export const tokenTransactionsRelations = relations(tokenTransactions, ({ one, many }) => ({
  user: one(users, {
    fields: [tokenTransactions.userId],
    references: [users.id],
  }),
  tokens: many(tokens),
}));

// Types for use in application code
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Token = typeof tokens.$inferSelect;
export type InsertToken = typeof tokens.$inferInsert;
export type TokenTransaction = typeof tokenTransactions.$inferSelect;
export type InsertTokenTransaction = typeof tokenTransactions.$inferInsert;

// Schemas for validation
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export const insertTokenSchema = createInsertSchema(tokens);
export const selectTokenSchema = createSelectSchema(tokens);
export const insertTokenTransactionSchema = createInsertSchema(tokenTransactions);
export const selectTokenTransactionSchema = createSelectSchema(tokenTransactions);