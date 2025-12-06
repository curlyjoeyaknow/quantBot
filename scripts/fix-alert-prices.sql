-- Fix alert prices by copying from SQLite data
-- The 1970-timestamped rows have the correct prices

-- Update DTV alerts (multiple different prices from different callers)
-- Using an average/reasonable price from the SQLite data
UPDATE alerts
SET alert_price = 0.0088
WHERE id IN (13639, 13641, 13655, 13683, 13831, 13836)
AND alert_price IS NULL;

-- Update MRBEAST alerts  
UPDATE alerts
SET alert_price = 0.0035
WHERE id IN (12112, 12113, 12115, 13209)
AND alert_price IS NULL;

-- Update AIRI alert
UPDATE alerts
SET alert_price = 0.000023
WHERE id = 13208
AND alert_price IS NULL;

-- Update PEPE alert
UPDATE alerts
SET alert_price = 0.000037
WHERE id = 13232
AND alert_price IS NULL;

-- Verify the updates
SELECT a.id, t.symbol, t.address, a.alert_price, a.alert_timestamp
FROM alerts a
JOIN tokens t ON a.token_id = t.id
WHERE a.id IN (13639, 13641, 13655, 13683, 13831, 13836, 12112, 12113, 12115, 13209, 13208, 13232)
ORDER BY t.symbol, a.alert_timestamp;

