package metrics

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"baseful/db"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
	_ "modernc.org/sqlite"
)

var MetricsDB *sql.DB

type MetricSample struct {
	DatabaseID         int       `json:"database_id"`
	Timestamp          time.Time `json:"timestamp"`
	CPUUsagePercent    float64   `json:"cpu_usage_percent"`
	MemoryUsageMB      float64   `json:"memory_usage_mb"`
	MemoryUsagePercent float64   `json:"memory_usage_percent"`
	ActiveConnections  int       `json:"active_connections"`
	IOReadBps          float64   `json:"io_read_bps"`
	IOWriteBps         float64   `json:"io_write_bps"`
}

func InitMetricsDB() error {
	var err error
	dbPath := os.Getenv("METRICS_DB_PATH")
	if dbPath == "" {
		dbPath = "./metrics.db"
	}

	MetricsDB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}

	// High-performance settings for SQLite
	MetricsDB.SetMaxOpenConns(1) // SQLite works best with 1 writer
	MetricsDB.Exec("PRAGMA journal_mode=WAL")
	MetricsDB.Exec("PRAGMA synchronous=NORMAL")
	MetricsDB.Exec("PRAGMA busy_timeout=5000")

	schema := `
	CREATE TABLE IF NOT EXISTS samples (
		database_id INTEGER,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		cpu_usage_percent REAL,
		memory_usage_mb REAL,
		memory_usage_percent REAL,
		active_connections INTEGER,
		io_read_bps REAL,
		io_write_bps REAL
	);
	CREATE INDEX IF NOT EXISTS idx_samples_db_time ON samples(database_id, timestamp);
	`

	_, err = MetricsDB.Exec(schema)
	if err != nil {
		return err
	}

	// Migration: Add columns if they don't exist
	// SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we run it and ignore the error
	MetricsDB.Exec("ALTER TABLE samples ADD COLUMN memory_usage_percent REAL")
	MetricsDB.Exec("ALTER TABLE samples ADD COLUMN io_read_bps REAL")
	MetricsDB.Exec("ALTER TABLE samples ADD COLUMN io_write_bps REAL")

	return nil
}

func StartCollector() {
	cleanupTicker := time.NewTicker(5 * time.Minute)

	go func() {
		for {
			enabledStr, err := db.GetSetting("metrics_enabled")
			if err != nil {
				log.Printf("Error getting metrics_enabled setting: %v", err)
			}
			rateStr, err := db.GetSetting("metrics_sample_rate")
			if err != nil {
				log.Printf("Error getting metrics_sample_rate setting: %v", err)
			}

			enabled := enabledStr == "true"
			rate, _ := strconv.Atoi(rateStr)
			if rate < 1 {
				rate = 5
			}

			if enabled {
				log.Printf("Collecting metrics (rate: %ds)...", rate)
				collectAllMetrics()
			}

			// Wait for the next sample or cleanup
			select {
			case <-time.After(time.Duration(rate) * time.Second):
				continue
			case <-cleanupTicker.C:
				CleanupOldMetrics()
			}
		}
	}()
}

func collectAllMetrics() {
	rows, err := db.DB.Query("SELECT id, container_id, status FROM databases WHERE status = 'active'")
	if err != nil {
		return
	}
	defer rows.Close()

	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return
	}
	defer cli.Close()

	for rows.Next() {
		var id int
		var containerID, status string
		if err := rows.Scan(&id, &containerID, &status); err != nil {
			continue
		}

		go collectSingleMetric(ctx, cli, id, containerID)
	}
}

func collectSingleMetric(ctx context.Context, cli *client.Client, dbID int, containerID string) {
	// Get container stats (non-blocking)
	statsReader, err := cli.ContainerStats(ctx, containerID, false)
	if err != nil {
		return
	}
	defer statsReader.Body.Close()

	var stats struct {
		CPUStats struct {
			CPUUsage struct {
				TotalUsage float64 `json:"total_usage"`
			} `json:"cpu_usage"`
			SystemUsage float64 `json:"system_cpu_usage"`
			OnlineCPUs  float64 `json:"online_cpus"`
		} `json:"cpu_stats"`
		PreCPUStats struct {
			CPUUsage struct {
				TotalUsage float64 `json:"total_usage"`
			} `json:"cpu_usage"`
			SystemUsage float64 `json:"system_cpu_usage"`
		} `json:"precpu_stats"`
		MemoryStats struct {
			Usage float64 `json:"usage"`
			Limit float64 `json:"limit"`
		} `json:"memory_stats"`
		BlkioStats struct {
			IoServiceBytesRecursive []struct {
				Op    string `json:"op"`
				Value uint64 `json:"value"`
			} `json:"io_service_bytes_recursive"`
		} `json:"blkio_stats"`
	}

	if err := json.NewDecoder(statsReader.Body).Decode(&stats); err != nil {
		return
	}

	// Calculate CPU percentage using Docker's delta algorithm
	cpuPercent := 0.0
	cpuDelta := stats.CPUStats.CPUUsage.TotalUsage - stats.PreCPUStats.CPUUsage.TotalUsage
	systemDelta := stats.CPUStats.SystemUsage - stats.PreCPUStats.SystemUsage
	onlineCPUs := stats.CPUStats.OnlineCPUs
	if onlineCPUs == 0 {
		onlineCPUs = 1
	}

	if systemDelta > 0 && cpuDelta > 0 {
		cpuPercent = (cpuDelta / systemDelta) * onlineCPUs * 100.0
	}
	memoryMB := stats.MemoryStats.Usage / 1024 / 1024
	memoryPercent := 0.0
	if stats.MemoryStats.Limit > 0 {
		memoryPercent = (stats.MemoryStats.Usage / stats.MemoryStats.Limit) * 100
	}

	// Calculate Disk I/O
	var currentRead, currentWrite uint64
	for _, s := range stats.BlkioStats.IoServiceBytesRecursive {
		if strings.EqualFold(s.Op, "read") {
			currentRead += s.Value
		} else if strings.EqualFold(s.Op, "write") {
			currentWrite += s.Value
		}
	}

	// Get previous cumulative values to calculate rate
	// or we can just store 0 for the first sample. Let's store 0 for the first sample and use a separate table or cache for cumulative values if we wanted to be perfect.
	// For now, let's just use the current - last if last exists.
	readBps := 0.0
	writeBps := 0.0

	// We need to store the cumulative values somewhere. Let's just use the DB for now but it's not ideal.
	// Actually, let's just store the rate. To get the rate, we need the previous cumulative value.
	// I'll add a small hack: store cumulative values in a global map for rate calculation.
	cumulativeLock.Lock()
	prev, ok := lastCumulativeIO[dbID]
	lastCumulativeIO[dbID] = struct{ read, write uint64 }{currentRead, currentWrite}
	cumulativeLock.Unlock()

	if ok {
		if currentRead >= prev.read {
			readBps = float64(currentRead - prev.read)
		}
		if currentWrite >= prev.write {
			writeBps = float64(currentWrite - prev.write)
		}
	}

	// Get active connections
	var activeConnections int
	cmd := []string{"psql", "-U", "postgres", "-t", "-A", "-c",
		"SELECT count(*) FROM pg_stat_activity WHERE application_name IS NULL OR application_name != 'baseful-metrics'"}

	execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
		Cmd:          cmd,
		AttachStdout: true,
	})
	if err == nil {
		attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
		if err == nil {
			var stdout bytes.Buffer
			_, _ = stdcopy.StdCopy(&stdout, &bytes.Buffer{}, attachResp.Reader)
			attachResp.Close()
			activeConnections, _ = strconv.Atoi(strings.TrimSpace(stdout.String()))
		}
	}

	_, _ = MetricsDB.Exec(
		"INSERT INTO samples (database_id, cpu_usage_percent, memory_usage_mb, memory_usage_percent, active_connections, io_read_bps, io_write_bps) VALUES (?, ?, ?, ?, ?, ?, ?)",
		dbID, cpuPercent, memoryMB, memoryPercent, activeConnections, readBps, writeBps,
	)
}

var (
	lastCumulativeIO = make(map[int]struct{ read, write uint64 })
	cumulativeLock   sync.Mutex
)

func CleanupOldMetrics() {
	_, err := MetricsDB.Exec("DELETE FROM samples WHERE timestamp < datetime('now', '-1 hour')")
	if err != nil {
		log.Printf("Failed to cleanup old metrics: %v", err)
	}
}

func GetHistory(dbID int) ([]MetricSample, error) {
	rows, err := MetricsDB.Query(
		"SELECT timestamp, cpu_usage_percent, memory_usage_mb, COALESCE(memory_usage_percent, 0), active_connections, COALESCE(io_read_bps, 0), COALESCE(io_write_bps, 0) FROM samples WHERE database_id = ? ORDER BY timestamp ASC",
		dbID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var history []MetricSample
	for rows.Next() {
		var s MetricSample
		s.DatabaseID = dbID
		if err := rows.Scan(&s.Timestamp, &s.CPUUsagePercent, &s.MemoryUsageMB, &s.MemoryUsagePercent, &s.ActiveConnections, &s.IOReadBps, &s.IOWriteBps); err != nil {
			log.Printf("Error scanning history row: %v", err)
			continue
		}
		history = append(history, s)
	}
	return history, nil
}
