// Package speech owns verified local speech installations and bounded native synthesis.
package speech

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"path/filepath"

	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

const RuntimeVersion = "sherpa-onnx-1.12.40/onnx-1.28.2"
const PocketRuntimeVersion = "pocket-tts-4.0.1"

//go:embed models.json
var registryJSON []byte

//go:embed pocket-config.yaml
var pocketConfig []byte

type Voice struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Language string `json:"language"`
	Speaker  int    `json:"speaker"`
}
type Artifact struct {
	persistence.BundleArtifact
	URL string `json:"url"`
}
type Model struct {
	localmodels.Model
	Engine       string     `json:"engine"`
	Languages    []string   `json:"languages"`
	Voices       []Voice    `json:"voices"`
	DefaultVoice string     `json:"default_voice"`
	ArchiveRoot  string     `json:"archive_root"`
	Artifacts    []Artifact `json:"artifacts"`
	Required     []string   `json:"required"`
	ModelFile    string     `json:"model_file"`
	TokensFile   string     `json:"tokens_file"`
	VoicesFile   string     `json:"voices_file"`
	DataDir      string     `json:"data_dir"`
	DictDir      string     `json:"dict_dir"`
	Lexicon      []string   `json:"lexicon"`
	Rules        []string   `json:"rules"`
}

var Registry = func() []Model {
	var models []Model
	if err := json.Unmarshal(registryJSON, &models); err != nil {
		panic(err)
	}
	return models
}()

func Lookup(id string) (Model, error) {
	for _, model := range Registry {
		if model.ID == id {
			return model, nil
		}
	}
	return Model{}, fmt.Errorf("This speech model is not available in Cove.")
}
func IsModel(id string) bool { _, err := Lookup(id); return err == nil }
func (model Model) Bundle() persistence.ModelBundle {
	assets := make([]persistence.BundleArtifact, len(model.Artifacts))
	for i, item := range model.Artifacts {
		assets[i] = item.BundleArtifact
	}
	bundle := persistence.ModelBundle{ID: model.ID, SHA256: model.SHA256, ArchiveRoot: model.ArchiveRoot, Artifacts: assets, Required: model.Required}
	if model.Engine == "pocket" {
		bundle.Generated = map[string][]byte{"cove-config.yaml": pocketConfig}
		bundle.Required = append(append([]string{}, bundle.Required...), "cove-config.yaml")
	}
	return bundle
}
func (model Model) Voice(id string) (Voice, bool) {
	for _, voice := range model.Voices {
		if voice.ID == id {
			return voice, true
		}
	}
	return Voice{}, false
}
func (model Model) Supports(language string) bool {
	for _, value := range model.Languages {
		if value == language {
			return true
		}
	}
	return false
}
func RuntimeDirectory(executable string) string {
	return filepath.Join(filepath.Dir(executable), "speech")
}
