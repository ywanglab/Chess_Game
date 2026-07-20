// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const players = sqliteTable("players", {
  username: text("username").primaryKey(),
  rating: integer("rating").notNull().default(1200),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  games: integer("games").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  room: text("room").notNull(),
  white: text("white").notNull(),
  black: text("black").notNull(),
  result: text("result").notNull(),
  moves: text("moves").notNull(),
  finishedAt: integer("finished_at").notNull(),
});
