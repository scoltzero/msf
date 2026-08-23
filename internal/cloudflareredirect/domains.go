package cloudflareredirect

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

func LoadDomains(ctx context.Context, cfg Config) ([]string, []string) {
	var warnings []string
	seen := map[string]bool{}
	var out []string
	add := func(line string) {
		rule := normalizeDomainRule(line)
		if rule == "" || seen[rule] {
			return
		}
		seen[rule] = true
		out = append(out, rule)
	}
	for _, line := range cfg.Rules.Manual {
		add(line)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	for _, sub := range cfg.Rules.Subscriptions {
		if !sub.Enabled || strings.TrimSpace(sub.URL) == "" {
			continue
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, sub.URL, nil)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: %v", sub.Name, err))
			continue
		}
		resp, err := client.Do(req)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: %v", sub.Name, err))
			continue
		}
		func() {
			defer resp.Body.Close()
			if resp.StatusCode < 200 || resp.StatusCode >= 300 {
				warnings = append(warnings, fmt.Sprintf("%s: http %d", sub.Name, resp.StatusCode))
				return
			}
			parseDomainLines(resp.Body, add)
		}()
	}
	return out, warnings
}

func parseDomainLines(r io.Reader, add func(string)) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		add(scanner.Text())
	}
}

func normalizeDomainRule(line string) string {
	line = stripInlineComment(strings.TrimSpace(line))
	if line == "" {
		return ""
	}
	line = strings.Trim(line, `"'`)
	if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "//") {
		return ""
	}
	upper := strings.ToUpper(line)
	switch {
	case strings.HasPrefix(upper, "DOMAIN-SUFFIX,"):
		return "domain:" + cleanDomainAfterComma(line)
	case strings.HasPrefix(upper, "DOMAIN,"):
		return "full:" + cleanDomainAfterComma(line)
	case strings.HasPrefix(upper, "DOMAIN-KEYWORD,"):
		return "keyword:" + cleanDomainAfterComma(line)
	case strings.HasPrefix(upper, "DOMAIN-REGEX,"):
		return "regexp:" + cleanDomainAfterComma(line)
	}
	lower := strings.ToLower(line)
	for _, prefix := range []string{"domain:", "full:", "keyword:", "regexp:"} {
		if strings.HasPrefix(lower, prefix) {
			value := strings.TrimSpace(line[len(prefix):])
			if value == "" {
				return ""
			}
			return prefix + strings.TrimSuffix(value, ".")
		}
	}
	if strings.Contains(line, " ") || strings.Contains(line, "\t") {
		return ""
	}
	if strings.Contains(line, "/") || net.ParseIP(line) != nil {
		return ""
	}
	return "domain:" + strings.TrimSuffix(line, ".")
}

func cleanDomainAfterComma(line string) string {
	parts := strings.SplitN(line, ",", 2)
	if len(parts) != 2 {
		return ""
	}
	value := strings.TrimSpace(parts[1])
	if idx := strings.Index(value, ","); idx >= 0 {
		value = value[:idx]
	}
	return strings.TrimSuffix(value, ".")
}

func stripInlineComment(line string) string {
	if idx := strings.Index(line, "#"); idx >= 0 {
		line = line[:idx]
	}
	return strings.TrimSpace(line)
}
