-- Shared brute-force protection.
--
-- The rate limiter and the lockout were the same in-memory Map, which means on
-- Vercel each cold lambda started from zero and a rotating `X-Forwarded-For`
-- bought a fresh bucket per request — so five "failed attempts" was not a real
-- bound on guesses, and a username could be enumerated or brute-forced.
--
-- The counter lives on the row instead, so it is shared by every instance and
-- cannot be reset by changing a header. A legitimate login clears it, so a
-- mistyped password never locks anyone out permanently.
ALTER TABLE "User"
  ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3);