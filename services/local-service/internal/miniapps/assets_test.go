package miniapps

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"testing"
)

func TestImagePackagesKeepTheirMinimumHostVersion(t *testing.T) {
	var pkg Package
	if err := json.Unmarshal(example(t), &pkg); err != nil {
		t.Fatal(err)
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	pkg.Assets = map[string]ImageAsset{"cover": {
		MIME: "image/png", Alt: "Cover", Data: base64.StdEncoding.EncodeToString(encoded.Bytes()),
	}}
	pkg.Pages[0].Image = "cover"
	for _, minimum := range []string{"", "1.0.0", "1.1.0", "1.2.0", "1.3.0"} {
		t.Run("minimum_"+minimum, func(t *testing.T) {
			pkg.MinHostVersion = minimum
			raw, err := json.Marshal(pkg)
			if err != nil {
				t.Fatal(err)
			}
			_, err = Validate(raw)
			compatible := minimum == "1.1.0" || minimum == "1.2.0"
			if compatible != (err == nil) {
				t.Fatalf("host %s, package minimum %q: %v", RuntimeVersion, minimum, err)
			}
		})
	}
}
