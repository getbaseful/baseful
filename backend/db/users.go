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

type UserSummary struct {
	ID        int    `json:"id"`
	Email     string `json:"email"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
	IsAdmin   bool   `json:"isAdmin"`
	AvatarURL string `json:"avatarUrl"`
}

const (
	PermissionServerAccess        = "server_access"
	PermissionManageNotifications = "manage_notifications"
	PermissionCreateProjects      = "create_projects"
	PermissionEditProjects        = "edit_projects"
	PermissionCreateDatabases     = "create_databases"
)

var AvailablePermissionKeys = []string{
	PermissionServerAccess,
	PermissionManageNotifications,
	PermissionCreateProjects,
	PermissionEditProjects,
	PermissionCreateDatabases,
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

// GetUserByID retrieves a user by their ID
func GetUserByID(id int) (*User, error) {
	var user User
	err := DB.QueryRow(
		"SELECT id, email, password_hash, COALESCE(first_name, ''), COALESCE(last_name, ''), is_admin, COALESCE(avatar_url, ''), created_at FROM users WHERE id = ?",
		id,
	).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.FirstName, &user.LastName, &user.IsAdmin, &user.AvatarURL, &user.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &user, nil
}

// GetAllUsers returns all users without sensitive fields
func GetAllUsers() ([]UserSummary, error) {
	rows, err := DB.Query(
		"SELECT id, email, COALESCE(first_name, ''), COALESCE(last_name, ''), is_admin, COALESCE(avatar_url, '') FROM users ORDER BY created_at DESC",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := []UserSummary{}
	for rows.Next() {
		var user UserSummary
		if err := rows.Scan(&user.ID, &user.Email, &user.FirstName, &user.LastName, &user.IsAdmin, &user.AvatarURL); err != nil {
			return nil, err
		}
		users = append(users, user)
	}

	return users, nil
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

// GetUserProjectAccess returns all project IDs a user can access
func GetUserProjectAccess(userID int) ([]int, error) {
	rows, err := DB.Query(
		"SELECT project_id FROM user_project_access WHERE user_id = ? ORDER BY project_id ASC",
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	projectIDs := []int{}
	for rows.Next() {
		var projectID int
		if err := rows.Scan(&projectID); err != nil {
			return nil, err
		}
		projectIDs = append(projectIDs, projectID)
	}
	return projectIDs, nil
}

// SetUserProjectAccess replaces all project access rows for a user
func SetUserProjectAccess(userID int, projectIDs []int) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM user_project_access WHERE user_id = ?", userID); err != nil {
		return err
	}

	seen := make(map[int]bool)
	for _, projectID := range projectIDs {
		if projectID <= 0 || seen[projectID] {
			continue
		}
		seen[projectID] = true
		if _, err := tx.Exec(
			"INSERT INTO user_project_access (user_id, project_id) VALUES (?, ?)",
			userID,
			projectID,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetProjectUsers returns all users who have access to a specific project.
// This automatically includes all admins.
func GetProjectUsers(projectID int) ([]UserSummary, error) {
	rows, err := DB.Query(`
		SELECT u.id, u.email, COALESCE(u.first_name, ''), COALESCE(u.last_name, ''), u.is_admin, COALESCE(u.avatar_url, '')
		FROM users u
		INNER JOIN user_project_access upa ON upa.user_id = u.id
		WHERE upa.project_id = ?
		UNION
		SELECT u.id, u.email, COALESCE(u.first_name, ''), COALESCE(u.last_name, ''), u.is_admin, COALESCE(u.avatar_url, '')
		FROM users u
		WHERE u.is_admin = true
		ORDER BY email ASC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := []UserSummary{}
	for rows.Next() {
		var user UserSummary
		if err := rows.Scan(&user.ID, &user.Email, &user.FirstName, &user.LastName, &user.IsAdmin, &user.AvatarURL); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, nil
}

// SetProjectUsers replaces all user access rows for a project
func SetProjectUsers(projectID int, userIDs []int, createdBy int) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM user_project_access WHERE project_id = ?", projectID); err != nil {
		return err
	}

	seen := make(map[int]bool)
	for _, userID := range userIDs {
		if userID <= 0 || seen[userID] {
			continue
		}
		seen[userID] = true
		if _, err := tx.Exec(
			"INSERT INTO user_project_access (user_id, project_id, created_by) VALUES (?, ?, ?)",
			userID,
			projectID,
			createdBy,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// UserCanAccessProject checks if a user has access to a project
func UserCanAccessProject(userID, projectID int) (bool, error) {
	if projectID <= 0 {
		return false, nil
	}

	var count int
	err := DB.QueryRow(
		"SELECT COUNT(*) FROM user_project_access WHERE user_id = ? AND project_id = ?",
		userID,
		projectID,
	).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// UserCanAccessDatabase checks if a user can access a database via project access
func UserCanAccessDatabase(userID, databaseID int) (bool, error) {
	if databaseID <= 0 {
		return false, nil
	}

	var count int
	err := DB.QueryRow(`
		SELECT COUNT(*)
		FROM databases d
		INNER JOIN user_project_access upa ON upa.project_id = d.project_id
		WHERE d.id = ? AND upa.user_id = ?
	`, databaseID, userID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func IsValidPermissionKey(permission string) bool {
	for _, key := range AvailablePermissionKeys {
		if key == permission {
			return true
		}
	}
	return false
}

// GetUserPermissions returns permission keys for the given user.
func GetUserPermissions(userID int) ([]string, error) {
	rows, err := DB.Query(
		"SELECT permission_key FROM user_permissions WHERE user_id = ? ORDER BY permission_key ASC",
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	permissions := []string{}
	for rows.Next() {
		var permission string
		if err := rows.Scan(&permission); err != nil {
			return nil, err
		}
		permissions = append(permissions, permission)
	}
	return permissions, nil
}

// SetUserPermissions replaces all explicit permissions for a user.
func SetUserPermissions(userID int, permissions []string) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM user_permissions WHERE user_id = ?", userID); err != nil {
		return err
	}

	seen := make(map[string]bool)
	for _, permission := range permissions {
		if seen[permission] {
			continue
		}
		seen[permission] = true
		if _, err := tx.Exec(
			"INSERT INTO user_permissions (user_id, permission_key) VALUES (?, ?)",
			userID,
			permission,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// UserHasPermission checks if the user has a specific permission key.
func UserHasPermission(userID int, permission string) (bool, error) {
	var count int
	err := DB.QueryRow(
		"SELECT COUNT(*) FROM user_permissions WHERE user_id = ? AND permission_key = ?",
		userID,
		permission,
	).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// DeleteUserByID removes a user and related access/permission mappings.
func DeleteUserByID(userID int) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM user_project_access WHERE user_id = ?", userID); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM user_permissions WHERE user_id = ?", userID); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM users WHERE id = ?", userID); err != nil {
		return err
	}

	return tx.Commit()
}
