package system

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"baseful/db"
)

func updateEnvFile(domain string) error {
	envPath := "./.env"
	content, err := os.ReadFile(envPath)
	if err != nil {
		// If file doesn't exist, create it
		return os.WriteFile(envPath, []byte(fmt.Sprintf("DOMAIN_NAME=%s\n", domain)), 0644)
	}

	lines := strings.Split(string(content), "\n")
	found := false
	for i, line := range lines {
		if strings.HasPrefix(line, "DOMAIN_NAME=") {
			lines[i] = fmt.Sprintf("DOMAIN_NAME=%s", domain)
			found = true
			break
		}
	}

	if !found {
		lines = append(lines, fmt.Sprintf("DOMAIN_NAME=%s", domain))
	}

	return os.WriteFile(envPath, []byte(strings.Join(lines, "\n")), 0644)
}

type DomainInfo struct {
	Domain     string `json:"domain"`
	IP         string `json:"ip"`
	Propagated bool   `json:"propagated"`
	SSLEnabled bool   `json:"ssl_enabled"`
	AppPort    int    `json:"app_port"`
	ProxyPort  int    `json:"proxy_port"`
}

func GetPublicIP() (string, error) {
	resp, err := http.Get("https://api.ipify.org")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	ip, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(ip), nil
}

func CheckPropagation(domain string) (bool, error) {
	publicIP, err := GetPublicIP()
	if err != nil {
		return false, err
	}

	ips, err := net.LookupIP(domain)
	if err != nil {
		return false, nil // Not propagated yet or doesn't exist
	}

	for _, ip := range ips {
		if ip.String() == publicIP {
			return true, nil
		}
	}

	return false, nil
}

func ProvisionSSL(domain string) error {
	// We'll use Caddy to provision SSL.
	// We'll generate a Caddyfile and reload Caddy.

	// Get backend port from environment
	backendPortStr := os.Getenv("PORT")
	if backendPortStr == "" {
		backendPortStr = "8080"
	}

	// In single-container setup, everything is served by the backend on localhost
	backendHost := "localhost"

	caddyfileContent := fmt.Sprintf(`{
    email admin@%s
    admin 0.0.0.0:2019
}

%s {
    reverse_proxy %s:%s
}
`, domain, domain, backendHost, backendPortStr)

	// If the user wants TCP proxying for the database proxy,
	// they would need the Caddy layer4 module which is not standard.
	// We will stick to HTTP for now as requested for the "dashboard".

	caddyfilePath := "./Caddyfile"
	err := os.WriteFile(caddyfilePath, []byte(caddyfileContent), 0644)
	if err != nil {
		return err
	}

	// Check if caddy is installed
	_, err = exec.LookPath("caddy")
	if err != nil {
		return fmt.Errorf("caddy not found in PATH")
	}

	// Reload or start caddy
	// We use --adapter caddyfile to ensure it knows how to read the config
	fmt.Printf("Attempting to reload Caddy with domain: %s\n", domain)

	cmd := exec.Command("caddy", "reload", "--config", caddyfilePath, "--adapter", "caddyfile")
	output, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Printf("Caddy reload failed: %s\nOutput: %s\n", err, string(output))

		// If reload fails, try starting it
		cmd = exec.Command("caddy", "start", "--config", caddyfilePath, "--adapter", "caddyfile")
		output, err = cmd.CombinedOutput()
		if err != nil {
			fmt.Printf("Caddy start failed: %s\nOutput: %s\n", err, string(output))
			return fmt.Errorf("caddy failed: %s (output: %s)", err, string(output))
		}
	}

	return db.UpdateSetting("domain_ssl_enabled", "true")
}

func GetDomainInfo() (*DomainInfo, error) {
	domain, _ := db.GetSetting("domain_name")
	sslEnabled, _ := db.GetSetting("domain_ssl_enabled")

	publicIP, _ := GetPublicIP()

	// Get app port from environment
	appPortStr := os.Getenv("PORT")
	appPort, _ := strconv.Atoi(appPortStr)
	if appPort == 0 {
		appPort = 8080
	}

	info := &DomainInfo{
		Domain:     domain,
		IP:         publicIP,
		SSLEnabled: sslEnabled == "true",
		AppPort:    appPort,
		ProxyPort:  6432,
	}

	if domain != "" {
		propagated, _ := CheckPropagation(domain)
		info.Propagated = propagated
	}

	return info, nil
}

func SaveDomain(domain string) error {
	if err := updateEnvFile(domain); err != nil {
		fmt.Printf("Warning: Failed to update .env file: %v\n", err)
	}
	return db.UpdateSetting("domain_name", domain)
}
