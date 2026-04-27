package proxy

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"baseful/auth"
	"baseful/db"
)

func normalizeRemoteIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err == nil {
		return host
	}
	return strings.TrimSpace(strings.Trim(remoteAddr, "[]"))
}

func getExpectedTLSHost() string {
	for _, candidate := range []string{
		auth.GetProxyHost(),
		strings.TrimSpace(os.Getenv("PROXY_HOST")),
		strings.TrimSpace(os.Getenv("DOMAIN_NAME")),
		strings.TrimSpace(os.Getenv("PUBLIC_IP")),
	} {
		if candidate != "" {
			return strings.Trim(candidate, "[]")
		}
	}
	return "localhost"
}

func isLocalDevelopmentHost(host string) bool {
	return auth.RecommendedProxySSLMode(host) == "require"
}

func validateTLSCertificateForHost(cert tls.Certificate, host string) error {
	if isLocalDevelopmentHost(host) {
		return nil
	}
	if len(cert.Certificate) == 0 {
		return fmt.Errorf("proxy TLS certificate is empty")
	}

	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		return fmt.Errorf("failed to parse proxy TLS certificate: %w", err)
	}
	if err := leaf.VerifyHostname(host); err != nil {
		return fmt.Errorf("proxy TLS certificate does not match %s: %w", host, err)
	}
	if leaf.CheckSignatureFrom(leaf) == nil {
		return fmt.Errorf("self-signed certificates are not allowed for public proxy host %s", host)
	}
	return nil
}

func (p *ProxyServer) acquireConnectionSlot(clientIP string) bool {
	select {
	case p.connectionSlot <- struct{}{}:
	default:
		return false
	}

	p.activeByIPMu.Lock()
	defer p.activeByIPMu.Unlock()

	if p.config.MaxConnectionsIP > 0 && p.activeByIP[clientIP] >= p.config.MaxConnectionsIP {
		<-p.connectionSlot
		return false
	}

	p.activeByIP[clientIP]++
	return true
}

func (p *ProxyServer) releaseConnectionSlot(clientIP string) {
	select {
	case <-p.connectionSlot:
	default:
	}

	p.activeByIPMu.Lock()
	defer p.activeByIPMu.Unlock()

	if current := p.activeByIP[clientIP]; current <= 1 {
		delete(p.activeByIP, clientIP)
		return
	}
	p.activeByIP[clientIP]--
}

func (m *ConnectionMetadata) Close() {
	m.closeOnce.Do(func() {
		if m.frontendConn != nil {
			_ = m.frontendConn.Close()
		}
		if m.backendConn != nil {
			_ = m.backendConn.Close()
		}
	})
}

func (p *ProxyServer) connectionStateChecker() {
	defer p.wg.Done()

	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-p.ctx.Done():
			return
		case <-ticker.C:
			now := time.Now()
			activeConns.Range(func(key, value interface{}) bool {
				connID := key.(string)
				meta := value.(*ConnectionMetadata)

				if p.config.MaxConnectionTime > 0 && now.Sub(meta.ConnectedAt) > p.config.MaxConnectionTime {
					p.logger.Warning("Maximum connection lifetime reached", &ConnectionInfo{
						RemoteIP:   meta.ClientIP,
						LocalPort:  p.port,
						DatabaseID: meta.DatabaseID,
						TokenID:    meta.TokenID,
					}, nil, nil)
					meta.Close()
					activeConns.Delete(connID)
					return true
				}

				if meta.TokenID == "" {
					return true
				}

				record, err := db.GetTokenByID(meta.TokenID)
				if err != nil || record.DatabaseID != meta.DatabaseID || record.Revoked || record.ExpiresAt.Before(now) {
					p.logger.Warning("Active connection closed after token state change", &ConnectionInfo{
						RemoteIP:   meta.ClientIP,
						LocalPort:  p.port,
						DatabaseID: meta.DatabaseID,
						TokenID:    meta.TokenID,
					}, nil, err)
					meta.Close()
					activeConns.Delete(connID)
				}
				return true
			})
		}
	}
}

// DisconnectToken terminates active proxy sessions authenticated with the given token ID.
func DisconnectToken(tokenID string) int {
	if strings.TrimSpace(tokenID) == "" {
		return 0
	}

	disconnected := 0
	activeConns.Range(func(key, value interface{}) bool {
		meta := value.(*ConnectionMetadata)
		if meta.TokenID == tokenID {
			meta.Close()
			activeConns.Delete(key)
			disconnected++
		}
		return true
	})
	return disconnected
}

// DisconnectTokens terminates active proxy sessions for the provided token IDs.
func DisconnectTokens(tokenIDs []string) int {
	total := 0
	for _, tokenID := range tokenIDs {
		total += DisconnectToken(tokenID)
	}
	return total
}
