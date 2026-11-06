// Package webassets exposes the React production build embedded in the Local Service.
package webassets

import (
	"embed"
	"io/fs"
)

// The tracked fallback keeps Go tooling usable before the first web build.
// Production builds generate content/dist before compiling the Local Service.
//
//go:embed content
var embedded embed.FS

func Files() fs.FS {
	directory := "content"
	if _, err := fs.Stat(embedded, "content/dist/index.html"); err == nil {
		directory = "content/dist"
	}
	files, err := fs.Sub(embedded, directory)
	if err != nil {
		panic("load embedded web assets: " + err.Error())
	}
	return files
}
