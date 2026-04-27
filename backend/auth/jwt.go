package auth

import (
	"baseful/db"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const defaultProxyTokenTTL = 90 * 24 * time.Hour

var (
	fallbackSecretsMu sync.Mutex
	fallbackSecrets   = map[string]string{}
)

// JWTClaims represents the claims in the JWT token
type JWTClaims struct {
	DatabaseID int    `json:"database_id,omitempty"`
	UserID     int    `json:"user_id,omitempty"`
	Email      string `json:"email,omitempty"`
	IsAdmin    bool   `json:"is_admin,omitempty"`
	TokenID    string `json:"token_id,omitempty"`
	Purpose    string `json:"purpose"` // "db_proxy" or "user_session"
	Type       string `json:"type"`    // Legacy field, mapping to Purpose
	jwt.RegisteredClaims
}

// TokenRecord represents a stored token in the database
type TokenRecord struct {
	ID         int
	DatabaseID int
	TokenID    string
	TokenHash  string
	ExpiresAt  time.Time
	CreatedAt  time.Time
	Revoked    bool
}

func getConfiguredSecret(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func getFallbackSecret(cacheKey string) string {
	fallbackSecretsMu.Lock()
	defer fallbackSecretsMu.Unlock()

	if secret := fallbackSecrets[cacheKey]; secret != "" {
		return secret
	}

	b := make([]byte, 32)
	_, _ = rand.Read(b)
	secret := hex.EncodeToString(b)
	fallbackSecrets[cacheKey] = secret
	fmt.Printf("Warning: %s not set, generated process-local fallback secret\n", cacheKey)
	return secret
}

func uniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func getUserSessionSecrets() []string {
	secrets := uniqueStrings([]string{
		getConfiguredSecret("USER_JWT_SECRET", "SESSION_JWT_SECRET", "JWT_SECRET"),
		strings.TrimSpace(os.Getenv("JWT_SECRET")),
	})
	if len(secrets) > 0 {
		return secrets
	}
	return []string{getFallbackSecret("USER_JWT_SECRET")}
}

func getProxyJWTSecrets() []string {
	secrets := uniqueStrings([]string{
		getConfiguredSecret("PROXY_JWT_SECRET", "JWT_SECRET"),
		strings.TrimSpace(os.Getenv("JWT_SECRET")),
	})
	if len(secrets) > 0 {
		return secrets
	}
	return []string{getFallbackSecret("PROXY_JWT_SECRET")}
}

func getAllValidationSecrets() []string {
	return uniqueStrings(append(getUserSessionSecrets(), getProxyJWTSecrets()...))
}

func parseProxyTokenTTL(raw string) (time.Duration, error) {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	if trimmed == "" {
		return 0, fmt.Errorf("duration is empty")
	}
	if strings.HasSuffix(trimmed, "d") {
		daysValue := strings.TrimSuffix(trimmed, "d")
		var days int
		if _, err := fmt.Sscanf(daysValue, "%d", &days); err != nil {
			return 0, err
		}
		if days <= 0 {
			return 0, fmt.Errorf("days must be positive")
		}
		return time.Duration(days) * 24 * time.Hour, nil
	}
	return time.ParseDuration(trimmed)
}

// GetProxyTokenTTL returns the configured lifetime for newly-issued proxy tokens.
func GetProxyTokenTTL() time.Duration {
	if raw := strings.TrimSpace(os.Getenv("PROXY_TOKEN_TTL")); raw != "" {
		if ttl, err := parseProxyTokenTTL(raw); err == nil && ttl > 0 {
			return ttl
		}
		fmt.Printf("Warning: invalid PROXY_TOKEN_TTL %q, using default %s\n", raw, defaultProxyTokenTTL)
	}
	return defaultProxyTokenTTL
}

// NewProxyTokenWindow returns issue and expiry timestamps for new proxy tokens.
func NewProxyTokenWindow() (time.Time, time.Time) {
	issuedAt := time.Now().UTC()
	return issuedAt, issuedAt.Add(GetProxyTokenTTL())
}

func isLocalProxyHost(host string) bool {
	trimmed := strings.TrimSpace(strings.Trim(host, "[]"))
	if trimmed == "" {
		return true
	}
	if strings.EqualFold(trimmed, "localhost") {
		return true
	}
	if ip := net.ParseIP(trimmed); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

// RecommendedProxySSLMode returns the safest libpq sslmode that should work for the host.
func RecommendedProxySSLMode(host string) string {
	if isLocalProxyHost(host) {
		return "require"
	}
	return "verify-full"
}

// GenerateTokenID generates a unique token ID
func GenerateTokenID() (string, error) {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// GenerateJWT generates a new JWT token for a database (Legacy proxy token)
func GenerateJWT(databaseID int, userID int, tokenID string) (string, error) {
	issuedAt, expiresAt := NewProxyTokenWindow()
	return GenerateJWTWithTimestamps(databaseID, userID, tokenID, issuedAt, expiresAt)
}

// GenerateJWTWithTimestamps generates a deterministic JWT for a token identity and timestamp pair.
func GenerateJWTWithTimestamps(databaseID int, userID int, tokenID string, issuedAt time.Time, expiresAt time.Time) (string, error) {
	secret := getProxyJWTSecrets()[0]
	issuedAt = issuedAt.UTC()
	expiresAt = expiresAt.UTC()

	claims := JWTClaims{
		DatabaseID: databaseID,
		UserID:     userID,
		TokenID:    tokenID,
		Purpose:    "db_proxy",
		Type:       "database_access",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(issuedAt),
			NotBefore: jwt.NewNumericDate(issuedAt),
			Issuer:    "baseful",
			Subject:   fmt.Sprintf("db_%d", databaseID),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// GenerateUserJWT generates a session token for a user
func GenerateUserJWT(userID int, email string, isAdmin bool) (string, error) {
	secret := getUserSessionSecrets()[0]

	// Session expires in 7 days
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	claims := JWTClaims{
		UserID:  userID,
		Email:   email,
		IsAdmin: isAdmin,
		Purpose: "user_session",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "baseful",
			Subject:   fmt.Sprintf("user_%d", userID),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ValidateJWT validates a JWT token and returns the claims
func ValidateJWT(tokenString string) (*JWTClaims, error) {
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer("baseful"),
		jwt.WithLeeway(30*time.Second),
	)

	var lastErr error
	for _, secret := range getAllValidationSecrets() {
		token, err := parser.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		})
		if err != nil {
			lastErr = err
			continue
		}

		if claims, ok := token.Claims.(*JWTClaims); ok && token.Valid {
			return claims, nil
		}
		lastErr = fmt.Errorf("invalid token")
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("invalid token")
	}
	return nil, lastErr
}

// GenerateConnectionString generates a PostgreSQL proxy connection string
func GenerateConnectionString(jwtToken string, databaseID int, host string, port int, sslMode string) string {
	// Format: postgresql://token:JWT@host:port/db_DATABASEID
	connStr := fmt.Sprintf("postgresql://token:%s@%s:%d/db_%d", jwtToken, host, port, databaseID)

	// TLS is mandatory for proxy connections.
	if sslMode == "" || sslMode == "disable" {
		sslMode = "require"
	}
	connStr = fmt.Sprintf("%s?sslmode=%s", connStr, sslMode)

	return connStr
}

// GetProxyPort returns the PostgreSQL proxy port from environment
func GetProxyPort() string {
	port := os.Getenv("PROXY_PORT")
	if port == "" {
		return "6432"
	}
	return port
}

func getSavedDomainName() string {
	domain, err := db.GetSetting("domain_name")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(domain)
}

func isProxyHostPlaceholder(host string) bool {
	trimmed := strings.TrimSpace(strings.Trim(host, "[]"))
	switch strings.ToLower(trimmed) {
	case "", "0.0.0.0", "::", "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}

// GetProxyHost returns the PostgreSQL proxy host from environment
func GetProxyHost() string {
	host := strings.TrimSpace(os.Getenv("PROXY_HOST"))
	domainName := strings.TrimSpace(os.Getenv("DOMAIN_NAME"))
	publicIP := strings.TrimSpace(os.Getenv("PUBLIC_IP"))
	savedDomain := getSavedDomainName()

	if !isProxyHostPlaceholder(host) && (publicIP == "" || host != publicIP) {
		return host
	}
	if domainName != "" {
		return domainName
	}
	if savedDomain != "" {
		return savedDomain
	}
	if !isProxyHostPlaceholder(host) {
		return host
	}
	if publicIP != "" {
		return publicIP
	}
	return "localhost"
}
