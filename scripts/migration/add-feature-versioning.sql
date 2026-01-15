-- Migration: Add feature store versioning
-- Adds version tracking columns to feature_sets and features tables

-- Add version columns to feature_sets table
ALTER TABLE feature_sets 
ADD COLUMN IF NOT EXISTS feature_set_version TEXT DEFAULT '1.0.0',
ADD COLUMN IF NOT EXISTS feature_spec_version TEXT DEFAULT '1.0.0',
ADD COLUMN IF NOT EXISTS computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS computed_by TEXT;

-- Update existing rows to set computed_at from created_at if computed_at is NULL
UPDATE feature_sets 
SET computed_at = created_at 
WHERE computed_at IS NULL;

-- Add version columns to features table
ALTER TABLE features 
ADD COLUMN IF NOT EXISTS feature_set_version TEXT DEFAULT '1.0.0',
ADD COLUMN IF NOT EXISTS computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS computed_by TEXT;

-- Update existing rows to set computed_at from created_at if computed_at is NULL
UPDATE features 
SET computed_at = created_at 
WHERE computed_at IS NULL;

-- Update features.feature_set_version from feature_sets if NULL
UPDATE features f
SET feature_set_version = (
  SELECT fs.feature_set_version 
  FROM feature_sets fs 
  WHERE fs.feature_set_id = f.feature_set_id
)
WHERE f.feature_set_version IS NULL OR f.feature_set_version = '1.0.0';

