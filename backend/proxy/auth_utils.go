package proxy

import (
	"bytes"
	"crypto/md5"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"net"

	"github.com/xdg-go/scram"
)

// MD5 Hash helper
func md5Hash(password, user string, salt []byte) string {
	digest := md5.New()
	digest.Write([]byte(password + user))
	hash1 := hex.EncodeToString(digest.Sum(nil))

	digest = md5.New()
	digest.Write([]byte(hash1))
	digest.Write(salt)
	return "md5" + hex.EncodeToString(digest.Sum(nil))
}

// SCRAM-SHA-256 Helpers using xdg-go/scram
func (p *ProxyServer) handleSCRAMAuth(backend net.Conn, mechanisms []byte, password string) error {
	// 1. Initial SCRAM Exchange (ClientFirst)
	client, err := scram.SHA256.NewClient("postgres", password, "")
	if err != nil {
		return err
	}

	conv := client.NewConversation()
	clientFirst, err := conv.Step("")
	if err != nil {
		return err
	}

	// Send SASLInitialResponse
	// 'p' + len + MechanismName + len(payload) + payload
	mech := "SCRAM-SHA-256"
	var buf bytes.Buffer
	buf.WriteByte('p')

	// Calc message length: 4 (len) + k (mech name) + 1 (null) + 4 (ClientFirst len) + m (ClientFirst)
	totalLen := 4 + len(mech) + 1 + 4 + len(clientFirst)
	binary.Write(&buf, binary.BigEndian, uint32(totalLen))
	buf.WriteString(mech)
	buf.WriteByte(0)
	binary.Write(&buf, binary.BigEndian, uint32(len(clientFirst)))
	buf.WriteString(clientFirst)

	backend.Write(buf.Bytes())

	// 2. Server Challenge (ServerFirst)
	header := make([]byte, 5) // R + len
	if _, err := io.ReadFull(backend, header); err != nil {
		return err
	}
	if header[0] != 'R' {
		return fmt.Errorf("expected auth response, got %c", header[0])
	}
	authLen := binary.BigEndian.Uint32(header[1:5])
	payload := make([]byte, authLen-4)
	io.ReadFull(backend, payload)

	authType := binary.BigEndian.Uint32(payload[:4])
	if authType != 11 { // SASLContinue
		return fmt.Errorf("expected SASLContinue (11), got %d", authType)
	}

	serverFirst := string(payload[4:])
	clientFinal, err := conv.Step(serverFirst)
	if err != nil {
		return err
	}

	// Send SASLResponse (ClientFinal)
	// 'p' + len + payload
	var buf2 bytes.Buffer
	buf2.WriteByte('p')
	binary.Write(&buf2, binary.BigEndian, uint32(len(clientFinal)+4))
	buf2.WriteString(clientFinal)
	backend.Write(buf2.Bytes())

	// 3. Server Final (ServerFinal)
	if _, err := io.ReadFull(backend, header); err != nil {
		return err
	}
	if header[0] != 'R' {
		return fmt.Errorf("expected auth response, got %c", header[0])
	}
	authLen = binary.BigEndian.Uint32(header[1:5])
	payload = make([]byte, authLen-4)
	io.ReadFull(backend, payload)

	authType = binary.BigEndian.Uint32(payload[:4])
	if authType != 12 { // SASLFinal
		return fmt.Errorf("expected SASLFinal (12), got %d", authType)
	}

	serverFinal := string(payload[4:])
	if _, err := conv.Step(serverFinal); err != nil {
		return err
	}

	// Final Auth OK check happens in main loop (R 0)
	return nil
}
