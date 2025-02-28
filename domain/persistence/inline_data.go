package persistence

type InlineData struct {
	ID       int64  `json:"id" db:"id"`
	PartID   int64  `json:"part_id" db:"part_id"`
	MimeType string `json:"mime_type" db:"mime_type"`
	Data     []byte `json:"data" db:"data"` // 使用 byte 数组而非 Base64 编码字符串

}
