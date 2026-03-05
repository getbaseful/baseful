package proxy

import (
	"sync"
	"time"
)

// revokedTokens stores tokens that have been revoked
// This is a simple in-memory cache - in production, use Redis
var (
	revokedTokens   = make(map[string]time.Time)
	revokedTokensMu = sync.RWMutex{}
)

// TokenRevocationEntry represents a revoked token record
type TokenRevocationEntry struct {
	TokenID   string     `json:"token_id"`
	RevokedAt time.Time  `json:"revoked_at"`
	RevokedBy string     `json:"revoked_by,omitempty"`
	Reason    string     `json:"reason,omitempty"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}

// RevocationStore manages token revocation in memory
type RevocationStore struct {
	mu     sync.RWMutex
	tokens map[string]TokenRevocationEntry
}

// NewRevocationStore creates a new revocation store
func NewRevocationStore() *RevocationStore {
	return &RevocationStore{
		tokens: make(map[string]TokenRevocationEntry),
	}
}

// Revoke marks a token as revoked
func (s *RevocationStore) Revoke(tokenID, revokedBy, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.tokens[tokenID] = TokenRevocationEntry{
		TokenID:   tokenID,
		RevokedAt: time.Now(),
		RevokedBy: revokedBy,
		Reason:    reason,
	}
}

// IsRevoked checks if a token has been revoked
func (s *RevocationStore) IsRevoked(tokenID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entry, exists := s.tokens[tokenID]
	if !exists {
		return false
	}

	// Check if entry has expired (cleanup after 24 hours)
	if time.Since(entry.RevokedAt) > 24*time.Hour {
		delete(s.tokens, tokenID)
		return false
	}

	return true
}

// GetRevocationEntry returns the revocation entry for a token
func (s *RevocationStore) GetRevocationEntry(tokenID string) (TokenRevocationEntry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entry, exists := s.tokens[tokenID]
	return entry, exists
}

// Unrevoke removes a token from the revocation list
func (s *RevocationStore) Unrevoke(tokenID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.tokens[tokenID]; exists {
		delete(s.tokens, tokenID)
		return true
	}
	return false
}

// Cleanup removes expired revocation entries
func (s *RevocationStore) Cleanup(maxAge time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cutoff := time.Now().Add(-maxAge)
	for tokenID, entry := range s.tokens {
		if entry.RevokedAt.Before(cutoff) {
			delete(s.tokens, tokenID)
		}
	}
}

// GetAllRevokedTokens returns all currently revoked tokens
func (s *RevocationStore) GetAllRevokedTokens() []TokenRevocationEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]TokenRevocationEntry, 0, len(s.tokens))
	for _, entry := range s.tokens {
		result = append(result, entry)
	}
	return result
}

// Count returns the number of revoked tokens
func (s *RevocationStore) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.tokens)
}

// Global revocation store instance
var globalRevocationStore *RevocationStore

// InitRevocationStore initializes the global revocation store
func InitRevocationStore() {
	globalRevocationStore = NewRevocationStore()
}

// GetRevocationStore returns the global revocation store
func GetRevocationStore() *RevocationStore {
	if globalRevocationStore == nil {
		globalRevocationStore = NewRevocationStore()
	}
	return globalRevocationStore
}

// RevokeToken marks a token as revoked globally
func RevokeToken(tokenID string) {
	GetRevocationStore().Revoke(tokenID, "system", "revoked via API")
}

// IsTokenRevoked checks if a token is revoked globally
func IsTokenRevoked(tokenID string) bool {
	return GetRevocationStore().IsRevoked(tokenID)
}

// UnrevokeToken removes a token from the revocation list globally
func UnrevokeToken(tokenID string) bool {
	return GetRevocationStore().Unrevoke(tokenID)
}

// BatchRevokeTokens revokes multiple tokens at once
func BatchRevokeTokens(tokenIDs []string, revokedBy, reason string) {
	store := GetRevocationStore()
	for _, tokenID := range tokenIDs {
		store.Revoke(tokenID, revokedBy, reason)
	}
}
