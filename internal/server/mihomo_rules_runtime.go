package server

// Runtime rule and rule-provider operations.  This adapter intentionally keeps
// the browser-facing API independent from Mihomo controller path details and
// never treats a failed controller operation as a successful empty snapshot.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

var errMihomoRuleToggleUnsupported = errors.New("mihomo rule toggle unsupported")

type mihomoRulePatchResult struct {
	Data        map[string]any
	Unsupported bool
	ErrorCode   string
	Message     string
}

// handleMihomoRulePatch is deliberately defined outside handlers_mihomo.go so
// route registration can be added independently of the legacy handler table.
// Parent wiring should register PATCH /api/v1/mihomo/rules/{id} here.
func (a *App) handleMihomoRulePatch(w http.ResponseWriter, r *http.Request) {
	id := firstNonEmpty(r.PathValue("id"), r.PathValue("uuid"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "rule id required")
		return
	}
	var request map[string]any
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	disabled, exists := boolField(request, "disabled")
	if !exists {
		writeError(w, http.StatusBadRequest, "bad_request", "disabled must be a boolean")
		return
	}
	disconnect := boolFieldDefault(request, false, "disconnect_matched", "disconnectMatched")
	uuid := firstNonEmpty(stringMapValue(request, "uuid"), stringMapValue(request, "rule_uuid"), stringMapValue(request, "ruleUUID"))
	index := intAny(request["index"], -1)
	typ := firstNonEmpty(stringMapValue(request, "type"), stringMapValue(request, "rule_type"), stringMapValue(request, "ruleType"))
	payload := firstNonEmpty(stringMapValue(request, "payload"), stringMapValue(request, "rule_payload"), stringMapValue(request, "rulePayload"))
	result, err := a.patchMihomoRuleRuntime(r.Context(), id, uuid, index, disabled, disconnect, typ, payload)
	if err != nil {
		code := result.ErrorCode
		if code == "" {
			code = "controller_unavailable"
		}
		status := http.StatusBadGateway
		if result.Unsupported {
			status = http.StatusNotImplemented
		}
		writeJSON(w, status, map[string]any{"success": false, "error": code, "message": err.Error(), "data": result.Data})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result.Data})
}

// patchMihomoRuleRuntime applies only the requested runtime state.  It never
// mutates YAML.  When disconnectMatched is false (the default), no
// /connections request is made at all.
func (a *App) patchMihomoRuleRuntime(ctx context.Context, id, uuid string, index int, disabled, disconnectMatched bool, ruleType, payload string) (mihomoRulePatchResult, error) {
	_ = ctx // controller adapter owns its bounded request timeout
	if strings.TrimSpace(id) == "" {
		return mihomoRulePatchResult{ErrorCode: "bad_request"}, errors.New("rule id required")
	}
	if id == "." || id == ".." || strings.IndexByte(id, 0) >= 0 {
		return mihomoRulePatchResult{ErrorCode: "bad_request"}, errors.New("invalid rule id")
	}
	// A disabled rule may disappear from the controller's active /rules list.
	// Resolve its exact identity before PATCH when the caller requested
	// connection cleanup but did not provide type/payload.  The default path
	// (disconnectMatched=false) deliberately performs no /rules read.
	var identityErr error
	if disconnectMatched && (strings.TrimSpace(ruleType) == "" || payload == "") {
		var resolvedType, resolvedPayload string
		resolvedType, resolvedPayload, identityErr = a.findMihomoRuleIdentity(id)
		if identityErr == nil {
			ruleType, payload = resolvedType, resolvedPayload
		}
	}
	method := http.MethodPatch
	path := "/rules/" + url.PathEscape(id)
	bodyPayload := map[string]any{"disabled": disabled}
	if strings.TrimSpace(uuid) != "" {
		// Zashboard/Meta toggles UUID rules with an empty PUT request.
		method = http.MethodPut
		path = "/rules/" + url.PathEscape(uuid)
		bodyPayload = nil
	} else if index >= 0 {
		// Controllers without UUID support use the zero-based rule index map.
		// Keep the JSON key as a decimal string, matching Zashboard exactly.
		path = "/rules/disable"
		bodyPayload = map[string]any{fmt.Sprintf("%d", index): disabled}
	}
	var body []byte
	var err error
	if bodyPayload != nil {
		body, err = json.Marshal(bodyPayload)
	}
	if err != nil {
		return mihomoRulePatchResult{ErrorCode: "bad_request"}, err
	}
	raw, ok, requestErr := a.mihomoControllerJSON(method, path, body)
	if !ok {
		if mihomoRuleToggleUnsupportedError(requestErr) {
			return mihomoRulePatchResult{
				Unsupported: true,
				ErrorCode:   "rule_toggle_unsupported",
				Data:        map[string]any{"id": id, "disabled": disabled, "capability": "rule_toggle", "supported": false},
			}, errMihomoRuleToggleUnsupported
		}
		return mihomoRulePatchResult{ErrorCode: "controller_unavailable", Data: map[string]any{"id": id, "disabled": disabled}}, requestErr
	}

	actualDisabled := disabled
	if value, found := mihomoDisabledFromAny(raw); found {
		actualDisabled = value
	}
	data := map[string]any{
		"id":        id,
		"disabled":  actualDisabled,
		"requested": disabled,
		"supported": true,
		"raw":       raw,
	}
	if disconnectMatched {
		if identityErr != nil {
			data["disconnect"] = map[string]any{
				"matched":           0,
				"closed":            0,
				"failed_ids":        []string{},
				"available":         false,
				"error":             "rule_identity_unavailable",
				"message":           identityErr.Error(),
				"using_stale_cache": false,
			}
			return mihomoRulePatchResult{Data: data}, nil
		}
		disconnect := a.disconnectMihomoRuleConnections(ruleType, payload)
		data["disconnect"] = disconnect
	}
	return mihomoRulePatchResult{Data: data}, nil
}

func (a *App) findMihomoRuleIdentity(id string) (string, string, error) {
	raw, ok := a.mihomoControllerMap("/rules")
	if !ok {
		return "", "", errors.New("mihomo controller unavailable while resolving rule identity")
	}
	for position, value := range mihomoRulesFromControllerRaw(raw) {
		item, itemOK := value.(map[string]any)
		if !itemOK {
			continue
		}
		normalized := normalizeMihomoRuleMap(item, position)
		if stringMapValue(normalized, "id") == id || stringMapValue(normalized, "uuid") == id {
			return stringMapValue(normalized, "type"), stringMapValue(normalized, "payload"), nil
		}
	}
	return "", "", fmt.Errorf("rule %q not found", id)
}

func (a *App) disconnectMihomoRuleConnections(ruleType, payload string) map[string]any {
	result := map[string]any{
		"matched":    0,
		"closed":     0,
		"failed_ids": []string{},
		"available":  false,
		"rule_type":  ruleType,
		"payload":    payload,
	}
	raw, ok, err := a.mihomoControllerJSON(http.MethodGet, "/connections", nil)
	if !ok {
		result["error"] = "controller_unavailable"
		result["message"] = errString(err, "mihomo controller unavailable")
		return result
	}
	result["available"] = true
	failed := []string{}
	matched, closed := 0, 0
	for index, connection := range mihomoConnectionMaps(raw) {
		connectionType, connectionPayload := mihomoConnectionRuleIdentity(connection)
		// This comparison intentionally remains exact and case-sensitive.  A
		// fuzzy match could close unrelated live connections.
		if connectionType != ruleType || connectionPayload != payload {
			continue
		}
		matched++
		id := strings.TrimSpace(stringMapValue(connection, "id"))
		if id == "" || id == "." || id == ".." || strings.IndexByte(id, 0) >= 0 {
			failed = append(failed, fmt.Sprintf("connection-%d", index+1))
			continue
		}
		_, closedOK, closeErr := a.mihomoControllerJSON(http.MethodDelete, "/connections/"+url.PathEscape(id), nil)
		if closedOK {
			closed++
		} else {
			failed = append(failed, id)
			if closeErr != nil {
				// Keep processing other exact matches.  A partial close failure is
				// reported; it never triggers a close-all fallback.
				_ = closeErr
			}
		}
	}
	result["matched"] = matched
	result["closed"] = closed
	result["failed_ids"] = failed
	return result
}

func mihomoConnectionRuleIdentity(connection map[string]any) (string, string) {
	if connection == nil {
		return "", ""
	}
	typ := firstNonEmpty(
		stringMapValue(connection, "ruleType"), stringMapValue(connection, "rule_type"),
		stringMapValue(connection, "rule"),
	)
	payload := firstNonEmpty(
		stringMapValue(connection, "rulePayload"), stringMapValue(connection, "rule_payload"),
		stringMapValue(connection, "payload"),
	)
	if nested, ok := connection["rule"].(map[string]any); ok {
		typ = firstNonEmpty(typ, stringMapValue(nested, "type"), stringMapValue(nested, "ruleType"))
		payload = firstNonEmpty(payload, stringMapValue(nested, "payload"), stringMapValue(nested, "rulePayload"))
	}
	return typ, payload
}

func mihomoRuleToggleUnsupportedError(err error) bool {
	if err == nil {
		return false
	}
	switch mihomoHTTPStatus(err) {
	case http.StatusNotFound, http.StatusMethodNotAllowed, http.StatusNotImplemented:
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unsupported") || strings.Contains(message, "not implemented") || strings.Contains(message, "method not allowed")
}

func mihomoDisabledFromAny(raw any) (bool, bool) {
	item, ok := raw.(map[string]any)
	if !ok {
		return false, false
	}
	for _, key := range []string{"disabled", "isDisabled", "is_disabled"} {
		if value, exists := item[key]; exists {
			return boolAny(value, false), true
		}
	}
	for _, key := range []string{"rule", "data", "item"} {
		if nested, exists := item[key]; exists {
			if value, found := mihomoDisabledFromAny(nested); found {
				return value, true
			}
		}
	}
	return false, false
}

func boolField(m map[string]any, key string) (bool, bool) {
	if m == nil {
		return false, false
	}
	value, exists := m[key]
	if !exists {
		return false, false
	}
	switch parsed := value.(type) {
	case bool:
		return parsed, true
	case string:
		value, err := strconvParseBool(parsed)
		return value, err == nil
	default:
		return false, false
	}
}

func boolFieldDefault(m map[string]any, fallback bool, keys ...string) bool {
	for _, key := range keys {
		if value, ok := boolField(m, key); ok {
			return value
		}
	}
	return fallback
}

// Kept as a tiny wrapper so malformed JSON boolean strings cannot accidentally
// turn into a truthy value through fmt.Sprint.
func strconvParseBool(value string) (bool, error) {
	value = strings.TrimSpace(value)
	switch strings.ToLower(value) {
	case "true":
		return true, nil
	case "false":
		return false, nil
	default:
		return false, fmt.Errorf("invalid boolean %q", value)
	}
}

type mihomoRuleProviderUpdateResult struct {
	Success     bool
	Unsupported bool
	ErrorCode   string
	Message     string
	Data        map[string]any
}

func (a *App) updateMihomoRuleProviderRuntime(name string) mihomoRuleProviderUpdateResult {
	if err := validateMihomoProviderName(name); err != nil {
		return mihomoRuleProviderUpdateResult{ErrorCode: "bad_request", Message: err.Error(), Data: map[string]any{"name": name, "updated": false}}
	}
	path := "/providers/rules/" + url.PathEscape(name)
	raw, ok, err := a.mihomoControllerJSON(http.MethodPut, path, nil)
	if !ok {
		return a.mihomoRuleProviderUpdateFailure(name, err)
	}
	// Mihomo commonly acknowledges with an empty 204 body.  Re-read this
	// provider and validate that snapshot before reporting success, preserving
	// the previous cache if the response is missing or malformed.
	updated, readOK, readErr := a.mihomoControllerJSON(http.MethodGet, path, nil)
	if !readOK || !validMihomoRuleProviderRuntime(updated) {
		if readErr == nil && !validMihomoRuleProviderRuntime(raw) {
			readErr = errors.New("mihomo rule provider update returned empty or invalid runtime data")
		}
		if readErr == nil {
			readErr = errors.New("mihomo rule provider runtime snapshot invalid")
		}
		return a.mihomoRuleProviderUpdateFailure(name, readErr)
	}
	item := a.mihomoRuleProviderItem(name)
	if item == nil {
		item = map[string]any{"name": name, "provider_type": "rule"}
	}
	runtime := unwrapMihomoProviderRuntime(updated)
	item["runtime"] = runtime
	mergeMihomoProviderRuntimeFields(item, runtime)
	item["source"] = "config+controller"
	item["updated"] = true
	item["using_stale_cache"] = false
	item["last_update_error"] = ""
	clearMihomoRuleProviderRuntimeState(a, name)
	return mihomoRuleProviderUpdateResult{Success: true, Data: item}
}

func validMihomoRuleProviderRuntime(raw any) bool {
	item := unwrapMihomoProviderRuntime(raw)
	if len(item) == 0 {
		return false
	}
	if len(item) == 1 {
		if _, onlyOK := item["ok"]; onlyOK {
			return false
		}
	}
	for _, key := range []string{"name", "vehicleType", "vehicle_type", "type", "rules", "ruleCount", "rule_count", "size", "updatedAt", "updated_at"} {
		if _, exists := item[key]; exists {
			return true
		}
	}
	return false
}

func unwrapMihomoProviderRuntime(raw any) map[string]any {
	item, _ := raw.(map[string]any)
	if item == nil {
		return nil
	}
	for _, key := range []string{"data", "provider", "item"} {
		if nested, ok := item[key].(map[string]any); ok && len(nested) > 0 {
			return nested
		}
	}
	return item
}

func (a *App) mihomoRuleProviderItem(name string) map[string]any {
	payload := a.mihomoRuleProvidersPayload()
	for _, item := range anyMapSlice(payload["items"]) {
		if stringMapValue(item, "name") == name {
			copy := map[string]any{}
			for key, value := range item {
				copy[key] = value
			}
			return copy
		}
	}
	return nil
}

type mihomoRuleProviderRuntimeState struct {
	Error   string
	Message string
}

var mihomoRuleProviderRuntimeStates sync.Map // map[string]mihomoRuleProviderRuntimeState

func mihomoRuleProviderRuntimeStateKey(a *App, name string) string {
	return fmt.Sprintf("%p:%s", a, name)
}

func (a *App) mihomoRuleProviderUpdateFailure(name string, err error) mihomoRuleProviderUpdateResult {
	message := errString(err, "mihomo controller unavailable")
	mihomoRuleProviderRuntimeStates.Store(mihomoRuleProviderRuntimeStateKey(a, name), mihomoRuleProviderRuntimeState{Error: "provider_update_failed", Message: message})
	item := a.mihomoRuleProviderItem(name)
	if item == nil {
		item = map[string]any{"name": name, "provider_type": "rule"}
	}
	item["updated"] = false
	item["using_stale_cache"] = true
	item["last_update_error"] = message
	item["stale_cache"] = true
	return mihomoRuleProviderUpdateResult{ErrorCode: "provider_update_failed", Message: message, Data: item}
}

func clearMihomoRuleProviderRuntimeState(a *App, name string) {
	mihomoRuleProviderRuntimeStates.Delete(mihomoRuleProviderRuntimeStateKey(a, name))
}

func validateMihomoProviderName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("provider name required")
	}
	if name == "." || name == ".." || strings.IndexByte(name, 0) >= 0 {
		return errors.New("invalid provider name")
	}
	escaped := url.PathEscape(name)
	if escaped == "" {
		return errors.New("invalid provider name")
	}
	return nil
}
