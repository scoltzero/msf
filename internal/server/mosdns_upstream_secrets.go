package server

import (
	"fmt"
	"strings"
)

const mosDNSAccessKeySecretSetField = "access_key_secret_set"

// redactMosDNSUpstreamSecrets returns API-safe data without exposing saved secrets.
func redactMosDNSUpstreamSecrets(raw any) any {
	root, ok := raw.(map[string]any)
	if !ok {
		return raw
	}
	out := make(map[string]any, len(root))
	for group, value := range root {
		items, ok := value.([]any)
		if !ok {
			out[group] = value
			continue
		}
		redacted := make([]any, 0, len(items))
		for _, value := range items {
			item, ok := value.(map[string]any)
			if !ok {
				redacted = append(redacted, value)
				continue
			}
			copy := cloneMosDNSUpstreamMap(item)
			secret := strings.TrimSpace(fmtAny(copy["access_key_secret"]))
			delete(copy, "access_key_secret")
			copy[mosDNSAccessKeySecretSetField] = secret != ""
			redacted = append(redacted, copy)
		}
		out[group] = redacted
	}
	return out
}

// mergeMosDNSUpstreamSecrets preserves a saved secret when the editor sends the
// redacted access_key_secret_set marker and leaves access_key_secret empty.
func mergeMosDNSUpstreamSecrets(next, previous any) (any, error) {
	root, ok := next.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("mosdns upstream overrides must be an object")
	}
	previousRoot, _ := previous.(map[string]any)
	merged := make(map[string]any, len(root))
	for group, value := range root {
		items, ok := value.([]any)
		if !ok {
			return nil, fmt.Errorf("mosdns upstream group %s must be an array", group)
		}
		oldItems, _ := previousRoot[group].([]any)
		result := make([]any, 0, len(items))
		for index, value := range items {
			item, ok := value.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("mosdns upstream group %s contains an invalid item", group)
			}
			copy := cloneMosDNSUpstreamMap(item)
			secret, hasSecret := copy["access_key_secret"]
			preserve := isTruthy(fmtAny(copy[mosDNSAccessKeySecretSetField])) && (!hasSecret || strings.TrimSpace(fmtAny(secret)) == "")
			delete(copy, mosDNSAccessKeySecretSetField)
			if preserve {
				if old := matchingMosDNSUpstream(oldItems, index, fmtAny(copy["tag"])); old != nil {
					if secret := strings.TrimSpace(fmtAny(old["access_key_secret"])); secret != "" {
						copy["access_key_secret"] = secret
					}
				}
			}
			result = append(result, copy)
		}
		merged[group] = result
	}
	return merged, nil
}

func matchingMosDNSUpstream(items []any, index int, tag string) map[string]any {
	if index >= 0 && index < len(items) {
		item, _ := items[index].(map[string]any)
		if item != nil && (tag == "" || fmtAny(item["tag"]) == tag) {
			return item
		}
	}
	for _, value := range items {
		item, ok := value.(map[string]any)
		if ok && tag != "" && fmtAny(item["tag"]) == tag {
			return item
		}
	}
	return nil
}

func cloneMosDNSUpstreamMap(value map[string]any) map[string]any {
	out := make(map[string]any, len(value))
	for key, field := range value {
		out[key] = field
	}
	return out
}
