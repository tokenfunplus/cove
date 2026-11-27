package persistence

import "database/sql"

type MiniAppBlob struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Size int    `json:"size"`
	Data []byte `json:"data,omitempty"`
}

func (tx *MiniAppStore) AppBlobs(instance string, includeData bool) ([]MiniAppBlob, error) {
	column := "NULL"
	if includeData {
		column = "content"
	}
	rows, err := tx.tx.QueryContext(tx.ctx, "SELECT id,name,length(content),"+column+" FROM mini_app_blobs WHERE instance_id=? ORDER BY rowid", instance)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []MiniAppBlob{}
	for rows.Next() {
		var b MiniAppBlob
		if err := rows.Scan(&b.ID, &b.Name, &b.Size, &b.Data); err != nil {
			return nil, err
		}
		result = append(result, b)
	}
	return result, rows.Err()
}
func (tx *MiniAppStore) AppBlob(instance, id string) (MiniAppBlob, error) {
	var b MiniAppBlob
	err := tx.tx.QueryRowContext(tx.ctx, "SELECT id,name,length(content),content FROM mini_app_blobs WHERE instance_id=? AND id=?", instance, id).Scan(&b.ID, &b.Name, &b.Size, &b.Data)
	return b, err
}
func (tx *MiniAppStore) SaveAppBlob(instance string, b MiniAppBlob) error {
	_, err := tx.tx.ExecContext(tx.ctx, "INSERT INTO mini_app_blobs(instance_id,id,name,content) VALUES(?,?,?,?)", instance, b.ID, b.Name, b.Data)
	return err
}
func (tx *MiniAppStore) DeleteAppBlob(instance, id string) error {
	result, err := tx.tx.ExecContext(tx.ctx, "DELETE FROM mini_app_blobs WHERE instance_id=? AND id=?", instance, id)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n == 0 {
		return sql.ErrNoRows
	}
	return err
}
