package auth

import (
	"net/http"
	"strings"

	"baseful/db"
	"github.com/gin-gonic/gin"
)

// AuthMiddleware validates the user session JWT
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 1. Skip Auth for static assets (non-API routes)
		if !strings.HasPrefix(c.Request.URL.Path, "/api") {
			c.Next()
			return
		}

		// 2. Skip Auth for public API endpoints
		publicPaths := []string{"/api/auth/login", "/api/auth/register", "/api/auth/status", "/api/hello"}
		for _, path := range publicPaths {
			if c.Request.URL.Path == path {
				c.Next()
				return
			}
		}

		var tokenString string
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			parts := strings.Fields(authHeader)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header format must be Bearer {token}"})
				c.Abort()
				return
			}
			tokenString = parts[1]
		} else {
			cookie, err := c.Cookie("baseful_session")
			if err != nil || strings.TrimSpace(cookie) == "" {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
				c.Abort()
				return
			}
			tokenString = cookie
		}
		claims, err := ValidateJWT(tokenString)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			c.Abort()
			return
		}

		// Ensure this is a user session token, not a database proxy token
		if claims.Purpose != "user_session" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token type for this request"})
			c.Abort()
			return
		}
		if claims.UserID <= 0 {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user token"})
			c.Abort()
			return
		}

		// Security hardening: always resolve current auth state from DB.
		// This prevents stale/forged client-side role or permission display from granting API access.
		user, err := db.GetUserByID(claims.UserID)
		if err != nil || user == nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
			c.Abort()
			return
		}

		// Store user info in context
		c.Set("user_id", user.ID)
		c.Set("email", user.Email)
		c.Set("is_admin", user.IsAdmin)

		c.Next()
	}
}

// AdminOnly middleware restricts access to admins
func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		isAdmin, exists := c.Get("is_admin")
		if !exists || !isAdmin.(bool) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
			c.Abort()
			return
		}
		c.Next()
	}
}
