package proxy

import (
	"baseful/auth"
	"baseful/db"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Global active connections map for tracking
var activeConns sync.Map

const (
	DefaultPort = 6432

	// Security configuration
	DefaultIdleTimeout    = 30 * time.Minute // Idle connection timeout
	DefaultQueryTimeout   = 5 * time.Minute  // Query execution timeout
	AuthTimeout           = 15 * time.Second // Authentication phase timeout
	MaxConnectionDuration = 24 * time.Hour   // Maximum connection lifetime
	TokenCheckInterval    = 5 * time.Minute  // How often to check token revocation
	SSLHandshakeTimeout   = 10 * time.Second // SSL/TLS handshake timeout
)

type ProxyConfig struct {
	Port              int
	IdleTimeout       time.Duration
	QueryTimeout      time.Duration
	MaxConnectionTime time.Duration
	EnableSSL         bool
	CertFile          string
	KeyFile           string
	Logger            *Logger
}

type ProxyServer struct {
	listener    net.Listener
	port        int
	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup
	config      *ProxyConfig
	tlsConfig   *tls.Config
	activeConns sync.Map
	logger      *Logger
}

func NewProxyServer(config *ProxyConfig) *ProxyServer {
	if config.Port == 0 {
		config.Port = DefaultPort
	}
	if config.IdleTimeout == 0 {
		config.IdleTimeout = DefaultIdleTimeout
	}
	if config.QueryTimeout == 0 {
		config.QueryTimeout = DefaultQueryTimeout
	}
	if config.MaxConnectionTime == 0 {
		config.MaxConnectionTime = MaxConnectionDuration
	}
	if config.Logger == nil {
		config.Logger = GetLogger()
	}

	ctx, cancel := context.WithCancel(context.Background())
	return &ProxyServer{
		port:   config.Port,
		ctx:    ctx,
		cancel: cancel,
		config: config,
		logger: config.Logger,
	}
}

// ConnectionMetadata stores metadata about an active connection
type ConnectionMetadata struct {
	ID          string
	ClientIP    string
	DatabaseID  int
	TokenID     string
	ConnectedAt time.Time
	LastActive  time.Time
	BytesSent   int64
	BytesRecv   int64
}

func (p *ProxyServer) Start() error {
	var err error

	// Setup TLS if enabled
	if p.config.EnableSSL {
		if err := p.setupTLS(); err != nil {
			return fmt.Errorf("failed to setup TLS: %w", err)
		}
	}

	addr := fmt.Sprintf(":%d", p.port)

	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}

	p.listener = listener
	p.logger.Info(fmt.Sprintf("Proxy listening on %s", addr), nil, nil)

	// Start idle connection cleanup goroutine
	p.wg.Add(1)
	go p.idleConnectionChecker()

	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		for {
			conn, err := p.listener.Accept()
			if err != nil {
				select {
				case <-p.ctx.Done():
					return
				default:
					p.logger.Warning("Accept error", nil, map[string]string{"error": err.Error()}, nil)
					continue
				}
			}

			// Get client IP for logging
			clientIP := conn.RemoteAddr().String()
			p.logger.ConnectionStarted(clientIP, 0, p.port)

			p.wg.Add(1)
			go p.handleConnection(conn)
		}
	}()
	return nil
}

// setupTLS configures TLS/SSL termination
func (p *ProxyServer) setupTLS() error {
	var cert tls.Certificate
	var err error

	// Try to load existing certificate
	if p.config.CertFile != "" && p.config.KeyFile != "" {
		cert, err = tls.LoadX509KeyPair(p.config.CertFile, p.config.KeyFile)
		if err != nil {
			// Generate self-signed certificate if not found
			p.logger.Warning("Failed to load certificate, generating self-signed", nil, nil, nil)
			cert, err = p.generateSelfSignedCert()
			if err != nil {
				return err
			}
		}
	} else {
		// Generate self-signed certificate
		cert, err = p.generateSelfSignedCert()
		if err != nil {
			return err
		}
	}

	p.tlsConfig = &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
		ClientAuth:   tls.NoClientCert,
		CipherSuites: []uint16{
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,
		},
	}

	return nil
}

// generateSelfSignedCert creates a self-signed certificate for development
func (p *ProxyServer) generateSelfSignedCert() (tls.Certificate, error) {
	// Generate RSA key
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return tls.Certificate{}, err
	}

	// Create certificate template
	serialNumber, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			Organization: []string{"Baseful Proxy"},
		},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  false,
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
		DNSNames:              []string{"localhost"},
	}

	// Create certificate
	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &privateKey.PublicKey, privateKey)
	if err != nil {
		return tls.Certificate{}, err
	}

	// Encode to PEM
	pemBlock := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: derBytes,
	})
	keyBlock := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	})

	return tls.X509KeyPair(pemBlock, keyBlock)
}

// idleConnectionChecker periodically checks for idle connections
func (p *ProxyServer) idleConnectionChecker() {
	defer p.wg.Done()

	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-p.ctx.Done():
			return
		case <-ticker.C:
			now := time.Now()
			p.activeConns.Range(func(key, value interface{}) bool {
				connID := key.(string)
				meta := value.(*ConnectionMetadata)

				idleTime := now.Sub(meta.LastActive)
				if idleTime > p.config.IdleTimeout {
					// Log and let the connection be cleaned up
					p.logger.IdleTimeoutTriggered(&ConnectionInfo{
						RemoteIP:   meta.ClientIP,
						DatabaseID: meta.DatabaseID,
						Duration:   idleTime.Milliseconds(),
					}, idleTime)
					p.activeConns.Delete(connID)
				}
				return true
			})
		}
	}
}

func (p *ProxyServer) handleConnection(frontend net.Conn) {
	defer p.wg.Done()
	defer frontend.Close()

	connID := uuid.New().String()
	clientIP := frontend.RemoteAddr().String()

	// Track connection metadata
	connMeta := &ConnectionMetadata{
		ID:          connID,
		ClientIP:    clientIP,
		ConnectedAt: time.Now(),
		LastActive:  time.Now(),
	}

	startTime := time.Now()

	// 1. Handle Frontend Handshake (JWT Auth) with timeout
	frontend.SetDeadline(time.Now().Add(AuthTimeout))

	newFrontend, startupParams, jwtToken, err := p.handleFrontendHandshake(frontend)
	if err != nil {
		p.logger.ConnectionFailed(clientIP, 0, p.port, "handshake failed", err)
		p.sendError(frontend, "08000", "Connection handshake failed")
		return
	}
	// Update frontend connection if it was upgraded to TLS
	frontend = newFrontend

	// 2. Validate JWT and check token revocation
	claims, err := auth.ValidateJWT(jwtToken)
	if err != nil {
		p.logger.TokenExpired("", clientIP)
		p.sendError(frontend, "28000", "Invalid or expired JWT token")
		return
	}
	if claims.Purpose != "db_proxy" {
		p.sendError(frontend, "28000", "Invalid token purpose")
		return
	}

	// Check if token has been revoked
	if err := p.checkTokenRevocation(claims.TokenID); err != nil {
		p.logger.TokenRevoked(claims.TokenID, clientIP)
		p.sendError(frontend, "28000", "Token has been revoked")
		return
	}
	if err := p.checkTokenActive(claims, jwtToken); err != nil {
		p.sendError(frontend, "28000", "Invalid or revoked JWT token")
		return
	}

	connMeta.TokenID = claims.TokenID

	// 3. Get Backend Info
	dbInfo, err := db.GetDatabaseByID(claims.DatabaseID)
	if err != nil {
		p.logger.Warning("Database not found", nil, map[string]string{"database_id": fmt.Sprintf("%d", claims.DatabaseID)}, nil)
		p.sendError(frontend, "3D000", "Database not found")
		return
	}

	connMeta.DatabaseID = claims.DatabaseID

	// 4. Connect and Handshake with Backend
	// Try connecting to the internal host first (for Docker-to-Docker)
	backendHost := dbInfo.Host
	backendPort := dbInfo.Port

	backend, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", backendHost, backendPort), 200*time.Millisecond)

	// If internal connection fails and we have a mapped port, try connecting via localhost (for Host-to-Docker)
	if err != nil && dbInfo.MappedPort > 0 {
		p.logger.Warning("Internal connection failed, trying localhost", nil, map[string]string{
			"error":       err.Error(),
			"mapped_port": fmt.Sprintf("%d", dbInfo.MappedPort),
		}, nil)
		backendHost = "127.0.0.1"
		backendPort = dbInfo.MappedPort
		backend, err = net.DialTimeout("tcp", fmt.Sprintf("%s:%d", backendHost, backendPort), 5*time.Second)
	}

	if err != nil {
		p.logger.Error("Backend connection failed", nil, map[string]string{
			"host": backendHost,
			"port": fmt.Sprintf("%d", backendPort),
		}, err)
		p.sendError(frontend, "08006", fmt.Sprintf("Failed to connect to backend database at %s:%d", dbInfo.Host, dbInfo.Port))
		return
	}
	defer backend.Close()

	err = p.handleBackendHandshake(backend, dbInfo, startupParams, frontend)
	if err != nil {
		p.logger.Warning("Backend handshake failed", nil, map[string]string{"error": err.Error()}, nil)
		return
	}

	// 5. Synchronized! Both are now at ReadyForQuery.
	frontend.SetDeadline(time.Time{})

	// Store connection metadata
	p.activeConns.Store(connID, connMeta)
	p.logger.ConnectionAuthenticated(&ConnectionInfo{
		RemoteIP:   clientIP,
		RemotePort: 0,
		LocalPort:  p.port,
	}, claims.DatabaseID, claims.TokenID)

	// 6. Pipe data with idle timeout tracking
	errChan := make(chan error, 2)
	go func() {
		errChan <- p.pipeWithIdleTracking(frontend, backend, connMeta, false)
	}()
	go func() {
		errChan <- p.pipeWithIdleTracking(backend, frontend, connMeta, true)
	}()

	<-errChan

	// Calculate duration and log disconnection
	duration := time.Since(startTime)
	p.logger.ConnectionClosed(&ConnectionInfo{
		RemoteIP:   clientIP,
		RemotePort: 0,
		LocalPort:  p.port,
		DatabaseID: claims.DatabaseID,
		Duration:   duration.Milliseconds(),
		BytesSent:  connMeta.BytesSent,
		BytesRecv:  connMeta.BytesRecv,
	}, duration, connMeta.BytesSent, connMeta.BytesRecv)

	// Remove from active connections
	p.activeConns.Delete(connID)
}

func (p *ProxyServer) handleFrontendHandshake(conn net.Conn) (net.Conn, map[string]string, string, error) {
	// Read Length
	lenBuf := make([]byte, 4)
	if _, err := io.ReadFull(conn, lenBuf); err != nil {
		return conn, nil, "", err
	}
	length := binary.BigEndian.Uint32(lenBuf)

	// TLS is mandatory: client must send SSLRequest first.
	if length != 8 {
		p.sendError(conn, "28000", "TLS is required. Configure your client with sslmode=require")
		return conn, nil, "", fmt.Errorf("plaintext startup rejected: TLS is required")
	}

	codeBuf := make([]byte, 4)
	if _, err := io.ReadFull(conn, codeBuf); err != nil {
		return conn, nil, "", err
	}
	if binary.BigEndian.Uint32(codeBuf) != 80877103 {
		p.sendError(conn, "28000", "TLS is required. Configure your client with sslmode=require")
		return conn, nil, "", fmt.Errorf("non-SSL startup rejected: TLS is required")
	}
	if p.tlsConfig == nil {
		p.sendError(conn, "08006", "Proxy TLS is not configured")
		return conn, nil, "", fmt.Errorf("proxy TLS config missing")
	}

	// Accept SSL upgrade and continue with encrypted startup.
	if _, err := conn.Write([]byte{'S'}); err != nil {
		return conn, nil, "", err
	}
	tlsConn := tls.Server(conn, p.tlsConfig)
	if err := tlsConn.Handshake(); err != nil {
		return conn, nil, "", fmt.Errorf("TLS handshake failed: %v", err)
	}
	conn = tlsConn
	if _, err := io.ReadFull(conn, lenBuf); err != nil {
		return conn, nil, "", err
	}
	length = binary.BigEndian.Uint32(lenBuf)

	// Read StartupMessage
	payload := make([]byte, length-4)
	if _, err := io.ReadFull(conn, payload); err != nil {
		return conn, nil, "", err
	}

	params := make(map[string]string)
	data := payload[4:] // skip protocol version
	for {
		idx := bytes.IndexByte(data, 0)
		if idx <= 0 {
			break
		}
		key := string(data[:idx])
		data = data[idx+1:]

		idx = bytes.IndexByte(data, 0)
		if idx < 0 {
			break
		}
		val := string(data[:idx])
		data = data[idx+1:]
		params[key] = val
	}

	// Request Password (JWT)
	// 'R' + length(8) + code(3) for CleartextPassword
	conn.Write([]byte{'R', 0, 0, 0, 8, 0, 0, 0, 3})

	// Read PasswordMessage
	header := make([]byte, 5)
	if _, err := io.ReadFull(conn, header); err != nil {
		return conn, nil, "", err
	}
	if header[0] != 'p' {
		return conn, nil, "", fmt.Errorf("expected password message, got %c", header[0])
	}
	passLen := binary.BigEndian.Uint32(header[1:5])
	passPayload := make([]byte, passLen-4)
	if _, err := io.ReadFull(conn, passPayload); err != nil {
		return conn, nil, "", err
	}
	jwtToken := string(bytes.TrimSuffix(passPayload, []byte{0}))

	// Send Auth OK to frontend immediately so it knows we accepted the "password"
	// 'R' + length(8) + code(0)
	conn.Write([]byte{'R', 0, 0, 0, 8, 0, 0, 0, 0})

	return conn, params, jwtToken, nil
}

func (p *ProxyServer) handleBackendHandshake(backend net.Conn, dbInfo *db.DatabaseInfo, params map[string]string, frontend net.Conn) error {
	// 1. Send Startup to Backend
	var buf bytes.Buffer
	binary.Write(&buf, binary.BigEndian, uint32(196608)) // Protocol 3.0
	for k, v := range params {
		if k == "user" {
			v = "postgres"
		} // Force backend user
		if k == "database" {
			v = dbInfo.Name // Use the actual database name stored in DB
		}
		buf.WriteString(k)
		buf.WriteByte(0)
		buf.WriteString(v)
		buf.WriteByte(0)
	}
	buf.WriteByte(0)

	msgLen := uint32(buf.Len() + 4)
	backend.Write(append(uint32ToBytes(msgLen), buf.Bytes()...))

	// 2. Handle Backend Auth and ParameterStatus
	for {
		header := make([]byte, 5)
		if _, err := io.ReadFull(backend, header); err != nil {
			return err
		}
		t := header[0]
		l := binary.BigEndian.Uint32(header[1:5])
		payload := make([]byte, l-4)
		io.ReadFull(backend, payload)

		switch t {
		case 'R': // Authentication
			authType := binary.BigEndian.Uint32(payload)
			if authType == 0 { // Auth OK
				continue
			}
			if authType == 3 { // Cleartext requested
				resp := append([]byte{'p'}, uint32ToBytes(uint32(len(dbInfo.Password)+5))...)
				resp = append(resp, []byte(dbInfo.Password)...)
				resp = append(resp, 0)
				backend.Write(resp)
			} else if authType == 5 { // MD5 requested
				salt := payload[4:8]
				digest := md5Hash(dbInfo.Password, "postgres", salt)
				resp := append([]byte{'p'}, uint32ToBytes(uint32(len(digest)+5))...)
				resp = append(resp, []byte(digest)...)
				resp = append(resp, 0)
				backend.Write(resp)
			} else if authType == 10 { // SASL (SCRAM-SHA-256) requested
				if err := p.handleSCRAMAuth(backend, payload[4:], dbInfo.Password); err != nil {
					return err
				}
			} else {
				log.Printf("[Proxy] unsupported auth type: %d", authType)
			}
		case 'S': // ParameterStatus
			// Forward important server params to frontend
			msg := append([]byte{'S'}, uint32ToBytes(l)...)
			frontend.Write(append(msg, payload...))
		case 'Z': // ReadyForQuery
			// Backend is ready. Now tell frontend we are OK.
			// Auth OK was already sent in handleFrontendHandshake, so we just send ReadyForQuery
			frontend.Write(append([]byte{'Z', 0, 0, 0, 5}, payload...)) // ReadyForQuery
			return nil
		case 'E': // Error
			return fmt.Errorf("backend error: %s", string(payload))
		}
	}
}

func (p *ProxyServer) pipe(dst, src net.Conn) error {
	_, err := io.Copy(dst, src)
	return err
}

// pipeWithIdleTracking copies data between connections while tracking activity
func (p *ProxyServer) pipeWithIdleTracking(dst, src net.Conn, meta *ConnectionMetadata, isBackend bool) error {
	buf := make([]byte, 32*1024) // 32KB buffer
	var totalBytes int64

	for {
		// Set read deadline for idle timeout
		src.SetReadDeadline(time.Now().Add(p.config.IdleTimeout))

		n, err := src.Read(buf)
		if n > 0 {
			totalBytes += int64(n)
			meta.LastActive = time.Now()

			// Update byte counters
			if isBackend {
				meta.BytesRecv += int64(n)
			} else {
				meta.BytesSent += int64(n)
			}

			// Write to destination
			if _, writeErr := dst.Write(buf[:n]); writeErr != nil {
				return writeErr
			}
		}

		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				// Idle timeout - connection will be cleaned up by the checker
				return nil
			}
			return err
		}
	}
}

// checkTokenRevocation verifies the token hasn't been revoked
func (p *ProxyServer) checkTokenRevocation(tokenID string) error {
	// Check against revoked tokens cache
	// In production, this would query the database or a Redis cache
	revokedTokensMu.RLock()
	defer revokedTokensMu.RUnlock()

	if _, revoked := revokedTokens[tokenID]; revoked {
		return fmt.Errorf("token %s has been revoked", tokenID)
	}

	return nil
}

// checkTokenActive verifies token state against persistent storage and exact token hash.
func (p *ProxyServer) checkTokenActive(claims *auth.JWTClaims, rawToken string) error {
	tokenRecord, err := db.GetTokenByID(claims.TokenID)
	if err != nil {
		return fmt.Errorf("token lookup failed: %w", err)
	}
	if tokenRecord.DatabaseID != claims.DatabaseID {
		return fmt.Errorf("token/database mismatch")
	}
	if tokenRecord.Revoked {
		return fmt.Errorf("token revoked")
	}
	if tokenRecord.ExpiresAt.Before(time.Now()) {
		return fmt.Errorf("token expired")
	}
	if tokenRecord.TokenHash != db.HashToken(rawToken) {
		return fmt.Errorf("token hash mismatch")
	}
	return nil
}

func (p *ProxyServer) sendError(conn net.Conn, code, message string) {
	var buf bytes.Buffer
	buf.WriteByte('S')
	buf.WriteString("FATAL")
	buf.WriteByte(0)
	buf.WriteByte('C')
	buf.WriteString(code)
	buf.WriteByte(0)
	buf.WriteByte('M')
	buf.WriteString(message)
	buf.WriteByte(0)
	buf.WriteByte(0)

	payload := buf.Bytes()
	header := append([]byte{'E'}, uint32ToBytes(uint32(len(payload)+4))...)
	conn.Write(append(header, payload...))
}

func uint32ToBytes(v uint32) []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, v)
	return b
}

func Run() error {
	// Initialize logger
	InitLogger(10000)

	// Load configuration from environment
	config := &ProxyConfig{
		Port:              DefaultPort,
		IdleTimeout:       DefaultIdleTimeout,
		QueryTimeout:      DefaultQueryTimeout,
		MaxConnectionTime: MaxConnectionDuration,
		EnableSSL:         true, // Always enable SSL support if certificates are found
		CertFile:          os.Getenv("PROXY_CERT_FILE"),
		KeyFile:           os.Getenv("PROXY_KEY_FILE"),
	}

	// Auto-detect Caddy certificates if domain is set
	if config.CertFile == "" {
		domain := os.Getenv("DOMAIN_NAME")
		if domain != "" {
			// Caddy stores certificates in /root/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/DOMAIN/
			// We look for them in the mounted volume
			basePath := "/root/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/" + domain + "/"
			certPath := basePath + domain + ".crt"
			keyPath := basePath + domain + ".key"

			if _, err := os.Stat(certPath); err == nil {
				config.CertFile = certPath
				config.KeyFile = keyPath
				fmt.Printf("Auto-detected Caddy certificates for %s\n", domain)
			}
		}
	}

	if pStr := os.Getenv("PROXY_PORT"); pStr != "" {
		fmt.Sscanf(pStr, "%d", &config.Port)
	}

	if timeoutStr := os.Getenv("PROXY_IDLE_TIMEOUT"); timeoutStr != "" {
		if duration, err := time.ParseDuration(timeoutStr); err == nil {
			config.IdleTimeout = duration
		}
	}

	server := NewProxyServer(config)

	// Start revocation cleanup goroutine
	go func() {
		ticker := time.NewTicker(TokenCheckInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				GetRevocationStore().Cleanup(24 * time.Hour)
			}
		}
	}()

	return server.Start()
}

// GetProxyStatus returns the current status of the proxy for monitoring
func GetProxyStatus() map[string]interface{} {
	logger := GetLogger()

	// Count active connections
	var activeCount int
	activeConns.Range(func(key, value interface{}) bool {
		activeCount++
		return true
	})

	return map[string]interface{}{
		"status":             "running",
		"active_connections": activeCount,
		"recent_logs":        logger.GetRecentEntries(100),
		"log_stats":          logger.GetStats(),
	}
}

// GetConnectionLogs returns logs for a specific connection
func GetConnectionLogs(connID string) []LogEntry {
	logger := GetLogger()
	var result []LogEntry

	for _, entry := range logger.GetAllEntries() {
		if entry.Connection != nil {
			// Match by connection metadata
			result = append(result, entry)
		}
	}

	return result
}

// ExportLogs exports logs in JSON format for external consumption
func ExportLogs() ([]byte, error) {
	logger := GetLogger()
	return json.MarshalIndent(logger.GetAllEntries(), "", "  ")
}
