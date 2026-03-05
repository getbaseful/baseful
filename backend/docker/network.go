package docker

import (
	"context"
	"fmt"
	"os"

	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
)

const NetworkName = "baseful-network"

// GetDockerNetworkName returns the Docker network name from environment or default
func GetDockerNetworkName() string {
	network := os.Getenv("DOCKER_NETWORK")
	if network == "" {
		return NetworkName
	}
	return network
}

// EnsureNetwork creates the Docker network if it doesn't exist
func EnsureNetwork() error {
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	networkName := GetDockerNetworkName()

	// Check if network exists
	networks, err := cli.NetworkList(ctx, network.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list networks: %w", err)
	}

	for _, net := range networks {
		if net.Name == networkName {
			fmt.Printf("Docker network '%s' already exists\n", networkName)
			return nil
		}
	}

	// Create network
	fmt.Printf("Creating Docker network '%s'...\n", networkName)
	_, err = cli.NetworkCreate(ctx, networkName, network.CreateOptions{
		Driver: "bridge",
		IPAM: &network.IPAM{
			Driver: "default",
			Config: []network.IPAMConfig{},
		},
		Internal:   false,
		Attachable: true,
		Labels: map[string]string{
			"managed-by": "baseful",
		},
	})
	if err != nil {
		return fmt.Errorf("failed to create network: %w", err)
	}

	fmt.Printf("Docker network '%s' created successfully\n", networkName)
	return nil
}

// NetworkExists checks if the Docker network exists
func NetworkExists() (bool, error) {
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return false, fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	networkName := GetDockerNetworkName()

	networks, err := cli.NetworkList(ctx, network.ListOptions{})
	if err != nil {
		return false, fmt.Errorf("failed to list networks: %w", err)
	}

	for _, net := range networks {
		if net.Name == networkName {
			return true, nil
		}
	}

	return false, nil
}

// ConnectContainerToNetwork connects a container to the Docker network
func ConnectContainerToNetwork(containerID string) error {
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	networkName := GetDockerNetworkName()

	err = cli.NetworkConnect(ctx, networkName, containerID, nil)
	if err != nil {
		return fmt.Errorf("failed to connect container to network: %w", err)
	}

	fmt.Printf("Connected container %s to network %s\n", containerID[:12], networkName)
	return nil
}

// DisconnectContainerFromNetwork disconnects a container from the Docker network
func DisconnectContainerFromNetwork(containerID string) error {
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	networkName := GetDockerNetworkName()

	err = cli.NetworkDisconnect(ctx, networkName, containerID, true)
	if err != nil {
		return fmt.Errorf("failed to disconnect container from network: %w", err)
	}

	return nil
}

// GetNetworkInfo returns information about the Docker network
func GetNetworkInfo() (*network.Inspect, error) {
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	networkName := GetDockerNetworkName()

	netInfo, err := cli.NetworkInspect(ctx, networkName, network.InspectOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to inspect network: %w", err)
	}

	return &netInfo, nil
}
