package server

import "testing"

func TestParseIPIPExitText(t *testing.T) {
	info, err := parseIPIPExitText("当前 IP：121.231.226.241  来自于：中国 江苏 常州  电信")
	if err != nil {
		t.Fatalf("parseIPIPExitText returned error: %v", err)
	}
	if info["ip"] != "121.231.226.241" {
		t.Fatalf("ip mismatch: %#v", info)
	}
	if info["location"] != "中国 江苏 常州 电信" {
		t.Fatalf("location mismatch: %#v", info)
	}
	if info["country"] != "中国" || info["province"] != "江苏" || info["city"] != "常州" || info["isp"] != "电信" {
		t.Fatalf("location parts mismatch: %#v", info)
	}
}

func TestNormalizeInternationalExit(t *testing.T) {
	info := normalizeInternationalExit(map[string]any{
		"ip":           "198.51.100.10",
		"country":      "Exampleland",
		"region":       "Example Region",
		"city":         "Example City",
		"organization": "Example Transit",
	})
	if info["ip"] != "198.51.100.10" {
		t.Fatalf("ip mismatch: %#v", info)
	}
	if info["location"] != "Exampleland Example Transit" {
		t.Fatalf("location mismatch: %#v", info)
	}
	if info["region"] != "Example Region" || info["city"] != "Example City" || info["isp"] != "Example Transit" {
		t.Fatalf("metadata mismatch: %#v", info)
	}
}

func TestNormalizeInternationalExitUsesCarrierWhenAvailable(t *testing.T) {
	info := normalizeInternationalExit(map[string]any{
		"ip":               "121.231.226.241",
		"country":          "China",
		"isp":              "China Telecom",
		"asn_organization": "CHINATELECOM Jiangsu province Changzhou 5G network",
	})
	if info["location"] != "China China Telecom" {
		t.Fatalf("location should prefer carrier: %#v", info)
	}
}
