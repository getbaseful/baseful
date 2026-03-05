package main

import (
	"encoding/binary"
	"fmt"
	"net"
	"time"
)

func main() {
	fmt.Println("Testing PostgreSQL Proxy SSL Negotiation")
	fmt.Println("========================================")
	fmt.Println()

	// Test 1: SSL negotiation
	fmt.Println("Test 1: Client with SSL negotiation")
	testSSLNegotiation()

	// Test 2: Direct startup message (no SSL)
	fmt.Println("\nTest 2: Client without SSL negotiation")
	testDirectStartup()

	fmt.Println("\nAll tests completed!")
}

func testSSLNegotiation() {
	conn, err := net.DialTimeout("tcp", "localhost:6432", 5*time.Second)
	if err != nil {
		fmt.Printf("❌ Failed to connect: %v\n", err)
		return
	}
	defer conn.Close()

	// Send SSL request
	// Format: 4-byte length (8) + 4-byte SSL code (80877103)
	sslRequest := make([]byte, 8)
	binary.BigEndian.PutUint32(sslRequest[0:4], 8)
	binary.BigEndian.PutUint32(sslRequest[4:8], 80877103)

	_, err = conn.Write(sslRequest)
	if err != nil {
		fmt.Printf("❌ Failed to send SSL request: %v\n", err)
		return
	}

	// Read response (should be 'S' to accept SSL)
	response := make([]byte, 1)
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, err = conn.Read(response)
	if err != nil {
		fmt.Printf("❌ Failed to read SSL response: %v\n", err)
		return
	}

	if response[0] == 'S' {
		fmt.Println("✅ SSL negotiation handled correctly (server responded with 'S')")
	} else {
		fmt.Printf("❌ Unexpected SSL response: %c (0x%02x)\n", response[0], response[0])
	}
}

func testDirectStartup() {
	conn, err := net.DialTimeout("tcp", "localhost:6432", 5*time.Second)
	if err != nil {
		fmt.Printf("❌ Failed to connect: %v\n", err)
		return
	}
	defer conn.Close()

	// Send startup message directly (no SSL request)
	// Format: 4-byte length + protocol version + parameters
	startupMsg := buildStartupMessage("test_user", "test_password", "test_db")

	_, err = conn.Write(startupMsg)
	if err != nil {
		fmt.Printf("❌ Failed to send startup message: %v\n", err)
		return
	}

	// Read response
	response := make([]byte, 1024)
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	n, err := conn.Read(response)
	if err != nil {
		fmt.Printf("❌ Failed to read response: %v\n", err)
		return
	}

	if n > 0 {
		// Check if we got an error response (expected when TLS is required)
		if response[0] == 'E' {
			fmt.Println("✅ Direct startup message rejected as expected (TLS required)")
		} else {
			fmt.Printf("❌ Unexpected response for non-SSL startup (received %d bytes)\n", n)
		}
	} else {
		fmt.Println("❌ No response received")
	}
}

func buildStartupMessage(user, password, database string) []byte {
	// Protocol version 3.0
	protocolVersion := uint32(196608)

	// Build parameters
	params := ""
	params += fmt.Sprintf("user\x00%s\x00", user)
	params += fmt.Sprintf("database\x00%s\x00", database)
	params += fmt.Sprintf("password\x00%s\x00", password)
	params += "\x00" // Terminating null

	// Calculate total length
	length := 4 + 4 + len(params)

	// Build message
	msg := make([]byte, length)
	binary.BigEndian.PutUint32(msg[0:4], uint32(length))
	binary.BigEndian.PutUint32(msg[4:8], protocolVersion)
	copy(msg[8:], params)

	return msg
}
