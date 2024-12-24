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

export const tokenPackages = pgTable("token_packages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  tokenAmount: integer("token_amount").notNull(),
  price: integer("price").notNull(), // Price in cents (USD)
  features: jsonb("features").notNull(),
  isPopular: boolean("is_popular").default(false),
  stripeProductId: text("stripe_product_id"),
  stripePriceId: text("stripe_price_id"),
  stripeProductId: text("stripe_product_id"),
  stripePriceId: text("stripe_price_id"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  type: text("type", { enum: ["computational", "manual"] }).notNull(),
  reward: integer("reward").notNull(),
  status: text("status", {
    enum: ["open", "in_progress", "pending_verification", "completed", "cancelled"]
  }).notNull().default("open"),
  creatorId: integer("creator_id").notNull().references(() => users.id),
  workerId: integer("worker_id").references(() => users.id),
  proofRequired: text("proof_required").notNull(),
  proofSubmitted: text("proof_submitted"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const tokenTransactions = pgTable("token_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  amount: integer("amount").notNull(),
  type: text("type", {
    enum: ["reward", "purchase", "escrow", "release"]
  }).notNull(),
  packageId: integer("package_id").references(() => tokenPackages.id),
  taskId: integer("task_id").references(() => tasks.id),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  createdTasks: many(tasks, { relationName: "creator" }),
  workedTasks: many(tasks, { relationName: "worker" }),
  transactions: many(tokenTransactions),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  creator: one(users, {
    fields: [tasks.creatorId],
    references: [users.id],
    relationName: "creator",
  }),
  worker: one(users, {
    fields: [tasks.workerId],
    references: [users.id],
    relationName: "worker",
  }),
}));

export const tokenTransactionsRelations = relations(tokenTransactions, ({ one }) => ({
  user: one(users, {
    fields: [tokenTransactions.userId],
    references: [users.id],
  }),
  task: one(tasks, {
    fields: [tokenTransactions.taskId],
    references: [tasks.id],
  }),
  package: one(tokenPackages, {
    fields: [tokenTransactions.packageId],
    references: [tokenPackages.id],
  }),
}));

// Schemas for validation
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export const insertTaskSchema = createInsertSchema(tasks);
export const selectTaskSchema = createSelectSchema(tasks);
export const insertTokenTransactionSchema = createInsertSchema(tokenTransactions);
export const selectTokenTransactionSchema = createSelectSchema(tokenTransactions);
export const insertTokenPackageSchema = createInsertSchema(tokenPackages);
export const selectTokenPackageSchema = createSelectSchema(tokenPackages);

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;
export type TokenTransaction = typeof tokenTransactions.$inferSelect;
export type InsertTokenTransaction = typeof tokenTransactions.$inferInsert;
export type TokenPackage = typeof tokenPackages.$inferSelect;
export type InsertTokenPackage = typeof tokenPackages.$inferInsert;