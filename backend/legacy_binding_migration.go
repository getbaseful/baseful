package main

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"baseful/db"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/client"
	"github.com/docker/go-connections/nat"
)

type legacyBindingScope struct {
	Kind         string
	DatabaseID   int
	BranchID     int
	Name         string
	ContainerID  string
	HostPortHint int
}

type legacyBindingSummary struct {
	HasLegacyPublicBindings  bool
	DatabaseBindingExposed   bool
	LegacyBranchBindingCount int
	LegacyBindingTargetCount int
}

type legacyBindingMigrationResult struct {
	Message                string   `json:"message"`
	MigratedCount          int      `json:"migrated_count"`
	DatabaseMigrated       bool     `json:"database_migrated"`
	BranchesMigrated       int      `json:"branches_migrated"`
	RemainingLegacyTargets int      `json:"remaining_legacy_targets"`
	Failures               []string `json:"failures,omitempty"`
}

func (s legacyBindingScope) label() string {
	if s.Kind == "branch" {
		return fmt.Sprintf("branch %s", s.Name)
	}
	return fmt.Sprintf("database %s", s.Name)
}

func isPublicDatabaseBindingHost(hostIP string) bool {
	trimmed := strings.TrimSpace(hostIP)
	return trimmed == "" || trimmed == "0.0.0.0" || trimmed == "::"
}

func getLegacyPublicPostgresBinding(inspect container.InspectResponse) (nat.PortBinding, bool) {
	if inspect.NetworkSettings == nil {
		return nat.PortBinding{}, false
	}

	bindings, ok := inspect.NetworkSettings.Ports[nat.Port("5432/tcp")]
	if !ok {
		return nat.PortBinding{}, false
	}

	for _, binding := range bindings {
		if isPublicDatabaseBindingHost(binding.HostIP) {
			return binding, true
		}
	}

	return nat.PortBinding{}, false
}

func listLegacyBindingScopes(databaseID int) ([]legacyBindingScope, error) {
	scopes := []legacyBindingScope{}

	var dbName, containerID string
	var mappedPort int
	if err := db.DB.QueryRow(
		"SELECT name, COALESCE(container_id, ''), COALESCE(mapped_port, 0) FROM databases WHERE id = ?",
		databaseID,
	).Scan(&dbName, &containerID, &mappedPort); err != nil {
		return nil, err
	}
	if strings.TrimSpace(containerID) != "" {
		scopes = append(scopes, legacyBindingScope{
			Kind:         "database",
			DatabaseID:   databaseID,
			Name:         dbName,
			ContainerID:  containerID,
			HostPortHint: mappedPort,
		})
	}

	rows, err := db.DB.Query(
		"SELECT id, COALESCE(name, ''), COALESCE(container_id, ''), COALESCE(port, 0) FROM branches WHERE database_id = ?",
		databaseID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var branchID, hostPort int
		var branchName, branchContainerID string
		if err := rows.Scan(&branchID, &branchName, &branchContainerID, &hostPort); err != nil {
			return nil, err
		}
		if strings.TrimSpace(branchContainerID) == "" {
			continue
		}
		scopes = append(scopes, legacyBindingScope{
			Kind:         "branch",
			DatabaseID:   databaseID,
			BranchID:     branchID,
			Name:         branchName,
			ContainerID:  branchContainerID,
			HostPortHint: hostPort,
		})
	}

	return scopes, rows.Err()
}

func getLegacyBindingSummaryForDatabase(ctx context.Context, cli *client.Client, databaseID int) (legacyBindingSummary, error) {
	summary := legacyBindingSummary{}
	scopes, err := listLegacyBindingScopes(databaseID)
	if err != nil {
		return summary, err
	}

	for _, scope := range scopes {
		inspect, inspectErr := cli.ContainerInspect(ctx, scope.ContainerID)
		if inspectErr != nil {
			continue
		}
		if _, legacy := getLegacyPublicPostgresBinding(inspect); !legacy {
			continue
		}

		summary.HasLegacyPublicBindings = true
		summary.LegacyBindingTargetCount++
		if scope.Kind == "branch" {
			summary.LegacyBranchBindingCount++
		} else {
			summary.DatabaseBindingExposed = true
		}
	}

	return summary, nil
}

func secureLegacyBindingsForDatabase(ctx context.Context, cli *client.Client, databaseID int) (*legacyBindingMigrationResult, error) {
	result := &legacyBindingMigrationResult{}

	scopes, err := listLegacyBindingScopes(databaseID)
	if err != nil {
		return nil, err
	}

	for _, scope := range scopes {
		inspect, inspectErr := cli.ContainerInspect(ctx, scope.ContainerID)
		if inspectErr != nil {
			result.Failures = append(result.Failures, fmt.Sprintf("%s: failed to inspect container: %v", scope.label(), inspectErr))
			continue
		}

		if _, legacy := getLegacyPublicPostgresBinding(inspect); !legacy {
			continue
		}

		if err := migrateLegacyBindingScope(ctx, cli, scope, inspect); err != nil {
			result.Failures = append(result.Failures, fmt.Sprintf("%s: %v", scope.label(), err))
			continue
		}

		result.MigratedCount++
		if scope.Kind == "branch" {
			result.BranchesMigrated++
		} else {
			result.DatabaseMigrated = true
		}
	}

	summary, summaryErr := getLegacyBindingSummaryForDatabase(ctx, cli, databaseID)
	if summaryErr == nil {
		result.RemainingLegacyTargets = summary.LegacyBindingTargetCount
	}

	switch {
	case result.MigratedCount == 0 && result.RemainingLegacyTargets == 0 && len(result.Failures) == 0:
		result.Message = "Database already uses proxy-only bindings."
	case len(result.Failures) > 0 && result.MigratedCount == 0:
		result.Message = "No legacy bindings were secured."
	case len(result.Failures) > 0:
		result.Message = fmt.Sprintf("Secured %d legacy binding(s), but some containers still need attention.", result.MigratedCount)
	default:
		result.Message = fmt.Sprintf("Secured %d legacy binding(s).", result.MigratedCount)
	}

	if len(result.Failures) > 0 && result.MigratedCount == 0 {
		return result, fmt.Errorf("%s", strings.Join(result.Failures, "; "))
	}

	return result, nil
}

func buildReplacementMounts(inspect container.InspectResponse) ([]mount.Mount, error) {
	mounts := make([]mount.Mount, 0, len(inspect.Mounts))
	for _, current := range inspect.Mounts {
		target := current.Destination
		if strings.TrimSpace(target) == "" {
			continue
		}

		switch current.Type {
		case mount.TypeVolume:
			source := current.Name
			if strings.TrimSpace(source) == "" {
				return nil, fmt.Errorf("volume mount for %s has no volume name", target)
			}
			mounts = append(mounts, mount.Mount{
				Type:     mount.TypeVolume,
				Source:   source,
				Target:   target,
				ReadOnly: !current.RW,
			})
		case mount.TypeBind:
			source := current.Source
			if strings.TrimSpace(source) == "" {
				return nil, fmt.Errorf("bind mount for %s has no source path", target)
			}
			mounts = append(mounts, mount.Mount{
				Type:     mount.TypeBind,
				Source:   source,
				Target:   target,
				ReadOnly: !current.RW,
			})
		case mount.TypeTmpfs:
			mounts = append(mounts, mount.Mount{
				Type:   mount.TypeTmpfs,
				Target: target,
			})
		default:
			return nil, fmt.Errorf("unsupported mount type %q for %s", current.Type, target)
		}
	}
	return mounts, nil
}

func migrateLegacyBindingScope(ctx context.Context, cli *client.Client, scope legacyBindingScope, inspect container.InspectResponse) error {
	publicBinding, legacy := getLegacyPublicPostgresBinding(inspect)
	if !legacy {
		return nil
	}
	if inspect.Config == nil || inspect.HostConfig == nil {
		return fmt.Errorf("container configuration is unavailable")
	}

	hostPort := strings.TrimSpace(publicBinding.HostPort)
	if hostPort == "" && scope.HostPortHint > 0 {
		hostPort = fmt.Sprintf("%d", scope.HostPortHint)
	}
	if hostPort == "" {
		return fmt.Errorf("could not determine published PostgreSQL port")
	}
	hostPortValue, _ := strconv.Atoi(hostPort)
	if hostPortValue == 0 {
		hostPortValue = scope.HostPortHint
	}
	replacementMounts, err := buildReplacementMounts(inspect)
	if err != nil {
		return fmt.Errorf("failed to preserve container storage: %w", err)
	}

	originalName := strings.TrimPrefix(inspect.Name, "/")
	if originalName == "" {
		return fmt.Errorf("container name is unavailable")
	}

	wasRunning := inspect.State != nil && inspect.State.Running
	backupName := fmt.Sprintf("%s-legacy-backup-%d", originalName, time.Now().Unix())
	newContainerID := ""
	renamedOld := false
	metadataUpdated := false

	rollback := func(reason error) error {
		if newContainerID != "" {
			_ = cli.ContainerRemove(ctx, newContainerID, container.RemoveOptions{Force: true})
		}
		if metadataUpdated {
			if scope.Kind == "database" {
				_, _ = db.DB.Exec(
					"UPDATE databases SET container_id = ?, status = ? WHERE id = ?",
					scope.ContainerID,
					map[bool]string{true: "active", false: "stopped"}[wasRunning],
					scope.DatabaseID,
				)
			} else {
				_, _ = db.DB.Exec(
					"UPDATE branches SET container_id = ?, status = ?, port = ? WHERE id = ?",
					scope.ContainerID,
					map[bool]string{true: "running", false: "stopped"}[wasRunning],
					hostPortValue,
					scope.BranchID,
				)
			}
		}
		if renamedOld {
			_ = cli.ContainerRename(ctx, scope.ContainerID, originalName)
		}
		if wasRunning {
			_ = cli.ContainerStart(ctx, scope.ContainerID, container.StartOptions{})
			if scope.Kind == "database" {
				_ = ensureDatabaseProxyAccessByID(ctx, cli, scope.DatabaseID)
			}
		}
		return reason
	}

	if wasRunning {
		if err := cli.ContainerStop(ctx, scope.ContainerID, container.StopOptions{}); err != nil {
			return fmt.Errorf("failed to stop original container: %w", err)
		}
	}

	if err := cli.ContainerRename(ctx, scope.ContainerID, backupName); err != nil {
		if wasRunning {
			_ = cli.ContainerStart(ctx, scope.ContainerID, container.StartOptions{})
		}
		return fmt.Errorf("failed to reserve original container name: %w", err)
	}
	renamedOld = true

	configCopy := *inspect.Config

	hostConfig := &container.HostConfig{
		NetworkMode: inspect.HostConfig.NetworkMode,
		Mounts:      replacementMounts,
		PortBindings: nat.PortMap{
			nat.Port("5432/tcp"): []nat.PortBinding{{
				HostIP:   getDatabaseHostBindIP(),
				HostPort: hostPort,
			}},
		},
		RestartPolicy: inspect.HostConfig.RestartPolicy,
		Resources:     inspect.HostConfig.Resources,
		SecurityOpt:   append([]string(nil), inspect.HostConfig.SecurityOpt...),
		CapDrop:       append([]string(nil), inspect.HostConfig.CapDrop...),
		CapAdd:        append([]string(nil), inspect.HostConfig.CapAdd...),
		Tmpfs:         inspect.HostConfig.Tmpfs,
	}

	created, err := cli.ContainerCreate(ctx, &configCopy, hostConfig, nil, nil, originalName)
	if err != nil {
		return rollback(fmt.Errorf("failed to create secured replacement container: %w", err))
	}
	newContainerID = created.ID

	if err := cli.ContainerStart(ctx, newContainerID, container.StartOptions{}); err != nil {
		return rollback(fmt.Errorf("failed to start secured replacement container: %w", err))
	}

	if err := waitForContainerPostgres(ctx, cli, newContainerID, defaultProxyRoleReadyTimeout); err != nil {
		return rollback(fmt.Errorf("replacement database did not become ready: %w", err))
	}

	if scope.Kind == "database" {
		if _, err := db.DB.Exec(
			"UPDATE databases SET container_id = ?, status = ? WHERE id = ?",
			newContainerID,
			map[bool]string{true: "active", false: "stopped"}[wasRunning],
			scope.DatabaseID,
		); err != nil {
			return rollback(fmt.Errorf("failed to update database record: %w", err))
		}
		metadataUpdated = true
		if err := ensureDatabaseProxyAccessByID(ctx, cli, scope.DatabaseID); err != nil {
			return rollback(fmt.Errorf("failed to re-provision secure proxy access: %w", err))
		}
	} else {
		if _, err := db.DB.Exec(
			"UPDATE branches SET container_id = ?, status = ?, port = ? WHERE id = ?",
			newContainerID,
			map[bool]string{true: "running", false: "stopped"}[wasRunning],
			hostPortValue,
			scope.BranchID,
		); err != nil {
			return rollback(fmt.Errorf("failed to update branch record: %w", err))
		}
		metadataUpdated = true
	}

	if !wasRunning {
		if err := cli.ContainerStop(ctx, newContainerID, container.StopOptions{}); err != nil {
			return rollback(fmt.Errorf("failed to restore stopped state on replacement container: %w", err))
		}
	}

	if err := cli.ContainerRemove(ctx, scope.ContainerID, container.RemoveOptions{Force: true}); err != nil {
		// The secured replacement is already active; keep moving and let operators
		// clean up the backup container manually if removal fails.
		fmt.Printf("Warning: failed to remove legacy backup container %s: %v\n", backupName, err)
	}

	return nil
}
