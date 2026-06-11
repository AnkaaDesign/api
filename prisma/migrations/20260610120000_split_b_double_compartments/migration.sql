-- Split the single "Bitrem" (B_DOUBLE) truck category into front/rear compartment
-- categories. Postgres cannot drop an enum value in place, so recreate the type:
-- rename old -> create new -> recast the column (mapping B_DOUBLE -> B_DOUBLE_FRONT)
-- -> drop old. The whole migration runs in one transaction.
ALTER TYPE "TruckCategory" RENAME TO "TruckCategory_old";

CREATE TYPE "TruckCategory" AS ENUM (
  'MINI',
  'VUC',
  'THREE_QUARTER',
  'RIGID',
  'TRUCK',
  'SEMI_TRAILER',
  'SEMI_TRAILER_2_AXLES',
  'B_DOUBLE_FRONT',
  'B_DOUBLE_REAR',
  'BITRUCK'
);

ALTER TABLE "Truck"
  ALTER COLUMN "category" TYPE "TruckCategory"
  USING (
    CASE "category"::text
      WHEN 'B_DOUBLE' THEN 'B_DOUBLE_FRONT'
      ELSE "category"::text
    END
  )::"TruckCategory";

DROP TYPE "TruckCategory_old";
