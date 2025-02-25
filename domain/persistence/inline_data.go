package persistence

type InlineData struct {
	ID       int64  `json:"id" db:"id"`
	PartID   int64  `json:"part_id" db:"part_id"`
	MimeType string `json:"mime_type" db:"mime_type"`
	Data     string `json:"data" db:"data"`
}
