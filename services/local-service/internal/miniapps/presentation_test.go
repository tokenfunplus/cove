package miniapps

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

const presentationPackage = `{
 "format":1,"publisher":"author","app":"records","name":"Records",
 "description":"Presentation regression fixture.","version":"1.0.0",
 "min_host_version":"1.2.0","schema_version":1,
 "capabilities":["records.query","records.commit"],
 "collections":{"entries":{"title_field":"company","fields":{"company":"text","position":"text","appliedOn":"date","channel":"text"}}},
 "pages":[{"id":"home","title":"Records","actions":["list","add"]}],
 "actions":{
  "list":{"title":"List","op":"query","collection":"entries","inputs":{},"surfaces":["page"],"order_by":"appliedOn"},
  "add":{"title":"Add","op":"create","collection":"entries","inputs":{"company":"text","position":"text","appliedOn":"date","channel":"text"},"surfaces":["page"],"values":{"company":"$input.company","position":"$input.position","appliedOn":"$input.appliedOn","channel":"$input.channel"}}
 }
}`

func TestPackagePresentationSurvivesInstallationRestartAndJSONRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "presentation.sqlite")
	db, service := storeAt(t, path)
	release, err := service.Install(t.Context(), []byte(presentationPackage), "local")
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, service = storeAt(t, path)
	defer db.Close()
	stored, err := service.Release(t.Context(), release.ID)
	if err != nil || stored.Digest != digest([]byte(presentationPackage)) {
		t.Fatal("presentation changed the immutable package identity", err)
	}
	for range 2 {
		encoded, err := json.Marshal(stored.Package)
		if err != nil {
			t.Fatal(err)
		}
		var wire struct {
			Collections map[string]json.RawMessage `json:"collections"`
			Actions     map[string]json.RawMessage `json:"actions"`
		}
		if err := json.Unmarshal(encoded, &wire); err != nil {
			t.Fatal(err)
		}
		for _, raw := range []json.RawMessage{wire.Collections["entries"], wire.Actions["add"]} {
			text := string(raw)
			if !(strings.Index(text, `"company":"text"`) < strings.Index(text, `"position":"text"`) &&
				strings.Index(text, `"position":"text"`) < strings.Index(text, `"appliedOn":"date"`) &&
				strings.Index(text, `"appliedOn":"date"`) < strings.Index(text, `"channel":"text"`)) {
				t.Fatal("authored field order was lost", text)
			}
		}
		stored.Package, err = Validate(encoded)
		if err != nil || stored.Package.Collections["entries"].TitleField != "company" {
			t.Fatal("package presentation did not round trip", err)
		}
	}
}

func TestPresentationKeepsStrictValidationAndHostCompatibility(t *testing.T) {
	for _, change := range []struct{ before, after string }{
		{`"title_field":"company"`, `"title_field":"missing"`},
		{`"title_field":"company"`, `"title_field":"appliedOn"`},
		{`"title_field":"company"`, `"title_field":123`},
		{`"min_host_version":"1.2.0"`, `"min_host_version":"1.1.0"`},
		{`"company":"text","position":"text"`, `"company":"text","company":"text"`},
		{`"inputs":{"company"`, `"Inputs":{"company"`},
		{`"title_field":"company"`, `"inputOrder":[],"title_field":"company"`},
		{`"title_field":"company"`, `"":[],"title_field":"company"`},
	} {
		raw := strings.Replace(presentationPackage, change.before, change.after, 1)
		if _, err := Validate([]byte(raw)); err == nil {
			t.Errorf("accepted invalid presentation: %s", change.after)
		}
	}
	legacy := strings.ReplaceAll(presentationPackage, `"title_field":"company",`, "")
	legacy = strings.Replace(legacy, `"min_host_version":"1.2.0"`, `"min_host_version":"1.0.0"`, 1)
	if _, err := Validate([]byte(legacy)); err != nil {
		t.Fatal("original packages require no presentation changes", err)
	}
}
