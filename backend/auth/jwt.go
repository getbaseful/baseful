package auth

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
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

// GetJWTSecret returns the JWT secret from environment or generates one
func GetJWTSecret() string {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		// Generate a random secret if not set
		b := make([]byte, 32)
		rand.Read(b)
		secret = hex.EncodeToString(b)
		fmt.Println("Warning: JWT_SECRET not set, generated random secret")
	}
	return secret
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
	issuedAt := time.Now().UTC()
	expiresAt := issuedAt.AddDate(2, 0, 0)
	return GenerateJWTWithTimestamps(databaseID, userID, tokenID, issuedAt, expiresAt)
}

// GenerateJWTWithTimestamps generates a deterministic JWT for a token identity and timestamp pair.
func GenerateJWTWithTimestamps(databaseID int, userID int, tokenID string, issuedAt time.Time, expiresAt time.Time) (string, error) {
	secret := GetJWTSecret()
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
	secret := GetJWTSecret()

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
	secret := GetJWTSecret()

	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(secret), nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*JWTClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
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

// GetProxyHost returns the PostgreSQL proxy host from environment
func GetProxyHost() string {
	host := os.Getenv("PROXY_HOST")
	if host == "" {
		host = os.Getenv("PUBLIC_IP")
	}
	if host == "" {
		return "localhost"
	}
	return host
}
