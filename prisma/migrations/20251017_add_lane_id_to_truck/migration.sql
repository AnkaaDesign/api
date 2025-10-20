-- Add laneId field to Truck table for truck positioning in garage lanes
ALTER TABLE "Truck" ADD COLUMN "laneId" TEXT;

-- Create index on laneId for performance
CREATE INDEX "Truck_laneId_idx" ON "Truck"("laneId");

-- Add foreign key constraint to GarageLane
ALTER TABLE "Truck" ADD CONSTRAINT "Truck_laneId_fkey" FOREIGN KEY ("laneId") REFERENCES "GarageLane"("id") ON DELETE SET NULL ON UPDATE CASCADE;
