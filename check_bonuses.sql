-- Check total bonus count
SELECT COUNT(*) as total_bonuses FROM "Bonus";

-- Check bonuses for this user
SELECT * FROM "Bonus" WHERE "userId" = '02ff36c7-87bb-4256-acd7-273176c5960e';

-- Check if there are any bonuses at all
SELECT "userId", "year", "month", "baseBonus" FROM "Bonus" ORDER BY "createdAt" DESC LIMIT 10;

-- Check user info
SELECT id, name, email FROM "User" WHERE id = '02ff36c7-87bb-4256-acd7-273176c5960e';
