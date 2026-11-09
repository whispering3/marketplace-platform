WITH vendor_sales AS (
  SELECT
    u."id",
    COUNT(o."id")::integer AS completed_sales
  FROM "User" u
  LEFT JOIN "Order" o
    ON o."vendorId" = u."id"
   AND o."status" = 'COMPLETED'
  WHERE u."role" = 'VENDOR'
  GROUP BY u."id"
)
UPDATE "User" u
SET
  "level" = CASE
    WHEN vendor_sales.completed_sales >= 1200 THEN 10
    WHEN vendor_sales.completed_sales >= 750 THEN 9
    WHEN vendor_sales.completed_sales >= 400 THEN 8
    WHEN vendor_sales.completed_sales >= 200 THEN 7
    WHEN vendor_sales.completed_sales >= 100 THEN 6
    WHEN vendor_sales.completed_sales >= 60 THEN 5
    WHEN vendor_sales.completed_sales >= 30 THEN 4
    WHEN vendor_sales.completed_sales >= 15 THEN 3
    WHEN vendor_sales.completed_sales >= 5 THEN 2
    ELSE 1
  END,
  "badges" = CASE
    WHEN vendor_sales.completed_sales >= 100 THEN '[TRUSTED SOURCE] [HIGH-VOLUME DEALER] [INDUSTRY LEGEND]'
    WHEN vendor_sales.completed_sales >= 30 THEN '[TRUSTED SOURCE] [HIGH-VOLUME DEALER]'
    WHEN vendor_sales.completed_sales >= 5 THEN '[TRUSTED SOURCE]'
    ELSE NULL
  END
FROM vendor_sales
WHERE u."id" = vendor_sales."id";
