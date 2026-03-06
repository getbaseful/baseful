package docker

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
)

type ContainerInfo struct {
	ID      string            `json:"id"`
	Names   []string          `json:"names"`
	Image   string            `json:"image"`
	Status  string            `json:"status"`
	State   string            `json:"state"`
	IP      string            `json:"ip"`
	Labels  map[string]string `json:"labels"`
	Created int64             `json:"created"`
}

// ListContainers returns a list of all containers on the Baseful network
func ListContainers() ([]ContainerInfo, error) {
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	networkName := GetDockerNetworkName()

	// List all containers
	containers, err := cli.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}

	var result []ContainerInfo
	for _, c := range containers {
		// Get detailed info to find IP on our network
		inspect, err := cli.ContainerInspect(ctx, c.ID)
		if err != nil {
			continue
		}

		ip := ""
		if net, ok := inspect.NetworkSettings.Networks[networkName]; ok {
			ip = net.IPAddress
		}

		// Also check for containers managed by baseful even if not on network
		isBaseful := false
		if c.Labels["managed-by"] == "baseful" || strings.Contains(inspect.Name, "baseful") {
			isBaseful = true
		}

		if isBaseful || ip != "" {
			result = append(result, ContainerInfo{
				ID:      c.ID,
				Names:   c.Names,
				Image:   c.Image,
				Status:  c.Status,
				State:   c.State,
				IP:      ip,
				Labels:  c.Labels,
				Created: c.Created,
			})
		}
	}

	return result, nil
}

// ExecResult contains the output and the new current working directory
type ExecResult struct {
	Output string `json:"output"`
	Cwd    string `json:"cwd"`
}

// ExecCommand executes a command, returns output and the NEW current working directory
func ExecCommand(containerID string, rawCommand string, currentCwd string) (ExecResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return ExecResult{}, fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	// Append ;pwd to the command to get the new directory after execution
	// We use a separator to easily parse it later
	separator := "___BASEFUL_PWD_SEP___"
	wrappedCommand := fmt.Sprintf("%s; echo -n %s; pwd", rawCommand, separator)

	// Smart command transformation for 'top' (stays in batch mode)
	if strings.HasPrefix(rawCommand, "top") && !strings.Contains(rawCommand, "-b") {
		wrappedCommand = fmt.Sprintf("top -b -n 1; echo -n %s; pwd", separator)
	}

	execConfig := container.ExecOptions{
		Cmd:          []string{"/bin/sh", "-c", wrappedCommand},
		AttachStdout: true,
		AttachStderr: true,
		WorkingDir:   currentCwd,
		Tty:          false,
	}

	execID, err := cli.ContainerExecCreate(ctx, containerID, execConfig)
	if err != nil {
		return ExecResult{}, fmt.Errorf("failed to create exec: %w", err)
	}

	resp, err := cli.ContainerExecAttach(ctx, execID.ID, container.ExecStartOptions{})
	if err != nil {
		return ExecResult{}, fmt.Errorf("failed to attach exec: %w", err)
	}
	defer resp.Close()

	var outBuf, errBuf strings.Builder
	done := make(chan error, 1)
	go func() {
		_, copyErr := stdcopy.StdCopy(&outBuf, &errBuf, resp.Reader)
		done <- copyErr
	}()

	var finalStdout, finalStderr string
	select {
	case <-ctx.Done():
		finalStdout = outBuf.String()
		finalStderr = errBuf.String() + "\n[Command timed out]"
	case <-done:
		finalStdout = outBuf.String()
		finalStderr = errBuf.String()
	}

	// Parse out the new CWD from STDOUT ONLY
	// This prevents stderr (errors) from corrupting the path
	parts := strings.Split(finalStdout, separator)
	if len(parts) > 1 {
		cleanOutput := strings.Join(parts[:len(parts)-1], "")
		newCwd := strings.TrimSpace(parts[len(parts)-1])
		// Combine result: command's clean stdout + stderr
		return ExecResult{Output: cleanOutput + finalStderr, Cwd: newCwd}, nil
	}

	return ExecResult{Output: finalStdout + finalStderr, Cwd: currentCwd}, nil
}

func StartContainer(containerID string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	if err := cli.ContainerStart(ctx, containerID, container.StartOptions{}); err != nil {
		return fmt.Errorf("failed to start container: %w", err)
	}
	return nil
}

func StopContainer(containerID string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	timeout := 10
	if err := cli.ContainerStop(ctx, containerID, container.StopOptions{Timeout: &timeout}); err != nil {
		return fmt.Errorf("failed to stop container: %w", err)
	}
	return nil
}

func RestartContainer(containerID string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	timeout := 10
	if err := cli.ContainerRestart(ctx, containerID, container.StopOptions{Timeout: &timeout}); err != nil {
		return fmt.Errorf("failed to restart container: %w", err)
	}
	return nil
}

func GetContainerLogs(containerID string, tail string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return "", fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	if strings.TrimSpace(tail) == "" {
		tail = "200"
	}

	reader, err := cli.ContainerLogs(ctx, containerID, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Timestamps: true,
		Tail:       tail,
	})
	if err != nil {
		return "", fmt.Errorf("failed to get logs: %w", err)
	}
	defer reader.Close()

	var outBuf, errBuf strings.Builder
	if _, err := stdcopy.StdCopy(&outBuf, &errBuf, reader); err != nil {
		// Fallback: some daemons may return non-multiplexed logs in edge cases.
		if _, copyErr := io.Copy(&outBuf, reader); copyErr != nil {
			return "", fmt.Errorf("failed to read logs: %w", err)
		}
	}

	return outBuf.String() + errBuf.String(), nil
}
