-- Migration: 20260904120000_drop_commission_entries_comanda_item_id_key
-- Verifies prerequisite composite version index and partial unique index exist, then drops the obsolete unconditional comanda_item_id unique index.

DO $$
BEGIN
    -- 1. Verify composite version index exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'commission_entries'
        AND indexname = 'commission_entries_comanda_item_id_attribution_version_key'
    ) THEN
        RAISE EXCEPTION 'VERSIONING_INDEX_PREREQUISITE_FAILED: composite version index commission_entries_comanda_item_id_attribution_version_key does not exist';
    END IF;

    -- 2. Verify partial current index exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'commission_entries'
        AND indexname = 'commission_entries_one_current_per_comanda_item_uidx'
    ) THEN
        RAISE EXCEPTION 'VERSIONING_INDEX_PREREQUISITE_FAILED: partial unique index commission_entries_one_current_per_comanda_item_uidx does not exist';
    END IF;

    -- 3. DROP obsolete unconditional unique index
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'commission_entries'
        AND indexname = 'commission_entries_comanda_item_id_key'
    ) THEN
        DROP INDEX "commission_entries_comanda_item_id_key";
    END IF;
END $$;
