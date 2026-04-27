package db

import (
	"database/sql"
	"fmt"
	"os"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

func InitDB() error {
	var err error
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data.db"
	}
	readOnly := os.Getenv("DB_READ_ONLY") == "true"

	if readOnly {
		dbPath = dbPath + "?mode=ro"
	}

	DB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}

	// Configure for better concurrent access
	DB.SetMaxOpenConns(10)

	if readOnly {
		fmt.Println("Database initialized in READ-ONLY mode")
		return nil
	}

	// Enable WAL mode for better concurrent access
	if _, err := DB.Exec("PRAGMA journal_mode=WAL"); err != nil {
		fmt.Printf("Warning: Failed to enable WAL mode: %v\n", err)
	}
	// Reduce busy timeout
	if _, err := DB.Exec("PRAGMA busy_timeout=5000"); err != nil {
		fmt.Printf("Warning: Failed to set busy timeout: %v\n", err)
	}

	// Create tables if they don't exist
	schema := `
    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER DEFAULT 22,
        username TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS databases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        project_id INTEGER,
        owner_user_id INTEGER,
        server_id INTEGER,
        host TEXT,
        port INTEGER,
        container_id TEXT,
        version TEXT,
        password TEXT,
        proxy_username TEXT,
        proxy_password TEXT,
        status TEXT DEFAULT 'running',
        max_cpu REAL DEFAULT 1.0,
        max_ram_mb INTEGER DEFAULT 512,
        max_storage_mb INTEGER DEFAULT 1024,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (owner_user_id) REFERENCES users(id),
        FOREIGN KEY (server_id) REFERENCES servers(id)
    );

    CREATE TABLE IF NOT EXISTS database_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        database_id INTEGER NOT NULL,
        token_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        revoked BOOLEAN DEFAULT 0,
        FOREIGN KEY (database_id) REFERENCES databases(id)
    );

    CREATE TABLE IF NOT EXISTS branches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        database_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        container_id TEXT,
        port INTEGER,
        status TEXT DEFAULT 'running',
        is_default BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (database_id) REFERENCES databases(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        is_admin BOOLEAN DEFAULT 0,
        avatar_url TEXT,
        openrouter_api_key TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS whitelisted_emails (
        email TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_project_access (
        user_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        PRIMARY KEY (user_id, project_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_permissions (
        user_id INTEGER NOT NULL,
        permission_key TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, permission_key),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notification_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        smtp_host TEXT,
        smtp_port INTEGER DEFAULT 587,
        smtp_username TEXT,
        smtp_password TEXT,
        smtp_from_email TEXT,
        smtp_from_name TEXT,
        smtp_to_email TEXT,
        discord_webhook_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS database_notification_preferences (
        database_id INTEGER NOT NULL,
        event_key TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (database_id, event_key),
        FOREIGN KEY (database_id) REFERENCES databases(id)
    );

    CREATE TABLE IF NOT EXISTS system_notification_preferences (
        event_key TEXT PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS topology_service_cards (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        backup_cards_json TEXT NOT NULL DEFAULT '[]',
        automation_cards_json TEXT NOT NULL DEFAULT '[]',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS topology_user_service_cards (
        user_id INTEGER PRIMARY KEY,
        backup_cards_json TEXT NOT NULL DEFAULT '[]',
        automation_cards_json TEXT NOT NULL DEFAULT '[]',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS topology_backup_card_profiles (
        card_id TEXT PRIMARY KEY,
        owner_user_id INTEGER,
        source_database_id INTEGER,
        provider TEXT,
        endpoint TEXT,
        region TEXT,
        bucket TEXT,
        access_key TEXT,
        secret_key TEXT,
        path_prefix TEXT,
        automation_enabled BOOLEAN DEFAULT 0,
        automation_frequency TEXT DEFAULT 'daily',
        encryption_enabled BOOLEAN DEFAULT 0,
        encryption_public_key TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_user_id) REFERENCES users(id),
        FOREIGN KEY (source_database_id) REFERENCES databases(id)
    );

    -- Insert default settings if they don't exist
    INSERT OR IGNORE INTO settings (key, value) VALUES ('metrics_enabled', 'true');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('metrics_sample_rate', '5');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('notifications_master_enabled', 'false');
    INSERT OR IGNORE INTO topology_service_cards (id, backup_cards_json, automation_cards_json) VALUES (1, '[]', '[]');
    `

	_, err = DB.Exec(schema)
	if err != nil {
		return err
	}

	// Backup tables
	backupSchema := `
	CREATE TABLE IF NOT EXISTS backup_settings (
		database_id INTEGER PRIMARY KEY,
		enabled BOOLEAN DEFAULT 0,
		provider TEXT,
		endpoint TEXT,
		region TEXT,
		bucket TEXT,
		access_key TEXT,
		secret_key TEXT,
		path_prefix TEXT,
		automation_enabled BOOLEAN DEFAULT 0,
		automation_frequency TEXT DEFAULT 'daily',
		encryption_enabled BOOLEAN DEFAULT 0,
		encryption_public_key TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (database_id) REFERENCES databases(id)
	);

	CREATE TABLE IF NOT EXISTS backups (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		database_id INTEGER NOT NULL,
		filename TEXT NOT NULL,
		object_key TEXT,
		is_encrypted BOOLEAN DEFAULT 0,
		size_bytes INTEGER,
		status TEXT, -- 'pending', 'completed', 'failed'
		s3_url TEXT,
		error TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (database_id) REFERENCES databases(id)
	);
	`
	_, err = DB.Exec(backupSchema)
	if err != nil {
		return err
	}

	// Migration: Add object_key if not exists
	DB.Exec("ALTER TABLE backups ADD COLUMN object_key TEXT")
	DB.Exec("ALTER TABLE backups ADD COLUMN is_encrypted BOOLEAN DEFAULT 0")
	DB.Exec("ALTER TABLE backup_settings ADD COLUMN automation_enabled BOOLEAN DEFAULT 0")
	DB.Exec("ALTER TABLE backup_settings ADD COLUMN automation_frequency TEXT DEFAULT 'daily'")
	DB.Exec("ALTER TABLE backup_settings ADD COLUMN encryption_enabled BOOLEAN DEFAULT 0")
	DB.Exec("ALTER TABLE backup_settings ADD COLUMN encryption_public_key TEXT")

	// Migration: Add project_id column if it doesn't exist
	// SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we just ignore errors
	DB.Exec("ALTER TABLE databases ADD COLUMN project_id INTEGER DEFAULT 0")
	DB.Exec("ALTER TABLE databases ADD COLUMN owner_user_id INTEGER")

	// Migration: Add resource limit columns if they don't exist
	DB.Exec("ALTER TABLE databases ADD COLUMN max_cpu REAL DEFAULT 1.0")
	DB.Exec("ALTER TABLE databases ADD COLUMN max_ram_mb INTEGER DEFAULT 512")
	DB.Exec("ALTER TABLE databases ADD COLUMN max_storage_mb INTEGER DEFAULT 1024")
	DB.Exec("ALTER TABLE databases ADD COLUMN proxy_username TEXT")
	DB.Exec("ALTER TABLE databases ADD COLUMN proxy_password TEXT")

	// Migration: Add mapped_port for local dev access (running proxy on host)
	DB.Exec("ALTER TABLE databases ADD COLUMN mapped_port INTEGER DEFAULT 0")
	// Migration: Notification recipient address
	DB.Exec("ALTER TABLE notification_settings ADD COLUMN smtp_to_email TEXT")

	// Migration: Persist JWT issue timestamps so connection strings remain stable
	DB.Exec("ALTER TABLE database_tokens ADD COLUMN issued_at DATETIME DEFAULT CURRENT_TIMESTAMP")
	DB.Exec("UPDATE database_tokens SET issued_at = COALESCE(issued_at, created_at)")

	// Migration: Ensure users and whitelisted_emails tables exist (redundant but safe)
	DB.Exec(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        is_admin BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)
	// Migration: Add names if they don't exist
	DB.Exec("ALTER TABLE users ADD COLUMN first_name TEXT")
	DB.Exec("ALTER TABLE users ADD COLUMN last_name TEXT")
	DB.Exec("ALTER TABLE users ADD COLUMN avatar_url TEXT")
	DB.Exec("ALTER TABLE users ADD COLUMN openrouter_api_key TEXT")
	DB.Exec(`CREATE TABLE IF NOT EXISTS whitelisted_emails (
        email TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)
	DB.Exec(`CREATE TABLE IF NOT EXISTS user_project_access (
        user_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        PRIMARY KEY (user_id, project_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
    )`)
	DB.Exec(`CREATE TABLE IF NOT EXISTS user_permissions (
        user_id INTEGER NOT NULL,
        permission_key TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, permission_key),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`)
	DB.Exec(`CREATE TABLE IF NOT EXISTS notification_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        smtp_host TEXT,
        smtp_port INTEGER DEFAULT 587,
        smtp_username TEXT,
        smtp_password TEXT,
        smtp_from_email TEXT,
        smtp_from_name TEXT,
        smtp_to_email TEXT,
        discord_webhook_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)
	DB.Exec(`CREATE TABLE IF NOT EXISTS database_notification_preferences (
        database_id INTEGER NOT NULL,
        event_key TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (database_id, event_key),
        FOREIGN KEY (database_id) REFERENCES databases(id)
    )`)
	DB.Exec(`CREATE TABLE IF NOT EXISTS system_notification_preferences (
        event_key TEXT PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)
	DB.Exec(`CREATE TABLE IF NOT EXISTS topology_service_cards (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        backup_cards_json TEXT NOT NULL DEFAULT '[]',
        automation_cards_json TEXT NOT NULL DEFAULT '[]',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)
	DB.Exec(`INSERT OR IGNORE INTO topology_service_cards (id, backup_cards_json, automation_cards_json, updated_at)
        SELECT 1, backup_cards_json, automation_cards_json, updated_at
        FROM user_topology_service_cards
        ORDER BY updated_at DESC
        LIMIT 1`)
	DB.Exec("INSERT OR IGNORE INTO topology_service_cards (id, backup_cards_json, automation_cards_json) VALUES (1, '[]', '[]')")
	// One-time migration: backfill existing non-admin users with access to all
	// existing projects to preserve legacy behavior during initial rollout.
	// Guarded by a settings flag so it does not re-run on every restart.
	var projectAccessBackfillDone string
	err = DB.QueryRow("SELECT value FROM settings WHERE key = 'project_access_backfill_done'").Scan(&projectAccessBackfillDone)
	if err == sql.ErrNoRows || projectAccessBackfillDone != "true" {
		DB.Exec(`
			INSERT OR IGNORE INTO user_project_access (user_id, project_id)
			SELECT u.id, p.id
			FROM users u
			CROSS JOIN projects p
			WHERE u.is_admin = 0
		`)
		DB.Exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('project_access_backfill_done', 'true')")
	}

	return nil
}

// DatabaseInfo represents database connection information
type DatabaseInfo struct {
	ID         int
	Name       string
	Host       string
	Port       int
	MappedPort int
	Password   string
	ProxyUser  string
	ProxyPass  string
	Type       string
}

// GetDatabaseByID returns database connection information for a given ID
func GetDatabaseByID(databaseID int) (*DatabaseInfo, error) {
	var dbInfo DatabaseInfo
	err := DB.QueryRow(`
		SELECT id, name, host, port, mapped_port, password, COALESCE(proxy_username, ''), COALESCE(proxy_password, ''), type
		FROM databases
		WHERE id = ?
	`, databaseID).Scan(
		&dbInfo.ID, &dbInfo.Name, &dbInfo.Host,
		&dbInfo.Port, &dbInfo.MappedPort, &dbInfo.Password, &dbInfo.ProxyUser, &dbInfo.ProxyPass, &dbInfo.Type,
	)

	if err != nil {
		return nil, fmt.Errorf("database not found: %w", err)
	}

	return &dbInfo, nil
}

// GetSetting returns the value of a setting by key
func GetSetting(key string) (string, error) {
	var value string
	err := DB.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&value)
	if err != nil {
		return "", err
	}
	return value, nil
}

// UpdateSetting updates the value of a setting by key
func UpdateSetting(key, value string) error {
	_, err := DB.Exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, value)
	return err
}
