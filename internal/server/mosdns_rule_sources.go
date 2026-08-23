package server

import (
	"bufio"
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	scdomain "github.com/sagernet/sing/common/domain"
	"github.com/sagernet/sing/common/varbin"
)

type mosDNSRuleSource struct {
	ID                  string `json:"id,omitempty"`
	Name                string `json:"name"`
	Type                string `json:"type"`
	Files               string `json:"files,omitempty"`
	URL                 string `json:"url"`
	Enabled             bool   `json:"enabled"`
	AutoUpdate          bool   `json:"auto_update"`
	UpdateIntervalHours int    `json:"update_interval_hours"`
	RuleCount           int    `json:"rule_count"`
	LastUpdated         string `json:"last_updated"`

	SourceType string `json:"source_type,omitempty"`
	ConfigPath string `json:"config_path,omitempty"`
	LocalPath  string `json:"local_path,omitempty"`
	FileSize   int64  `json:"file_size,omitempty"`
	Warning    string `json:"warning,omitempty"`
}

func (a *App) writeMosDNSRuleSources(w http.ResponseWriter, r *http.Request) {
	sources := a.filteredMosDNSRuleSources(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"success":      true,
		"data":         map[string]any{"rule_sets": sources, "items": sources, "total": len(sources)},
		"rule_sets":    sources,
		"items":        sources,
		"sources":      sources,
		"total":        len(sources),
		"source_types": []string{"srs", "adguard"},
	})
}

func (a *App) handleMosDNSRuleSourceGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	source, ok := a.findMosDNSRuleSource(id)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "rule source not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": source})
}

func (a *App) handleMosDNSRuleSourceCreate(w http.ResponseWriter, r *http.Request) {
	var req mosDNSRuleSource
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	req.normalizeForCreate(r.URL.Query().Get("source_type"))
	if req.Name == "" || req.URL == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "name and url are required")
		return
	}
	if req.ID == "" {
		if req.SourceType == "adguard" {
			req.ID = randomHex(16)
		} else {
			req.ID = mosDNSRuleSourceID(req)
		}
	}
	if req.LastUpdated == "" {
		req.LastUpdated = time.Now().Format(time.RFC3339)
	}
	if req.UpdateIntervalHours <= 0 {
		req.UpdateIntervalHours = 24
	}
	configRel := mosDNSRuleSourceConfigRel(req)
	items, err := a.readMosDNSRuleSourceConfig(configRel, req.SourceType)
	if err != nil {
		writeError(w, http.StatusBadRequest, "read_failed", err.Error())
		return
	}
	for _, item := range items {
		if item.ID == req.ID || item.Name == req.Name {
			writeError(w, http.StatusConflict, "exists", "rule source already exists")
			return
		}
	}
	items = append(items, req)
	if err := a.writeMosDNSRuleSourceConfig(configRel, items); err != nil {
		writeError(w, http.StatusBadRequest, "write_failed", err.Error())
		return
	}
	source, _ := a.findMosDNSRuleSource(req.ID)
	runtimeSource, err := a.syncMosDNSRuleSourceRuntime(source, true)
	if err != nil {
		_ = a.writeMosDNSRuleSourceConfig(configRel, items[:len(items)-1])
		if runtimeSource.ID != "" {
			_ = a.deleteMosDNSRuleSourceRuntimeWithoutCacheFlush(runtimeSource)
		}
		writeError(w, http.StatusConflict, "runtime_sync_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"success": true, "restart_required": false, "data": runtimeSource})
}

func (a *App) handleMosDNSRuleSourcePut(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	current, ok := a.findMosDNSRuleSource(id)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "rule source not found")
		return
	}
	previous := current
	var req struct {
		ID                  string `json:"id"`
		Name                string `json:"name"`
		Type                string `json:"type"`
		Files               string `json:"files"`
		URL                 string `json:"url"`
		Enabled             *bool  `json:"enabled"`
		AutoUpdate          *bool  `json:"auto_update"`
		UpdateIntervalHours int    `json:"update_interval_hours"`
		RuleCount           int    `json:"rule_count"`
		LastUpdated         string `json:"last_updated"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if req.Name != "" {
		current.Name = req.Name
	}
	if req.Type != "" {
		current.Type = req.Type
	}
	if req.Files != "" {
		current.Files = req.Files
	}
	if req.URL != "" {
		current.URL = req.URL
	}
	if req.Enabled != nil {
		current.Enabled = *req.Enabled
	}
	if req.AutoUpdate != nil {
		current.AutoUpdate = *req.AutoUpdate
	}
	if req.UpdateIntervalHours > 0 {
		current.UpdateIntervalHours = req.UpdateIntervalHours
	}
	if req.RuleCount > 0 {
		current.RuleCount = req.RuleCount
	}
	if req.LastUpdated != "" {
		current.LastUpdated = req.LastUpdated
	}
	if err := a.replaceMosDNSRuleSource(current); err != nil {
		writeError(w, http.StatusBadRequest, "write_failed", err.Error())
		return
	}
	source, _ := a.findMosDNSRuleSource(current.ID)
	runtimeSource, err := a.updateMosDNSRuleSourceRuntime(previous, source)
	if err != nil {
		writeError(w, http.StatusConflict, "runtime_sync_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "restart_required": false, "data": runtimeSource})
}

func (a *App) handleMosDNSRuleSourceDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	source, ok := a.findMosDNSRuleSource(id)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "rule source not found")
		return
	}
	items, err := a.readMosDNSRuleSourceConfig(source.ConfigPath, source.SourceType)
	if err != nil {
		writeError(w, http.StatusBadRequest, "read_failed", err.Error())
		return
	}
	next := make([]mosDNSRuleSource, 0, len(items))
	for _, item := range items {
		if item.ID != source.ID && item.Name != source.Name {
			next = append(next, item)
		}
	}
	if err := a.writeMosDNSRuleSourceConfig(source.ConfigPath, next); err != nil {
		writeError(w, http.StatusBadRequest, "write_failed", err.Error())
		return
	}
	deleteFile := r.URL.Query().Get("delete_file") == "true"
	var preserved []byte
	var localPath string
	if source.LocalPath != "" {
		if path, pathErr := a.safePath(source.LocalPath); pathErr == nil {
			localPath = path
			if !deleteFile {
				preserved, _ = os.ReadFile(path)
			}
		}
	}
	if err := a.deleteMosDNSRuleSourceRuntime(source); err != nil {
		writeError(w, http.StatusConflict, "runtime_sync_failed", err.Error())
		return
	}
	if deleteFile && localPath != "" {
		_ = os.Remove(localPath)
	} else if len(preserved) > 0 && localPath != "" {
		_ = os.MkdirAll(filepath.Dir(localPath), 0755)
		_ = os.WriteFile(localPath, preserved, 0644)
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "restart_required": false, "data": source})
}

func (a *App) handleMosDNSRuleSourceUpdate(w http.ResponseWriter, r *http.Request) {
	source, ok := a.findMosDNSRuleSource(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "rule source not found")
		return
	}
	updated, err := a.updateMosDNSRuleSource(source)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": err.Error(), "data": source})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": updated})
}

func (a *App) handleMosDNSRuleSourcesUpdateAll(w http.ResponseWriter, r *http.Request) {
	onlyEnabled := r.URL.Query().Get("all") != "true"
	sources := a.filteredMosDNSRuleSources(r)
	var updated []mosDNSRuleSource
	var failures []map[string]string
	for _, source := range sources {
		if onlyEnabled && !source.Enabled {
			continue
		}
		next, err := a.updateMosDNSRuleSource(source)
		if err != nil {
			failures = append(failures, map[string]string{"id": source.ID, "name": source.Name, "error": err.Error()})
			continue
		}
		updated = append(updated, next)
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": len(failures) == 0, "data": map[string]any{"updated": updated, "failures": failures}, "updated": updated, "failures": failures})
}

func (a *App) updateMosDNSRuleSource(source mosDNSRuleSource) (mosDNSRuleSource, error) {
	source, err := a.downloadMosDNSRuleSourceArtifact(source)
	if err != nil {
		return source, err
	}
	runtimeSource, err := a.syncMosDNSRuleSourceRuntime(source, false)
	if err != nil {
		source.Warning = err.Error()
		return source, err
	}
	if runtimeSource.ID != "" {
		source = runtimeSource
	}
	next, _ := a.findMosDNSRuleSource(source.ID)
	if next.ID != "" {
		next.Warning = source.Warning
		return next, nil
	}
	return source, nil
}

func (a *App) downloadMosDNSRuleSourceArtifact(source mosDNSRuleSource) (mosDNSRuleSource, error) {
	if source.URL == "" {
		return source, fmt.Errorf("rule source %s has empty url", source.ID)
	}
	localRel := source.LocalPath
	if localRel == "" {
		localRel = mosDNSRuleSourceLocalRel(source)
	}
	dst, err := a.safePath(localRel)
	if err != nil {
		return source, err
	}
	tmp := filepath.Join(a.DataDir, "data", "rule-source-downloads", source.ID+".download")
	if err := a.downloadFile(source.URL, tmp, nil); err != nil {
		_ = os.Remove(tmp)
		return source, err
	}
	ruleCount, err := prepareMosDNSRuleSourceArtifact(tmp, source.SourceType, source.Type)
	if err != nil {
		_ = os.Remove(tmp)
		return source, err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		_ = os.Remove(tmp)
		return source, err
	}
	if err := moveFile(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return source, err
	}
	source.LocalPath = localRel
	source.LastUpdated = time.Now().Format(time.RFC3339)
	source.FileSize = fileSize(dst)
	if ruleCount > 0 {
		source.RuleCount = ruleCount
	} else if count, ok := countRuleFile(dst); ok || source.RuleCount == 0 {
		source.RuleCount = count
	}
	if err := a.replaceMosDNSRuleSource(source); err != nil {
		return source, err
	}
	return source, nil
}

func prepareMosDNSRuleSourceArtifact(path, sourceType, ruleType string) (int, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	if len(b) == 0 {
		return 0, fmt.Errorf("下载的规则文件为空")
	}
	if len(b) >= 3 && bytes.Equal(b[:3], []byte("SRS")) {
		if sourceType != "srs" {
			return 0, fmt.Errorf("下载的广告规则必须是有效文本内容")
		}
		return 0, validateMosDNSSRSArtifact(b)
	}
	if !utf8.Valid(b) || strings.ContainsRune(string(b), '\x00') {
		if sourceType == "srs" {
			return 0, fmt.Errorf("下载的在线分流规则既不是有效 SRS，也不是有效文本")
		}
		return 0, fmt.Errorf("下载的广告规则不是有效文本")
	}
	if sourceType != "srs" {
		return len(splitNonEmptyLines(string(b))), nil
	}
	compiled, count, err := compileMosDNSRoutingTextToSRS(b, ruleType)
	if err != nil {
		return 0, err
	}
	if err := os.WriteFile(path, compiled, 0644); err != nil {
		return 0, fmt.Errorf("写入在线分流 SRS 转换结果失败：%w", err)
	}
	return count, nil
}

func validateMosDNSRuleSourceArtifact(path, sourceType string, ruleTypes ...string) error {
	ruleType := ""
	if len(ruleTypes) > 0 {
		ruleType = ruleTypes[0]
	}
	_, err := prepareMosDNSRuleSourceArtifact(path, sourceType, ruleType)
	return err
}

func compileMosDNSRoutingTextToSRS(b []byte, ruleType string) ([]byte, int, error) {
	lines := splitNonEmptyLines(string(b))
	var fullDomains, suffixDomains, keywords, regexps []string
	var ipRules []string
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if normalizeMosDNSGeositeType(ruleType) == "geoipcn" {
			value := stripMosDNSRuleAttributes(strings.TrimPrefix(line, "ip_cidr:"))
			if strings.ContainsRune(value, '/') {
				if _, err := netip.ParsePrefix(value); err != nil {
					return nil, 0, fmt.Errorf("下载的在线分流文本第 %d 行不是有效 IP/CIDR：%s", i+1, line)
				}
			} else if _, err := netip.ParseAddr(value); err != nil {
				return nil, 0, fmt.Errorf("下载的在线分流文本第 %d 行不是有效 IP/CIDR：%s", i+1, line)
			}
			ipRules = append(ipRules, value)
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 || parts[1] == "" {
			return nil, 0, fmt.Errorf("下载的在线分流文本第 %d 行必须使用 domain/full/keyword/regexp 前缀：%s", i+1, line)
		}
		value := stripMosDNSRuleAttributes(parts[1])
		if value == "" {
			return nil, 0, fmt.Errorf("下载的在线分流文本第 %d 行规则内容为空：%s", i+1, line)
		}
		switch parts[0] {
		case "domain", "full":
			if !validMosDNSRewriteDomain(value) {
				return nil, 0, fmt.Errorf("下载的在线分流文本第 %d 行域名格式无效：%s", i+1, line)
			}
			if parts[0] == "full" {
				fullDomains = append(fullDomains, value)
			} else {
				suffixDomains = append(suffixDomains, value)
			}
		case "keyword":
			keywords = append(keywords, value)
		case "regexp":
			if _, err := regexp.Compile(value); err != nil {
				return nil, 0, fmt.Errorf("下载的在线分流文本第 %d 行正则表达式无效：%s", i+1, line)
			}
			regexps = append(regexps, value)
		default:
			return nil, 0, fmt.Errorf("下载的在线分流文本第 %d 行前缀不受支持：%s", i+1, line)
		}
	}
	count := len(fullDomains) + len(suffixDomains) + len(keywords) + len(regexps) + len(ipRules)
	if count == 0 {
		return nil, 0, fmt.Errorf("下载的在线分流文本不包含有效规则")
	}
	if len(ipRules) > 0 {
		return nil, 0, fmt.Errorf("暂不支持将 IP/CIDR 文本规则转换为 SRS，请使用 SRS 格式的中国 IP 规则源")
	}
	compiled, err := encodeMosDNSDomainSRS(fullDomains, suffixDomains, keywords, regexps)
	if err != nil {
		return nil, 0, fmt.Errorf("将在线分流文本转换为 SRS 失败：%w", err)
	}
	return compiled, count, nil
}

func stripMosDNSRuleAttributes(value string) string {
	if index := strings.Index(value, ":@"); index >= 0 {
		return strings.TrimSpace(value[:index])
	}
	return strings.TrimSpace(value)
}

func encodeMosDNSDomainSRS(fullDomains, suffixDomains, keywords, regexps []string) ([]byte, error) {
	var out bytes.Buffer
	out.WriteString("SRS")
	out.WriteByte(3)
	zw := zlib.NewWriter(&out)
	bw := bufio.NewWriter(zw)
	if _, err := varbin.WriteUvarint(bw, 1); err != nil {
		return nil, err
	}
	if err := bw.WriteByte(0); err != nil {
		return nil, err
	}
	if len(fullDomains)+len(suffixDomains) > 0 {
		if err := bw.WriteByte(2); err != nil {
			return nil, err
		}
		if err := scdomain.NewMatcher(fullDomains, suffixDomains, false).Write(bw); err != nil {
			return nil, err
		}
	}
	for _, section := range []struct {
		item   byte
		values []string
	}{{3, keywords}, {4, regexps}} {
		item, values := section.item, section.values
		if len(values) == 0 {
			continue
		}
		if err := bw.WriteByte(item); err != nil {
			return nil, err
		}
		if err := varbin.Write(bw, binary.BigEndian, values); err != nil {
			return nil, err
		}
	}
	if err := bw.WriteByte(0xFF); err != nil {
		return nil, err
	}
	if err := bw.Flush(); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func validateMosDNSSRSArtifact(b []byte) error {
	if len(b) < 5 || !bytes.Equal(b[:3], []byte("SRS")) || b[3] > 3 {
		return fmt.Errorf("下载的在线分流规则不是有效 SRS 文件")
	}
	zr, err := zlib.NewReader(bytes.NewReader(b[4:]))
	if err != nil {
		return fmt.Errorf("下载的在线分流规则不是有效 SRS 压缩数据：%w", err)
	}
	_, copyErr := io.Copy(io.Discard, zr)
	closeErr := zr.Close()
	if copyErr != nil {
		return fmt.Errorf("下载的在线分流规则损坏：%w", copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("下载的在线分流规则损坏：%w", closeErr)
	}
	return nil
}

func (a *App) filteredMosDNSRuleSources(r *http.Request) []mosDNSRuleSource {
	sources := a.mosDNSRuleSources()
	q := r.URL.Query()
	sourceType := strings.ToLower(strings.TrimSpace(firstNonEmpty(q.Get("source_type"), q.Get("source"))))
	typ := strings.TrimSpace(q.Get("type"))
	keyword := strings.ToLower(strings.TrimSpace(firstNonEmpty(q.Get("q"), q.Get("search"), q.Get("keyword"))))
	enabled := strings.TrimSpace(q.Get("enabled"))
	var out []mosDNSRuleSource
	for _, source := range sources {
		if sourceType != "" && source.SourceType != sourceType {
			continue
		}
		if typ != "" && source.Type != typ {
			continue
		}
		if enabled != "" && ((enabled == "true") != source.Enabled) {
			continue
		}
		if keyword != "" {
			text := strings.ToLower(source.ID + " " + source.Name + " " + source.Type + " " + source.URL + " " + source.Files)
			if !strings.Contains(text, keyword) {
				continue
			}
		}
		out = append(out, source)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].SourceType == out[j].SourceType {
			return out[i].Name < out[j].Name
		}
		return out[i].SourceType < out[j].SourceType
	})
	return out
}

func (a *App) mosDNSRuleSources() []mosDNSRuleSource {
	var out []mosDNSRuleSource
	out = append(out, a.readMosDNSRuleSourcesInDir("configs/mosdns/srs", "srs")...)
	if items, err := a.readMosDNSRuleSourceConfig("configs/mosdns/adguard/config.json", "adguard"); err == nil {
		out = append(out, items...)
	}
	for i := range out {
		out[i].hydrateRuntimeFields()
		if out[i].LocalPath != "" {
			if path, err := a.safePath(out[i].LocalPath); err == nil {
				if info, statErr := os.Stat(path); statErr == nil {
					out[i].FileSize = info.Size()
					// The local rule artifact is the authoritative evidence of when
					// this source was actually installed or refreshed. Template JSON
					// can carry an old build-time last_updated value indefinitely.
					out[i].LastUpdated = info.ModTime().Format(time.RFC3339Nano)
				}
				if count, ok := countRuleFile(path); ok && count > 0 {
					out[i].RuleCount = count
				}
			}
		}
	}
	return out
}

func (a *App) readMosDNSRuleSourcesInDir(rootRel, sourceType string) []mosDNSRuleSource {
	root, err := a.safePath(rootRel)
	if err != nil {
		return nil
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var out []mosDNSRuleSource
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		items, err := a.readMosDNSRuleSourceConfig(filepath.ToSlash(filepath.Join(rootRel, entry.Name())), sourceType)
		if err == nil {
			out = append(out, items...)
		}
	}
	return out
}

func (a *App) readMosDNSRuleSourceConfig(rel, sourceType string) ([]mosDNSRuleSource, error) {
	content, err := a.readTextFile(rel)
	if err != nil {
		if os.IsNotExist(err) {
			return []mosDNSRuleSource{}, nil
		}
		return nil, err
	}
	if strings.TrimSpace(content) == "" {
		return []mosDNSRuleSource{}, nil
	}
	var items []mosDNSRuleSource
	if err := json.Unmarshal([]byte(content), &items); err != nil {
		return nil, err
	}
	for i := range items {
		items[i].SourceType = sourceType
		items[i].ConfigPath = rel
		items[i].hydrateRuntimeFields()
	}
	return items, nil
}

func (a *App) writeMosDNSRuleSourceConfig(rel string, items []mosDNSRuleSource) error {
	for i := range items {
		items[i].SourceType = ""
		items[i].ConfigPath = ""
		items[i].LocalPath = ""
		items[i].FileSize = 0
		if items[i].UpdateIntervalHours <= 0 {
			items[i].UpdateIntervalHours = 24
		}
	}
	b, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		return err
	}
	return a.writeTextFile(rel, string(b)+"\n")
}

func (a *App) findMosDNSRuleSource(id string) (mosDNSRuleSource, bool) {
	id = strings.TrimSpace(id)
	for _, source := range a.mosDNSRuleSources() {
		if source.ID == id || source.Name == id {
			return source, true
		}
	}
	return mosDNSRuleSource{}, false
}

func (a *App) replaceMosDNSRuleSource(source mosDNSRuleSource) error {
	items, err := a.readMosDNSRuleSourceConfig(source.ConfigPath, source.SourceType)
	if err != nil {
		return err
	}
	replaced := false
	for i := range items {
		if items[i].ID == source.ID || items[i].Name == source.Name {
			items[i] = source
			replaced = true
			break
		}
	}
	if !replaced {
		items = append(items, source)
	}
	return a.writeMosDNSRuleSourceConfig(source.ConfigPath, items)
}

func (a *App) mosDNSRuleSourceCount(sourceType string) int {
	total := 0
	for _, source := range a.mosDNSRuleSources() {
		if source.SourceType == sourceType {
			total += source.RuleCount
		}
	}
	return total
}

func (s *mosDNSRuleSource) normalizeForCreate(sourceType string) {
	if s.SourceType == "" {
		s.SourceType = strings.ToLower(strings.TrimSpace(sourceType))
	}
	if s.SourceType == "" {
		if strings.EqualFold(s.Type, "adguard") || strings.HasSuffix(strings.ToLower(s.Files), ".rules") {
			s.SourceType = "adguard"
		} else {
			s.SourceType = "srs"
		}
	}
	if s.Type == "" {
		s.Type = s.SourceType
	}
	if s.Files == "" {
		if s.SourceType == "adguard" {
			id := s.ID
			if id == "" {
				id = randomHex(16)
				s.ID = id
			}
			s.Files = "adguard/" + id + ".rules"
		} else {
			s.Files = "srs/" + safeRuleFileName(s.Name) + ".srs"
		}
	}
	if s.UpdateIntervalHours <= 0 {
		s.UpdateIntervalHours = 24
	}
}

func (s *mosDNSRuleSource) hydrateRuntimeFields() {
	if s.SourceType == "" {
		if strings.Contains(s.ConfigPath, "/adguard/") {
			s.SourceType = "adguard"
		} else {
			s.SourceType = "srs"
		}
	}
	if s.Type == "" && s.SourceType == "adguard" {
		s.Type = "adguard"
	}
	if s.ID == "" {
		s.ID = mosDNSRuleSourceID(*s)
	}
	if s.UpdateIntervalHours <= 0 {
		s.UpdateIntervalHours = 24
	}
	if s.LocalPath == "" {
		s.LocalPath = mosDNSRuleSourceLocalRel(*s)
	}
	s.URL = currentBuiltInMosDNSRuleSourceURL(s.URL)
}

func currentBuiltInMosDNSRuleSourceURL(raw string) string {
	legacy := map[string]string{
		"https://raw.githubusercontent.com/nekolsd/sing-geosite/refs/heads/rule-set/geosite-geolocation-!cn%40cn.srs": "https://raw.githubusercontent.com/Loyalsoldier/domain-list-custom/release/geolocation-cn.txt",
		"https://raw.githubusercontent.com/nekolsd/sing-geosite/refs/heads/rule-set/geolocation-!cn%40cn.srs":         "https://raw.githubusercontent.com/Loyalsoldier/domain-list-custom/release/geolocation-cn.txt",
		"https://raw.githubusercontent.com/nekolsd/sing-geosite/refs/heads/rule-set/geosite-cn%40!cn.srs":             "https://raw.githubusercontent.com/Loyalsoldier/domain-list-custom/release/geolocation-!cn.txt",
		"https://raw.githubusercontent.com/nekolsd/sing-geosite/refs/heads/rule-set/cn%40!cn.srs":                     "https://raw.githubusercontent.com/Loyalsoldier/domain-list-custom/release/geolocation-!cn.txt",
		"https://raw.githubusercontent.com/nekolsd/sing-geosite/refs/heads/rule-set/geosite-tiktok.srs":               "https://raw.githubusercontent.com/nekolsd/sing-geosite/refs/heads/rule-set/tiktok.srs",
	}
	if current := legacy[strings.TrimSpace(raw)]; current != "" {
		return current
	}
	return raw
}

func mosDNSRuleSourceID(s mosDNSRuleSource) string {
	sourceType := nonEmpty(s.SourceType, "srs")
	typ := nonEmpty(s.Type, sourceType)
	name := nonEmpty(s.Name, filepath.Base(s.Files))
	return sourceType + ":" + typ + ":" + safeRuleFileName(name)
}

func mosDNSRuleSourceConfigRel(s mosDNSRuleSource) string {
	if s.ConfigPath != "" {
		return s.ConfigPath
	}
	if s.SourceType == "adguard" {
		return "configs/mosdns/adguard/config.json"
	}
	typ := nonEmpty(s.Type, "custom")
	return filepath.ToSlash(filepath.Join("configs/mosdns/srs", safeRuleFileName(typ)+".json"))
}

func mosDNSRuleSourceLocalRel(s mosDNSRuleSource) string {
	files := filepath.ToSlash(strings.TrimSpace(s.Files))
	files = strings.TrimPrefix(files, "/")
	if files == "" && s.SourceType == "adguard" && s.ID != "" {
		files = filepath.ToSlash(filepath.Join("adguard", s.ID+".rules"))
	}
	if files == "" {
		files = filepath.ToSlash(filepath.Join(s.SourceType, safeRuleFileName(s.Name)+".txt"))
	}
	if strings.HasPrefix(files, "configs/") {
		return files
	}
	if strings.HasPrefix(files, "mosdns/") {
		return "configs/" + files
	}
	return filepath.ToSlash(filepath.Join("configs/mosdns", files))
}

func safeRuleFileName(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "/", "_")
	value = strings.ReplaceAll(value, "\\", "_")
	value = strings.ReplaceAll(value, ":", "_")
	value = strings.ReplaceAll(value, " ", "_")
	if value == "" || value == "." || value == ".." {
		return "custom"
	}
	return value
}

func moveFile(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Remove(src)
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

func countRuleFile(path string) (int, bool) {
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		return 0, err == nil
	}
	if !utf8.Valid(b) || strings.ContainsRune(string(b), '\x00') {
		return 0, false
	}
	return len(splitNonEmptyLines(string(b))), true
}
