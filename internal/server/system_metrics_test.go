package server

import (
	"math"
	"runtime"
	"testing"
)

func TestNormalizeProcessCPUPercentUsesLogicalCPUCapacity(t *testing.T) {
	capacity := runtime.NumCPU()
	if capacity < 1 {
		capacity = 1
	}
	raw := float64(capacity) * 87.5
	got := normalizeProcessCPUPercent(raw)
	if math.Abs(got-87.5) > 0.001 {
		t.Fatalf("normalized cpu = %.3f, want 87.5", got)
	}
}

func TestNormalizeProcessCPUPercentClampsInvalidValues(t *testing.T) {
	capacity := runtime.NumCPU()
	if capacity < 1 {
		capacity = 1
	}
	tests := []struct {
		name string
		raw  float64
		want float64
	}{
		{name: "negative", raw: -1, want: 0},
		{name: "nan", raw: math.NaN(), want: 0},
		{name: "infinity", raw: math.Inf(1), want: 0},
		{name: "over capacity", raw: float64(capacity) * 350, want: 100},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeProcessCPUPercent(tt.raw); got != tt.want {
				t.Fatalf("normalized cpu = %.3f, want %.3f", got, tt.want)
			}
		})
	}
}
