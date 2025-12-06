-- Update ClickHouse token addresses to use full addresses instead of shortened ones

-- DTV
ALTER TABLE quantbot.ohlcv_candles 
UPDATE token_address = 'cpltbybtdmkzthbapqddmhjxnwesceb14gm6vuodpump'
WHERE token_address = 'CPLTbYbt';

-- AIRI
ALTER TABLE quantbot.ohlcv_candles 
UPDATE token_address = '3haqddkzw5trfingesjgd2zyrlovre2ro5o8xkjcbags'
WHERE token_address = '3hAQddKZ';

-- MRBEAST
ALTER TABLE quantbot.ohlcv_candles 
UPDATE token_address = 'g1dxvvmqjs8ei79qbk41dpgk2wtxsgqltx9of7o8bags'
WHERE token_address = 'G1DXVVmq';

-- PEPE
ALTER TABLE quantbot.ohlcv_candles 
UPDATE token_address = 'akcebmkufbb8wo7n4ryqrfezt7ojkkymed2tncclbonk'
WHERE token_address = 'AKCEbMKU';

