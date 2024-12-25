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

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  type: text("type", { enum: ["manual", "computational"] }).notNull(),
  reward: integer("reward").notNull(),
  status: text("status", {
    enum: ["open", "in_progress", "pending_verification", "completed", "cancelled"]
  }).notNull().default("open"),
  creatorId: integer("creator_id").notNull(),
  workerId: integer("worker_id"),
  proofType: text("proof_type", {
    enum: ["confirmation_approval", "image_upload", "code_submission", "text_submission", "computational_result"]
  }).notNull().default("confirmation_approval"),
  proofRequired: text("proof_required").notNull(),
  proofSubmitted: text("proof_submitted"),
  escrowTransactionId: text("escrow_transaction_id"),
  workUnitsTotal: integer("work_units_total"),
  workUnitsPerToken: integer("work_units_per_token"),
  workUnitResults: jsonb("work_unit_results").$type<{
    units: Array<{
      id: number;
      tokenId: string;
      workerId: number;
      status: 'pending' | 'in_progress' | 'completed' | 'verified';
      input: any;
      result?: any;
      startedAt?: string;
      completedAt?: string;
      verifiedAt?: string;
    }>;
    progress: {
      total: number;
      completed: number;
      verified: number;
    };
  }>(),
  computationalMetadata: jsonb("computational_metadata").$type<{
    framework?: 'tensorflow' | 'pytorch' | 'custom';
    inputFormat: string;
    outputFormat: string;
    estimatedTimePerUnit: number;
    resourceRequirements?: {
      minMemory: number;
      minCpu: number;
      gpuRequired: boolean;
    };
    validationScript?: string;
    distributionStrategy: 'sequential' | 'random' | 'priority';
  }>(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const tokens = pgTable("tokens", {
  id: text("id").primaryKey(),
  creator: text("creator").notNull(),
  owner: text("owner").notNull(),
  status: text("status", {
    enum: ["active", "escrow", "burned"]
  }).notNull().default("active"),
  escrowTaskId: integer("escrow_task_id"),
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
    computationalWorkUnits?: Array<{
      taskId: number;
      unitId: number;
      status: 'pending' | 'in_progress' | 'completed' | 'verified';
      assignedAt: string;
      completedAt?: string;
    }>;
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
  tokenIds: text("token_ids").array(),
  metadata: jsonb("metadata").$type<{
    baseTokens?: number;
    bonusTokens?: number;
    pricePerToken?: number;
    totalPrice?: number;
    timestamp?: string;
    escrowTransactionId?: string;
    releaseTimestamp?: string;
  }>(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  transactions: many(tokenTransactions),
  ownedTokens: many(tokens, { relationName: "ownership" }),
  createdTokens: many(tokens, { relationName: "creation" }),
  createdTasks: many(tasks, { relationName: "taskCreation" }),
  workedTasks: many(tasks, { relationName: "taskWork" }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  creator: one(users, {
    fields: [tasks.creatorId],
    references: [users.id],
    relationName: "taskCreation",
  }),
  worker: one(users, {
    fields: [tasks.workerId],
    references: [users.id],
    relationName: "taskWork",
  }),
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

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;
export type Token = typeof tokens.$inferSelect;
export type InsertToken = typeof tokens.$inferInsert;
export type TokenTransaction = typeof tokenTransactions.$inferSelect;
export type InsertTokenTransaction = typeof tokenTransactions.$inferInsert;

export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export const insertTaskSchema = createInsertSchema(tasks);
export const selectTaskSchema = createSelectSchema(tasks);
export const insertTokenSchema = createInsertSchema(tokens);
export const selectTokenSchema = createSelectSchema(tokens);
export const insertTokenTransactionSchema = createInsertSchema(tokenTransactions);
export const selectTokenTransactionSchema = createSelectSchema(tokenTransactions);