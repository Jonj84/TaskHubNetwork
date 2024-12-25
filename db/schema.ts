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

export const tokenProcessingQueue = pgTable("token_processing_queue", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  amount: integer("amount").notNull(),
  paymentId: text("payment_id").notNull(),
  status: text("status", {
    enum: ["pending", "processing", "completed", "failed"]
  }).notNull().default("pending"),
  metadata: jsonb("metadata").$type<{
    sessionId?: string;
    paymentIntent?: string;
    customerEmail?: string;
    purchaseDate?: string;
    price?: number;
    tokenSpecifications?: {
      tier: string;
      generationType: string;
      source: string;
    };
  }>(),
  retryCount: integer("retry_count").notNull().default(0),
  error: text("error"),
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
  }).notNull().default("pending"),
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
  processingQueue: many(tokenProcessingQueue),
}));

export const tokenProcessingQueueRelations = relations(tokenProcessingQueue, ({ one }) => ({
  user: one(users, {
    fields: [tokenProcessingQueue.userId],
    references: [users.id],
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
export const insertTokenTransactionSchema = createInsertSchema(tokenTransactions);
export const selectTokenTransactionSchema = createSelectSchema(tokenTransactions);
export const insertTokenProcessingQueueSchema = createInsertSchema(tokenProcessingQueue);
export const selectTokenProcessingQueueSchema = createSelectSchema(tokenProcessingQueue);

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type TokenTransaction = typeof tokenTransactions.$inferSelect;
export type InsertTokenTransaction = typeof tokenTransactions.$inferInsert;
export type TokenProcessingQueue = typeof tokenProcessingQueue.$inferSelect;
export type InsertTokenProcessingQueue = typeof tokenProcessingQueue.$inferInsert;