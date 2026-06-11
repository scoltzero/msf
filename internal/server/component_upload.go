package server

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"debug/elf"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const maxComponentUploadSize = 256 << 20

func (a *App) handleComponentUpdateUpload(w http.ResponseWriter, r *http.Request) {
	component := normalizeComponent(r.PathValue("component"))
	if component == "" {
		writeError(w, http.StatusBadRequest, "bad_component", "unknown component")
		return
	}
	if err := r.ParseMultipartForm(maxComponentUploadSize); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "file is required")
		return
	}
	defer file.Close()
	if header.Size > maxComponentUploadSize {
		writeError(w, http.StatusBadRequest, "too_large", "uploaded component is too large")
		return
	}
	uploadDir := filepath.Join(a.DataDir, "data", "uploads")
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "path_error", err.Error())
		return
	}
	tmp, err := os.CreateTemp(uploadDir, component+"-*"+filepath.Ext(header.Filename))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "path_error", err.Error())
		return
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := io.Copy(tmp, io.LimitReader(file, maxComponentUploadSize+1)); err != nil {
		tmp.Close()
		writeError(w, http.StatusInternalServerError, "write_failed", err.Error())
		return
	}
	if err := tmp.Close(); err != nil {
		writeError(w, http.StatusInternalServerError, "write_failed", err.Error())
		return
	}

	now := time.Now()
	version := "local-upload-" + now.Format("200601021504")
	downloadURL := "local-upload:" + filepath.Base(header.Filename)
	_, _ = a.DB.Exec(`insert into component_update_info(component,current_version,latest_version,has_update,download_url,download_digest,verified_digest,verified,verification_source,status,progress,error_message,last_check_time,created_at,updated_at)
		values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		on conflict(component) do update set current_version=excluded.current_version,latest_version=excluded.latest_version,has_update=excluded.has_update,download_url=excluded.download_url,download_digest='',verified_digest='',verified=false,verification_source=excluded.verification_source,status='running',progress=5,error_message='',last_check_time=excluded.last_check_time,updated_at=excluded.updated_at`,
		component, a.componentCurrentVersion(component), version, true, downloadURL, "", "", false, componentVerificationSourceLocalUpload, "running", 5, "", now, now, now)

	if err := a.installUploadedComponent(component, tmpPath, header.Filename); err != nil {
		_, _ = a.DB.Exec(`update component_update_info set status='failed',progress=5,error_message=?,updated_at=? where component=?`, err.Error(), nowString(), component)
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": err.Error(), "data": a.componentUpdateState(component)})
		return
	}

	restarted := false
	if component == "mosdns" || component == "mihomo" {
		if a.Services.Status(component).Running {
			_, _ = a.Services.Restart(r.Context(), component)
			restarted = true
		}
	}
	_, _ = a.DB.Exec(`update component_update_info set current_version=?,latest_version=?,has_update=false,download_url=?,download_digest='',verified_digest='',verified=false,verification_source=?,status='completed',progress=100,error_message='',last_check_time=?,updated_at=? where component=?`,
		version, version, downloadURL, componentVerificationSourceLocalUpload, now, now, component)
	state := a.componentUpdateState(component)
	state["restarted"] = restarted
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": state})
}

func (a *App) installUploadedComponent(component, src, originalName string) error {
	target := a.componentTarget(component)
	if target == "" {
		return fmt.Errorf("unknown component %s", component)
	}
	if component == "zashboard" {
		return a.installUploadedZashboard(src, originalName)
	}
	tmpDir, err := os.MkdirTemp(filepath.Join(a.DataDir, "data", "uploads"), component+"-extract-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	candidate := src
	lower := strings.ToLower(originalName)
	switch {
	case strings.HasSuffix(lower, ".zip"):
		if err := extractZipPreserve(src, tmpDir); err != nil {
			return err
		}
		candidate = findUploadedBinary(tmpDir, component)
	case strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".tgz"):
		if err := extractTarGzPreserve(src, tmpDir); err != nil {
			return err
		}
		candidate = findUploadedBinary(tmpDir, component)
	}
	if candidate == "" {
		return fmt.Errorf("no %s binary found in uploaded file", component)
	}
	if err := validateUploadedLinuxBinary(candidate); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return err
	}
	if err := copyFile(candidate, target, 0755); err != nil {
		return err
	}
	return os.Chmod(target, 0755)
}

func (a *App) installUploadedZashboard(src, originalName string) error {
	lower := strings.ToLower(originalName)
	if !strings.HasSuffix(lower, ".zip") {
		return fmt.Errorf("zashboard upload must be a .zip package")
	}
	return installZashboardArchive(src, filepath.Join(a.DataDir, "configs", "mihomo", "ui"))
}

func installZashboardArchive(src, uiDir string) error {
	tmpRoot := filepath.Dir(src)
	if tmpRoot == "" || tmpRoot == "." {
		tmpRoot = os.TempDir()
	}
	tmpDir, err := os.MkdirTemp(tmpRoot, "zashboard-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)
	if err := extractZipPreserve(src, tmpDir); err != nil {
		return err
	}
	index := findFileByBase(tmpDir, "index.html")
	if index == "" {
		return fmt.Errorf("zashboard package does not contain index.html")
	}
	root := filepath.Dir(index)
	if err := os.RemoveAll(uiDir); err != nil {
		return err
	}
	if err := copyDir(root, uiDir); err != nil {
		return err
	}
	return patchZashboardIndex(uiDir)
}

func validateUploadedLinuxBinary(path string) error {
	if runtime.GOOS != "linux" {
		return nil
	}
	f, err := elf.Open(path)
	if err != nil {
		return fmt.Errorf("uploaded binary is not a valid linux ELF file: %w", err)
	}
	defer f.Close()
	switch runtime.GOARCH {
	case "amd64":
		if f.Machine != elf.EM_X86_64 {
			return fmt.Errorf("uploaded binary architecture mismatch: got %s, want amd64", f.Machine.String())
		}
	case "arm64":
		if f.Machine != elf.EM_AARCH64 {
			return fmt.Errorf("uploaded binary architecture mismatch: got %s, want arm64", f.Machine.String())
		}
	}
	return nil
}

func findUploadedBinary(root, component string) string {
	var best string
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || best != "" {
			return nil
		}
		name := strings.ToLower(d.Name())
		if name == component || strings.HasPrefix(name, component+"-") || strings.Contains(name, component) {
			best = path
		}
		return nil
	})
	if best != "" {
		return best
	}
	return findFirstELF(root)
}

func findFirstELF(root string) string {
	var best string
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || best != "" {
			return nil
		}
		if f, err := elf.Open(path); err == nil {
			_ = f.Close()
			best = path
		}
		return nil
	})
	return best
}

func findFileByBase(root, base string) string {
	var out string
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || out != "" {
			return nil
		}
		if strings.EqualFold(d.Name(), base) {
			out = path
		}
		return nil
	})
	return out
}

func extractZipPreserve(src, dest string) error {
	zr, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer zr.Close()
	for _, item := range zr.File {
		name := cleanArchivePath(item.Name)
		if name == "" {
			continue
		}
		target := filepath.Join(dest, name)
		if item.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		rc, err := item.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, item.FileInfo().Mode())
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		rc.Close()
		out.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func extractTarGzPreserve(src, dest string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		name := cleanArchivePath(h.Name)
		if name == "" {
			continue
		}
		target := filepath.Join(dest, name)
		if h.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, h.FileInfo().Mode())
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, tr); err != nil {
			out.Close()
			return err
		}
		out.Close()
	}
	return nil
}

func cleanArchivePath(name string) string {
	name = filepath.ToSlash(strings.TrimSpace(name))
	name = strings.TrimPrefix(name, "/")
	clean := filepath.Clean(name)
	if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return ""
	}
	return clean
}

func copyDir(src, dest string) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil || rel == "." {
			return err
		}
		target := filepath.Join(dest, rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		if d.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}
		return copyFile(path, target, info.Mode())
	})
}
