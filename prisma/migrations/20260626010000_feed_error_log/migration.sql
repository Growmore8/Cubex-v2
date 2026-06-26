CREATE TABLE "FeedErrorLog" (
  "id"        SERIAL PRIMARY KEY,
  "category"  TEXT NOT NULL,
  "provider"  TEXT NOT NULL,
  "errorType" TEXT NOT NULL,
  "message"   TEXT NOT NULL,
  "ts"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
