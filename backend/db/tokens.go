package db

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"time"
)

// TokenRecord represents a token record in the database
type TokenRecord struct {
	ID         int
	DatabaseID int
	TokenID    string
	TokenHash  string
	IssuedAt   time.Time
	ExpiresAt  time.Time
	CreatedAt  time.Time
	Revoked    bool
}

// TokenInfo represents token information returned to the API
type TokenInfo struct {
	ID        int       `json:"id"`
	TokenID   string    `json:"tokenId"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
	Revoked   bool      `json:"revoked"`
}

// DatabaseTokensHasIssuedAt returns true when the migration has added issued_at.
func DatabaseTokensHasIssuedAt() bool {
	rows, err := DB.Query("PRAGMA table_info(database_tokens)")
	if err != nil {
		return false
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var colType string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &defaultValue, &pk); err != nil {
			return false
		}
		if name == "issued_at" {
			return true
		}
	}
	return false
}

// HashToken creates a SHA256 hash of the token for storage
func HashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

// CreateToken creates a new token record for a database
func CreateToken(databaseID int, tokenID string, tokenHash string, issuedAt time.Time, expiresAt time.Time) (int, error) {
	var result sql.Result
	var err error
	if DatabaseTokensHasIssuedAt() {
		result, err = DB.Exec(
			"INSERT INTO database_tokens (database_id, token_id, token_hash, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)",
			databaseID, tokenID, tokenHash, issuedAt, expiresAt,
		)
	} else {
		result, err = DB.Exec(
			"INSERT INTO database_tokens (database_id, token_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
			databaseID, tokenID, tokenHash, expiresAt,
		)
	}
	if err != nil {
		return 0, fmt.Errorf("failed to create token: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("failed to get last insert id: %w", err)
	}

	return int(id), nil
}

// GetActiveTokenForDatabase returns the active (non-revoked) token for a database
func GetActiveTokenForDatabase(databaseID int) (*TokenRecord, error) {
	var token TokenRecord
	var err error
	if DatabaseTokensHasIssuedAt() {
		err = DB.QueryRow(`
			SELECT id, database_id, token_id, token_hash, issued_at, expires_at, created_at, revoked
			FROM database_tokens
			WHERE database_id = ? AND revoked = 0 AND expires_at > datetime('now')
			ORDER BY created_at DESC
			LIMIT 1
		`, databaseID).Scan(
			&token.ID, &token.DatabaseID, &token.TokenID,
			&token.TokenHash, &token.IssuedAt, &token.ExpiresAt, &token.CreatedAt, &token.Revoked,
		)
	} else {
		err = DB.QueryRow(`
			SELECT id, database_id, token_id, token_hash, expires_at, created_at, revoked
			FROM database_tokens
			WHERE database_id = ? AND revoked = 0 AND expires_at > datetime('now')
			ORDER BY created_at DESC
			LIMIT 1
		`, databaseID).Scan(
			&token.ID, &token.DatabaseID, &token.TokenID,
			&token.TokenHash, &token.ExpiresAt, &token.CreatedAt, &token.Revoked,
		)
		token.IssuedAt = token.CreatedAt
	}

	if err != nil {
		return nil, fmt.Errorf("no active token found: %w", err)
	}

	return &token, nil
}

// GetTokenByID returns a token record by ID
func GetTokenByID(tokenID string) (*TokenRecord, error) {
	var token TokenRecord
	var err error
	if DatabaseTokensHasIssuedAt() {
		err = DB.QueryRow(`
			SELECT id, database_id, token_id, token_hash, issued_at, expires_at, created_at, revoked
			FROM database_tokens
			WHERE token_id = ?
		`, tokenID).Scan(
			&token.ID, &token.DatabaseID, &token.TokenID,
			&token.TokenHash, &token.IssuedAt, &token.ExpiresAt, &token.CreatedAt, &token.Revoked,
		)
	} else {
		err = DB.QueryRow(`
			SELECT id, database_id, token_id, token_hash, expires_at, created_at, revoked
			FROM database_tokens
			WHERE token_id = ?
		`, tokenID).Scan(
			&token.ID, &token.DatabaseID, &token.TokenID,
			&token.TokenHash, &token.ExpiresAt, &token.CreatedAt, &token.Revoked,
		)
		token.IssuedAt = token.CreatedAt
	}

	if err != nil {
		return nil, fmt.Errorf("token not found: %w", err)
	}

	return &token, nil
}

// GetTokensForDatabase returns all tokens for a database
func GetTokensForDatabase(databaseID int) ([]TokenInfo, error) {
	rows, err := DB.Query(`
		SELECT id, token_id, created_at, expires_at, revoked
		FROM database_tokens
		WHERE database_id = ?
		ORDER BY created_at DESC
	`, databaseID)
	if err != nil {
		return nil, fmt.Errorf("failed to query tokens: %w", err)
	}
	defer rows.Close()

	var tokens []TokenInfo
	for rows.Next() {
		var token TokenInfo
		if err := rows.Scan(&token.ID, &token.TokenID, &token.CreatedAt, &token.ExpiresAt, &token.Revoked); err != nil {
			return nil, fmt.Errorf("failed to scan token: %w", err)
		}
		tokens = append(tokens, token)
	}

	return tokens, nil
}

// RevokeToken marks a token as revoked
func RevokeToken(tokenID string) error {
	result, err := DB.Exec("UPDATE database_tokens SET revoked = 1 WHERE token_id = ?", tokenID)
	if err != nil {
		return fmt.Errorf("failed to revoke token: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("token not found")
	}

	return nil
}

// RevokeAllTokensForDatabase revokes all tokens for a database
func RevokeAllTokensForDatabase(databaseID int) error {
	_, err := DB.Exec("UPDATE database_tokens SET revoked = 1 WHERE database_id = ?", databaseID)
	if err != nil {
		return fmt.Errorf("failed to revoke tokens: %w", err)
	}
	return nil
}

// DeleteExpiredTokens removes expired tokens from the database
func DeleteExpiredTokens() (int, error) {
	result, err := DB.Exec("DELETE FROM database_tokens WHERE expires_at < datetime('now')")
	if err != nil {
		return 0, fmt.Errorf("failed to delete expired tokens: %w", err)
	}

	count, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get rows affected: %w", err)
	}

	return int(count), nil
}

// TokenExistsAndValid checks if a token exists and is valid
func TokenExistsAndValid(tokenID string) (bool, error) {
	var count int
	err := DB.QueryRow(`
		SELECT COUNT(*) FROM database_tokens
		WHERE token_id = ? AND revoked = 0 AND expires_at > datetime('now')
	`, tokenID).Scan(&count)

	if err != nil {
		return false, fmt.Errorf("failed to check token: %w", err)
	}

	return count > 0, nil
}

// GetDatabaseIDFromTokenID returns the database ID associated with a token
func GetDatabaseIDFromTokenID(tokenID string) (int, error) {
	var databaseID int
	err := DB.QueryRow(`
		SELECT database_id FROM database_tokens WHERE token_id = ?
	`, tokenID).Scan(&databaseID)

	if err != nil {
		return 0, fmt.Errorf("token not found: %w", err)
	}

	return databaseID, nil
}
