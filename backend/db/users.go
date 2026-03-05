package db

import (
	"database/sql"

	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID           int    `json:"id"`
	Email        string `json:"email"`
	PasswordHash string `json:"-"`
	FirstName    string `json:"firstName"`
	LastName     string `json:"lastName"`
	IsAdmin      bool   `json:"isAdmin"`
	AvatarURL    string `json:"avatarUrl"`
	CreatedAt    string `json:"createdAt"`
}

// CreateUser creates a new user in the database
func CreateUser(email, password, firstName, lastName string, isAdmin bool) (int, error) {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return 0, err
	}

	result, err := DB.Exec(
		"INSERT INTO users (email, password_hash, first_name, last_name, is_admin, avatar_url) VALUES (?, ?, ?, ?, ?, ?)",
		email, string(hashedPassword), firstName, lastName, isAdmin, "",
	)
	if err != nil {
		return 0, err
	}

	id, _ := result.LastInsertId()
	return int(id), nil
}

// GetUserByEmail retrieves a user by their email address
func GetUserByEmail(email string) (*User, error) {
	var user User
	err := DB.QueryRow(
		"SELECT id, email, password_hash, COALESCE(first_name, ''), COALESCE(last_name, ''), is_admin, COALESCE(avatar_url, ''), created_at FROM users WHERE email = ?",
		email,
	).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.FirstName, &user.LastName, &user.IsAdmin, &user.AvatarURL, &user.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &user, nil
}

// UpdateUser updates a user's information
func UpdateUser(id int, email, firstName, lastName string) error {
	_, err := DB.Exec(
		"UPDATE users SET email = ?, first_name = ?, last_name = ? WHERE id = ?",
		email, firstName, lastName, id,
	)
	return err
}

// UpdateUserPassword updates a user's password
func UpdateUserPassword(id int, password string) error {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	_, err = DB.Exec(
		"UPDATE users SET password_hash = ? WHERE id = ?",
		string(hashedPassword), id,
	)
	return err
}

// UpdateUserAvatar updates a user's avatar URL
func UpdateUserAvatar(id int, avatarURL string) error {
	_, err := DB.Exec(
		"UPDATE users SET avatar_url = ? WHERE id = ?",
		avatarURL, id,
	)
	return err
}

// UpdateUserOpenRouterAPIKey stores or clears a user's OpenRouter API key
func UpdateUserOpenRouterAPIKey(id int, apiKey string) error {
	_, err := DB.Exec(
		"UPDATE users SET openrouter_api_key = ? WHERE id = ?",
		apiKey, id,
	)
	return err
}

// GetUserOpenRouterAPIKey gets a user's OpenRouter API key
func GetUserOpenRouterAPIKey(id int) (string, error) {
	var apiKey sql.NullString
	err := DB.QueryRow(
		"SELECT openrouter_api_key FROM users WHERE id = ?",
		id,
	).Scan(&apiKey)
	if err != nil {
		return "", err
	}
	if !apiKey.Valid {
		return "", nil
	}
	return apiKey.String, nil
}

// CheckPasswordHash compares a password with a hash
func CheckPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// HasAnyUser checks if there are any users in the database
func HasAnyUser() (bool, error) {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	return count > 0, err
}

// IsEmailWhitelisted checks if an email is in the whitelist
func IsEmailWhitelisted(email string) (bool, error) {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM whitelisted_emails WHERE email = ?", email).Scan(&count)
	return count > 0, err
}

// AddEmailToWhitelist adds an email to the whitelist
func AddEmailToWhitelist(email string) error {
	_, err := DB.Exec("INSERT OR IGNORE INTO whitelisted_emails (email) VALUES (?)", email)
	return err
}

// GetWhitelistedEmails returns all whitelisted emails
func GetWhitelistedEmails() ([]string, error) {
	rows, err := DB.Query("SELECT email FROM whitelisted_emails ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var emails []string
	for rows.Next() {
		var email string
		if err := rows.Scan(&email); err != nil {
			return nil, err
		}
		emails = append(emails, email)
	}
	return emails, nil
}

// RemoveEmailFromWhitelist removes an email from the whitelist
func RemoveEmailFromWhitelist(email string) error {
	_, err := DB.Exec("DELETE FROM whitelisted_emails WHERE email = ?", email)
	return err
}
