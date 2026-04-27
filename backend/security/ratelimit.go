package security

import (
	"sync"
	"time"
)

type limiterWindow struct {
	start time.Time
	count int
}

// FixedWindowLimiter implements a simple in-memory fixed-window rate limiter.
type FixedWindowLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	entries map[string]limiterWindow
}

func NewFixedWindowLimiter(limit int, window time.Duration) *FixedWindowLimiter {
	return &FixedWindowLimiter{
		limit:   limit,
		window:  window,
		entries: map[string]limiterWindow{},
	}
}

func (l *FixedWindowLimiter) Allow(key string) bool {
	if l == nil || l.limit <= 0 || l.window <= 0 || key == "" {
		return true
	}

	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	for existingKey, entry := range l.entries {
		if now.Sub(entry.start) >= l.window {
			delete(l.entries, existingKey)
		}
	}

	entry, exists := l.entries[key]
	if !exists || now.Sub(entry.start) >= l.window {
		l.entries[key] = limiterWindow{start: now, count: 1}
		return true
	}

	if entry.count >= l.limit {
		return false
	}

	entry.count++
	l.entries[key] = entry
	return true
}
