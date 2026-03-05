package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// Default proxy configuration
	DefaultProxyHost = "localhost"
	DefaultProxyPort = 6432
)

// Example 1: Simple query using pgx
func exampleSimpleQuery() {
	fmt.Println("=== Example 1: Simple Query ===")

	// Configuration
	proxyHost := getEnv("PROXY_HOST", DefaultProxyHost)
	proxyPort := getEnv("PROXY_PORT", fmt.Sprintf("%d", DefaultProxyPort))
	jwtToken := getEnv("JWT_TOKEN", "your-jwt-token-here")
	databaseID := getEnv("DATABASE_ID", "1")

	// Build connection string
	connStr := fmt.Sprintf(
		"postgresql://token:%s@%s:%s/db_%s",
		jwtToken,
		proxyHost,
		proxyPort,
		databaseID,
	)

	// Connect to proxy
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, connStr)
	if err != nil {
		log.Fatalf("Failed to connect to proxy: %v", err)
	}
	defer conn.Close(ctx)

	fmt.Println("Connected to proxy successfully!")

	// Execute a simple query
	var result string
	err = conn.QueryRow(ctx, "SELECT version()").Scan(&result)
	if err != nil {
		log.Fatalf("Query failed: %v", err)
	}

	fmt.Printf("PostgreSQL version: %s\n", result)
}

// Example 2: Using connection pool
func exampleConnectionPool() {
	fmt.Println("\n=== Example 2: Connection Pool ===")

	proxyHost := getEnv("PROXY_HOST", DefaultProxyHost)
	proxyPort := getEnv("PROXY_PORT", fmt.Sprintf("%d", DefaultProxyPort))
	jwtToken := getEnv("JWT_TOKEN", "your-jwt-token-here")
	databaseID := getEnv("DATABASE_ID", "1")

	// Build connection string
	connStr := fmt.Sprintf(
		"postgresql://token:%s@%s:%s/db_%s",
		jwtToken,
		proxyHost,
		proxyPort,
		databaseID,
	)

	// Create connection pool
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	poolConfig, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		log.Fatalf("Failed to parse config: %v", err)
	}

	// Configure pool
	poolConfig.MaxConns = 5
	poolConfig.MinConns = 2

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		log.Fatalf("Failed to create pool: %v", err)
	}
	defer pool.Close()

	fmt.Println("Created connection pool successfully!")

	// Execute multiple queries concurrently
	for i := 0; i < 3; i++ {
		go func(id int) {
			var result string
			err := pool.QueryRow(ctx, "SELECT version()").Scan(&result)
			if err != nil {
				log.Printf("Query %d failed: %v", id, err)
				return
			}
			fmt.Printf("Query %d: Connected to %s\n", id, result[:50])
		}(i)
	}

	// Wait for goroutines
	time.Sleep(2 * time.Second)
}

// Example 3: Transaction handling
func exampleTransaction() {
	fmt.Println("\n=== Example 3: Transaction ===")

	proxyHost := getEnv("PROXY_HOST", DefaultProxyHost)
	proxyPort := getEnv("PROXY_PORT", fmt.Sprintf("%d", DefaultProxyPort))
	jwtToken := getEnv("JWT_TOKEN", "your-jwt-token-here")
	databaseID := getEnv("DATABASE_ID", "1")

	connStr := fmt.Sprintf(
		"postgresql://token:%s@%s:%s/db_%s",
		jwtToken,
		proxyHost,
		proxyPort,
		databaseID,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, connStr)
	if err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer conn.Close(ctx)

	// Begin transaction
	tx, err := conn.Begin(ctx)
	if err != nil {
		log.Fatalf("Failed to begin transaction: %v", err)
	}

	// Execute queries in transaction
	_, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS test_table (id SERIAL PRIMARY KEY, name TEXT)")
	if err != nil {
		log.Printf("Failed to create table: %v", err)
		tx.Rollback(ctx)
		return
	}

	_, err = tx.Exec(ctx, "INSERT INTO test_table (name) VALUES ($1)", "test")
	if err != nil {
		log.Printf("Failed to insert: %v", err)
		tx.Rollback(ctx)
		return
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		log.Fatalf("Failed to commit: %v", err)
	}

	fmt.Println("Transaction committed successfully!")

	// Query the inserted data
	var name string
	err = conn.QueryRow(ctx, "SELECT name FROM test_table WHERE id = 1").Scan(&name)
	if err != nil {
		log.Printf("Failed to query: %v", err)
		return
	}

	fmt.Printf("Retrieved: %s\n", name)

	// Cleanup
	conn.Exec(ctx, "DROP TABLE test_table")
}

// Example 4: Error handling
func exampleErrorHandling() {
	fmt.Println("\n=== Example 4: Error Handling ===")

	proxyHost := getEnv("PROXY_HOST", DefaultProxyHost)
	proxyPort := getEnv("PROXY_PORT", fmt.Sprintf("%d", DefaultProxyPort))
	jwtToken := getEnv("JWT_TOKEN", "your-jwt-token-here")
	databaseID := getEnv("DATABASE_ID", "1")

	connStr := fmt.Sprintf(
		"postgresql://token:%s@%s:%s/db_%s",
		jwtToken,
		proxyHost,
		proxyPort,
		databaseID,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, connStr)
	if err != nil {
		log.Printf("Connection error: %v", err)
		return
	}
	defer conn.Close(ctx)

	// Try to query non-existent table
	_, err = conn.Exec(ctx, "SELECT * FROM nonexistent_table")
	if err != nil {
		fmt.Printf("Expected error (table doesn't exist): %v\n", err)
	}

	// Try invalid SQL
	_, err = conn.Exec(ctx, "INVALID SQL")
	if err != nil {
		fmt.Printf("Expected error (invalid SQL): %v\n", err)
	}

	fmt.Println("Error handling examples completed!")
}

// Example 5: Prepared statements
func examplePreparedStatements() {
	fmt.Println("\n=== Example 5: Prepared Statements ===")

	proxyHost := getEnv("PROXY_HOST", DefaultProxyHost)
	proxyPort := getEnv("PROXY_PORT", fmt.Sprintf("%d", DefaultProxyPort))
	jwtToken := getEnv("JWT_TOKEN", "your-jwt-token-here")
	databaseID := getEnv("DATABASE_ID", "1")

	connStr := fmt.Sprintf(
		"postgresql://token:%s@%s:%s/db_%s",
		jwtToken,
		proxyHost,
		proxyPort,
		databaseID,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, connStr)
	if err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer conn.Close(ctx)

	// Create test table
	conn.Exec(ctx, "CREATE TEMP TABLE users (id SERIAL, name TEXT, email TEXT)")

	// Prepare statement
	prepared, err := conn.Prepare(ctx, "insert_user", "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id")
	if err != nil {
		log.Fatalf("Failed to prepare: %v", err)
	}

	// Execute prepared statement multiple times
	names := []string{"Alice", "Bob", "Charlie"}
	emails := []string{"alice@example.com", "bob@example.com", "charlie@example.com"}

	for i := 0; i < len(names); i++ {
		var id int
		err := conn.QueryRow(ctx, prepared.SQL, names[i], emails[i]).Scan(&id)
		if err != nil {
			log.Printf("Failed to insert %s: %v", names[i], err)
			continue
		}
		fmt.Printf("Inserted %s with ID: %d\n", names[i], id)
	}

	// Query all users
	rows, err := conn.Query(ctx, "SELECT name, email FROM users ORDER BY id")
	if err != nil {
		log.Fatalf("Failed to query: %v", err)
	}
	defer rows.Close()

	fmt.Println("\nAll users:")
	for rows.Next() {
		var name, email string
		if err := rows.Scan(&name, &email); err != nil {
			log.Printf("Failed to scan: %v", err)
			continue
		}
		fmt.Printf("  - %s (%s)\n", name, email)
	}
}

// Helper function to get environment variable with default
func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

func main() {
	fmt.Println("PostgreSQL Proxy Test Client")
	fmt.Println("=============================\n")

	// Check for JWT token
	jwtToken := os.Getenv("JWT_TOKEN")
	if jwtToken == "" || jwtToken == "your-jwt-token-here" {
		fmt.Println("WARNING: JWT_TOKEN not set or invalid")
		fmt.Println("Set JWT_TOKEN environment variable to test with actual proxy")
		fmt.Println("Example: export JWT_TOKEN=eyJhbGc...")
		fmt.Println()
	}

	// Run examples
	exampleSimpleQuery()
	exampleConnectionPool()
	exampleTransaction()
	exampleErrorHandling()
	examplePreparedStatements()

	fmt.Println("\n=== All examples completed! ===")
}
