CREATE TABLE `live_rooms` (
	`room` text PRIMARY KEY NOT NULL,
	`white` text NOT NULL,
	`black` text,
	`turn` text DEFAULT 'white' NOT NULL,
	`moves` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`updated_at` integer NOT NULL
);
