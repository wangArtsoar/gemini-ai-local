package persistence

type Content struct {
	ID        int64  `json:"id" db:"id"`
	SessionID int64  `json:"session_id" db:"session_id"`
	Role      string `json:"role" db:"role"`
}

type T struct {
	Contents []struct {
		Parts []struct {
			Text string `json:"text"`
		} `json:"parts"`
	} `json:"contents"`
	Tools []struct {
		GoogleSearchRetrieval struct {
			DynamicRetrievalConfig struct {
				Mode             string `json:"mode"`
				DynamicThreshold int    `json:"dynamic_threshold"`
			} `json:"dynamic_retrieval_config"`
		} `json:"google_search_retrieval"`
	} `json:"tools"`
}
