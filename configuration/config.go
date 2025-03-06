package configuration

import (
	"database/sql"
	"embed"
	"fmt"
	_ "github.com/mattn/go-sqlite3"
	"net/http"
	"os"
	"time"
)

var (
	Fs              *embed.FS
	EnvMap          map[string]string
	HttpClient      *http.Client
	AIApi           string
	DbPath          = "./history/persistence.db"
	DB              *sql.DB
	DefaultModelInt = "gemini-2.0-flash"
	HttpState       = 200
)

var CustomMIMEs = map[string]string{
	".pdf":  "application/pdf",
	".js":   "application/x-javascript",
	".py":   "application/x-python",
	".txt":  "text/plain",
	".html": "text/html",
	".css":  "text/css",
	".md":   "text/md",
	".csv":  "text/csv",
	".xml":  "text/xml",
	".rtf":  "text/rtf",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".heic": "image/heic",
	".heif": "image/heif",
	".mp4":  "video/mp4",
	".mpeg": "video/mpeg",
	".mov":  "video/mov",
	".avi":  "video/avi",
	".flv":  "video/x-flv",
	".mpg":  "video/mpg",
	".webm": "video/webm",
	".wmv":  "video/wmv",
	".3gp":  "video/3gpp",
	".wav":  "audio/wav",
	".mp3":  "audio/mp3",
	".aiff": "audio/aiff",
	".aac":  "audio/aac",
	".ogg":  "audio/ogg",
	".flac": "audio/flac",
}

type UserInput struct {
	Message   string          `json:"message,omitempty"`
	SessionID int             `json:"session_id"`
	Files     []InlineDataDto `json:"files,omitempty"`
	ContentID *int            `json:"content_id,omitempty"`
}

type InlineDataDto struct {
	MimeType string `json:"mime_type"`
	Data     []byte `json:"data"`
}

const (
	busyTimeout     = 5000
	maxOpenConns    = 100
	maxIdleConns    = 20
	connMaxIdleTime = 5 * time.Minute
	connMaxLifetime = 1 * time.Hour
	historyDirName  = "history"
	historyDirPerm  = 0755
)

func InitializeDBPool(dbPath string) error {
	var err error
	DB, err = sql.Open("sqlite3", fmt.Sprintf("%s?_busy_timeout=%d", dbPath, busyTimeout))
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	DB.SetMaxOpenConns(maxOpenConns)
	DB.SetMaxIdleConns(maxIdleConns)
	DB.SetConnMaxIdleTime(connMaxIdleTime)
	DB.SetConnMaxLifetime(connMaxLifetime)

	if err = DB.Ping(); err != nil {
		return fmt.Errorf("failed to verify database connection: %w", err)
	}

	if _, err = DB.Exec("PRAGMA journal_mode = WAL;"); err != nil {
		return fmt.Errorf("failed to set WAL mode: %w", err)
	}
	return nil
}

func InitHistoryDir() error {
	if err := os.MkdirAll(historyDirName, historyDirPerm); err != nil {
		return fmt.Errorf("failed to create history directory: %w", err)
	}

	db, err := sql.Open("sqlite3", DbPath)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}
	defer db.Close()

	tables := []struct {
		name string
		stmt string
	}{
		{
			"session",
			`CREATE TABLE IF NOT EXISTS session (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                session_base TEXT NOT NULL,
                create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_limited INTEGER default 0
            );`,
		},
		{
			"content",
			`CREATE TABLE IF NOT EXISTS content (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                role TEXT NOT NULL
            );`,
		},
		{
			"part",
			`CREATE TABLE IF NOT EXISTS part (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                inline_data_id INTEGER,
                content_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`,
		},
		{
			"inline_data",
			`CREATE TABLE IF NOT EXISTS inline_data (
    			id INTEGER PRIMARY KEY AUTOINCREMENT,
    			part_id INTEGER NOT NULL,
    			media_type TEXT NOT NULL,
    			data BLOB NOT NULL
            );`,
		},
		{
			"tool",
			`CREATE TABLE IF NOT EXISTS tool (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL
            );`,
		},
	}

	for _, table := range tables {
		if _, err := db.Exec(table.stmt); err != nil {
			return fmt.Errorf("failed to create %s table: %w", table.name, err)
		}
	}

	return nil
}

// BuildAIApi 构建AI接口
func BuildAIApi(DefaultModel, ContentType string) string {
	GeminiApiKey := EnvMap["GEMINI_API_KEY"]
	GeminiBaseURL := EnvMap["BASE_GOOGLE_AI"]
	modelMap := map[string]string{
		"gemini-1.5-flash":              EnvMap["GEMINI_MODEL_1.5"],
		"gemini-1.5-pro":                EnvMap["GEMINI_MODEL_1.5_PRO"],
		"gemini-2.0-flash":              EnvMap["GEMINI_MODEL_2.0"],
		"gemini-2.0-flash-thinking-exp": EnvMap["GEMINI_MODEL_2.0_Thinking"],
		"gemini-2.0-pro":                EnvMap["GEMINI_MODEL_2.0_PRO"],
		"gemini-exp-1206":               EnvMap["GEMINI_MODEL_1206"],
	}

	if DefaultModel == "" {
		if model, ok := modelMap[DefaultModelInt]; ok {
			DefaultModel = model
		}
	} else {
		if model, ok := modelMap[DefaultModel]; ok {
			DefaultModel = model
			DefaultModelInt = DefaultModel
		}
	}

	if ContentType == "" {
		ContentType = EnvMap["CONTENT_TYPE_STEAM"]
	}

	return fmt.Sprintf("%s%s:%skey=%s", GeminiBaseURL, DefaultModel, ContentType, GeminiApiKey)
}
