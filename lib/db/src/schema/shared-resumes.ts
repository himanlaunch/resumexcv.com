import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const sharedResumesTable = pgTable("shared_resumes", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  resume: jsonb("resume").notNull(),
  jobTitle: text("job_title").notNull(),
  jobCompany: text("job_company").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export type SharedResume = typeof sharedResumesTable.$inferSelect;
