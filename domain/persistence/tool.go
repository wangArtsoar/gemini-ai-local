package persistence

type Tool struct {
	ID        int64 `json:"id" db:"id"`
	SessionID int64 `json:"session_id" db:"session_id"`
}

type GoogleSearchRetrieval struct {
	ID     int64 `json:"id" db:"id"`
	ToolID int64 `json:"tool_id" db:"tool_id"`
}

type DynamicRetrievalConfig struct {
	ID                      int64  `json:"id" db:"id"`
	GoogleSearchRetrievalID int64  `json:"google_search_retrieval_id" db:"google_search_retrieval_id"`
	Mode                    string `json:"mode"`
	DynamicThreshold        int    `json:"dynamic_threshold"`
}
