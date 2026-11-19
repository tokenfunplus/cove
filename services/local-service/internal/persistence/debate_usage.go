package persistence

import "context"

// Read only accounting fields, independent of transcript pagination and body size.
func (store *SQLiteStore) ReadDebateUsage(ctx context.Context, id string) ([]DebateSeatUsage, error) {
	rows, err := store.db.QueryContext(ctx, `
SELECT json_extract(record,'$.seat'),
SUM(CASE WHEN json_extract(record,'$.state')!='streaming' THEN 1 ELSE 0 END),
SUM(CASE WHEN json_extract(record,'$.state')!='streaming' AND json_extract(record,'$.kind')='summary' THEN 1 ELSE 0 END),
SUM(CASE WHEN json_extract(record,'$.state')='streaming' THEN 1 ELSE 0 END),
SUM(CASE WHEN json_extract(record,'$.state')!='streaming' AND json_extract(record,'$.metrics.input_tokens')>=0 THEN COALESCE(json_extract(record,'$.metrics.input_tokens'),0) ELSE 0 END),
SUM(CASE WHEN json_extract(record,'$.state')!='streaming' AND json_extract(record,'$.metrics.output_tokens')>=0 THEN COALESCE(json_extract(record,'$.metrics.output_tokens'),0) ELSE 0 END),
SUM(CASE WHEN json_extract(record,'$.state')!='streaming' AND (json_extract(record,'$.metrics.input_tokens') IS NULL OR json_extract(record,'$.metrics.output_tokens') IS NULL OR json_extract(record,'$.metrics.input_tokens')<0 OR json_extract(record,'$.metrics.output_tokens')<0) THEN 1 ELSE 0 END)
FROM debate_turns WHERE debate_id=? AND (json_extract(record,'$.usage_expected')=1 OR json_extract(record,'$.metrics') IS NOT NULL OR json_type(record,'$.usage_expected') IS NULL)
GROUP BY json_extract(record,'$.seat')`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	usage := []DebateSeatUsage{}
	for rows.Next() {
		var seat DebateSeatUsage
		if err := rows.Scan(&seat.Seat, &seat.Calls, &seat.SummaryCalls, &seat.ActiveCalls, &seat.InputTokens, &seat.OutputTokens, &seat.MissingUsageCalls); err != nil {
			return nil, err
		}
		usage = append(usage, seat)
	}
	return usage, rows.Err()
}

func (store *SQLiteStore) LoadDebateSummaryContext(ctx context.Context, id string, from, through int) ([]DebateTurn, error) {
	rows, err := store.db.QueryContext(ctx, `SELECT json_remove(record,'$.messages','$.reasoning','$.verification') FROM debate_turns WHERE debate_id=? AND json_extract(record,'$.state')='completed' AND COALESCE(json_extract(record,'$.kind'),'')!='summary' AND json_extract(record,'$.round')>=? AND json_extract(record,'$.round')<=? ORDER BY sequence DESC LIMIT 44`, id, max(1, from-1), through)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	turns := []DebateTurn{}
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		turn, err := decodeDebateTurn(data)
		if err != nil {
			return nil, err
		}
		turns = append(turns, turn)
	}
	for i, j := 0, len(turns)-1; i < j; i, j = i+1, j-1 {
		turns[i], turns[j] = turns[j], turns[i]
	}
	return turns, rows.Err()
}
