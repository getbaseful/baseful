package proxy

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
	"time"
)

// LogLevel represents the severity level of a log entry
type LogLevel string

const (
	LogLevelDebug   LogLevel = "DEBUG"
	LogLevelInfo    LogLevel = "INFO"
	LogLevelWarning LogLevel = "WARNING"
	LogLevelError   LogLevel = "ERROR"
	LogLevelFatal   LogLevel = "FATAL"
)

// LogEntry represents a structured log entry
type LogEntry struct {
	Timestamp  time.Time         `json:"timestamp"`
	Level      LogLevel          `json:"level"`
	Component  string            `json:"component"`
	Message    string            `json:"message"`
	Connection *ConnectionInfo   `json:"connection,omitempty"`
	Metadata   map[string]string `json:"metadata,omitempty"`
	Error      string            `json:"error,omitempty"`
}

// ConnectionInfo contains details about a network connection
type ConnectionInfo struct {
	RemoteIP   string `json:"remote_ip"`
	RemotePort int    `json:"remote_port"`
	LocalPort  int    `json:"local_port"`
	DatabaseID int    `json:"database_id,omitempty"`
	TokenID    string `json:"token_id,omitempty"`
	Duration   int64  `json:"duration_ms,omitempty"`
	BytesSent  int64  `json:"bytes_sent,omitempty"`
	BytesRecv  int64  `json:"bytes_recv,omitempty"`
}

// Logger provides structured logging with in-memory storage
type Logger struct {
	mu         sync.RWMutex
	entries    []LogEntry
	maxEntries int
	logFile    *os.File
	component  string
}

// NewLogger creates a new structured logger
func NewLogger(component string, maxEntries int) *Logger {
	logger := &Logger{
		entries:    make([]LogEntry, 0, maxEntries),
		maxEntries: maxEntries,
		component:  component,
	}

	// Try to open log file for persistent logging
	if logPath := os.Getenv("PROXY_LOG_PATH"); logPath != "" {
		if file, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644); err == nil {
			logger.logFile = file
		}
	}

	return logger
}

// log writes a log entry with the given level and message
func (l *Logger) log(level LogLevel, message string, conn *ConnectionInfo, metadata map[string]string, err error) {
	entry := LogEntry{
		Timestamp:  time.Now().UTC(),
		Level:      level,
		Component:  l.component,
		Message:    message,
		Connection: conn,
		Metadata:   metadata,
	}

	if err != nil {
		entry.Error = err.Error()
	}

	// Format for console output
	consoleMsg := fmt.Sprintf("[%s] [%s] [%s] %s",
		entry.Timestamp.Format(time.RFC3339),
		level,
		l.component,
		message,
	)

	if conn != nil {
		consoleMsg += fmt.Sprintf(" [IP:%s Port:%d]", conn.RemoteIP, conn.RemotePort)
		if conn.DatabaseID > 0 {
			consoleMsg += fmt.Sprintf(" [DB:%d]", conn.DatabaseID)
		}
	}

	if err != nil {
		consoleMsg += fmt.Sprintf(" Error: %v", err)
	}

	// Output to console
	switch level {
	case LogLevelFatal:
		log.Fatal(consoleMsg)
	case LogLevelError:
		log.Print(consoleMsg)
	default:
		log.Print(consoleMsg)
	}

	// Write to log file if available
	l.mu.Lock()
	if l.logFile != nil {
		jsonBytes, _ := json.Marshal(entry)
		l.logFile.Write(append(jsonBytes, '\n'))
	}

	// Store in memory
	l.entries = append(l.entries, entry)
	if len(l.entries) > l.maxEntries {
		l.entries = l.entries[len(l.entries)-l.maxEntries:]
	}
	l.mu.Unlock()
}

// Debug logs a debug message
func (l *Logger) Debug(message string, metadata map[string]string) {
	l.log(LogLevelDebug, message, nil, metadata, nil)
}

// Info logs an informational message
func (l *Logger) Info(message string, conn *ConnectionInfo, metadata map[string]string) {
	l.log(LogLevelInfo, message, conn, metadata, nil)
}

// Warning logs a warning message
func (l *Logger) Warning(message string, conn *ConnectionInfo, metadata map[string]string, err error) {
	l.log(LogLevelWarning, message, conn, metadata, err)
}

// Error logs an error message
func (l *Logger) Error(message string, conn *ConnectionInfo, metadata map[string]string, err error) {
	l.log(LogLevelError, message, conn, metadata, err)
}

// Fatal logs a fatal message and exits
func (l *Logger) Fatal(message string, conn *ConnectionInfo, metadata map[string]string, err error) {
	l.log(LogLevelFatal, message, conn, metadata, err)
}

// ConnectionStarted logs when a new connection begins
func (l *Logger) ConnectionStarted(remoteIP string, remotePort, localPort int) {
	conn := &ConnectionInfo{
		RemoteIP:   remoteIP,
		RemotePort: remotePort,
		LocalPort:  localPort,
	}
	l.log(LogLevelInfo, "Connection started", conn, nil, nil)
}

// ConnectionAuthenticated logs successful authentication
func (l *Logger) ConnectionAuthenticated(conn *ConnectionInfo, databaseID int, tokenID string) {
	conn.DatabaseID = databaseID
	conn.TokenID = tokenID
	l.log(LogLevelInfo, "Connection authenticated", conn, nil, nil)
}

// ConnectionFailed logs a failed connection attempt
func (l *Logger) ConnectionFailed(remoteIP string, remotePort, localPort int, reason string, err error) {
	conn := &ConnectionInfo{
		RemoteIP:   remoteIP,
		RemotePort: remotePort,
		LocalPort:  localPort,
	}
	l.log(LogLevelWarning, "Connection failed: "+reason, conn, nil, err)
}

// ConnectionClosed logs when a connection is closed
func (l *Logger) ConnectionClosed(conn *ConnectionInfo, duration time.Duration, bytesSent, bytesRecv int64) {
	conn.Duration = duration.Milliseconds()
	conn.BytesSent = bytesSent
	conn.BytesRecv = bytesRecv
	l.log(LogLevelInfo, "Connection closed", conn, nil, nil)
}

// TokenRevoked logs when a token is detected as revoked
func (l *Logger) TokenRevoked(tokenID, remoteIP string) {
	conn := &ConnectionInfo{
		RemoteIP: remoteIP,
		TokenID:  tokenID,
	}
	l.log(LogLevelWarning, "Token revoked - connection rejected", conn, nil, nil)
}

// TokenExpired logs when a token is expired
func (l *Logger) TokenExpired(tokenID, remoteIP string) {
	conn := &ConnectionInfo{
		RemoteIP: remoteIP,
		TokenID:  tokenID,
	}
	l.log(LogLevelWarning, "Token expired - connection rejected", conn, nil, nil)
}

// SSLTerminated logs SSL/TLS termination events
func (l *Logger) SSLTerminated(remoteIP string, success bool, err error) {
	conn := &ConnectionInfo{
		RemoteIP: remoteIP,
	}
	if success {
		l.log(LogLevelInfo, "SSL/TLS termination successful", conn, nil, nil)
	} else {
		l.log(LogLevelError, "SSL/TLS termination failed", conn, nil, err)
	}
}

// IdleTimeoutTriggered logs when idle timeout is triggered
func (l *Logger) IdleTimeoutTriggered(conn *ConnectionInfo, idleTime time.Duration) {
	l.log(LogLevelInfo, fmt.Sprintf("Idle timeout triggered after %v", idleTime), conn, nil, nil)
}

// GetRecentEntries returns the most recent log entries
func (l *Logger) GetRecentEntries(count int) []LogEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()

	if count > len(l.entries) {
		count = len(l.entries)
	}
	result := make([]LogEntry, count)
	copy(result, l.entries[len(l.entries)-count:])
	return result
}

// GetAllEntries returns all stored log entries
func (l *Logger) GetAllEntries() []LogEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()

	result := make([]LogEntry, len(l.entries))
	copy(result, l.entries)
	return result
}

// GetEntriesByLevel returns log entries filtered by level
func (l *Logger) GetEntriesByLevel(level LogLevel) []LogEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()

	var result []LogEntry
	for _, entry := range l.entries {
		if entry.Level == level {
			result = append(result, entry)
		}
	}
	return result
}

// GetConnectionLogs returns log entries for a specific connection IP
func (l *Logger) GetConnectionLogs(remoteIP string) []LogEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()

	var result []LogEntry
	for _, entry := range l.entries {
		if entry.Connection != nil && entry.Connection.RemoteIP == remoteIP {
			result = append(result, entry)
		}
	}
	return result
}

// GetStats returns logging statistics
func (l *Logger) GetStats() map[string]int {
	l.mu.RLock()
	defer l.mu.RUnlock()

	stats := make(map[string]int)
	for _, entry := range l.entries {
		stats[string(entry.Level)]++
	}
	return stats
}

// Close closes the log file if it was opened
func (l *Logger) Close() {
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.logFile != nil {
		l.logFile.Close()
		l.logFile = nil
	}
}

// Global logger instance
var proxyLogger *Logger

// InitLogger initializes the global logger
func InitLogger(maxEntries int) {
	proxyLogger = NewLogger("proxy", maxEntries)
}

// GetLogger returns the global logger instance
func GetLogger() *Logger {
	if proxyLogger == nil {
		proxyLogger = NewLogger("proxy", 1000)
	}
	return proxyLogger
}
