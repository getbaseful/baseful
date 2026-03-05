package system

import (
	"baseful/db"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type UpdateStatus struct {
	Available      bool      `json:"available"`
	CurrentHash    string    `json:"currentHash"`
	RemoteHash     string    `json:"remoteHash"`
	LastChecked    time.Time `json:"lastChecked"`
	CheckingStatus bool      `json:"checkingStatus"`
	UpdatingStatus bool      `json:"updatingStatus"`
}

var (
	currentStatus UpdateStatus
	statusMutex   sync.RWMutex
)

func InitUpdateChecker() {
	// Ensure safe directory for git commands
	exec.Command("git", "config", "--global", "--add", "safe.directory", "/repo").Run()

	// Initial check
	go func() {
		CheckForUpdates()
		// After initial check, see if we just finished an update
		time.Sleep(2 * time.Second) // Give it a moment to stabilize
		statusMutex.RLock()
		currentHash := currentStatus.CurrentHash
		statusMutex.RUnlock()

		isUpdating, _ := db.GetSetting("system_is_updating")
		targetHash, _ := db.GetSetting("system_update_target_hash")

		if isUpdating == "true" {
			if currentHash == targetHash && targetHash != "" {
				fmt.Println("System updated successfully, clearing update flag.")
				db.UpdateSetting("system_is_updating", "false")
			} else {
				// If we started up and the flag is set, but hashes don't match,
				// it likely failed or was a manual restart.
				// We'll clear it after a longer timeout if it's still stuck,
				// but for now let's be more lenient.
				fmt.Printf("System started with update flag but hash mismatch (Current: %s, Target: %s). Clearing flag to prevent stuck UI.\n", currentHash, targetHash)
				db.UpdateSetting("system_is_updating", "false")
			}
		}
	}()

	// Periodic check every 30 minutes
	ticker := time.NewTicker(30 * time.Minute)
	go func() {
		for range ticker.C {
			CheckForUpdates()
		}
	}()
}

func CheckForUpdates() {
	statusMutex.Lock()
	currentStatus.CheckingStatus = true
	statusMutex.Unlock()

	defer func() {
		statusMutex.Lock()
		currentStatus.CheckingStatus = false
		currentStatus.LastChecked = time.Now()
		statusMutex.Unlock()
	}()

	// Ensure git safe directory
	exec.Command("git", "config", "--global", "--add", "safe.directory", "/repo").Run()

	// 1. Git fetch
	fetchCmd := exec.Command("git", "-C", "/repo", "fetch", "origin", "main")
	if err := fetchCmd.Run(); err != nil {
		fmt.Printf("Update check failed (fetch): %v\n", err)
		// Try without -C just in case we are running locally
		fetchLocal := exec.Command("git", "fetch", "origin", "main")
		fetchLocal.Run()
	}

	// 2. Get current hash
	currentCmd := exec.Command("git", "-C", "/repo", "rev-parse", "HEAD")
	currentOut, err := currentCmd.Output()
	if err != nil {
		// Fallback to local
		currentLocal := exec.Command("git", "rev-parse", "HEAD")
		currentOut, _ = currentLocal.Output()
	}
	currentHash := strings.TrimSpace(string(currentOut))

	// 3. Get remote hash
	remoteCmd := exec.Command("git", "-C", "/repo", "rev-parse", "origin/main")
	remoteOut, err := remoteCmd.Output()
	if err != nil {
		// Fallback to local
		remoteLocal := exec.Command("git", "rev-parse", "origin/main")
		remoteOut, _ = remoteLocal.Output()
	}
	remoteHash := strings.TrimSpace(string(remoteOut))

	statusMutex.Lock()
	currentStatus.CurrentHash = currentHash
	currentStatus.RemoteHash = remoteHash
	currentStatus.Available = currentHash != remoteHash
	statusMutex.Unlock()
}

func GetUpdateStatus() UpdateStatus {
	statusMutex.RLock()
	defer statusMutex.RUnlock()

	status := currentStatus
	isUpdating, _ := db.GetSetting("system_is_updating")
	if isUpdating == "true" {
		status.UpdatingStatus = true
	}

	return status
}

func RunUpdate() error {
	statusMutex.Lock()
	currentStatus.UpdatingStatus = true
	remoteHash := currentStatus.RemoteHash
	statusMutex.Unlock()

	// Persist state so InitUpdateChecker on the new container can verify success.
	db.UpdateSetting("system_is_updating", "true")
	db.UpdateSetting("system_update_target_hash", remoteHash)

	fmt.Printf("Starting system update to hash: %s\n", remoteHash)

	// 0. Ensure git safe directory
	exec.Command("git", "config", "--global", "--add", "safe.directory", "/repo").Run()

	// 1. Pull latest code inside the container (source is mounted at /repo).
	fmt.Println("Pulling latest code...")
	pullCmd := exec.Command("git", "-C", "/repo", "pull", "origin", "main")
	if out, err := pullCmd.CombinedOutput(); err != nil {
		fmt.Printf("Git pull failed: %v, output: %s\n", err, string(out))
		statusMutex.Lock()
		currentStatus.UpdatingStatus = false
		statusMutex.Unlock()
		db.UpdateSetting("system_is_updating", "false")
		return fmt.Errorf("git pull failed: %v", err)
	}
	fmt.Println("Git pull succeeded.")

	// 2. Trigger the rebuild via a short-lived sidecar container that uses the
	//    host Docker socket.  This means the rebuild runs OUTSIDE this container
	//    so it survives our own process being killed by Docker.
	//    The sidecar:
	//      - has a short delay so this HTTP response reaches the browser first
	//      - runs "docker compose up -d --build --remove-orphans" on the host
	//      - then removes itself (--rm)
	//    On the next boot, InitUpdateChecker clears the system_is_updating flag.
	go func() {
		// Give the HTTP response time to reach the frontend before we disappear.
		time.Sleep(2 * time.Second)
		fmt.Println("Launching updater sidecar container...")

		// The shell command the sidecar runs on the host Docker daemon.
		shellCmd := `sleep 1 && docker compose -p baseful -f /repo/docker-compose.yml up -d --build --remove-orphans`

		sidecarArgs := []string{
			"run", "--rm",
			"--name", "baseful-updater",
			// Mount the host Docker socket so we can drive Docker from inside.
			"-v", "/var/run/docker.sock:/var/run/docker.sock",
			// Mount the repo so the compose file is reachable at /repo.
			"-v", "/opt/baseful:/repo",
			// Use the official Docker CLI image — tiny, already available if
			// the host has pulled it; otherwise Docker will pull it automatically.
			"docker:cli",
			"sh", "-c", shellCmd,
		}

		cmd := exec.Command("docker", sidecarArgs...)
		if out, err := cmd.CombinedOutput(); err != nil {
			fmt.Printf("Updater sidecar failed: %v\nOutput: %s\n", err, string(out))
			// Sidecar failed — clear the flag so the UI doesn't stay stuck.
			db.UpdateSetting("system_is_updating", "false")
		} else {
			fmt.Println("Updater sidecar launched successfully.")
		}
	}()

	return nil
}
