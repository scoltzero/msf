package server

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"
)

type resetPhase string

const (
	resetPhaseIdle               resetPhase = "idle"
	resetPhaseRequested          resetPhase = "reset_requested"
	resetPhaseStoppingOperations resetPhase = "stopping_operations"
	resetPhaseRestarting         resetPhase = "restarting"
	resetPhaseRunning            resetPhase = "resetting"
	resetPhaseFailed             resetPhase = "reset_failed"
)

var errFactoryResetRequested = fmt.Errorf("factory reset requested")

type activeOperation struct {
	ID        string
	Method    string
	Path      string
	StartedAt time.Time
	cancel    context.CancelCauseFunc
}

type operationController struct {
	mu         sync.Mutex
	phase      resetPhase
	resetID    string
	operations map[string]activeOperation
	changed    chan struct{}
}

func newOperationController() *operationController {
	return &operationController{
		phase:      resetPhaseIdle,
		operations: map[string]activeOperation{},
		changed:    make(chan struct{}),
	}
}

func (c *operationController) begin(r *http.Request) (*http.Request, func(), bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.phase != resetPhaseIdle {
		return r, func() {}, false
	}
	id := fmt.Sprintf("op-%d-%s", time.Now().UnixNano(), randomHex(4))
	ctx, cancel := context.WithCancelCause(r.Context())
	c.operations[id] = activeOperation{
		ID:        id,
		Method:    r.Method,
		Path:      r.URL.Path,
		StartedAt: time.Now(),
		cancel:    cancel,
	}
	return r.WithContext(ctx), func() { c.finish(id) }, true
}

func (c *operationController) finish(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.operations[id]; !ok {
		return
	}
	delete(c.operations, id)
	c.signalChangedLocked()
}

func (c *operationController) requestReset(resetID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.phase != resetPhaseIdle {
		return false
	}
	c.phase = resetPhaseRequested
	c.resetID = resetID
	return true
}

func (c *operationController) retryFailedReset(resetID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.phase != resetPhaseFailed {
		return false
	}
	c.phase = resetPhaseRequested
	c.resetID = resetID
	return true
}

func (c *operationController) cancelOperations() []activeOperation {
	c.mu.Lock()
	c.phase = resetPhaseStoppingOperations
	operations := make([]activeOperation, 0, len(c.operations))
	for _, operation := range c.operations {
		operations = append(operations, operation)
	}
	c.mu.Unlock()
	for _, operation := range operations {
		operation.cancel(errFactoryResetRequested)
	}
	return operations
}

func (c *operationController) waitForDrain(ctx context.Context) []activeOperation {
	for {
		c.mu.Lock()
		if len(c.operations) == 0 {
			c.mu.Unlock()
			return nil
		}
		changed := c.changed
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return c.active()
		case <-changed:
		}
	}
}

func (c *operationController) active() []activeOperation {
	c.mu.Lock()
	defer c.mu.Unlock()
	operations := make([]activeOperation, 0, len(c.operations))
	for _, operation := range c.operations {
		operations = append(operations, operation)
	}
	sort.Slice(operations, func(i, j int) bool { return operations[i].StartedAt.Before(operations[j].StartedAt) })
	return operations
}

func (c *operationController) setPhase(phase resetPhase) {
	c.mu.Lock()
	c.phase = phase
	c.mu.Unlock()
}

func (c *operationController) status() (resetPhase, string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.phase, c.resetID
}

func (c *operationController) signalChangedLocked() {
	close(c.changed)
	c.changed = make(chan struct{})
}
