package miniapps

import (
	"maps"
	"testing"
	"time"
)

func TestDateExpressionsUseCivilDayOffsets(t *testing.T) {
	for _, test := range []struct {
		name, zone, date, expression, want string
	}{
		{"local date", "Pacific/Kiritimati", "2026-02-28T00:30:00", "$today", "2026-02-28"},
		{"offset into skipped midnight", "America/Sao_Paulo", "2018-11-01T00:30:00", "$today+3", "2018-11-04"},
		{"negative offset into skipped midnight", "America/Sao_Paulo", "2018-11-05T00:30:00", "$today-1", "2018-11-04"},
		{"offset into skipped civil day", "Pacific/Apia", "2011-12-29T00:30:00", "$today+1", "2011-12-30"},
		{"negative offset into skipped civil day", "Pacific/Apia", "2011-12-31T00:30:00", "$today-1", "2011-12-30"},
	} {
		t.Run(test.name, func(t *testing.T) {
			location, err := time.LoadLocation(test.zone)
			if err != nil {
				t.Fatal(err)
			}
			now, err := time.ParseInLocation("2006-01-02T15:04:05", test.date, location)
			if err != nil {
				t.Fatal(err)
			}
			if got := resolve(test.expression, nil, now); got != test.want {
				t.Fatalf("%s at %s = %v, want %s", test.expression, now, got, test.want)
			}
		})
	}
}

func TestConfirmedWritePreservesDayWithSkippedMidnight(t *testing.T) {
	location, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Fatal(err)
	}
	for _, zone := range []string{"America/Sao_Paulo", "Pacific/Kiritimati"} {
		t.Run(zone, func(t *testing.T) {
			db, service := storeAt(t, ":memory:")
			t.Cleanup(func() { _ = db.Close() })
			now := time.Date(2018, time.November, 4, 12, 0, 0, 0, location)
			service.now = func() time.Time { return now }
			_, book := setup(t, service)
			command := Invocation{Action: "inbox.add", Surface: "page", OperationID: "midnight-gap", Inputs: map[string]any{"title": "Reviewed note", "note": "DST fixture"}}
			preview := call(t, service, book.ID, command)
			if preview.Records[0].Fields["revisit"] != "2018-11-04" {
				t.Fatal("preview lost the local calendar date", preview)
			}
			command.Confirm = preview.Confirmation
			confirmationLocation, err := time.LoadLocation(zone)
			if err != nil {
				t.Fatal(err)
			}
			now = now.Add(time.Minute).In(confirmationLocation)
			committed := call(t, service, book.ID, command)
			if !maps.Equal(preview.Records[0].Fields, committed.Records[0].Fields) {
				t.Fatal("confirmation changed the reviewed civil date", preview, committed)
			}
			if replay := call(t, service, book.ID, command); replay.Records[0].Revision != committed.Records[0].Revision {
				t.Fatal("confirmed operation was repeated", replay)
			}
		})
	}
}
