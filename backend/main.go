package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
	"github.com/docker/go-connections/nat"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"baseful/auth"
	"baseful/backups"
	"baseful/db"
	"baseful/docker"
	"baseful/metrics"
	"baseful/proxy"
	"baseful/system"
)

const (
	sessionCookieName      = "baseful_session"
	sessionCookieMaxAgeSec = 7 * 24 * 60 * 60
)

func getFreePort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "localhost:0")
	if err != nil {
		return 0, err
	}

	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func generatePassword(length int) (string, error) {
	b := make([]byte, length)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b)[:length], nil
}

func maskAPIKey(key string) string {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) <= 8 {
		return "********"
	}
	return trimmed[:4] + strings.Repeat("*", len(trimmed)-8) + trimmed[len(trimmed)-4:]
}

func sanitizeSQLResponse(raw string) string {
	sqlText := strings.TrimSpace(raw)
	if strings.HasPrefix(sqlText, "```") {
		lines := strings.Split(sqlText, "\n")
		if len(lines) >= 2 {
			if strings.HasPrefix(lines[0], "```") {
				lines = lines[1:]
			}
			if len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "```" {
				lines = lines[:len(lines)-1]
			}
			sqlText = strings.TrimSpace(strings.Join(lines, "\n"))
		}
	}
	if strings.HasPrefix(strings.ToLower(sqlText), "sql\n") {
		sqlText = strings.TrimSpace(sqlText[4:])
	}
	return sqlText
}

func isSecureRequest(c *gin.Context) bool {
	if c.Request.TLS != nil {
		return true
	}
	return strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
}

func setSessionCookie(c *gin.Context, token string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		sessionCookieName,
		token,
		sessionCookieMaxAgeSec,
		"/",
		"",
		isSecureRequest(c),
		true,
	)
}

func clearSessionCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		sessionCookieName,
		"",
		-1,
		"/",
		"",
		isSecureRequest(c),
		true,
	)
}

func fetchSchemaSummary(ctx context.Context, cli *client.Client, containerID, dbName string) (string, error) {
	schemaCmd := []string{"psql", "-U", "postgres", "-d", dbName, "-t", "-A", "-F", "|", "-c",
		"SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position"}
	schemaExec, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
		Cmd:          schemaCmd,
		AttachStdout: true,
		AttachStderr: true,
	})
	if err != nil {
		return "", err
	}
	schemaAttach, err := cli.ContainerExecAttach(ctx, schemaExec.ID, container.ExecAttachOptions{})
	if err != nil {
		return "", err
	}
	defer schemaAttach.Close()

	var stdout, stderr bytes.Buffer
	_, _ = stdcopy.StdCopy(&stdout, &stderr, schemaAttach.Reader)
	if stderr.Len() > 0 && strings.TrimSpace(stdout.String()) == "" {
		return "", errors.New(strings.TrimSpace(stderr.String()))
	}

	tableColumns := map[string][]string{}
	for _, line := range strings.Split(stdout.String(), "\n") {
		parts := strings.Split(strings.TrimSpace(line), "|")
		if len(parts) < 3 {
			continue
		}
		tableName := strings.TrimSpace(parts[0])
		columnName := strings.TrimSpace(parts[1])
		columnType := strings.TrimSpace(parts[2])
		if tableName == "" || columnName == "" {
			continue
		}
		tableColumns[tableName] = append(tableColumns[tableName], fmt.Sprintf("%s (%s)", columnName, columnType))
	}

	if len(tableColumns) == 0 {
		return "No tables found in public schema.", nil
	}

	var b strings.Builder
	b.WriteString("Public schema tables and columns:\n")
	for tableName, columns := range tableColumns {
		b.WriteString("- ")
		b.WriteString(tableName)
		b.WriteString(": ")
		b.WriteString(strings.Join(columns, ", "))
		b.WriteString("\n")
	}
	summary := b.String()
	if len(summary) > 12000 {
		return summary[:12000], nil
	}
	return summary, nil
}

func requireProjectAccess(c *gin.Context, projectID int) bool {
	isAdmin := c.MustGet("is_admin").(bool)
	if isAdmin {
		return true
	}

	userID := c.MustGet("user_id").(int)
	allowed, err := db.UserCanAccessProject(userID, projectID)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to validate project access"})
		return false
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "Access denied for this project"})
		return false
	}

	return true
}

func getUserPermissionsForResponse(userID int, isAdmin bool) []string {
	if isAdmin {
		return db.AvailablePermissionKeys
	}
	permissions, err := db.GetUserPermissions(userID)
	if err != nil {
		return []string{}
	}
	return permissions
}

func requirePermission(c *gin.Context, permission string) bool {
	isAdmin := c.MustGet("is_admin").(bool)
	if isAdmin {
		return true
	}

	userID := c.MustGet("user_id").(int)
	allowed, err := db.UserHasPermission(userID, permission)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to validate permissions"})
		return false
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "Permission denied"})
		return false
	}
	return true
}

func requireDatabaseAccess(c *gin.Context, databaseID int) bool {
	isAdmin := c.MustGet("is_admin").(bool)
	if isAdmin {
		return true
	}

	userID := c.MustGet("user_id").(int)
	allowed, err := db.UserCanAccessDatabase(userID, databaseID)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to validate database access"})
		return false
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "Access denied for this database"})
		return false
	}

	return true
}

func requestSQLFromOpenRouter(apiKey, systemPrompt, userPrompt string) (string, error) {
	type message struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	type openRouterRequest struct {
		Model       string    `json:"model"`
		Messages    []message `json:"messages"`
		Temperature float64   `json:"temperature"`
		MaxTokens   int       `json:"max_tokens"`
	}
	type openRouterResponse struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	models := []string{
		"google/gemini-3.1-flash-lite-preview",
		"deepseek/deepseek-v3.2",
	}
	httpClient := &http.Client{Timeout: 30 * time.Second}

	var lastErr error
	for _, model := range models {
		reqBody := openRouterRequest{
			Model: model,
			Messages: []message{
				{Role: "system", Content: systemPrompt},
				{Role: "user", Content: userPrompt},
			},
			Temperature: 0.1,
			MaxTokens:   800,
		}

		bodyBytes, err := json.Marshal(reqBody)
		if err != nil {
			return "", err
		}

		req, err := http.NewRequest("POST", "https://openrouter.ai/api/v1/chat/completions", bytes.NewBuffer(bodyBytes))
		if err != nil {
			return "", err
		}
		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("HTTP-Referer", "https://baseful.local")
		req.Header.Set("X-Title", "Baseful SQL Assistant")

		res, err := httpClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}

		rawBody, _ := io.ReadAll(res.Body)
		_ = res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			lastErr = fmt.Errorf("model %s failed: %s", model, strings.TrimSpace(string(rawBody)))
			continue
		}

		var parsed openRouterResponse
		if err := json.Unmarshal(rawBody, &parsed); err != nil {
			lastErr = err
			continue
		}
		if len(parsed.Choices) == 0 {
			lastErr = fmt.Errorf("model %s returned no choices", model)
			continue
		}

		sqlText := sanitizeSQLResponse(parsed.Choices[0].Message.Content)
		if strings.TrimSpace(sqlText) == "" {
			lastErr = fmt.Errorf("model %s returned empty SQL", model)
			continue
		}
		return sqlText, nil
	}

	if lastErr != nil {
		return "", lastErr
	}
	return "", fmt.Errorf("failed to generate SQL")
}

func main() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		// Suppress warning if variables are already provided by Docker/Environment
		if os.Getenv("JWT_SECRET") == "" {
			fmt.Println("Warning: No .env file found, using system environment variables")
		}
	}

	// Initialize database
	if err := db.InitDB(); err != nil {
		panic(err)
	}

	// Initialize metrics system
	if err := metrics.InitMetricsDB(); err != nil {
		fmt.Printf("Warning: Failed to initialize metrics DB: %v\n", err)
	} else {
		metrics.StartCollector()
	}

	// Initialize PostgreSQL Proxy - Check if we should only run the proxy
	if os.Getenv("PROXY_ONLY") == "true" {
		fmt.Println("Initializing PostgreSQL Proxy (Standalone mode)...")
		if err := proxy.Run(); err != nil {
			fmt.Printf("Error starting proxy: %v\n", err)
			os.Exit(1)
		}
		// Block forever as proxy is running
		select {}
	}

	// Normal startup: Continue with Docker and API initialization
	fmt.Println("Initializing Docker network...")
	if err := docker.EnsureNetwork(); err != nil {
		fmt.Printf("Warning: Failed to create Docker network: %v\n", err)
	}

	fmt.Println("Initializing PostgreSQL Proxy (Background mode)...")
	go func() {
		if err := proxy.Run(); err != nil {
			fmt.Printf("Error starting proxy: %v\n", err)
		}
	}()

	// Restore Web Server (Caddy) configuration if domain is set
	go func() {
		domain, _ := db.GetSetting("domain_name")
		if domain != "" {
			fmt.Printf("Restoring Web Server configuration for domain: %s\n", domain)
			if err := system.ProvisionSSL(domain); err != nil {
				fmt.Printf("Warning: Failed to restore Web Server configuration: %v\n", err)
			}
		}
	}()

	// Initialize update checker
	fmt.Println("Initializing Update Sentinel...")
	system.InitUpdateChecker()

	r := gin.Default()

	// ========== AUTH ENDPOINTS (Unprotected) ==========

	// Auth status - tell if there's an admin user
	r.GET("/api/auth/status", func(c *gin.Context) {
		hasUser, err := db.HasAnyUser()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to check users"})
			return
		}
		c.JSON(200, gin.H{"initialized": hasUser})
	})

	// Login endpoint
	r.POST("/api/auth/login", func(c *gin.Context) {
		var req struct {
			Email    string `json:"email" binding:"required"`
			Password string `json:"password" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Email and password are required"})
			return
		}

		user, err := db.GetUserByEmail(req.Email)
		if err != nil {
			c.JSON(500, gin.H{"error": "Internal server error"})
			return
		}

		if user == nil || !db.CheckPasswordHash(req.Password, user.PasswordHash) {
			system.NotifyGlobalEventAsync(
				db.NotificationEventAuthLoginFailed,
				"Baseful auth: login failed",
				fmt.Sprintf("Failed login attempt for email %s from IP %s at %s", req.Email, c.ClientIP(), time.Now().Format(time.RFC3339)),
				2*time.Minute,
				req.Email,
			)
			c.JSON(401, gin.H{"error": "Invalid email or password"})
			return
		}

		token, err := auth.GenerateUserJWT(user.ID, user.Email, user.IsAdmin)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to generate session"})
			return
		}
		setSessionCookie(c, token)
		permissions := getUserPermissionsForResponse(user.ID, user.IsAdmin)

		c.JSON(200, gin.H{
			"token": token,
			"user": gin.H{
				"id":          user.ID,
				"email":       user.Email,
				"firstName":   user.FirstName,
				"lastName":    user.LastName,
				"isAdmin":     user.IsAdmin,
				"permissions": permissions,
			},
		})
	})

	// Register endpoint (First User or Whitelisted)
	r.POST("/api/auth/register", func(c *gin.Context) {
		var req struct {
			Email     string `json:"email" binding:"required"`
			Password  string `json:"password" binding:"required"`
			FirstName string `json:"firstName" binding:"required"`
			LastName  string `json:"lastName" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Missing required fields"})
			return
		}

		// Check if any users exist
		hasUser, err := db.HasAnyUser()
		if err != nil {
			c.JSON(500, gin.H{"error": "Internal server error"})
			return
		}

		isAdmin := false
		if !hasUser {
			// First user is Admin
			isAdmin = true
		} else {
			// Not first user, check whitelist
			whitelisted, err := db.IsEmailWhitelisted(req.Email)
			if err != nil {
				c.JSON(500, gin.H{"error": "Internal server error"})
				return
			}
			if !whitelisted {
				system.NotifyGlobalEventAsync(
					db.NotificationEventAuthRegisterBlocked,
					"Baseful auth: signup blocked",
					fmt.Sprintf("Signup blocked for non-whitelisted email %s from IP %s at %s", req.Email, c.ClientIP(), time.Now().Format(time.RFC3339)),
					2*time.Minute,
					req.Email,
				)
				c.JSON(403, gin.H{"error": "This email is not whitelisted"})
				return
			}
		}

		// Create user
		userID, err := db.CreateUser(req.Email, req.Password, req.FirstName, req.LastName, isAdmin)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create user"})
			return
		}

		token, _ := auth.GenerateUserJWT(userID, req.Email, isAdmin)
		setSessionCookie(c, token)
		permissions := getUserPermissionsForResponse(userID, isAdmin)
		system.NotifyGlobalEventAsync(
			db.NotificationEventAuthRegisterSuccess,
			"Baseful auth: account created",
			fmt.Sprintf("Account created for %s at %s", req.Email, time.Now().Format(time.RFC3339)),
			time.Minute,
			req.Email,
		)
		c.JSON(201, gin.H{
			"token": token,
			"user": gin.H{
				"id":          userID,
				"email":       req.Email,
				"firstName":   req.FirstName,
				"lastName":    req.LastName,
				"isAdmin":     isAdmin,
				"permissions": permissions,
			},
		})
	})

	// Debug endpoint to reset admin (Only for dev/retry)
	r.POST("/api/debug/reset-admin", func(c *gin.Context) {
		_, err := db.DB.Exec("DELETE FROM users")
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to reset users"})
			return
		}
		c.JSON(200, gin.H{"message": "All users deleted. You can now setup a new admin."})
	})

	r.POST("/api/auth/logout", func(c *gin.Context) {
		clearSessionCookie(c)
		c.JSON(200, gin.H{"message": "Logged out"})
	})

	// ========== STATIC ASSETS & PUBLIC ROUTES ==========
	r.Static("/uploads", "./uploads")

	// Serve static files from frontend/dist if it exists
	// This will serve the built Vite app in a production container
	if _, err := os.Stat("./frontend/dist"); err == nil {
		r.StaticFS("/assets", http.Dir("./frontend/dist/assets"))
		r.StaticFile("/favicon.ico", "./frontend/dist/favicon.ico")
		r.StaticFile("/logo.png", "./frontend/dist/logo.png")
		r.StaticFile("/vite.svg", "./frontend/dist/vite.svg")

		// Catch-all route for SPA: serve index.html for any other route
		r.NoRoute(func(c *gin.Context) {
			if !strings.HasPrefix(c.Request.URL.Path, "/api") && !strings.HasPrefix(c.Request.URL.Path, "/uploads") {
				c.File("./frontend/dist/index.html")
			}
		})
	}

	r.Use(auth.AuthMiddleware())

	// Profile endpoint
	r.GET("/api/auth/me", func(c *gin.Context) {
		email := c.MustGet("email").(string)
		user, err := db.GetUserByEmail(email)
		if err != nil || user == nil {
			c.JSON(404, gin.H{"error": "User not found"})
			return
		}
		// Migration support: if client authenticated with Bearer token, also issue HttpOnly cookie.
		authHeader := c.GetHeader("Authorization")
		parts := strings.Fields(authHeader)
		if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") && parts[1] != "" {
			setSessionCookie(c, parts[1])
		}
		permissions := getUserPermissionsForResponse(user.ID, user.IsAdmin)

		c.JSON(200, gin.H{
			"id":          user.ID,
			"email":       user.Email,
			"firstName":   user.FirstName,
			"lastName":    user.LastName,
			"isAdmin":     user.IsAdmin,
			"avatarUrl":   user.AvatarURL,
			"permissions": permissions,
		})
	})

	// Update profile
	r.PUT("/api/auth/profile", func(c *gin.Context) {
		var req struct {
			Email     string `json:"email" binding:"required"`
			FirstName string `json:"firstName" binding:"required"`
			LastName  string `json:"lastName" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Missing required fields"})
			return
		}

		userID := c.MustGet("user_id").(int)
		if err := db.UpdateUser(userID, req.Email, req.FirstName, req.LastName); err != nil {
			c.JSON(500, gin.H{"error": "Failed to update profile"})
			return
		}

		c.JSON(200, gin.H{"message": "Profile updated successfully"})
	})

	// Change password
	r.PUT("/api/auth/password", func(c *gin.Context) {
		var req struct {
			CurrentPassword string `json:"currentPassword" binding:"required"`
			NewPassword     string `json:"newPassword" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Current and new passwords are required"})
			return
		}

		email := c.MustGet("email").(string)
		user, err := db.GetUserByEmail(email)
		if err != nil || user == nil {
			c.JSON(404, gin.H{"error": "User not found"})
			return
		}

		if !db.CheckPasswordHash(req.CurrentPassword, user.PasswordHash) {
			c.JSON(401, gin.H{"error": "Incorrect current password"})
			return
		}

		if err := db.UpdateUserPassword(user.ID, req.NewPassword); err != nil {
			c.JSON(500, gin.H{"error": "Failed to update password"})
			return
		}

		c.JSON(200, gin.H{"message": "Password updated successfully"})
	})

	// Upload avatar
	r.POST("/api/auth/avatar", func(c *gin.Context) {
		userID := c.MustGet("user_id").(int)
		log.Printf("Received avatar upload request from user ID: %d\n", userID)

		file, err := c.FormFile("avatar")
		if err != nil {
			log.Printf("Error getting form file: %v\n", err)
			c.JSON(400, gin.H{"error": "No avatar file uploaded or invalid format"})
			return
		}

		// Create uploads directory if it doesn't exist
		uploadDir := "./uploads/avatars"
		if err := os.MkdirAll(uploadDir, 0755); err != nil {
			log.Printf("Error creating directory: %v\n", err)
			c.JSON(500, gin.H{"error": "Failed to create upload directory"})
			return
		}

		filename := fmt.Sprintf("%d_%d_%s", userID, time.Now().Unix(), file.Filename)
		filepath := fmt.Sprintf("%s/%s", uploadDir, filename)
		log.Printf("Saving avatar to: %s\n", filepath)

		if err := c.SaveUploadedFile(file, filepath); err != nil {
			log.Printf("Error saving file: %v\n", err)
			c.JSON(500, gin.H{"error": "Failed to save avatar"})
			return
		}

		avatarURL := fmt.Sprintf("/uploads/avatars/%s", filename)
		if err := db.UpdateUserAvatar(userID, avatarURL); err != nil {
			log.Printf("Error updating DB: %v\n", err)
			c.JSON(500, gin.H{"error": "Failed to update user avatar"})
			return
		}

		log.Printf("Avatar uploaded successfully: %s\n", avatarURL)
		c.JSON(200, gin.H{"avatarUrl": avatarURL})
	})

	// OpenRouter API key status
	r.GET("/api/auth/openrouter-key", func(c *gin.Context) {
		userID := c.MustGet("user_id").(int)
		apiKey, err := db.GetUserOpenRouterAPIKey(userID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to load OpenRouter key status"})
			return
		}

		trimmed := strings.TrimSpace(apiKey)
		c.JSON(200, gin.H{
			"configured": len(trimmed) > 0,
			"maskedKey":  maskAPIKey(trimmed),
		})
	})

	// Set or clear OpenRouter API key
	r.PUT("/api/auth/openrouter-key", func(c *gin.Context) {
		userID := c.MustGet("user_id").(int)
		var req struct {
			APIKey string `json:"apiKey"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		apiKey := strings.TrimSpace(req.APIKey)
		if err := db.UpdateUserOpenRouterAPIKey(userID, apiKey); err != nil {
			c.JSON(500, gin.H{"error": "Failed to save OpenRouter API key"})
			return
		}

		c.JSON(200, gin.H{
			"configured": len(apiKey) > 0,
			"maskedKey":  maskAPIKey(apiKey),
		})
	})

	// Whitelist management (Admin only)
	r.GET("/api/auth/whitelist", auth.AdminOnly(), func(c *gin.Context) {
		emails, err := db.GetWhitelistedEmails()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query whitelist"})
			return
		}
		c.JSON(200, emails)
	})

	r.POST("/api/auth/whitelist", auth.AdminOnly(), func(c *gin.Context) {
		var req struct {
			Email string `json:"email" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Email is required"})
			return
		}
		if err := db.AddEmailToWhitelist(req.Email); err != nil {
			c.JSON(500, gin.H{"error": "Failed to add email to whitelist"})
			return
		}
		c.JSON(200, gin.H{"message": "Email added to whitelist"})
	})

	r.DELETE("/api/auth/whitelist/:email", auth.AdminOnly(), func(c *gin.Context) {
		email := c.Param("email")
		if err := db.RemoveEmailFromWhitelist(email); err != nil {
			c.JSON(500, gin.H{"error": "Failed to remove email from whitelist"})
			return
		}
		c.JSON(200, gin.H{"message": "Email removed from whitelist"})
	})

	// List users (Admin only)
	r.GET("/api/auth/users", auth.AdminOnly(), func(c *gin.Context) {
		users, err := db.GetAllUsers()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query users"})
			return
		}
		c.JSON(200, users)
	})

	// Get project access for a user (Admin only)
	r.GET("/api/auth/users/:id/project-access", auth.AdminOnly(), func(c *gin.Context) {
		userID, err := strconv.Atoi(c.Param("id"))
		if err != nil || userID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid user ID"})
			return
		}

		user, err := db.GetUserByID(userID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query user"})
			return
		}
		if user == nil {
			c.JSON(404, gin.H{"error": "User not found"})
			return
		}

		projectIDs, err := db.GetUserProjectAccess(userID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query user project access"})
			return
		}

		c.JSON(200, gin.H{"projectIds": projectIDs})
	})

	// Replace project access for a user (Admin only)
	r.PUT("/api/auth/users/:id/project-access", auth.AdminOnly(), func(c *gin.Context) {
		userID, err := strconv.Atoi(c.Param("id"))
		if err != nil || userID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid user ID"})
			return
		}

		user, err := db.GetUserByID(userID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query user"})
			return
		}
		if user == nil {
			c.JSON(404, gin.H{"error": "User not found"})
			return
		}

		var req struct {
			ProjectIDs []int `json:"projectIds"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request body"})
			return
		}

		for _, projectID := range req.ProjectIDs {
			if projectID <= 0 {
				c.JSON(400, gin.H{"error": "Project IDs must be positive integers"})
				return
			}
			var count int
			if err := db.DB.QueryRow("SELECT COUNT(*) FROM projects WHERE id = ?", projectID).Scan(&count); err != nil {
				c.JSON(500, gin.H{"error": "Failed to validate project IDs"})
				return
			}
			if count == 0 {
				c.JSON(400, gin.H{"error": fmt.Sprintf("Project %d does not exist", projectID)})
				return
			}
		}

		if err := db.SetUserProjectAccess(userID, req.ProjectIDs); err != nil {
			c.JSON(500, gin.H{"error": "Failed to update project access"})
			return
		}

		c.JSON(200, gin.H{"message": "Project access updated"})
	})

	// Get list of available permission keys (Admin only)
	r.GET("/api/auth/permissions", auth.AdminOnly(), func(c *gin.Context) {
		c.JSON(200, gin.H{"permissions": db.AvailablePermissionKeys})
	})

	// Get permissions for a user (Admin only)
	r.GET("/api/auth/users/:id/permissions", auth.AdminOnly(), func(c *gin.Context) {
		userID, err := strconv.Atoi(c.Param("id"))
		if err != nil || userID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid user ID"})
			return
		}

		user, err := db.GetUserByID(userID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query user"})
			return
		}
		if user == nil {
			c.JSON(404, gin.H{"error": "User not found"})
			return
		}

		permissions := getUserPermissionsForResponse(userID, user.IsAdmin)
		c.JSON(200, gin.H{"permissions": permissions})
	})

	// Replace permissions for a user (Admin only)
	r.PUT("/api/auth/users/:id/permissions", auth.AdminOnly(), func(c *gin.Context) {
		userID, err := strconv.Atoi(c.Param("id"))
		if err != nil || userID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid user ID"})
			return
		}

		user, err := db.GetUserByID(userID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query user"})
			return
		}
		if user == nil {
			c.JSON(404, gin.H{"error": "User not found"})
			return
		}
		if user.IsAdmin {
			c.JSON(400, gin.H{"error": "Admin users always have full permissions"})
			return
		}

		var req struct {
			Permissions []string `json:"permissions"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request body"})
			return
		}

		for _, permission := range req.Permissions {
			if !db.IsValidPermissionKey(permission) {
				c.JSON(400, gin.H{"error": fmt.Sprintf("Unknown permission: %s", permission)})
				return
			}
		}

		if err := db.SetUserPermissions(userID, req.Permissions); err != nil {
			c.JSON(500, gin.H{"error": "Failed to update permissions"})
			return
		}

		c.JSON(200, gin.H{"message": "Permissions updated"})
	})

	// Delete user (Admin only) - "Kick user"
	r.DELETE("/api/auth/users/:id", auth.AdminOnly(), func(c *gin.Context) {
		userID, err := strconv.Atoi(c.Param("id"))
		if err != nil || userID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid user ID"})
			return
		}

		requesterID := c.MustGet("user_id").(int)
		if requesterID == userID {
			c.JSON(400, gin.H{"error": "You cannot remove your own account"})
			return
		}

		targetUser, err := db.GetUserByID(userID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query user"})
			return
		}
		if targetUser == nil {
			c.JSON(404, gin.H{"error": "User not found"})
			return
		}

		var adminCount int
		if err := db.DB.QueryRow("SELECT COUNT(*) FROM users WHERE is_admin = 1").Scan(&adminCount); err != nil {
			c.JSON(500, gin.H{"error": "Failed to validate admin count"})
			return
		}
		if targetUser.IsAdmin && adminCount <= 1 {
			c.JSON(400, gin.H{"error": "Cannot remove the last admin user"})
			return
		}

		if err := db.DeleteUserByID(userID); err != nil {
			c.JSON(500, gin.H{"error": "Failed to remove user"})
			return
		}

		c.JSON(200, gin.H{"message": "User removed successfully"})
	})

	r.GET("/api/hello", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "Baseful API is running"})
	})

	r.GET("/api/system/update-status", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionServerAccess) {
			return
		}
		c.JSON(200, system.GetUpdateStatus())
	})

	// Web Server Endpoints
	r.GET("/api/system/webserver/status", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionServerAccess) {
			return
		}
		info, err := system.GetDomainInfo()
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, info)
	})

	r.POST("/api/system/webserver/domain", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionServerAccess) {
			return
		}
		var req struct {
			Domain string `json:"domain"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		if err := system.SaveDomain(req.Domain); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"message": "Domain saved"})
	})

	r.GET("/api/system/webserver/check-dns", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionServerAccess) {
			return
		}
		domain, _ := db.GetSetting("domain_name")
		if domain == "" {
			c.JSON(400, gin.H{"error": "No domain configured"})
			return
		}
		propagated, err := system.CheckPropagation(domain)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"propagated": propagated})
	})

	r.POST("/api/system/webserver/provision-ssl", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionServerAccess) {
			return
		}
		domain, _ := db.GetSetting("domain_name")
		if domain == "" {
			c.JSON(400, gin.H{"error": "No domain configured"})
			return
		}
		if err := system.ProvisionSSL(domain); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"message": "SSL provisioned successfully"})
	})

	// Get monitoring settings
	r.GET("/api/settings", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionServerAccess) {
			return
		}
		enabled, _ := db.GetSetting("metrics_enabled")
		rateStr, _ := db.GetSetting("metrics_sample_rate")
		rate, _ := strconv.Atoi(rateStr)
		c.JSON(200, gin.H{
			"metrics_enabled":     enabled == "true",
			"metrics_sample_rate": rate,
		})
	})

	// Update monitoring settings
	r.POST("/api/settings", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionServerAccess) {
			return
		}
		var req struct {
			MetricsEnabled    bool   `json:"metrics_enabled"`
			MetricsSampleRate string `json:"metrics_sample_rate"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		enabledStr := "false"
		if req.MetricsEnabled {
			enabledStr = "true"
		}

		_ = db.UpdateSetting("metrics_enabled", enabledStr)
		_ = db.UpdateSetting("metrics_sample_rate", req.MetricsSampleRate)

		c.JSON(200, gin.H{"status": "ok"})
	})

	r.GET("/api/system/notifications", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionManageNotifications) {
			return
		}
		settings, err := db.GetNotificationSettings()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to fetch notification settings"})
			return
		}

		c.JSON(200, settings)
	})

	r.PUT("/api/system/notifications", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionManageNotifications) {
			return
		}
		var req db.NotificationSettings
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request body"})
			return
		}

		if req.SMTPPort <= 0 {
			req.SMTPPort = 587
		}
		if req.SMTPPort < 1 || req.SMTPPort > 65535 {
			c.JSON(400, gin.H{"error": "SMTP port must be between 1 and 65535"})
			return
		}

		if err := db.UpdateNotificationSettings(req); err != nil {
			c.JSON(500, gin.H{"error": "Failed to save notification settings"})
			return
		}

		c.JSON(200, gin.H{"message": "Notification settings saved"})
	})

	r.GET("/api/system/notifications/master", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionManageNotifications) {
			return
		}
		enabled, err := db.IsNotificationsMasterEnabled()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to fetch notifications master setting"})
			return
		}
		c.JSON(200, gin.H{"enabled": enabled})
	})

	r.PUT("/api/system/notifications/master", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionManageNotifications) {
			return
		}
		var req struct {
			Enabled bool `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request body"})
			return
		}
		if err := db.SetNotificationsMasterEnabled(req.Enabled); err != nil {
			c.JSON(500, gin.H{"error": "Failed to update notifications master setting"})
			return
		}
		c.JSON(200, gin.H{"enabled": req.Enabled})
	})

	r.GET("/api/system/notification-preferences", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionManageNotifications) {
			return
		}
		prefs, err := db.GetGlobalNotificationPreferences()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to fetch global notification preferences"})
			return
		}
		c.JSON(200, prefs)
	})

	r.PUT("/api/system/notification-preferences", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionManageNotifications) {
			return
		}
		var req map[string]bool
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request body"})
			return
		}

		if err := db.UpsertGlobalNotificationPreferences(req); err != nil {
			c.JSON(500, gin.H{"error": "Failed to save global notification preferences"})
			return
		}

		prefs, err := db.GetGlobalNotificationPreferences()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to fetch updated global notification preferences"})
			return
		}
		c.JSON(200, prefs)
	})

	r.GET("/api/databases/:id/notification-preferences", func(c *gin.Context) {
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, id) {
			return
		}
		if !requirePermission(c, db.PermissionManageNotifications) {
			return
		}

		var count int
		if err := db.DB.QueryRow("SELECT COUNT(*) FROM databases WHERE id = ?", id).Scan(&count); err != nil || count == 0 {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		prefs, err := db.GetDatabaseNotificationPreferences(id)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to fetch notification preferences"})
			return
		}
		c.JSON(200, prefs)
	})

	r.PUT("/api/databases/:id/notification-preferences", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionManageNotifications) {
			return
		}
		masterEnabled, err := db.IsNotificationsMasterEnabled()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to read notifications master setting"})
			return
		}
		if !masterEnabled {
			c.JSON(403, gin.H{"error": "Notifications are disabled by master toggle. Enable notifications in Server Notification Center first."})
			return
		}

		id, err := strconv.Atoi(c.Param("id"))
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, id) {
			return
		}

		var count int
		if err := db.DB.QueryRow("SELECT COUNT(*) FROM databases WHERE id = ?", id).Scan(&count); err != nil || count == 0 {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		var req map[string]bool
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request body"})
			return
		}

		if err := db.UpsertDatabaseNotificationPreferences(id, req); err != nil {
			c.JSON(500, gin.H{"error": "Failed to save notification preferences"})
			return
		}

		prefs, err := db.GetDatabaseNotificationPreferences(id)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to fetch updated preferences"})
			return
		}
		c.JSON(200, prefs)
	})

	r.POST("/api/system/notifications/test-email", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionManageNotifications) {
			return
		}
		masterEnabled, err := db.IsNotificationsMasterEnabled()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to read notifications master setting"})
			return
		}
		if !masterEnabled {
			c.JSON(403, gin.H{"error": "Notifications are disabled by master toggle"})
			return
		}

		var req struct {
			db.NotificationSettings
			TestEmail string `json:"test_email"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request body"})
			return
		}

		if req.SMTPPort <= 0 {
			req.SMTPPort = 587
		}
		if req.SMTPPort < 1 || req.SMTPPort > 65535 {
			c.JSON(400, gin.H{"error": "SMTP port must be between 1 and 65535"})
			return
		}

		recipient := strings.TrimSpace(req.TestEmail)
		if recipient == "" {
			recipient = strings.TrimSpace(req.SMTPToEmail)
		}
		if recipient == "" {
			recipient = strings.TrimSpace(req.SMTPFromEmail)
		}
		if recipient == "" {
			username := strings.TrimSpace(req.SMTPUsername)
			if strings.Contains(username, "@") {
				recipient = username
			}
		}
		if recipient == "" {
			c.JSON(400, gin.H{"error": "Provide a test_email, smtp_to_email, smtp_from_email, or SMTP username with an email address"})
			return
		}

		email := c.MustGet("email").(string)
		subject := "Baseful SMTP test notification"
		body := fmt.Sprintf("This is a test email from Baseful.\n\nTriggered by: %s\nTime: %s", email, time.Now().Format(time.RFC3339))
		if err := system.SendSMTPEmail(req.NotificationSettings, recipient, subject, body); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, gin.H{"message": fmt.Sprintf("Test email sent to %s", recipient)})
	})

	r.POST("/api/system/notifications/test-discord", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionManageNotifications) {
			return
		}
		masterEnabled, err := db.IsNotificationsMasterEnabled()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to read notifications master setting"})
			return
		}
		if !masterEnabled {
			c.JSON(403, gin.H{"error": "Notifications are disabled by master toggle"})
			return
		}

		var req db.NotificationSettings
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request body"})
			return
		}

		email := c.MustGet("email").(string)
		message := fmt.Sprintf("Baseful Discord webhook test notification.\nTriggered by: %s\nTime: %s", email, time.Now().Format(time.RFC3339))
		if err := system.SendDiscordWebhook(req.DiscordWebhookURL, message); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, gin.H{"message": "Discord webhook test sent"})
	})

	r.POST("/api/system/update-check", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionServerAccess) {
			return
		}
		system.CheckForUpdates()
		c.JSON(200, system.GetUpdateStatus())
	})

	r.POST("/api/system/update", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionServerAccess) {
			return
		}
		if err := system.RunUpdate(); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"message": "Update initiated successfully. The system will restart in a few moments."})
	})

	// ========== BACKUPS API ==========
	r.GET("/api/databases/:id/backups", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, id) {
			return
		}
		list, err := backups.ListBackups(id)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		// If list is nil (empty), return empty array
		if list == nil {
			list = []backups.Backup{}
		}
		c.JSON(200, list)
	})

	r.GET("/api/databases/:id/backups/settings", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, id) {
			return
		}
		settings, err := backups.GetBackupSettings(id)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, settings)
	})

	r.POST("/api/databases/:id/backups/settings", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, id) {
			return
		}
		var settings backups.BackupSettings
		if err := c.BindJSON(&settings); err != nil {
			c.JSON(400, gin.H{"error": "Invalid JSON"})
			return
		}
		settings.DatabaseID = id
		if err := backups.SaveBackupSettings(&settings); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"message": "Settings saved"})
	})

	r.POST("/api/databases/:id/backups/manual", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, id) {
			return
		}
		go func() {
			fmt.Printf("Starting manual backup for DB %d...\n", id)
			if err := backups.PerformBackup(id); err != nil {
				fmt.Printf("Backup failed for DB %d: %v\n", id, err)
				system.NotifyDatabaseEventAsync(
					id,
					db.NotificationEventBackupFailed,
					"Baseful backup failed",
					fmt.Sprintf("Database ID %d backup failed at %s.\nError: %v", id, time.Now().Format(time.RFC3339), err),
					0,
					"",
				)
			} else {
				fmt.Printf("Backup completed for DB %d\n", id)
				system.NotifyDatabaseEventAsync(
					id,
					db.NotificationEventBackupCompleted,
					"Baseful backup completed",
					fmt.Sprintf("Database ID %d backup completed at %s.", id, time.Now().Format(time.RFC3339)),
					0,
					"",
				)
			}
		}()
		c.JSON(200, gin.H{"message": "Backup started"})
	})

	r.POST("/api/databases/:id/backups/:backupId/restore", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, id) {
			return
		}
		backupIdStr := c.Param("backupId")
		backupId, err := strconv.Atoi(backupIdStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid backup ID"})
			return
		}

		system.NotifyDatabaseEventAsync(
			id,
			db.NotificationEventRestoreStarted,
			"Baseful restore started",
			fmt.Sprintf("Restore started for database ID %d from backup ID %d at %s.", id, backupId, time.Now().Format(time.RFC3339)),
			0,
			"",
		)
		go func() {
			fmt.Printf("Starting restore for DB %d from backup %d...\n", id, backupId)
			if err := backups.RestoreBackup(id, backupId); err != nil {
				fmt.Printf("Restore failed for DB %d: %v\n", id, backupId)
				system.NotifyDatabaseEventAsync(
					id,
					db.NotificationEventRestoreFailed,
					"Baseful restore failed",
					fmt.Sprintf("Restore failed for database ID %d from backup ID %d at %s.\nError: %v", id, backupId, time.Now().Format(time.RFC3339), err),
					0,
					"",
				)
			} else {
				fmt.Printf("Restore completed for DB %d\n", id)
				system.NotifyDatabaseEventAsync(
					id,
					db.NotificationEventRestoreCompleted,
					"Baseful restore completed",
					fmt.Sprintf("Restore completed for database ID %d from backup ID %d at %s.", id, backupId, time.Now().Format(time.RFC3339)),
					0,
					"",
				)
			}
		}()
		c.JSON(200, gin.H{"message": "Restore started"})
	})

	r.POST("/api/databases/:id/backups/:backupId/download-decrypted", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, id) {
			return
		}
		backupIdStr := c.Param("backupId")
		backupId, err := strconv.Atoi(backupIdStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid backup ID"})
			return
		}

		var req struct {
			PrivateKey string `json:"private_key"`
			Passphrase string `json:"passphrase"`
		}
		_ = c.ShouldBindJSON(&req)

		reader, filename, _, err := backups.GetBackupDownloadReader(id, backupId, req.PrivateKey, req.Passphrase)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		defer reader.Close()

		c.Header("Content-Type", "application/sql")
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
		if _, err := io.Copy(c.Writer, reader); err != nil {
			c.JSON(500, gin.H{"error": "Failed to stream backup"})
			return
		}
	})

	r.POST("/api/databases/:id/backups/:backupId/restore-with-key", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, id) {
			return
		}
		backupIdStr := c.Param("backupId")
		backupId, err := strconv.Atoi(backupIdStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid backup ID"})
			return
		}

		var req struct {
			PrivateKey string `json:"private_key"`
			Passphrase string `json:"passphrase"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request body"})
			return
		}
		if strings.TrimSpace(req.PrivateKey) == "" {
			c.JSON(400, gin.H{"error": "private_key is required"})
			return
		}

		// Validate key/decryption upfront so the client gets immediate feedback for wrong keys.
		reader, _, _, err := backups.GetBackupDownloadReader(id, backupId, req.PrivateKey, req.Passphrase)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		_ = reader.Close()

		system.NotifyDatabaseEventAsync(
			id,
			db.NotificationEventRestoreStarted,
			"Baseful restore started",
			fmt.Sprintf("Encrypted restore started for database ID %d from backup ID %d at %s.", id, backupId, time.Now().Format(time.RFC3339)),
			0,
			"",
		)
		go func() {
			fmt.Printf("Starting encrypted restore for DB %d from backup %d...\n", id, backupId)
			if err := backups.RestoreBackupWithPrivateKey(id, backupId, req.PrivateKey, req.Passphrase); err != nil {
				fmt.Printf("Encrypted restore failed for DB %d backup %d: %v\n", id, backupId, err)
				system.NotifyDatabaseEventAsync(
					id,
					db.NotificationEventRestoreFailed,
					"Baseful restore failed",
					fmt.Sprintf("Encrypted restore failed for database ID %d from backup ID %d at %s.\nError: %v", id, backupId, time.Now().Format(time.RFC3339), err),
					0,
					"",
				)
			} else {
				fmt.Printf("Encrypted restore completed for DB %d backup %d\n", id, backupId)
				system.NotifyDatabaseEventAsync(
					id,
					db.NotificationEventRestoreCompleted,
					"Baseful restore completed",
					fmt.Sprintf("Encrypted restore completed for database ID %d from backup ID %d at %s.", id, backupId, time.Now().Format(time.RFC3339)),
					0,
					"",
				)
			}
		}()
		c.JSON(200, gin.H{"message": "Restore started"})
	})

	// Restore from uploaded file
	r.POST("/api/databases/:id/restore/file", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, id) {
			return
		}

		file, header, err := c.Request.FormFile("file")
		if err != nil {
			c.JSON(400, gin.H{"error": "No file uploaded"})
			return
		}
		defer file.Close()

		fmt.Printf("Starting restore for DB %d from uploaded file: %s\n", id, header.Filename)
		system.NotifyDatabaseEventAsync(
			id,
			db.NotificationEventRestoreStarted,
			"Baseful restore started",
			fmt.Sprintf("Restore from uploaded file started for database ID %d at %s. File: %s", id, time.Now().Format(time.RFC3339), header.Filename),
			0,
			"",
		)

		go func() {
			if err := backups.RestoreFromFile(id, file); err != nil {
				fmt.Printf("Restore from file failed for DB %d: %v\n", id, err)
				system.NotifyDatabaseEventAsync(
					id,
					db.NotificationEventRestoreFailed,
					"Baseful restore failed",
					fmt.Sprintf("Restore from uploaded file failed for database ID %d at %s.\nError: %v", id, time.Now().Format(time.RFC3339), err),
					0,
					"",
				)
			} else {
				fmt.Printf("Restore from file completed for DB %d\n", id)
				system.NotifyDatabaseEventAsync(
					id,
					db.NotificationEventRestoreCompleted,
					"Baseful restore completed",
					fmt.Sprintf("Restore from uploaded file completed for database ID %d at %s.", id, time.Now().Format(time.RFC3339)),
					0,
					"",
				)
			}
		}()
		c.JSON(200, gin.H{"message": "Restore started"})
	})

	// Restore from external connection
	r.POST("/api/databases/:id/restore/connection", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, id) {
			return
		}

		var req struct {
			ConnectionString string `json:"connection_string"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request body"})
			return
		}

		if req.ConnectionString == "" {
			c.JSON(400, gin.H{"error": "Connection string is required"})
			return
		}

		fmt.Printf("Starting restore for DB %d from external connection\n", id)
		system.NotifyDatabaseEventAsync(
			id,
			db.NotificationEventRestoreStarted,
			"Baseful restore started",
			fmt.Sprintf("Restore from external connection started for database ID %d at %s.", id, time.Now().Format(time.RFC3339)),
			0,
			"",
		)

		go func() {
			if err := backups.RestoreFromConnection(id, req.ConnectionString); err != nil {
				fmt.Printf("Restore from connection failed for DB %d: %v\n", id, err)
				system.NotifyDatabaseEventAsync(
					id,
					db.NotificationEventRestoreFailed,
					"Baseful restore failed",
					fmt.Sprintf("Restore from external connection failed for database ID %d at %s.\nError: %v", id, time.Now().Format(time.RFC3339), err),
					0,
					"",
				)
			} else {
				fmt.Printf("Restore from connection completed for DB %d\n", id)
				system.NotifyDatabaseEventAsync(
					id,
					db.NotificationEventRestoreCompleted,
					"Baseful restore completed",
					fmt.Sprintf("Restore from external connection completed for database ID %d at %s.", id, time.Now().Format(time.RFC3339)),
					0,
					"",
				)
			}
		}()
		c.JSON(200, gin.H{"message": "Restore started"})
	})

	// ========== PROJECTS API ==========

	// Get all projects
	r.GET("/api/projects", func(c *gin.Context) {
		isAdmin := c.MustGet("is_admin").(bool)
		userID := c.MustGet("user_id").(int)

		query := "SELECT id, name, description, created_at FROM projects ORDER BY created_at DESC"
		args := []interface{}{}
		if !isAdmin {
			query = `
				SELECT p.id, p.name, p.description, p.created_at
				FROM projects p
				INNER JOIN user_project_access upa ON upa.project_id = p.id
				WHERE upa.user_id = ?
				ORDER BY p.created_at DESC
			`
			args = append(args, userID)
		}

		rows, err := db.DB.Query(query, args...)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query projects: " + err.Error()})
			return
		}
		defer rows.Close()

		projects := []map[string]interface{}{}
		for rows.Next() {
			var id int
			var name, description, createdAt string
			if err := rows.Scan(&id, &name, &description, &createdAt); err != nil {
				c.JSON(500, gin.H{"error": "Failed to scan project: " + err.Error()})
				return
			}

			projects = append(projects, map[string]interface{}{
				"id":          id,
				"name":        name,
				"description": description,
				"created_at":  createdAt,
				"users":       []interface{}{}, // Default empty list
			})
		}

		// Now fetch users for each project that was returned
		for i, p := range projects {
			projectID := p["id"].(int)
			users, err := db.GetProjectUsers(projectID)
			if err == nil {
				userList := []map[string]interface{}{}
				for _, u := range users {
					userList = append(userList, map[string]interface{}{
						"id":        u.ID,
						"email":     u.Email,
						"avatarUrl": u.AvatarURL,
					})
				}
				projects[i]["users"] = userList
			}
		}

		c.JSON(http.StatusOK, projects)
	})

	// Create project
	r.POST("/api/projects", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionCreateProjects) {
			return
		}
		userID := c.MustGet("user_id").(int)
		isAdmin := c.MustGet("is_admin").(bool)

		var req struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		if req.Name == "" {
			c.JSON(400, gin.H{"error": "Project name is required"})
			return
		}

		result, err := db.DB.Exec(
			"INSERT INTO projects (name, description) VALUES (?, ?)",
			req.Name, req.Description,
		)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create project: " + err.Error()})
			return
		}

		id, _ := result.LastInsertId()

		if !isAdmin {
			if _, err := db.DB.Exec(
				"INSERT OR IGNORE INTO user_project_access (user_id, project_id, created_by) VALUES (?, ?, ?)",
				userID, id, userID,
			); err != nil {
				c.JSON(500, gin.H{"error": "Failed to grant creator access to project"})
				return
			}
		}

		c.JSON(201, gin.H{
			"id":          id,
			"name":        req.Name,
			"description": req.Description,
		})
	})

	// Get single project by ID
	r.GET("/api/projects/:id", func(c *gin.Context) {
		id := c.Param("id")
		projectID, err := strconv.Atoi(id)
		if err != nil || projectID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid project ID"})
			return
		}
		if !requireProjectAccess(c, projectID) {
			return
		}
		var dbProjectID int
		var name, description, createdAt string

		err = db.DB.QueryRow(
			"SELECT id, name, description, created_at FROM projects WHERE id = ?",
			id,
		).Scan(&dbProjectID, &name, &description, &createdAt)

		if err != nil {
			c.JSON(404, gin.H{"error": "Project not found"})
			return
		}

		c.JSON(200, gin.H{
			"id":          dbProjectID,
			"name":        name,
			"description": description,
			"created_at":  createdAt,
		})
	})

	// Update project
	r.PUT("/api/projects/:id", func(c *gin.Context) {
		id := c.Param("id")
		projectID, err := strconv.Atoi(id)
		if err != nil || projectID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid project ID"})
			return
		}
		if !requireProjectAccess(c, projectID) {
			return
		}
		if !requirePermission(c, db.PermissionEditProjects) {
			return
		}

		var req struct {
			Name string `json:"name"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		if strings.TrimSpace(req.Name) == "" {
			c.JSON(400, gin.H{"error": "Project name is required"})
			return
		}

		result, err := db.DB.Exec(
			"UPDATE projects SET name = ? WHERE id = ?",
			strings.TrimSpace(req.Name), id,
		)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to update project: " + err.Error()})
			return
		}

		rowsAffected, err := result.RowsAffected()
		if err != nil || rowsAffected == 0 {
			c.JSON(404, gin.H{"error": "Project not found"})
			return
		}

		c.JSON(200, gin.H{
			"message": "Project updated",
		})
	})

	// Get users with access to a project
	r.GET("/api/projects/:id/users", func(c *gin.Context) {
		id := c.Param("id")
		projectID, err := strconv.Atoi(id)
		if err != nil || projectID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid project ID"})
			return
		}
		if !requireProjectAccess(c, projectID) {
			return
		}

		users, err := db.GetProjectUsers(projectID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to fetch project users: " + err.Error()})
			return
		}
		c.JSON(200, users)
	})

	// Set users with access to a project
	r.PUT("/api/projects/:id/users", func(c *gin.Context) {
		id := c.Param("id")
		projectID, err := strconv.Atoi(id)
		if err != nil || projectID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid project ID"})
			return
		}

		// Only admins or users with edit_projects permission can manage users
		if !requirePermission(c, db.PermissionEditProjects) {
			return
		}

		var req struct {
			UserIDs []int `json:"userIds"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request body"})
			return
		}

		creatorID := c.MustGet("user_id").(int)

		if err := db.SetProjectUsers(projectID, req.UserIDs, creatorID); err != nil {
			c.JSON(500, gin.H{"error": "Failed to update project users: " + err.Error()})
			return
		}

		c.JSON(200, gin.H{"message": "Project users updated"})
	})

	// Get databases for a project
	r.GET("/api/projects/:id/databases", func(c *gin.Context) {
		id := c.Param("id")
		projectID, err := strconv.Atoi(id)
		if err != nil || projectID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid project ID"})
			return
		}
		if !requireProjectAccess(c, projectID) {
			return
		}
		rows, err := db.DB.Query("SELECT id, name, type, host, port, status FROM databases WHERE project_id = ?", id)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query databases: " + err.Error()})
			return
		}
		defer rows.Close()

		databases := []map[string]interface{}{}
		for rows.Next() {
			var dbID, port int
			var name, dbType, host, status string
			if err := rows.Scan(&dbID, &name, &dbType, &host, &port, &status); err != nil {
				c.JSON(500, gin.H{"error": "Failed to scan database: " + err.Error()})
				return
			}

			databases = append(databases, map[string]interface{}{
				"id":     dbID,
				"name":   name,
				"type":   dbType,
				"host":   host,
				"port":   port,
				"status": status,
			})
		}

		c.JSON(http.StatusOK, databases)
	})

	// ========== DATABASES API ==========

	// Get all databases
	r.GET("/api/databases", func(c *gin.Context) {
		isAdmin := c.MustGet("is_admin").(bool)
		userID := c.MustGet("user_id").(int)

		query := "SELECT id, name, type, host, port, status, project_id FROM databases"
		args := []interface{}{}
		if !isAdmin {
			query = `
				SELECT d.id, d.name, d.type, d.host, d.port, d.status, d.project_id
				FROM databases d
				INNER JOIN user_project_access upa ON upa.project_id = d.project_id
				WHERE upa.user_id = ?
			`
			args = append(args, userID)
		}

		rows, err := db.DB.Query(query, args...)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query databases: " + err.Error()})
			return
		}
		defer rows.Close()

		databases := []map[string]interface{}{}
		for rows.Next() {
			var id, port, projectID int
			var name, dbType, host, status string
			if err := rows.Scan(&id, &name, &dbType, &host, &port, &status, &projectID); err != nil {
				c.JSON(500, gin.H{"error": "Failed to scan database: " + err.Error()})
				return
			}

			databases = append(databases, map[string]interface{}{
				"id":        id,
				"name":      name,
				"type":      dbType,
				"host":      host,
				"port":      port,
				"status":    status,
				"projectId": projectID,
			})
		}

		c.JSON(http.StatusOK, databases)
	})

	// Create database (Streaming for progress)
	r.POST("/api/databases", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionCreateDatabases) {
			return
		}
		userID := c.MustGet("user_id").(int)
		isAdmin := c.MustGet("is_admin").(bool)

		var req struct {
			Name         string  `json:"name"`
			Type         string  `json:"type"`
			Version      string  `json:"version"`
			ProjectID    int     `json:"projectId"`
			MaxCPU       float64 `json:"maxCpu"`
			MaxRAMMB     int     `json:"maxRamMb"`
			MaxStorageMB int     `json:"maxStorageMb"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		// Set defaults if not provided
		if req.MaxCPU == 0 {
			req.MaxCPU = 1.0
		}
		if req.MaxRAMMB == 0 {
			req.MaxRAMMB = 512
		}
		if req.MaxStorageMB == 0 {
			req.MaxStorageMB = 1024
		}

		if req.Type != "postgresql" {
			c.JSON(400, gin.H{"error": "Only postgresql is supported for now"})
			return
		}

		// Validate project exists
		if req.ProjectID > 0 {
			var count int
			err := db.DB.QueryRow("SELECT COUNT(*) FROM projects WHERE id = ?", req.ProjectID).Scan(&count)
			if err != nil || count == 0 {
				c.JSON(400, gin.H{"error": "Invalid project ID"})
				return
			}

			if !isAdmin {
				allowed, err := db.UserCanAccessProject(userID, req.ProjectID)
				if err != nil {
					c.JSON(500, gin.H{"error": "Failed to validate project access"})
					return
				}
				if !allowed {
					c.JSON(403, gin.H{"error": "Access denied for this project"})
					return
				}
			}
		}

		c.Header("Content-Type", "application/x-ndjson")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")

		c.Stream(func(w io.Writer) bool {
			sendUpdate := func(status, message string, progress float64, data any) {
				update := gin.H{
					"status":   status,
					"message":  message,
					"progress": progress,
				}
				if data != nil {
					update["data"] = data
				}
				json.NewEncoder(w).Encode(update)
				w.(http.Flusher).Flush()
			}

			ctx := context.Background()
			cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
			if err != nil {
				sendUpdate("error", "Failed to connect to Docker: "+err.Error(), 0, nil)
				return false
			}
			defer cli.Close()

			imageName := fmt.Sprintf("postgres:%s", req.Version)
			if req.Version == "" {
				imageName = "postgres:latest"
			}

			// Pull image with progress tracking
			sendUpdate("pulling", "Pulling Docker image...", 0, nil)
			pullResp, err := cli.ImagePull(ctx, imageName, image.PullOptions{})
			if err != nil {
				sendUpdate("error", "Failed to pull image: "+err.Error(), 0, nil)
				return false
			}
			defer pullResp.Close()

			// Parse Docker pull progress
			decoder := json.NewDecoder(pullResp)
			for {
				var pullUpdate struct {
					Status         string `json:"status"`
					ProgressDetail struct {
						Current int64 `json:"current"`
						Total   int64 `json:"total"`
					} `json:"progressDetail"`
				}
				if err := decoder.Decode(&pullUpdate); err != nil {
					if err == io.EOF {
						break
					}
					break
				}

				if pullUpdate.ProgressDetail.Total > 0 {
					percent := float64(pullUpdate.ProgressDetail.Current) / float64(pullUpdate.ProgressDetail.Total) * 100
					sendUpdate("pulling", "Pulling "+imageName+"...", percent, nil)
				}
			}

			// Get a free port
			sendUpdate("creating", "Generating configuration...", 100, nil)
			freePort, err := getFreePort()
			if err != nil {
				sendUpdate("error", "Failed to get free port: "+err.Error(), 0, nil)
				return false
			}

			password, err := generatePassword(16)
			if err != nil {
				sendUpdate("error", "Failed to generate password", 0, nil)
				return false
			}

			randBytes := make([]byte, 8)
			rand.Read(randBytes)
			containerName := fmt.Sprintf("baseful-%s-%s", req.Name, hex.EncodeToString(randBytes))

			// Create container
			sendUpdate("creating", "Creating container...", 100, nil)
			resp, err := cli.ContainerCreate(ctx, &container.Config{
				Image:    imageName,
				Hostname: req.Name,
				Env: []string{
					"POSTGRES_PASSWORD=" + password,
					"POSTGRES_DB=" + req.Name,
				},
				ExposedPorts: nat.PortSet{
					"5432/tcp": struct{}{},
				},
				Labels: map[string]string{
					"managed-by":         "baseful",
					"baseful.database":   req.Name,
					"baseful.project_id": fmt.Sprintf("%d", req.ProjectID),
				},
			}, &container.HostConfig{
				NetworkMode: docker.NetworkName,
				PortBindings: nat.PortMap{
					"5432/tcp": []nat.PortBinding{
						{HostIP: "0.0.0.0", HostPort: strconv.Itoa(freePort)},
					},
				},
				Resources: container.Resources{
					Memory:   int64(req.MaxRAMMB) * 1024 * 1024,
					NanoCPUs: int64(req.MaxCPU * 1000000000),
				},
				SecurityOpt: []string{
					"no-new-privileges:true",
				},
				CapDrop: []string{"ALL"},
				CapAdd:  []string{"CHOWN", "SETGID", "SETUID", "DAC_OVERRIDE"},
				RestartPolicy: container.RestartPolicy{
					Name: "unless-stopped",
				},
			}, nil, nil, containerName)

			if err != nil {
				sendUpdate("error", "Failed to create container: "+err.Error(), 0, nil)
				return false
			}

			// Start container
			sendUpdate("starting", "Starting database engine...", 100, nil)
			if err := cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
				_ = cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
				sendUpdate("error", "Failed to start container: "+err.Error(), 0, nil)
				return false
			}

			// Store in DB
			sendUpdate("finalizing", "Finalizing database setup...", 100, nil)
			result, err := db.DB.Exec(
				"INSERT INTO databases (name, type, host, port, mapped_port, container_id, version, password, status, project_id, max_cpu, max_ram_mb, max_storage_mb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				req.Name, req.Type, containerName, 5432, freePort, resp.ID, req.Version, password, "active", req.ProjectID, req.MaxCPU, req.MaxRAMMB, req.MaxStorageMB,
			)

			if err != nil {
				sendUpdate("error", "Failed to save to database: "+err.Error(), 0, nil)
				return false
			}

			databaseID, _ := result.LastInsertId()

			// Tokens and connection strings
			tokenID, _ := auth.GenerateTokenID()
			issuedAt := time.Now().UTC()
			expiresAt := issuedAt.AddDate(2, 0, 0)
			jwtToken, _ := auth.GenerateJWTWithTimestamps(int(databaseID), 0, tokenID, issuedAt, expiresAt)
			tokenHash := db.HashToken(jwtToken)
			db.CreateToken(int(databaseID), tokenID, tokenHash, issuedAt, expiresAt)

			proxyHost := auth.GetProxyHost()
			proxyPort := auth.GetProxyPort()
			portInt, _ := strconv.Atoi(proxyPort)
			connectionString := auth.GenerateConnectionString(jwtToken, int(databaseID), proxyHost, portInt, "require")

			// Final success message with data
			sendUpdate("success", "Database created successfully!", 100, gin.H{
				"id":                databaseID,
				"container_id":      resp.ID,
				"connection_string": connectionString,
				"internal_host":     containerName,
				"internal_port":     5432,
			})

			return false
		})
	})

	// Get single database by ID
	r.GET("/api/databases/:id", func(c *gin.Context) {
		id := c.Param("id")
		databaseID, err := strconv.Atoi(id)
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		var db_id, port, projectID int
		var name, dbType, host, status, version, password, containerID string

		err = db.DB.QueryRow(
			"SELECT id, name, type, host, port, status, version, password, project_id, container_id FROM databases WHERE id = ?",
			id,
		).Scan(&db_id, &name, &dbType, &host, &port, &status, &version, &password, &projectID, &containerID)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		// Get existing active token (don't regenerate on every fetch)
		tokenRecord, _ := db.GetActiveTokenForDatabase(db_id)

		proxyHost := auth.GetProxyHost()
		proxyPort := auth.GetProxyPort()
		portInt, _ := strconv.Atoi(proxyPort)

		// Return censored connection string (actual token not exposed)
		connectionString := auth.GenerateConnectionString("***CENSORED***", db_id, proxyHost, portInt, "require")

		response := gin.H{
			"id":                db_id,
			"name":              name,
			"type":              dbType,
			"host":              host,
			"port":              port,
			"status":            status,
			"version":           version,
			"connection_string": connectionString,
			"projectId":         projectID,
			"container_id":      containerID,
		}

		if tokenRecord != nil {
			response["has_token"] = true
			response["token_id"] = tokenRecord.TokenID
			response["token_expires_at"] = tokenRecord.ExpiresAt
			response["token_revoked"] = tokenRecord.Revoked
		} else {
			response["has_token"] = false
		}

		c.JSON(200, response)
	})

	// Database Control Endpoints
	r.POST("/api/databases/:id/:action", func(c *gin.Context) {
		id := c.Param("id")
		action := c.Param("action")
		databaseID, err := strconv.Atoi(id)
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		var containerID, status string
		err = db.DB.QueryRow("SELECT container_id, status FROM databases WHERE id = ?", id).Scan(&containerID, &status)
		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		switch action {
		case "start":
			if err := cli.ContainerStart(ctx, containerID, container.StartOptions{}); err != nil {
				c.JSON(500, gin.H{"error": "Failed to start container: " + err.Error()})
				return
			}
			db.DB.Exec("UPDATE databases SET status = 'active' WHERE id = ?", id)
		case "stop":
			if err := cli.ContainerStop(ctx, containerID, container.StopOptions{}); err != nil {
				c.JSON(500, gin.H{"error": "Failed to stop container: " + err.Error()})
				return
			}
			db.DB.Exec("UPDATE databases SET status = 'stopped' WHERE id = ?", id)
		case "restart":
			if err := cli.ContainerRestart(ctx, containerID, container.StopOptions{}); err != nil {
				c.JSON(500, gin.H{"error": "Failed to restart container: " + err.Error()})
				return
			}
			db.DB.Exec("UPDATE databases SET status = 'active' WHERE id = ?", id)
		case "vacuum":
			var dbName string
			err := db.DB.QueryRow("SELECT name FROM databases WHERE id = ?", id).Scan(&dbName)
			if err != nil {
				c.JSON(404, gin.H{"error": "Database not found"})
				return
			}

			// Run VACUUM ANALYZE;
			command := fmt.Sprintf("psql -U postgres -d %s -c \"VACUUM ANALYZE;\"", dbName)
			res, err := docker.ExecCommand(containerID, command, "/")
			if err != nil {
				c.JSON(500, gin.H{"error": "Failed to vacuum database: " + err.Error()})
				return
			}

			if strings.Contains(res.Output, "ERROR") {
				c.JSON(500, gin.H{"error": "PostgreSQL error: " + res.Output})
				return
			}

			c.JSON(200, gin.H{"message": "Database vacuumed successfully", "output": res.Output})
			return
		case "delete":
			// Revoke all tokens first
			dbID, _ := strconv.Atoi(id)
			db.RevokeAllTokensForDatabase(dbID)

			// Stop and remove main container
			_ = cli.ContainerStop(ctx, containerID, container.StopOptions{})
			_ = cli.ContainerRemove(ctx, containerID, container.RemoveOptions{Force: true})
			// Delete tokens from DB
			db.DB.Exec("DELETE FROM database_tokens WHERE database_id = ?", id)
			// Delete from DB
			_, err = db.DB.Exec("DELETE FROM databases WHERE id = ?", id)
			if err != nil {
				c.JSON(500, gin.H{"error": "Failed to delete database"})
				return
			}
			c.JSON(200, gin.H{"message": "Database deleted"})
			return
		default:
			c.JSON(400, gin.H{"error": "Invalid action"})
			return
		}

		c.JSON(200, gin.H{"message": fmt.Sprintf("Database %sed", action)})
	})

	// ========== BRANCHES API ==========

	// Get all branches for a database
	r.GET("/api/databases/:id/branches", func(c *gin.Context) {
		id := c.Param("id")
		databaseID, err := strconv.Atoi(id)
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		// Verify database exists
		var dbName string
		err = db.DB.QueryRow("SELECT name FROM databases WHERE id = ?", id).Scan(&dbName)
		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		rows, err := db.DB.Query("SELECT id, database_id, name, container_id, port, status, is_default, created_at FROM branches WHERE database_id = ? ORDER BY is_default DESC, created_at DESC", id)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query branches: " + err.Error()})
			return
		}
		defer rows.Close()

		branches := []map[string]interface{}{}
		for rows.Next() {
			var branchID, databaseID, port int
			var name, containerID, status, createdAt string
			var isDefault bool
			if err := rows.Scan(&branchID, &databaseID, &name, &containerID, &port, &status, &isDefault, &createdAt); err != nil {
				c.JSON(500, gin.H{"error": "Failed to scan branch: " + err.Error()})
				return
			}

			branches = append(branches, map[string]interface{}{
				"id":           branchID,
				"database_id":  databaseID,
				"name":         name,
				"container_id": containerID,
				"port":         port,
				"status":       status,
				"is_default":   isDefault,
				"created_at":   createdAt,
			})
		}

		c.JSON(http.StatusOK, branches)
	})

	// Create a new branch
	r.POST("/api/databases/:id/branches", func(c *gin.Context) {
		id := c.Param("id")
		databaseID, err := strconv.Atoi(id)
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		var req struct {
			Name string `json:"name"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		if req.Name == "" {
			c.JSON(400, gin.H{"error": "Branch name is required"})
			return
		}

		// Verify database exists and get details
		var dbID, dbPort int
		var dbName, dbType, dbHost, dbPassword, dbVersion, dbContainerID string
		err = db.DB.QueryRow(
			"SELECT id, name, type, host, port, password, version, container_id FROM databases WHERE id = ?",
			id,
		).Scan(&dbID, &dbName, &dbType, &dbHost, &dbPort, &dbPassword, &dbVersion, &dbContainerID)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		// Check if branch name already exists
		var count int
		err = db.DB.QueryRow("SELECT COUNT(*) FROM branches WHERE database_id = ? AND name = ?", id, req.Name).Scan(&count)
		if err != nil || count > 0 {
			c.JSON(400, gin.H{"error": "Branch with this name already exists"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker: " + err.Error()})
			return
		}
		defer cli.Close()

		// Get a free port for the new branch
		freePort, err := getFreePort()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to get free port: " + err.Error()})
			return
		}

		// Generate unique container name
		randBytes := make([]byte, 8)
		rand.Read(randBytes)
		containerName := fmt.Sprintf("baseful-%s-%s-%s", dbName, req.Name, hex.EncodeToString(randBytes))

		// Create new container for the branch
		imageName := fmt.Sprintf("postgres:%s", dbVersion)
		if dbVersion == "" {
			imageName = "postgres:latest"
		}

		resp, err := cli.ContainerCreate(ctx, &container.Config{
			Image:    imageName,
			Hostname: req.Name,
			Env: []string{
				"POSTGRES_PASSWORD=" + dbPassword,
				"POSTGRES_DB=" + dbName,
			},
			ExposedPorts: nat.PortSet{
				"5432/tcp": struct{}{},
			},
			Labels: map[string]string{
				"managed-by":       "baseful",
				"baseful.branch":   req.Name,
				"baseful.database": dbName,
			},
		}, &container.HostConfig{
			NetworkMode: docker.NetworkName,
			PortBindings: nat.PortMap{
				"5432/tcp": []nat.PortBinding{
					{HostIP: "0.0.0.0", HostPort: strconv.Itoa(freePort)},
				},
			},
			SecurityOpt: []string{
				"no-new-privileges:true",
			},
			CapDrop: []string{"ALL"},
			CapAdd:  []string{"CHOWN", "SETGID", "SETUID", "DAC_OVERRIDE"},
			RestartPolicy: container.RestartPolicy{
				Name: "unless-stopped",
			},
		}, nil, nil, containerName)

		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create container: " + err.Error()})
			return
		}

		// Start the container
		if err := cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
			_ = cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
			c.JSON(500, gin.H{"error": "Failed to start container: " + err.Error()})
			return
		}

		// Wait for PostgreSQL to be ready
		time.Sleep(3 * time.Second)

		// Copy data from source database if it's not the first branch
		var sourceBranchCount int
		db.DB.QueryRow("SELECT COUNT(*) FROM branches WHERE database_id = ?", id).Scan(&sourceBranchCount)

		if sourceBranchCount > 0 {
			// Get the default branch container
			var sourceContainerID string
			err = db.DB.QueryRow("SELECT container_id FROM branches WHERE database_id = ? AND is_default = 1", id).Scan(&sourceContainerID)
			if err == nil {
				// Use pg_dump to copy data
				dumpCmd := []string{"pg_dump", "-U", "postgres", "-d", dbName, "--no-owner", "--no-acl"}
				dumpExec, err := cli.ContainerExecCreate(ctx, sourceContainerID, container.ExecOptions{
					Cmd:          dumpCmd,
					AttachStdout: true,
					AttachStderr: true,
				})
				if err == nil {
					dumpAttach, err := cli.ContainerExecAttach(ctx, dumpExec.ID, container.ExecAttachOptions{})
					if err == nil {
						defer dumpAttach.Close()

						// Create exec to restore in new container
						restoreCmd := []string{"psql", "-U", "postgres", "-d", dbName}
						restoreExec, err := cli.ContainerExecCreate(ctx, resp.ID, container.ExecOptions{
							Cmd:          restoreCmd,
							AttachStdin:  true,
							AttachStdout: true,
							AttachStderr: true,
						})
						if err == nil {
							restoreAttach, err := cli.ContainerExecAttach(ctx, restoreExec.ID, container.ExecAttachOptions{})
							if err == nil {
								defer restoreAttach.Close()
								io.Copy(restoreAttach.Conn, dumpAttach.Reader)
							}
						}
					}
				}
			}
		}

		// Store branch in database
		result, err := db.DB.Exec(
			"INSERT INTO branches (database_id, name, container_id, port, status, is_default) VALUES (?, ?, ?, ?, ?, ?)",
			id, req.Name, resp.ID, freePort, "running", 0,
		)

		if err != nil {
			_ = cli.ContainerStop(ctx, resp.ID, container.StopOptions{})
			_ = cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
			c.JSON(500, gin.H{"error": "Failed to save branch: " + err.Error()})
			return
		}

		branchID, _ := result.LastInsertId()

		c.JSON(200, gin.H{
			"message":      "Branch created successfully",
			"id":           branchID,
			"name":         req.Name,
			"container_id": resp.ID,
			"port":         freePort,
			"status":       "running",
		})
	})

	// Branch control endpoints
	r.POST("/api/databases/:id/branches/:branchId/:action", func(c *gin.Context) {
		id := c.Param("id")
		branchID := c.Param("branchId")
		action := c.Param("action")
		databaseID, err := strconv.Atoi(id)
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		var containerID, status string
		err = db.DB.QueryRow("SELECT container_id, status FROM branches WHERE id = ? AND database_id = ?", branchID, id).Scan(&containerID, &status)
		if err != nil {
			c.JSON(404, gin.H{"error": "Branch not found"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		switch action {
		case "start":
			if err := cli.ContainerStart(ctx, containerID, container.StartOptions{}); err != nil {
				c.JSON(500, gin.H{"error": "Failed to start container: " + err.Error()})
				return
			}
			db.DB.Exec("UPDATE branches SET status = 'running' WHERE id = ?", branchID)
		case "stop":
			if err := cli.ContainerStop(ctx, containerID, container.StopOptions{}); err != nil {
				c.JSON(500, gin.H{"error": "Failed to stop container: " + err.Error()})
				return
			}
			db.DB.Exec("UPDATE branches SET status = 'stopped' WHERE id = ?", branchID)
		case "delete":
			// Stop and remove container
			_ = cli.ContainerStop(ctx, containerID, container.StopOptions{})
			_ = cli.ContainerRemove(ctx, containerID, container.RemoveOptions{Force: true})
			// Delete from DB
			_, err = db.DB.Exec("DELETE FROM branches WHERE id = ?", branchID)
			if err != nil {
				c.JSON(500, gin.H{"error": "Failed to delete branch"})
				return
			}
			c.JSON(200, gin.H{"message": "Branch deleted"})
			return
		case "switch":
			// Set this branch as default, unset others
			db.DB.Exec("UPDATE branches SET is_default = 0 WHERE database_id = ?", id)
			db.DB.Exec("UPDATE branches SET is_default = 1 WHERE id = ?", branchID)
			c.JSON(200, gin.H{"message": "Switched to branch"})
			return
		default:
			c.JSON(400, gin.H{"error": "Invalid action"})
			return
		}

		c.JSON(200, gin.H{"message": fmt.Sprintf("Branch %sed", action)})
	})

	// SQL Assistant Endpoint
	r.POST("/api/databases/:id/sql-assistant", func(c *gin.Context) {
		id := c.Param("id")
		userID := c.MustGet("user_id").(int)
		databaseID, err := strconv.Atoi(id)
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		apiKey, err := db.GetUserOpenRouterAPIKey(userID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to read OpenRouter API key"})
			return
		}
		if strings.TrimSpace(apiKey) == "" {
			c.JSON(400, gin.H{"error": "OpenRouter API key not configured. Add it in Profile settings."})
			return
		}

		var dbID, port int
		var name, dbType, host, status, version, password string
		err = db.DB.QueryRow(
			"SELECT id, name, type, host, port, status, version, password FROM databases WHERE id = ?",
			id,
		).Scan(&dbID, &name, &dbType, &host, &port, &status, &version, &password)
		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}
		if status != "active" {
			c.JSON(400, gin.H{"error": "Database is not running"})
			return
		}

		var req struct {
			Prompt       string `json:"prompt"`
			CurrentQuery string `json:"currentQuery"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}
		if strings.TrimSpace(req.Prompt) == "" {
			c.JSON(400, gin.H{"error": "Prompt cannot be empty"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		var containerID string
		err = db.DB.QueryRow("SELECT container_id FROM databases WHERE id = ?", id).Scan(&containerID)
		if err != nil {
			c.JSON(404, gin.H{"error": "Container not found"})
			return
		}

		schemaSummary, err := fetchSchemaSummary(ctx, cli, containerID, name)
		if err != nil {
			schemaSummary = "Schema summary unavailable."
		}

		systemPrompt := strings.Join([]string{
			"You are a PostgreSQL SQL generator.",
			"Return ONLY executable SQL and nothing else.",
			"Do not use markdown fences.",
			"Do not add explanations.",
			"Use only PostgreSQL syntax.",
			"If the request is ambiguous, return a safe SELECT query asking for clarification as a string column.",
		}, " ")

		userPrompt := fmt.Sprintf(
			"Database name: %s\nSchema:\n%s\nCurrent editor SQL:\n%s\nUser request:\n%s\nOutput only SQL.",
			name,
			schemaSummary,
			req.CurrentQuery,
			req.Prompt,
		)

		sqlText, err := requestSQLFromOpenRouter(apiKey, systemPrompt, userPrompt)
		if err != nil {
			c.JSON(502, gin.H{"error": "Failed to generate SQL via OpenRouter: " + err.Error()})
			return
		}

		c.JSON(200, gin.H{
			"sql": sqlText,
		})
	})

	// SQL Query Endpoint
	r.POST("/api/databases/:id/query", func(c *gin.Context) {
		id := c.Param("id")
		databaseID, err := strconv.Atoi(id)
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		var db_id, port int
		var name, dbType, host, status, version, password string
		err = db.DB.QueryRow(
			"SELECT id, name, type, host, port, status, version, password FROM databases WHERE id = ?",
			id,
		).Scan(&db_id, &name, &dbType, &host, &port, &status, &version, &password)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		if status != "active" {
			c.JSON(400, gin.H{"error": "Database is not running"})
			return
		}

		var req struct {
			Query string `json:"query"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		if req.Query == "" {
			c.JSON(400, gin.H{"error": "Query cannot be empty"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		// Get container ID from database record
		var containerID string
		err = db.DB.QueryRow("SELECT container_id FROM databases WHERE id = ?", id).Scan(&containerID)
		if err != nil {
			c.JSON(404, gin.H{"error": "Container not found"})
			return
		}

		// Execute query using psql via docker exec
		cmd := []string{"psql", "-U", "postgres", "-d", name, "-c", req.Query}
		execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          cmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create exec: " + err.Error()})
			return
		}

		// Attach to exec output
		attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to exec: " + err.Error()})
			return
		}
		defer attachResp.Close()

		// Read output using stdcopy to handle Docker multiplexed stream
		var stdout, stderr bytes.Buffer
		_, err = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to read output: " + err.Error()})
			return
		}

		outputStr := stdout.String()
		if stderr.Len() > 0 && outputStr == "" {
			outputStr = stderr.String()
		}

		// Check if it's a SELECT query (returns results) or an action query
		isSelect := len(outputStr) > 0 && (outputStr[0] == '(' || outputStr[0] == '-' || len(outputStr) > 10)

		c.JSON(200, gin.H{
			"result":    outputStr,
			"is_select": isSelect,
		})
	})

	// List Tables Endpoint
	r.GET("/api/databases/:id/tables", func(c *gin.Context) {
		id := c.Param("id")
		databaseID, err := strconv.Atoi(id)
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		var db_id, port int
		var name, dbType, host, status, version, password string
		err = db.DB.QueryRow(
			"SELECT id, name, type, host, port, status, version, password FROM databases WHERE id = ?",
			id,
		).Scan(&db_id, &name, &dbType, &host, &port, &status, &version, &password)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		if status != "active" {
			c.JSON(400, gin.H{"error": "Database is not running"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		var containerID string
		err = db.DB.QueryRow("SELECT container_id FROM databases WHERE id = ?", id).Scan(&containerID)
		if err != nil {
			c.JSON(404, gin.H{"error": "Container not found"})
			return
		}

		// Get list of tables
		cmd := []string{"psql", "-U", "postgres", "-d", name, "-t", "-c",
			"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"}
		execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          cmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create exec"})
			return
		}

		attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to exec"})
			return
		}
		defer attachResp.Close()

		var stdout, stderr bytes.Buffer
		_, err = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)
		outputStr := stdout.String()

		// Parse table names
		tables := []map[string]interface{}{}
		for _, line := range strings.Split(outputStr, "\n") {
			tableName := strings.TrimSpace(line)
			if tableName != "" {
				// Get row count
				countCmd := []string{"psql", "-U", "postgres", "-d", name, "-t", "-c",
					fmt.Sprintf("SELECT COUNT(*) FROM \"%s\"", tableName)}
				countExec, _ := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
					Cmd:          countCmd,
					AttachStdout: true,
					AttachStderr: true,
				})
				countAttach, _ := cli.ContainerExecAttach(ctx, countExec.ID, container.ExecAttachOptions{})

				var countStdout, countStderr bytes.Buffer
				_, _ = stdcopy.StdCopy(&countStdout, &countStderr, countAttach.Reader)
				countAttach.Close()

				countStr := strings.TrimSpace(countStdout.String())
				tables = append(tables, map[string]interface{}{
					"name":      tableName,
					"row_count": countStr,
				})
			}
		}

		c.JSON(200, tables)
	})

	// Get Table Data Endpoint
	r.GET("/api/databases/:id/tables/:tableName", func(c *gin.Context) {
		id := c.Param("id")
		tableName := c.Param("tableName")
		databaseID, err := strconv.Atoi(id)
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		var db_id, port int
		var name, dbType, host, status, version, password string
		err = db.DB.QueryRow(
			"SELECT id, name, type, host, port, status, version, password FROM databases WHERE id = ?",
			id,
		).Scan(&db_id, &name, &dbType, &host, &port, &status, &version, &password)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		if status != "active" {
			c.JSON(400, gin.H{"error": "Database is not running"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		var containerID string
		err = db.DB.QueryRow("SELECT container_id FROM databases WHERE id = ?", id).Scan(&containerID)
		if err != nil {
			c.JSON(404, gin.H{"error": "Container not found"})
			return
		}

		// Get table schema (columns)
		schemaCmd := []string{"psql", "-U", "postgres", "-d", name, "-t", "-A", "-F", "|", "-c",
			fmt.Sprintf("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '%s' ORDER BY ordinal_position", tableName)}
		schemaExec, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          schemaCmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create exec"})
			return
		}
		schemaAttach, err := cli.ContainerExecAttach(ctx, schemaExec.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to exec"})
			return
		}
		var schemaStdout, schemaStderr bytes.Buffer
		_, _ = stdcopy.StdCopy(&schemaStdout, &schemaStderr, schemaAttach.Reader)
		schemaAttach.Close()

		// Parse columns
		columns := []map[string]interface{}{}
		for _, line := range strings.Split(schemaStdout.String(), "\n") {
			parts := strings.Split(strings.TrimSpace(line), "|")
			if len(parts) >= 3 {
				colName := strings.TrimSpace(parts[0])
				if colName != "" {
					columns = append(columns, map[string]interface{}{
						"name":     colName,
						"type":     strings.TrimSpace(parts[1]),
						"nullable": strings.TrimSpace(parts[2]),
					})
				}
			}
		}

		// Get foreign key relations for this table
		relationsCmd := []string{"psql", "-U", "postgres", "-d", name, "-t", "-A", "-F", "|", "-c",
			fmt.Sprintf(`
				SELECT
					kcu.column_name,
					ccu.table_name AS foreign_table_name,
					ccu.column_name AS foreign_column_name
				FROM information_schema.table_constraints tc
				JOIN information_schema.key_column_usage kcu
					ON tc.constraint_name = kcu.constraint_name
					AND tc.table_schema = kcu.table_schema
				JOIN information_schema.constraint_column_usage ccu
					ON ccu.constraint_name = tc.constraint_name
					AND ccu.table_schema = tc.table_schema
				WHERE tc.constraint_type = 'FOREIGN KEY'
					AND tc.table_schema = 'public'
					AND tc.table_name = '%s'
				ORDER BY kcu.ordinal_position
			`, tableName)}
		relationsExec, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          relationsCmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create exec"})
			return
		}
		relationsAttach, err := cli.ContainerExecAttach(ctx, relationsExec.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to exec"})
			return
		}
		var relationsStdout, relationsStderr bytes.Buffer
		_, _ = stdcopy.StdCopy(&relationsStdout, &relationsStderr, relationsAttach.Reader)
		relationsAttach.Close()

		relations := []map[string]interface{}{}
		for _, line := range strings.Split(relationsStdout.String(), "\n") {
			parts := strings.Split(strings.TrimSpace(line), "|")
			if len(parts) >= 3 {
				sourceColumn := strings.TrimSpace(parts[0])
				referencedTable := strings.TrimSpace(parts[1])
				referencedColumn := strings.TrimSpace(parts[2])
				if sourceColumn != "" && referencedTable != "" && referencedColumn != "" {
					relations = append(relations, map[string]interface{}{
						"sourceColumn":     sourceColumn,
						"referencedTable":  referencedTable,
						"referencedColumn": referencedColumn,
					})
				}
			}
		}

		// Get pagination parameters
		offset := c.DefaultQuery("offset", "0")
		limit := c.DefaultQuery("limit", "100")
		sortBy := c.DefaultQuery("sortBy", "id")
		sortDir := c.DefaultQuery("sortOrder", "asc")

		// Validate sortDir
		if sortDir != "asc" && sortDir != "desc" {
			sortDir = "asc"
		}

		// Validate sortBy against columns
		validSortBy := "id"
		for _, col := range columns {
			if col["name"] == sortBy {
				validSortBy = sortBy
				break
			}
		}

		// Get total count
		filterCol := c.Query("filterCol")
		filterOp := c.Query("filterOp")
		filterVal := c.Query("filterVal")

		whereClause := ""
		if filterCol != "" && filterOp != "" && filterVal != "" {
			if filterOp == "equals" {
				whereClause = fmt.Sprintf("WHERE \"%s\"::text = '%s'", filterCol, filterVal)
			} else if filterOp == "contains" {
				whereClause = fmt.Sprintf("WHERE \"%s\"::text ILIKE '%%%s%%'", filterCol, filterVal)
			}
		}

		countCmd := []string{"psql", "-U", "postgres", "-d", name, "-t", "-c",
			fmt.Sprintf("SELECT COUNT(*) FROM \"%s\" %s", tableName, whereClause)}
		countExec, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          countCmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create exec"})
			return
		}
		countAttach, err := cli.ContainerExecAttach(ctx, countExec.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to exec"})
			return
		}
		var countStdout, countStderr bytes.Buffer
		_, _ = stdcopy.StdCopy(&countStdout, &countStderr, countAttach.Reader)
		countAttach.Close()
		totalCount := strings.TrimSpace(countStdout.String())

		// Get table data with pagination and sorting
		dataCmd := []string{"psql", "-U", "postgres", "-d", name, "-t", "-A", "-F", "|", "-c",
			fmt.Sprintf("SELECT * FROM \"%s\" %s ORDER BY \"%s\" %s LIMIT %s OFFSET %s", tableName, whereClause, validSortBy, sortDir, limit, offset)}
		dataExec, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          dataCmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create exec"})
			return
		}
		dataAttach, err := cli.ContainerExecAttach(ctx, dataExec.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to exec"})
			return
		}
		var dataStdout, dataStderr bytes.Buffer
		_, err = stdcopy.StdCopy(&dataStdout, &dataStderr, dataAttach.Reader)
		dataAttach.Close()

		// Parse data rows
		rows := []map[string]interface{}{}
		dataLines := strings.Split(dataStdout.String(), "\n")
		for _, line := range dataLines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "(") || strings.HasPrefix(line, "-") {
				continue
			}
			// Simple parsing - split by pipe
			values := strings.Split(line, "|")
			if len(values) == len(columns) {
				row := make(map[string]interface{})
				for i, col := range columns {
					val := strings.TrimSpace(values[i])
					if val == "" || val == "NULL" {
						row[col["name"].(string)] = nil
					} else {
						row[col["name"].(string)] = val
					}
				}
				rows = append(rows, row)
			}
		}

		c.JSON(200, gin.H{
			"name":       tableName,
			"columns":    columns,
			"relations":  relations,
			"rows":       rows,
			"count":      len(rows),
			"totalCount": totalCount,
		})
	})

	// Update Table Row Endpoint
	r.PUT("/api/databases/:id/tables/:tableName/rows", func(c *gin.Context) {
		id := c.Param("id")
		tableName := c.Param("tableName")
		databaseID, err := strconv.Atoi(id)
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		var db_id, port int
		var name, dbType, host, status, version, password string
		err = db.DB.QueryRow(
			"SELECT id, name, type, host, port, status, version, password FROM databases WHERE id = ?",
			id,
		).Scan(&db_id, &name, &dbType, &host, &port, &status, &version, &password)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		if status != "active" {
			c.JSON(400, gin.H{"error": "Database is not running"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		var containerID string
		err = db.DB.QueryRow("SELECT container_id FROM databases WHERE id = ?", id).Scan(&containerID)
		if err != nil {
			c.JSON(404, gin.H{"error": "Container not found"})
			return
		}

		var req struct {
			Updates []struct {
				RowID      interface{} `json:"rowId"`
				ColumnName string      `json:"columnName"`
				Value      interface{} `json:"value"`
			} `json:"updates"`
			PrimaryKey string `json:"primaryKey"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		fmt.Printf("Received request: primaryKey=%s, updates=%+v\n", req.PrimaryKey, req.Updates)

		// Execute each update
		for _, update := range req.Updates {
			var query string
			if update.Value == nil {
				query = fmt.Sprintf("UPDATE \"%s\" SET \"%s\" = NULL WHERE \"%s\" = '%v'", tableName, update.ColumnName, req.PrimaryKey, update.RowID)
			} else {
				query = fmt.Sprintf("UPDATE \"%s\" SET \"%s\" = '%v' WHERE \"%s\" = '%v'", tableName, update.ColumnName, update.Value, req.PrimaryKey, update.RowID)
			}

			fmt.Printf("Executing query: %s\n", query)

			cmd := []string{"psql", "-U", "postgres", "-d", name, "-c", query}
			execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
				Cmd:          cmd,
				AttachStdout: true,
				AttachStderr: true,
			})
			if err != nil {
				c.JSON(500, gin.H{"error": "Failed to create exec: " + err.Error()})
				return
			}

			attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
			if err != nil {
				c.JSON(500, gin.H{"error": "Failed to attach to exec"})
				return
			}
			var stdout, stderr bytes.Buffer
			_, err = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)
			attachResp.Close()
			fmt.Printf("Query output: %s, stderr: %s\n", stdout.String(), stderr.String())
		}

		c.JSON(200, gin.H{"message": "Rows updated successfully"})
	})

	// ========== TOKEN MANAGEMENT API ==========

	// Get tokens for a database
	r.GET("/api/databases/:id/tokens", func(c *gin.Context) {
		id := c.Param("id")
		databaseID, err := strconv.Atoi(id)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		tokens, err := db.GetTokensForDatabase(databaseID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to get tokens"})
			return
		}

		c.JSON(200, tokens)
	})

	// Rotate token for a database (revokes old active tokens and issues a new one)
	r.POST("/api/databases/:id/tokens/rotate", func(c *gin.Context) {
		id := c.Param("id")
		databaseID, err := strconv.Atoi(id)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		// Generate new token
		tokenID, err := auth.GenerateTokenID()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to generate token ID"})
			return
		}

		issuedAt := time.Now().UTC()
		expiresAt := issuedAt.AddDate(2, 0, 0)
		jwtToken, err := auth.GenerateJWTWithTimestamps(databaseID, 0, tokenID, issuedAt, expiresAt)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to generate JWT token"})
			return
		}

		// Rotate atomically: revoke old token(s), then store new token.
		tokenHash := db.HashToken(jwtToken)
		tx, err := db.DB.Begin()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to start token rotation"})
			return
		}
		defer tx.Rollback()

		if _, err := tx.Exec("UPDATE database_tokens SET revoked = 1 WHERE database_id = ? AND revoked = 0", databaseID); err != nil {
			c.JSON(500, gin.H{"error": "Failed to revoke old token"})
			return
		}
		insertQuery := "INSERT INTO database_tokens (database_id, token_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
		insertArgs := []interface{}{databaseID, tokenID, tokenHash, expiresAt}
		if db.DatabaseTokensHasIssuedAt() {
			insertQuery = "INSERT INTO database_tokens (database_id, token_id, token_hash, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)"
			insertArgs = []interface{}{databaseID, tokenID, tokenHash, issuedAt, expiresAt}
		}
		if _, err := tx.Exec(insertQuery, insertArgs...); err != nil {
			c.JSON(500, gin.H{"error": "Failed to store token"})
			return
		}
		if err := tx.Commit(); err != nil {
			c.JSON(500, gin.H{"error": "Failed to finalize token rotation"})
			return
		}

		// Generate connection string
		proxyHost := auth.GetProxyHost()
		proxyPort := auth.GetProxyPort()
		portInt, _ := strconv.Atoi(proxyPort)
		connectionString := auth.GenerateConnectionString(jwtToken, databaseID, proxyHost, portInt, "require")

		c.JSON(200, gin.H{
			"message":           "Token rotated successfully",
			"token_id":          tokenID,
			"connection_string": connectionString,
			"expires_at":        expiresAt,
		})
	})

	// Revoke a specific token
	r.DELETE("/api/databases/:id/tokens/:token_id", func(c *gin.Context) {
		databaseID, err := strconv.Atoi(c.Param("id"))
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}
		tokenID := c.Param("token_id")

		if err := db.RevokeToken(tokenID); err != nil {
			c.JSON(404, gin.H{"error": "Token not found"})
			return
		}

		c.JSON(200, gin.H{"message": "Token revoked successfully"})
	})

	// Get actual connection string (with warning - only shown once)
	r.GET("/api/databases/:id/connection-string", func(c *gin.Context) {
		id := c.Param("id")
		dbID, err := strconv.Atoi(id)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, dbID) {
			return
		}

		// TLS is mandatory for proxy connections.
		sslMode := "require"

		// Get existing active token
		tokenRecord, err := db.GetActiveTokenForDatabase(dbID)
		if err != nil || tokenRecord == nil {
			// Generate new token if none exists
			tokenID, _ := auth.GenerateTokenID()
			issuedAt := time.Now().UTC()
			expiresAt := issuedAt.AddDate(2, 0, 0)
			jwtToken, _ := auth.GenerateJWTWithTimestamps(dbID, 0, tokenID, issuedAt, expiresAt)
			tokenHash := db.HashToken(jwtToken)
			db.CreateToken(dbID, tokenID, tokenHash, issuedAt, expiresAt)

			proxyHost := auth.GetProxyHost()
			if proxyHost == "localhost" || proxyHost == "0.0.0.0" {
				if publicIP, err := system.GetPublicIP(); err == nil {
					proxyHost = publicIP
				}
			}
			proxyPort := auth.GetProxyPort()
			portInt, _ := strconv.Atoi(proxyPort)
			connectionString := auth.GenerateConnectionString(jwtToken, dbID, proxyHost, portInt, sslMode)

			c.JSON(200, gin.H{
				"message":           "Database started",
				"connection_string": connectionString,
				"expires_at":        expiresAt,
				"warning":           "Copy this connection string now. You will not be able to see it again. Store it securely.",
				"ssl_enabled":       true,
			})
			return
		}

		// Generate deterministic JWT for existing token record.
		jwtToken, err := auth.GenerateJWTWithTimestamps(dbID, 0, tokenRecord.TokenID, tokenRecord.IssuedAt, tokenRecord.ExpiresAt)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to generate connection string"})
			return
		}
		if db.HashToken(jwtToken) != tokenRecord.TokenHash {
			// Legacy token record without reproducible JWT claims; mint a new stable token.
			tokenID, _ := auth.GenerateTokenID()
			issuedAt := time.Now().UTC()
			expiresAt := issuedAt.AddDate(2, 0, 0)
			jwtToken, _ = auth.GenerateJWTWithTimestamps(dbID, 0, tokenID, issuedAt, expiresAt)
			tokenHash := db.HashToken(jwtToken)
			if _, err := db.CreateToken(dbID, tokenID, tokenHash, issuedAt, expiresAt); err != nil {
				c.JSON(500, gin.H{"error": "Failed to migrate token format"})
				return
			}
			tokenRecord.ExpiresAt = expiresAt
		}

		proxyHost := auth.GetProxyHost()
		if proxyHost == "localhost" || proxyHost == "0.0.0.0" {
			if publicIP, err := system.GetPublicIP(); err == nil {
				proxyHost = publicIP
			}
		}
		proxyPort := auth.GetProxyPort()
		portInt, _ := strconv.Atoi(proxyPort)
		connectionString := auth.GenerateConnectionString(jwtToken, dbID, proxyHost, portInt, sslMode)

		c.JSON(200, gin.H{
			"connection_string": connectionString,
			"expires_at":        tokenRecord.ExpiresAt,
			"warning":           "Copy this connection string now. You will not be able to see it again. Store it securely.",
		})
	})

	// ========== DATABASE METRICS ==========

	// Get database metrics (connections, size, etc.)
	r.GET("/api/databases/:id/metrics", func(c *gin.Context) {
		id := c.Param("id")
		dbID, err := strconv.Atoi(id)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, dbID) {
			return
		}

		var port int
		var name, dbType, host, status, version, password, containerID string
		err = db.DB.QueryRow(
			"SELECT id, name, type, host, port, status, version, password, container_id FROM databases WHERE id = ?",
			id,
		).Scan(&dbID, &name, &dbType, &host, &port, &status, &version, &password, &containerID)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		// Get container stats
		statsReader, err := cli.ContainerStats(ctx, containerID, false)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to get container stats"})
			return
		}
		defer statsReader.Body.Close()

		// Parse stats
		var stats struct {
			CPUStats struct {
				CPUUsage struct {
					TotalUsage float64 `json:"total_usage"`
				} `json:"cpu_usage"`
				SystemUsage float64 `json:"system_cpu_usage"`
				OnlineCPUs  float64 `json:"online_cpus"`
			} `json:"cpu_stats"`
			PreCPUStats struct {
				CPUUsage struct {
					TotalUsage float64 `json:"total_usage"`
				} `json:"cpu_usage"`
				SystemUsage float64 `json:"system_cpu_usage"`
			} `json:"precpu_stats"`
			MemoryStats struct {
				Usage float64 `json:"usage"`
				Limit float64 `json:"limit"`
			} `json:"memory_stats"`
		}
		if err := json.NewDecoder(statsReader.Body).Decode(&stats); err != nil {
			c.JSON(500, gin.H{"error": "Failed to parse stats"})
			return
		}
		statsReader.Body.Close()

		// Calculate CPU percentage using Docker's delta algorithm
		cpuPercent := 0.0
		cpuDelta := stats.CPUStats.CPUUsage.TotalUsage - stats.PreCPUStats.CPUUsage.TotalUsage
		systemDelta := stats.CPUStats.SystemUsage - stats.PreCPUStats.SystemUsage
		onlineCPUs := stats.CPUStats.OnlineCPUs
		if onlineCPUs == 0 {
			onlineCPUs = 1
		}

		if systemDelta > 0 && cpuDelta > 0 {
			cpuPercent = (cpuDelta / systemDelta) * onlineCPUs * 100.0
		}

		// Get active connections count (exclude metrics queries by application_name)
		var activeConnections int
		if status == "active" {
			cmd := []string{"psql", "-U", "postgres", "-t", "-c",
				"SELECT count(*) FROM pg_stat_activity WHERE application_name IS NULL OR application_name != 'baseful-metrics'"}
			execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
				Cmd:          cmd,
				AttachStdout: true,
				AttachStderr: true,
			})
			if err == nil {
				attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
				if err == nil {
					var stdout bytes.Buffer
					var stderr bytes.Buffer
					_, _ = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)
					attachResp.Close()
					output := strings.TrimSpace(stdout.String())
					activeConnections, err = strconv.Atoi(output)
					if err != nil {
						log.Printf("Failed to parse connection count: %v, output: %q, stderr: %q", err, output, stderr.String())
					}
				}
			}
		}

		// Get database size (using application_name to exclude from connection count)
		var dbSize string
		if status == "active" {
			cmd := []string{"psql", "-U", "postgres", "-t", "-c",
				fmt.Sprintf("SET application_name = 'baseful-metrics'; SELECT pg_size_pretty(pg_database_size('%s'))", name)}
			execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
				Cmd:          cmd,
				AttachStdout: true,
				AttachStderr: true,
			})
			if err == nil {
				attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
				if err == nil {
					var stdout bytes.Buffer
					var stderr bytes.Buffer
					_, _ = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)
					attachResp.Close()
					dbSize = strings.TrimSpace(stdout.String())
					if dbSize == "" && stderr.Len() > 0 {
						log.Printf("Failed to get database size, stderr: %q", stderr.String())
					}
				}
			}
		}

		// Calculate memory usage
		memoryUsageMB := stats.MemoryStats.Usage / 1024 / 1024
		memoryLimitMB := stats.MemoryStats.Limit / 1024 / 1024
		memoryPercent := 0.0
		if stats.MemoryStats.Limit > 0 {
			memoryPercent = (stats.MemoryStats.Usage / stats.MemoryStats.Limit) * 100
		}

		// Get extra performance metrics
		var cacheHitRatio float64
		var uptimeSeconds int
		var maxConnections int
		var totalTransactions int64
		var longestQuerySeconds float64

		if status == "active" {
			cmd := []string{"psql", "-U", "postgres", "-t", "-A", "-c",
				`SELECT json_build_object(
					'cache_hit_ratio', COALESCE(round(sum(blks_hit) * 100 / NULLIF(sum(blks_hit) + sum(blks_read), 0), 2), 0),
					'uptime_seconds', extract(epoch from now() - pg_postmaster_start_time())::int,
					'max_connections', (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'),
					'total_transactions', sum(xact_commit + xact_rollback),
					'longest_query_seconds', COALESCE((SELECT extract(epoch from max(now() - query_start)) FROM pg_stat_activity WHERE state != 'idle'), 0)
				) FROM pg_stat_database`}
			execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
				Cmd:          cmd,
				AttachStdout: true,
				AttachStderr: true,
			})
			if err == nil {
				attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
				if err == nil {
					var stdout bytes.Buffer
					_, _ = stdcopy.StdCopy(&stdout, &bytes.Buffer{}, attachResp.Reader)
					attachResp.Close()
					var extra struct {
						CacheHitRatio       float64 `json:"cache_hit_ratio"`
						UptimeSeconds       int     `json:"uptime_seconds"`
						MaxConnections      int     `json:"max_connections"`
						TotalTransactions   int64   `json:"total_transactions"`
						LongestQuerySeconds float64 `json:"longest_query_seconds"`
					}
					if err := json.Unmarshal(stdout.Bytes(), &extra); err == nil {
						cacheHitRatio = extra.CacheHitRatio
						uptimeSeconds = extra.UptimeSeconds
						maxConnections = extra.MaxConnections
						totalTransactions = extra.TotalTransactions
						longestQuerySeconds = extra.LongestQuerySeconds
					}
				}
			}
		}

		// Get latest I/O rates from metrics history
		var ioReadBps, ioWriteBps float64
		_ = metrics.MetricsDB.QueryRow("SELECT io_read_bps, io_write_bps FROM samples WHERE database_id = ? ORDER BY timestamp DESC LIMIT 1", id).Scan(&ioReadBps, &ioWriteBps)

		c.JSON(200, gin.H{
			"active_connections":    activeConnections,
			"database_size":         dbSize,
			"cpu_usage_percent":     cpuPercent,
			"memory_usage_mb":       memoryUsageMB,
			"memory_limit_mb":       memoryLimitMB,
			"memory_usage_percent":  memoryPercent,
			"cache_hit_ratio":       cacheHitRatio,
			"uptime_seconds":        uptimeSeconds,
			"max_connections":       maxConnections,
			"total_transactions":    totalTransactions,
			"longest_query_seconds": longestQuerySeconds,
			"io_read_bps":           ioReadBps,
			"io_write_bps":          ioWriteBps,
		})
	})

	// Get detailed database connections
	r.GET("/api/databases/:id/connections", func(c *gin.Context) {
		id := c.Param("id")
		databaseID, err := strconv.Atoi(id)
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}
		var containerID, status string
		err = db.DB.QueryRow("SELECT container_id, status FROM databases WHERE id = ?", id).Scan(&containerID, &status)
		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		if status != "active" {
			c.JSON(200, []interface{}{})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		// Query pg_stat_activity
		// We exclude the metrics connection and the current psql command itself
		// Use -t (tuples only) and -A (unaligned) to get clean JSON output without headers/padding
		cmd := []string{"psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c",
			`SELECT json_agg(t) FROM (
				SELECT
					pid,
					usename as user,
					client_addr as ip,
					backend_start as started_at,
					state,
					query,
					application_name,
					backend_type
				FROM pg_stat_activity
				WHERE (application_name IS NULL OR application_name != 'baseful-metrics')
				AND pid != pg_backend_pid()
			) t`}

		execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          cmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to execute command in container"})
			return
		}

		attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to container exec"})
			return
		}
		defer attachResp.Close()

		var stdout, stderr bytes.Buffer
		_, _ = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)

		output := strings.TrimSpace(stdout.String())
		if output == "" || output == "null" {
			if stderr.Len() > 0 {
				log.Printf("psql error: %s", stderr.String())
			}
			c.JSON(200, []interface{}{})
			return
		}

		var connections []interface{}
		if err := json.Unmarshal([]byte(output), &connections); err != nil {
			log.Printf("Failed to parse connections JSON: %v, output: %s", err, output)
			c.JSON(200, []interface{}{})
			return
		}

		c.JSON(200, connections)
	})

	// Get database metrics history
	r.GET("/api/databases/:id/metrics/history", func(c *gin.Context) {
		id := c.Param("id")
		dbID, err := strconv.Atoi(id)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, dbID) {
			return
		}

		history, err := metrics.GetHistory(dbID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to get metrics history"})
			return
		}

		c.JSON(200, history)
	})

	// Terminate a database connection
	r.POST("/api/databases/:id/connections/:pid/terminate", func(c *gin.Context) {
		id := c.Param("id")
		pid := c.Param("pid")
		databaseID, err := strconv.Atoi(id)
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		var containerID, status string
		err = db.DB.QueryRow("SELECT container_id, status FROM databases WHERE id = ?", id).Scan(&containerID, &status)
		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		if status != "active" {
			c.JSON(400, gin.H{"error": "Database is not active"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		// Execute pg_terminate_backend
		cmd := []string{"psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c",
			fmt.Sprintf("SELECT pg_terminate_backend(%s)", pid)}

		execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          cmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to execute command in container"})
			return
		}

		attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to container exec"})
			return
		}
		defer attachResp.Close()

		var stdout, stderr bytes.Buffer
		_, _ = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)

		output := strings.TrimSpace(stdout.String())
		if output == "t" {
			c.JSON(200, gin.H{"message": "Connection terminated"})
		} else {
			c.JSON(500, gin.H{"error": "Failed to terminate connection", "details": stderr.String()})
		}
	})

	// ========== RESOURCE LIMITS ==========

	// Get resource limits for a database
	r.GET("/api/databases/:id/limits", func(c *gin.Context) {
		id := c.Param("id")
		databaseID, err := strconv.Atoi(id)
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		var maxCPU float64
		var maxRAMMB, maxStorageMB int

		err = db.DB.QueryRow(
			"SELECT max_cpu, max_ram_mb, max_storage_mb FROM databases WHERE id = ?",
			id,
		).Scan(&maxCPU, &maxRAMMB, &maxStorageMB)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		c.JSON(200, gin.H{
			"max_cpu":        maxCPU,
			"max_ram_mb":     maxRAMMB,
			"max_storage_mb": maxStorageMB,
		})
	})

	// Update resource limits for a database
	r.PUT("/api/databases/:id/limits", func(c *gin.Context) {
		id := c.Param("id")
		databaseID, err := strconv.Atoi(id)
		if err != nil || databaseID <= 0 {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		if !requireDatabaseAccess(c, databaseID) {
			return
		}

		var req struct {
			MaxCPU       float64 `json:"max_cpu"`
			MaxRAMMB     int     `json:"max_ram_mb"`
			MaxStorageMB int     `json:"max_storage_mb"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		// Validate input
		if req.MaxCPU < 0.1 || req.MaxCPU > 16 {
			c.JSON(400, gin.H{"error": "CPU must be between 0.1 and 16 cores"})
			return
		}
		if req.MaxRAMMB < 64 || req.MaxRAMMB > 32768 {
			c.JSON(400, gin.H{"error": "RAM must be between 64 MB and 32 GB"})
			return
		}
		if req.MaxStorageMB < 128 || req.MaxStorageMB > 1048576 {
			c.JSON(400, gin.H{"error": "Storage must be between 128 MB and 1 TB"})
			return
		}

		// Update database record
		_, err = db.DB.Exec(
			"UPDATE databases SET max_cpu = ?, max_ram_mb = ?, max_storage_mb = ? WHERE id = ?",
			req.MaxCPU, req.MaxRAMMB, req.MaxStorageMB, id,
		)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to update resource limits"})
			return
		}

		// Check if database is running and needs restart
		var status, containerID string
		db.DB.QueryRow("SELECT status, container_id FROM databases WHERE id = ?", id).Scan(&status, &containerID)

		needsRestart := status == "active"

		// If database is active, update container resources immediately
		if status == "active" && containerID != "" {
			ctx := context.Background()
			cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
			if err == nil {
				defer cli.Close()

				// Update container resources
				_, err = cli.ContainerUpdate(ctx, containerID, container.UpdateConfig{
					Resources: container.Resources{
						Memory:   int64(req.MaxRAMMB) * 1024 * 1024,
						NanoCPUs: int64(req.MaxCPU * 1000000000),
					},
				})
				if err != nil {
					// If update fails, still return success but indicate restart needed
					needsRestart = true
				}
			} else {
				needsRestart = true
			}
		}

		c.JSON(200, gin.H{
			"message":        "Resource limits updated successfully",
			"max_cpu":        req.MaxCPU,
			"max_ram_mb":     req.MaxRAMMB,
			"max_storage_mb": req.MaxStorageMB,
			"needs_restart":  needsRestart,
		})
	})

	// ========== DOCKER CONTAINERS ==========

	// List all containers
	r.GET("/api/docker/containers", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionServerAccess) {
			return
		}
		containers, err := docker.ListContainers()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to list containers: " + err.Error()})
			return
		}

		// Filter containers by project access for non-admins
		isAdmin := c.MustGet("is_admin").(bool)
		if !isAdmin {
			userID := c.MustGet("user_id").(int)
			accessibleProjectIDs, err := db.GetUserProjectAccess(userID)
			if err != nil {
				c.JSON(500, gin.H{"error": "Failed to get project access"})
				return
			}
			// Build a set of accessible project IDs as strings
			allowedIDs := make(map[string]bool)
			for _, id := range accessibleProjectIDs {
				allowedIDs[strconv.Itoa(id)] = true
			}
			// Filter the containers slice
			var filtered []docker.ContainerInfo
			for _, ctr := range containers {
				projectID := ctr.Labels["baseful.project_id"]
				if allowedIDs[projectID] {
					filtered = append(filtered, ctr)
				}
			}
			if filtered == nil {
				filtered = []docker.ContainerInfo{}
			}
			c.JSON(200, filtered)
			return
		}

		c.JSON(200, containers)
	})

	// Execute command in container
	r.POST("/api/docker/containers/:id/exec", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionServerAccess) {
			return
		}
		id := c.Param("id")

		// For non-admins, verify they have access to the container's project
		isAdmin := c.MustGet("is_admin").(bool)
		if !isAdmin {
			// Look up the container's project label
			containers, err := docker.ListContainers()
			if err != nil {
				c.JSON(500, gin.H{"error": "Failed to inspect container"})
				return
			}
			var projectID string
			for _, ctr := range containers {
				if ctr.ID == id {
					projectID = ctr.Labels["baseful.project_id"]
					break
				}
			}
			if projectID == "" {
				c.JSON(403, gin.H{"error": "Access denied: container has no associated project"})
				return
			}
			pid, _ := strconv.Atoi(projectID)
			userID := c.MustGet("user_id").(int)
			canAccess, err := db.UserCanAccessProject(userID, pid)
			if err != nil || !canAccess {
				c.JSON(403, gin.H{"error": "Access denied: insufficient project permissions"})
				return
			}
		}

		var req struct {
			Command string `json:"command"`
			Cwd     string `json:"cwd"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		if req.Command == "" {
			c.JSON(400, gin.H{"error": "Command is required"})
			return
		}

		result, err := docker.ExecCommand(id, req.Command, req.Cwd)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to execute command: " + err.Error()})
			return
		}

		c.JSON(200, result)
	})

	// ========== DOCKER NETWORK STATUS ==========

	// Get Docker network status
	r.GET("/api/docker/network", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionServerAccess) {
			return
		}
		exists, err := docker.NetworkExists()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to check network"})
			return
		}

		if !exists {
			c.JSON(200, gin.H{
				"exists":  false,
				"message": "Network does not exist",
			})
			return
		}

		info, err := docker.GetNetworkInfo()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to get network info"})
			return
		}

		c.JSON(200, gin.H{
			"exists":      true,
			"name":        info.Name,
			"driver":      info.Driver,
			"containers":  len(info.Containers),
			"ipam_driver": info.IPAM.Driver,
		})
	})

	// Get Proxy status
	r.GET("/api/docker/proxy", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionServerAccess) {
			return
		}
		c.JSON(200, gin.H{
			"running": true,
			"port":    auth.GetProxyPort(),
			"host":    auth.GetProxyHost(),
		})
	})

	// Restart Proxy (not applicable for in-memory proxy)
	r.POST("/api/docker/proxy/restart", func(c *gin.Context) {
		if !requirePermission(c, db.PermissionServerAccess) {
			return
		}
		c.JSON(200, gin.H{
			"message": "Proxy is running in-memory and cannot be restarted. Restart the main application instead.",
		})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	fmt.Printf("Baseful is running on port %s\n", port)
	r.Run(":" + port)
}
