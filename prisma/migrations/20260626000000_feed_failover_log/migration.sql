CREATE TABLE "FeedFailoverLog" (
  "id"       SERIAL PRIMARY KEY,
  "fromFeed" TEXT NOT NULL,
  "toFeed"   TEXT NOT NULL,
  "reason"   TEXT,
  "ts"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
