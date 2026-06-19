import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const userCreditsTable = pgTable("user_credits", {
  userId: text("user_id").primaryKey(),
  balance: integer("balance").notNull().default(0),
  freeGranted: boolean("free_granted").notNull().default(false),
  freeUsed: integer("free_used").notNull().default(0),
  totalPurchased: integer("total_purchased").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const creditEventsTable = pgTable("credit_events", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  sourceId: text("source_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const stripeCheckoutSessionsTable = pgTable("stripe_checkout_sessions", {
  sessionId: text("session_id").primaryKey(),
  userId: text("user_id").notNull(),
  priceId: text("price_id").notNull(),
  credits: integer("credits").notNull(),
  status: text("status").notNull().default("pending"),
  fulfilledAt: timestamp("fulfilled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type UserCredits = typeof userCreditsTable.$inferSelect;
export type CreditEvent = typeof creditEventsTable.$inferSelect;
export type StripeCheckoutSession = typeof stripeCheckoutSessionsTable.$inferSelect;
