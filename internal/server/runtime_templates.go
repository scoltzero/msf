package server

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

//go:embed runtime_templates/**
var runtimeTemplates embed.FS

func runtimeTemplateText(rel string) (string, bool) {
	b, err := runtimeTemplates.ReadFile(filepath.ToSlash(filepath.Join("runtime_templates", rel)))
	if err != nil {
		return "", false
	}
	return string(b), true
}

func (a *App) ensureRuntimeTemplateDefaults(overwriteStructural bool) error {
	root := "runtime_templates"
	return fs.WalkDir(runtimeTemplates, root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel := strings.TrimPrefix(path, root+"/")
		if strings.HasPrefix(rel, "mihomo/") {
			return nil
		}
		destRel := filepath.ToSlash(filepath.Join("configs", rel))
		dest := filepath.Join(a.DataDir, destRel)
		if !overwriteStructural || !isRuntimeStructuralTemplate(rel) {
			if _, err := os.Stat(dest); err == nil {
				return nil
			}
		}
		b, err := runtimeTemplates.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			return err
		}
		return os.WriteFile(dest, b, 0644)
	})
}

func isRuntimeStructuralTemplate(rel string) bool {
	switch {
	case rel == "mihomo/config.yaml", rel == "mihomo/phone_config.yaml":
		return true
	default:
		return false
	}
}
