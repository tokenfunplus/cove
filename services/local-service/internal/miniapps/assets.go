package miniapps

import (
	"bytes"
	"encoding/base64"
	"image"
	_ "image/jpeg"
	_ "image/png"
)

type ImageAsset struct {
	MIME string `json:"mime"`
	Alt  string `json:"alt"`
	Data string `json:"data"`
}

func validateAssets(p Package) error {
	if len(p.Assets) > 8 || len(p.Assets) > 0 && p.MinHostVersion != RuntimeVersion {
		return invalid("image assets require host 1.1.0 and at most eight images")
	}
	for name, asset := range p.Assets {
		if !slug.MatchString(name) || !short(asset.Alt, 256) || (asset.MIME != "image/png" && asset.MIME != "image/jpeg") {
			return invalid("image asset description")
		}
		raw, err := base64.StdEncoding.Strict().DecodeString(asset.Data)
		if err != nil || len(raw) > 256*1024 {
			return invalid("image asset payload")
		}
		cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
		if err != nil || "image/"+format != asset.MIME || cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > 2048 || cfg.Height > 2048 {
			return invalid("image dimensions or format")
		}
		if _, _, err := image.Decode(bytes.NewReader(raw)); err != nil {
			return invalid("image pixel data")
		}
	}
	for _, page := range p.Pages {
		if page.Image != "" {
			if _, ok := p.Assets[page.Image]; !ok {
				return invalid("unknown page image")
			}
		}
	}
	return nil
}
