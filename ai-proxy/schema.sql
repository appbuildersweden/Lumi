-- Räknare för takten i AI-tjänsten.
--
-- En rad per omfattning och tidsfönster: `user:<konto>` per minut och `all` per
-- dygn. Raderna behöver aldrig städas för hand – gamla nycklar används inte
-- igen, och en rad tar några tiotal byte.
CREATE TABLE IF NOT EXISTS hits (
  scope TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, bucket)
);
