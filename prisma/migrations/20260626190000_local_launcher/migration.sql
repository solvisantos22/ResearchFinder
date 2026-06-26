CREATE TABLE "LauncherRegistration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "LauncherRegistration_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LauncherRegistration_userId_idx" ON "LauncherRegistration"("userId");
ALTER TABLE "LauncherRegistration" ADD CONSTRAINT "LauncherRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WorkerLaneDesiredState" (
    "userId" TEXT NOT NULL,
    "inboxEnabled" BOOLEAN NOT NULL DEFAULT false,
    "researchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkerLaneDesiredState_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "WorkerLaneDesiredState" ADD CONSTRAINT "WorkerLaneDesiredState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkerRegistration" ADD COLUMN "launcherManaged" BOOLEAN NOT NULL DEFAULT false;
