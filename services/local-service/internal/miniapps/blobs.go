package miniapps

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

const MaxBlobBytes = 4 << 20

func validBlob(b persistence.MiniAppBlob) bool {
	id, err := uuid.Parse(b.ID)
	return err == nil && id.String() == b.ID && short(b.Name, 255) && filepath.Base(b.Name) == b.Name &&
		b.Name != "." && b.Name != ".." && !strings.ContainsAny(b.Name, "\\\r\n") && len(b.Data) > 0 && len(b.Data) <= MaxBlobBytes && len(b.Data) == b.Size
}

func (s *Service) withBlobs(ctx context.Context, id string, fn func(*persistence.MiniAppStore) error) error {
	return s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		i, err := loadInstance(tx, id)
		if err != nil {
			return err
		}
		if !i.Enabled || !slices.Contains(i.Grants, "blobs.import") {
			return ErrDenied
		}
		return fn(tx)
	})
}
func (s *Service) Blobs(ctx context.Context, id string) (rows []persistence.MiniAppBlob, err error) {
	err = s.withBlobs(ctx, id, func(tx *persistence.MiniAppStore) error { var e error; rows, e = tx.AppBlobs(id, false); return e })
	return
}
func (s *Service) Blob(ctx context.Context, id, key string) (b persistence.MiniAppBlob, err error) {
	err = s.withBlobs(ctx, id, func(tx *persistence.MiniAppStore) error { var e error; b, e = tx.AppBlob(id, key); return lookup(e) })
	return
}
func (s *Service) ImportBlob(ctx context.Context, id string, b persistence.MiniAppBlob) error {
	if !validBlob(b) {
		return invalid("choose a named, nonempty attachment of up to 4 MiB")
	}
	return s.withBlobs(ctx, id, func(tx *persistence.MiniAppStore) error {
		prior, err := tx.AppBlob(id, b.ID)
		if err == nil {
			if prior.Name == b.Name && bytes.Equal(prior.Data, b.Data) {
				return nil
			}
			return ErrConflict
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		list, err := tx.AppBlobs(id, false)
		if err != nil {
			return err
		}
		size := b.Size
		for _, item := range list {
			size += item.Size
		}
		if len(list) >= 64 || size > 16<<20 {
			return invalid("attachment storage limit")
		}
		return tx.SaveAppBlob(id, b)
	})
}
func (s *Service) DeleteBlob(ctx context.Context, id, key string) error {
	return s.withBlobs(ctx, id, func(tx *persistence.MiniAppStore) error { return lookup(tx.DeleteAppBlob(id, key)) })
}
