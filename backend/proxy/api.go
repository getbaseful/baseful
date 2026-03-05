package proxy

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// APIResponse represents a standard API response
type APIResponse struct {
	Success   bool        `json:"success"`
	Message   string      `json:"message,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Error     string      `json:"error,omitempty"`
	Timestamp time.Time   `json:"timestamp"`
}

// ConnectionStats represents connection statistics
type ConnectionStats struct {
	TotalConnections  int64 `json:"total_connections"`
	ActiveConnections int64 `json:"active_connections"`
	SuccessfulAuth    int64 `json:"successful_auth"`
	FailedAuth        int64 `json:"failed_auth"`
	Disconnections    int64 `json:"disconnections"`
	IdleTimeouts      int64 `json:"idle_timeouts"`
	Errors            int64 `json:"errors"`
	BytesTransferred  int64 `json:"bytes_transferred"`
}

// ProxyStatus represents the current proxy status
type ProxyStatus struct {
	Running           bool            `json:"running"`
	ListenPort        int             `json:"listen_port"`
	Uptime            string          `json:"uptime"`
	ActiveConnections int             `json:"active_connections"`
	Stats             ConnectionStats `json:"stats"`
	TLSEnabled        bool            `json:"tls_enabled"`
	IdleTimeout       string          `json:"idle_timeout"`
}

// ConnectionAction represents the type of connection event
type ConnectionAction string

const (
	ActionConnect     ConnectionAction = "CONNECT"
	ActionDisconnect  ConnectionAction = "DISCONNECT"
	ActionAuthSuccess ConnectionAction = "AUTH_SUCCESS"
	ActionAuthFail    ConnectionAction = "AUTH_FAIL"
	ActionQuery       ConnectionAction = "QUERY"
	ActionError       ConnectionAction = "ERROR"
	ActionIdleTimeout ConnectionAction = "IDLE_TIMEOUT"
)

// LogQueryParams represents query parameters for log filtering
type LogQueryParams struct {
	Level      string `json:"level,omitempty"`
	Action     string `json:"action,omitempty"`
	ClientIP   string `json:"client_ip,omitempty"`
	DatabaseID int    `json:"database_id,omitempty"`
	Since      string `json:"since,omitempty"`
	Limit      int    `json:"limit,omitempty"`
}

// APIHandler handles HTTP requests for proxy monitoring
type APIHandler struct {
	logger *Logger
}

// NewAPIHandler creates a new API handler
func NewAPIHandler() *APIHandler {
	return &APIHandler{
		logger: GetLogger(),
	}
}

// RegisterRoutes registers all API routes
func (h *APIHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/proxy/status", h.GetStatus)
	mux.HandleFunc("/api/proxy/stats", h.GetStats)
	mux.HandleFunc("/api/proxy/logs", h.GetLogs)
	mux.HandleFunc("/api/proxy/logs/export", h.ExportLogs)
	mux.HandleFunc("/api/proxy/connections", h.GetConnections)
	mux.HandleFunc("/api/proxy/revocations", h.GetRevocations)
	mux.HandleFunc("/api/proxy/revoke", h.RevokeToken)
	mux.HandleFunc("/api/proxy/unrevoke", h.UnrevokeToken)
}

// GetStatus returns the current proxy status
func (h *APIHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.respondError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	stats := h.logger.GetStats()
	activeCount := 0
	activeConns.Range(func(key, value interface{}) bool {
		activeCount++
		return true
	})

	status := ProxyStatus{
		Running:           true,
		ListenPort:        DefaultPort,
		Uptime:            "running",
		ActiveConnections: activeCount,
		Stats: ConnectionStats{
			TotalConnections: int64(stats["INFO"]),
			SuccessfulAuth:   int64(stats["INFO"]),
			FailedAuth:       int64(stats["WARNING"]),
			Disconnections:   int64(stats["INFO"]),
			IdleTimeouts:     int64(stats["IDLE_TIMEOUT"]),
			Errors:           int64(stats["ERROR"]),
		},
		TLSEnabled:  false,
		IdleTimeout: DefaultIdleTimeout.String(),
	}

	h.respondJSON(w, APIResponse{
		Success:   true,
		Message:   "Proxy is running",
		Data:      status,
		Timestamp: time.Now(),
	})
}

// GetStats returns connection statistics
func (h *APIHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.respondError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	stats := h.logger.GetStats()
	activeCount := 0
	activeConns.Range(func(key, value interface{}) bool {
		activeCount++
		return true
	})

	connectionStats := ConnectionStats{
		TotalConnections:  int64(stats["INFO"]),
		ActiveConnections: int64(activeCount),
		SuccessfulAuth:    int64(stats["INFO"]),
		FailedAuth:        int64(stats["WARNING"]),
		Disconnections:    int64(stats["INFO"]),
		IdleTimeouts:      int64(stats["IDLE_TIMEOUT"]),
		Errors:            int64(stats["ERROR"]),
	}

	h.respondJSON(w, APIResponse{
		Success:   true,
		Message:   "Statistics retrieved",
		Data:      connectionStats,
		Timestamp: time.Now(),
	})
}

// GetLogs returns filtered log entries
func (h *APIHandler) GetLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.respondError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse query parameters
	level := r.URL.Query().Get("level")
	action := r.URL.Query().Get("action")
	clientIP := r.URL.Query().Get("client_ip")
	limitStr := r.URL.Query().Get("limit")

	limit := 100 // Default limit
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 1000 {
			limit = l
		}
	}

	var entries []LogEntry

	switch {
	case level != "":
		entries = h.logger.GetEntriesByLevel(LogLevel(level))
	case action != "":
		// Filter by action manually
		var filtered []LogEntry
		for _, e := range h.logger.GetAllEntries() {
			if e.Metadata != nil && e.Metadata["action"] == action {
				filtered = append(filtered, e)
			}
		}
		entries = filtered
	case clientIP != "":
		entries = h.logger.GetConnectionLogs(clientIP)
	default:
		entries = h.logger.GetRecentEntries(limit)
	}

	// Apply limit if needed
	if len(entries) > limit {
		entries = entries[len(entries)-limit:]
	}

	h.respondJSON(w, APIResponse{
		Success: true,
		Message: "Logs retrieved",
		Data: map[string]interface{}{
			"entries": entries,
			"count":   len(entries),
		},
		Timestamp: time.Now(),
	})
}

// ExportLogs exports all logs in JSON format
func (h *APIHandler) ExportLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.respondError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	entries := h.logger.GetAllEntries()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=proxy-logs.json")

	if err := json.NewEncoder(w).Encode(entries); err != nil {
		h.respondError(w, "Failed to export logs", http.StatusInternalServerError)
		return
	}
}

// GetConnections returns active connections
func (h *APIHandler) GetConnections(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.respondError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var connections []ConnectionMetadata
	activeConns.Range(func(key, value interface{}) bool {
		if meta, ok := value.(*ConnectionMetadata); ok {
			connections = append(connections, *meta)
		}
		return true
	})

	h.respondJSON(w, APIResponse{
		Success: true,
		Message: "Connections retrieved",
		Data: map[string]interface{}{
			"connections": connections,
			"count":       len(connections),
		},
		Timestamp: time.Now(),
	})
}

// GetRevocations returns list of revoked tokens
func (h *APIHandler) GetRevocations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.respondError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	revocations := GetRevocationStore().GetAllRevokedTokens()

	h.respondJSON(w, APIResponse{
		Success: true,
		Message: "Revocations retrieved",
		Data: map[string]interface{}{
			"revocations": revocations,
			"count":       len(revocations),
		},
		Timestamp: time.Now(),
	})
}

// RevokeToken handles token revocation
func (h *APIHandler) RevokeToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.respondError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		TokenID   string `json:"token_id"`
		RevokedBy string `json:"revoked_by"`
		Reason    string `json:"reason"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.TokenID == "" {
		h.respondError(w, "Token ID is required", http.StatusBadRequest)
		return
	}

	RevokeToken(req.TokenID)

	h.respondJSON(w, APIResponse{
		Success:   true,
		Message:   fmt.Sprintf("Token %s has been revoked", req.TokenID),
		Timestamp: time.Now(),
	})
}

// UnrevokeToken removes a token from the revocation list
func (h *APIHandler) UnrevokeToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.respondError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		TokenID string `json:"token_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.TokenID == "" {
		h.respondError(w, "Token ID is required", http.StatusBadRequest)
		return
	}

	success := UnrevokeToken(req.TokenID)

	if success {
		h.respondJSON(w, APIResponse{
			Success:   true,
			Message:   fmt.Sprintf("Token %s has been unrevoked", req.TokenID),
			Timestamp: time.Now(),
		})
	} else {
		h.respondJSON(w, APIResponse{
			Success:   false,
			Error:     fmt.Sprintf("Token %s was not in revocation list", req.TokenID),
			Timestamp: time.Now(),
		})
	}
}

// respondJSON writes a JSON response
func (h *APIHandler) respondJSON(w http.ResponseWriter, response APIResponse) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// respondError writes an error response
func (h *APIHandler) respondError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(APIResponse{
		Success:   false,
		Error:     message,
		Timestamp: time.Now(),
	})
}

// StartAPIServer starts the API server on the specified port
func StartAPIServer(port int) error {
	mux := http.NewServeMux()
	handler := NewAPIHandler()
	handler.RegisterRoutes(mux)

	addr := fmt.Sprintf(":%d", port)
	return http.ListenAndServe(addr, mux)
}
